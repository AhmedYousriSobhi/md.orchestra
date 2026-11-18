# VS Code extension: start plan

The how-to-start companion to [ADR 0001](adr/0001-vscode-extension.md) (status: **Proposed**). Nothing here is approved work. Following [CLAUDE.md](../CLAUDE.md), each phase below starts with its own GitHub issue and the owner's explicit go-ahead, on its own branch, with `Resolves #N` in the PR.

**Phases:** Spike (gate) → MVP (Option A, single-file Custom Text Editor) → Parity (Option C navigation, or Option B if the owner chooses it) → Publish.

This plan deliberately gives no time estimates: the owner does not trust them, and none were measured. Phases are ordered by dependency and gated by exit criteria, not by dates. Everything after the spike depends on what the spike finds.

---

## Phase 0: Spike

**Goal:** prove or disprove that the existing UI can run inside a VS Code webview, bound to a `.md` `TextDocument`, without forking `js/`. The answers decide between A, B and D.

### Steps

1. **Scaffold a throwaway extension** in `vscode-extension/`, on branch `spike/vscode-extension`, which is never merged as-is. Use plain CommonJS JavaScript for the host side, with no TypeScript and no bundler, to match the repo's ethos.

   ```
   vscode-extension/
     package.json        # name, publisher (placeholder), engines.vscode, main: ./extension.js,
                         # contributes.customEditors: [{ viewType: "mdOrchestra.editor",
                         #   displayName: "MD.Orchestra", selector: [{ filenamePattern: "*.md" }],
                         #   priority: "option" }]
     extension.js        # activate(): registerCustomEditorProvider(viewType, provider,
                         #   { webviewOptions: { retainContextWhenHidden: false },
                         #     supportsMultipleEditorsPerDocument: true })
     media/              # filled by a copy step: index.html, js/, css/, icons/, vendor/
   ```

2. **Copy the UI over** with a `vscode:sync` script, following the existing `build:web-assets` pattern. It copies `index.html js css icons` into `vscode-extension/media/`.

3. **Vendor the four CDN libraries** into `vendor/`, at the exact versions currently pinned in `index.html`:
   - highlight.js 11.9.0 (the script plus the atom-one-dark CSS)
   - markdown-it 13.0.2
   - DOMPurify 3.1.6
   - mermaid 10.9.1

4. **Generate the webview HTML in `extension.js`** from `media/index.html`:
   - Rewrite every `src`/`href` through `webview.asWebviewUri(...)`.
   - Set `localResourceRoots` to `[media/]`, plus the document's folder for relative images. That second root is a spike question in its own right.
   - Inject a CSP:

     ```
     default-src 'none';
     img-src ${cspSource} data: https:;
     style-src ${cspSource} 'unsafe-inline';
     font-src ${cspSource};
     script-src 'nonce-${nonce}' ${cspSource};
     connect-src https://api.anthropic.com https://api.github.com https://raw.githubusercontent.com;
     ```

   - Give the two inline `<script>` blocks (theme bootstrap and mermaid init) the nonce. Moving them to files is fine too.

5. **Write a minimal bridge.** On `resolveCustomTextEditor`, post `{type:'load', text, fileName}`. In the webview, behind `isVSCode`, call the existing load path (`loadDocument` with `parseMarkdown(text)`) instead of showing the empty state. On any store change, post `{type:'edit', text: serializeMarkdown(doc)}`, and have the host apply it as a whole-document `WorkspaceEdit`. Making it minimal-range comes later.

6. **Measure the questions below.** Write each answer into the spike issue with a screenshot or log.

### Spike questions (each one is an exit criterion; "unverified" in the ADR until answered)

| # | Question | How to check |
|---|---|---|
| S1 | Does `<script type="module" src=asWebviewUri(main.js)>` load its **relative imports** under the CSP above, with no bundler? | DevTools console ("Developer: Open Webview Developer Tools") |
| S2 | Does webview `localStorage` survive (a) hiding the tab and showing it again, (b) closing and reopening the editor, (c) "Reload Window", (d) a full VS Code restart? | Set a key, check after each case |
| S3 | With the webview focused, what happens on Ctrl/⌘+S, Ctrl/⌘+Shift+S and Ctrl/⌘+K? Does VS Code's command fire, the app's handler fire, or both? Does the app's `preventDefault` block VS Code's Save? | Keyboard plus the Output channel log |
| S4 | Does an edit in the webview mark the tab dirty? Does Ctrl+S save it? Does "Revert File" and does a split-view plain text editor stay in sync both ways, without an echo loop? | Manual |
| S5 | Do mermaid, highlight.js and DOMPurify render under the CSP? Which `style-src` was actually needed? | A fixture with mermaid and code blocks (`tests/fixtures/demo-workspace`) |
| S6 | Does a relative image `![](img.png)` render? What rewrite would `render.js` need? | A fixture with a sibling image |
| S7 | Does the Claude call work **from the extension host**, with the key from `context.secrets`? (Uses a real key, so the owner runs it, or mock it.) | Host-side `fetch` |
| S8 | Does hot exit work? Edit, then quit VS Code with `files.hotExit` at its default, relaunch, and check whether the dirty content is restored into the custom editor. | Manual |
| S9 | (Optional) Does the same build load in `code --extensionDevelopmentKind=web` / `@vscode/test-web`? | Only if the owner says the web is in scope (ADR Q6) |

### Exit criteria and the decision gate

- S1, S4 and S5 pass → A is viable, so proceed to Phase 1.
- S1 fails → either add a bundling step for the extension build only (owner's call, since it breaks the "no bundler" ethos for this target), or stop with D.
- S4 shows unworkable sync (echo loops, caret loss that minimal edits can't fix) → reconsider B (with its mandatory guards) or D.
- S2 fails → a storage shim becomes a hard requirement for the MVP (it is already planned below).
- Update ADR 0001 with the results. Its status stays Proposed until the owner decides.


---

## Phase 1: MVP, single-file Custom Text Editor (Option A)

**Goal:** an installable `.vsix` that opens any `.md` file in MD.Orchestra's Sections, Full-text, Outline and Map views. Notes, tags and AI insights work. VS Code owns save, dirty state, undo and backup.

### Steps and files

1. **Make a permanent `vscode-extension/`** (written fresh, not the spike code). It contains:
   - `package.json`, with `engines.vscode` set to a caret range at least two minor releases old, `"icon": "icon.png"` copied from `icons/icon.png`, and `"capabilities": {"untrustedWorkspaces": {"supported": "limited"}}` (to be confirmed in review).
   - `extension.js` (activation and registration).
   - `editorProvider.js` (the `CustomTextEditorProvider`).
   - `webviewHtml.js` (HTML templating, CSP and nonce).
   - `aiProxy.js` (the Claude call from the host).
   - `README.md` (the marketplace listing, PNG images only), `CHANGELOG.md`, `LICENSE` (MIT, copied) and `.vscodeignore`.

2. **Root `package.json` scripts:**
   - `"vscode:sync": "rm -rf vscode-extension/media && mkdir -p vscode-extension/media && cp -r index.html js css icons vscode-extension/media/ && cp -r vscode-extension/vendor vscode-extension/media/vendor"`
     - The four libraries are vendored inside `vscode-extension/vendor/`.
     - `webviewHtml.js` rewrites the four cdnjs tags in `index.html` to `media/vendor/` at runtime, so Phase 1 does not depend on step 3 being accepted.
     - If step 3 is accepted, point this at the root `vendor/` instead and drop the rewrite.
   - `"vscode:package": "npm run vscode:sync && cd vscode-extension && npx @vscode/vsce package"`
   - `vscode-extension/media/` goes in `.gitignore`, the same way `web-dist/` is a build product.

3. **Tighten the CSP from the spike's.** Once AI is proxied through the host (step 8) and the GitHub button is hidden in hosted mode, set `connect-src 'none'`. Also decide whether `img-src https:` stays: it lets a document pull remote images, which is a local-first consideration for the owner.

   **Optional: vendor the libraries for every platform** (separate issue, recommended). Add a `vendor/` folder at the root, and change `index.html` to load the local copies. This removes the runtime CDN dependency for Electron and Android too. It changes Electron and Android behavior, so it gets its own issue.

4. **Add `js/core/vscodeBridge.js`** (new, webview side):

   ```js
   // Only module that touches acquireVsCodeApi(); everything else imports from here.
   export const isVSCode = typeof acquireVsCodeApi === 'function';
   const api = isVSCode ? acquireVsCodeApi() : null;   // must be called exactly once
   let seq = 0; const pending = new Map();
   export function request(type, payload) {              // promise-based RPC over postMessage
     const id = ++seq; api.postMessage({ id, type, ...payload });
     return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
   }
   export function onHostMessage(handler) { /* window 'message' listener; resolves pending ids, forwards the rest */ }
   export const vscodeState = { get: () => api?.getState() ?? {}, set: (s) => api?.setState(s) };
   ```

5. **Add a hosted single-document mode** in `js/main.js`, isolated in a new `js/hostedMode.js` rather than scattered `if (isVSCode)` checks:
   - On `{type:'load'|'externalChange', text}`: parse and `loadDocument`. On `externalChange`, preserve `selectedId` and scroll if the node still exists.
   - Hide or disable the open-file, open-folder, GitHub and add-file buttons, the Explorer section, the Changes button and the recovery panel. In VS Code mode the sidebar shows only the Outline.
   - Skip `snapshotIfDirty`, the `beforeunload` / `__mdOrchestraIsDirty` registration and `reopenLastElectronFolder`. The hosted mode owns these decisions, so `main.js` gets one `if (!hosted)` gate per subsystem rather than per call site.
   - Map the store's `dirty` flag from VS Code, not the other way round. After each in-app mutation, post `{type:'edit', text}`. The host replies with the document's `isDirty`, which drives the dirty indicator.
   - Keybindings: remove the app's Ctrl/⌘+S and Ctrl/⌘+Shift+S handlers in hosted mode, so VS Code's Save and Save As win. Rebind search away from Ctrl/⌘+K to a binding decided by the owner (ADR Q3), contributed through `contributes.keybindings` with `when: activeCustomEditorId == 'mdOrchestra.editor'`.

6. **Write `editorProvider.js`** (host side):
   - `resolveCustomTextEditor(document, panel)`: set up the HTML, post the initial `load`, and subscribe to `workspace.onDidChangeTextDocument` filtered to `document.uri`.
   - Edit application: compute the minimal changed range between `document.getText()` and the incoming text (common prefix and suffix). Apply one `WorkspaceEdit.replace`, and record `document.version` after applying, so the resulting change event is recognised as self-originated and not echoed back.
   - External changes (version not ours) → post `externalChange`.
   - Dispose the listeners on `panel.onDidDispose`.

7. **Storage shim, `js/utils/storage.js`** (new, used on all platforms): `getItem/setItem/removeItem`. In VS Code it uses an in-memory map seeded from `vscodeState.get()` and the host's `globalState` (sent with `load`), and writes through to both. Elsewhere it uses localStorage.

   These keys move behind it:
   - `md-dashboard-theme` (`js/utils/theme.js` and the inline bootstrap in `index.html`)
   - `mdDashboard.aiSettings.v1` (`js/ai/settings.js`), minus `apiKey` in VS Code
   - `mdDashboard.docViewMode` (`js/ui/docViewMode.js`)
   - `mdDashboard.explorerCollapsedWorkspaces` (`js/ui/filesPanel.js`)
   - `mdDashboard.previewScope` and `mdDashboard.previewOpen` (`js/ui/previewPanel.js`)
   - `md-orchestra:content-zoom:*` (`js/ui/pinchZoomText.js`)
   - `mdDashboard.sidebarSectionsCollapsed`, `mdDashboard.previewWidth` and `mdDashboard.sidebarSplit` (`js/main.js`)
   - `mdDashboard.lastElectronFolder` (`js/main.js`): unused in VS Code
   - `mdDashboard.recovery.v2` (`js/core/recovery.js`): disabled in VS Code under Option A

8. **AI via the host:**
   - `js/ai/client.js` gains an `isVSCode` branch: `request('ai', {model, system, prompt, maxTokens})`. All error-message mapping stays in one place.
   - Host side, `aiProxy.js` does the same `fetch` with `context.secrets.get('mdOrchestra.claudeApiKey')`. In VS Code the `anthropic-dangerous-direct-browser-access` header isn't needed, but it is harmless.
   - In VS Code mode the Settings panel's key field calls `request('setApiKey')` / `request('clearApiKey')` and never displays the stored key.
   - Add a command `MD.Orchestra: Set Claude API Key` that uses `window.showInputBox({password:true})`.

9. **Theme:** map the app's CSS tokens onto `--vscode-*` variables when `body.vscode-dark` / `vscode-light` / `vscode-high-contrast` is present. Do this in a new `css/vscode.css`, loaded only in hosted mode. Default to following VS Code's theme rather than the app's own toggle.

10. **Relative images:** the host sends `documentBaseUri = webview.asWebviewUri(dirname(document.uri))` with `load`, and `render.js` resolves relative `img src` against it when set. The document's folder goes into `localResourceRoots`. It is a small, isolated change.

11. **Cross-file links** (`[x](other.md)`): post `{type:'openLink', href}`. The host resolves it against `document.uri` and runs `vscode.openWith(uri, 'mdOrchestra.editor')`.

### Exit criteria

- Install the `.vsix` with `code --install-extension`, then use "Reopen With → MD.Orchestra" on any `.md` in a local folder. All of these must hold:
  - the Sections, Full text, Outline and Map views work;
  - edits mark the tab dirty;
  - Ctrl/⌘+S writes to disk;
  - undo, redo and Revert behave;
  - split view with the plain text editor stays in sync both ways;
  - hot exit restores unsaved work.
- An untouched file opened and saved is **byte-identical** (SPEC round-trip guarantee).
- Notes, tags and AI insight insertions persist across closing and reopening, because they are in the Markdown.
- The API key is never present in webview memory or state, which you can check in Webview DevTools.
- The existing Playwright suite still passes, with Electron and Android behaviour unchanged.
- The same `.vsix` works in a Remote-SSH or WSL window. That is expected because the host uses only `vscode.*` APIs, but it must be checked.

### Test strategy

- **Webview UI (the bulk):**
  - Extend the Playwright suite. Add a `VSCODE_STUB` to `tests/helpers.js`, alongside `CAPACITOR_STUB`. It defines `window.acquireVsCodeApi` returning a fake `{postMessage, getState, setState}` that records outbound messages and lets a test dispatch inbound `message` events.
  - New `tests/vscode-hosted.spec.js` covers:
    - load → render;
    - an edit posts the right text;
    - `externalChange` preserves the selection;
    - the Ctrl+S handlers are absent;
    - the AI call goes through `request` and not `fetch`.
  - This keeps CLAUDE.md's single Chromium project intact.
- **Extension host:**
  - Add `@vscode/test-cli` and `@vscode/test-electron` under `vscode-extension/`, with a separate `npm run test:vscode`. It downloads a VS Code build, which is not part of `npm test`.
  - Cover the provider's edit application (minimal range, self-echo suppression), link resolution, and SecretStorage get/set, using a temporary workspace fixture.
  - Note: this needs a display, or `xvfb-run` on Linux CI.
- **Manual checklist:** add a "VS Code" section to `TESTING.md` for S3, S4 and S8-style behaviour that can't be automated reliably (keybindings, hot exit, remote windows).


---

## Phase 2: Parity, workspace navigation

The owner picks one path at the end of Phase 1, informed by ADR Q1 and Q2.

### 2C (recommended): read-only navigation views (Option C)

1. Contribute a `WebviewView` in a new activity-bar container ("MD.Orchestra"). It renders the Explorer graph and Workspace map for each `workspace.workspaceFolders` entry.
2. **Host-side reads only.** `workspace.findFiles('**/*.{md,markdown}', excludes)` plus `workspace.fs.readFile` feed parsed outlines to the view. Reuse `js/core/searchIndex.js` for search.
3. Clicking a file or heading posts `openAt {uri, headingSlug}`. The host opens the custom editor and forwards `selectSection`.
4. Freshness: `workspace.createFileSystemWatcher('**/*.md')`, plus `onDidChangeTextDocument` for open, dirty documents. The map reflects unsaved content, as SPEC's "dirty state always visible" expects.
5. The cross-file "Changes" view is replaced by VS Code's own Source Control and dirty-editor indicators. Optionally add a `TreeView` (native, not a webview) listing dirty MD.Orchestra documents.
6. File creation, deletion and rename use VS Code's own Explorer. Don't rebuild them (SPEC non-goal: not a file manager).


### 2B (only if the owner chooses "dashboard owns saves"): full dashboard panel (Option B)

Hard requirements, which are not follow-ups:

1. **`js/core/vscodeFsAdapter.js`**: handle-shaped objects backed by host RPC. It mirrors `electronFsAdapter.js` method for method, so `workspaceIO.js` stays unchanged:

   ```js
   import { request } from './vscodeBridge.js';
   export function makeVSCodeFileHandle(uri, name) {
     return {
       kind: 'file', name, path: uri,
       async getFile() { const text = await request('fs.readFile', { uri }); return { text: async () => text }; },
       async createWritable() {
         let buf = '';
         return { write: async (c) => { buf += c; }, close: async () => { await request('fs.writeFile', { uri, text: buf }); } };
       },
     };
   }
   export function makeVSCodeDirHandle(uri, name) {
     return {
       kind: 'directory', name, path: uri,
       async *entries() { for (const c of await request('fs.readDir', { uri })) yield [c.name, c.kind === 'directory' ? makeVSCodeDirHandle(c.uri, c.name) : makeVSCodeFileHandle(c.uri, c.name)]; },
       async getFileHandle(name, { create } = {}) { /* request('fs.stat'); NotFoundError-named throw, exactly as electronFsAdapter.js */ },
       async removeEntry(name) { await request('fs.delete', { uri: `${uri}/${name}` }); },
     };
   }
   ```

   It is wired into `workspaceIO.js`'s backend choice (`openDirectoryPicker`, `reopenWorkspaceAtPath`) as a third branch. On first load, the workspace folders are offered instead of a picker.

2. **Host allowlist:** `fs.*` handlers reject any URI outside `workspace.workspaceFolders`. This is the equivalent of `electron/main.js`'s allowlist, and is enforced host-side regardless of what the webview sends.

3. **Dirty-document write guard:** `fs.writeFile` first checks `workspace.textDocuments` for the same URI.
   - If the document is open and **dirty**, refuse and surface a conflict to the user.
   - If it is open and **clean**, write via `WorkspaceEdit` + `document.save()` so open editors stay consistent.
   - Otherwise, write with `workspace.fs.writeFile`.

4. **External-change detection:** a `FileSystemWatcher`. When a file the dashboard has dirty changes on disk, surface it. Never overwrite silently.

5. **Host-side recovery:** the webview posts each recovery snapshot to the host, which stores it in `context.storageUri` (per workspace, on disk). The reason is that the panel close cannot be vetoed, and webview localStorage persistence is unverified (S2). `recovery.js` goes behind the storage shim with a host-backed implementation.

6. A `WebviewPanelSerializer`, so the dashboard reopens after a restart.


---

## Phase 3: Publish

1. **Owner decisions:** the publisher ID, Marketplace only or also Open VSX, and versioning. Pre-release uses odd minor versions per vsce's convention.
2. **Listing assets:**
   - a PNG icon of at least 128 px (`icons/icon.png` exists);
   - `vscode-extension/README.md` with PNG screenshots only, since vsce rejects SVG README images;
   - `CHANGELOG.md`, `LICENSE`, and a `repository` field.
3. **CI** with `.github/workflows/vscode-extension.yml`:
   - On a PR: `npm test` plus `npm run test:vscode` (xvfb) plus `vsce package` as an artifact.
   - On a tag: `vsce publish --oidc`. Azure DevOps global PATs retire on 2026-12-01, so set up Trusted Publishing (GitHub OIDC) from the start.
   - Open VSX, if chosen, needs its own token and `ovsx publish`. Its current authentication requirements were not researched for this plan.
4. **First publish as `--pre-release`.** Gather feedback, then promote.
5. **Docs**, in the same PR as the first publish:
   - Apply the SPEC.md and CLAUDE.md changes listed in ADR 0001 → Consequences.
   - Add a `docs/VSCODE.md` (build, run, debug, verified-vs-manual, in the style of `docs/ANDROID.md`).
   - Add a `MORE.md` index entry.
   - Add a `CHANGELOG.md` stage entry.
   - Set ADR 0001 to **Accepted**.


---

## Summary of phases and gates

| Phase | Gate |
|---|---|
| 0 Spike  | S1/S4/S5 pass. Owner answers ADR Q1 |
| 1 MVP (A)  | Exit criteria above. Owner approves the save-semantics SPEC change |
| 2C Navigation  | Owner wants multi-file navigation in VS Code |
| 2B Dashboard (alternative to 2C)  | Only with all hard requirements |
| 3 Publish  | Owner decides on the publisher and registries |

**Ongoing cost:** a third manual test checklist on every UI change, tracking VS Code API and engine updates, and marketplace operations.  This cost has not been measured. Weigh it against ADR Option D.
