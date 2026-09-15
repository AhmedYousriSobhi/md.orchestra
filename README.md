# MD.Orchestra

An AI-assisted dashboard that reads a Markdown document — or a whole directory of them — presents it as a navigable set of colored cards, lets you capture notes and Claude-generated suggestions against any section, and writes everything back into the source Markdown file(s) on request.

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
   `sample3.md`) — or use **📁 Open folder** to load a whole directory of
   them at once (see "Working with a directory" below).
2. Browse the heading tree in the sidebar — collapsed to just the active
   path by default, click the ▸ chevrons to expand others — or open
   **🗺️ Map** for a whole-document diagram, either the indented **🌳 Tree**
   or an Obsidian-style **🧠 Mind map**: a continuously-live force layout
   (not a one-shot diagram) that auto-fits the whole thing into view no
   matter how large the document is, reacts to the cursor with a Dock/Apple
   Watch-style magnify-and-pull effect, and supports scroll-to-zoom,
   drag-to-pan the background, and dragging a node to reposition it. The
   main panel drills into whatever section you pick and shows its own
   content plus a card grid of its subsections. In-document links (e.g. a
   Table of Contents) jump to the right section instead of doing nothing.
   Drag any heading in the sidebar onto another one to relocate it — drop
   on the top/bottom third of a row to place it immediately before/after
   that heading (as a sibling, at that exact spot — including promoting or
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
   an annotation), and **🗑 Delete section** to remove it. Every section has
   its own **↩ Undo**, too (disabled until there's something to undo): it
   steps back one edit at a time through that section's own history —
   content edits, notes, a title rename, an inserted AI suggestion, a
   regenerated ToC — independently of any other section, in case an
   edit turns out to be a mistake. A section titled
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
   was opened with **Open .md file** (or a workspace folder, on a browser
   that grants live handles — see below), otherwise it downloads the
   current Markdown. It's the only save control for the *active* document,
   and it glows while there are unsaved changes. The **Source** panel is
   read-only, for double-checking the generated Markdown or copying it
   elsewhere.

   Only one document is ever open for editing at a time, but you can still
   accumulate unsaved changes in more than one file across a session (e.g.
   edit a workspace file, switch to a sample without saving first, edit
   that too). **📝 Changes**, in the header, lists every one of them — like
   a compact `git status` — with a badge showing how many. Its badge and
   each file's row count individual *sections*, not files — editing two
   different sections of the same file shows as two separate, individually
   clickable chips under that file, each jumping straight to that exact
   section. Clicking anywhere on a row (not just its buttons) or a chip
   switches to it immediately, no confirmation prompt: switching away from
   the file you're currently on doesn't actually discard anything (its
   changes stay tracked right here, in this same list), so there's nothing
   to warn about — that confirm still appears for every path that's
   actually destructive: closing the app with unsaved changes, or loading
   something over a file *without* going through this list. Each file also
   gets **💾 Save** (writes it straight to
   disk without switching away from whatever you're currently doing, if it
   still has a live handle — otherwise downloads it, same as the main Save
   button) and **🗑 Discard**: for another file, drops that pending copy
   for good; for the currently active document — which appears in the
   same list when it's dirty, marked "●" — reverts it back to its last
   saved version instead, since there's a real in-memory edit to throw
   away, not just a cached copy. Saving normally (the main Save button)
   also opens this list automatically afterward if anything *else* still
   has unsaved changes, so a save is never quietly assumed to have
   covered everything.
7. Open **Settings** to provide your Anthropic API key and pick a Claude
   model (the key is stored only in `localStorage` on your machine and is
   sent directly to `api.anthropic.com` — never to any other service), and
   to switch between System/Light/Dark appearance.
8. Toggle **👁 Preview** for a clean, GitHub/PDF-style view of the
   Markdown — a single flowing page (real headings, tables, code,
   mermaid) instead of the card-based editing layout — docked on the
   right so it can stay open alongside the editor rather than blocking
   it like the other side panels. Notes show up too, each styled as its
   own colored sticky note rather than blended into the running text. A
   "This section" / "Whole document" toggle at its top switches between
   just what you're currently looking at (plus its subsections) and the
   entire file, and it updates live as you edit, including mid-keystroke
   in a note or the content editor. Hover any section's content there
   for a **✎** button — it's editable in place: the same plain-Markdown
   editor the card view's own "Edit content" uses, just reachable
   without leaving the preview, and Save writes straight back to that
   exact section of the document (Whole document scope included — you
   can edit any section shown, not only the one you started on).

### Working with a directory

**📁 Open folder** reads every `.md`/`.markdown` file in a directory (and
its subfolders — dotfiles/dotfolders like `.git` are skipped) and adds a
folder/file tree to the sidebar, alongside the current file's own heading
tree. Everything above still works exactly the same on whichever file is
active; nothing about editing, saving, or the unsaved-changes guard needed
to change — clicking a different file in the tree just re-runs the same
"load a document" path a sample or **Open .md file** already uses, so
switching away from unsaved edits still asks for confirmation first.

Whichever one is the *active* context leads the sidebar: with a workspace
file open, the folder tree stays on top; load something outside it (a
sample, or a plain file via **Open .md file**) and the folder tree
collapses to just its name — so it stops visually reading as if it
"contains" a file it has nothing to do with — while that file's own
heading tree takes the lead. A small chevron on the collapsed tree lets
you peek at its contents without switching away from what you're doing,
and switching back to one of its files flips the order back
automatically. The 🔝/📌 pin next to the folder name toggles this off if
you'd rather the folder tree just always stayed put.

A relative Markdown link in one file's content — `[the guide](sub/guide.md)`,
or with an anchor, `[a step](sub/guide.md#some-heading)` — resolves against
the other files in the same folder and switches to that file (and jumps to
the matching heading) instead of doing nothing or trying to navigate the
browser away; a link to something outside the opened folder, or a normal
external URL, is left completely alone. On Chrome/Edge this uses the File
System Access API (`showDirectoryPicker`), which keeps a live handle per
file so **Save** writes straight back to disk for every one of them, the
same guarantee **Open .md file** already gives a single file. Firefox has
no such API, so there `📁 Open folder` falls back to an
`<input webkitdirectory>` — everything else works identically, but without
a live handle **Save** downloads instead (again, exactly like opening a
single file without the File System Access API).

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
                     mermaid, <details>; also resolves a rendered link
                     against an open workspace), slug.js (GitHub-compatible
                     heading anchors), toc.js (regenerate a Table of Contents)
  state/store.js      single active document + pub/sub (fileName, fileHandle,
                     selectedId, dirty, and which workspace file it is, if any)
  state/workspace.js   an opened directory's file registry + folder tree,
                     and relative-link resolution against it
  workspaceIO.js       reads a directory (File System Access on Chrome/Edge,
                     an <input webkitdirectory> fallback elsewhere)
  recovery.js          per-file crash-recovery snapshots in localStorage
  ai/                 client.js (Claude fetch), prompts.js, settings.js
  ui/                 sidebar (drag-and-drop to relocate sections),
                     filesPanel.js (the open workspace's folder/file tree,
                     reordering around whichever file is active),
                     recoveryPanel.js (offered on load) / changesPanel.js
                     (on demand, from the header) — both list recovery.js's
                     per-file snapshots, save/open/discard, breadcrumb, card
                     grid (incl. inline title/content editing), insight
                     modal, code viewer, notes panel
                     (multiple independent notes per section), imageAttach.js
                     (paste/drag/button -> data: URI image, used by notes and
                     section-content editing), settings/source panels,
                     add-section modal + tree picker (drag-and-drop
                     placement), dragDrop.js (shared before/inside/after zone
                     detection), map view (tree diagram + mindMap.js's live,
                     cursor-reactive force-directed graph), markdownEditing
                     (list continuation / indent / bold-italic-code
                     shortcuts, attached to every raw-Markdown textarea), toast
  utils/              dom (incl. an SVG-element helper)/debounce/id/color/theme
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
  `sample.md`) committed as-is.
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
- **Stage 20** — Reported: after the mind-map work landed, "I see
  everything is the same" — reloading showed no change at all. Root
  cause: `sw.js`'s service worker cached same-origin files
  stale-while-revalidate (answer from cache immediately, refresh the
  cache in the background for *next* time), so every code change needed
  one extra invisible reload before it actually showed up — for an
  actively-developed app that's indistinguishable from the change never
  having happened. Switched to network-first (cache only as an offline
  fallback) and bumped `CACHE_NAME` so the already-stale cache gets
  purged. Verified via a fresh service-worker registration that a fetch
  through it serves the current file content, not a cached one.
- **Stage 21** — Added a dark mode option to Settings (System/Light/Dark),
  backed by `js/utils/theme.js` and a small inline script at the top of
  `index.html`'s `<head>` that applies a saved choice before first paint
  (no light-then-dark flash). `base.css` gained a full dark palette under
  both a `prefers-color-scheme` media query and a `data-theme="dark"`
  selector. Caught, via an actual dark-mode screenshot rather than just
  code review, that the sidebar's current-top-level-section background
  used a fixed light pastel per accent color with light text drawn on top
  of it — unreadable in dark mode — and fixed it (and a few other fixed-hex
  spots) to compute from the accent color against the theme's own surface
  instead.
- **Stage 22** — Renamed the project to **MD.Orchestra** ahead of the
  directory-support work below, and wired the project's new GitHub repo
  as the `origin` remote.
- **Stage 23** — Directory-level support: **📁 Open folder** reads every
  Markdown file in a chosen directory (recursively, skipping dotfiles) —
  File System Access (`showDirectoryPicker`) on Chrome/Edge for live
  read/write handles per file, an `<input webkitdirectory>` fallback
  elsewhere (Firefox has no such API) — and adds a folder/file tree
  (`state/workspace.js`, `ui/filesPanel.js`) above the current file's own
  heading tree in the sidebar. Opening a file from that tree funnels
  through the exact same single-document load path every other entry
  point (a sample, "Open .md file", drag-drop) already used, so the
  unsaved-changes confirm guard, crash recovery, and saving all just work
  without having to know a workspace is involved. A relative Markdown link
  in one file's content (`[...](sub/other.md)`, optionally with a
  `#heading` anchor) now resolves against the other files in the same
  folder and switches to it instead of doing nothing.

  Testing this (not just reading the code) surfaced a real, pre-existing
  bug affecting the *original* single-document sidebar too, unrelated to
  directories: clicking a different heading while a note or section title
  was mid-edit could silently swallow the click. Blurring that field
  commits the edit immediately, which re-renders the sidebar/tree — and
  that blur is very often *caused* by the very click on a different
  heading, so the re-render replaces the clicked element mid-click before
  its mouseup/click can land. Fixed by deferring the actual commit
  (`onUpdate`/`updateNode`) to a fresh macrotask via `setTimeout(...,0)`,
  so the click that triggered the blur finishes on the DOM as it stood
  when the user pressed down. Verified end-to-end with a generated
  two-file test directory: folder tree renders correctly (no duplicated
  root-folder entry — an early bug in the `webkitdirectory` fallback,
  where its relative paths include the chosen folder's own name unlike
  the File System Access path), cross-file links (plain and with an
  anchor) navigate correctly, the unsaved-changes guard fires switching
  workspace files, "close this folder" leaves the current document open,
  and clicking a file in the tree right after editing a note (the exact
  scenario that surfaced the blur bug) now works — plus the full existing
  self-test/mind-map/dark-mode regression suite still passes unchanged.
- **Stage 24** — Added a per-section **↩ Undo** button. Rather than a
  separate undo system, it hooks the one place every section edit already
  passes through: `state/store.js`'s `updateNode()` now snapshots a
  node's {bodyMarkdown, title} onto a small per-node stack (capped at 20)
  before applying each change, and `undoNode()` pops the most recent one
  back. Because content edits, notes (add/edit/delete), a title rename,
  removing/inserting an AI suggestion, and regenerating a ToC all already
  funnel through `updateNode`, every one of them is undoable with no
  changes needed at those call sites — only the button itself (disabled
  when a section has no history yet) and the store-level stack. Undo
  history is per-section (unrelated sections never interfere with each
  other) and resets when a different document loads. Verified: a title
  rename followed by a content edit undoes in reverse order (content
  first, then the rename), undoing a just-added note removes it again, a
  subsection's undo is independent of its parent's, and switching
  documents leaves a freshly-loaded section's Undo disabled.
- **Stage 25** — Reported: the crash-recovery cache (Stage 15) only ever
  kept the single most-recently-edited file, silently overwriting that one
  slot — dirtying a second file lost any pending recovery for the first —
  and the restore prompt just trusted its cached copy with no way to tell
  whether the real file had since changed outside the app. Rewrote
  `recovery.js` to keep one snapshot per distinct file (keyed by its
  workspace path, or filename for a standalone file) instead of a single
  shared slot, and added `ui/recoveryPanel.js`: a proper list, shown on
  load whenever any snapshots are pending, with independent Restore/
  Discard per file rather than one blind `window.confirm()` covering
  whatever was cached last. Each snapshot also now records the file's
  content as it was when that editing session began; the panel says
  outright that it can't verify whether a file has changed outside the
  app since (the browser doesn't let a file handle survive a page
  reload), so the honest fix here is transparency — a clear timestamp and
  a content excerpt per file — rather than a false guarantee. Verified:
  dirtying two different sample files leaves two independent snapshots,
  discarding one leaves the other untouched, restoring loads the right
  file with its edits intact, and saving (or freshly loading) a specific
  file only clears its own entry.
- **Stage 26** — Fixed a reported bug: after opening a directory, using
  the Samples menu appeared to do nothing at all — no dialog, no
  switching, no error. Root cause: the unsaved-changes guard (Stage 20)
  relies on `window.confirm()`, and repeated same-page `confirm()`/
  `alert()` calls are a well-known browser footgun — after enough of them
  fire in a short session, some browsers start silently returning `false`
  immediately with no dialog shown at all (a "prevent this page from
  creating additional dialogs" safeguard), which looks exactly like the
  button doing nothing. Added `ui/confirmDialog.js`, a small in-app modal
  that returns a Promise the same way, and replaced every `window.confirm`
  in the app with it (the unsaved-changes guard, deleting a section,
  deleting a note) — a page-owned dialog has no such suppression, and it
  looks consistent with the rest of the app instead of a native browser
  prompt besides.
- **Stage 27** — Added a **👁 Preview** panel: a clean, read-only, single
  flowing page (`js/ui/previewPanel.js`) closer to how the file would
  actually render on GitHub or in a PDF, as an alternative to the app's
  own card-based editing layout. Unlike Settings/Source/Map, it's a
  docked pane (a sibling of the main panel, toggled by class rather than
  an overlay) so it can stay open and visible while still editing, not a
  modal blocking the rest of the app. A "This section"/"Whole document"
  toggle (persisted in localStorage) switches its scope, reusing
  `splitBody()` to render just each section's real content (not the raw
  bodyMarkdown with note/AI-insert markers mixed in) with real
  `<h1>`-`<h6>` tags. It's wired into the same render() pipeline as
  everything else, deliberately *ahead of* the card grid's
  focus-preserving guard — so, unlike the card view, it keeps updating
  live while typing in a note or the content editor, which is rather the
  point of a reference preview pane. Verified: section vs. whole-document
  scope, code blocks' Expand button working from inside the preview,
  live updates while editing, and the full existing regression suite
  (self-tests, mind map, dark mode, undo, recovery, workspace) unaffected.
- **Stage 28** — Notes in the Preview panel now render as actual sticky
  notes rather than plain boxed text: a handful of fixed paper colors
  (yellow/pink/green/blue/…) cycling per note, a slight alternating
  tilt, and a soft drop shadow that flattens on hover. Deliberately fixed
  colors regardless of the current light/dark theme — like the code
  viewer and toasts elsewhere, a real sticky note doesn't switch to a
  dark palette to match its surroundings, and staying visually distinct
  from the themed prose around it is rather the point: an annotation
  layered on the page, not part of the document itself. Verified in both
  themes with several notes at once (each getting a different color/tilt).
- **Stage 29** — Removed `sample2.md` from the project entirely, at the
  user's request — including scrubbing it from every prior commit's
  history (it was only ever added once, in Stage 0, and never modified
  again, so this was a straightforward `git filter-branch` across all 44
  commits rather than a per-commit content edit) and, per a follow-up
  request, permanently purging the backup branch/tag and unreachable
  objects that rewrite had kept around as a safety net. Updated the
  Samples menu and the self-test suite's round-trip check to stop
  referencing the removed file.
- **Stage 30** — Reported: loading a sample while a directory was open
  made the sample's outline appear nested "under" the folder in the
  sidebar, which doesn't reflect reality (the sample isn't part of that
  directory at all). The sidebar's two sections now reorder themselves
  around whichever is actually the active context: the folder tree
  collapses to just its name and moves below when the active document
  isn't one of its own files, letting that file's own heading tree lead
  instead — and switching to a file that *is* part of the open folder
  flips it back automatically. A small chevron lets you peek at the
  collapsed tree without switching away, and a 🔝/📌 pin (persisted)
  toggles the whole behavior off in favor of always leaving the folder
  tree where it is. Verified all four combinations (workspace file
  active/collapsed, peeking, switching back, and the pin disabling
  reordering entirely) plus the existing regression suite.
- **Stage 31** — Asked: what happens to saving when more than one file's
  worth of unsaved changes exists at once (only one document is ever
  live in memory, but a workspace file left dirty and then switched away
  from keeps its pending edits as a crash-recovery snapshot — Stage 25 —
  even once it's no longer the active document)? Added a **📝 Changes**
  button (badge showing the count) that lists every one of them, git-
  status style, reusing that same per-file snapshot tracking rather than
  building a second system to answer "what's unsaved right now": each
  row gets Save (writes straight to disk without switching away, via a
  live handle when one's resolvable — e.g. a still-open workspace file
  — or a download otherwise), Open (switch to it, through the same
  unsaved-changes guard as everywhere else), and Discard; the active
  document appears in the same list when it's dirty, marked "●", with
  just Save. The ordinary Save button now also opens this list
  automatically afterward if anything *else* is still unsaved, so a save
  is never quietly assumed to have covered every pending file. Found
  and fixed a real staleness bug along the way: saving a crash-recovery
  snapshot is a side effect (not a `setState()`), so nothing was
  re-rendering the badge to reflect a just-written snapshot until some
  unrelated state change happened to trigger a render — the badge could
  sit stale for an arbitrary stretch. Fixed by refreshing it directly
  from the same debounced snapshot-save path, and routed every snapshot-
  clearing call through one wrapper so this can't quietly regress at a
  future call site. Verified: two files dirtied independently both show
  up with correct active-marking, Save/Open/Discard each work from the
  list, and the post-save "anything else pending?" panel opens exactly
  when it should.
- **Stage 32** — Reported: "no button is clickable" after a fresh
  container restart and reload — not fixed by restarting the server.
  Isolated it (a fresh Incognito window worked; clearing site data in
  the regular browser fixed it there too) to leftover browser-side state
  for this origin, not a code or serving issue. While the *exact*
  original trigger couldn't be pinned down after the fact, deliberately
  corrupting `recovery.js`'s localStorage entry (a stray non-object item
  in the list — plausible after nearly a month of iterating on that
  feature's shape) reliably reproduced the *symptom* exactly: `.sort()`
  over the snapshot list threw immediately inside the very first
  `render()` call, before this file's own button `addEventListener()`
  calls further down ever got to run — so every button appeared
  permanently dead, from one single bad record.

  Fixed at the source: `recovery.js` now filters out anything that isn't
  a well-formed entry the moment it's read, so one corrupt or
  unrecognized record can never reach any consumer — and, in depth,
  three more layers so this whole *class* of failure is structurally
  harder to reintroduce: `store.js`'s `notify()` now isolates each
  subscriber (one throwing no longer silently skips every other one,
  including for every future update afterward), `render()` itself is a
  never-throwing wrapper around the real rendering logic, and the
  startup crash-recovery check is similarly guarded — all logging
  clearly to the console rather than swallowing anything. Bumped the
  service worker's cache version too, as a proactive flush for anyone
  still on a stale cached copy from before any of this. Verified: a
  deliberately-corrupted recovery list throws zero errors now and the
  app loads and works normally (openable, clickable, a document loads
  fine afterward), and the full regression suite is unaffected.
- **Stage 33** — Fixed: a section titled "Table of Content" (the easy,
  easy-to-leave-uncorrected singular typo) wasn't recognized as a Table
  of Contents section, so it never got the **🔄 Regenerate from
  headings** button or the auto-draft-on-title-entry behavior — only the
  exact phrase "Table of Contents" (or "TOC") qualified. `toc.js`'s
  heuristic now accepts an optional trailing "s", and also recognizes a
  heading titled exactly "Contents" alone (another common convention),
  while still requiring "toc"/"contents" to be the *entire* title rather
  than a substring — so "Stock" or "Package Contents" (an unrelated
  hardware-manual heading) still correctly don't count. Added two
  regression assertions to the self-test suite (now 18/18) covering both
  the accepted spellings and the still-rejected ones.
- **Stage 34** — The Preview panel gained reverse editing: hovering any
  section's content there reveals a **✎** button that swaps it for the
  same plain-Markdown textarea the card view's own "Edit content" uses
  (list continuation, formatting shortcuts, image paste/drag — all of
  `markdownEditing.js`/`imageAttach.js` reused as-is), and Save writes
  straight back to that exact node via `updateNode()` — a real document
  edit, not a preview-only copy of one. Works from Whole document scope
  too: any section shown can be edited in place, not only the one
  the preview happened to open on.

  Found and fixed a real bug while building this: the preview panel now
  has its own editable textarea, and the render guard that protects the
  card view's textareas from being wiped mid-keystroke by an unrelated
  update didn't cover it — so a rebuild triggered by something else
  entirely, while typing in the preview's own edit box, could have
  silently discarded whatever wasn't saved yet. Extended the same
  focus-aware skip-the-rebuild guard to the preview panel. Verified:
  editing and saving from the preview updates both the preview and the
  card view (confirming it's a real document change), Cancel discards
  cleanly, and editing a specific section deep in Whole document scope
  touches only that node — a sibling section's content is left alone.
- **Stage 35** — Found a real, latent data-loss bug while testing the
  notes UI (Stage 36 below): deleting one note on `sample.md` — a file
  with real content accumulated across a long session — deleted *two*.
  `utils/id.js`'s `nextId()` is a bare incrementing counter that never
  resets within a page session, but `parseMarkdown()` calls it once per
  heading — so even a small document burns through the first several
  counter values before the user does anything at all — and ids are
  persisted straight into the file (`<!-- dashboard:note:ID:start -->`).
  A file saved by an earlier, longer session can easily contain a low id
  like "note7" the counter reached ages ago; a freshly reloaded page's
  counter starts back at 0 and reaches that exact same value after only
  a handful of calls, silently colliding with it — and deleting either
  note then filters by id and removes both. Fixed by prefixing each id
  with the current time (to the millisecond, base36): a collision with
  anything saved in a *different* session now requires hitting the exact
  same millisecond, not just the same small integer, while the counter
  still guarantees uniqueness within one session. Verified: reproduced
  the exact failure against `sample.md` first (added a note, deleted it,
  watched an unrelated pre-existing note vanish with it), confirmed a
  fresh document was unaffected (isolating it to the collision, not a
  regression), then confirmed the fix resolves it on `sample.md` too —
  plus the full regression suite, including id-dependent marker tests.
- **Stage 36** — A visual pass on the card's notes area: it used to be
  set apart from a section's actual content by a thin dashed line —
  easy to miss, and not much of a signal that everything below it is an
  annotation *about* the section rather than more of the section itself.
  Notes now sit in a distinctly tinted "drawer" — the same warm note
  color already used for the note-count badge on preview cards and the
  Preview panel's sticky notes, so it reads as one consistent visual
  language for "this is a note" across the whole app rather than a
  one-off — with its own bordered zone, a note-count badge next to the
  "Your notes" heading, a pill-styled "+ Add note" button, and each
  individual note now a clean surface-colored card floating on that
  tinted background instead of blending into it. Checked in both
  light and dark themes.
- **Stage 37** — Two requests for the Changes panel. First, the active
  document's own row only ever offered Save — there was no way to throw
  away its unsaved edits from there, only a cached copy elsewhere could
  be dropped. It now gets a "🗑 Discard changes" button too, which
  reverts it back to `currentBaseline` (the content this editing session
  actually started from — the same value the crash-recovery snapshot
  already tracks) rather than just clearing a safety-net snapshot and
  leaving the in-memory edit untouched; guarded by the same in-app
  confirm dialog as every other discard-style action. Second, every
  other row is now clickable anywhere on it — not only its small "↪
  Open" button — to jump straight to that file, a bigger and more
  obvious target for what's really the row's main action. Verified:
  discarding the active document's changes reverts it and clears its
  badge count, discarding a different file's snapshot is unaffected
  (still just drops the cached copy), and clicking a row's background
  switches files exactly like its Open button already did, guarded by
  the same unsaved-changes confirm.
- **Stage 38** — Reported: jumping to a file from the Changes panel
  landed on whatever section the file opens on by default, not the
  section that was actually edited — for a file you're editing far from
  its start, "jump to it" didn't feel like it jumped anywhere useful.
  Node ids can't be compared directly between the loaded document and
  its snapshot's `baselineMarkdown` (each comes from its own independent
  parse, so the ids are unrelated numbers), but both parses are the same
  document just before and after an edit, so `findFirstChangedNodeId()`
  walks the two trees together by position and returns the first node
  (in reading order) whose own content actually differs — falling back
  to the document's normal default if the shapes diverge too much to
  line up, or nothing differs at all. Shared by both places that load a
  snapshot back in (the on-demand Changes panel and the startup crash-
  recovery panel), so restoring after a crash now also lands you back
  where you actually were. Verified against a section three levels
  deep, edited, switched away from, and reopened via the Changes
  panel's row click — landed exactly on it, with the edit visible.
- **Stage 39** — Two more requests for the Changes panel, both about the
  same underlying gap: it tracked *files*, not the actual edits within
  them. First: "Open" always asked to confirm discarding, every single
  time, even though nothing was actually being discarded — the file
  being left behind stays fully tracked in this very list, so the
  warning was both untrue and constant noise. Second: editing two
  different sections of the same file only ever showed up as "1 file
  changed", with no way to tell there were two distinct edits, let alone
  jump to either specifically.

  Fixed together, since the same underlying work serves both: `markdown/
  diff.js` (new) structurally diffs a document against its own baseline
  and returns every individually-changed *section*, not just whether the
  file as a whole differs. Each file's row now lists its own changed
  sections as separate clickable chips, and the badge/subtitle count
  sections across every pending file, not files themselves — "editing
  two sections in one file" now correctly reads as 2, not 1. Opening a
  row (or a chip) no longer confirms: it force-flushes the current
  document's own recovery snapshot first (bypassing the normal 1.5s
  debounce), which makes the switch genuinely non-destructive rather
  than just usually-fine, so there's nothing left to warn about — every
  *other* discard-style action (the active row's own Discard, and every
  document-load path that doesn't go through this panel) still confirms
  as before, since those really can lose work.

  A real correctness trap surfaced while building this: parseMarkdown()
  hands out fresh ids on every call and never reuses old ones (a
  deliberate fix from a previous stage — ids must survive across
  documents), which means two *separate* parses of the exact same text
  produce structurally identical trees with completely unrelated id
  values. An id computed once (for the chip list) would silently match
  nothing in a second, later parse (for actually loading the file) —
  wrong section, or no jump at all. Fixed by parsing each snapshot
  exactly once and reusing that same parsed document everywhere it's
  needed, rather than re-parsing at click time; the currently-active
  document's own chips are diffed straight against the live in-memory
  doc for the same reason, so clicking one is a plain in-place jump with
  no reload at all — confirmed by checking that an unrelated section's
  undo history survived it. Verified: editing two sections of one file
  shows 2 chips and a badge of 2, clicking a chip lands exactly there
  (both for a different file and in-place within the active one),
  switching files via this panel never prompts even when the edit is
  only milliseconds old, and every other discard/confirm path is
  unaffected.
