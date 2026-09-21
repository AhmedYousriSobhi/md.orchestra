const { test, expect } = require('@playwright/test');
const { MOBILE_VIEWPORT } = require('./helpers');

test('search opens near the top of the window on desktop, VSCode-command-palette style', async ({ page }) => {
  await page.goto('/index.html');
  await page.keyboard.press('Control+k');
  await expect(page.locator('.search-panel')).toBeVisible();

  const viewport = page.viewportSize();
  const box = await page.locator('.search-panel').boundingBox();
  // Top-center: comfortably in the upper portion of the window, not
  // vertically centered (which would put its top past the halfway mark).
  expect(box.y).toBeLessThan(viewport.height * 0.4);
});

test('search falls back to a centered position on a narrow (mobile) viewport', async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto('/index.html');
  await page.keyboard.press('Control+k');
  await expect(page.locator('.search-panel')).toBeVisible();

  const box = await page.locator('.search-panel').boundingBox();
  const mid = (box.y + box.y + box.height) / 2;
  // Roughly vertically centered rather than pinned near the top, given how
  // much of a short viewport the on-screen keyboard would otherwise eat.
  expect(mid).toBeGreaterThan(MOBILE_VIEWPORT.height * 0.25);
});
