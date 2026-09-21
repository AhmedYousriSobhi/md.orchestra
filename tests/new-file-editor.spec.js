const { test, expect } = require('@playwright/test');
const { FIXTURES_DIR } = require('./helpers');

test('creating a new standalone file jumps straight to its editable text, not the Preview panel', async ({ page }) => {
  await page.goto('/index.html');
  await page.click('#add-file-btn');
  await page.locator('.insight-panel input[type="text"]').fill('Fresh.md');
  await page.locator('.insight-panel button', { hasText: 'Create' }).click();

  await expect(page.locator('#preview-panel')).toBeHidden();
  const textarea = page.locator('#section-view textarea').first();
  await expect(textarea).toBeFocused();
});

test('creating a new file inside an open workspace also jumps straight to its editable text', async ({ page }) => {
  await page.goto('/index.html');
  await page.setInputFiles('#folder-input', FIXTURES_DIR);
  await page.waitForTimeout(400);

  await page.click('#add-file-btn');
  await page.locator('.insight-panel input[type="text"]').fill('New.md');
  await page.locator('.insight-panel button', { hasText: 'Create' }).click();

  await expect(page.locator('#preview-panel')).toBeHidden();
  const textarea = page.locator('#section-view textarea').first();
  await expect(textarea).toBeFocused();
});
