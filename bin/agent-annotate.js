#!/usr/bin/env node
/* agent-annotate CLI */
const path = require('path');
const { createServer } = require('../lib/server');

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
function opt(name, fallback) {
  const i = argv.indexOf('--' + name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

if (has('--help') || has('-h')) {
  console.log(`
  agent-annotate — click your local site, leave notes for your coding agent

  Usage
    npx agent-annotate [options]

  Options
    --root <dir>      directory to serve            (default: cwd)
    --port <n>        port, 0 picks a free one      (default: 8765)
    --store <file>    annotations file  (default: <root>/.annotate/annotations.json)
    --index <file>    directory index               (default: index.html)
    --ignore <a,b>    runtime-only classes to keep out of selectors
    --wait            do not serve: block until the next batch is sent, print it
                      and exit. For an agent already in a conversation with you —
                      it runs this in the background and picks the notes up there.
    --agent           send-to-agent starts a fresh headless Claude Code instead
    --on-handoff <c>  run your own command instead of --agent
    --quiet           no logging
    --help            this message

  In the page: press A to arm, click an element, type, Cmd/Ctrl+Enter to save,
  then press "send to agent" in the notes list.

  With --agent that starts Claude Code on exactly those notes: it triages them,
  makes the changes, and comes back to ask about anything ambiguous. Without it,
  notes are only marked ready for an agent you run yourself.
`);
  process.exit(0);
}

/* --wait: no server, just block until the user presses send */
if (has('--wait')) {
  const { waitForBatch, describe } = require('../lib/wait');
  const root = path.resolve(opt('root', process.cwd()));
  const legacy = path.join(root, 'annotations.json');
  const store = path.resolve(opt('store', null) ||
    (require('fs').existsSync(legacy) ? legacy : path.join(root, '.annotate', 'annotations.json')));
  if (!has('--quiet')) console.error(`  waiting for a batch  →  ${store}`);
  waitForBatch({
    store,
    onBatch: notes => {
      console.log(`${notes.length} note${notes.length === 1 ? '' : 's'} sent to the agent:\n`);
      notes.forEach((a, i) => console.log(describe(a, i) + '\n'));
      console.log(`ids: ${notes.map(a => a.id).join(',')}`);
      console.log(`store: ${store}`);
      if (notes.length > 1) console.log('\nTriage before editing: group notes on the same element,' +
        ' settle what has to land first, name anything that conflicts.');
      console.log('Resolve only what you actually addressed.');
    }
  }).then(() => process.exit(0));
  return;
}

if (has('--agent') && opt('on-handoff', null)) {
  console.error('  agent-annotate: pass either --agent or --on-handoff, not both');
  process.exit(1);
}

const port = Number(opt('port', 8765));
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('  agent-annotate: --port must be an integer 0-65535');
  process.exit(1);
}

const server = createServer({
  root: path.resolve(opt('root', process.cwd())),
  port,
  store: opt('store', null),
  index: opt('index', 'index.html'),
  ignoreClasses: (opt('ignore', '') || '').split(',').map(s => s.trim()).filter(Boolean),
  onHandoff: opt('on-handoff', null),
  agent: has('--agent'),
  quiet: has('--quiet')
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  agent-annotate: port ${port} is already in use.`);
    console.error(`  Try:  npx agent-annotate --port ${port + 1}   (or --port 0 for any free port)\n`);
  } else {
    console.error('  agent-annotate:', err.message);
  }
  process.exit(1);
});

server.listen(port);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
