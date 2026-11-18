const { test, expect } = require('@playwright/test');
const { openDemoFile } = require('./helpers');

// #32: the section-card action row is quiet at rest and full strength on
// hover/focus (hover-capable pointers only), never hidden.
async function openOverviewSection(page) {
  await page.goto('/index.html');
  await openDemoFile(page);
  await page.locator('#view-mode-sections-btn').click();
  await page.locator('#heading-tree .nav-label', { hasText: 'Overview' }).click();
  await expect(page.locator('.card .card-actions').first()).toBeVisible();
}
const opacity = (page) => page.locator('.card .card-actions').first().evaluate((e) => Number(getComputedStyle(e).opacity));

test('toolbar rests faded, is full on hover, and stays visible/clickable', async ({ page }) => {
  await openOverviewSection(page);
  await page.mouse.move(2, 2);
  await expect.poll(() => opacity(page)).toBeLessThan(0.6);
  await expect(page.locator('.card .card-actions').first()).toBeVisible();
  await page.locator('.card').first().hover();
  await expect.poll(() => opacity(page)).toBe(1);
});

test('keyboard focus inside the card brings the toolbar to full strength', async ({ page }) => {
  await openOverviewSection(page);
  await page.mouse.move(2, 2);
  // :focus-within only matches while the page itself has focus, which isn't
  // guaranteed with parallel workers unless asked for.
  await page.bringToFront();
  await page.locator('.card .card-actions button:not([disabled])').first().focus();
  await expect.poll(() => opacity(page)).toBe(1);
});

test('the fade only exists inside a hover-capable media query, so touch devices are unchanged', async ({ page }) => {
  await page.goto('/index.html');
  const out = await page.evaluate(() => {
    const found = [];
    const walk = (rules, mediaText) => {
      for (const r of rules) {
        if (r.cssRules && r.conditionText !== undefined) walk(r.cssRules, r.conditionText);
        else if (r.selectorText && r.selectorText.includes('.card-actions') && r.style && r.style.opacity === '0.4') found.push(mediaText);
      }
    };
    for (const sheet of document.styleSheets) { try { walk(sheet.cssRules, null); } catch { /* cross-origin */ } }
    return found;
  });
  expect(out.length).toBeGreaterThan(0);
  for (const media of out) expect(media).toContain('hover: hover');
});
