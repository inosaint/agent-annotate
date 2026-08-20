/* End-to-end smoke test: serve a temp dir, post/list/resolve, check injection
   and that the static handler refuses to serve outside the root. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../lib/server');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-annotate-'));
fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><body><h1>hi</h1></body>');
fs.writeFileSync(path.join(os.tmpdir(), 'SECRET.txt'), 'do not serve me');

const fired = path.join(root, 'fired.txt');
const server = createServer({
  root, quiet: true,
  onHandoff: `node -e "require('fs').writeFileSync(process.argv[1], process.env.ANNOTATE_IDS);`
    + ` console.log('handled', process.env.ANNOTATE_IDS)" ${JSON.stringify(fired)}`
});
server.listen(0, async () => {
  const base = 'http://localhost:' + server.address().port;
  const j = (p, o) => fetch(base + p, o).then(r => r.json());
  let pass = 0;
  const ok = (name, cond) => { assert.ok(cond, name); console.log('  ok  ' + name); pass++; };

  try {
    const html = await fetch(base + '/').then(r => r.text());
    ok('serves the directory index', html.includes('<h1>hi</h1>'));
    ok('injects the toolbar before </body>',
      html.includes('/__annotate/client.js') &&
      html.indexOf('/__annotate/client.js') < html.indexOf('</body>'));

    const client = await fetch(base + '/__annotate/client.js').then(r => r.text());
    ok('serves the toolbar with its config', client.includes('window.__ANNOTATE_CONFIG'));
    ok('bundles the element-context table ahead of the toolbar',
      client.indexOf('window.__ANNOTATE_CONTEXT') < client.indexOf('an-bar'));

    ok('starts with an empty queue', (await j('/__annotations')).length === 0);

    const post = await j('/__annotations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'make it wobbly', target: 'h1', page: 'index.html' })
    });
    ok('accepts a note', post.ok && post.id);

    const bad = await fetch(base + '/__annotations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '   ' })
    });
    ok('rejects an empty note', bad.status === 400);

    const ctx = await j('/__annotations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'plainer, please', target: 'p', page: 'index.html',
        context: { kind: 'text', label: 'copy', tag: 'p', facts: ['16px/1.5', '9 words'] },
        intents: [{ id: 'tone', label: 'tone: plainer' }]
      })
    });
    ok('accepts a note carrying element context', ctx.ok);

    const list = await j('/__annotations');
    ok('persists the note', list.length === 2 && list[0].text === 'make it wobbly');
    ok('keeps context and intents intact',
      list[1].context.kind === 'text' && list[1].intents[0].label === 'tone: plainer');
    ok('stamps id/created/status', list[0].id && list[0].created && list[0].status === 'open');

    const patch = await fetch(base + '/__annotations?id=' + post.id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'make it much wobblier' })
    }).then(r => r.json());
    ok('edits a note in place', patch.ok);
    const edited = (await j('/__annotations')).find(a => a.id === post.id);
    ok('keeps the edit and stamps it', edited.text === 'make it much wobblier' && edited.edited);

    const missing = await fetch(base + '/__annotations?id=nope', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x' })
    });
    ok('refuses to edit a note that is not there', missing.status === 404);

    const hand = await j('/__annotations/handoff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [post.id] })
    });
    ok('hands a batch to the agent', hand.ok && hand.sent === 1 && hand.ran);
    ok('marks the handed-off note ready',
      (await j('/__annotations')).find(a => a.id === post.id).status === 'ready');

    const all = await j('/__annotations/handoff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    ok('send-all skips notes already with the agent', all.sent === 1);

    const again = await j('/__annotations/handoff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [post.id] })
    });
    ok('naming a note re-sends it even when it already went', again.sent === 1 && again.ran);

    for (let i = 0; i < 50 && !fs.existsSync(fired); i++) await new Promise(r => setTimeout(r, 40));
    ok('runs the --on-handoff command with the ids',
      fs.existsSync(fired) && fs.readFileSync(fired, 'utf8') === post.id);

    const untilIdle = async () => {
      for (let i = 0; i < 100; i++) {
        const st = await j('/__annotations/handoff');
        if (!st.running && st.last) return st;
        await new Promise(r => setTimeout(r, 40));
      }
      return j('/__annotations/handoff');
    };
    const status = await untilIdle();
    ok('reports how the run went', status.configured && status.last.code === 0 && !status.last.error);
    ok('hands back what the command said', status.last.report.includes(post.id));
    ok('keeps a log of agent runs next to the store',
      fs.readFileSync(path.join(root, 'annotations-agent.log'), 'utf8').includes(post.id));

    /* a captured region rides along with its note */
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64');
    const shot = await fetch(base + '/__annotations/shot?id=' + ctx.id, {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png
    }).then(r => r.json());
    ok('saves a shot beside its note', shot.ok && shot.shot === path.join('annotations-shots', ctx.id + '.png'));
    ok('writes the file', fs.readFileSync(path.join(root, 'annotations-shots', ctx.id + '.png')).equals(png));
    ok('records it on the note', (await j('/__annotations')).find(a => a.id === ctx.id).shot === shot.shot);

    const orphan = await fetch(base + '/__annotations/shot?id=../../escape', {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png
    });
    ok('refuses a shot for a note that does not exist', orphan.status === 404);
    ok('and writes nothing outside the shots directory',
      !fs.existsSync(path.join(os.tmpdir(), 'escape.png')));

    const notPng = await fetch(base + '/__annotations/shot?id=' + ctx.id, {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.from('not an image at all')
    });
    ok('refuses a body that is not a png', notPng.status === 400);

    const res = await j('/__annotations/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [post.id, ctx.id] })
    });
    ok('resolves the note', res.ok && res.resolved === 2);
    ok('empties the live queue', (await j('/__annotations')).length === 0);

    const done = JSON.parse(fs.readFileSync(path.join(root, 'annotations-resolved.json'), 'utf8'));
    ok('logs it as resolved', done.length === 2 && done[0].status === 'resolved' && done[0].resolved);

    /* a command that fails has to be visible, not swallowed */
    const badRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-annotate-bad-'));
    const failing = createServer({ root: badRoot, quiet: true, onHandoff: 'exit 3' });
    await new Promise(r => failing.listen(0, r));
    const badBase = 'http://localhost:' + failing.address().port;
    const bj = (p, o) => fetch(badBase + p, o).then(r => r.json());
    const bnote = await bj('/__annotations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'note', page: 'index.html' })
    });
    await bj('/__annotations/handoff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [bnote.id] })
    });
    let bstatus;
    for (let i = 0; i < 100; i++) {
      bstatus = await bj('/__annotations/handoff');
      if (!bstatus.running && bstatus.last) break;
      await new Promise(r => setTimeout(r, 40));
    }
    ok('reports a command that exits non-zero', bstatus.last.code === 3);
    ok('records the failure on the note',
      (await bj('/__annotations'))[0].handoffError === 'exit 3');

    const noHook = createServer({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'agent-annotate-none-')), quiet: true });
    await new Promise(r => noHook.listen(0, r));
    const nBase = 'http://localhost:' + noHook.address().port;
    const nNote = await fetch(nBase + '/__annotations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'note', page: 'index.html' })
    }).then(r => r.json());
    const nHand = await fetch(nBase + '/__annotations/handoff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [nNote.id] })
    }).then(r => r.json());
    ok('says plainly when no command is configured',
      nHand.ok && nHand.sent === 1 && nHand.configured === false && nHand.ran === false);
    failing.close(); noHook.close();

    const esc = await fetch(base + '/../SECRET.txt');
    ok('refuses to serve outside the root', esc.status === 404 || esc.status === 403);

    console.log(`\n  ${pass} passed\n`);
    server.close(() => process.exit(0));
  } catch (e) {
    console.error('\n  FAILED:', e.message, '\n');
    server.close(() => process.exit(1));
  }
});
