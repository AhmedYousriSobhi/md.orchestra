// Node-only spec for electron/fsErrors.js (see path-guard.spec.js for why).
const { test, expect } = require('@playwright/test');
const { toFriendlyFsError } = require('../electron/fsErrors');

const errno = (code) => Object.assign(new Error(`${code}: raw node text, open '/very/long/path/a.md'`), { code });

for (const [code, fragment] of [
  ['EACCES', 'Permission denied'], ['ENOSPC', 'disk is full'], ['EIO', 'disk read/write error'],
  ['ENOENT', 'no longer exists'], ['EROFS', 'read-only'], ['EBUSY', 'in use'],
]) {
  test(`${code} becomes a specific, actionable message naming just the file`, () => {
    const out = toFriendlyFsError(errno(code), '/very/long/path/a.md');
    expect(out.message).toContain(fragment);
    expect(out.message).toContain('a.md');
    expect(out.message).not.toContain('/very/long/path');
    expect(out.code).toBe(code);
  });
}

test('unknown codes and our own errors pass through untouched', () => {
  const own = new Error('Not allowed: outside every folder');
  expect(toFriendlyFsError(own, '/x/a.md')).toBe(own);
  const odd = errno('EWHATEVER');
  expect(toFriendlyFsError(odd, '/x/a.md')).toBe(odd);
});
