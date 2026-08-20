/* agent-annotate — the built-in handoff agent.

   `--agent` wires the "send to agent" button straight to Claude Code, so the loop
   closes with no glue script of the user's own. Everything the agent needs travels
   in the prompt: the batch, the store, and what a note is made of.

   `--on-handoff <cmd>` remains the escape hatch for anything else. */

const path = require('path');

const RULES = `You are the agent behind agent-annotate. The user has been clicking elements on their
local page and leaving notes about what should change; they just pressed "send to agent".

Read the notes in the store below and act ONLY on the ids listed. Ignore every other note.

Each note carries:
  target   a CSS-ish path to the element the user clicked
  context  what kind of element it is, plus facts measured off the live page
           (box size, computed display and gap, font size, colours, word counts)
  intents  the changes they picked from the toolbar, as short verbs
  text     what they typed, which may be the intents spelled out
  x, y     where on the page the pin sits, and viewport/theme for when it matters

The target is a hint about the rendered DOM, not necessarily a literal source
selector — find what it refers to in the source before changing anything.`;

const TRIAGE = `More than one note means triage before anything else:
  1. Group the notes that touch the same element or the same region.
  2. Work out what has to land first — layout before its contents; a note that
     removes or moves something makes notes about polishing it moot.
  3. Name any notes that genuinely conflict. Do not quietly pick a side.
  4. Order the work so each change is made once.`;

function prompt({ store, ids, root }) {
  return [
    RULES,
    `Store: ${store}`,
    `Ids in this batch: ${ids.join(', ')}`,
    `Project root: ${root}`,
    ids.length === 1 ? 'This batch is a single note, so no triage is needed.' : TRIAGE,
    `State the plan in a line or two, then carry it out in the source files under the
project root. When you have finished a note, move it from the store to the sibling
annotations-resolved.json with "status": "resolved" and a "resolved" timestamp — only
the ones you genuinely addressed.

Where a note is ambiguous, or two notes conflict, or you think the change is a bad
idea: do not guess. Do the part that is unambiguous, leave the rest, and say what you
need the user to decide.`,
    'Finish with one short line per note saying what you did, or what you need decided.'
  ].join('\n\n');
}

const TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'MultiEdit'];

function agentCommand({ store, ids, root, bin }) {
  return {
    cmd: bin || 'claude',
    args: ['-p', prompt({ store, ids, root: path.resolve(root) }),
      '--allowedTools', ...TOOLS, '--permission-mode', 'acceptEdits'],
    cwd: path.resolve(root)
  };
}

module.exports = { agentCommand, prompt, TOOLS };
