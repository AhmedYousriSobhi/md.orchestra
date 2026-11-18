# 0001. Deliver MD.Orchestra as a VS Code extension (in addition to Electron and Android)

- **Status:** Proposed
- **Date:** 2026-11-18
- **Deciders:** repo owner
- **Related:** [SPEC.md](../../SPEC.md), [docs/ARCHITECTURE.md](../ARCHITECTURE.md),
  [CLAUDE.md](../../CLAUDE.md), start plan in
  [docs/VSCODE_EXTENSION_PLAN.md](../VSCODE_EXTENSION_PLAN.md); open issues #13
  (restored snapshot without a resolvable workspace) and #17 (full-doc debounce race)

## Context

MD.Orchestra is a local-first Markdown workspace dashboard. It parses each heading into
a node (`js/markdown/parser.js`), presents sections as cards, an Explorer, an Outline and
a Workspace map, and writes plain `.md` back to disk. It ships today as:

- an **Electron desktop app**, the primary target, which loads `index.html` with `loadFile` and talks to the real filesystem over an allowlisted IPC bridge (`electron/main.js`, `electron/preload.js`, `js/core/electronFsAdapter.js`);
- an **Android app** via Capacitor, using a native ScopedStorage plugin (`js/core/capacitorFsAdapter.js`).

The proposal is to also deliver it **inside VS Code** as an extension. The audience is people who already keep their Markdown in a VS Code workspace and don't want a separate app.

### What the codebase makes cheap

- **The UI is plain ES modules with no bundler.** `index.html` loads `js/main.js` as `type="module"`, and every other file is a relative import. That is the same shape a VS Code webview can host, so the UI code can in principle be reused as-is.
- **Filesystem access already sits behind an adapter.** `js/core/workspaceIO.js` and `fileIO.js` are written against the browser `FileSystemDirectoryHandle`/`FileSystemFileHandle` shape: `.entries()`, `.getFileHandle(name, {create})`, `.removeEntry()`, `.getFile().text()` and `.createWritable()`. Electron and Capacitor each provide objects of that shape. A third adapter backed by the extension host's `vscode.workspace.fs`, called over `postMessage`, fits the same pattern. CLAUDE.md requires exactly this: "implement it once against the handle shape".
- **The parser and serializer are pure** (`js/markdown/*`), with byte-faithful round-trip. They work unchanged anywhere.
- **The AI client is about 50 lines** (`js/ai/client.js`): one `fetch` to `https://api.anthropic.com/v1/messages`.

### What the codebase makes expensive

- **The app has its own document and lifecycle model.**
  - A single active document lives in `js/state/store.js`.
  - A two-stage save: Ctrl/⌘+S commits a section in memory, and Ctrl/⌘+Shift+S writes to disk (`js/main.js` about lines 1838–1866, SPEC "Editing").
  - Per-file dirty tracking and a **cross-file Changes panel**.
  - **localStorage crash-recovery snapshots** (`js/core/recovery.js`, key `mdDashboard.recovery.v2`).
  - Quit guards: `window.__mdOrchestraIsDirty` for Electron, and `beforeunload` (`js/main.js` about line 661).

  VS Code has its own model for all of this: `TextDocument` dirty state, Ctrl+S, hot exit and backups, and revert. Two models for the same file is the core architectural tension of this ADR.
- **The UI depends on localStorage** (12 keys or key families: 10 UI preferences, plus the AI settings and the recovery snapshots). They are listed in the plan. Persistence of `localStorage` inside a VS Code webview across webview disposal or a VS Code restart is **not documented**. VS Code's webview guide documents only `getState`/`setState` (plus `WebviewPanelSerializer`) as the persistence mechanism. This is unverified and must be tested in the spike.
- **`index.html` loads four libraries from cdnjs at runtime**: highlight.js, markdown-it, DOMPurify and mermaid. It also has two inline `<script>` blocks (theme bootstrap and mermaid init).
  - A webview needs a strict Content-Security-Policy. VS Code's guide recommends starting from `default-src 'none'`, which implicitly disables inline scripts. So the libraries must be **vendored** and the inline scripts moved to files or given a nonce.
  - Note that the Electron and Android builds load these same CDN scripts today. That is an existing deviation from SPEC's local-first and "nothing is uploaded or synced" spirit. It is outside this ADR, but worth an issue of its own.
- **Platform branches already exist outside `js/core/`.** There are 9 `isElectron`/`isCapacitor` sites:
  - `js/main.js:661, 819, 1192, 1376, 2090, 2127, 2146`
  - `js/ui/settingsPanel.js:47, 147`

  A third platform adds an `isVSCode` decision at most of them.
- **`js/main.js` is 2,184 lines**, the maintainer is a single person, and there are known open reliability gaps (#13, #17, plus [RELIABILITY_ARCHITECTURE_REVIEW.md](../RELIABILITY_ARCHITECTURE_REVIEW.md)). Every platform added multiplies the manual test matrix. CLAUDE.md notes that Electron and Android are already tested manually only.

### Relevant VS Code platform facts (checked 2026-11-18 against code.visualstudio.com docs and `vscode.d.ts` on `main`)

**Custom Text Editor** (`CustomTextEditorProvider`)
- The editor is a webview bound to a real `TextDocument`. VS Code owns save, dirty state, hot-exit backup, undo history and revert.
- The extension syncs changes both ways: from the webview to the document via `WorkspaceEdit` and `workspace.applyEdit`, and from the document to the webview via `onDidChangeTextDocument`.
- The docs warn that this two-way sync can create an update loop and recommend minimal edits.
- The docs call this kind of editor "considerably easier to implement" than a fully custom one.

**Custom Editor** (`CustomEditorProvider<CustomDocument>`)
- The extension owns the document. It must implement `saveCustomDocument`, `saveCustomDocumentAs`, `revertCustomDocument` and `backupCustomDocument` itself.
- Per `vscode.d.ts`, `backupCustomDocument` is triggered about 1 s after edits stop and is not invoked when auto save is on.
- `CustomDocumentContentChangeEvent` marks the document dirty without undo support. `CustomDocumentEditEvent` supports undo.

**Registration options**
- With `priority: "option"`, the editor is opt-in ("Reopen With…") rather than replacing the default for `*.md`. The docs recommend this for editors that are not the obvious default.
- The docs recommend `supportsMultipleEditorsPerDocument: true`.

**Webview panels and views**
- `WebviewPanel` is a free editor-area tab not bound to a document. `WebviewView` is a webview in the sidebar or panel (`registerWebviewViewProvider`).
- Webviews are described as "resource heavy" and to be used only when native APIs are inadequate.
- `retainContextWhenHidden` keeps a hidden webview alive at "high memory overhead".
- `getState`/`setState` is "the preferred way to persist state".
- Local files must be loaded via `webview.asWebviewUri` and be inside `localResourceRoots`.
- Theme colours are exposed as `--vscode-*` CSS variables.
- A panel's close **cannot be vetoed** by the extension. There is no `beforeunload` equivalent. This is my understanding of the API surface, since there is no veto hook in `vscode.d.ts`. Confirm it in the spike.

**Storage and secrets**
- `ExtensionContext.secrets` (`SecretStorage`) is stored encrypted and "not synced across machines". This is the right home for the Claude API key.
- `globalState`/`workspaceState` are Mementos. `setKeysForSync` opts keys into Settings Sync.

**Filesystem**
- `vscode.workspace.fs` (`readFile`, `writeFile`, `readDirectory`, `stat`, `delete`, `rename`, `createDirectory`) works for local, remote (SSH/WSL/containers) and virtual workspaces.
- `workspace.createFileSystemWatcher` gives external-change events. SPEC lists the lack of these as a known gap.

**Web extensions** (vscode.dev and github.dev)
- They need a `browser` entry point, a single bundled file, run in a WebWorker without Node APIs, use `workspace.fs` only, and every `fetch` must pass CORS.
- Tested with `@vscode/test-web`.
- Whether the full webview UI behaves identically on vscode.dev was **not verified** for this ADR.

**Publishing**
- Use `@vscode/vsce` (`package`/`publish`). The icon must be a PNG of at least 128 px, and vsce rejects SVG icons and SVG README images.
- **Global Azure DevOps PATs retire on 2026-12-01.** Microsoft now recommends Trusted Publishing via GitHub Actions OIDC (`vsce publish --oidc`).
- Open VSX, which VSCodium and other forks use, is a separate registry with its own publishing flow. I did not research its current details for this ADR.

## Decision drivers

In priority order:

1. **No data loss, and no silent overwrite of the user's file.** This is SPEC's strongest guarantee. A VS Code delivery must never write over a file that VS Code's own editor holds dirty, and must never lose edits on a webview close.
2. **One codebase, adapter pattern.** Implement once against the handle shape (CLAUDE.md), not fork the UI.
3. **Honesty to the host.** In VS Code, Ctrl+S, dirty dots, hot exit and Source Control are what users trust. A second, competing save model surprises users.
4. **Local-first and no backend.** These still hold: the only network calls are the opt-in Claude call (and the user-triggered GitHub fetch).
5. **Maintenance cost for a single maintainer**, including a third manual test matrix and the marketplace operations burden.
6. **Feature reach.** How much of the dashboard (multi-file Explorer, Workspace map, cross-file Changes) survives.

## Options considered

### Option A: Custom Text Editor per `.md` file (`priority: "option"`)

MD.Orchestra opens as an alternative editor for a single Markdown file through "Reopen With… → MD.Orchestra". The webview hosts the existing UI in single-document mode. Every in-app mutation is serialized and applied to the `TextDocument` as a minimal `WorkspaceEdit`. External edits to the `TextDocument` are re-parsed into the view.

**Pros**
- It is honest to VS Code. Ctrl+S, the dirty dot, hot exit, undo/redo, revert and git diff work because VS Code owns the document. Remote workspaces should work because the host uses only `vscode.*` APIs; that is expected but unverified. Live Share is unverified and doubtful for webview-based custom editors.
- Side-by-side with the plain text editor stays in sync by construction. External changes (git checkout, another editor) arrive through `onDidChangeTextDocument`, which closes a SPEC known gap in this mode.
- No custom save, backup or quit-guard code is needed. `recovery.js`, the quit guards and the two-stage save are simply turned off in this mode.
- It needs the smallest extension-host surface (one provider, about 150–300 lines) and is the documented easy path.

**Cons**
- It is **single-file**. The Explorer, the Workspace map, cross-file link navigation and the cross-file Changes panel do not fit one editor-per-document. Cross-file links could open another custom editor tab via a command, but the dashboard's multi-file identity is lost.
- The app's **two-stage save disappears**: every section commit becomes a document edit and therefore dirty, and Ctrl+S writes to disk. This is a SPEC change (see Consequences).
- Every in-app edit needs serializer → diff → `WorkspaceEdit`. Round-trip fidelity already exists, but the minimal-range diff and the echo-loop suppression are new code.
- `store.js`'s whole-doc replacement on reload must not reset the user's scroll or selection on every echo.

### Option B: Dashboard as a `WebviewPanel` (plus an optional `WebviewView` launcher), with a `vscodeFsAdapter`

A command "MD.Orchestra: Open Dashboard" opens a full editor-area panel running the whole app, including multi-workspace mode. A new `js/core/vscodeFsAdapter.js` builds handle-shaped objects whose methods `postMessage` to the extension host, which performs `vscode.workspace.fs` calls restricted to the workspace folders. This mirrors the Electron allowlist.

**Pros**
- **Maximum reuse and feature parity.** The Explorer, map, Changes panel and recovery stay as they are. This is the cleanest fit to the existing adapter pattern.
- It works for multi-root workspaces, since each `workspace.workspaceFolders` entry maps naturally to an MD.Orchestra workspace.

**Cons**
- **It bypasses VS Code's document model.** If `notes.md` is open and dirty in a normal VS Code tab and the dashboard saves the same file through `workspace.fs`, one side's edits are silently clobbered. This violates driver 1. Mitigation would require:
  - the extension refusing to write a file that appears dirty in `workspace.textDocuments`, or routing those writes through `WorkspaceEdit` and `document.save()`;
  - a `FileSystemWatcher` to detect external changes.

  The app has neither today.
- **The dashboard cannot veto a panel close.** The SPEC requirement "quitting is blocked by any open file with unsaved changes" cannot be met. Unsaved state must instead be streamed to the extension host on every change (into `globalState` or `storageUri`) and offered for restore on reopen. That is a host-side reimplementation of `recovery.js`, because webview localStorage persistence is unverified.
- **There are two save models in one window**: VS Code's Ctrl+S, plus the dashboard's own dirty indicator and Changes panel.
- To keep its state while hidden, it needs either `retainContextWhenHidden` (high memory) or full state rehydration through `setState` and a `WebviewPanelSerializer`.

### Option C: Hybrid, with A as the editing surface and a read-mostly B for navigation

- The editing surface is Option A's Custom Text Editor.
- A sidebar `WebviewView` or `WebviewPanel` renders the Explorer and Workspace map from `workspace.fs` reads, **read-only**. Clicking a heading opens that file in the custom editor scrolled to the section.
- Cross-file Changes could reuse VS Code's own Source Control and dirty-editor list instead of the app's panel.

**Pros**
- It keeps VS Code as the single owner of writes, satisfying drivers 1 and 3, and still delivers the navigation value that distinguishes MD.Orchestra.

**Cons**
- It needs the most integration code.
- It needs a "read-only map mode" in `main.js` that doesn't exist yet.
- Two webviews double the resource use.
- It is phased: it only makes sense after A is proven.

### Option D: Don't do it (stay Electron + Android)

**Pros**
- No third platform, no third manual test matrix, no marketplace operations (publisher account, token migration, review of listing assets), and no SPEC rewrites.
- Effort stays on the open reliability work (#13, #17, the RELIABILITY review), which benefits every existing user.
- VS Code users already have a decent built-in Markdown preview and outline, so the incremental value is uncertain.

**Cons**
- It forgoes the audience that lives in VS Code. They must context-switch to a separate app and lose VS Code's git, search and remote features while editing.
- The Electron app duplicates much of what VS Code already provides (file access, remote, external change detection, backups). Option A gets those features free.

### Option E (noted, not recommended): Custom Editor with `CustomDocument`

The extension owns a document model, so it could keep MD.Orchestra's own save semantics and multi-section state per file. It still has all of A's single-file limits, plus it reimplements save, save-as, revert and backup. It also loses sync with VS Code's text editor for the same file. It has the costs of A and B combined with no unique benefit.

## Decision (recommendation, pending the owner)

**Recommended: run a spike of Option A (no time estimate; it ends when its exit criteria are met or fail). Decide between A→C, B, or D based on the spike's exit criteria and the owner's answer to Open Question 1. Do not commit to a full-parity extension up front.**

Rationale:

- Option A is the only option that satisfies drivers 1 and 3 by construction rather than by new mitigation code. It is also the cheapest to prove or disprove.
- Option B maximizes reuse (driver 2), but it trades that for a write path that can silently clobber a dirty VS Code editor, and for an unmeetable quit-guard requirement. Both hit the top driver.
- If the owner's answer to Q1 is "the dashboard must stay multi-file and own its saves," B becomes the candidate. It should then ship only with the mitigations listed above as hard requirements, not follow-ups.
- **Option D is a legitimate outcome.** If the spike shows the webview can't host the UI cleanly (storage, CSP, keybindings), or if Q4 says the reliability backlog comes first, stop. Record this ADR as **Deferred**.

The step-by-step plan, with phases spike → MVP → parity → publish, is in [docs/VSCODE_EXTENSION_PLAN.md](../VSCODE_EXTENSION_PLAN.md).

## Consequences

### If A, or A then C, is accepted

**Code**
- Add a new top-level `vscode-extension/` folder with its own `package.json`. The root `package.json`'s `main` is the Electron entry, and vsce packages a folder's own manifest.
- Add a copy step, analogous to `build:web-assets` / `cap:sync`, that syncs `index.html`, `js/`, `css/`, `icons/` and the vendored libraries into it.
- Add a new host-detection flag `isVSCode` (`typeof acquireVsCodeApi === 'function'`) and a new `js/core/vscodeBridge.js` module for message passing.
- The UI gains a **"hosted single-document mode"**: no Explorer or file pickers, no recovery or Changes panel, no quit guards, and save delegated to the host.
- Replace localStorage UI preferences with a small storage shim (`js/utils/storage.js`): localStorage everywhere else, `vscode.getState/setState` plus a host-side `globalState` mirror in VS Code. All the keys move behind it, which also benefits the other platforms by removing scattered `try/catch` boilerplate.
- In VS Code mode, the Claude call moves to the extension host. The webview posts `{type:'ai', prompt...}` and the host calls the API with the key from `context.secrets`. The key never enters the webview, and Node `fetch` avoids CORS.
- Vendor highlight.js, markdown-it, DOMPurify and mermaid locally. This is needed for the webview CSP, and recommended for Electron and Android too, as a separate issue.
- Relative images (`![](img/x.png)`) in rendered Markdown will not load in a webview unless `render.js` rewrites them via a host-provided base URI (`asWebviewUri`) within `localResourceRoots`. Images pasted by the app are `data:` URIs (`js/ui/imageAttach.js`) and are fine under `img-src data:`.

**Proposed SPEC.md changes** (to be applied in the implementing PR, not now)
1. **Platforms table:** add a row: *"VS Code extension | Proposed/Experimental | `vscode.workspace.fs` via the extension host (local, remote, virtual workspaces) | Single-document Custom Text Editor; VS Code owns save/dirty/backup"*.
2. **Editing:** the Ctrl/⌘+S and Ctrl/⌘+Shift+S semantics become per-host.
   - In VS Code, Ctrl/⌘+S is VS Code's Save (to disk) and Ctrl/⌘+Shift+S is Save As. Section commits are implicit (each commit is a document edit).
   - Ctrl/⌘+K (search) collides with VS Code's chord prefix and needs a different binding there.
   - Alt+N and `?` must be checked against VS Code's defaults.
3. **Change tracking and saving:** the cross-file Changes panel and the "switching files stashes a recovery snapshot" behavior apply to the standalone apps. In VS Code, VS Code's own dirty editors and Source Control are the cross-file view.
4. **Closing and quitting guard:** in VS Code this is delegated to VS Code's own unsaved-changes prompt, which works because VS Code owns the document under Option A. Under Option B, SPEC would have to state explicitly that a panel close cannot be blocked and that unsaved state is persisted host-side instead.
5. **Crash recovery:** in VS Code, hot exit and backups replace the `localStorage` snapshots.
6. **AI integration:** "a user-supplied API key stored locally" becomes, in VS Code, "stored in VS Code SecretStorage (OS keychain-backed, not synced)". The call is made from the extension host, not the renderer.
7. **Data guarantees:** add "the VS Code extension sends no telemetry of its own". VS Code's own telemetry is outside this project's control and should be noted as such.
8. **Known gaps:** in VS Code mode, the "no detection of a file changed externally" gap does not apply.

**Proposed CLAUDE.md changes**
1. **Commands:** add `npm run vscode:sync` (copy web assets into `vscode-extension/`), `npm run vscode:package` (`vsce package`), and how to run the Extension Development Host (F5, or `code --extensionDevelopmentPath=vscode-extension`).
2. **Architecture → filesystem bullet:** add the VS Code adapter or bridge as a third backend, and restate that the handle-shape rule still applies.
3. **Testing bullet:** the suite is no longer purely "single-project, browser-only".
   - Webview UI tests stay in Playwright, using a `VSCODE_STUB` that fakes `acquireVsCodeApi`, alongside `CAPACITOR_STUB` in `tests/helpers.js`.
   - Extension-host tests run under `@vscode/test-cli`/`@vscode/test-electron` as a separate `npm run test:vscode`.
4. **"Don't report a bug as fixed until…":** add the VS Code case. After merging, the owner must run `vscode:sync` and either "Developer: Reload Window" in the Extension Development Host, or rebuild and reinstall the `.vsix` (`code --install-extension …`) and reload.
5. **Repo workflow:** marketplace publishing credentials (OIDC trusted publishing) and who triggers a publish.

### If B is accepted instead

Everything above applies except SPEC item 4. In addition:
- `js/core/vscodeFsAdapter.js` (handle-shaped, host-backed);
- a host-side write guard against dirty `TextDocument`s;
- a `FileSystemWatcher`;
- host-side recovery persistence;
- a `WebviewPanelSerializer`.

### If D is accepted

- Mark this ADR **Deferred**, and record the trigger that would reopen it (for example, user demand, or main.js being split up).
- Independently consider vendoring the CDN libraries for the existing apps.

## Risks

| Risk | Likelihood | Impact | Mitigation / how we'd notice |
|---|---|---|---|
| Webview `localStorage` does not persist reliably across webview disposal or VS Code restart (unverified) | Medium | Preferences reset. Under B, recovery loss | Storage shim backed by `setState` and `globalState`. Spike exit criterion |
| VS Code intercepts Ctrl+S / Ctrl+K / Ctrl+Shift+S in a focused webview, or the app's `preventDefault` swallows VS Code's Save (unverified which) | High | Confusing save semantics, possible no-op save | Hosted mode drops the app's own Ctrl+S handlers and remaps search. Spike exit criterion |
| ES-module relative imports via `asWebviewUri` and the CSP `script-src ${webview.cspSource}` don't work as expected without a bundler (unverified) | Low–Medium | The no-bundler ethos breaks for this target | Spike exit criterion. Fallback: a bundling step for the extension build only |
| Mermaid needs `style-src 'unsafe-inline'`, and possibly more, under CSP | High | Slightly weaker CSP | Accept `'unsafe-inline'` for styles only. Scripts stay nonce/`cspSource`-only |
| Echo loop or cursor jumps between `WorkspaceEdit` and `onDidChangeTextDocument` (Option A) | Medium | Janky editing, lost caret | Version counters plus ignoring self-originated changes. Minimal-range edits |
| Silent clobber of a dirty VS Code editor (Option B only) | High without mitigation | Data loss, violating SPEC | Hard requirement: a dirty-document write guard |
| Third platform slows fixes on Electron and Android; `main.js` grows more branches | High | Maintenance drag | Hosted mode as one isolated module rather than scattered `if (isVSCode)`. Revisit after the MVP |
| Marketplace operations: PAT retirement (2026-12-01), publisher identity, listing rules (no SVG) | Certain (one-off) | Blocked publish | OIDC trusted publishing from GitHub Actions. PNG icon already exists (`icons/icon.png`) |
| vscode.dev / web-extension support behaves differently (CORS, no Node) | Unknown | Feature unavailable on the web | Treat web as out of scope for the MVP. Spike check only |
| OS drag-and-drop of files onto the webview behaves differently from Electron (unverified) | Medium | The drop-to-open feature is missing | In VS Code, opening files goes through VS Code itself. Drop is optional in hosted mode |

## Spike and MVP results (issue #51, branch `feature/vscode-extension`)

Status stays **Proposed**. Phase 0 and Phase 1 of the plan were built together on that branch, following the owner's answers to Q1–Q3:
- sync, with VS Code owning save;
- single-file first;
- VS Code's Ctrl/⌘+S and Ctrl/⌘+Shift+S win, and search is disabled in hosted mode.

Everything marked **verified** below was run on 2026-11-18 against VS Code 1.147.0, downloaded by `@vscode/test-electron` (`npm run test:vscode`). It was also run against the unpacked `.vsix` contents (`MDO_EXTENSION_PATH`), and against VS Code 1.90.0, the `engines.vscode` floor (`MDO_VSCODE_VERSION=1.90.0`). On this machine 1.90's GPU process needed `MDO_LAUNCH_ARGS="--disable-gpu-sandbox --in-process-gpu"`. **Unverified** means not exercised; those items are in TESTING.md's VS Code manual checklist.

| # | Outcome | Evidence |
|---|---|---|
| S1 | **Verified: works, no bundler.** `<script type="module">` via `asWebviewUri`, under `script-src 'nonce-…' ${cspSource}`, loads the whole relative-import graph of `js/`. | The webview's `ready` message is posted from the last line of `js/main.js`, so it is only sent once every import has resolved. A probe then reports hljs, markdown-it, DOMPurify and mermaid all present, with zero script errors. |
| S2 | **Partly verified.** (a) Hide, then show: with `retainContextWhenHidden: false` the webview reloads; `localStorage` and `setState` both survive. With `true`, which the extension now uses (see the next section), it is not reloaded at all. (b) Close, then reopen: `localStorage` survives; `getState` is empty (expected without a serializer). (c) Reload Window and (d) full restart: **unverified**. | Under extension tests, VS Code keeps all its storage in memory (`useInMemoryStorage: !!extensionTestsLocationURI` in its main process). That includes the memento in which the workbench keeps each webview's origin (`getOrigin(viewType, extensionId)` → `generateUuid()` → `saveMemento()`). So a second test launch gets a new `vscode-webview://` origin and an empty `localStorage` by construction. Read from the code, the origin is persisted per (viewType, extension), so preferences should survive in real use. That has to be checked by hand. The planned storage shim (`js/utils/storage.js`, backed by `globalState`) was prototyped and backed out, because the need for it is not shown. It is the owner's call whether to add it anyway. |
| S3 | **Partly verified.** In VS Code 1.147's webview frame (`pre/index.html`, `handleInnerKeydown`), the frame calls `preventDefault` on undo/redo, save, find and print inside the webview. It also forwards **every** keydown to the workbench, whether or not the page itself called `preventDefault`. So the app's handlers could never block VS Code's Save. Without hosted mode, the app's Ctrl+S, Shift+S, Shift+P and K handlers would fire **as well as** VS Code's commands. | Hosted mode returns before handling those combinations. Playwright verifies that the app neither handles them nor calls `preventDefault` on them. A real keypress in a real webview: **unverified**. A consequence: Ctrl/⌘+Z inside a field runs VS Code's document Undo, not the field's own undo. |
| S4 | **Verified.** | See the list after this table. |
| S5 | **Verified.** A mermaid SVG renders, highlight.js highlights code, and DOMPurify is active, with **zero** `securitypolicyviolation` events. The CSP is `default-src 'none'; img-src ${cspSource} data: https:; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; script-src 'nonce-…' ${cspSource}; connect-src 'none'`. | Not measured: whether `style-src 'unsafe-inline'` is strictly needed. It was kept for mermaid's inline `<style>`. |
| S6 | **Verified.** A relative `![](img.png)` loads. | The host sends `documentBaseUri = asWebviewUri(dirname(document.uri))` and adds that folder to `localResourceRoots`. `render.js` resolves relative `img src` against it, and only when it is set, so no other platform is affected. |
| S7 | **Verified against a mock endpoint.** | The host's `fetch` sends the `context.secrets` key as `x-api-key`, and the reply is relayed. The key is absent from every host→webview message, from webview `localStorage` and from `setState`. With no key, the error reads "No Claude API key configured". A call with a real key: **unverified** (owner). |
| S8 | **Unverified** (manual). Expected to work, because VS Code owns the `TextDocument` and backs it up. | TESTING.md manual checklist. |
| S9 | Not attempted (web is out of scope, Q6). | |

The S4 checks:
- An in-app edit arrives as exactly **one** content change: a pure insertion of only the added characters, made by a common-prefix/suffix diff that never splits a CRLF or a surrogate pair.
- The tab turns dirty, and `document.save()` writes the file to disk.
- The webview's dirty flag follows VS Code's.
- No echo: zero `externalChange` messages go back to the originating editor.
- An edit typed in a split plain-text editor reaches the webview, keeps the selected heading (matched by slug, since parsing assigns fresh ids), and is not written back.
- Two MD.Orchestra editors on one document stay in sync.
- VS Code's `undo` and `redo` commands revert and re-apply a webview edit. `workbench.action.files.revert` restores the disk text and clears dirty in the webview.

Other findings:
- **Byte-identical round trip: verified.** Opening and saving an untouched file posts no edit and leaves the bytes unchanged. This holds for an LF fixture and for a CRLF fixture with trailing spaces and no final newline. The webview compares against `serialize(parse(text))` taken at load time, so a document whose round trip is lossy is only rewritten when the user actually edits it.
- **Echo suppression** records the expected `document.version` and text *before* calling `applyEdit`. That way the order in which the change event and `applyEdit`'s promise arrive doesn't matter. The order itself was not measured.
- **Save right after typing.** The app's fields debounce their edits by up to 900 ms. An `onWillSaveTextDocument` participant asks the webview to flush and returns the remaining edit as `TextEdit`s. Verified: text typed and saved immediately with `workbench.action.files.save` is on disk. `TextDocument.save()` is a no-op on a clean document, so the test has to use the command, as Ctrl+S does.
- **Three data-loss cases were found by tests and then fixed.** The basic S4 checks above did not cover them.
  1. **A tab switch within the debounce window lost the edit.** This happened with `retainContextWhenHidden: false`: a hidden webview is torn down, and no event (`visibilitychange`, `pagehide`, `blur`, `beforeunload`) reached the host. With `true`, the webview's `blur` fires and the edit lands. The extension therefore uses **`retainContextWhenHidden: true`**, which costs memory per open MD.Orchestra tab. **Owner decision:** keep `true`, or go back to the plan's `false` and accept this loss.
  2. **Autosave stole focus.** The first flush blurred the active field, as the standalone app's Ctrl+S does. With `files.autoSave: afterDelay`, every autosave then dropped focus to `<body>` mid-typing. Section and note fields now register a VS Code-only synchronous flusher through the store's existing `registerPendingFlush` (`registerHostedFieldFlush` in `js/hostedMode.js`). The flush no longer blurs anything, and this is verified. Electron, Android and the browser don't register these flushers.
  3. **A stale webview edit reverted an external change.** The webview always sends the whole document. An edit it made before seeing a newer change (split editor, VS Code undo, another MD.Orchestra tab) was diffed against the new text, which silently undid that change. Now:
     - each load/externalChange carries a `syncId`, which the webview echoes with every edit;
     - the host rebases a stale edit onto the current text (`rebaseEdit` in `minimalEdit.js`), so both survive, as verified;
     - if the two edits overlap, the webview's edit is **refused**: VS Code shows a warning and the view reloads, as verified. That edit is lost. **Owner decision:** whether the other side should win instead.
- **Not covered by the fixes above:** closing an MD.Orchestra tab within a second of typing. The close tears down the webview, and whether its `blur` arrives first is not verified. The case is on the manual checklist.
- **Hosted mode needed more gates than the plan listed.** Without them:
  - Ctrl/⌘+Shift+P would open the app's palette as well as VS Code's;
  - a dropped file would have replaced the bound document, and its content would then have been written over it;
  - the dirty indicator's click would have downloaded a copy of the file;
  - a relative link would have navigated the webview away.
- **Packaging:** `npx @vscode/vsce package` produces a 1.24 MB `.vsix` with 97 files. The vendored libraries are 3.4 MB of that before compression. It installs with `code --install-extension` and lists as `md-orchestra-placeholder.md-orchestra@0.0.1`. The publisher is a placeholder (Q5).
- **Not done:** cross-file links don't scroll to a `#heading` in the opened file, and the GitHub button is hidden, which allows `connect-src 'none'`.
- **Unverified:**
  - Remote-SSH and WSL. The manifest no longer claims `virtualWorkspaces`, since non-`file` schemes were never exercised.
  - Live Share.
  - The real keyboard path.
  - Hot exit.
  - Preference persistence across restarts.
  - Closing a tab right after typing.
  - The memory cost of `retainContextWhenHidden: true`.
  - Typing performance on large documents.
  - A real Claude key.

## Open questions for the owner

1. **Sync or own?** Must an edit made in MD.Orchestra and an edit made in VS Code's plain text editor for the same file stay in sync, with VS Code owning save, dirty state and backup? Or must the dashboard keep its own multi-file save model? "Sync" points to A then C. "Own" points to B with mandatory guards. This is the deciding question.
2. **Is single-file acceptable for the MVP?** Specifically, an MVP without the Explorer, the Workspace map and the cross-file Changes panel, with navigation (C) added later.
3. **Is it acceptable to change the save semantics in VS Code** (Ctrl+S saves to disk, no section-commit stage)? Which binding should replace Ctrl+K search there?
4. **Priority versus the reliability backlog** (#13, #17, the RELIABILITY review). Should the spike wait until those are closed?
5. **Distribution:**
   - VS Marketplace only, or also Open VSX (VSCodium, Cursor and others)?
   - Which publisher ID?
   - Is GitHub Actions OIDC acceptable for publishing?
6. **vscode.dev / github.dev support:** is it in scope at all? It would require a bundled `browser` entry for the extension host code.
7. **Telemetry:** confirm the extension ships with none (recommended, consistent with SPEC).
8. **Vendoring:** should the CDN libraries be vendored for Electron and Android at the same time, as a separate issue? This is recommended either way.
