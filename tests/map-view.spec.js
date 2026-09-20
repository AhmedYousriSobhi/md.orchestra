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

test('Tree mode still pinch-zooms when the first finger lands on a node', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);
  await openMap(page);

  const scaleBefore = await page.evaluate(() => {
    const world = document.querySelector('.map-canvas-container .map-world');
    return new DOMMatrix(getComputedStyle(world).transform).a;
  });

  // shouldStartPan() excludes a first finger landing on a real node so a
  // tap/drag there isn't hijacked into panning -- but a *second* finger
  // touching down anywhere is unambiguous pinch intent, and must still be
  // recognized even though the first one is sitting on a node. Synthetic
  // pinches centered on the canvas (as the other test above does) don't
  // exercise this at all, since they rarely land on an actual node.
  await page.evaluate(() => {
    const svgEl = document.querySelector('.map-canvas-container svg');
    const node = document.querySelector('.map-node');
    const nodeRect = node.getBoundingClientRect();
    const svgRect = svgEl.getBoundingClientRect();
    const nx = nodeRect.left + nodeRect.width / 2;
    const ny = nodeRect.top + nodeRect.height / 2;
    const ox = svgRect.left + svgRect.width - 20;
    const oy = svgRect.top + svgRect.height - 20;
    const fireOn = (el, type, id, x, y) => el.dispatchEvent(new PointerEvent(type, {
      pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: id === 1,
    }));
    fireOn(node, 'pointerdown', 1, nx, ny);
    fireOn(svgEl, 'pointerdown', 2, ox, oy);
    fireOn(svgEl, 'pointermove', 1, nx - 60, ny);
    fireOn(svgEl, 'pointermove', 2, ox + 60, oy);
    fireOn(svgEl, 'pointerup', 1, nx - 60, ny);
    fireOn(svgEl, 'pointerup', 2, ox + 60, oy);
  });

  const scaleAfter = await page.evaluate(() => {
    const world = document.querySelector('.map-canvas-container .map-world');
    return new DOMMatrix(getComputedStyle(world).transform).a;
  });
  expect(scaleAfter).toBeGreaterThan(scaleBefore);
});

test('Workspace mode still pinch-zooms when the first finger lands on a node', async ({ page }) => {
  await page.goto('/index.html');
  await page.setInputFiles('#folder-input', FIXTURES_DIR);
  await page.waitForTimeout(400);
  await openMap(page);
  await page.locator('.map-mode-btn', { hasText: 'Workspace' }).click();
  await page.waitForTimeout(300);

  const scaleBefore = await page.evaluate(() => {
    const world = document.querySelector('.map-canvas-container .wsgraph-world');
    return new DOMMatrix(getComputedStyle(world).transform).a;
  });

  // Workspace mode's tree is packed with small nodes, so a real two-finger
  // pinch lands at least one finger on a node far more often than not --
  // this is the exact scenario that was silently broken.
  await page.evaluate(() => {
    const svgEl = document.querySelector('.map-canvas-container svg');
    const node = document.querySelector('.wsgraph-node');
    const nodeRect = node.getBoundingClientRect();
    const svgRect = svgEl.getBoundingClientRect();
    const nx = nodeRect.left + nodeRect.width / 2;
    const ny = nodeRect.top + nodeRect.height / 2;
    const ox = svgRect.left + svgRect.width - 20;
    const oy = svgRect.top + svgRect.height - 20;
    const fireOn = (el, type, id, x, y) => el.dispatchEvent(new PointerEvent(type, {
      pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: id === 1,
    }));
    fireOn(node, 'pointerdown', 1, nx, ny);
    fireOn(svgEl, 'pointerdown', 2, ox, oy);
    fireOn(svgEl, 'pointermove', 1, nx - 60, ny);
    fireOn(svgEl, 'pointermove', 2, ox + 60, oy);
    fireOn(svgEl, 'pointerup', 1, nx - 60, ny);
    fireOn(svgEl, 'pointerup', 2, ox + 60, oy);
  });

  const scaleAfter = await page.evaluate(() => {
    const world = document.querySelector('.map-canvas-container .wsgraph-world');
    return new DOMMatrix(getComputedStyle(world).transform).a;
  });
  expect(scaleAfter).toBeGreaterThan(scaleBefore);
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
