// Node-only spec (no page): the Electron main process can't run under the
// browser-only Playwright project, so its path-allowlist logic lives in
// electron/pathGuard.js and is exercised directly here.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPathGuard } = require('../electron/pathGuard');

let root;
test.beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pathguard-')));
  fs.mkdirSync(path.join(root, 'ws', 'sub'), { recursive: true });
  fs.mkdirSync(path.join(root, 'outside'));
  fs.writeFileSync(path.join(root, 'ws', 'a.md'), 'a');
  fs.writeFileSync(path.join(root, 'outside', 's.md'), 'secret');
});
test.afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('allows files inside a granted folder, including not-yet-existing ones', async () => {
  const g = createPathGuard();
  await g.allow('dir', path.join(root, 'ws'));
  expect(await g.isAllowed(path.join(root, 'ws', 'a.md'))).toBe(true);
  expect(await g.isAllowed(path.join(root, 'ws', 'sub', 'new.md'))).toBe(true);
});

test('rejects paths outside the granted folder, including ../ traversal and prefix siblings', async () => {
  const g = createPathGuard();
  await g.allow('dir', path.join(root, 'ws'));
  expect(await g.isAllowed(path.join(root, 'outside', 's.md'))).toBe(false);
  expect(await g.isAllowed(path.join(root, 'ws', '..', 'outside', 's.md'))).toBe(false);
  fs.mkdirSync(path.join(root, 'ws-evil'));
  expect(await g.isAllowed(path.join(root, 'ws-evil', 'x.md'))).toBe(false);
});

test('rejects a symlinked directory inside the workspace that points outside it', async () => {
  const g = createPathGuard();
  await g.allow('dir', path.join(root, 'ws'));
  fs.symlinkSync(path.join(root, 'outside'), path.join(root, 'ws', 'link'));
  expect(await g.isAllowed(path.join(root, 'ws', 'link', 's.md'))).toBe(false);
  // creating a new file through the link must be rejected too
  expect(await g.isAllowed(path.join(root, 'ws', 'link', 'new.md'))).toBe(false);
});

test('rejects a symlinked file pointing outside; allows a symlink that stays inside', async () => {
  const g = createPathGuard();
  await g.allow('dir', path.join(root, 'ws'));
  fs.symlinkSync(path.join(root, 'outside', 's.md'), path.join(root, 'ws', 'bad.md'));
  fs.symlinkSync(path.join(root, 'ws', 'a.md'), path.join(root, 'ws', 'good.md'));
  expect(await g.isAllowed(path.join(root, 'ws', 'bad.md'))).toBe(false);
  expect(await g.isAllowed(path.join(root, 'ws', 'good.md'))).toBe(true);
});

test('unlink semantics: a link inside the workspace is deletable, judged by its own location', async () => {
  const g = createPathGuard();
  await g.allow('dir', path.join(root, 'ws'));
  fs.symlinkSync(path.join(root, 'outside', 's.md'), path.join(root, 'ws', 'bad.md'));
  expect(await g.isAllowed(path.join(root, 'ws', 'bad.md'), { followFinal: false })).toBe(true);
});

test('a granted folder that is itself reached via a symlink is canonicalized', async () => {
  const g = createPathGuard();
  fs.symlinkSync(path.join(root, 'ws'), path.join(root, 'wslink'));
  await g.allow('dir', path.join(root, 'wslink'));
  expect(await g.isAllowed(path.join(root, 'ws', 'a.md'))).toBe(true);
  expect(await g.isAllowed(path.join(root, 'outside', 's.md'))).toBe(false);
});

test('a single granted file allows only that file', async () => {
  const g = createPathGuard();
  await g.allow('file', path.join(root, 'ws', 'a.md'));
  expect(await g.isAllowed(path.join(root, 'ws', 'a.md'))).toBe(true);
  expect(await g.isAllowed(path.join(root, 'ws', 'sub'))).toBe(false);
});
