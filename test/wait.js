/* --wait: an agent already in the conversation blocks on this and gets the batch. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { waitForBatch, describe } = require('../lib/wait');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-annotate-wait-'));
const store = path.join(dir, 'annotations.json');
const write = d => fs.writeFileSync(store, JSON.stringify(d, null, 2));

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log('  ok  ' + name); pass++; };

(async () => {
  // one note already handed over before we started: not ours to report
  write([{ id: 'old', status: 'ready', text: 'earlier', page: 'index.html' }]);

  let got = null;
  const waiting = waitForBatch({ store, poll: 30, onBatch: n => { got = n; } });

  await new Promise(r => setTimeout(r, 120));
  ok('does not fire on notes that were already sent', got === null);

  write([
    { id: 'old', status: 'ready', text: 'earlier', page: 'index.html' },
    { id: 'new1', status: 'open', text: 'still being typed', page: 'index.html' }
  ]);
  await new Promise(r => setTimeout(r, 120));
  ok('does not fire on a note that is only open', got === null);

  write([
    { id: 'old', status: 'ready', text: 'earlier', page: 'index.html' },
    { id: 'new1', status: 'ready', text: 'make it wobbly', page: 'index.html',
      target: 'section > h3', context: { label: 'heading', facts: ['24px', '5 words'] },
      intents: [{ id: 'tone', label: 'tone: punchier' }] },
    { id: 'new2', status: 'ready', text: 'tighter', page: 'index.html', target: 'div.row' }
  ]);
  await waiting;
  ok('fires when a batch is sent', got && got.length === 2);
  ok('reports only the new batch', got.map(a => a.id).join() === 'new1,new2');

  const text = got.map(describe).join('\n');
  ok('the printout carries the target', text.includes('section > h3'));
  ok('the printout carries the context and facts', text.includes('heading · 24px · 5 words'));
  ok('the printout carries what they picked', text.includes('tone: punchier'));
  ok('the printout carries the words', text.includes('make it wobbly'));

  console.log(`\n  ${pass} passed\n`);
})();
