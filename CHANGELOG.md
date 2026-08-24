# Changelog

All notable changes to `agent-annotate`. This project follows [semantic
versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] — 2026-08-24

### Added

- **`npx agent-annotate install` installs the Claude Code plugin.** Getting the
  `/agent-annotate:annotate` skill onto a new machine previously meant knowing the two
  `claude plugin` incantations; the npm package now does it. Because npx unpacks into a
  temp cache that is garbage-collected, the plugin is staged at
  `~/.agent-annotate/marketplace` first and *that* path is registered — so the plugin
  and the npm package are the same files, and a marketplace cannot go stale under you.
  `--root` stages elsewhere, `--dry-run` prints what it would do, `--no-claude` stages
  and leaves the two commands for you to run. It refuses to write over a directory it
  cannot see it staged itself.

### Documentation

- **An install section, and an FAQ.** The README never actually said how to install
  either half. It now carries both routes and says plainly which is which, plus the
  answer to the first thing anyone hits: this serves files, so it cannot sit in front of
  `astro dev` — build and serve the output, and use `--wait` rather than `--agent` when
  you do, since the agent runs with its working directory set to the root it serves.

## [0.1.1] — 2026-08-24

### Added

- **Highlight text, then press `A`.** With a selection on the page, arming the picker
  skips the click: the element holding the selection becomes the target, the words are
  quoted into the note box to write around, and the exact string is kept on the note as
  `selection.text` (capped at 2000 characters) so the agent can find it in the source
  rather than infer it. Clicking the toolbar no longer collapses the selection first.
- **The toolbar can be moved.** A grip sits at the right of the bar; drag it anywhere.
  The spot is remembered per page and clamped back into view when the window resizes.
  The notes list follows the bar rather than the corner.

### Fixed

- **A page with its own key handling no longer steals keys from the toolbar.** Keys
  typed into a note stop at the toolbar's own root, so a slide deck bound to space or
  the arrow keys never sees them — space types a space. The same holds while a region
  is being dragged. Nothing about the page has to be detected for this.
- **The notes list closes when you click outside it**, and on `Esc`, instead of staying
  open over the page you are trying to look at.
- **The toolbar no longer depends on its ids being unique in the page.** Everything of ours
  is found inside our own element, so a host page carrying its own `#anTog` or `#anList`
  cannot capture our handlers — which is exactly what happened on a page still loading the
  one-off script this package grew out of.

## [0.1.0] — 2026-08-20

First published release: injected toolbar, element context and intents, region
capture, the notes list and handoff, `--agent` and `--on-handoff`, `--wait`, and the
Claude Code skill and plugin manifest.
