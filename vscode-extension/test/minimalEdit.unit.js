// Plain-Node unit tests for minimalEdit.js (no VS Code needed): `node test/minimalEdit.unit.js`.
const assert = require('assert');
const { computeMinimalEdit, applyMinimalEdit } = require('../minimalEdit');

const cases = [
  ['abc', 'abc'],
  ['', 'new'],
  ['old', ''],
  ['hello world', 'hello brave world'],
  ['aaaa', 'aaaaa'],
  ['line1\r\nline2\r\n', 'line1\r\nX\r\nline2\r\n'],
  ['a\r\nb', 'a\nb'],
  ['x😀y', 'x😁y'],
  ['😀', '😀😀'],
  ['# T\n\nbody\n', '# T\n\nbody\nmore\n'],
];

let n = 0;
for (const [a, b] of cases) {
  const edit = computeMinimalEdit(a, b);
  assert.strictEqual(applyMinimalEdit(a, edit), b, JSON.stringify([a, b]));
  if (a === b) assert.strictEqual(edit, null);
  if (edit) {
    // Never split a surrogate pair or a CRLF.
    for (const [text, at] of [[a, edit.start], [a, edit.end]]) {
      const pair = text.slice(at - 1, at + 1);
      assert.ok(!/^[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(pair) && pair !== '\r\n', `split at ${at} in ${JSON.stringify(text)}`);
    }
  }
  n += 1;
}
const big = computeMinimalEdit('x'.repeat(1000), `${'x'.repeat(500)}Y${'x'.repeat(500)}`);
assert.strictEqual(big.end - big.start, 0);
assert.strictEqual(big.text, 'Y');
console.log(`minimalEdit: ${n + 1} cases passed`);
