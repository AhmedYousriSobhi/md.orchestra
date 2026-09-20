const { test, expect } = require('@playwright/test');
const { openDemoFile } = require('./helpers');

function pinch(page, selector, factor) {
  return page.evaluate(
    ([sel, f]) => {
      const el = document.querySelector(sel);
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const spread = 40 * f;
      const fire = (type, id, x, y) => el.dispatchEvent(new PointerEvent(type, {
        pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: id === 1,
      }));
      fire('pointerdown', 1, cx - 10, cy);
      fire('pointerdown', 2, cx + 10, cy);
      fire('pointermove', 1, cx - spread, cy);
      fire('pointermove', 2, cx + spread, cy);
      fire('pointerup', 1, cx - spread, cy);
      fire('pointerup', 2, cx + spread, cy);
    },
    [selector, factor],
  );
}

test('pinching the preview panel zooms its content and remembers the level', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);
  await expect(page.locator('#preview-panel')).toBeVisible();

  const zoomBefore = await page.locator('#preview-panel').evaluate((el) => parseFloat(getComputedStyle(el).zoom || '1'));
  await pinch(page, '#preview-panel', 3);
  const zoomAfter = await page.locator('#preview-panel').evaluate((el) => parseFloat(getComputedStyle(el).zoom || '1'));
  expect(zoomAfter).toBeGreaterThan(zoomBefore);

  await page.reload();
  await openDemoFile(page);
  const zoomAfterReload = await page.locator('#preview-panel').evaluate((el) => parseFloat(getComputedStyle(el).zoom || '1'));
  expect(zoomAfterReload).toBeCloseTo(zoomAfter, 1);
});

test('pinching the main section view zooms its content independently of the preview panel', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);

  const previewZoomBefore = await page.locator('#preview-panel').evaluate((el) => parseFloat(getComputedStyle(el).zoom || '1'));
  await pinch(page, '#section-view-wrap', 3);
  const sectionZoomAfter = await page.locator('#section-view-wrap').evaluate((el) => parseFloat(getComputedStyle(el).zoom || '1'));
  const previewZoomAfter = await page.locator('#preview-panel').evaluate((el) => parseFloat(getComputedStyle(el).zoom || '1'));

  expect(sectionZoomAfter).toBeGreaterThan(1);
  expect(previewZoomAfter).toBeCloseTo(previewZoomBefore, 5);
});

test('a single-finger touch scroll does not trigger zoom', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);

  const zoomBefore = await page.locator('#preview-panel').evaluate((el) => parseFloat(getComputedStyle(el).zoom || '1'));
  await page.evaluate(() => {
    const el = document.querySelector('#preview-panel');
    const rect = el.getBoundingClientRect();
    const fire = (type, x, y) => el.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true,
    }));
    fire('pointerdown', rect.left + rect.width / 2, rect.top + 20);
    fire('pointermove', rect.left + rect.width / 2, rect.top + 100);
    fire('pointerup', rect.left + rect.width / 2, rect.top + 100);
  });
  const zoomAfter = await page.locator('#preview-panel').evaluate((el) => parseFloat(getComputedStyle(el).zoom || '1'));
  expect(zoomAfter).toBeCloseTo(zoomBefore, 5);
});
