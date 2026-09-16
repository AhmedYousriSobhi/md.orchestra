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

Legend: **Manual** = walked through by hand in a real browser/Electron
build; **Playwright** = has (or should have) an automated check using this
project's existing Playwright-based testing approach (browser, via the dev
server, or Electron, via Playwright's `_electron` launcher).

### Document loading

| # | Test | Method |
|---|---|---|
| 1 | Open a single `.md` file via the picker | Playwright |
| 2 | Drag-and-drop a `.md` file onto the page | Playwright |
| 3 | Open a folder with nested subfolders and mixed file types (only `.md`/`.markdown` are picked up, dotfiles/dotfolders skipped) | Playwright |
| 4 | Open a second, then a third folder without closing the first — all three remain independently listed | Playwright |
| 5 | Open the same folder twice — handled gracefully (no duplicate/broken state) | Manual |
| 6 | A workspace file linking to another file in the same folder (`[x](y.md)`) navigates there; a link to a file outside the folder, or a normal URL, is left alone | Playwright |

### Editing & undo

| # | Test | Method |
|---|---|---|
| 7 | Type into a section body — autosaves (debounced) into the in-memory doc, dirty indicator updates | Playwright |
| 8 | Ctrl/⌘+Z inside a section textarea undoes the last *keystroke-level* edit, preserving native browser undo (not just the app's own section-level Undo) | Playwright |
| 9 | The section's own "↩ Undo" button steps back one full edit (content, note, title, AI insert, ToC regenerate) at a time, independent of other sections | Playwright |
| 10 | Undoing a section back to exactly its last-saved content clears its dirty state — it must not still show as "unsaved changes" | Playwright |
| 11 | Renaming a section's title (Enter/Escape handling) reaches the sidebar and breadcrumb immediately | Manual |
| 12 | Deleting a section removes it and everything nested under it | Playwright |
| 13 | "+ New section" at a specific tree position (before/after/inside a given heading) lands exactly there, with the right heading level | Playwright |
| 14 | Dragging a heading in the sidebar to reposition/re-nest it re-levels its whole subtree correctly | Manual |
| 15 | A section titled "Table of Contents" offers "🔄 Regenerate from headings," and it reflects the document's *current* structure even if the ToC was just edited seconds ago (no stale-content race) | Playwright |
| 16 | A section's textarea is sized to fit its whole content by default (no manual resize needed to see the rest) | Playwright |

### View modes

| # | Test | Method |
|---|---|---|
| 17 | A short/simple document defaults to Full text; a longer/more-structured one defaults to Sections | Manual |
| 18 | Toggling Full text ↔ Sections preserves the current edit rather than discarding it | Playwright |
| 19 | Editing the raw source directly in Full text view re-parses into the same section structure Sections view would show | Manual |

### Workspace navigation & map

| # | Test | Method |
|---|---|---|
| 20 | Explorer's focal-neighborhood graph expands one directory level at a time, collapses deep subtrees into a "+N" node until clicked | Playwright |
| 21 | The 🗺️ Map's Workspace mode lays out the whole open folder as a node-link tree; clicking a folder expands/collapses it, clicking a file opens it | Playwright |
| 22 | Every node's label renders in full (no over-truncation) at its computed box width, across a range of file/folder name lengths | Playwright |
| 23 | Map's Tree mode (single document's own heading structure) and Mind map mode both still work independently of Workspace mode | Manual |
| 24 | Closing a workspace forgets its map/graph expansion state (doesn't leak into a differently-named folder opened later) | Manual |

### Saving & the Changes panel

| # | Test | Method |
|---|---|---|
| 25 | Ctrl/⌘+S commits whatever's currently focused (without writing to disk); Ctrl/⌘+Shift+S writes the whole file to disk | Playwright |
| 26 | The dirty indicator accurately reflects unsaved state at all times, including immediately after an Undo that returns to baseline | Playwright |
| 27 | The Changes panel's header count and its row list always agree — no "0 changes" header with a file still listed | Playwright |
| 28 | Switching to a different file while the current one is dirty never discards anything — it's recoverable from the Changes panel | Playwright |
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
| 34 | Switching System/Light/Dark appearance applies immediately and persists across reloads | Playwright |
| 35 | The Anthropic API key field: saved only to `localStorage`, never logged/transmitted anywhere but `api.anthropic.com` | Manual |
| 36 | The in-app Keyboard Shortcuts panel (Settings → Keyboard shortcuts, or `?`) lists every shortcut actually wired up in `main.js` | Manual |

### Electron desktop shell

| # | Test | Method |
|---|---|---|
| 37 | The native folder/file picker opens instead of a browser upload dialog | Manual |
| 38 | The last-opened folder reopens automatically on the next launch, without a fresh permission prompt | Playwright (Electron) |
| 39 | Clicking the window's own ✕ with unsaved changes shows a real Quit/Cancel dialog; with nothing unsaved, it closes immediately | Playwright (Electron) |
| 40 | A path outside every folder/file the user has explicitly opened is rejected by the main-process IPC handlers (allowlist enforcement) | Playwright (Electron) |

### Responsive & accessibility

| # | Test | Method |
|---|---|---|
| 41 | The layout remains usable at a narrow (mobile-width) viewport — sidebar becomes an overlay rather than squeezing the main panel | Manual |
| 42 | Every interactive control (cards, map nodes, panel buttons) is reachable and operable via keyboard (Tab, Enter/Space), with a visible focus state | Manual |
| 43 | Toggling the sidebar or resizing the preview panel doesn't leave any section's textarea at a stale height for its now-different width | Playwright |

## Running the checks

This project has no bundled CI test runner today — every Playwright check
referenced above was written and run ad hoc against the dev server
(`npm run web`, then Playwright's Python or Node bindings driving a real
Chromium/Electron instance) over the course of development, not as a
committed, repeatable suite. Turning the table above into an actual
`test/` suite that runs on demand (rather than re-deriving these checks by
hand each time) is a natural next step, not yet done.
