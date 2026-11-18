const { test, expect } = require('@playwright/test');
const { openDemoFile } = require('./helpers');

// #31: a one-time, dismissible pointer to the keyboard shortcuts.
test('shows once on the first document load, can be dismissed, and never returns', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('.shortcut-hint')).toHaveCount(0); // nothing before a document
  await openDemoFile(page);
  const hint = page.locator('.shortcut-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('?');
  await hint.getByRole('button', { name: 'Dismiss tip' }).click();
  await expect(hint).toHaveCount(0);

  await page.reload();
  await openDemoFile(page);
  await expect(page.locator('.shortcut-hint')).toHaveCount(0);
});

test('"Show" opens the shortcuts panel', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);
  await page.locator('.shortcut-hint-open').click();
  await expect(page.locator('.shortcut-hint')).toHaveCount(0);
  await expect(page.getByText(/keyboard shortcuts/i).first()).toBeVisible();
});

test.describe('narrow (mobile) layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('is not shown, so it can never cover the sidebar', async ({ page }) => {
    await page.goto('/index.html');
    await openDemoFile(page);
    await expect(page.locator('.shortcut-hint')).toHaveCount(0);
  });
});
