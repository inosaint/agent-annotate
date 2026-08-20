# agent-annotate

Click any element on your local site, say what should change, and your coding agent
reads the note — with the element it points at, what kind of element it is, the page,
the viewport and the theme attached.

Describing *which* thing you mean is the slow part of design iteration. This removes it.

```bash
npx agent-annotate --root .
```

Open the URL it prints, press **A**, click something, type. That's the loop.

The popup reads the element you clicked and offers controls that fit it: click a
paragraph and you get tone and length; click a flex container and you get flow,
alignment and spacing; click a button and you get emphasis, size and state. Pick a
couple of chips and you have a complete note without typing a word.

No framework, no build step, and **no changes to your project's source** — the toolbar
is injected into HTML responses by the dev server, so nothing can leak into production.

## How it works

The server serves your directory and adds one script tag to each HTML response. The
toolbar refuses to load anywhere except `localhost` / `127.0.0.1`. Notes are POSTed
back and stored as JSON next to your project:

```json
{
  "text": "make these lines wobbly",
  "target": "section.mo > h3",
  "page": "index.html",
  "x": 278, "y": 1398,
  "viewport": "1446x703",
  "theme": "light",
  "context": {
    "kind": "heading", "label": "heading", "tag": "h3",
    "facts": ["412×38", "24px/1.2 600", "rgb(20, 22, 26)", "5 words"]
  },
  "intents": [
    { "id": "tone", "label": "tone: punchier" },
    { "id": "length", "label": "length: shorter" }
  ],
  "id": "amsyvcaio2ij",
  "created": "2026-08-18T16:20:07.104Z",
  "status": "open"
}
```

`target` and `x`/`y` are what make a note actionable — an agent can find the element
rather than guess at your prose. `theme` and `viewport` capture notes that only apply
in dark mode or at one width.

`context` is the element read off the live page: its `kind` (one of `heading`, `text`,
`layout`, `action`, `field`, `list`, `table`, `image`, `icon`, `graphic`, `media`,
`page`, `element`) and `facts` measured at the moment of the click — box size, computed
`display` and `gap`, font size and colour, word count, a missing `alt`. `intents` are
the chips you picked, in plain words. Between them, an agent knows what the thing is
and what register of change you are asking for, not just where you clicked.

## Using it

**In the page**

| | |
|---|---|
| `A` | arm annotate mode |
| click | drop a pin on that element |
| `Cmd`/`Ctrl` + `Enter` | save |
| `Esc` | cancel |
| chips | pick the change: `tone: warmer`, `side by side`, `tap target too small` |
| breadcrumb | the click landed on the wrong node — walk up the tree |
| list icon | every note on this page, with the count on the icon; the bin deletes a row |
| **send to agent** | at the top of the list — hands the whole batch over |
| click a pin | read that note back, then edit it or send it on its own |

**On the command line**

```
--root <dir>      directory to serve            (default: cwd)
--port <n>        port, 0 picks a free one      (default: 8765)
--store <file>    annotations file              (default: <root>/annotations.json)
--index <file>    directory index               (default: index.html)
--ignore <a,b>    runtime-only classes to keep out of selectors
--wait            block until the next batch, print it, exit (for an agent
                  already in a conversation with you)
--agent           send-to-agent starts a fresh headless Claude Code
--on-handoff <c>  run your own command instead of --agent
--quiet           no logging
```

`--ignore` is worth setting if your app adds classes at runtime. Given
`--ignore rules,faint`, a pin records `section.mo > h3` instead of
`section.mo > h3.rules.faint`, which is both more readable and more stable.

## Starting the agent

Notes are worth acting on once you say they are, so the list has a **send to agent**
button, and each note has one of its own. Sending marks those notes `"status":
"ready"` — a note you are still typing is never in that set.

**If an agent is already in a conversation with you** — a Claude Code session you are
working in — it should block on this in the background:

```bash
npx agent-annotate --wait --root .
```

That serves nothing. It waits until you press the button, prints the batch, and exits,
which is what puts the notes in front of the agent you are already talking to. It has
your context, you can see it work, and you can argue with it. This is the path worth
using.

**If nobody is watching**, `--agent` starts a fresh headless Claude Code per batch
instead:

```bash
npx agent-annotate --root . --agent
```

It gets the batch, the store and every measured fact in its prompt, edits the project
it is serving, and resolves what it finished. Whatever it says comes back to a panel
on the page and to `annotations-agent.log`. The trade is that it starts cold every
time.

### Triage

A batch is rarely a straight list. Notes written in one pass tend to pile onto the
same few elements, and doing them in the order they were typed causes rework — you
restyle a container, then the next note moves it. So the agent groups the batch,
works out what has to land first, and names any notes that genuinely conflict, before
touching a file.

Then it says what it is going to do and does it, resolving the notes it finished.
Where a note is ambiguous, where two notes conflict, or where it thinks the change is
wrong, it does the unambiguous part and comes back with the question rather than
guessing — a pin often lands on a wrapper when you meant something inside it.

Whatever it prints comes straight back to the page, in a panel that streams while it
works, and is kept in `annotations-agent.log` next to the store.

If you would rather run something else — your own script, a different agent, a
webhook — `--on-handoff <cmd>` replaces `--agent` entirely. It runs with
`ANNOTATE_IDS` (the batch) and `ANNOTATE_STORE` (the file) in its environment, and
whatever it prints is shown on the page the same way. This is the only thing the server ever executes, which is why it has
to be passed explicitly on the command line — there is no config file that can set it,
and nothing on the page can change it.

## Working through notes

Read `annotations.json`, make the changes, then mark them done:

```bash
curl -s -X POST localhost:8765/__annotations/resolve \
  -H 'Content-Type: application/json' -d '{"ids":["amsyvcaio2ij"]}'
```

Omit `ids` to resolve everything open. Resolved notes move to
`annotations-resolved.json` with a timestamp, so the live queue stays short and you
keep the history.

Add both to `.gitignore` — they're local working state, not site content:

```
annotations.json
annotations-resolved.json
```

## With Claude Code

This package doubles as a Claude Code plugin. Installed, it teaches the agent to start
the server, read your notes, act on them, and resolve only what it actually finished:

```
/plugin install agent-annotate
```

Or point Claude Code at a local checkout of this repo — the skill lives in
`skills/agent-annotate/`. Once installed, `/agent-annotate` starts the server, tells
you the URL, and leaves `--wait` running in the background so the notes you send land
in the conversation you are already having.

## API

```js
const { createServer } = require('agent-annotate');
const server = createServer({ root: './site', ignoreClasses: ['rules'] });
server.listen(8765);
```

| Route | |
|---|---|
| `GET /__annotations` | every note in the queue |
| `POST /__annotations` | add one (`text` required) |
| `PATCH /__annotations?id=` | edit one's text |
| `DELETE /__annotations?id=` | drop one |
| `POST /__annotations/handoff` | `{ids:[…]}` → mark `ready`, start the agent |
| `GET /__annotations/handoff` | is a run in flight, and how the last one went |
| `POST /__annotations/resolve` | `{ids:[…]}`, or all when omitted |
| `GET /__annotate/client.js` | the toolbar |

## Notes

- The toolbar is a glass bar in the bottom-right corner, drawn in icons rather than
  words. Arming it gives you a hover inspector — the element under the cursor outlines
  with its size, and the popup carries a breadcrumb so a click that lands on the wrong
  node can be walked up.
- It follows `data-theme` on `<html>` when your page sets one, and the OS otherwise.
- The refraction uses `backdrop-filter: url(…)`, which only Chromium honours; other
  browsers get plain frosted glass.
- Pins are anchored by page coordinate. If the page gets shorter, a pin that no longer
  fits is greyed as `stale` — the position drifted, but its `target` is still good.
- Intended for local development only. It is a dev server: it has no auth, and it
  writes files in the directory you point it at.

MIT
