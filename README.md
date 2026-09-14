# Markdown Insight Dashboard

An AI-assisted dashboard that reads a Markdown document, presents it as a
navigable set of colored cards, lets you capture notes and Claude-generated
suggestions against any section, and writes everything back into a single
Markdown file on request.

`doc_flowchart.html` is the earlier flowchart-style prototype and is kept
as-is for reference; it is not part of the dashboard described below.

## Running it

No build step. Serve the folder statically (opening `index.html` directly
via `file://` will break `fetch()`-based sample loading and AI calls):

```bash
python3 -m http.server 8000
# open http://localhost:8000/index.html
```

Or run it in Docker (nginx serving the same static files — no build step
there either):

```bash
./run.sh                    # starts the container if needed, then opens it
                             # in its own window (see below) — the easiest path
# equivalent, by hand:
docker compose up -d        # serves on http://localhost:8080
# or without compose:
docker build -t md-dashboard . && docker run -p 8080:80 md-dashboard
```

**Starting the container is not the same as opening it.** `docker compose
up` / `docker run` only start the web server — nothing about Docker opens a
browser or a window. `./run.sh` does both: it starts the container (skipping
that step if one's already serving), then opens the app in its own
standalone window (Chrome/Edge/Chromium via `--app=`, or a new Firefox
window as a fallback — Firefox has no equivalent chromeless app mode).
Without a script, get the same "own window" effect either by opening the
URL and using the browser's own **Install app** option (it registers a
manifest + service worker, so it can then be launched like any other app),
or manually with e.g. `google-chrome --app=http://localhost:8080/index.html`.

If port 8080 is already taken (commonly: a container from an earlier run is
still up — check with `docker ps`), set `PORT` to use a different one, e.g.
`PORT=8081 ./run.sh` or `PORT=8081 docker compose up -d`.

## Using it

1. Load a document: use **Open .md file** (grants direct save-back on
   Chrome/Edge), drag/drop, or load one of the bundled samples (`sample.md`,
   `sample2.md`, `sample3.md`).
2. Browse the heading tree in the sidebar — collapsed to just the active
   path by default, click the ▸ chevrons to expand others — or open
   **🗺️ Map** for a whole-document diagram, either the indented **🌳 Tree**
   or an Obsidian-style **🧠 Mind map** with draggable nodes; the main panel
   drills into whatever section you pick and shows its own content plus a
   card grid of its subsections. In-document links (e.g. a Table of
   Contents) jump to the right section instead of doing nothing. Drag any
   heading in the sidebar onto another one to relocate it — drop on the
   top/bottom third of a row to place it immediately before/after that
   heading (as a sibling, at that exact spot — including promoting or
   demoting it to/from the top level), or the middle third to nest it
   inside as that heading's last subsection.
3. Click a card's insight icon to open the AI popup: get a Claude summary,
   clarity suggestions, and optionally insert the suggestion straight into
   that section.
4. Use **+ Add note** on a card to jot down as many separate notes as you
   want on that section — each is its own field with its own delete button.
   Paste an image, drag one in, or use the **📎 Image** button to attach it
   (works in notes and while editing section content — it's embedded as a
   `data:` URI, so the section stays portable in one `.md` file). Use
   **✎ Edit content** / the pencil next to the
   title to change the section's actual content and heading text (not just
   an annotation), and **🗑 Delete section** to remove it. A section titled
   something like "Table of Contents" gets a **🔄 Regenerate from
   headings** action that rebuilds its bullet list from the document's
   current structure — and typing that title in the first place drafts
   one immediately, before you even save.
   Every one of these Markdown text fields picks up a few habits from
   editors like VS Code's Markdown All in One: Enter continues a list
   (numbered lists auto-increment; an empty item exits the list instead of
   leaving a stray bullet), Tab/Shift+Tab indents a list line, and
   Ctrl/Cmd+B, +I, +\` wrap the selection in bold/italic/code.
5. Use **+ New section** to write a whole new part of the document: a
   title, heading level, and exactly where it goes — click a heading in the
   tree to drop it inside (as the last subsection), or drag the handle onto
   the tree and hover a row's top/bottom/middle third to place it precisely
   before/after/inside that heading, rather than only "first/last of its
   parent."
6. Click **💾 Save** any time — it writes straight back to the file if it
   was opened with **Open .md file**, otherwise it downloads the current
   Markdown. It's the only save control in the app, and it glows while
   there are unsaved changes. The **Source** panel is read-only, for
   double-checking the generated Markdown or copying it elsewhere.
7. Open **Settings** to provide your Anthropic API key and pick a Claude
   model. The key is stored only in `localStorage` on your machine and is
   sent directly to `api.anthropic.com` — never to any other service.

## Architecture

Plain ES modules, no bundler, so every piece can be opened and debugged in
isolation:

```
index.html          shell: header, sidebar, main panel, side panels
manifest.json, sw.js, icons/   installable app shell (see AI integration
                     section below the data model)
Dockerfile, docker-compose.yml, .dockerignore   nginx-served container
css/                 base, layout, cards, modal, animation styles
js/
  markdown/          parser.js (md -> section tree), serializer.js (tree -> md),
                     render.js (section -> sanitized HTML: tables, code,
                     mermaid, <details>), slug.js (GitHub-compatible heading
                     anchors), toc.js (regenerate a Table of Contents)
  state/store.js      single source of truth + pub/sub
  recovery.js          crash-recovery snapshot in localStorage
  ai/                 client.js (Claude fetch), prompts.js, settings.js
  ui/                 sidebar (drag-and-drop to relocate sections),
                     breadcrumb, card grid (incl. inline title/content
                     editing), insight modal, code viewer, notes panel
                     (multiple independent notes per section), imageAttach.js
                     (paste/drag/button -> data: URI image, used by notes and
                     section-content editing), settings/source panels,
                     add-section modal + tree picker (drag-and-drop
                     placement), dragDrop.js (shared before/inside/after zone
                     detection), map view (tree diagram + mindMap.js's
                     force-directed graph), markdownEditing (list
                     continuation / indent / bold-italic-code shortcuts,
                     attached to every raw-Markdown textarea), toast
  utils/              dom (incl. an SVG-element helper)/debounce/id/color
  main.js             wires everything together; also the beforeunload
                     guard, crash-recovery prompt, and service-worker
                     registration
test/parser.selftest.html   in-browser assertions for parse/serialize round-trip
```

### Data model

Each heading becomes a node: `{ id, level, title, bodyMarkdown, children[] }`.
`bodyMarkdown` is the section's own raw Markdown (everything after the
heading up to its first child heading) — kept verbatim, so re-serializing an
untouched document reproduces its structure and content faithfully (blank
lines between blocks are normalized to one, but nothing is reworded, reordered,
or lost). Notes and AI insertions are appended into `bodyMarkdown` between
`<!-- dashboard:note:... -->` / `<!-- dashboard:ai-insert:... -->` marker
comments, so reloading a previously-saved file re-hydrates them into the
right UI slot instead of duplicating them.

### AI integration

Calls go straight from the browser to `https://api.anthropic.com/v1/messages`
with the `anthropic-dangerous-direct-browser-access: true` header. There is
no backend/proxy. Only Claude is supported for now; the settings panel is
structured so another provider could be added later without touching the
rest of the app.

## Known limitations

- The Claude calls were verified with a mocked API response (success, a
  401, and a missing-key case) — not against the real Anthropic API, since
  doing so would require a real key. The request shape follows Anthropic's
  documented direct-browser-access contract; if it turns out to need
  adjusting, `js/ai/client.js` is the only place that matters.
- The File System Access "save back to the original file" path
  (`js/fileIO.js`, used from the Source panel) was verified with a mocked
  file handle (confirms it requests `readwrite` permission and writes the
  correct content) rather than a real native file-picker dialog, which
  headless testing can't drive. The download fallback path was verified
  directly and works.
- Sample-file loading and the self-test's round-trip checks require the
  project to be served over HTTP (see *Running it*) — they silently no-op
  under `file://` because `fetch()` can't read local files that way.
- The document map (🗺️) lays every heading out in one screen with its own
  scroll region, sized for the typical case; a document with hundreds of
  headings will still need to scroll within that region to see all of it.

## Progress log

- **Stage 0** — Repo initialized, existing assets (`doc_flowchart.html`,
  `sample.md`, `sample2.md`) committed as-is.
- **Stage 1** — Markdown core: heading-tree parser, serializer, note/AI-insert
  marker storage, sanitized renderer, and the pub/sub state store.
- **Stage 2** — AI layer: Claude client, prompt templates, localStorage-only
  settings (no backend involved anywhere).
- **Stage 3** — Full dashboard UI: shell, sidebar/breadcrumb drill-down,
  colored card grid, code viewer popup, AI insight popup, settings/source
  side panels, page/panel transitions.
- **Stage 4** — Added `sample3.md` (tables, mermaid, `<details>`, multi-language
  code) and `test/parser.selftest.html`, an in-browser assertion suite for the
  parser/serializer/markers/analyze modules.
- **Stage 5** — Real verification pass: this sandbox has no Node.js or browser
  by default, so a throwaway headless Chromium (via Playwright, downloaded
  just for this session) was used to actually load the app and click through
  it — sample loading, drill-down navigation, notes, the code viewer, mermaid
  rendering, tables, collapsible sections, the AI insight popup (mocked
  responses, including error paths), and a 390px mobile viewport. This found
  and fixed four real bugs: a dead CDN version pin for markdown-it, an
  `#empty-state` that stayed visible behind loaded documents because a CSS
  rule beat the `hidden` attribute, a fence-counting bug in the card badge
  logic, and a header/sidebar that broke on narrow screens. See the
  corresponding commits for details.
- **Stage 6** — User-reported fixes: a full re-render on every store update
  (including the debounced note autosave) was replacing the notes
  `<textarea>` out from under an in-progress edit, dropping focus and
  silently discarding keystrokes typed right after — fixed by skipping the
  rebuild while a field inside the card grid has focus. The ☰ sidebar
  toggle only worked below the mobile breakpoint; it now collapses the
  sidebar at any width. The sidebar tree is now collapsible at every level
  (defaulting to just the active path expanded, not the whole outline) with
  colored pills, icons, and descendant counts on top-level sections.
- **Stage 7** — More user-reported fixes plus two new features: in-document
  anchor links (Tables of Contents, cross-references) now navigate instead
  of doing nothing — `markdown/slug.js` reproduces GitHub's own
  heading-anchor algorithm to match `#some-heading` links to the right
  section — and saving back to a file opened via "Open .md file" now
  actually works (it was missing the `readwrite` permission request that
  `showOpenFilePicker` requires before a write is allowed). Added
  **+ New section**, for writing whole new document content anywhere in the
  tree rather than only annotating existing sections, and **🗺️ Map**, a
  one-screen diagram of the entire document's heading structure.
- **Stage 8** — More user-reported work: sections can now be edited in
  place (title, content) and deleted, not just annotated or created fresh;
  a "Regenerate from headings" action keeps a Table of Contents section in
  sync with the document's actual structure; the "+ New section" parent
  dropdown was replaced with a sunburst diagram of the whole document to
  click a location on, rather than read down a list; and saving was
  collapsed into one obvious "💾 Save" button that always does the right
  thing, replacing a Source panel whose available buttons quietly changed
  depending on how the file was opened. Title editing hit the same
  focus/re-render interaction the earlier notes fix addressed — routing
  Enter/Escape through `blur()` fixed it, verified the edit now actually
  reaches the sidebar and breadcrumb, not just the underlying data.

Two things came from this round that are pure UI-verification catches, not
user reports: `mapView.js` had `dominantBaseline` (camelCase) where SVG
needs the hyphenated `dominant-baseline` attribute name to take effect, and
a Playwright default click (bounding-box center) failed on a legitimately
thin, near-full-circle wedge — a forced coordinate click confirmed the
picker itself worked correctly; it was a test-tooling quirk, not an app bug.
- **Stage 9** — Direct follow-up: the sunburst from Stage 8 was replaced
  with `js/ui/treePicker.js`, a collapsible heading tree — same interaction
  model as the sidebar (expand only the active path by default, click a
  chevron for more) — after hands-on use showed a tree reads better than a
  radial chart for picking a location in a document.
- **Stage 10** — Brought some of VS Code's Markdown All in One habits into
  every raw-Markdown textarea (notes, in-place content editing, new-section
  content) via `js/ui/markdownEditing.js`: Enter continues a bullet/
  numbered/task list (an empty item exits cleanly instead of leaving a
  stray marker), Tab/Shift+Tab indents a list line without trapping
  keyboard focus on plain text, and Ctrl/Cmd+B/I/`` ` `` wrap the selection.
  Typing a title like "Table of Contents" (in "+ New section", or renaming
  an empty section) now drafts one from the current headings immediately,
  reusing the generator behind "Regenerate from headings" — guarded to
  only fire while the content field is still empty.
- **Stage 11** — Reported bug: adding a "Table of Contents" section landed
  after the very last section at that heading level instead of right under
  the document's main headline, because "+ New section" could only place
  new content as first/last child of a chosen parent. Replaced that with a
  precise drop target (before/after a specific sibling, or inside a
  heading as its first/last child) — `resolveDropTarget()` in
  `state/store.js` — chosen by dragging a "New section" handle onto the
  tree picker and hovering the top/bottom/middle third of a heading's row,
  per the requested drag-and-drop interaction (click-to-select still works
  as the quick default). The same before/inside/after mechanism
  (`js/ui/dragDrop.js`) was then extended to the sidebar itself, so
  existing sections can be dragged to relocate them — reordered, re-parented,
  or promoted/demoted to/from the top level — via the new `moveSection()`,
  which re-levels a moved subtree to fit its new depth and rejects moving a
  node into itself or its own subsection.
- **Stage 12** — Added a second view inside 🗺️ Map: an Obsidian-style
  "🧠 Mind map" (`js/ui/mindMap.js`) alongside the existing "🌳 Tree"
  diagram — a small from-scratch force-directed layout (repulsion between
  every node pair, spring edges, a weak center pull, run to a settled state
  before rendering) with freely draggable nodes, so a cluttered cluster can
  be pulled apart by hand the way Obsidian's own graph view works.
- **Stage 13** — A section's notes became a *list*: "+ Add note" adds an
  independent note (own textarea, own delete button) instead of the one
  shared field from before. `markdown/markers.js`'s marker format moved
  from a single `dashboard:note:start/end` pair to one numbered pair per
  note, reading a pre-multi-note save back as one legacy note so nothing
  gets silently dropped. Building "+ Add note" surfaced a real bug before
  it shipped: `joinBody()` dropped any note with empty text, which meant a
  freshly-added (necessarily empty) note serialized right back out to
  nothing — fixed by always writing every note regardless of emptiness,
  since deletion is now its own explicit action. Also added image
  attachment — paste, drag, or a "📎 Image" button, read as a `data:` URI
  Markdown image — at the note level and (a follow-up commit) while
  editing or authoring section content; insertion is block-aware (pads
  with a blank line) after testing showed a naive cursor-position insert
  could glue an image onto the end of, say, a table row and corrupt it.
- **Stage 14** — A minimalist visual pass, CSS only: no behavior change,
  every button/card/panel stayed exactly where it was. Removed the
  gradient panel headers, the pill-shaped buttons (plain rounded rects
  now), the hover lift+shadow, and the pulsing dirty-indicator/glowing
  Save animations; cards' thick colored top band became a slim left
  accent stripe. Verified the app looks and behaves identically
  feature-for-feature afterward.
- **Stage 15** — Three "feels like a real app" pieces: `manifest.json` +
  `icons/icon.svg` + `sw.js` make the dashboard installable (a supporting
  browser can offer to open it in its own standalone window); a
  `beforeunload` handler blocks closing while there are unsaved changes;
  and `js/recovery.js` keeps a debounced localStorage snapshot of the
  Markdown while the document is dirty, offering to restore it (loaded
  back in as still-unsaved) on the next load if the app never closed
  cleanly. Verified end-to-end: editing a note leaves a snapshot,
  reloading prompts to restore it (and separately confirms the
  beforeunload prompt itself fires), and declining instead discards the
  snapshot; with nothing dirty, reloading prompts for neither.
- **Stage 16** — Added `Dockerfile` / `docker-compose.yml` (nginx serving
  the same static files — no build step here either) for portability.
  Actually built and ran the image rather than just writing it: verified
  every core file (including the manifest and service worker) is served
  correctly, and ran the full self-test suite plus all three sample files
  through headless Chromium pointed at the container — same result as
  serving it directly.
- **Stage 17** — Two follow-up bug reports after trying Docker. First: the
  container's `HEALTHCHECK` was failing even though the app served
  correctly, because Alpine/musl resolves `localhost` to IPv6 first and
  nginx only binds IPv4 — fixed by pointing the healthcheck at `127.0.0.1`
  instead. Separately, `docker run` on its own never opens a browser
  window (it only starts a server) — added `run.sh`, which waits for the
  container to respond then opens it in a real standalone window (Chrome/
  Edge/Chromium's chromeless `--app=`, falling back to Firefox's
  `--new-window` since that's what the access logs showed the user is
  actually running, then `xdg-open`), and made the port configurable via
  `PORT=`/`docker-compose.yml`'s `${PORT:-8080}` so a "port already
  allocated" collision has an easy way out. Second: switching documents
  (sample-1 to sample-2) while sample-1 had unsaved edits silently
  discarded them instead of asking first — fixed by adding a
  `window.confirm` guard at the top of `loadFromText()`, the single choke
  point all four load paths (open file, drag-drop, recovery restore, and
  loading a sample) funnel through. Testing that fix surfaced a more
  serious latent bug: `parseMarkdown()` reset its node-ID counter on every
  parse, so two separately-loaded documents could mint identical IDs; a
  debounced note autosave from a just-abandoned document, if still pending
  when the user switched files, could then silently mutate an unrelated
  node in the newly loaded one. Fixed by making IDs monotonically
  increase for the whole page session instead of resetting.
- **Stage 18** — Made the 🧠 Mind map continuously alive rather than a
  one-shot layout: it now runs its physics simulation every frame via
  `requestAnimationFrame`, the cursor exerts a gentle repulsive field on
  nearby nodes, and hovering a node dims everything else except its direct
  neighbors (with the connecting edges highlighted). Found and fixed two
  bugs through actual browser testing rather than code review alone: (1)
  uncapped inverse-square repulsion could fling a node from a sane
  position to thousands of pixels off-screen in about a second once the
  cursor lingered nearby — fixed with a per-frame max-speed clamp; (2) the
  hover highlight looked like it wasn't working at all — `classList.toggle`
  calls were confirmed to be firing, but the resulting class never seemed
  to "stick". Root cause: the cursor's own repulsion field pushes whichever
  node is nearest it away, every frame, by design — so a node the user just
  hovered gets shoved back out of a small hover radius almost immediately,
  even holding the mouse perfectly still, well before it could visibly
  register. Fixed by dropping identity-tracking hover in favor of always
  highlighting whichever node is nearest the cursor within a radius sized
  to comfortably contain where a repelled node settles — verified stable
  under a 5-second continuous hover, with correct dim/neighbor-highlight
  counts, and confirmed the highlight still clears on mouse-out and still
  behaves correctly through a drag.
- **Stage 19** — Reported: the mind map still didn't feel dynamic, and a
  large document's graph was cropped by the window instead of fitting in
  it. Both traced back to the same gap — the layout's physics ran in a
  fixed-size space tied to the container's pixel dimensions, so a document
  with a lot of headings needed more room than the window actually had,
  and the previous cursor interaction (a physics repulsion force) was
  subtle enough to barely register as "dynamic". Replaced both: the
  physics now runs in its own world space sized to the node count, and the
  view auto-fits that whole settled layout into the visible window when
  the map opens (scaling down as far as it needs to — verified with a
  126-heading generated test document that not one of the 126 nodes
  rendered outside the container's bounds, versus the old fixed 1:1
  mapping that would have run pixels off-screen). Scroll-to-zoom and
  drag-to-pan the background were added for drilling into a dense cluster,
  plus a "⤢ Fit" button to snap back to the whole-map view. In place of
  the old repulsion force, hovering a node now triggers an Apple
  Watch/Dock-style fisheye: the node under the cursor (and its close
  neighbors, tapering off smoothly) visibly grows and nudges toward the
  pointer, purely as a render-time effect layered on top of the physics
  positions — it can't destabilize the layout the way physically shoving
  nodes away from the cursor could. Verified the magnify effect, wheel
  zoom, background pan, and the fit button all update the expected SVG
  transforms, and re-ran the existing hover/drag/self-test regressions
  (5-second stable hover, dim/edge highlighting, dragging a node) with no
  change in behavior on an ordinary small document.
