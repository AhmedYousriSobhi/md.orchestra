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

1. Load a document: drag/drop a `.md` file, use the file picker, or load one
   of the bundled samples (`sample.md`, `sample2.md`, `sample3.md`).
2. Browse the heading tree in the sidebar; the main panel drills into a
   section and shows its own content plus a card grid of its subsections.
3. Click a card's insight icon to open the AI popup: get a Claude summary,
   clarity suggestions, and optionally insert the suggestion straight into
   that section.
4. Use the notes field on a card to add your own notes; they're stored
   against that section.
5. Open the **Source** panel any time to see the live-generated Markdown and
   save it — via the File System Access API (writes back to the opened file)
   or as a download fallback.
6. Open **Settings** to provide your Anthropic API key and pick a Claude
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
                     mermaid, <details>)
  state/store.js      single source of truth + pub/sub
  ai/                 client.js (Claude fetch), prompts.js, settings.js
  ui/                 sidebar, breadcrumb, card grid, insight modal,
                     code viewer, notes panel, settings panel, source panel,
                     toast
  utils/              dom/debounce/id/color helpers
  main.js             wires everything together
test/parser.selftest.html   in-browser assertions for parse/serialize round-trip
```

### Data model

Each heading becomes a node: `{ id, level, title, bodyMarkdown, children[] }`.
`bodyMarkdown` is the section's own raw Markdown (everything after the
heading up to its first child heading) — kept verbatim so re-serializing an
untouched document reproduces it byte-for-byte. Notes and AI insertions are
appended into `bodyMarkdown` between `<!-- dashboard:note:... -->` /
`<!-- dashboard:ai-insert:... -->` marker comments, so reloading a
previously-saved file re-hydrates them into the right UI slot instead of
duplicating them.

### AI integration

Calls go straight from the browser to `https://api.anthropic.com/v1/messages`
with the `anthropic-dangerous-direct-browser-access: true` header. There is
no backend/proxy. Only Claude is supported for now; the settings panel is
structured so another provider could be added later without touching the
rest of the app.

## Known limitations

This session's sandbox has no Node.js and no browser available, so the UI
could not be exercised end-to-end in a real browser — only static/structural
review and the in-browser self-test page. Please smoke-test in an actual
browser before relying on it, especially the AI calls and the file-save
path.

## Progress log

- **Stage 0** — Repo initialized, existing assets (`doc_flowchart.html`,
  `sample.md`, `sample2.md`) committed as-is.
