const { test, expect } = require('@playwright/test');
const { openDemoFile } = require('./helpers');

test('adding a note updates the section in place, without replaying the navigation blank-out/redraw transition', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);
  await page.click('#view-mode-sections-btn');
  await page.waitForTimeout(200);

  await page.locator('.code-btn', { hasText: 'Add note' }).click();

  // animatedSwap adds this class synchronously the instant it's called
  // (the actual fade-out is delayed, but the class itself is not) --
  // its presence right after the click is exactly the "blank out" flash
  // being reported. directRender (what an in-place content change like
  // this should use instead) never adds it at all.
  const hasNavigationTransitionClass = await page.evaluate(() => {
    const el = document.querySelector('#section-view');
    return el.classList.contains('panel-out-forward') || el.classList.contains('panel-out-back');
  });
  expect(hasNavigationTransitionClass).toBe(false);

  await expect(page.locator('.notes-textarea').first()).toBeFocused();
});

test('navigating to a different section still plays the transition', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);

  const secondHeading = page.locator('#heading-tree .nav-label').nth(1);
  await secondHeading.click();

  const hasNavigationTransitionClass = await page.evaluate(() => {
    const el = document.querySelector('#section-view');
    return el.classList.contains('panel-out-forward') || el.classList.contains('panel-out-back');
  });
  expect(hasNavigationTransitionClass).toBe(true);
});
