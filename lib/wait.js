/* agent-annotate --wait — the way a Claude Code session that is already talking to
   the user picks up a handoff.

   Spawning a fresh headless agent is the fallback, not the goal: it starts cold, and
   whatever it says lands somewhere the user is not looking. An agent already in the
   conversation has the context and is watching. So it runs this as a background task
   and gets on with something else; when the user presses "send to agent", this exits
   and prints the batch, which is what puts the notes in front of the agent. */

const fs = require('fs');

const readJSON = f => {
  try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(d) ? d : []; }
  catch { return []; }
};

function describe(a, i) {
  const bits = [`${i + 1}. [${a.page || '?'}] ${a.target || '?'}`];
  if (a.context) bits.push(`   ${a.context.label}${a.context.facts ? ' · ' + a.context.facts.join(' · ') : ''}`);
  bits.push(`   "${a.text}"`);
  if (a.intents && a.intents.length) bits.push(`   picked: ${a.intents.map(t => t.label).join(' · ')}`);
  return bits.join('\n');
}

/* Resolves when a batch is handed over, having printed it. */
function waitForBatch({ store, onBatch, seen = null, poll = 700 }) {
  const isReady = a => a.status === 'ready';
  // ids already with an agent when we started are not ours to report
  const before = seen || new Set(readJSON(store).filter(isReady).map(a => a.id));
  return new Promise(resolve => {
    let done = false;
    const check = () => {
      if (done) return;
      const fresh = readJSON(store).filter(a => isReady(a) && !before.has(a.id));
      if (!fresh.length) return;
      done = true;
      clearInterval(timer);
      if (watcher) watcher.close();
      onBatch(fresh);
      resolve(fresh);
    };
    // fs.watch is instant where it works, the poll is what makes it reliable
    let watcher = null;
    try { watcher = fs.watch(store, check); } catch {}
    const timer = setInterval(check, poll);
    check();
  });
}

module.exports = { waitForBatch, describe, readJSON };
