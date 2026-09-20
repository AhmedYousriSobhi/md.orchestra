const { test, expect } = require('@playwright/test');
const { openDemoFile, FIXTURES_DIR } = require('./helpers');

test('opening a file renders its first section and clears the empty state', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#empty-state')).toBeVisible();

  await openDemoFile(page);

  await expect(page.locator('#empty-state')).toBeHidden();
  await expect(page.locator('#dirty-text')).toHaveText('README.md — up to date');
});

test('breadcrumb navigation drills into and back out of nested sections', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);

  const architectureLink = page.locator('#heading-tree .nav-label', { hasText: 'Architecture' });
  await architectureLink.click();
  await expect(page.locator('.crumb-current')).toHaveText('Architecture');

  // The root crumb is the *file's* own root (labelled with the file name),
  // one level above even the top-level "Project Atlas" heading -- Markdown
  // has no real document-level heading of its own, so that first H1 is
  // still a real, separate node in the tree, not the same thing as the
  // synthetic file root this crumb jumps to.
  await page.locator('.crumb-root').click();
  await expect(page.locator('.crumb-current')).toHaveText('README.md');
});

test('cross-file link navigates to the linked file within the same workspace', async ({ page }) => {
  await page.goto('/index.html');
  await page.setInputFiles('#folder-input', FIXTURES_DIR);
  await page.waitForTimeout(400);

  // Open the guide directly via the Explorer's FocalGraph (same component every workspace uses).
  const docsNode = page.locator('#workspace-tree g[aria-label="docs"]');
  if (await docsNode.count()) {
    await docsNode.click();
    await page.waitForTimeout(200);
  }
  const guideNode = page.locator('#workspace-tree g[aria-label="guide.md"]');
  await guideNode.click();
  await expect(page.locator('#dirty-text')).toHaveText('guide.md — up to date');
});
