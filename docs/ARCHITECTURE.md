# Architecture

The technical reference for how MD.Orchestra is actually built — pulled out
of the README so that stays readable, this stays precise.

## Layout

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

## Data model

Each heading becomes a node: `{ id, level, title, bodyMarkdown, children[] }`.
`bodyMarkdown` is the section's own raw Markdown, kept verbatim — so
re-serializing an untouched document reproduces its structure and content
faithfully. Notes and AI insertions are appended into `bodyMarkdown` between
marker comments, so reloading a previously-saved file re-hydrates them into
the right UI slot instead of duplicating them.

## AI integration

Calls go straight from the renderer to `https://api.anthropic.com/v1/messages`.
There is no backend/proxy. Only Claude is supported for now.

## Known limitations

- The recovery cache lives in `localStorage`, not a real on-disk cache
  directory, and there's no detection of a file changed externally (git,
  another editor) while it's open here — see
  [RELIABILITY_ARCHITECTURE_REVIEW.md](RELIABILITY_ARCHITECTURE_REVIEW.md).
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

## VS Code extension (`vscode-extension/`)

A third delivery target, built from the same `index.html` + `js/` as the other two
(not a fork). The host side is plain CommonJS; the webview runs the existing UI with
hosted mode switched on when `acquireVsCodeApi` exists.

- `vscode-extension/extension.js` / `editorProvider.js` — a `CustomTextEditorProvider`
  for `*.md` (opt-in via *Reopen Editor With…*). VS Code's `TextDocument` is the source
  of truth: it owns save, dirty state, undo/redo and backup. The webview sends edits;
  the host applies them as one minimal `WorkspaceEdit` (`minimalEdit.js`) and ignores
  its own echo by document version. `retainContextWhenHidden` is `false`.
- `vscode-extension/webviewHtml.js` — generates the webview HTML: `asWebviewUri`
  rewriting, nonce + CSP, `localResourceRoots`.
- `vscode-extension/aiProxy.js` — the Claude call is made by the host with the key from
  `SecretStorage`; the webview never sees it.
- `js/core/vscodeBridge.js` (the only file that touches `acquireVsCodeApi`) and
  `js/hostedMode.js` (load/edit/external-change/dirty messages, view-state restore,
  hidden UI) are the webview side. `main.js` has one gate per subsystem
  (Explorer, recovery, shortcuts, ...), not per call site.
- `npm run vscode:sync` copies the UI into `vscode-extension/media/` (a gitignored build
  product); `npm run vscode:package` builds the `.vsix`.
- Tests: `tests/vscode-hosted.spec.js` (webview side, via `VSCODE_STUB`, part of
  `npm test`) and `npm run test:vscode` (real VS Code via `@vscode/test-electron`,
  separate, needs a display). Measurements and decisions: [adr/0001-vscode-extension.md](adr/0001-vscode-extension.md).
