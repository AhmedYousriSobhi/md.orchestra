# MD.Orchestra

An AI-assisted dashboard that reads a Markdown document — or a whole directory of them — presents it as a navigable set of colored cards, lets you capture notes and Claude-generated suggestions against any section, and writes everything back into the source Markdown file(s) on request.

## Running it

No build step. Serve the folder statically (opening `index.html` directly
via `file://` will break `fetch()`-based AI calls):

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
   Chrome/Edge) or drag/drop a file — or use **📁 Open folder** to load a
   whole directory of them at once (several folders can be open
   simultaneously; each keeps its own identity). Standalone files and
   folders can be open side by side too.
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
   edit a workspace file, switch to a standalone file without saving
   first, edit that too). **📝 Changes**, in the header, lists every one
   of them — like
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
its subfolders — dotfiles/dotfolders like `.git` are skipped) and adds it
to the sidebar's **Explorer** pane. Opening a second (or third...) folder
adds it alongside the first rather than replacing it — each open
directory keeps its own identity (files, navigation state, folder-fold
state), the way a VSCode multi-root workspace treats each folder as
independent. The button relabels to **Add folder** once one is already
open.

The sidebar is two fixed, independently-collapsible panes: **Explorer**
always shows every open directory (each as a focal-neighborhood graph —
one hop of the current directory at a time, deeper subfolders collapsed
into a "+N" node until expanded) plus any standalone files, regardless of
which one is currently active; **Outline** below it always shows the
active document's own heading breakdown. Neither reorders or hides itself
based on what you're editing. Each open folder can be individually folded
down to just its header (a small chevron on its own row, remembered across
reloads); a standalone file gets its own row too, grouped under an "Open
files" label, and stays listed — whether or not it has unsaved changes —
until you explicitly close it.

Switching between any two files — a different file in the same folder, a
file in a *different* open folder, or a standalone file — never asks for
confirmation and never loses anything: whatever you were on gets flushed
to a recovery snapshot first if it's dirty, and switching back to a file
with pending edits restores them exactly as you left them (see **📝
Changes** above). Closing a folder (✕ on its own row) only affects that
folder's own active file, if any; every other open folder is untouched.

A relative Markdown link in one file's content — `[the guide](sub/guide.md)`,
or with an anchor, `[a step](sub/guide.md#some-heading)` — resolves against
the other files in the *same* folder and switches to that file (and jumps
to the matching heading) instead of doing nothing or trying to navigate
the browser away; a link to something outside that folder (including a
different open folder), or a normal external URL, is left completely
alone. On Chrome/Edge this uses the File System Access API
(`showDirectoryPicker`), which keeps a live handle per file so **Save**
writes straight back to disk for every one of them, the same guarantee
**Open .md file** already gives a single file. Firefox has no such API, so
there `📁 Open folder` falls back to an `<input webkitdirectory>` —
everything else works identically, but without a live handle **Save**
downloads instead (again, exactly like opening a single file without the
File System Access API).

The 🗺️ **Map** button's third mode, **Workspace**, lays out an entire open
folder's structure (every file and subfolder) as one force-directed graph,
the same style as the single-document Mind map — click a file node to
open it.

## Architecture

Plain ES modules, no bundler, so every piece can be opened and debugged in
isolation:

```
index.html          shell: header, sidebar (Explorer + Outline), main panel, side panels
manifest.json, sw.js, icons/   installable app shell (see AI integration
                     section below the data model)
Dockerfile, docker-compose.yml, .dockerignore   nginx-served container
css/                 base, layout, cards, modal, animation styles
js/
  markdown/          parser.js (md -> section tree), serializer.js (tree -> md),
                     render.js (section -> sanitized HTML: tables, code,
                     mermaid, <details>; also resolves a rendered link
                     against the active workspace file), slug.js
                     (GitHub-compatible heading anchors), toc.js (regenerate
                     a Table of Contents), diff.js / sectionMerge.js
                     (per-section change tracking, for the Changes panel)
  state/store.js      the single active document + pub/sub (fileName,
                     fileHandle, selectedId, dirty, and which open
                     workspace/relPath it belongs to, if any)
  state/workspace.js   every currently-open directory (several can be open
                     at once, each its own independent identity: file
                     registry, folder tree, relative-link resolution)
  core/               fileIO.js (single-file read/write, incl. File System
                     Access), workspaceIO.js (reads a directory — File
                     System Access on Chrome/Edge, an <input webkitdirectory>
                     fallback elsewhere), recovery.js (per-file crash-recovery
                     snapshots in localStorage)
  ai/                 client.js (Claude fetch), prompts.js, settings.js
  ui/                 sidebar.js (heading tree, drag-and-drop to relocate
                     sections), filesPanel.js (Explorer: one block per open
                     workspace, each individually foldable, plus a
                     standalone-file "Open files" group), focalGraph.js (the
                     one-hop-at-a-time directory graph each Explorer block
                     renders, with per-workspace navigation state),
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
                     detection), mapView.js (Tree / Mind map / Workspace
                     modes) + mindMap.js's live, cursor-reactive
                     force-directed graph renderer (shared by the Mind map
                     and Workspace modes), markdownEditing.js (list
                     continuation / indent / bold-italic-code shortcuts,
                     attached to every raw-Markdown textarea), toast.js
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
  (`js/core/fileIO.js`, used by **Save**) was verified with a mocked
  file handle (confirms it requests `readwrite` permission and writes the
  correct content) rather than a real native file-picker dialog, which
  headless testing can't drive. The download fallback path was verified
  directly and works.
- The self-test's round-trip checks (`test/parser.selftest.html`) require
  the project to be served over HTTP (see *Running it*) — they silently
  skip under `file://` because `fetch()` can't read local files that way.
- The document map (🗺️) lays every heading out in one screen with its own
  scroll region, sized for the typical case; a document with hundreds of
  headings will still need to scroll within that region to see all of it.

## Progress log

See [CHANGELOG.md](CHANGELOG.md) for the full stage-by-stage development
history.
