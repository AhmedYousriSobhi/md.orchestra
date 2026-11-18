# Use Cases & Test Plan

Two things this document is not: a bug tracker, or a substitute for reading
the code. It's the answer to two questions — *who is this for, concretely*,
and *what has to keep working for them* — kept in one place so a change to
one area of the app can be checked against the scenarios it's actually
supposed to serve.

## Use cases

Concrete scenarios MD.Orchestra is designed around, each with the specific
features that scenario depends on.

### 1. A personal Markdown notes vault (Obsidian/Notion-style, offline)

Open a folder of personal notes as a workspace, browse it via the Explorer
and the Workspace map, jump between notes through relative links
(`[see also](other-note.md)`), and keep editing directly — no account, no
sync service, no data leaving the machine except the optional Claude calls.
*Depends on:* folder open + Explorer, in-document/cross-file link
resolution, the Workspace map, local-only settings/API key storage.

### 2. Reviewing a teammate's document before merging

Open a single `.md` file (a PR description, a design doc, a spec), read it
section by section, drop notes and AI-generated suggestions onto specific
sections without touching the actual document content, then either discard
the annotations or fold accepted edits back into the file. *Depends on:*
per-section notes (non-destructive), the AI insight popup, Undo per
section, the Changes panel's Discard action.

### 3. Onboarding into an unfamiliar folder of documentation

Open a whole docs folder for the first time, use the Workspace map to see
its overall shape (which areas are deep, which are shallow) before diving
into any one file, then drill in through the Explorer or by clicking a
file node directly on the map. *Depends on:* the Workspace map's tidy-tree
graph, Explorer click-to-expand navigation, breadcrumb navigation once a
file is open.

### 4. Restructuring a long document

Reorganize a spec or README by dragging headings in the sidebar outline to
reposition or re-nest them (promote a subsection to top-level, nest a
top-level section under another), rather than manually cutting and pasting
raw Markdown and re-deriving heading levels by hand. *Depends on:* the
sidebar outline's drag-and-drop (before/after/inside detection), automatic
re-leveling of a moved subtree.

### 5. A quick, no-ceremony single-file edit

Open one `.md` file directly (not a folder), make a small edit, save it
with a keyboard shortcut, and close the app — no workspace to set up, no
extra dialogs. *Depends on:* "Open .md file," Ctrl/⌘+S (commit the current
section) and Ctrl/⌘+Shift+S (write to disk), the dirty indicator.

### 6. Juggling edits across several files/folders at once

Have two or more folders open simultaneously, edit a file in each without
saving immediately, and use one place to see everything still
unsaved across all of them before deciding what to write to disk and what
to discard. *Depends on:* multi-workspace support (several open folders,
each independent), the Changes panel's cross-file, per-section list.

### 7. Recovering from a crash or an accidental close

The app (or the machine) goes away mid-edit; on the next launch, get an
explicit offer to restore whatever was unsaved, file by file, rather than
silently losing it or silently overwriting the real file with a guess.
*Depends on:* the recovery-snapshot cache, the startup recovery prompt, the
Electron window-close confirmation for unsaved changes.

## Test matrix

Legend: **Automated** = a real, committed test in `tests/*.spec.js` that
runs on demand (see "Running the checks" below) — not just something that
was checked once by hand and never turned into a repeatable test.
**Manual** = walked through by hand in a real browser/Electron build/phone,
with no committed test yet. **Planned** = the same thing this table used to
label "Playwright" for every row, before any of them were actually written
— an intended, not-yet-real check; treat it exactly like "Manual" until a
row is updated to "Automated" with the file that covers it.

### Document loading

| # | Test | Method |
|---|---|---|
| 1 | Open a single `.md` file via the picker | **Automated** — `document-loading.spec.js` |
| 2 | Drag-and-drop a `.md` file onto the page | Planned |
| 3 | Open a folder with nested subfolders and mixed file types (only `.md`/`.markdown` are picked up, dotfiles/dotfolders skipped) | Planned |
| 4 | Open a second, then a third folder without closing the first — all three remain independently listed | Planned |
| 5 | Open the same folder twice — handled gracefully (no duplicate/broken state) | Manual |
| 6 | A workspace file linking to another file in the same folder (`[x](y.md)`) navigates there; a link to a file outside the folder, or a normal URL, is left alone | **Automated** — `document-loading.spec.js` |

### Editing & undo

| # | Test | Method |
|---|---|---|
| 7 | Type into a section body — autosaves (debounced) into the in-memory doc, dirty indicator updates | **Automated** — `preview-and-save.spec.js` |
| 8 | Ctrl/⌘+Z inside a section textarea undoes the last *keystroke-level* edit, preserving native browser undo (not just the app's own section-level Undo) | Planned |
| 9 | The section's own "↩ Undo" button steps back one full edit (content, note, title, AI insert, ToC regenerate) at a time, independent of other sections | Planned |
| 10 | Undoing a section back to exactly its last-saved content clears its dirty state — it must not still show as "unsaved changes" | Planned |
| 11 | Renaming a section's title (Enter/Escape handling) reaches the sidebar and breadcrumb immediately | Manual |
| 12 | Deleting a section removes it and everything nested under it | Planned |
| 13 | "+ New section" at a specific tree position (before/after/inside a given heading) lands exactly there, with the right heading level | Planned |
| 14 | Dragging a heading in the sidebar to reposition/re-nest it re-levels its whole subtree correctly | Manual |
| 15 | A section titled "Table of Contents" offers "🔄 Regenerate from headings," and it reflects the document's *current* structure even if the ToC was just edited seconds ago (no stale-content race) | Planned |
| 16 | A section's textarea is sized to fit its whole content by default (no manual resize needed to see the rest) | Planned |

### View modes

| # | Test | Method |
|---|---|---|
| 17 | A short/simple document defaults to Full text; a longer/more-structured one defaults to Sections | Manual |
| 18 | Toggling Full text ↔ Sections preserves the current edit rather than discarding it | Planned |
| 19 | Editing the raw source directly in Full text view re-parses into the same section structure Sections view would show | Manual |

### Workspace navigation & map

| # | Test | Method |
|---|---|---|
| 20 | Explorer's focal-neighborhood graph expands one directory level at a time, collapses deep subtrees into a "+N" node until clicked | Planned |
| 21 | The 🗺️ Map's Workspace mode lays out the whole open folder as a node-link tree; clicking a folder expands/collapses it, clicking a file opens it | Planned |
| 22 | Every node's label renders in full (no over-truncation) at its computed box width, across a range of file/folder name lengths | Planned |
| 23 | Map's Tree mode (single document's own heading structure) and Mind map mode both still work independently of Workspace mode | Manual |
| 24 | Closing a workspace forgets its map/graph expansion state (doesn't leak into a differently-named folder opened later) | Manual |

### Saving & the Changes panel

| # | Test | Method |
|---|---|---|
| 25 | Ctrl/⌘+S commits whatever's currently focused (without writing to disk); Ctrl/⌘+Shift+S writes the whole file to disk | **Automated (Ctrl/⌘+Shift+S half only)** — `preview-and-save.spec.js` |
| 26 | The dirty indicator accurately reflects unsaved state at all times, including immediately after an Undo that returns to baseline | Planned |
| 27 | The Changes panel's header count and its row list always agree — no "0 changes" header with a file still listed | Planned |
| 28 | Switching to a different file while the current one is dirty never discards anything — it's recoverable from the Changes panel | Planned |
| 29 | Per-section Save/Discard inside the Changes panel acts on just that section, not the whole file | Manual |
| 30 | Saving normally re-opens the Changes panel afterward only if something *else* is still unsaved | Manual |

### Recovery

| # | Test | Method |
|---|---|---|
| 31 | Force-closing the app/tab with unsaved changes, then relaunching, offers to restore them | Manual |
| 32 | Restoring a recovered snapshot re-hydrates the exact section ids (no spurious "changed" diff against itself) | Manual |
| 33 | A corrupted/malformed recovery cache entry is skipped at startup, not thrown as an unhandled error | Manual |

### Settings, theme & shortcuts

| # | Test | Method |
|---|---|---|
| 34 | Switching System/Light/Dark appearance applies immediately and persists across reloads | Planned |
| 35 | The Anthropic API key field: saved only to `localStorage`, never logged/transmitted anywhere but `api.anthropic.com` | Manual |
| 36 | The in-app Keyboard Shortcuts panel (Settings → Keyboard shortcuts, or `?`) lists every shortcut actually wired up in `main.js` | Manual |

### Electron desktop shell

| # | Test | Method |
|---|---|---|
| 37 | The native folder/file picker opens instead of a browser upload dialog | Manual |
| 38 | The last-opened folder reopens automatically on the next launch, without a fresh permission prompt | Planned |
| 39 | Clicking the window's own ✕ with unsaved changes shows a real Quit/Cancel dialog; with nothing unsaved, it closes immediately | Planned |
| 40 | A path outside every folder/file the user has explicitly opened is rejected by the main-process IPC handlers (allowlist enforcement) | Planned |

### Responsive & accessibility

| # | Test | Method |
|---|---|---|
| 41 | The layout remains usable at a narrow (mobile-width) viewport — sidebar becomes an overlay rather than squeezing the main panel | **Automated** — `mobile-sidebar.spec.js` |
| 42 | Every interactive control (cards, map nodes, panel buttons) is reachable and operable via keyboard (Tab, Enter/Space), with a visible focus state | Manual |
| 43 | Toggling the sidebar or resizing the preview panel doesn't leave any section's textarea at a stale height for its now-different width | Planned |

### Mobile layout, touch gestures & the Android shell

Every row here reproduces a real bug this app actually shipped and fixed
during Android development (see `docs/ANDROID.md`'s real-device test
rounds and `CHANGELOG.md` Stages 80–83) — not hypothetical scenarios. None
of this exercises the native Android/Capacitor project itself (no real
device or emulator here — see "What this doesn't cover" below); it's the
same underlying HTML/CSS/JS bug in every case, caught in an ordinary
browser at phone width.

| # | Test | Method |
|---|---|---|
| 44 | The sidebar toggle (☰) opens and closes the drawer at phone width | **Automated** — `mobile-sidebar.spec.js` |
| 45 | Tapping anywhere outside the open sidebar closes it | **Automated** — `mobile-sidebar.spec.js` |
| 46 | The open sidebar renders as the real, clickable top layer even while the preview panel is also open (regression: it used to render invisibly underneath it) | **Automated** — `mobile-sidebar.spec.js` |
| 47 | The preview panel is genuinely hidden with no document loaded, rather than sitting as a full-screen layer over the sidebar (regression) | **Automated** — `mobile-sidebar.spec.js` |
| 48 | Edge-swipe from the screen's left edge opens the sidebar when there's nowhere to go back to, or goes back to the parent section when there is | **Automated** — `mobile-sidebar.spec.js` |
| 49 | Swiping the open sidebar to the left closes it | **Automated** — `mobile-sidebar.spec.js` |
| 50 | The preview panel plays a real entrance animation instead of an instant display cut, and still un-hides per the stored preference once a document loads | **Automated** — `preview-and-save.spec.js` |
| 51 | The mind map's default zoom actually fits its content within the real, current container size (regression: a stale viewport measurement used to center it in a taller *virtual* box than what was visible) | **Automated** — `mindmap.spec.js` |
| 52 | The mind map's Fit button re-measures the container fresh rather than reusing a stale size | **Automated** — `mindmap.spec.js` |
| 53 | Two-finger pinch zooms the mind map | **Automated** — `mindmap.spec.js` |

**What this doesn't cover**, on purpose: the actual Android APK (signing,
the Capacitor native bridge, real SAF folder/file access, the hardware
back button, the status bar) has no Android emulator or device in this
environment to test against — see `docs/ANDROID.md` for how those are
verified instead (decompiling the built APK, reasoning through the native
plugin's own Java source, and real-device test rounds). `tests/helpers.js`'s
`CAPACITOR_STUB` only fakes enough of `window.Capacitor` for the
JS-side logic above to take its Capacitor-only code paths at all — it
proves the app's *own* code is correct, not that the real native bridge
behaves the way the stub assumes it does.

### GitHub repo browsing (read-only)

| # | Test | Method |
|---|---|---|
| 54 | `parseGithubRepoInput` accepts `owner/repo`, a full `github.com` URL (with or without a branch), and a `git@` remote; rejects nonsense | **Automated** — `github-integration.spec.js` |
| 55 | Loading a public repo opens its README and lists every Markdown file (at any depth) in the Explorer | **Automated** — `github-integration.spec.js` |
| 56 | A file nested in a subfolder opens correctly through the Explorer's FocalGraph view | **Automated** — `github-integration.spec.js` |
| 57 | A GitHub-sourced workspace never offers itself as a write target (Add file), and a Save attempt fails with an honest "read-only" message rather than a raw error or silent data loss | **Automated** — `github-integration.spec.js` |

These run against a mocked GitHub API (`tests/helpers.js`'s
`mockGithubRepo`) for determinism and to avoid spending the real
un-authenticated rate limit on every run — the integration was also
verified once, separately, against a real live public repo (see
`docs/ANDROID.md`'s "GitHub repo browsing" section) before any of this
was written.

### VS Code extension (experimental, issue #51)

Two automated layers, plus a manual checklist for what neither can reach.

| Test | Method |
|---|---|
| Webview side, in plain Chromium with `VSCODE_STUB` (`tests/helpers.js`) faking `acquireVsCodeApi()`: load renders and posts no edit; an in-app edit posts the serialized document once; `externalChange` keeps the selected heading; Ctrl/⌘+S, +Shift+S, +Shift+P and +K are neither handled nor `preventDefault`ed; the dirty indicator mirrors the host and asks it to save; the flush request returns a still-debounced edit; the Claude call goes through a host request with no key and no `fetch`; Settings never shows or stores the key; relative links and images; a dropped file can't replace the document; `css/vscode.css` hides the file-management UI | **Automated** — `tests/vscode-hosted.spec.js` (part of `npm test`) |
| Real extension host, in a VS Code build downloaded by `@vscode/test-electron`: the ES-module graph loads under the webview CSP; mermaid, highlight.js, DOMPurify and a relative image render with zero CSP violations; an untouched open + save is byte-identical (LF, and CRLF with no final newline); a webview edit lands as one minimal `WorkspaceEdit`, marks the tab dirty and is not echoed; save writes disk and clears dirty; a split plain-text editor and a second MD.Orchestra editor stay in sync without loops; the undo, redo and Revert File commands; Save right after typing flushes the pending edit; a tab switch, and a close (via revert-and-close), right after typing keep the edit (full-text, section and note fields; `MDO_REPEAT=n` repeats it, `MDO_ONLY=<regex>` selects tests); a hidden-then-shown tab is recreated and restores the selected section, view mode and scroll; `files.autoSave: afterDelay` keeps focus in the field being typed in; a webview edit made before it saw a newer external change is rebased, or, if they overlap, refused with a warning and the view reloaded to exactly the document's text. It never reverts that change; relative `.md` links open in MD.Orchestra; the Claude call uses the SecretStorage key against a mock endpoint and the key never reaches the webview | **Automated** — `npm run test:vscode` (separate from `npm test`; needs a display or `xvfb-run`, and `ELECTRON_RUN_AS_NODE` unset) |
| `minimalEdit.js` (never splits a CRLF or a surrogate pair) | **Automated** — `cd vscode-extension && npm run test:unit` |
| Typing cost per keystroke (webview sync and input-to-paint, long tasks, host apply, message volume) on 10 KB – 5 MB documents, in each field | **Benchmark, run by hand** — `npm run vscode:sync`, then `cd vscode-extension && npm run bench` (`MDO_BENCH='{"sizes":[...],"keys":n,"variants":[{},{"previewOff":true}]}'`). Not part of any default run. |

**Manual checklist** (VS Code extension). Run it on the installed `.vsix`
(`npm run vscode:package`, then `code --install-extension vscode-extension/md-orchestra-*.vsix`),
on a real `.md` in a local folder, via "Reopen Editor With… → MD.Orchestra":

- [ ] **Keyboard (S3):** with focus inside MD.Orchestra (including inside a section's text field), Ctrl/⌘+S saves to disk (tab dot clears), Ctrl/⌘+Shift+S opens VS Code's Save As, Ctrl/⌘+Shift+P opens VS Code's Command Palette (not the app's), Ctrl/⌘+K starts a VS Code chord and opens no app search panel. Alt+N, Alt+A, Alt+M, Alt+P, Alt+V, Alt+R, Alt+, and `?` still work and don't trigger a VS Code command.
- [ ] **Undo in a text field:** Ctrl/⌘+Z while typing in a section field runs VS Code's document Undo, not the field's own undo (VS Code's webview frame intercepts it). Check that this is acceptable, and that a quick type-then-undo loses nothing unexpected.
- [ ] **Hot exit (S8):** make an edit in MD.Orchestra, don't save, quit VS Code (`files.hotExit` at its default), relaunch: the tab is restored dirty with the edit, in MD.Orchestra.
- [ ] **Preferences across restarts (S2 c/d):** change the view mode, preview scope and width, then run "Developer: Reload Window", then fully quit and relaunch VS Code. They should persist. This can't be automated: VS Code keeps all storage in memory during extension tests.
- [ ] **Close prompt:** closing a dirty MD.Orchestra tab shows VS Code's own "Save changes?" prompt.
- [ ] **Close right after typing:** the automated test checks that the typed edit reaches the document before a revert-and-close, with 0 lost in repeated runs. By hand: type in a section field and click the tab's ✕ within a second. VS Code's "Save changes?" prompt appears, and after Save the edit is in the file.
- [ ] **Hide/show keeps your place:** select a section, switch to Sections or Full text, scroll down, then switch to another tab and back. The webview is recreated (`retainContextWhenHidden` is false) and comes back on the same section, view and scroll position.
- [ ] **Typing feel:** measured by `npm run bench` (ADR 0001, "Typing cost"): up to about 1 MB, every field costs ≤ 28 ms per keystroke (p50). Confirm by hand that typing feels immediate in a ~1 MB file, in the full-text, section and note fields. Above about 1 MB the app's own text area and debounced re-parse lag, the same as in the standalone app.
- [ ] **Theme:** switch between a light, a dark and a high-contrast VS Code theme. The editor follows each, and text and borders stay readable.
- [ ] **Real Claude call (S7):** run "MD.Orchestra: Set Claude API Key" with a real key, then use a section's insight action. The call succeeds, and the key never appears in "Developer: Open Webview Developer Tools" (Application → Local Storage, and the console).
- [ ] **Remote:** the same `.vsix` in a Remote-SSH and a WSL window opens, edits and saves a remote `.md`, and relative images render.

## Running the checks

The rows marked **Automated** above are real, committed
[Playwright Test](https://playwright.dev/) specs under `tests/*.spec.js` —
not ad hoc scripts written once and thrown away. They open the app the
same way a person would (as static files served over HTTP, the same
`npm run web` this repo already uses), in a real Chromium instance, at
whichever viewport/gesture combination each check actually needs.

### If you have Node locally

```bash
npx playwright install chromium   # once
npm test                          # runs the whole suite headlessly
```

Other useful forms, straight from the standard Playwright Test CLI:

```bash
npx playwright test tests/mobile-sidebar.spec.js   # just one file
npm run test:headed                                # watch it happen in a real window
npm run test:ui                                    # Playwright's interactive UI mode — step through, re-run one test, inspect the DOM at any point
npx playwright show-report                         # the HTML report from the last run (screenshots + traces for anything that failed)
```

A failing test's trace (`trace: 'on-first-retry'` in `playwright.config.js`)
opens in `npx playwright show-trace test-results/.../trace.zip` — a full
timeline of every action, DOM snapshot, and console/network log for that
run, generally faster to debug from than reproducing the failure by hand.

### If you don't (this sandbox, most CI runners without Node baked in)

```bash
./run-tests.sh
```

Runs the exact same suite in a `node:20-bookworm` Docker container — no
local Node needed, the same idea as `build-android.sh`/`build-desktop.sh`.
It expects Chromium already downloaded to `~/.cache/ms-playwright` (a
one-time `npx playwright install chromium` on any machine with Node, even
briefly, or via
`docker run --rm -v ~/.cache/ms-playwright:/root/.cache/ms-playwright node:20-bookworm npx -y playwright@1.63.0 install chromium`).
Extra arguments pass straight through to `playwright test`, e.g.
`./run-tests.sh tests/mindmap.spec.js`.

### What's still genuinely manual

Everything marked **Manual** or **Planned** above, plus — by construction,
regardless of label — anything that needs a real native environment this
setup can't provide: the actual Electron main process end to end, the real
Android APK (signing, the native Capacitor bridge, real SAF file access,
the hardware back button), and a real touchscreen's actual feel (the
gesture tests fire synthetic `PointerEvent`s with `pointerType: 'touch'`,
which exercises the exact same app code a real finger would, but isn't a
real finger). See `docs/ANDROID.md` for how the Android-specific gaps get
verified instead.
