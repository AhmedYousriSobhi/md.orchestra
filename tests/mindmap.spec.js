const { test, expect } = require('@playwright/test');
const { openDemoFile } = require('./helpers');

async function openMindMap(page) {
  await page.click('#map-view-btn');
  await page.click('text=Mind map');
  await page.waitForTimeout(400);
}

test('the mind map fits its content within the actual container, centered', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);
  await openMindMap(page);

  const info = await page.evaluate(() => {
    const container = document.querySelector('.map-canvas-container');
    const svgEl = container.querySelector('svg');
    const nodes = [...svgEl.querySelectorAll('.mindmap-node')];
    const boxes = nodes.map((n) => n.getBoundingClientRect());
    const minY = Math.min(...boxes.map((b) => b.top));
    const maxY = Math.max(...boxes.map((b) => b.bottom));
    const containerRect = container.getBoundingClientRect();
    return {
      contentMidY: (minY + maxY) / 2,
      containerMidY: containerRect.top + containerRect.height / 2,
    };
  });
  // The node cluster's own vertical center should land close to the
  // container's vertical center -- this is the exact check that caught
  // the real bug (see CHANGELOG Stage 81): a stale/wrong viewport
  // measurement centered the graph inside a taller *virtual* box than
  // what was actually visible, so it rendered low and mostly off-screen.
  expect(Math.abs(info.contentMidY - info.containerMidY)).toBeLessThan(40);
});

test('the Fit button re-centers using the container\'s real, current size', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);
  await openMindMap(page);

  await page.click('.mindmap-fit-btn');
  const viewBox = await page.locator('.map-canvas-container svg').getAttribute('viewBox');
  const containerBox = await page.locator('.map-canvas-container').boundingBox();
  const [, , vbWidth, vbHeight] = viewBox.split(' ').map(Number);
  // measureViewport() only updates viewW/viewH when the container's real
  // size differs from what's currently recorded -- if it's still on a
  // stale value, this comparison catches it directly.
  expect(vbWidth).toBeCloseTo(containerBox.width, 0);
  expect(vbHeight).toBeCloseTo(containerBox.height, 0);
});

test('two-finger pinch zooms the mind map', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);
  await openMindMap(page);

  const scaleBefore = await page.evaluate(() => {
    const world = document.querySelector('.mindmap-world');
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
    const world = document.querySelector('.mindmap-world');
    return new DOMMatrix(getComputedStyle(world).transform).a;
  });
  expect(scaleAfter).toBeGreaterThan(scaleBefore);
});
