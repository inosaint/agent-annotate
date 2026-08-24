/* `agent-annotate install` stages the plugin somewhere stable and hands that path
   to the claude CLI. What matters here is the staging: a marketplace that is short
   a file, or one that clobbers a directory of the user's, is worse than no installer. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { install, NAME, DEFAULT_ROOT } = require('../lib/install');

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log('  ok  ' + name); pass++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'annotate-install-'));
const root = path.join(tmp, 'marketplace');
const quiet = { quiet: true, claude: false };

ok('defaults to a stable root, not the npx cache', DEFAULT_ROOT.startsWith(os.homedir()));

install({ ...quiet, root });
const { files } = require('../package.json');
ok('stages every file the tarball ships',
  ['package.json', ...files].every(f => fs.existsSync(path.join(root, f))));
ok('stages the marketplace manifest the CLI reads',
  JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8')).name === NAME);
ok('stages the skill, which is the whole point',
  fs.existsSync(path.join(root, 'skills', 'annotate', 'SKILL.md')));
ok('stages the server, so the plugin does not need npm',
  fs.existsSync(path.join(root, 'bin', 'agent-annotate.js')));

/* a stale file from an older version must not survive into the new stage */
fs.writeFileSync(path.join(root, 'stale.txt'), 'x');
install({ ...quiet, root });
ok('re-installing replaces the stage rather than layering on it',
  !fs.existsSync(path.join(root, 'stale.txt')));

const theirs = path.join(tmp, 'theirs');
fs.mkdirSync(theirs);
fs.writeFileSync(path.join(theirs, 'notes.txt'), 'mine');
let threw = false;
try { install({ ...quiet, root: theirs }); } catch { threw = true; }
ok('refuses a directory it did not stage', threw && fs.existsSync(path.join(theirs, 'notes.txt')));

/* --dry-run touches nothing */
const unwritten = path.join(tmp, 'dry');
install({ ...quiet, root: unwritten, dryRun: true });
ok('--dry-run writes nothing', !fs.existsSync(unwritten));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n  ${pass} passed`);
