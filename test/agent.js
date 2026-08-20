/* The built-in handoff agent: the batch and everything needed to act on it has to
   reach the prompt, and the agent must get no more reach than the job needs. */
const assert = require('assert');
const { agentCommand, TOOLS } = require('../lib/agent');

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log('  ok  ' + name); pass++; };
const cmd = (ids = ['a1', 'a2']) =>
  agentCommand({ store: '/proj/annotations.json', ids, root: '/proj' });

const c = cmd();
const tools = c.args.slice(c.args.indexOf('--allowedTools') + 1).filter(a => !a.startsWith('--'));

ok('runs claude by default', c.cmd === 'claude' && c.args[0] === '-p');
ok('runs in the served root', c.cwd === '/proj');
ok('can read and edit the project', ['Read', 'Edit', 'Write'].every(t => tools.includes(t)));
ok('does not get a shell', !tools.includes('Bash'));
ok('does not stop to ask about every edit', c.args.includes('acceptEdits'));

const p = c.args[1];
ok('the batch reaches the prompt', p.includes('a1, a2'));
ok('the store reaches the prompt', p.includes('/proj/annotations.json'));
ok('it is told what a note is made of', /target/.test(p) && /intents/.test(p) && /context/.test(p));
ok('it is told to resolve what it finished', /annotations-resolved\.json/.test(p));
ok('it is told to ask rather than guess', /do not guess/.test(p));
ok('a batch of one skips the triage instructions', cmd(['a1']).args[1].includes('single note'));
ok('a batch of several asks for triage', p.includes('triage before anything else'));
ok('the tool list is fixed', Array.isArray(TOOLS) && TOOLS.includes('Read'));

console.log(`\n  ${pass} passed\n`);
