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
  (`js/fileIO.js`, used from the Source panel) is implemented per spec but
  wasn't exercised interactively, since it requires a real file picker and
  user gesture that headless testing can't drive. The download fallback
  path was verified and works.
- Sample-file loading and the self-test's round-trip checks require the
  project to be served over HTTP (see *Running it*) — they silently no-op
  under `file://` because `fetch()` can't read local files that way.

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
