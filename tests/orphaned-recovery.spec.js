const { test, expect } = require('@playwright/test');

// Regression for #13: a recovery snapshot whose workspace isn't open this
// session used to restore into a "ghost" document — active, but absent from
// the Explorer and impossible to close.
const MD = '# Ghost Doc\n\nEdited unsaved text.\n';

test('restoring a snapshot from an unopened workspace yields a visible, closable loose file', async ({ page }) => {
  await page.addInitScript((md) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('mdDashboard.recovery.v2', JSON.stringify([{
      id: 'ws::NotOpenFolder::notes/ghost.md',
      fileName: 'ghost.md',
      workspaceRelPath: 'notes/ghost.md',
      workspaceRootName: 'NotOpenFolder',
      markdown: md,
      baselineMarkdown: '# Ghost Doc\n\nOriginal.\n',
      savedAt: Date.now(),
    }]));
  }, MD);
  await page.goto('/index.html');
  await page.getByRole('button', { name: /restore/i }).first().click();

  await expect(page.locator('#dirty-text')).toContainText('ghost.md');
  const row = page.locator('.explorer-open-files', { hasText: 'ghost.md' });
  await expect(row).toBeVisible();
  await expect(page.locator('.toast', { hasText: 'NotOpenFolder' })).toBeVisible();

  // ...and it can be closed (discarding the unsaved edit, after confirming).
  await row.locator('.files-tree-close').click();
  await page.locator('.confirm-panel button', { hasText: /discard/i }).first().click();
  await expect(page.locator('.explorer-open-files', { hasText: 'ghost.md' })).toHaveCount(0);

  // The stored snapshot was consumed: a reload doesn't offer it again.
  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mdDashboard.recovery.v3:')).map((k) => JSON.parse(localStorage.getItem(k)).fileName));
  expect(left).not.toContain('ghost.md');
});
