// Pure (no `vscode` import) so it can be unit-tested with plain Node.
//
// Computes the smallest single replacement that turns `oldText` into
// `newText`: the longest common prefix and suffix are kept, and only the
// middle is replaced. Offsets are UTF-16 code-unit offsets, which is what
// vscode.TextDocument.positionAt() takes. The boundaries are nudged so they
// never split a surrogate pair or a CRLF line ending; a replacement that
// starts or ends in the middle of either would be applied as a malformed
// edit by the editor.

function isHighSurrogate(code) { return code >= 0xd800 && code <= 0xdbff; }
function isLowSurrogate(code) { return code >= 0xdc00 && code <= 0xdfff; }

function unsafeSplit(text, offset) {
  if (offset <= 0 || offset >= text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  if (isHighSurrogate(before) && isLowSurrogate(after)) return true;
  return before === 13 /* \r */ && after === 10 /* \n */;
}

/**
 * Returns null when the texts are identical, otherwise
 * `{ start, end, text }`: replace oldText[start, end) with `text`.
 */
function computeMinimalEdit(oldText, newText) {
  if (oldText === newText) return null;
  const maxPrefix = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < maxPrefix && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix += 1;
  while (prefix > 0 && (unsafeSplit(oldText, prefix) || unsafeSplit(newText, prefix))) prefix -= 1;

  const maxSuffix = Math.min(oldText.length, newText.length) - prefix;
  let suffix = 0;
  while (suffix < maxSuffix
    && oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)) suffix += 1;
  while (suffix > 0
    && (unsafeSplit(oldText, oldText.length - suffix) || unsafeSplit(newText, newText.length - suffix))) suffix -= 1;

  return {
    start: prefix,
    end: oldText.length - suffix,
    text: newText.slice(prefix, newText.length - suffix),
  };
}

/** Applies an edit from computeMinimalEdit() to a plain string (used by the unit tests). */
function applyMinimalEdit(oldText, edit) {
  if (!edit) return oldText;
  return oldText.slice(0, edit.start) + edit.text + oldText.slice(edit.end);
}

module.exports = { computeMinimalEdit, applyMinimalEdit };
