# MD.Orchestra

![Electron](https://img.shields.io/badge/desktop-Electron-47848F?logo=electron&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Linux%20(AppImage)-lightgrey)
![No bundler](https://img.shields.io/badge/build-plain%20ES%20modules-blueviolet)

**A desktop workspace for Markdown, built for people who live in `.md`
files.** Open a single file or a whole folder of them, browse it as a
navigable outline instead of a wall of text, edit any section in place,
and save straight back to the real file on disk — no upload, no lock-in
format, no server.

![MD.Orchestra demo](docs/assets/demo.gif)

## Why

Most note-taking apps want to own your files (their own database, their
own sync, their own export step to get plain Markdown back out). Most
Markdown editors are either a bare text box or a full WYSIWYG that
fights the raw source. MD.Orchestra is neither: it's a real Electron
desktop app backed by the actual filesystem, that treats a heading
structure as something to *navigate*, not just scroll through, while
the file on disk stays exactly what it always was — plain Markdown, open
in any other editor at the same time if you want.

## Features

- **Open a file or a whole folder** — several folders can be open at once,
  each keeping its own identity, the way a multi-root workspace does.
- **Two ways to read the same document** — a raw **Full text** source view,
  or **Sections**: the heading tree broken into individually editable
  cards, picked automatically by document length/structure (and always
  overridable).
- **A real map of your workspace** — a node-link graph of an entire open
  folder's structure (click a folder to expand it, a file to open it), plus
  a Tree/Mind-map view of one document's own heading structure.
- **Per-section notes and Claude-assisted suggestions**, without touching
  the section's actual content until you choose to insert one.
- **Drag-and-drop restructuring** — reposition or re-nest a heading (and
  everything under it) by dragging it in the sidebar outline.
- **A live preview** docked alongside the editor, GitHub/PDF-style
  rendering (tables, code, Mermaid diagrams), editable in place.
- **Keyboard-first**: Ctrl/⌘+S commits whatever you're editing, Ctrl/⌘+Shift+S
  writes the file to disk, and every shortcut is listed in one place
  (Settings → Keyboard shortcuts, or press `?`).
- **A `git status`-style Changes panel** tracking unsaved edits across every
  open file — switching files never silently discards anything.
- **Crash recovery** — unsaved edits are snapshotted locally and offered
  back on the next launch.
- **System/Light/Dark appearance**, remembered across launches.

## Quick start

**Prerequisites:** none, if you just want to run the packaged app — see
below. Building from source needs [Node.js](https://nodejs.org) 18+ (and
Docker, only for the AppImage build path).

### Run the desktop app

```bash
./build-desktop.sh              # builds it via Docker — no Node/Electron needed locally
./dist/MD.Orchestra-*.AppImage  # run the result directly, no install step
```

Or, with Node already installed:

```bash
npm install
npm start
```

Either way you get a real window backed by the actual filesystem: the
native OS folder/file picker, full read/write access to whatever you open
(no browser permission prompts), and the last-opened folder reopens
automatically next time.

### Dev mode (browser, no build step)

```bash
npm run web
# open http://localhost:8899/index.html
```

This is a convenience for developing/testing in a real browser tab — not a
supported way to use the app day to day (see [Known
limitations](#known-limitations)).

## Using it

1. **Load something**: the 📂/🗂️ icons at the top of the sidebar open a
   single file or a whole folder; you can also drag a `.md` file straight
   onto the window.
2. **Browse it**: the sidebar's **Explorer** shows every open
   file/folder (click into a directory to expand it); the **Outline** below
   it shows the active document's own heading tree. Open **🗺️ Map** for a
   whole-document diagram (**Tree** or **Mind map**) or, with a folder open,
   **Workspace** — the whole directory as one node-link graph.
3. **Read or edit**: toggle **📝 Full text** / **🗃️ Sections** for how the
   active document is displayed. Every Markdown field (section content,
   notes) supports the usual editor habits — Enter continues a list,
   Tab/Shift+Tab indents, Ctrl/⌘+B/I/`` ` `` wrap the selection — with full
   native undo history.
4. **Annotate**: **Add note** on any section for a running commentary that
   never touches the section's real content; the ✨ insight icon asks
   Claude for a summary or suggestion you can optionally insert.
5. **Restructure**: drag any heading in the sidebar onto another one to
   reposition or re-nest it; **+ Add file** / **+ Add section** create new
   ones at an exact spot in the tree.
6. **Save**: Ctrl/⌘+S commits whatever field you're currently in;
   Ctrl/⌘+Shift+S writes the whole file to disk. **📝 Changes** lists every
   file with something unsaved, across every open folder, section by
   section — save or discard individually, with nothing lost by just
   switching to a different file first.
7. **Configure**: **Settings** holds your Anthropic API key (stored only in
   `localStorage`, sent only to `api.anthropic.com`), the Claude model, and
   System/Light/Dark appearance.

See [TESTING.md](TESTING.md) for the concrete use cases this app is
designed around, in more depth.

## Design philosophy

MD.Orchestra's UI choices are checked against actual UX research, not just
taste — see [docs/UI_UX_REVIEW.md](docs/UI_UX_REVIEW.md) for the sources
and how they map onto specific decisions already made here (removing the
header's Save button in favor of a shortcut, consolidating file actions
into one toolbar row, the Workspace map's collapsed-by-default tree) and a
short list of concrete next steps a command palette among them.

## Architecture

Plain ES modules, no bundler, so every piece can be opened and debugged in
isolation:

```
index.html          shell: header, sidebar (Explorer + Outline), main panel, side panels
electron/           the desktop app's main process (main.js: window,
                     allowlisted filesystem IPC) and preload.js (bridges
                     it into the page as window.electronFS — see
                     js/core/electronFsAdapter.js)
Dockerfile.electron, build-desktop.sh   packages the desktop app into a
                     Linux AppImage via Docker (build-time only — the
                     result is a normal double-click-to-run binary,
                     Docker isn't involved at launch)
icons/               icon.svg (source) + icon.png (rendered from it, for
                     the packaged app's Linux icon)
css/                 base, layout, cards, modal, animation styles
js/
  markdown/          parser.js (md -> section tree), serializer.js (tree -> md),
                     render.js (section -> sanitized HTML: tables, code,
                     mermaid, <details>; also resolves a rendered link
                     against the active workspace file), slug.js
                     (GitHub-compatible heading anchors), toc.js (regenerate
                     a Table of Contents), diff.js / sectionMerge.js
                     (per-section change tracking, for the Changes panel),
                     docStats.js (length/heading-count heuristics — see
                     ui/docViewMode.js)
  state/store.js      the single active document + pub/sub (fileName,
                     fileHandle, selectedId, dirty, and which open
                     workspace/relPath it belongs to, if any)
  state/workspace.js   every currently-open directory (several can be open
                     at once, each its own independent identity)
  core/               fileIO.js / workspaceIO.js (single-file / directory
                     read-write — File System Access API in a browser,
                     electronFsAdapter.js's real-filesystem bridge inside
                     the desktop app), recovery.js (per-file crash-recovery
                     snapshots in localStorage)
  ai/                 client.js (Claude fetch), prompts.js, settings.js
  ui/                 sidebar.js, filesPanel.js + focalGraph.js (the
                     Explorer's one-hop-at-a-time directory graph),
                     workspaceGraph.js (the Workspace map's full-directory
                     node-link tree), mapView.js (Tree / Mind map /
                     Workspace modes) + mindMap.js, cardGrid.js /
                     fullDocView.js + editableMarkdownBody.js,
                     changesPanel.js / recoveryPanel.js, settings/source/
                     shortcuts panels, markdownEditing.js (list
                     continuation / indent / formatting shortcuts)
  utils/              dom (incl. an SVG-element helper) / debounce / id / color / theme
  main.js             wires everything together
test/parser.selftest.html   in-browser assertions for parse/serialize round-trip
```

### Data model

Each heading becomes a node: `{ id, level, title, bodyMarkdown, children[] }`.
`bodyMarkdown` is the section's own raw Markdown, kept verbatim — so
re-serializing an untouched document reproduces its structure and content
faithfully. Notes and AI insertions are appended into `bodyMarkdown` between
marker comments, so reloading a previously-saved file re-hydrates them into
the right UI slot instead of duplicating them.

### AI integration

Calls go straight from the renderer to `https://api.anthropic.com/v1/messages`.
There is no backend/proxy. Only Claude is supported for now.

## Testing

See [TESTING.md](TESTING.md) for the use cases this app is built around and
the full functional test matrix (document loading, editing/undo, view
modes, workspace navigation, saving, recovery, and the Electron shell's own
allowlist/close-confirmation behavior). There's no committed automated
suite yet — every check listed there has been run by hand against a real
Chromium/Electron instance over the course of development.

Also see [docs/RELIABILITY_ARCHITECTURE_REVIEW.md](docs/RELIABILITY_ARCHITECTURE_REVIEW.md)
for a filesystem-focused audit (crash consistency, atomic writes, recovery
cache design, and security boundary review) of the Electron shell
specifically.

## Known limitations

- The recovery cache lives in `localStorage`, not a real on-disk cache
  directory, and there's no detection of a file changed externally (git,
  another editor) while it's open here — see
  [docs/RELIABILITY_ARCHITECTURE_REVIEW.md](docs/RELIABILITY_ARCHITECTURE_REVIEW.md).
- The Claude calls were verified with a mocked API response (success, a
  401, and a missing-key case), not the real Anthropic API — the request
  shape follows Anthropic's documented direct-access contract;
  `js/ai/client.js` is the only place that matters if it needs adjusting.
- `npm run web` (browser dev mode) is a development convenience, not an
  equivalent, supported way to use the app — no native filesystem access,
  no persisted folder across a reload. The full static-web/Docker
  deployment this project used before the move to Electron is archived on
  the `legacy/browser-only-v1` branch.
- The document map lays every node out in one scrollable region sized for
  the typical case; a very large document/folder still needs scrolling
  within that region to see all of it.

## Progress log

See [CHANGELOG.md](CHANGELOG.md) for the full stage-by-stage development
history.
