// A handful of "Markdown All in One"-style typing habits for a plain
// <textarea>, applied to every raw-Markdown editing surface in the app
// (notes, in-place content editing, new-section content): continue a list
// on Enter (and exit it cleanly on an empty item), Tab/Shift+Tab to
// indent/outdent a list item, and Ctrl/Cmd+B / +I / +` to wrap the
// selection — without pulling in a full editor component.
const BULLET_RE = /^(\s*)([-*+])(\s+)(\[[ xX]]\s+)?/;
const ORDERED_RE = /^(\s*)(\d+)([.)])(\s+)/;
const INDENT = '  ';

function lineBounds(value, pos) {
  const start = value.lastIndexOf('\n', pos - 1) + 1;
  let end = value.indexOf('\n', pos);
  if (end === -1) end = value.length;
  return { start, end };
}

function fireInput(textarea) {
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function setValue(textarea, value, selStart, selEnd = selStart) {
  textarea.value = value;
  textarea.selectionStart = selStart;
  textarea.selectionEnd = selEnd;
  fireInput(textarea);
}

/** Continue a list on Enter; exit it (drop the empty marker) if the current item has no text yet. */
function handleEnter(textarea, e) {
  const { value, selectionStart: pos } = textarea;
  const { start, end } = lineBounds(value, pos);
  const line = value.slice(start, end);

  const bullet = line.match(BULLET_RE);
  const ordered = !bullet && line.match(ORDERED_RE);
  if (!bullet && !ordered) return; // not in a list — let Enter behave normally

  const markerLen = (bullet || ordered)[0].length;
  const hasContent = line.slice(markerLen).trim() !== '';
  e.preventDefault();

  if (!hasContent) {
    // Empty item ("- " with nothing after it): pressing Enter exits the list
    // by stripping just the marker, same line — not inserting another one.
    const newValue = value.slice(0, start) + value.slice(start + markerLen, end) + value.slice(end);
    setValue(textarea, newValue, start);
    return;
  }

  let prefix;
  if (bullet) {
    const [, indent, marker, , checkbox] = bullet;
    prefix = indent + marker + ' ' + (checkbox ? '[ ] ' : '');
  } else {
    const [, indent, num, punct] = ordered;
    prefix = `${indent}${Number(num) + 1}${punct} `;
  }
  const newValue = `${value.slice(0, pos)}\n${prefix}${value.slice(pos)}`;
  setValue(textarea, newValue, pos + 1 + prefix.length);
}

/** Indent/outdent the current line (or every line touched by the selection) — only for list-shaped lines, so Tab still moves focus everywhere else. */
function handleTab(textarea, e, outdent) {
  const { value, selectionStart: selStart, selectionEnd: selEnd } = textarea;
  const multiLine = value.slice(selStart, selEnd).includes('\n');
  const { start } = lineBounds(value, selStart);
  const currentLine = value.slice(start, lineBounds(value, selStart).end);
  const looksLikeList = BULLET_RE.test(currentLine) || ORDERED_RE.test(currentLine);
  if (!multiLine && !looksLikeList) return; // plain text, single line — let Tab move focus

  e.preventDefault();
  const blockStart = start;
  const blockEnd = lineBounds(value, Math.max(selEnd - 1, selStart)).end;
  const lines = value.slice(blockStart, blockEnd).split('\n');

  const changed = lines.map((l) => {
    if (!outdent) return INDENT + l;
    if (l.startsWith(INDENT)) return l.slice(INDENT.length);
    if (l.startsWith('\t') || l.startsWith(' ')) return l.slice(1);
    return l;
  });
  const newBlock = changed.join('\n');
  const newValue = value.slice(0, blockStart) + newBlock + value.slice(blockEnd);
  const delta = newBlock.length - (blockEnd - blockStart);
  setValue(textarea, newValue, blockStart, blockEnd + delta);
}

function wrapSelection(textarea, marker) {
  const { value, selectionStart: s, selectionEnd: e } = textarea;
  const before = value.slice(0, s);
  const selected = value.slice(s, e);
  const after = value.slice(e);

  if (before.endsWith(marker) && after.startsWith(marker) && marker.length) {
    const newValue = before.slice(0, -marker.length) + selected + after.slice(marker.length);
    setValue(textarea, newValue, s - marker.length, e - marker.length);
  } else {
    const newValue = before + marker + selected + marker + after;
    setValue(textarea, newValue, s + marker.length, e + marker.length);
  }
}

/** Wire the habits above onto `textarea`. Safe to call once per element. */
export function attachMarkdownEditingHelpers(textarea) {
  textarea.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      handleEnter(textarea, e);
    } else if (e.key === 'Tab') {
      handleTab(textarea, e, e.shiftKey);
    } else if (mod && !e.altKey && e.key.toLowerCase() === 'b') {
      e.preventDefault(); wrapSelection(textarea, '**');
    } else if (mod && !e.altKey && e.key.toLowerCase() === 'i') {
      e.preventDefault(); wrapSelection(textarea, '*');
    } else if (mod && !e.altKey && e.key === '`') {
      e.preventDefault(); wrapSelection(textarea, '`');
    }
  });
}
