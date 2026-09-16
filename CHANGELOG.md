# Progress log

A running, stage-by-stage development history for MD.Orchestra — what changed and why, oldest first. See [README.md](README.md) for the app itself (running it, using it, architecture, known limitations).

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
- **Stage 40** — Reported: Stage 39 made the Changes panel list each
  changed section as its own clickable chip, but Save/Discard were
  still per-*file* — clicking Save on a row wrote the whole file's
  content, chip or no chip. The actual ask: each changed section
  should be its own separate, independently-confirmable panel, stacked
  under its file, so the user picks exactly which edits to apply.

  Each chip became a stacked sub-row with its own Save (💾) and Discard
  (↩) — the file-level "Save all" / "Discard all" pair from before is
  still there for acting on everything in a file at once. The hard
  part was storage, not UI: a recovery snapshot only ever held one
  file's full pending Markdown, with no notion of "apply this one
  section, leave the rest pending." `markdown/sectionMerge.js` (new)
  builds that: `applySectionToBase(baseDoc, editedDoc, sectionId)`
  clones the file's current on-disk tree (`baseDoc`, i.e. the
  snapshot's `baselineMarkdown`) and splices in just the one edited
  section's content from `editedDoc` by position — the same
  position-based node matching diff.js already relies on for listing
  changed sections in the first place, since ids aren't comparable
  across separate parses. `revertSectionToBase()` is the mirror image,
  for discarding one section while leaving every other pending edit in
  place. After a partial save, whatever the edited doc still disagrees
  with the newly-written file is exactly the sections still pending —
  no separate bookkeeping needed, the existing diff just gets re-run
  against the merged result.

  For the currently-open file, a partial save updates its baseline in
  place (`currentBaseline`) without touching the live in-memory doc at
  all — nothing else pending is disturbed, dirty only clears once
  nothing's left. Discarding one section in the active file mutates the
  in-memory tree directly rather than going through the usual full
  reload path, specifically so it doesn't reset the current
  selection/undo history for the *other* section you might be sitting
  on. For a file that isn't currently open, both actions read/write its
  recovery snapshot directly (write the merged file, or re-save the
  snapshot with an updated baseline) without switching anything. Saving
  the active file's own section still needs a live handle or download,
  same as any other save; discarding it still confirms first (as
  destructive as discarding the whole file, just smaller in scope) —
  discarding a section of a file that isn't even open doesn't, matching
  the reasoning already established for whole-file discards. Verified:
  saving one of two changed sections in a file downloads content with
  only that section's edit and leaves the other listed as still
  pending; discarding the other afterwards cleanly resolves the row to
  "Everything is saved"; discarding one section while a second stays
  pending reverts only the first in the live document and leaves the
  second's undo history and edit intact; the same save/discard-one
  flows work identically for a file that isn't the currently open one,
  without disturbing whatever *is* open. No native dialogs, no console
  errors.
- **Stage 41** — Three UI/UX requests for how the preview relates to the
  main content view. First: the "👁 Preview" button was one more item
  in an already-crowded header row. Second: it started closed every
  session, so browsing sections showed nothing alongside them until
  toggled on. Third: adding a note meant opening the current section's
  card and hunting for its own "+ Add note" button, even though the
  preview right next to it was already showing that same section.

  The header button is gone; a slim tab now docks to the edge of the
  content area instead (`.edge-toggle` in `css/layout.css`), sitting at
  the preview panel's own left edge while it's open and at the
  viewport's edge while it's closed — a CSS transition slides it
  between the two rather than the button just appearing in a different
  spot. Preview also now defaults to open rather than closed
  (`getPreviewOpen()`/`setPreviewOpen()` in `previewPanel.js`, mirroring
  the existing preview-scope preference), only remembered once actually
  toggled, so every newly-selected section previews live beside it from
  the very first load.

  A small round button now floats directly on the seam between the
  content pane and the preview panel — hovering within 48px of the
  shared border from either side reveals it at the cursor's height,
  mirrored onto whichever side triggered it (`.note-seam-btn-content` /
  `.note-seam-btn-preview`) purely as a visual cue, not a different
  action: it always adds a note to whatever section is currently
  selected, since both views already show that same one. The one real
  wrinkle was that the edge-toggle tab from the first two changes and
  this new seam button both wanted the same vertical-center real
  estate on that border; docking the tab near the top of the seam
  instead (rather than centered) keeps it clear of the area a user
  would actually hover across looking for the note button. The
  "append a new empty note" logic itself moved into `markdown/
  markers.js`'s new `addNote()`, so this and the card view's own
  "+ Add note" button share one implementation instead of duplicating
  it. Verified: the header no longer has a preview button and the edge
  tab is there instead; loading a file opens the preview without an
  extra click and switching sections updates it live; toggling the
  edge tab closed persists across a reload; hovering near the seam from
  the content side shows the button mirrored on that side, from the
  preview side mirrors it there instead, moving away hides it again,
  and clicking it adds a note to the selected section's own notes list
  — all with no console errors.
- **Stage 42** — Reported: regenerating a section's ToC and then
  clicking Undo left the Changes badge/panel still reporting a pending
  change, even though the content was back to exactly what it was
  before. Two compounding bugs: `countChangedSections()` (and the
  Changes panel's own subtitle tally) computed `diff.length || 1` —
  meant as a fallback of "count as at least 1" for a legacy snapshot
  with no baseline to diff against at all, but `||` also silently
  caught the *legitimate* case of a real diff coming back genuinely
  empty (0 is falsy), forcing it to 1 either way; and even past that,
  the debounced snapshot writer kept re-persisting a "pending" snapshot
  for a file that had, in fact, gone right back to matching its own
  baseline, since `updateNode()`/`undoNode()` always set `dirty: true`
  unconditionally (they have no notion of "baseline" — only main.js
  does) and nothing ever rechecked that afterward. Fixed by having
  `diffSnapshot()`/`enrichSnapshot()` return `null` (not `[]`)
  specifically for "couldn't diff", so the two cases stay
  distinguishable, switching the panel's own tally to `??` instead of
  `||`, and having `snapshotNow()` compare the serialized doc against
  the baseline before persisting anything — an exact match clears
  `dirty` and drops any stale pending snapshot instead of re-saving
  one, which also fixed the header's dirty indicator getting stuck on
  "unsaved changes" in the same scenario. Verified: regenerating a ToC
  section shows a real pending change (badge = 1); undoing it and
  waiting for the debounce to settle clears the badge, the dirty
  indicator reads "up to date" again, and the Changes panel reports
  nothing to save or discard. (Landed directly on `master`, not this
  branch — an unrelated, pre-existing issue found while testing this
  feature, fixed where it actually affects the deployed app, then
  merged back into this branch.)
- **Stage 43** — Reported: a file starting with two consecutive H1s
  and nothing in between (`# aCupOfTea` / `# AI Tea Lounge: Sipping
  Knowledge in AI Domains`) parsed into two sibling top-level cards —
  the first completely empty (and what the file opens on by default),
  the second holding the document's entire real content as its own
  subsections — rather than the two-line title it almost certainly was
  meant to be. Asked which behavior was actually wanted (merge into
  one card vs. leave the structure as-is but stop landing on the empty
  one by default) before touching anything, since the literal parse
  isn't *wrong*, just an unhelpful reading of a common pattern.
  Chose: merge. `mergeLeadingEmptyH1s()` (parser.js) now folds a
  leading H1 with no body text and no nested heading of its own into
  the next H1's title (joined with " — "), dropping it from the tree;
  the surviving node keeps its own id, level, body and children.
  Scoped tight to avoid swallowing real structure: H1 only, only at
  the very start of the document, and only when the leading heading is
  truly empty — a placeholder section someone's mid-drafting always
  has *something* under it eventually, but never sits fused to the
  next H1 with nothing in between; the same empty-heading-before-a-
  sibling pattern elsewhere in a document (not at the very start) is
  left alone. Handles a chain of more than two leading empty H1s the
  same way. Verified against the reported case, a chain of three
  leading empty H1s, a lone stray empty H1 with nothing after it
  (correctly left alone), a leading H1 with its own body or a nested
  child (left alone in both cases), and the same pattern occurring
  mid-document rather than at the start (left alone). Every case
  round-trips stably through serialize → re-parse; full self-test
  suite still passes. (Also landed directly on `master`, same reasoning
  as Stage 42, then merged back into this branch.)
- **Stage 44** — Reported: closing the preview via its own "✕" button
  (inside the panel itself, not the edge-toggle tab from Stage 41)
  left the edge-toggle tab visually stuck docked at its "open"
  position instead of sliding back out to the collapsed one.
  `handleClosePreview()` never called `render()` — only the
  edge-toggle's own click handler did, right after calling it, which
  is what masked this for that one path; `#app-body`'s `preview-open`
  class (what actually drives the edge-toggle's docked position in
  CSS) only gets synced inside `renderInner()`, so the panel's own ✕
  button — which goes through `handleClosePreview()` directly — left
  it stale. Moved the `render()` call into `handleClosePreview()`
  itself so every caller gets it consistently, and dropped the
  now-redundant one from the edge-toggle's own close branch. Verified:
  closing via the panel's ✕ now correctly moves the edge-toggle back to
  its collapsed position; the edge-toggle's own open/close cycle still
  works as before. (Also landed directly on `master`, same reasoning as
  Stage 42/43, then merged back into this branch.)
- **Stage 45** — A proposed "Best-Practice View Mode: Focal Neighborhood Graph" for
  navigating a whole workspace (a directory of Markdown files), rather
  than a single document's headings: instead of always showing the
  entire recursive folder tree at once (the sidebar's existing plain
  list already does that), show only the active file's own directory
  — one hop — collapsing every subdirectory into a "+N" ghost node
  until explicitly expanded. Reviewed first (data model, layout
  engine, and where it should live in the UI) before writing any code;
  the analysis and the three decisions that came out of it are worth
  recording since they shaped everything else:

  1. *Edges*: pure filesystem hierarchy (parent/children/siblings, free
     from `workspace.tree`) plus cross-file Markdown links, combined —
     but not by eagerly parsing the whole workspace up front, which
     would contradict `state/workspace.js`'s own deliberately lazy
     design (it only ever holds lightweight file entries, never every
     file's parsed content). `state/linkIndex.js` (new) instead builds
     a session-scoped map of outgoing links for free, from whichever
     files actually get opened — their content is already being parsed
     for editing anyway — with an explicit, on-demand "🔍 Scan for
     links" action for complete backlink coverage across files that
     have never been opened this session.
  2. *Layout*: fixed depth-first tiers (parent above, siblings/children
     below), not the force-directed physics `mindMap.js` already has
     for the single-document Mind Map — a folder hierarchy is
     predictable structure, not an organic cluster, so something that
     jiggles or resettles would work against the "maintain a mental
     map" goal the whole feature is for. Re-centering and expanding
     still animate smoothly, just via a plain CSS transition on each
     node's SVG transform rather than a running simulation.
  3. *Placement*: a small 📋/🕸️ toggle on the existing workspace-tree
     sidebar header, switching that same area between the plain list
     and the graph, rather than a separate modal or a third tab bolted
     onto the unrelated single-file Map view.

  Phase 1 (this stage): `js/ui/focalGraph.js` renders the graph itself
  — an SVG depth-first stack, directories collapsed to count badges by
  default, click a ghost node to expand it in place (recursively),
  click the parent node to re-center the whole view one level up,
  click a file to open it (same as the plain tree). A tray below the
  graph lists cross-file linked notes not already visible as
  filesystem neighbors, pulling from the new link index. The sidebar
  itself widens slightly (`.sidebar-graph-mode`, 260px → 320px) only in
  graph mode, since a node-and-edge layout needs a bit more room than a
  plain indented list to stay legible. Verified against a small nested
  test workspace (multiple directories, a cross-directory link, a
  two-levels-deep subdirectory): opening a file centers the graph on
  its directory with the right siblings and parent shown; expanding a
  ghost node reveals its nested file without disturbing the rest of
  the view; the linked-notes tray correctly shows a same-workspace file
  that's linked but *not* a filesystem neighbor; clicking that link
  chip opens the file and re-centers the graph there; the manual
  workspace-wide scan makes a previously-unknown backlink (from a file
  that was never directly opened) show up afterward. No console
  errors. (Built on its own branch, `feature/focal-neighborhood-graph`,
  through both phases below — merged into `master` once Phase 2 and
  the bug fixes found along the way were settled.)

  Phase 2 (same branch): after trying Phase 1, the graph became the
  sidebar's *default* view (the plain tree is still one click away,
  and whichever is explicitly chosen persists from then on) — and the
  two things Phase 1 had deferred are done: a breadcrumb strip
  (`testws › guide › advanced`) above the graph, letting you jump
  straight to any higher ancestor in one step instead of walking up
  one parent-click at a time; and real animation. Phase 1's CSS
  transition on each node's transform turned out to be inert in
  practice — every render tears the whole SVG down and rebuilds it
  from scratch, so a "new" DOM node never has an old position to
  transition from. `positionNode()` fixes that with a small FLIP
  implementation: a node matched to the same one on the previous
  render (by its own stable path, not its row index, which shifts
  constantly as siblings above it expand/collapse) is dropped back at
  its last position with transitions suppressed, then released to its
  real position on the next frame so the CSS transition animates the
  difference; a genuinely new node has no earlier position to FLIP
  from, so it fades in instead. Verified: the root breadcrumb reads
  just the workspace name; centering on a nested directory shows the
  full ancestor chain with only the last step non-interactive; clicking
  an ancestor several levels up jumps there directly rather than one
  hop at a time; repeatedly expanding/collapsing/re-expanding the same
  directory (exercising both the FLIP "already seen" path and the
  fade-in "brand new" path back to back) never throws and always ends
  up showing the right nodes. No console errors.
- **Stage 46** — Follow-up report: "the two-H1 merge from Stage 43
  isn't working" — turned out Stage 43's fix (still live and verified
  working for its own exact case) only ever covered a leading H1 with
  *no* content of its own at all; the actual ask, restated, was for
  *any* two consecutive leading H1s to merge, even when the first one
  has its own body text. Implemented that broader version — and found,
  before shipping it, that it isn't idempotent: a real multi-chapter
  document (`# Chapter 1` / text / `# Chapter 2` / text / `# Chapter 3`
  / text) merges chapters 1 and 2 on first open, reasonably enough, but
  the merged node is then indistinguishable — once written back to
  plain Markdown — from a fresh "H1 followed by a content-bearing H1"
  case. Reopening that saved file merges chapter 3 in too, and so on:
  every save/reload cycle would silently eat one more real chapter,
  with no way to tell from the file alone that a merge had already
  happened. Confirmed this concretely (round-tripping the chapter
  example through serialize → re-parse produces a *different* structure
  than the original parse) before asking which way to go, rather than
  shipping something that quietly corrupts real documents over time.
  Reverted to Stage 43's narrow rule (leading H1 must have neither body
  text nor a nested heading) — it already fully covers the originally
  reported case and is provably stable across repeated save/reload,
  since a merged node always ends up with real content and can never
  look "empty" again on a later parse. No code changed from what Stage
  43 shipped; only the comment explaining why the broader rule was
  tried and rejected.
- **Stage 47** — Three reported bugs around workspaces (open folders),
  all in `main.js`:
  1. The focal graph's "🔍 Scan for links" button only ever worked
     once — after a full scan it hid itself permanently
     (`indexedCount() >= workspace.files.size`, a one-way flag), and
     `indexWorkspaceLinks()` itself skipped any file already indexed,
     so even a visible button wouldn't have refreshed a file that
     changed after its first scan. A file's own outgoing links were
     previously only ever refreshed by *reopening* it — never by
     saving it while it stayed open, which is the common case. Fixed:
     the button is unconditionally there now, `indexWorkspaceLinks()`
     always does a full re-read of every file, and `handleSave()` now
     also calls `recordLinksFor()` for whatever it just wrote, so the
     common case stays fresh automatically and a manual re-scan is
     always available as a fallback regardless.
  2. With a standalone file open, using "Open folder" silently
     replaced it with one of the new folder's own files, discarding it
     with no trace — the reverse order (folder first, then a
     standalone file) already worked correctly, collapsing the folder
     to a peekable sidebar header while the new file became active.
     `handleWorkspaceOpened()` now only auto-opens a default file into
     a genuinely empty workspace; with something already active, the
     folder just becomes browsable in the sidebar and the current
     document stays put — needed an explicit `render()` call alongside
     that, since `setWorkspace()` is separate module state that never
     triggers one on its own (previously masked by the auto-open,
     which indirectly triggered one via `loadDocument`'s own
     `setState`).
  3. Removing an open folder from the sidebar (its ✕) left whatever
     file was open from it fully loaded and editable, with no link
     back to any folder anymore and no warning even with unsaved
     changes pending. `handleCloseWorkspace()` now also closes that
     document (confirming first if it's dirty, same as every other
     path that can lose unsaved work, and clearing its pending
     recovery snapshot on a confirmed discard) — a document that
     doesn't belong to the folder being closed is left untouched.

  Verified each in isolation and together: the scan button survives
  repeated use; opening a folder after a standalone file keeps that
  file active with the folder shown collapsed; opening a folder after
  another folder (existing behavior) is unaffected; closing a folder
  with a dirty active file from it prompts to confirm before returning
  to the empty state, and with a clean one closes straight away with
  no prompt. Full regression suite (self-test, focal graph, preview UX,
  per-section Changes) unaffected.
- **Stage 48** — Follow-up on Stage 47's second fix: opening a folder
  now keeps an already-open standalone file active, but clicking one
  of the *folder's own* files afterward still silently discarded it
  with no warning and no listing to reopen it from — the fix only
  covered the moment of opening the folder, not navigating into it.
  Two changes:
  - `loadFromText()` now also confirms before replacing a standalone
    file that's coexisting with an open workspace — a plain "continue?"
    prompt, not a danger one, since nothing is actually unsaved; a
    workspace file never needs this (always still listed in the
    sidebar, so switching away from it never loses access), only a
    standalone file has nothing to click back to once replaced.
  - The sidebar now visibly treats the standalone file and the open
    folder as two separate entities: the standalone file gets its own
    small header (📄 filename, with its own ✕ to close just it) above
    its heading outline, mirroring the folder's own header row instead
    of reading like an unlabeled part of whatever's underneath it.

  Verified: the confirm appears switching from a clean standalone file
  into a workspace file, and correctly does *not* appear switching
  between two files in the same open workspace, or between two
  standalone files with no workspace open (both pre-existing, both
  unaffected); closing the standalone file via its own ✕ leaves the
  workspace fully intact. Full regression suite unaffected.
- **Stage 49** (branch `feature/multi-document-workspace`, not yet
  merged) — Follow-up on Stage 48: "that's not fully correct" — the
  confirm dialog didn't actually fix anything, it just made the same
  data loss explicit instead of silent, and the same issue turned out
  to apply generally (switching to *any* other file — a nested
  subdirectory file included, not just the standalone-vs-folder case),
  not just the one path Stage 48 covered. What was actually wanted
  (VSCode-style): every opened file keeps its own state independently,
  switching between them is instant and lossless, and the sidebar
  marks which ones are open/pending directly rather than needing a
  separate list. Scoped this properly before writing code (comparable
  in size to the focal-graph work) — asked how the sidebar should
  represent multiple open files, whether there should be a cap on how
  many, and branch vs. `master` — then built it on its own branch:

  - **Lossless switching, no confirm**: rather than rearchitecting the
    store to hold multiple documents at once (a much larger change),
    `loadFromText()` reuses the recovery-snapshot system already built
    for crash recovery — force-flushing whatever's currently active
    into its own snapshot first if it's dirty (the same
    non-destructive pattern the Changes panel's own "Open" action
    already used, just applied to every switch now), and preferring a
    pending snapshot over a fresh on-disk read when switching to a
    file that already has one waiting. Nothing is ever actually
    discarded by navigating away anymore, so every confirm-before-
    switch dialog (Stage 48's included) is gone; an explicit ✕-to-close
    still confirms, since that genuinely does discard on purpose.
    `standaloneHandles` keeps a standalone file's own File System
    Access handle by name across switches (a workspace file's is
    always available again via `getWorkspaceFile()`, but a standalone
    file has nowhere else to keep it) so restoring its pending edit can
    still Save directly instead of falling back to a download.
  - **Changes panel/badge timing gap**: restoring a pending file as
    active clears its snapshot the instant it's restored, which would
    otherwise leave the Changes badge/panel showing nothing for it
    until the next debounce tick — `activeGapChangedCount()`/
    `activeGapSnapshot()` close that gap.
  - **Sidebar marking**: a small dot now appears next to any workspace
    file (plain list and focal graph both) with a pending recovery
    snapshot, sourced from the same tracking the Changes panel already
    uses — chosen over a separate "open files" list, per the review.
  - **Incidental find**: testing this exposed a real, unrelated latent
    bug — `mermaid.run()` returns a promise that was only ever wrapped
    in a synchronous try/catch (which never catches a later rejection,
    only a throw from the call itself); switching away from a document
    while its diagrams were still mid-render removed the DOM nodes
    mermaid was targeting, rejecting that promise with nothing to catch
    it. Always possible in principle, but only became an easily-hit
    race once switching got this fast. Fixed with an explicit `.catch()`.

  Verified: editing a file and switching to another (standalone-to-
  workspace, workspace-to-standalone, and workspace file to a nested
  subdirectory file) never confirms and never loses the edit, switching
  back shows it exactly as left, with the Changes panel/badge reflecting
  it immediately rather than after a debounce delay; re-clicking the
  already-active file is a no-op; pending-file dots show correctly in
  both sidebar view modes. Full regression suite unaffected.

- **Stage 50** (branch `feature/multi-document-workspace`, not yet
  merged) — Two more issues found while using Stage 49's rebuild:
  "the title tree in project are not correct or maybe correct but too
  long... under it it mention the original whole project name instead
  of the parent" and "I'm still losing an old opened md alone, when I
  open a new directory... it shows in the changes, but not on the side
  bar."

  - **Redundant parent node in the focal graph**: a screenshot of a
    nested directory showed the same path repeated three times —
    the sidebar's own folder-name header, the breadcrumb strip above
    the graph, and a "parent" ghost node inside the graph body itself
    (a leftover from Phase 1 of the focal graph, before the breadcrumb
    existed). The breadcrumb already covers every ancestor including
    the immediate parent, so the ghost node was pure duplication, not
    a naming bug — removed it entirely from `focalGraph.js` rather
    than trying to shorten or reconcile three overlapping displays;
    layout math simplified accordingly (nested rows still draw a
    connecting line back to their own parent row, top-level rows no
    longer reserve space for one that no longer exists).
  - **Standalone file vanishing from the sidebar**: a standalone
    file's header row was only ever rendered while it was the active
    document — its recovery snapshot was genuinely preserved when
    switching away (Stage 49 already guaranteed that), but nothing in
    the sidebar pointed back to it, so opening a new directory made it
    look gone even though the Changes panel still listed it correctly.
    `renderStandalonePendingHeads()` replaces the old
    active-file-only block: it still shows the active standalone
    file's header, plus a clickable row (with the same pending dot
    used elsewhere) for every *other* standalone file with a pending
    snapshot, so switching to a workspace — or a second, different
    workspace — no longer erases the way back to it.

  Verified with dedicated Playwright tests plus the full existing
  regression suite (one test's selector, referencing the now-removed
  parent node, was updated to use the breadcrumb instead — an
  expected test update, not a regression). Both fixes are on
  `feature/multi-document-workspace`, not merged or deployed.

- **Stage 51** — Merged `feature/multi-document-workspace` into
  `master` and redeployed Docker (it had been sitting unmerged since
  Stage 49, which is why a report of "the standalone file vanishes
  when I open a directory file" turned out to already be fixed —
  just not on the branch actually running at `localhost:8080`).

  Then added the actual next ask: opening a second folder used to
  silently replace whichever workspace was already open.
  `state/workspace.js` now keeps a Map of every open workspace, keyed
  by its own root folder name, instead of a single slot — each
  directory is its own independent identity (files, tree, link
  index), the same way a VSCode multi-root workspace treats them,
  and "Open folder" (now labeled "Add folder" once one is open) adds
  to that set rather than replacing it. The sidebar renders one block
  per open folder; only the one owning the active file expands, every
  other one collapses to its header (still peekable); closing one (✕
  on its own block) only ever affects that folder's own active file.
  `state/linkIndex.js`'s cross-file link tracking now namespaces by
  root name too, so two open folders with a same-named file can't be
  conflated.

  Also: removed the "Samples" menu and "Try sample.md" button (the
  bundled sample.md/sample3.md/doc_flowchart.html files were removed
  from the repo — they were scratch content, not part of the app),
  and moved fileIO.js/workspaceIO.js/recovery.js into js/core/ so
  every module lives in a purpose-named subfolder.

- **Stage 52** — Follow-up: with several directories now open at once
  (Stage 51), the sidebar's old behavior — the workspace tree collapsing
  to a bare header, and the active file's heading outline swapping
  above or below it, whenever the active file changed — made the whole
  sidebar visibly jump around on every switch. Replaced with a fixed
  VSCode-style two-pane layout: **Explorer** always shows every open
  directory/standalone file, fully expanded, regardless of which one is
  active; **Outline** always shows the active document's own heading
  breakdown underneath it. Neither reorders or auto-collapses anymore.
  Each pane collapses independently via its own header, a persisted
  preference. Dropped the "keep active file on top" pin and the
  per-workspace auto-collapse/peek mechanic it required.

- **Stage 53** — Four follow-up polish requests on the new sidebar/map:
  (1) each open workspace folder in Explorer is now individually
  foldable via its own chevron (persisted), independent of every other
  folder and of which file is active — a collapsed one still shows a
  pending-changes dot if something inside it is unsaved; (2) Explorer
  and Outline are now a fixed-height flex column each scrolling its own
  overflow independently, instead of one long shared scroll, so a long
  file list or outline no longer pushes the other pane off-screen;
  (3) removed the list/graph view toggle — dead weight since the focal
  graph became the only mode actually used, so the button, its
  preference, and the plain-list render path are gone; (4) the
  Document map (🗺️) gained a third **Workspace** mode alongside Tree
  and Mind map: the whole open folder's structure (every file and
  subfolder) laid out with the same force-directed mind-map renderer,
  built by converting the workspace's folder tree into the same
  {id, title, children} shape a document's heading tree already has —
  clicking a file node opens it directly.

- **Stage 54** — Bug report with a screenshot: opening a third,
  standalone file while two folders were already open put its row at
  the top of Explorer indistinguishable from a folder's own header,
  reading as a dead/unclickable row (it wasn't — it was already the
  active document, just with no visual cue saying so); and a folder's
  name appeared twice — once in Explorer's own header, again in the
  focal graph's own root breadcrumb (which at the root is just that
  same one name). Fixed both: the breadcrumb is now skipped until
  you've actually drilled into a subdirectory, where it starts being
  genuinely useful; standalone files are now grouped under their own
  "Open files" label (distinct from the folder blocks below, VSCode's
  "Open Editors" equivalent), and the active one gets a clear
  current-item highlight.

- **Stage 55** — Follow-up: the duplicate-name fix landed, but the
  disappearing-file half of Stage 54 turned out to only be fixed for a
  *dirty* standalone file — an unedited one (or one right after being
  saved) still vanished from Explorer the moment you switched away,
  since "Open files" was really only ever tracking pending recovery
  snapshots, not "is this file open." Added
  `openStandaloneFileNames` — every standalone file opened this
  session, regardless of edit state, cleared only by an explicit close
  — so it now behaves like VSCode's Open Editors: stays listed and one
  click away until you close it, not just while it happens to be
  dirty. Switching back to a clean one re-reads it fresh from its
  retained file-picker handle instead of needing a snapshot to
  restore.

- **Stage 56** — Two more requests: remove the "Scan for links"/Linked
  notes tray ("I don't see any useful thing for it, and actually it's
  not working") — gone entirely, along with the whole
  state/linkIndex.js module it existed to feed (nothing else used it;
  cross-file link *navigation*, clicking a rendered link to jump to
  another file, is a separate, untouched code path).

  Also chased down "the file is removed again for the explorer...
  something that triggers the disappear issue related to opening md
  files in other directories" — found a real bug in focalGraph.js:
  its navigation state (which directory each graph is centered on,
  which subfolders are expanded) lived in flat module-level variables
  shared across every open workspace's graph instead of scoped per
  workspace. A workspace that isn't the one owning the active file
  renders with its activeRelPath forced to null, and the reset-on-
  active-file-change logic treated that null/real-path flip — which
  happens on *every single switch*, for every other open workspace —
  as a genuine change, silently collapsing whatever directory you'd
  navigated into the moment you touched a file anywhere else. Moved
  this state into a per-workspace map and narrowed the reset condition
  to only fire on an actual change to a new real path. Verified with
  extensive alternating cross-directory switching (dirty and clean
  standalone files, root-level and deeply-nested workspace files, 10+
  switches in sequence) against both the dev server and Docker.

- **Stage 57** — The disappearing-file report persisted with an exact
  repro (two directories, then a standalone file, switch to a
  directory file, switch back). Could not reproduce it directly even
  with that literal sequence, across many variations, on either the
  dev server or a freshly rebuilt Docker container — which, combined
  with Stage 56's real fix having apparently made no visible
  difference, pointed at the browser not actually loading the latest
  deployed code at all. Found two real gaps: nginx only ever set
  Cache-Control on sw.js itself, leaving every other file (index.html,
  js/*, css/*) cacheable by the browser's own HTTP cache with no
  request ever reaching the server; and sw.js's "network-first" fetch
  handler called plain `fetch(request)`, which is itself still subject
  to that same browser cache — network-first was never actually
  guaranteed to reach the network. nginx now sends
  `Cache-Control: no-cache, no-store, must-revalidate` on every path,
  sw.js passes `{ cache: 'no-store' }`, and the SW cache name was
  bumped to purge whatever an already-registered worker had stashed.
  This doesn't rule out the reported bug still being real and
  unreproduced — it removes a very plausible reason a genuine fix
  could look like it never happened.

- **Stage 58** — Found it: the cache fix wasn't the answer, but the
  error toast the user saw next was — "Can't reopen ... automatically,
  use 'Open .md file' to pick it again." reopenCleanStandaloneFile()
  had exactly one way back to a clean standalone file's content:
  re-reading it from its retained File System Access handle. A file
  opened through the `<input type=file>` fallback never gets one —
  and that fallback is Firefox's *only* path, since it doesn't support
  `showOpenFilePicker()` at all. So on Firefox (or anywhere else the
  fallback triggers), switching back to an unedited standalone file
  always failed outright, and the failure handler removed it from
  Explorer's "Open files" group — which looked exactly like the file
  disappearing, even though nothing was ever lost.

  Added `standaloneCleanText`, a Map of every open standalone file's
  own last-known clean (on-disk/saved) content, updated on every fresh
  load and every save. Reopening now falls back to it whenever there's
  no handle to re-read from (or the read fails), instead of failing
  outright — a standalone file only disappears now if explicitly
  closed. Verified with the fallback path specifically (no handle at
  all) across repeated cross-directory switches, on both the dev
  server and Docker.

- **Stage 59** — Four requests: (1) moved this progress log out of
  README.md into its own CHANGELOG.md — README had grown to over a
  thousand lines of stage history dwarfing the actual usage docs —
  and refreshed README content that had drifted stale over many
  stages (removed sample.md/sample3.md/doc_flowchart.html references,
  rewrote "Working with a directory" for the current multi-workspace
  design, updated the Architecture file tree for the js/core/ move).
  (2) Alt+N now adds a note to the selected section from anywhere
  (guarded against active text inputs), reusing the same
  addNoteToSelected() as the per-card "+ Add note" button. (3) Removed
  the old note-seam-btn (a button that tracked the cursor along the
  seam between the content pane and the preview, which is what made
  that seam ungrabbable for anything else) and replaced it with a real
  drag-to-resize handle for the preview panel — width is now a
  `--preview-width` CSS variable, draggable between 280px and 70vw,
  persisted across reloads. (4) A code-review pass: found and fixed a
  real security gap (renderMarkdownToSafeHtml fell back to
  *unsanitized* HTML if DOMPurify failed to load — now fails closed),
  added a 5MB cap on embedded images (previously unbounded, risking a
  localStorage quota error via recovery snapshots), released
  per-workspace state (focal graph navigation, fold preference) when a
  folder closes instead of leaking it for the rest of the session, and
  removed several confirmed-dead exports and CSS classes (verified
  zero references before removing each one).

- **Stage 60** — Follow-up: "No notes yet on this section." read as
  inert text on an otherwise interactive card, but looked like it
  should be directly writable. It's now a real button styled as an
  invitation (dashed border, hover state) — clicking it, "+ Add
  note", or Alt+N all now also focus the new note's own textarea
  immediately, so adding a note lands you ready to type rather than
  looking at an empty field. Needed a short rAF poll rather than
  acting right after the state update, since the section view's own
  re-render is animated and the new textarea doesn't exist in the DOM
  until that finishes.

- **Stage 61** — Five UI/UX requests, as a design pass: (1) the notes
  panel used to sit in a solidly-tinted box below every section's
  content, always visible even empty, competing with that content for
  attention — it's now only rendered once there's actually a note, and
  the wrapper lost its color fill in favor of a quiet dashed divider.
  (2) "Understand & suggest" shrank to an icon by default, expanding
  to its full label on hover *and* keyboard focus. (3) covered by (1).
  (4) the header's buttons (file ops, save/changes/new-section, map,
  source/settings) are now grouped with a thin divider between each
  functional cluster instead of one flat row. (5) Explorer and Outline
  can now be resized against each other via a drag handle between
  them, persisted as a percentage of the sidebar's own height (hidden
  while either pane is collapsed).
