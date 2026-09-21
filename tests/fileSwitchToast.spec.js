const { test, expect } = require('@playwright/test');
const { FIXTURES_DIR } = require('./helpers');

// Issue #11: switching to a different file in an open workspace while the
// current one is dirty used to switch away with zero feedback — no blocking
// confirm (like closing a standalone file gets) *and* no indication the
// edit was kept rather than dropped. Nothing was actually lost (snapshotNow
// stashes it into a recoverable snapshot first), but it looked exactly like
// a silent discard. Fix: keep the non-blocking switch, but toast about it.
test('switching files in a workspace stashes the dirty file without a blocking confirm, and toasts about it', async ({ page }) => {
  await page.goto('/index.html');
  await page.setInputFiles('#folder-input', FIXTURES_DIR);
  await page.waitForTimeout(400);
  await expect(page.locator('#dirty-text')).toHaveText('README.md — up to date');

  await page.locator('.tag-input').fill('project');
  await page.locator('.tag-input').press('Enter');
  await expect(page.locator('#dirty-text')).toHaveText('README.md — unsaved changes');

  const docsNode = page.locator('#workspace-tree g[aria-label="docs"]');
  if (await docsNode.count()) await docsNode.click();
  const guideNode = page.locator('#workspace-tree g[aria-label="guide.md"]');
  await guideNode.click();

  // No blocking "discard changes?" dialog — this switch is deliberately
  // non-interrupting.
  await expect(page.locator('.confirm-overlay')).toHaveCount(0);
  // But it's no longer silent about it either.
  await expect(page.locator('.toast', { hasText: 'Kept your edits to "README.md"' })).toBeVisible();
  await expect(page.locator('#dirty-text')).toHaveText('guide.md — up to date');

  // And the edit really is still there, recoverable via Changes.
  await page.locator('#changes-btn').click();
  await page.waitForTimeout(150);
  await expect(page.locator('.recovery-row')).toHaveCount(1);
  await expect(page.locator('.recovery-file')).toContainText('README.md');
});

test('reopening a stashed file from the Changes panel also toasts instead of switching silently', async ({ page }) => {
  await page.goto('/index.html');
  await page.setInputFiles('#folder-input', FIXTURES_DIR);
  await page.waitForTimeout(400);

  await page.locator('.tag-input').fill('project');
  await page.locator('.tag-input').press('Enter');

  const docsNode = page.locator('#workspace-tree g[aria-label="docs"]');
  if (await docsNode.count()) await docsNode.click();
  const guideNode = page.locator('#workspace-tree g[aria-label="guide.md"]');
  await guideNode.click();
  await page.waitForTimeout(100);

  // Now dirty guide.md too, then jump back to README.md via the Changes
  // panel's own "Open" button — this path force-flushes guide.md's edit
  // the same way, and should toast about *that* file, not README.md's.
  await page.locator('.tag-input').fill('another');
  await page.locator('.tag-input').press('Enter');

  await page.locator('#changes-btn').click();
  await page.waitForTimeout(150);
  const readmeRow = page.locator('.recovery-row', { hasText: 'README.md' });
  await readmeRow.locator('.recovery-row-head').click();

  await expect(page.locator('.confirm-overlay')).toHaveCount(0);
  await expect(page.locator('.toast', { hasText: 'Kept your edits to "guide.md"' })).toBeVisible();
});
