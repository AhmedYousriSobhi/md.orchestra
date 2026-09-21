const { test, expect } = require('@playwright/test');
const { openDemoFile, swipe, MOBILE_VIEWPORT } = require('./helpers');

// Every test here reproduces a real regression this app has actually
// shipped and fixed (see docs/ANDROID.md's "Second"/"Third real-device
// test round" and CHANGELOG.md Stages 80/82) -- committed so none of them
// can silently come back.
test.use({ viewport: MOBILE_VIEWPORT });

test('sidebar toggle opens and closes the drawer', async ({ page }) => {
  await page.goto('/index.html');
  const sidebar = page.locator('#sidebar');
  await expect(sidebar).not.toHaveClass(/sidebar-open/);

  await page.click('#sidebar-toggle');
  await expect(sidebar).toHaveClass(/sidebar-open/);

  await page.click('#sidebar-toggle');
  await expect(sidebar).not.toHaveClass(/sidebar-open/);
});

test('tapping outside the open sidebar closes it', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);
  const sidebar = page.locator('#sidebar');

  await page.click('#sidebar-toggle');
  await expect(sidebar).toHaveClass(/sidebar-open/);

  await page.locator('body').click({ position: { x: 300, y: 5 } });
  await expect(sidebar).not.toHaveClass(/sidebar-open/);
});

test('the open sidebar renders above the preview panel, not underneath it (regression: Stage 82)', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);

  // Preview defaults to open, and at this width it's a full-screen overlay
  // with a higher base z-index than the sidebar -- opening the sidebar on
  // top of it must still make the sidebar the real, clickable top layer.
  await expect(page.locator('#preview-panel')).not.toHaveAttribute('hidden', '');

  await page.click('#sidebar-toggle');
  await page.waitForTimeout(300); // let the 0.25s CSS transition finish
  const onTop = await page.evaluate(() => {
    const sidebar = document.getElementById('sidebar');
    const rect = sidebar.getBoundingClientRect();
    const topElement = document.elementFromPoint(rect.x + 20, rect.y + 20);
    return sidebar.contains(topElement);
  });
  expect(onTop).toBe(true);
});

test('the preview panel is hidden when no document is loaded, not covering the sidebar (regression: Stage 80)', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#preview-panel')).toHaveJSProperty('hidden', true);

  await page.click('#sidebar-toggle');
  await page.waitForTimeout(300); // let the 0.25s CSS transition finish
  const sidebarRect = await page.locator('#sidebar').boundingBox();
  expect(sidebarRect.x).toBeGreaterThanOrEqual(0);
  expect(sidebarRect.x).toBeLessThan(10);
});

test('edge-swipe from the left opens the sidebar when there is nowhere to go back to', async ({ page }) => {
  await page.goto('/index.html');
  const sidebar = page.locator('#sidebar');
  await expect(sidebar).not.toHaveClass(/sidebar-open/);

  await swipe(page, 'body', 10, 400, 100, 400);
  await expect(sidebar).toHaveClass(/sidebar-open/);
});

test('edge-swipe from the left goes back to the parent section when one is open', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);

  // The Outline lives inside the sidebar drawer, off-screen by default at
  // this width -- open it first so its links are actually reachable.
  await page.click('#sidebar-toggle');
  // Expand "Architecture" (collapsed by default) to reach its nested
  // "Ingest" child, then select that child directly -- selecting
  // "Architecture" itself first isn't needed and re-renders the tree,
  // which raced the chevron click below.
  const architectureRow = page.locator('#heading-tree .nav-row', { has: page.locator('.nav-label', { hasText: 'Architecture' }) });
  await architectureRow.locator('.nav-chevron').click();
  await page.locator('#heading-tree .nav-label', { hasText: 'Ingest' }).click();
  await expect(page.locator('.crumb-current')).toHaveText('Ingest');

  await swipe(page, 'body', 10, 400, 100, 400);
  await expect(page.locator('.crumb-current')).toHaveText('Architecture');
});

test('swiping the open sidebar left closes it', async ({ page }) => {
  await page.goto('/index.html');
  const sidebar = page.locator('#sidebar');
  await page.click('#sidebar-toggle');
  await expect(sidebar).toHaveClass(/sidebar-open/);

  await swipe(page, '#outline-section', 200, 700, 50, 700);
  await expect(sidebar).not.toHaveClass(/sidebar-open/);
});
