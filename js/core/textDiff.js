// PROTOTYPE (benchmark only): the smallest single replacement turning `a`
// into `b`, as { start, end, text } in UTF-16 offsets of `a`, or null if
// equal. Never splits a CRLF or a surrogate pair. Webview twin of
// vscode-extension/minimalEdit.js.
function unsafeSplit(s, i) {
  if (i <= 0 || i >= s.length) return false;
  const before = s.charCodeAt(i - 1);
  const after = s.charCodeAt(i);
  return (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) || (before === 13 && after === 10);
}

export function minimalEdit(a, b) {
  if (a === b) return null;
  const max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p += 1;
  while (p > 0 && (unsafeSplit(a, p) || unsafeSplit(b, p))) p -= 1;
  const maxS = max - p;
  let s = 0;
  while (s < maxS && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s += 1;
  while (s > 0 && (unsafeSplit(a, a.length - s) || unsafeSplit(b, b.length - s))) s -= 1;
  return { start: p, end: a.length - s, text: b.slice(p, b.length - s) };
}
