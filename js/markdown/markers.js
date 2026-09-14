// User notes and Claude-inserted suggestions live inside a section's raw
// bodyMarkdown, wrapped in HTML-comment markers so they can be pulled back
// out into their own editor slots on reload instead of being duplicated.
//
// Notes are a *list*, not a single field — each gets its own numbered
// marker pair (`dashboard:note:<id>:start/end`) so several independent
// notes can live on the same section without colliding. A section saved
// before multi-note support used a single unnumbered marker pair; that's
// still read back as one legacy note so old saves aren't silently dropped.
const NOTE_RE = /<!-- dashboard:note:([\w-]+):start -->\n?([\s\S]*?)\n?<!-- dashboard:note:\1:end -->/g;
const LEGACY_NOTE_START = '<!-- dashboard:note:start -->';
const LEGACY_NOTE_END = '<!-- dashboard:note:end -->';
const AI_START = '<!-- dashboard:ai-insert:start -->';
const AI_END = '<!-- dashboard:ai-insert:end -->';

function findBlock(body, startTag, endTag) {
  const start = body.indexOf(startTag);
  if (start === -1) return null;
  const end = body.indexOf(endTag, start + startTag.length);
  if (end === -1) return null;
  return { start, end: end + endTag.length, content: body.slice(start + startTag.length, end).trim() };
}

function removeBlock(body, startTag, endTag) {
  const block = findBlock(body, startTag, endTag);
  if (!block) return body;
  return (body.slice(0, block.start) + body.slice(block.end)).trim();
}

function noteBlock(id, text) {
  return `<!-- dashboard:note:${id}:start -->\n${text.trim()}\n<!-- dashboard:note:${id}:end -->`;
}

/** Split a section's bodyMarkdown into its main content, AI-inserted text, and a list of independent notes. */
export function splitBody(bodyMarkdown) {
  const body = bodyMarkdown || '';
  const aiInsert = findBlock(body, AI_START, AI_END);

  const notes = [];
  let main = body;
  let match;
  NOTE_RE.lastIndex = 0;
  while ((match = NOTE_RE.exec(body))) {
    notes.push({ id: match[1], text: match[2].trim() });
  }
  if (notes.length) {
    main = main.replace(NOTE_RE, '').trim();
  } else {
    const legacy = findBlock(body, LEGACY_NOTE_START, LEGACY_NOTE_END);
    if (legacy && legacy.content) {
      notes.push({ id: 'n0', text: legacy.content });
      main = removeBlock(main, LEGACY_NOTE_START, LEGACY_NOTE_END);
    }
  }
  main = removeBlock(main, AI_START, AI_END);

  return {
    main: main.trim(),
    aiInsert: aiInsert ? aiInsert.content : '',
    notes,
  };
}

/**
 * Recombine main/aiInsert/notes back into one bodyMarkdown string, in a
 * stable order. Every note is written out regardless of whether it has
 * text yet — unlike aiInsert (where empty means "no suggestion pending",
 * cleared via its Remove button), a freshly-added note is *meant* to start
 * empty and stay in the list until its own delete button removes it; if
 * empty notes were dropped here, adding one would disappear the instant it
 * was created, before there was ever a chance to type into it.
 */
export function joinBody({ main = '', aiInsert = '', notes = [] }) {
  const parts = [];
  if (main.trim()) parts.push(main.trim());
  if (aiInsert.trim()) parts.push(`${AI_START}\n${aiInsert.trim()}\n${AI_END}`);
  notes.forEach((n) => parts.push(noteBlock(n.id, n.text)));
  return parts.join('\n\n');
}

export function withAiInsert(bodyMarkdown, insertText) {
  const parts = splitBody(bodyMarkdown);
  parts.aiInsert = insertText;
  return joinBody(parts);
}
