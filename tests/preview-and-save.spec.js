const { test, expect } = require('@playwright/test');
const { openDemoFile } = require('./helpers');

test('the preview panel plays its entrance animation when it appears', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);
  const animationName = await page.locator('#preview-panel').evaluate((el) => getComputedStyle(el).animationName);
  expect(animationName).toBe('preview-pop-in');
});

test('the preview panel un-hides per the stored preference once a document loads', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#preview-panel')).toHaveJSProperty('hidden', true);

  await openDemoFile(page);
  await expect(page.locator('#preview-panel')).toHaveJSProperty('hidden', false);
});

test('saving a file opened via the browser fallback downloads it (no live write handle)', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);

  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('Control+Shift+S');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('README.md');
});

test('editing a section marks the document dirty, and saving clears it', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);

  await page.locator('#heading-tree .nav-label', { hasText: 'Overview' }).click();
  const textarea = page.locator('#section-view textarea').first();
  await textarea.click();
  await textarea.type(' Extra sentence.');
  await expect(page.locator('#dirty-text')).toContainText('unsaved changes');

  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('Control+Shift+S');
  await downloadPromise;
  await expect(page.locator('#dirty-text')).toContainText('up to date');
});
