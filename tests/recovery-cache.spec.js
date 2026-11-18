const { test, expect } = require('@playwright/test');

// #27: per-document storage, size budget, legacy migration, quota handling.
const IMPORT = "import('/js/core/recovery.js')";

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
});

test('stores one entry per document and clearing one leaves the others', async ({ page }) => {
  const out = await page.evaluate(async (imp) => {
    const r = await eval(imp);
    r.saveRecoverySnapshot({ fileName: 'a.md', markdown: '# a', baselineMarkdown: '# a0' });
    r.saveRecoverySnapshot({ fileName: 'b.md', markdown: '# b', baselineMarkdown: '# b0' });
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('mdDashboard.recovery.v3:')).length;
    r.clearRecoverySnapshot({ fileName: 'a.md' });
    return { keys, left: r.listRecoverySnapshots().map((s) => s.fileName) };
  }, IMPORT);
  expect(out).toEqual({ keys: 2, left: ['b.md'] });
});

test('migrates a legacy v2 array on first read and removes it', async ({ page }) => {
  const out = await page.evaluate(async (imp) => {
    localStorage.setItem('mdDashboard.recovery.v2', JSON.stringify([
      { id: 'file::old.md', fileName: 'old.md', markdown: '# old', savedAt: 1 }, null, 5,
    ]));
    const r = await eval(imp);
    return { list: r.listRecoverySnapshots().map((s) => s.fileName), legacy: localStorage.getItem('mdDashboard.recovery.v2') };
  }, IMPORT);
  expect(out).toEqual({ list: ['old.md'], legacy: null });
});

test('skips a corrupt entry instead of throwing', async ({ page }) => {
  const out = await page.evaluate(async (imp) => {
    localStorage.setItem('mdDashboard.recovery.v3:x', '{not json');
    const r = await eval(imp);
    r.saveRecoverySnapshot({ fileName: 'ok.md', markdown: '# ok', baselineMarkdown: '' });
    return r.listRecoverySnapshots().map((s) => s.fileName);
  }, IMPORT);
  expect(out).toEqual(['ok.md']);
});

test('keeps at most 20 entries and a total size budget, evicting the oldest first, never the one just written', async ({ page }) => {
  const out = await page.evaluate(async (imp) => {
    const r = await eval(imp);
    for (let i = 0; i < 25; i += 1) r.saveRecoverySnapshot({ fileName: `f${i}.md`, markdown: '# x', baselineMarkdown: '' });
    const count = r.listRecoverySnapshots().length;
    const big = 'x'.repeat(900_000);
    for (let i = 0; i < 4; i += 1) r.saveRecoverySnapshot({ fileName: `big${i}.md`, markdown: big, baselineMarkdown: '' });
    return { count, names: r.listRecoverySnapshots().map((s) => s.fileName) };
  }, IMPORT);
  expect(out.count).toBe(20);
  expect(out.names).toContain('big3.md'); // newest always survives
  expect(out.names).not.toContain('f0.md'); // oldest evicted
  expect(out.names.filter((n) => n.startsWith('big')).length).toBeLessThanOrEqual(2); // 2M-char budget
});

test('a quota failure evicts older snapshots to fit, and reports false when nothing can fit', async ({ page }) => {
  const out = await page.evaluate(async (imp) => {
    const r = await eval(imp);
    r.saveRecoverySnapshot({ fileName: 'older.md', markdown: '# older', baselineMarkdown: '' });
    const realSet = Storage.prototype.setItem;
    let failOnce = true;
    Storage.prototype.setItem = function (k, v) {
      if (k.endsWith('new.md') && failOnce) { failOnce = false; throw new DOMException('full', 'QuotaExceededError'); }
      return realSet.call(this, k, v);
    };
    const evictedThenOk = r.saveRecoverySnapshot({ fileName: 'new.md', markdown: '# new', baselineMarkdown: '' });
    const names = r.listRecoverySnapshots().map((s) => s.fileName);
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
    const impossible = r.saveRecoverySnapshot({ fileName: 'huge.md', markdown: '# h', baselineMarkdown: '' });
    Storage.prototype.setItem = realSet;
    return { evictedThenOk, names, impossible };
  }, IMPORT);
  expect(out).toEqual({ evictedThenOk: true, names: ['new.md'], impossible: false });
});
