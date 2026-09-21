const { test, expect } = require('@playwright/test');
const { openDemoFile } = require('./helpers');

test('document-dependent action buttons are hidden (not just grayed out) with no document open, and reappear once one loads', async ({ page }) => {
  await page.goto('/index.html');

  for (const id of ['#map-view-btn', '#source-btn', '#preview-edge-toggle', '#add-section-btn']) {
    await expect(page.locator(id)).toBeHidden();
  }
  // Search and Changes stay usable with nothing open (Changes can say
  // "nothing to save"; Search explains "open a folder first").
  await expect(page.locator('#search-btn')).toBeVisible();
  await expect(page.locator('#changes-btn')).toBeVisible();

  await openDemoFile(page);
  await page.click('#view-mode-sections-btn');

  for (const id of ['#map-view-btn', '#source-btn', '#preview-edge-toggle', '#add-section-btn']) {
    await expect(page.locator(id)).toBeVisible();
  }
});

test('"Add section" lives next to the document\'s own view-mode tabs, not the sidebar, and reads differently from "Add file"', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);

  await expect(page.locator('#view-mode-bar #add-section-btn')).toBeVisible();
  await expect(page.locator('.sidebar-toolbar #add-section-btn')).toHaveCount(0);

  await expect(page.locator('#add-section-btn')).toHaveText('+ Add section');
  await expect(page.locator('#add-file-btn')).not.toHaveClass(/btn-add-section/);
  await expect(page.locator('#add-section-btn')).not.toHaveClass(/btn-icon/);
});
