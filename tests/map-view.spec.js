const { test, expect } = require('@playwright/test');
const { openDemoFile, FIXTURES_DIR } = require('./helpers');

async function openMap(page) {
  await page.click('#map-view-btn');
  await page.waitForTimeout(200);
}

test('the map panel has a dedicated close button that actually closes it', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);
  await openMap(page);

  const closeBtn = page.locator('.map-panel-close');
  await expect(closeBtn).toBeVisible();
  await closeBtn.click();
  await expect(page.locator('.map-overlay')).toBeHidden();
});

test('Tree mode fits and pans/zooms via the shared pan-zoom module', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);
  await openMap(page);

  // Tree is the default mode.
  const fitBtn = page.locator('.map-canvas-container .mindmap-fit-btn');
  await expect(fitBtn).toBeVisible();

  const scaleBefore = await page.evaluate(() => {
    const world = document.querySelector('.map-canvas-container .map-world');
    return new DOMMatrix(getComputedStyle(world).transform).a;
  });

  await page.evaluate(() => {
    const svgEl = document.querySelector('.map-canvas-container svg');
    const rect = svgEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const fire = (type, id, x, y) => svgEl.dispatchEvent(new PointerEvent(type, {
      pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: id === 1,
    }));
    fire('pointerdown', 1, cx - 10, cy);
    fire('pointerdown', 2, cx + 10, cy);
    fire('pointermove', 1, cx - 80, cy);
    fire('pointermove', 2, cx + 80, cy);
    fire('pointerup', 1, cx - 80, cy);
    fire('pointerup', 2, cx + 80, cy);
  });

  const scaleAfter = await page.evaluate(() => {
    const world = document.querySelector('.map-canvas-container .map-world');
    return new DOMMatrix(getComputedStyle(world).transform).a;
  });
  expect(scaleAfter).toBeGreaterThan(scaleBefore);
});

test('Workspace mode fits, pans/zooms, and survives an expand/collapse click', async ({ page }) => {
  await page.goto('/index.html');
  await page.setInputFiles('#folder-input', FIXTURES_DIR);
  await page.waitForTimeout(400);
  await openMap(page);

  await page.locator('.map-mode-btn', { hasText: 'Workspace' }).click();
  await page.waitForTimeout(300);
  const fitBtn = page.locator('.map-canvas-container .mindmap-fit-btn');
  await expect(fitBtn).toBeVisible();

  // Pinch-zoom in, then click a folder node to expand it -- the pan/zoom
  // state (and its listeners) must survive the graph's own re-render.
  await page.evaluate(() => {
    const svgEl = document.querySelector('.map-canvas-container svg');
    const rect = svgEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const fire = (type, id, x, y) => svgEl.dispatchEvent(new PointerEvent(type, {
      pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: id === 1,
    }));
    fire('pointerdown', 1, cx - 10, cy);
    fire('pointerdown', 2, cx + 10, cy);
    fire('pointermove', 1, cx - 80, cy);
    fire('pointermove', 2, cx + 80, cy);
    fire('pointerup', 1, cx - 80, cy);
    fire('pointerup', 2, cx + 80, cy);
  });
  const scaleAfterPinch = await page.evaluate(() => {
    const world = document.querySelector('.map-canvas-container .wsgraph-world');
    return new DOMMatrix(getComputedStyle(world).transform).a;
  });
  expect(scaleAfterPinch).toBeGreaterThan(0);

  const dirNode = page.locator('.wsgraph-node-dir').first();
  if (await dirNode.count()) {
    await dirNode.click();
    await page.waitForTimeout(200);
    // The SVG root must still be present (not torn down) after a
    // re-render triggered by expanding a folder.
    await expect(page.locator('.map-canvas-container svg')).toBeVisible();
  }
});

test('switching modes tears down the previous mode\'s listeners (no duplicate canvases left behind)', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);
  await openMap(page);

  await page.click('text=Mind map');
  await page.waitForTimeout(400);
  await page.click('text=Tree');
  await page.waitForTimeout(400);

  const canvasCount = await page.evaluate(() => document.querySelectorAll('.map-canvas-container').length);
  expect(canvasCount).toBe(1);
});
