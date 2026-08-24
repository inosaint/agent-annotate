/* End-to-end smoke test: serve a temp dir, post/list/resolve, check injection
   and that the static handler refuses to serve outside the root. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createServer } = require('../lib/server');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-annotate-'));
// everything the server writes goes in one self-ignoring folder under the root
const home = path.join(root, '.annotate');
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
    ok('tells the toolbar where the shots are served from', client.includes('"shotBase":"/.annotate/shots"'));
    ok('bundles the element-context table ahead of the toolbar',
      client.indexOf('window.__ANNOTATE_CONTEXT') < client.indexOf('an-bar'));

    ok('starts with an empty queue', (await j('/__annotations')).length === 0);
    ok('writes nothing before there is a note', !fs.existsSync(home));

    const post = await j('/__annotations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'make it wobbly', target: 'h1', page: 'index.html' })
    });
    ok('accepts a note', post.ok && post.id);
    ok('keeps its working state in one folder', fs.existsSync(path.join(home, 'annotations.json')));
    ok('and that folder ignores itself',
      fs.readFileSync(path.join(home, '.gitignore'), 'utf8').trim().endsWith('*'));

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

    // a note written from highlighted text keeps the exact words beside what was typed
    const quoted = await j('/__annotations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '\u201cship it fast\u201d\nthis is too breathless', target: 'p', page: 'index.html',
        selection: { text: 'ship it fast' }
      })
    });
    const withSel = (await j('/__annotations')).find(a => a.id === quoted.id);
    ok('keeps the highlighted text on the note', withSel.selection.text === 'ship it fast');
    await fetch(base + '/__annotations?id=' + quoted.id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'too breathless', selection: { text: 'ship it fast' } })
    });
    const stillSel = (await j('/__annotations')).find(a => a.id === quoted.id);
    ok('and through an edit', stillSel.selection.text === 'ship it fast');
    await fetch(base + '/__annotations?id=' + quoted.id, { method: 'DELETE' });

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
      fs.readFileSync(path.join(home, 'annotations-agent.log'), 'utf8').includes(post.id));

    /* a captured region rides along with its note */
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64');
    const shot = await fetch(base + '/__annotations/shot?id=' + ctx.id, {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png
    }).then(r => r.json());
    ok('saves a shot beside its note', shot.ok && shot.shot === path.join('shots', ctx.id + '.png'));
    ok('writes the file', fs.readFileSync(path.join(home, 'shots', ctx.id + '.png')).equals(png));
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

    const done = JSON.parse(fs.readFileSync(path.join(home, 'annotations-resolved.json'), 'utf8'));
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
    ok('and that nobody is waiting either', nHand.waiting === false);

    /* a session blocked on --wait is listening, even with no command configured */
    const wRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-annotate-wait-'));
    const wHome = path.join(wRoot, '.annotate');
    const watched = createServer({ root: wRoot, quiet: true });
    await new Promise(r => watched.listen(0, r));
    const wBase = 'http://localhost:' + watched.address().port;
    const wNote = await fetch(wBase + '/__annotations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'note', page: 'index.html' })
    }).then(r => r.json());
    fs.writeFileSync(path.join(wHome, 'waiting.json'), JSON.stringify({ pid: process.pid }));
    const wHand = await fetch(wBase + '/__annotations/handoff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [wNote.id] })
    }).then(r => r.json());
    ok('sees an agent that is blocked on --wait', wHand.waiting === true);

    fs.writeFileSync(path.join(wHome, 'waiting.json'), JSON.stringify({ pid: 2 ** 30 }));
    const dead = await fetch(wBase + '/__annotations/handoff').then(r => r.json());
    ok('and not one that has been killed', dead.waiting === false);
    watched.close();
    failing.close(); noHook.close();

    /* a project that already has a store from an older version keeps using it */
    const oldRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-annotate-legacy-'));
    fs.writeFileSync(path.join(oldRoot, 'annotations.json'), '[]');
    const legacy = createServer({ root: oldRoot, quiet: true });
    ok('leaves an existing store where it is',
      legacy.store === path.join(oldRoot, 'annotations.json'));
    ok('and does not start a folder beside it', !fs.existsSync(path.join(oldRoot, '.annotate')));

    const esc = await fetch(base + '/../SECRET.txt');
    ok('refuses to serve outside the root', esc.status === 404 || esc.status === 403);

    /* the user's own secrets, in the directory they pointed this at */
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main');
    fs.writeFileSync(path.join(root, '.env'), 'DB_PASSWORD=hunter2');
    fs.writeFileSync(path.join(root, '.npmrc'), '_authToken=npm_secret');
    for (const secret of ['.env', '.git/HEAD', '.npmrc']) {
      const r = await fetch(base + '/' + secret);
      ok('refuses to serve ' + secret, r.status === 403);
    }
    ok('still serves its own folder', (await fetch(base + '/.annotate/annotations.json')).status !== 403);

    /* a page on another origin must not be able to read notes or start an agent */
    ok('sends no wildcard CORS header',
      !(await fetch(base + '/__annotations')).headers.get('access-control-allow-origin'));
    const foreign = await fetch(base + '/__annotations', { headers: { Origin: 'https://evil.example' } });
    ok('refuses a cross-origin read', foreign.status === 403);
    const foreignHandoff = await fetch(base + '/__annotations/handoff', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({})
    });
    ok('refuses a cross-origin handoff', foreignHandoff.status === 403);
    const own = await fetch(base + '/__annotations', { headers: { Origin: base } });
    ok('allows the toolbar itself', own.status === 200);

    /* DNS rebinding: the address resolves to us, the name does not. fetch() refuses
       to set Host, so ask over a socket. */
    const rebound = await new Promise(resolve => {
      const r = http.request({ host: '127.0.0.1', port: server.address().port, path: '/',
        headers: { Host: 'evil.example' } }, res2 => resolve(res2.statusCode));
      r.on('error', () => resolve(0));
      r.end();
    });
    ok('refuses a request that arrives under another hostname', rebound === 403);

    console.log(`\n  ${pass} passed\n`);
    server.close(() => process.exit(0));
  } catch (e) {
    console.error('\n  FAILED:', e.message, '\n');
    server.close(() => process.exit(1));
  }
});
