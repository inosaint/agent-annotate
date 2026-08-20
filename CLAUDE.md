# agent-annotate — notes for the next session

Extracted on 2026-08-19 from a personal site repo (`Documents/GitHub/ai`), where it
had been a one-off `annotate.js` + `dev-server.js` pair. It is now a standalone
package intended for npm. Nothing here depends on that original project any more.

The working tree is the `inosaint/agent-annotate` repo. That repo had been cloned
*into* a subfolder before the code existed; on 2026-08-20 its `.git` was moved up to
the project root and the one-line stub README it carried was dropped in favour of
this project's own (the stub is still in the initial commit). **The working directory
on disk is still named `annotate-loop`** — only the package was renamed.

## Unfinished before publishing

- [x] The package was renamed from `annotate-loop` to **`agent-annotate`** on
      2026-08-20 to match the GitHub repo. Both names 404 on the npm registry, so
      either was free; the repo name won. The name still lives in three places —
      `package.json` (`name` and `bin`), `.claude-plugin/plugin.json`, and the `npx`
      lines in the README and the skill — plus `bin/agent-annotate.js` and
      `skills/annotate/` on disk (the skill is deliberately *not* called
      `agent-annotate` — see below).
- [x] `repository`, `homepage`, `bugs` and `author` are in `package.json`.
- [ ] `LICENSE` is MIT in the name of Kenneth Mark Dsouza. Confirm that's wanted.
- [ ] `npm publish --dry-run` for a final look.

## Known verification gap

`npm test` runs `test/context.js` (the element-context table, headless, with a fake
element) then `test/smoke.js` (the server end to end — injection, store, resolve, the
path-escape guard, and a note carrying `context`/`intents`). Both pass.

**The toolbar UI in `client/annotate.js` still has never been click-tested.** The
browser extension was disconnected during the original port and was disconnected
again on 2026-08-19 when the contextual controls and the glass restyle went in — so
no pin has ever been dropped, saved, or deleted through the real UI, and the popup's
chips, dropdowns and the read-back card are unexercised.

To check: `npx . --root <any static dir>`, open the page, press **A**, hover (the
element under the cursor should outline with a size label), click a paragraph (expect
tone/length controls), walk the breadcrumb up a level, pick a chip, save, and confirm
`context` and `intents` land in `annotations.json`. Then from the list: edit a note,
send one, send all. Also click a saved pin — it opens a card, not an `alert`.

The glass depends on `backdrop-filter: url(#…)`, which only Chromium honours; the
displacement map is generated per panel on a canvas in `glassMap()`. In Safari and
Firefox the panels fall back to plain frosted blur, which is fine but is *not* what
the design was tuned against.

## Design decisions worth not undoing

**The toolbar is injected, never referenced.** `lib/server.js` inserts one script tag
before `</body>` on HTML responses. This is what lets a project adopt the tool with
zero source changes, and it is why the toolbar can never leak into production. Do not
"simplify" this into asking users to add a script tag.

**Two independent production guards.** The injection is server-side only, *and* the
client returns immediately unless the hostname is `localhost`/`127.0.0.1`. Keep both.

**Nothing may be project-specific.** These were the four things welded to the original
repo, all now parameterised — the same mistakes to avoid re-introducing:

| was | now |
|---|---|
| served `__dirname` | `--root`, defaulting to cwd |
| page name fell back to `index-new.html` | `pageId()`, where `/` and `/index.html` agree |
| selector filter hard-coded `rules\|faint\|gridsvg` | `--ignore`, injected as `window.__ANNOTATE_CONFIG` |
| pages needed a manual `<script>` tag | server-side injection |

**The static handler's path check is security-relevant.** It resolves the path and
requires an exact root match or a real separator boundary. A plain
`startsWith(root)` — which is what the original did — serves `/…/ai-secrets` when
root is `/…/ai`. `test/smoke.js` covers this; keep that test.

**The context table is data, not logic.** `client/context.js` is a `classify()` of
tag → kind and a `CONTROLS` map of kind → chips and dropdowns. Adding a kind or a chip
means editing that table and nothing else; the popup renders whatever it finds.
`describe()` also measures the live element (`facts`) — computed display, gap, font,
word count, missing `alt`. Those facts are the part an agent cannot recover from the
source, so prefer adding facts over adding chips.

**Intents are saved beside the free text, never merged into it.** `text` stays what
the user typed, `intents` is the structured list. The one exception: chips picked with
an empty textarea synthesise `text` from the intent labels, so a note is never stored
without readable text and the server's `text required` check still holds.

**Handoff is the trigger, and it is deliberately a button.** Notes start `open` and
only become `ready` when the user presses *send to agent* in the list. Nothing fires
per-note: a half-written note must never start an agent. `--on-handoff <cmd>` is the
only command this server ever executes, so it is CLI-only by design — no config file
sets it, and nothing the page can POST can change it. The child gets `ANNOTATE_IDS`
and `ANNOTATE_STORE` in its environment and inherits stdio unless `--quiet`.

**Region capture goes through `getDisplayMedia`, and there is no better option.**
A page cannot read its own pixels: rasterising live DOM to a canvas misses iframes,
shadow content, filters and font rendering, and every library that claims otherwise is
approximating. So `client/shot.js` asks the browser to capture the tab and crops the
dragged rectangle out of the frame. The consequences are not bugs: the first capture
raises a picker (the track is kept alive so a run of captures asks once), only the
viewport can be captured, and the toolbar hides itself for the frame. If someone
"fixes" this with a canvas rasteriser, the shots stop matching what the user saw.

**The shot route trusts the note, not the caller.** The id in the query must match a
note already in the store, and the filename is built from that id — so a traversal
attempt is a 404 rather than a write. The body must start with the PNG magic number.
`test/smoke.js` covers both.

**A handoff must never be a silent no-op.** The button's promise is that something
happens, so: batches run one at a time (two agents on the same files is worse than
waiting), the outcome of the last run is readable at `GET /__annotations/handoff`,
a non-zero exit is stamped on the batch's notes as `handoffError` and shouted in the
log, and the toolbar follows the run to its end and reports how it went. If no
`--on-handoff` is configured the toolbar says exactly that instead of implying work
started. `test/smoke.js` covers all three outcomes; keep those tests.

**`--agent` is the product, `--on-handoff` is the escape hatch.** The loop only
closes if pressing the button starts something, so running Claude Code on the batch
is built in (`lib/agent.js`) rather than left as a script each user has to write.
It is spawned as argv, never through a shell, so nothing a note contains can reach a
command line, and it runs with cwd set to the served root.

**There was briefly a `--mode auto|manual` flag. It was removed on 2026-08-20 as
config the tool should not own** — whether an agent may act unattended is a property
of the agent, not of an annotation server. What remains is the behaviour that
mattered: triage a multi-note batch first, then act, and come back with a question
instead of guessing when notes are ambiguous or conflict. Those rules live in
`lib/agent.js` (for `--agent`) and in the skill (for an agent the user runs). Do not
re-add the flag.

**The agent gets no Bash tool.** It edits the project it was pointed at; it does not
need a shell, and not having one keeps a handoff from turning into arbitrary
execution. `test/agent.js` checks this.

**What the agent says comes back to the page.** Its stdout and stderr are captured,
streamed to the toolbar's report panel while it runs, appended to
`annotations-agent.log`, and still echoed to the terminal. A loop that carries
feedback out and drops the reply is not a loop — this was the actual bug behind
"I pressed send and nothing happened".

**Editing reopens the picker, not a textarea.** `edit()` re-finds the element from
the pin's own coordinates (exact) and falls back to the recorded `target` as a
selector, then hands it to `inspect()` with the note, so the chips come back selected
and the user can re-target through the breadcrumb. `editText()` is only for when the
element has genuinely gone from the page. Because the element can change, `PATCH`
accepts `target` and `context` too.

**Dark is three-state.** The stylesheet is built once as `dark(prefix)` and emitted
twice — under `@media (prefers-color-scheme:dark)` scoped to
`html:not([data-theme="light"])`, and again under `html[data-theme="dark"]` — so a
page that themes itself takes the toolbar with it, and one that does not follows the
OS. Keep the base sheet free of `${}` interpolation; the build step asserts on it.

**`POST /__annotations/resolve` exists so resolving is not manual.** It moves notes to
`annotations-resolved.json` with a timestamp. Resolve only notes actually addressed —
that rule is in the skill and is the point of the endpoint, not a nicety.

## Layout

```
bin/agent-annotate.js         CLI, arg parsing only
lib/server.js                 server + programmatic API (createServer)
lib/agent.js                  the built-in --agent handoff: prompt and tool list
client/context.js             what kind of element was clicked, and which controls suit it
client/shot.js                region capture via getDisplayMedia, cropped to the drag
client/annotate.js            the toolbar, served at /__annotate/client.js
skills/annotate/SKILL.md      Claude Code skill — teaches an agent the workflow
.claude-plugin/plugin.json    plugin manifest; the package doubles as a CC plugin
test/context.js               unit test for the context table
test/agent.js                 unit test for the handoff agent's command
test/smoke.js                 server end to end; both run under npm test
```

`/__annotate/client.js` is `context.js`, `shot.js` and `annotate.js` concatenated, in
that order — annotate.js reads `window.__ANNOTATE_CONTEXT` and `window.__ANNOTATE_SHOT`,
and degrades if either is missing. A new client file must be added to the `CLIENT`
array in `lib/server.js`. **Adding one means restarting any running server**: the files
are read per request, but the list of them is built at module load, so a server started
before the file existed silently serves a bundle without it — which looks exactly like
a browser lacking the feature.

Zero runtime dependencies, and it should stay that way. Node >= 18 (the tests use
global `fetch`).

## When changing things

- Any new element kind or control also belongs in `skills/annotate/SKILL.md`'s
  list of `context.kind` values — that list is how an agent knows what it may receive.
- **The skill is `annotate`, not `agent-annotate`.** Claude Code invokes a plugin skill
  as `/<plugin>:<skill>`, so matching names read as `/agent-annotate:agent-annotate`,
  and a description opening with the product name says it a third time. Keep the skill
  name distinct from the plugin name, and keep the product name out of the first line
  of its description.
- The version lives in **four** places: `package.json`, `.claude-plugin/plugin.json`,
  `.claude-plugin/marketplace.json` (twice — `metadata` and the plugin entry), and any
  README example. Keep them in step.
- The repo is its own plugin marketplace. After touching either manifest, run
  `claude plugin validate .` — it is clean apart from one warning about `CLAUDE.md` not
  being loaded as plugin context, which is expected: this file is notes for the next
  session working *on* the repo, not context to ship to users of the plugin.
- The plugin ships the server, so the skill must reach for
  `$CLAUDE_PLUGIN_ROOT/bin/agent-annotate.js` before `npx` — a plugin that only works
  once the npm package is published is not deliverable.
- Everything written lives in `<root>/.annotate/` — queue, resolved log, agent log,
  shots — and that folder writes its own `.gitignore` containing `*` the first time a
  note is saved. **Never touch the user's `.gitignore`**: a tool that edits a file the
  project tracks to keep its own droppings out of git has the relationship backwards.
  Nothing is written until there is something to write. A root `annotations.json` from
  before this layout keeps being used, so an in-flight project does not lose its queue.
- The toolbar gets `shotBase` in its config — the URL path the shots are served from,
  or `''` when `--store` puts them outside the served root, in which case thumbnails
  degrade and the agent still reads the files off disk.
- `package.json`'s `files` array gates the tarball. A new top-level directory needs
  adding there or it will not publish. Check with `npm pack --dry-run`.
- Editing the workflow (routes, flags, the resolve rule) means editing
  `skills/annotate/SKILL.md` too — that file is how an agent learns this tool,
  and a stale skill is worse than none.
