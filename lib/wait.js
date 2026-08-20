/* agent-annotate --wait — the way a Claude Code session that is already talking to
   the user picks up a handoff.

   Spawning a fresh headless agent is the fallback, not the goal: it starts cold, and
   whatever it says lands somewhere the user is not looking. An agent already in the
   conversation has the context and is watching. So it runs this as a background task
   and gets on with something else; when the user presses "send to agent", this exits
   and prints the batch, which is what puts the notes in front of the agent. */

const fs = require('fs');
const path = require('path');

const readJSON = f => {
  try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(d) ? d : []; }
  catch { return []; }
};

function describe(a, i) {
  // a capture has no target — saying '?' implies something is missing when it is not
  const what = a.target || (a.shot ? 'a captured region' : '?');
  const bits = [`${i + 1}. [${a.page || '?'}] ${what}`];
  if (a.context) bits.push(`   ${a.context.label}${a.context.facts ? ' · ' + a.context.facts.join(' · ') : ''}`);
  bits.push(`   "${a.text}"`);
  if (a.intents && a.intents.length) bits.push(`   picked: ${a.intents.map(t => t.label).join(' · ')}`);
  // the picture is the point when there is one; say so where it cannot be missed
  if (a.shot) bits.push(`   SHOT: ${a.shot}  ← read this image`);
  return bits.join('\n');
}

/* A waiting agent is invisible to the server, which then tells the user nothing is
   listening — so say so on disk. The file carries a pid, and the server checks that
   the process is still alive, so a waiter that was killed leaves no false promise. */
function announce(store) {
  const file = path.join(path.dirname(store), 'waiting.json');
  const write = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, since: new Date().toISOString() }));
    } catch {}
  };
  write();
  const beat = setInterval(write, 5000);
  if (beat.unref) beat.unref();
  const clear = () => { try { fs.unlinkSync(file); } catch {} };
  process.on('exit', clear);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { clear(); process.exit(0); });
  }
  return clear;
}

/* Resolves when a batch is handed over, having printed it. */
function waitForBatch({ store, onBatch, seen = null, poll = 700, quiet = false }) {
  const isReady = a => a.status === 'ready';
  const stand = quiet ? () => {} : announce(store);
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
      stand();
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

module.exports = { waitForBatch, describe, readJSON, announce };
