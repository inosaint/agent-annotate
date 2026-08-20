# agent-annotate

The missing component for your agentic engineering workflow while working with Claude terminal app and developing HTML pages. (if you are building react apps, check out [Agentation](agentation.com))

<img width="652" height="449" alt="Screenshot 2026-08-20 at 8 48 24 AM" src="https://github.com/user-attachments/assets/8015e109-ae3c-4580-b059-3d1be582a8f4" />

Describing *which* thing you mean is the slow part of design iteration. The current meta is referring to it and taking screenshots to be specific. Codex and Claude desktop apps have a built-in annotator to help you debug, but for the terminal, I don't see a similar solution so I asked Claude to create one for me.

## How this works

Once you install the plugin(and reload), you can call it by `/agent-annotate:annotate` in your Claude Code terminal app.

This wil start a local server and hosts your simple HTML and provides the URL. It also leaves `--wait`
running in the background, so the notes you send land in the conversation you are
already having rather than in a log. 


## How to use

At the bottom right of the page, you will notice a tiny toolbar which you can use to annotate the page.

Click any element on your local site, say what should change, and your coding agent
reads the note — with the element it points at, what kind of element it is, the page,
the viewport and the theme attached.

Once done, you can click 'send to agent' or the 'send' icon at the annotation level to get Claude working on your annotations.

Note: Text below this is written by Claude.

## Using it

**In the page**

| | |
|---|---|
| `A` | arm the picker |
| `S` | capture a region — drag over the part you mean |
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
button, and each note has one of its own. Sending marks those notes `"status":
"ready"` — a note you are still typing is never in that set.


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

Installed, `/agent-annotate` starts the server, tells you the URL, and leaves `--wait`
running in the background, so the notes you send land in the conversation you are
already having rather than in a log. The plugin carries the server with it — the skill
runs `$CLAUDE_PLUGIN_ROOT/bin/agent-annotate.js`, so there is nothing to install from
npm.

The skill lives in `skills/annotate/`, and is invoked as `/agent-annotate:annotate`.
It is what teaches an agent to triage a batch, act on it, and resolve only what it
actually finished.

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
