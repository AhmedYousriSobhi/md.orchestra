// User notes and Claude-inserted suggestions live inside a section's raw
// bodyMarkdown, wrapped in HTML-comment markers so they can be pulled back
// out into their own editor slots on reload instead of being duplicated.
const NOTE_START = '<!-- dashboard:note:start -->';
const NOTE_END = '<!-- dashboard:note:end -->';
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

/** Split a section's bodyMarkdown into its main content, AI-inserted text, and user note. */
export function splitBody(bodyMarkdown) {
  const body = bodyMarkdown || '';
  const note = findBlock(body, NOTE_START, NOTE_END);
  const aiInsert = findBlock(body, AI_START, AI_END);
  let main = removeBlock(body, NOTE_START, NOTE_END);
  main = removeBlock(main, AI_START, AI_END);
  return {
    main: main.trim(),
    aiInsert: aiInsert ? aiInsert.content : '',
    note: note ? note.content : '',
  };
}

/** Recombine main/aiInsert/note back into one bodyMarkdown string, in a stable order. */
export function joinBody({ main = '', aiInsert = '', note = '' }) {
  const parts = [];
  if (main.trim()) parts.push(main.trim());
  if (aiInsert.trim()) parts.push(`${AI_START}\n${aiInsert.trim()}\n${AI_END}`);
  if (note.trim()) parts.push(`${NOTE_START}\n${note.trim()}\n${NOTE_END}`);
  return parts.join('\n\n');
}

export function withNote(bodyMarkdown, noteText) {
  const parts = splitBody(bodyMarkdown);
  parts.note = noteText;
  return joinBody(parts);
}

export function withAiInsert(bodyMarkdown, insertText) {
  const parts = splitBody(bodyMarkdown);
  parts.aiInsert = insertText;
  return joinBody(parts);
}
