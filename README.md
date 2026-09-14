# Markdown Insight Dashboard

An AI-assisted dashboard that reads a Markdown document, presents it as a
navigable set of colored cards, lets you capture notes and Claude-generated
suggestions against any section, and writes everything back into a single
Markdown file on request.

`doc_flowchart.html` is the earlier flowchart-style prototype and is kept
as-is for reference; it is not part of the dashboard described below.

## Running it

No build step. Serve the folder statically (opening `index.html` directly
via `file://` will break `fetch()`-based sample loading and AI calls):

```bash
python3 -m http.server 8000
# open http://localhost:8000/index.html
```

## Using it

1. Load a document: use **Open .md file** (grants direct save-back on
   Chrome/Edge), drag/drop, or load one of the bundled samples (`sample.md`,
   `sample2.md`, `sample3.md`).
2. Browse the heading tree in the sidebar — collapsed to just the active
   path by default, click the ▸ chevrons to expand others — or open
   **🗺️ Map** for a one-screen diagram of the whole document; the main
   panel drills into whatever section you pick and shows its own content
   plus a card grid of its subsections. In-document links (e.g. a Table of
   Contents) jump to the right section instead of doing nothing.
3. Click a card's insight icon to open the AI popup: get a Claude summary,
   clarity suggestions, and optionally insert the suggestion straight into
   that section.
4. Use the notes field on a card to add your own notes; they're stored
   against that section. Use **✎ Edit content** / the pencil next to the
   title to change the section's actual content and heading text (not just
   an annotation), and **🗑 Delete section** to remove it. A section titled
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
   title, heading level, and which existing section to nest it under —
   picked from a collapsible tree of the whole document (the same
   interaction as the sidebar) rather than reading down a flat dropdown.
6. Click **💾 Save** any time — it writes straight back to the file if it
   was opened with **Open .md file**, otherwise it downloads the current
   Markdown. It's the only save control in the app, and it glows while
   there are unsaved changes. The **Source** panel is read-only, for
   double-checking the generated Markdown or copying it elsewhere.
7. Open **Settings** to provide your Anthropic API key and pick a Claude
   model. The key is stored only in `localStorage` on your machine and is
   sent directly to `api.anthropic.com` — never to any other service.

## Architecture

Plain ES modules, no bundler, so every piece can be opened and debugged in
isolation:

```
index.html          shell: header, sidebar, main panel, side panels
css/                 base, layout, cards, modal, animation styles
js/
  markdown/          parser.js (md -> section tree), serializer.js (tree -> md),
                     render.js (section -> sanitized HTML: tables, code,
                     mermaid, <details>), slug.js (GitHub-compatible heading
                     anchors), toc.js (regenerate a Table of Contents)
  state/store.js      single source of truth + pub/sub
  ai/                 client.js (Claude fetch), prompts.js, settings.js
  ui/                 sidebar, breadcrumb, card grid (incl. inline title/
                     content editing), insight modal, code viewer, notes
                     panel, settings/source panels, add-section modal +
                     tree picker, map view, markdownEditing (list
                     continuation / indent / bold-italic-code shortcuts,
                     attached to every raw-Markdown textarea), toast
  utils/              dom (incl. an SVG-element helper)/debounce/id/color
  main.js             wires everything together
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
  `sample.md`, `sample2.md`) committed as-is.
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
