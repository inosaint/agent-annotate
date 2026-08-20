/* agent-annotate — static dev server that collects page annotations for an agent.

   Serves a directory, injects the annotation toolbar into every HTML response,
   and stores notes as JSON next to the project. Nothing is written to the pages
   themselves, so a project needs no source changes to opt in. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { agentCommand } = require('./agent');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mov': 'video/quicktime', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf'
};

// context.js first: annotate.js reads the table it publishes
const CLIENT = [
  path.join(__dirname, '..', 'client', 'context.js'),
  path.join(__dirname, '..', 'client', 'shot.js'),
  path.join(__dirname, '..', 'client', 'annotate.js')
];
const TAG = '<script src="/__annotate/client.js" defer></script>';
// the tool's own folder has to be reachable so captured regions can be shown back
const SERVABLE_DOTS = new Set(['.annotate', '.well-known']);

function readJSON(file) {
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(d) ? d : []; }
  catch { return []; }
}
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

function body(req) {
  return new Promise((resolve, reject) => {
    let b = '', size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 1e6) { reject(new Error('payload too large')); req.destroy(); return; }
      b += c;
    });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

function rawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('image too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* Put the toolbar tag in before </body>, or fall back to appending. */
function inject(html) {
  if (html.includes('/__annotate/client.js')) return html;
  const i = html.lastIndexOf('</body>');
  return i === -1 ? html + '\n' + TAG + '\n' : html.slice(0, i) + '  ' + TAG + '\n' + html.slice(i);
}

function createServer(opts = {}) {
  const root = path.resolve(opts.root || process.cwd());
  /* Everything this tool writes lives in one folder that ignores itself, so a project
     adopts it without a line of the user's .gitignore changing — and cleaning up is
     deleting one directory. A store from an earlier version stays where it is. */
  const legacy = path.join(root, 'annotations.json');
  const dir = fs.existsSync(legacy) ? root : path.join(root, '.annotate');
  const store = path.resolve(opts.store || path.join(dir, 'annotations.json'));
  const home = path.dirname(store);
  const resolved = path.resolve(opts.resolvedStore || store.replace(/\.json$/, '-resolved.json'));
  const agentLog = path.resolve(opts.agentLog || store.replace(/\.json$/, '-agent.log'));
  const shotDir = path.resolve(opts.shotDir || path.join(home, 'shots'));
  const index = opts.index || 'index.html';
  const quiet = !!opts.quiet;
  const onHandoff = opts.onHandoff || null;
  const host = opts.host || null;             // null → loopback only
  const agent = !!opts.agent;                 // --agent: run Claude Code itself
  const agentBin = opts.agentBin || 'claude';
  const trigger = agent ? `${agentBin} (built in)` : onHandoff;
  const log = (...a) => { if (!quiet) console.log(...a); };

  /* one batch at a time: two agents editing the same files is worse than waiting */
  let running = null, queued = [], lastRun = null, output = '';
  function runHandoff(ids) {
    if (running) { queued.push(ids); log(`    queued behind the run in flight (${queued.length} waiting)`); return; }
    running = ids;
    const started = Date.now();
    log(`    running: ${trigger}`);
    const finish = (code, error) => {
      running = null;
      const report = output.trim();
      lastRun = {
        ids, code, error: error || null, at: new Date().toISOString(),
        ms: Date.now() - started, report
      };
      if (report) {
        try {
          fs.appendFileSync(agentLog,
            `\n=== ${lastRun.at}  ${ids.join(',')}  exit ${code}\n${report}\n`);
        } catch {}
      }
      if (code === 0 && !error) {
        log(`  ✓ handoff finished in ${Math.round(lastRun.ms / 1000)}s — the report is on the page,` +
            ` and in ${path.basename(agentLog)}`);
      }
      else {
        log(`\n  ✗ handoff command ${error ? 'could not start: ' + error : 'exited ' + code}`);
        log('    the notes are still marked ready; fix the command and send again\n');
        const all = readJSON(store);
        all.forEach(a => { if (ids.includes(a.id)) a.handoffError = error || 'exit ' + code; });
        writeJSON(store, all);
      }
      if (queued.length) runHandoff(queued.shift());
    };
    const env = { ...process.env, ANNOTATE_STORE: store, ANNOTATE_IDS: ids.join(',') };
    // captured, not just inherited: what the agent says back is the other half of the
    // loop, and it has to reach the page the user is looking at
    const io = ['ignore', 'pipe', 'pipe'];
    let child;
    try {
      if (agent) {
        // argv, not a shell string: nothing in a note can reach a command line
        const a = agentCommand({ store, ids, root, bin: agentBin });
        child = spawn(a.cmd, a.args, { cwd: a.cwd, stdio: io, env });
      } else {
        child = spawn(onHandoff, { shell: true, stdio: io, env });
      }
    } catch (e) { return finish(null, String(e.message || e)); }
    output = '';
    const take = chunk => {
      output = (output + chunk).slice(-200000);
      if (!quiet) process.stdout.write(chunk);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', e => finish(null, String(e.message || e)));
    child.on('exit', code => { if (running) finish(code); });
  }

  /* is an agent blocked on --wait right now? the pid check keeps a killed waiter
     from leaving a promise behind */
  function waiting() {
    try {
      const w = JSON.parse(fs.readFileSync(path.join(home, 'waiting.json'), 'utf8'));
      process.kill(w.pid, 0);
      return true;
    } catch { return false; }
  }

  function ensureHome() {
    fs.mkdirSync(home, { recursive: true });
    const ignore = path.join(home, '.gitignore');
    if (home !== root && !fs.existsSync(ignore)) {
      fs.writeFileSync(ignore, '# written by agent-annotate: local working state, not site content\n*\n');
    }
  }

  /* No CORS. The toolbar is served by this server and talks to it same-origin, so
     advertising `*` only ever meant "any site you visit can read your notes, and can
     POST a handoff that starts an agent with edit rights on your project". */
  const cors = {};

  // a browser sends Origin on any cross-origin request; tools like curl send none
  const sameOrigin = req => {
    const o = req.headers.origin;
    if (!o) return true;
    try { return new URL(o).host === req.headers.host; } catch { return false; }
  };

  /* Defeats DNS rebinding: a hostile name resolved to 127.0.0.1 still arrives with
     its own Host header. Skipped when the user deliberately binds elsewhere. */
  const localHost = req => {
    if (host && !/^(127\.|::1|localhost)/.test(host)) return true;
    const h = (req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '';
  };
  const json = (res, code, data) => {
    res.writeHead(code, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  const server = http.createServer(async (req, res) => {
    let u;
    try { u = new URL(req.url, 'http://localhost'); }
    catch { res.writeHead(400); return res.end('bad request'); }

    if (!localHost(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('forbidden: this server answers to localhost only');
    }
    if (!sameOrigin(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('forbidden: cross-origin');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

    /* ---- the toolbar itself ---- */
    if (u.pathname === '/__annotate/client.js') {
      let src;
      try { src = CLIENT.map(f => fs.readFileSync(f, 'utf8')).join('\n'); }
      catch { return json(res, 500, { error: 'client missing' }); }
      const rel = path.relative(root, shotDir);
      const cfg = JSON.stringify({
        ignoreClasses: opts.ignoreClasses || [],
        // '' when the shots are outside the served root: the thumbnails degrade, the
        // agent still reads them off disk
        shotBase: rel.startsWith('..') || path.isAbsolute(rel) ? '' : '/' + rel.split(path.sep).join('/')
      });
      res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-cache' });
      return res.end('window.__ANNOTATE_CONFIG=' + cfg + ';\n' + src);
    }

    /* ---- annotation store ---- */
    if (u.pathname === '/__annotations') {
      try {
        if (req.method === 'GET') return json(res, 200, readJSON(store));

        if (req.method === 'POST') {
          const a = JSON.parse((await body(req)) || '{}');
          if (!a.text || !String(a.text).trim()) return json(res, 400, { error: 'text required' });
          const all = readJSON(store);
          a.id = a.id || 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
          a.created = new Date().toISOString();
          a.status = a.status || 'open';
          all.push(a);
          ensureHome();
          writeJSON(store, all);
          const kind = a.context && a.context.label ? `<${a.context.label}> ` : '';
          log(`\n  ✎ #${all.length} [${a.page || '?'}] ${kind}${a.target || ''}\n    "${a.text}"`);
          if (a.intents && a.intents.length) log(`    · ${a.intents.map(t => t.label).join(' · ')}`);
          return json(res, 200, { ok: true, id: a.id, count: all.length });
        }

        if (req.method === 'PATCH') {
          const id = u.searchParams.get('id');
          const patch = JSON.parse((await body(req)) || '{}');
          if (!patch.text || !String(patch.text).trim()) return json(res, 400, { error: 'text required' });
          const all = readJSON(store);
          const note = all.find(x => x.id === id);
          if (!note) return json(res, 404, { error: 'no such note' });
          note.text = String(patch.text);
          // editing reopens the picker, so the element it points at can change too
          if (patch.intents) note.intents = patch.intents;
          else delete note.intents;
          if (patch.target) note.target = patch.target;
          if (patch.context) note.context = patch.context;
          note.edited = new Date().toISOString();
          writeJSON(store, all);
          log(`  ✎ edited ${id}\n    "${note.text}"`);
          return json(res, 200, { ok: true, id });
        }

        if (req.method === 'DELETE') {
          const id = u.searchParams.get('id');
          const all = readJSON(store).filter(x => x.id !== id);
          writeJSON(store, all);
          log(`  ✕ removed ${id} (${all.length} left)`);
          return json(res, 200, { ok: true, count: all.length });
        }
      } catch (e) {
        return json(res, 400, { error: String(e.message || e) });
      }
      res.writeHead(405, cors); return res.end();
    }

    /* ---- a captured region, saved beside the note it belongs to ----
       PNG in the body, note id in the query. The id is checked against the store
       rather than trusted, so nothing here can write outside the shots directory. */
    if (u.pathname === '/__annotations/shot' && req.method === 'POST') {
      try {
        const id = u.searchParams.get('id') || '';
        const all = readJSON(store);
        const note = all.find(a => a.id === id);
        if (!note) return json(res, 404, { error: 'no such note' });
        const png = await rawBody(req, 16e6);
        if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) {
          return json(res, 400, { error: 'expected a png' });
        }
        ensureHome();
        fs.mkdirSync(shotDir, { recursive: true });
        const file = path.join(shotDir, id + '.png');
        fs.writeFileSync(file, png);
        note.shot = path.relative(path.dirname(store), file);
        note.shotBytes = png.length;
        writeJSON(store, all);
        log(`    ⎙ ${(png.length / 1024).toFixed(0)}kB → ${note.shot}`);
        return json(res, 200, { ok: true, shot: note.shot });
      } catch (e) {
        return json(res, 400, { error: String(e.message || e) });
      }
    }

    /* ---- hand off: the user says a batch is finished being written ----
       Notes flip to 'ready', which is the signal an agent waits for; a note still
       being typed is never in that set. With --on-handoff the server also runs the
       command the user gave it, which is the only thing this server ever executes
       and why it has to be passed explicitly.

       The press has to mean something every time, so: batches run one at a time
       rather than racing each other over the same files, the outcome of the last
       run is readable at GET /__annotations/handoff, and a command that fails is
       recorded on its notes instead of disappearing into the log. */
    if (u.pathname === '/__annotations/handoff') {
      if (req.method === 'GET') {
        return json(res, 200, {
          configured: !!trigger, command: trigger, agent, waiting: waiting(),
          running: !!running, queued: queued.length, last: lastRun,
          // while a run is in flight, hand back what it has said so far
          partial: running ? output.slice(-8000) : ''
        });
      }
      if (req.method !== 'POST') { res.writeHead(405, cors); return res.end(); }
      try {
        const p = JSON.parse((await body(req)) || '{}');
        const ids = p.ids || (p.id ? [p.id] : null);
        const all = readJSON(store);
        // naming ids is a deliberate act, so it may re-send a note that already went;
        // "send all" (no ids) never re-sends what is already with the agent
        const hit = a => ids ? ids.includes(a.id) : a.status !== 'ready';
        const sent = all.filter(hit);
        const stamp = new Date().toISOString();
        sent.forEach(a => { a.status = 'ready'; a.handoff = stamp; delete a.handoffError; });
        if (sent.length) writeJSON(store, all);
        log(`\n  ➜ ${sent.length} note${sent.length === 1 ? '' : 's'} handed to the agent`);
        sent.forEach((a, i) => log(`    ${i + 1}. [${a.page || '?'}] ${a.target || ''} — "${a.text}"`));
        const held = waiting();
        if (sent.length && !trigger) {
          log(held ? '    an agent is waiting on this batch'
                   : '    nothing is listening — start `agent-annotate --wait`, or pass --agent');
        }
        if (sent.length && trigger) runHandoff(sent.map(a => a.id));
        return json(res, 200, {
          ok: true, sent: sent.length, configured: !!trigger, agent, waiting: held,
          ran: !!(sent.length && trigger), queued: queued.length
        });
      } catch (e) {
        return json(res, 400, { error: String(e.message || e) });
      }
    }

    /* ---- mark done: move notes out of the live queue into the resolved log ---- */
    if (u.pathname === '/__annotations/resolve' && req.method === 'POST') {
      try {
        const p = JSON.parse((await body(req)) || '{}');
        const ids = p.ids || (p.id ? [p.id] : null);
        const all = readJSON(store);
        const hit = a => !ids || ids.includes(a.id);
        const done = all.filter(hit).map(a => ({
          ...a, status: 'resolved', resolved: new Date().toISOString()
        }));
        if (!done.length) return json(res, 200, { ok: true, resolved: 0, open: all.length });
        writeJSON(resolved, readJSON(resolved).concat(done));
        writeJSON(store, all.filter(a => !hit(a)));
        log(`  ✓ resolved ${done.length}`);
        return json(res, 200, { ok: true, resolved: done.length, open: all.length - done.length });
      } catch (e) {
        return json(res, 400, { error: String(e.message || e) });
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

    /* ---- static files ---- */
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith('/')) p += index;
    /* A dev server pointed at a project root would otherwise hand out .git, .env and
       .npmrc — the user's own secrets, from a tool they ran to look at a page.
       Dotted paths are refused apart from the ones this tool needs. */
    const parts = p.split('/').filter(Boolean);
    if (parts.some(seg => seg.startsWith('.') && !SERVABLE_DOTS.has(seg))) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('forbidden: dotted paths are not served');
    }
    // resolve inside root, and confirm it stayed there (no ../ escapes, no symlink-out)
    const file = path.resolve(root, '.' + p);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403); return res.end('forbidden');
    }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found: ' + p); }
      const ext = path.extname(file).toLowerCase();
      let out = data;
      if (ext === '.html' || ext === '.htm') out = Buffer.from(inject(data.toString('utf8')), 'utf8');
      res.writeHead(200, {
        'Content-Type': TYPES[ext] || 'application/octet-stream',
        'Content-Length': out.length,
        'Cache-Control': 'no-cache'
      });
      res.end(req.method === 'HEAD' ? undefined : out);
    });
  });

  server.on('listening', () => {
    const port = server.address().port;
    log(`\n  agent-annotate  →  http://localhost:${port}/`);
    log(`  serving        →  ${root}`);
    if (host && !/^(127\.|::1|localhost)/.test(host)) {
      log(`  ! bound to ${host} — anyone who can reach this machine can read this`);
      log(`    directory and send notes. Only do this on a network you trust.`);
    }
    log(`  annotations    →  ${store}`);
    if (home !== root) log(`  (that folder ignores itself — nothing to add to .gitignore)`);
    log(trigger
      ? `  on handoff     →  ${trigger}`
      : `  on handoff     →  nothing configured — pass --agent, or --on-handoff <cmd>`);
    // a missing binary should be an error at boot, not a surprise at the first press
    if (agent) {
      const probe = spawnSync(agentBin, ['--version'], { stdio: 'ignore' });
      if (probe.error) log(`\n  ! --agent needs "${agentBin}" on your PATH, and it is not there.`);
    }
    log(`  press A on the page to start annotating\n`);
  });

  return Object.assign(server, { root, store, resolved, index, onHandoff, agent, agentLog, shotDir, host });
}

module.exports = { createServer, inject, TYPES };
