/* agent-annotate install — register this package as a Claude Code plugin.
   npx unpacks into a temp cache that is garbage-collected, so a marketplace
   pointing at the running package would go stale. We stage a copy at a stable
   root first, then hand that path to the Claude Code CLI. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PKG = path.join(__dirname, '..');
const NAME = 'agent-annotate';            // plugin and marketplace share the name
const DEFAULT_ROOT = path.join(os.homedir(), '.agent-annotate', 'marketplace');

/* what the tarball ships, plus the manifest npm itself reads — one source of
   truth with package.json's files array, so a new top-level directory is staged
   the moment it is publishable */
function payload() {
  const { files } = require(path.join(PKG, 'package.json'));
  return ['package.json', ...(files || [])].filter(f => fs.existsSync(path.join(PKG, f)));
}

/* Only ever clear a directory we can see we staged ourselves. */
function stagedByUs(root) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
    return m.name === NAME;
  } catch { return false; }
}

function stage(root, log) {
  if (fs.existsSync(root) && fs.readdirSync(root).length && !stagedByUs(root)) {
    throw new Error(`${root} already has files in it that agent-annotate did not put there.\n` +
      '  Pass --root <dir> to stage somewhere else.');
  }
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const f of payload()) {
    fs.cpSync(path.join(PKG, f), path.join(root, f), { recursive: true });
  }
  log(`  staged  ${root}`);
}

const quote = s => (/[^\w@%+=:,./-]/.test(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s);

function manual(root) {
  return [`claude plugin marketplace add ${quote(root)}`,
          `claude plugin install ${NAME}@${NAME}`];
}

function run(args) {
  const r = spawnSync('claude', args, { encoding: 'utf8' });
  return { ok: !r.error && r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

function install(opts = {}) {
  const log = opts.quiet ? () => {} : (...a) => console.log(...a);
  const root = path.resolve(opts.root || DEFAULT_ROOT);

  if (opts.dryRun) {
    log(`  would stage  ${root}`);
    manual(root).forEach(c => log(`  would run    ${c}`));
    return 0;
  }

  stage(root, log);

  if (opts.claude === false) { print(root, log); return 0; }

  if (!spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout) {
    log('\n  The Claude Code CLI is not on your PATH. Once it is, run:\n');
    print(root, log);
    return 0;
  }

  // a marketplace of this name may already be registered; that is not a failure
  const added = run(['plugin', 'marketplace', 'add', root]);
  if (!added.ok && added.out) log(`  ${added.out.split('\n')[0]}`);

  const installed = run(['plugin', 'install', `${NAME}@${NAME}`]);
  if (!installed.ok) {
    console.error('\n  Could not install the plugin automatically.');
    if (installed.out) console.error(`  ${installed.out}`);
    console.error('\n  Run these yourself:\n');
    manual(root).forEach(c => console.error(`    ${c}`));
    return 1;
  }

  log(`  installed  ${NAME}@${NAME}`);
  log('\n  Start a Claude Code session and run  /agent-annotate:annotate');
  return 0;
}

function print(root, log) {
  manual(root).forEach(c => log(`    ${c}`));
  log('\n  Then, in a session:  /agent-annotate:annotate');
}

module.exports = { install, DEFAULT_ROOT, NAME };
