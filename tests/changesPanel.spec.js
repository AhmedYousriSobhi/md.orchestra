const { test, expect } = require('@playwright/test');
const { openDemoFile } = require('./helpers');

async function openChanges(page) {
  await page.locator('#changes-btn').click();
  await page.waitForTimeout(150);
}

test('the Changes badge shows a count for a tags-only edit (previously stayed hidden)', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);
  await expect(page.locator('#changes-badge')).toBeHidden();

  await page.locator('.tag-input').fill('project');
  await page.locator('.tag-input').press('Enter');
  // snapshotIfDirty is debounced 1500ms; the badge itself updates
  // synchronously off the dirty state too (activeGapChangedCount), so no
  // need to wait out the debounce for the badge specifically.
  await expect(page.locator('#changes-badge')).toBeVisible();
  await expect(page.locator('#changes-badge')).not.toHaveText('0');
});

test('saving a tags-only change from inside the Changes panel removes that row and clears the badge', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);
  await page.locator('.tag-input').fill('project');
  await page.locator('.tag-input').press('Enter');
  // Let the crash-recovery debounce flush, so this exercises the exact
  // "already a real recovery snapshot" path the bug report hit, not just
  // the not-yet-flushed in-memory gap.
  await page.waitForTimeout(1700);

  await openChanges(page);
  const row = page.locator('.recovery-row');
  await expect(row).toHaveCount(1);
  await expect(page.locator('.recovery-tags-changed')).toHaveText('🏷️ Tags changed');

  // This test's file was opened via a plain <input type=file> (no real
  // File System Access write handle available to Playwright), so saving it
  // goes through the "download" fallback rather than "Saved to X" — same
  // handleSave()/clearRecoverySnapshot() code path either way, which is
  // what this test is actually checking.
  await page.locator('.recovery-row-actions .btn-primary').click();
  await expect(page.locator('.toast', { hasText: 'Downloaded README.md' })).toBeVisible();
  // The bug: this row used to stay put because the active-document save
  // path never told the panel to refresh itself.
  await expect(page.locator('.recovery-row')).toHaveCount(0);
  await expect(page.locator('.sidebar-empty')).toHaveText('Nothing to save or discard right now.');

  await expect(page.locator('#changes-badge')).toBeHidden();
});

test('the Changes panel subtitle counts a tags-only change instead of reporting 0', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);
  await page.locator('.tag-input').fill('project');
  await page.locator('.tag-input').press('Enter');
  await page.waitForTimeout(1700);

  await openChanges(page);
  await expect(page.locator('.insight-subtitle').first()).toHaveText('1 change across 1 file');
});
