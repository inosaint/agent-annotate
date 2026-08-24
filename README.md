# agent-annotate

The missing component for your agentic engineering workflow while working with the Claude terminal app and developing HTML pages. (If you are building React apps, check out [Agentation](https://agentation.com).)

Describing *which* thing you mean is the slow part of design iteration. The current meta is referring to it and taking screenshots to be specific. Codex and Claude desktop apps have a built-in annotator to help you debug, but for the terminal I don't see a similar solution — so I asked Claude to create one for me.

## How this works

Install the plugin, reload, and call it with `/agent-annotate:annotate` in your Claude Code terminal app.

That starts a local server, hosts your HTML, and gives you the URL. It also leaves `--wait` running in the background, so the notes you send land in the conversation you are already having rather than in a log.

## How to use

At the bottom right of the page you will find a small toolbar.

<img width="173" alt="The toolbar: camera, notes and annotate icons" src="https://github.com/user-attachments/assets/25b23573-db07-435c-8cd5-62ac8daff128" />

1. **With the annotate tool** — click the annotate icon (or press <kbd>A</kbd>), then click any element on your page and say what should change. The note carries the element it points at, what kind of element it is, the page, the viewport and the theme.

   <img width="652" alt="Annotating an element: the picker popup with tone and length controls" src="https://github.com/user-attachments/assets/8015e109-ae3c-4580-b059-3d1be582a8f4" />

2. **With the camera tool** — click the camera icon (or press <kbd>S</kbd>) and drag over the part of the page you mean. You may need to grant screen-share permission the first time. Once captured, add whatever you want to say about it.

   <img width="652" alt="Reviewing a captured region before adding a note" src="https://github.com/user-attachments/assets/3b6cfd12-7e5d-4538-abf0-e9a714f25ad1" />

When you are done, press **send to agent** in the notes list — or the send icon on a single note — and Claude starts working on them.

---

Note: Text below this is written by Claude.

## Using it

**In the page**

| | |
|---|---|
| `A` | arm the picker — or, with text highlighted, annotate that text straight away |
| `S` | capture a region — drag over the part you mean |
| click | drop a pin on that element |
| `Cmd`/`Ctrl` + `Enter` | save |
| `Esc` | cancel |
| chips | pick the change: `tone: warmer`, `side by side`, `tap target too small` |
| breadcrumb | the click landed on the wrong node — walk up the tree |
| list icon | every note on this page, with the count on the icon; the bin deletes a row |
| **send to agent** | at the top of the list — hands the whole batch over |
| click a pin | read that note back, then edit it or send it on its own |
| grip | drag the dots at the right of the toolbar to move it out of your way |

Keys typed into the toolbar stay in the toolbar: a page that binds space or the arrow
keys — a slide deck, an editor — never sees them, so you can type a note on top of one
without driving it. Clicking anywhere outside the notes list closes the list.

**On the command line**

```
--root <dir>      directory to serve            (default: cwd)
--port <n>        port, 0 picks a free one      (default: 8765)
--host <addr>     interface to bind        (default: 127.0.0.1, loopback only)
--store <file>    annotations file       (default: <root>/.annotate/annotations.json)
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
bar, and a note's own card has a send icon. Sending marks those notes
`"status": "ready"` — a note you are still typing is never in that set.

**If an agent is already in a conversation with you**, it should block on this in the
background — which is what `/agent-annotate:annotate` sets up for you:

```bash
npx agent-annotate --wait --root .
```

That serves nothing. It waits until you press the button, prints the batch, and exits,
which is what puts the notes in front of the agent you are already talking to.

**If nobody is watching**, `--agent` starts a fresh headless Claude Code per batch
instead. It gets the batch, the store and every measured fact in its prompt, edits the
project it is serving, and resolves what it finished. The trade is that it starts cold
every time.


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
works, and is kept in `.annotate/annotations-agent.log`.

If you would rather run something else — your own script, a different agent, a
webhook — `--on-handoff <cmd>` replaces `--agent` entirely. It runs with
`ANNOTATE_IDS` (the batch) and `ANNOTATE_STORE` (the file) in its environment, and
whatever it prints is shown on the page the same way. This is the only thing the server ever executes, which is why it has
to be passed explicitly on the command line — there is no config file that can set it,
and nothing on the page can change it.

## What a note carries

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
  "intents": [{ "id": "tone", "label": "tone: punchier" }],
  "id": "amsyvcaio2ij",
  "created": "2026-08-18T16:20:07.104Z",
  "status": "open"
}
```

`target` and `x`/`y` are what make a note actionable — an agent can find the element
rather than guess at your prose. `context` is that element read off the live page: its
`kind` (one of `heading`, `text`, `layout`, `action`, `field`, `list`, `table`, `image`,
`icon`, `graphic`, `media`, `page`, `element`) and `facts` measured at the moment you
clicked — box size, computed `display` and `gap`, font size and colour, word count, a
missing `alt`. `intents` are the chips you picked, in plain words.

When a note was written from highlighted text, it also carries `"selection": { "text":
"…" }` — the exact words you had selected, kept whole beside what you typed, so the
agent can find that string in the source rather than infer it. The quote is dropped
into the note box too, for you to write around.

A capture is the other shape of note: `"shot": "shots/<id>.png"`, whatever you typed,
and nothing else. It is not about an element, so it carries no `target` or `context` —
the agent reads the image and works out what it is about from there.

## Working through notes

Read `.annotate/annotations.json`, make the changes, then mark them done:

```bash
curl -s -X POST localhost:8765/__annotations/resolve \
  -H 'Content-Type: application/json' -d '{"ids":["amsyvcaio2ij"]}'
```

Omit `ids` to resolve everything open. Resolved notes move to
`annotations-resolved.json` with a timestamp, so the live queue stays short and you
keep the history.

Nothing to add to your `.gitignore`. Everything this writes lives in one folder that
ignores itself:

```
.annotate/
  .gitignore                  *
  annotations.json            the queue
  annotations-resolved.json   what has been dealt with
  annotations-agent.log       what the agent said, run by run
  shots/                      captured regions
```

Cleaning up is deleting that directory. A project that already has an
`annotations.json` at its root — from an earlier version — keeps using it.

## With Claude Code

This package doubles as a Claude Code plugin, and the repo is its own marketplace:

```
/plugin marketplace add inosaint/agent-annotate
/plugin install agent-annotate@agent-annotate
```

Working on it locally instead:

```bash
claude plugin marketplace add ./
claude plugin install agent-annotate@agent-annotate
```

Installed, `/agent-annotate:annotate` starts the server, tells you the URL, and leaves `--wait`
running in the background, so the notes you send land in the conversation you are
already having rather than in a log. The plugin carries the server with it — the skill
runs `$CLAUDE_PLUGIN_ROOT/bin/agent-annotate.js`, so there is nothing to install from
npm.

The skill lives in `skills/annotate/`, and is invoked as `/agent-annotate:annotate`.
It is what teaches an agent to triage a batch, act on it, and resolve only what it
actually finished.

## What it exposes

It is a dev server, so it is worth being precise about what it will and will not do:

- **Loopback only.** It binds `127.0.0.1`, so nothing on your network can reach it.
  `--host 0.0.0.0` opts out and prints a warning; only do that on a network you trust.
- **No CORS.** The toolbar is served by this server and talks to it same-origin. A
  request carrying another origin is refused — otherwise any page you happened to have
  open could read your notes, or POST a handoff that starts an agent with edit rights
  on your project.
- **Requests arriving under another hostname are refused**, which is what stops a
  hostile name resolved to `127.0.0.1` from talking to it.
- **Dotted paths are not served** — `.git`, `.env`, `.npmrc` and the like stay private,
  even though the server is pointed at your project root. Its own `.annotate/` folder
  is the exception, so captures can be shown back to you.
- **It runs nothing unless you ask.** `--agent` and `--on-handoff` are the only things
  that execute anything, both are command-line flags, and neither can be set by the
  page or by a note.

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
| `POST /__annotations/shot?id=` | PNG body → save it beside the note |
| `POST /__annotations/handoff` | `{ids:[…]}` → mark `ready`, start the agent |
| `GET /__annotations/handoff` | is a run in flight, and how the last one went |
| `POST /__annotations/resolve` | `{ids:[…]}`, or all when omitted |
| `GET /__annotate/client.js` | the toolbar |

MIT
