# SPEC

The functional specification for MD.Orchestra: what the product is supposed to do,
independent of how it's implemented (that's [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md))
or which real-world scenarios it's checked against (that's [TESTING.md](TESTING.md)'s
use-case list). New features and bug fixes should be checked against this document;
if a change makes this document wrong, update it in the same change.

## Purpose

A local-first Markdown workspace dashboard: open one `.md` file or a whole folder of
them, navigate by heading instead of by scrolling, edit any section in place, and
have every change land back in plain `.md` files on disk — no database, no proprietary
format, no account, no server holding the data.

## Platforms

| Platform | Status | Filesystem access | Notes |
|---|---|---|---|
| Electron desktop (Linux) | Primary, supported | Real OS filesystem, unrestricted within picked folders/files | `npm start` / packaged AppImage via `./build-desktop.sh` |
| Android | Supported | Real device filesystem via Android's native folder/file picker | Built via `./build-android.sh`; see [docs/ANDROID.md](docs/ANDROID.md) for what's verified vs. still manual |
| Browser dev server (`npm run web`) | Development convenience only | File System Access API — no persisted folder across a reload | Not an equivalent deployment; do not treat bugs unique to this mode as blocking unless they also affect Electron/Android |
| Static-web/Docker (pre-Electron) | Archived | — | Lives on the `legacy/browser-only-v1` branch, not maintained |

## Core functional requirements

### Opening documents
- Open a single `.md` file, or an entire folder as a "workspace."
- Multiple workspaces and/or standalone files may be open simultaneously, each an
  independent identity (its own dirty state, its own save target).
- A relative Markdown link (`[see also](other-note.md)`) between two files in the same
  open workspace navigates to that file within the app, not out to the OS.

### Navigating
- Every Markdown heading is a navigable node, not just scroll-to-anchor text: the
  Explorer (one-hop-at-a-time directory/heading graph) and the Workspace map
  (full-directory node-link graph, with Tree / Mind map / Workspace layout modes)
  both let you click through structure without reading the raw document first.
- Breadcrumb navigation shows the current drill-down path and lets you jump back to
  any ancestor, including the file's own synthetic root.

### Editing
- Clicking a heading's card edits that section in place — no separate "enter edit
  mode" step.
- Ctrl/⌘+S commits the current section's edit into the in-memory document.
  Ctrl/⌘+Shift+S writes the whole document to disk.
- Reorganizing structure (promoting a subsection, re-nesting one under another) is
  done by dragging headings in the sidebar outline, with automatic re-leveling of the
  moved subtree — not manual cut/paste of raw Markdown.
- Per-section notes and AI-generated insights can be attached to a section without
  altering the section's own Markdown content, and can be discarded independently of
  it (see Changes panel below).

### Change tracking and saving
- The document's dirty state (unsaved vs. up to date) is always visible.
- A "Changes" panel lists every unsaved edit, across every open file/workspace at
  once, per-section, with the ability to review, save, or discard each independently.
- Switching the active file while the current one is dirty never silently discards
  the edit: the in-progress edit is stashed into a recovery snapshot first (see
  below), and the switch surfaces that non-destructively (a toast, not a blocking
  confirm — see `js/main.js`'s `snapshotNow({ notify })` and issue #11) rather than
  either interrupting the switch or looking identical to a real silent discard.
- Closing a file that has unsaved changes (the active file's own close action) does
  block with an explicit discard-confirmation dialog.

### Crash recovery
- Edits are periodically stashed into a `localStorage`-backed recovery snapshot per
  file (debounced, not synchronous with every keystroke).
- On launch, if recoverable snapshots exist, the app explicitly offers to restore
  them file by file — it never silently drops unsaved work, and never silently
  overwrites the real on-disk file with a guessed recovery.
- A restored snapshot must resolve to a real, writable file location before the app
  treats it as fully "open" the same way a freshly opened file is — a snapshot whose
  original workspace isn't open this session is a known gap (issue #13) rather than
  an accepted behavior; any fix here should ensure Save always writes back to the
  file's real original location, or makes clearly visible that it can't.

### AI integration
- Optional, opt-in: calls go directly from the app to `https://api.anthropic.com/v1/messages`
  with a user-supplied API key stored locally. No backend/proxy, no other provider.
- AI output is inserted the same way a manual note is — attached to a section,
  discardable without touching the section's own content.

## Data guarantees

- A document round-trips: opening and re-saving a file you didn't touch reproduces
  its structure and content byte-faithfully (verbatim `bodyMarkdown` per section,
  see `js/markdown/parser.js` / `serializer.js`).
- Notes and AI insertions are stored inside the Markdown itself (between marker
  comments), so they survive a reload/reopen without a side-channel database and
  without duplicating on repeated loads.
- Nothing is ever uploaded or synced anywhere except the explicit, opt-in Claude API
  call the user's own action triggers.

## Non-goals

- Not a general-purpose file manager — filesystem operations are scoped to Markdown
  workspace management (open, browse, create/delete/rename within an opened folder),
  not arbitrary file operations.
- Not a real-time multi-user collaboration tool.
- Not a hosted/synced service — every deployment target is local-first by design;
  this is a deliberate product constraint, not a missing feature.
- True lazy per-directory loading (fetching a folder's children only on expand,
  rather than one recursive scan at open time) is an explicitly deferred follow-up,
  not part of this spec's current scope — see the Electron-shell plan history in
  `docs/ARCHITECTURE.md`/`CHANGELOG.md` if picking this up.

## Known gaps (tracked, not silently accepted)

See [docs/RELIABILITY_ARCHITECTURE_REVIEW.md](docs/RELIABILITY_ARCHITECTURE_REVIEW.md)
and [docs/UI_UX_REVIEW.md](docs/UI_UX_REVIEW.md) for the full audits. Notably:
no detection of a file changed externally (git, another editor) while open here;
the document map lays a very large document/folder out in one scrollable region
rather than paginating or virtualizing it.
