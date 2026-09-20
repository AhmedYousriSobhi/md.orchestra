const { test, expect } = require('@playwright/test');
const { CAPACITOR_STUB } = require('./helpers');

/** Creates a brand-new blank standalone document via the sidebar's File+ button. */
async function createStandaloneFile(page, fileName) {
  await page.click('#add-file-btn');
  await page.locator('.insight-panel input[type="text"]').fill(fileName);
  await page.locator('.insight-panel button', { hasText: 'Create' }).click();
  await page.waitForTimeout(200);
}

test('Android: saving a document with no live handle uses the native Save As picker, not a browser download', async ({ page }) => {
  await page.addInitScript(CAPACITOR_STUB);
  await page.goto('/index.html');
  await createStandaloneFile(page, 'Test.md');

  await page.keyboard.press('Control+Shift+S');
  await page.waitForTimeout(200);

  const saveAsCalls = await page.evaluate(() => window.__capacitorSaveFileAsCalls || []);
  expect(saveAsCalls).toHaveLength(1);
  expect(saveAsCalls[0].suggestedName).toBe('Test.md');

  const writeCalls = await page.evaluate(() => window.__capacitorWriteFileAtUriCalls || []);
  expect(writeCalls).toHaveLength(1);
  expect(writeCalls[0].uri).toBe('content://stub/Test.md');

  await expect(page.locator('.toast', { hasText: 'Saved to Test.md' })).toBeVisible();

  // A second save must write straight to the now-granted URI, not prompt again.
  await page.keyboard.press('Control+Shift+S');
  await page.waitForTimeout(200);
  await expect.poll(() => page.evaluate(() => window.__capacitorSaveFileAsCalls.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__capacitorWriteFileAtUriCalls.length)).toBe(2);
});

test('Android: backing out of the native Save As picker leaves the document unsaved, not silently downloaded', async ({ page }) => {
  await page.addInitScript(CAPACITOR_STUB);
  await page.addInitScript(() => { window.__capacitorSaveFileAsCancelled = true; });
  await page.goto('/index.html');
  await createStandaloneFile(page, 'Cancelled.md');

  // Make an actual edit so there's genuinely something unsaved to lose.
  const textarea = page.locator('#section-view textarea').first();
  await textarea.click();
  await textarea.type(' Extra sentence.');
  await expect(page.locator('#dirty-text')).toContainText('unsaved changes');

  await page.keyboard.press('Control+Shift+S');
  await page.waitForTimeout(200);

  const writeCalls = await page.evaluate(() => window.__capacitorWriteFileAtUriCalls || []);
  expect(writeCalls).toHaveLength(0);
  await expect(page.locator('.toast', { hasText: 'Saved to' })).toHaveCount(0);
  await expect(page.locator('#dirty-text')).toContainText('unsaved changes');
});
