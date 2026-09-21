const { test, expect } = require('@playwright/test');
const { CAPACITOR_STUB } = require('./helpers');

test('Android: a file opened/shared in from another app loads automatically on startup', async ({ page }) => {
  await page.addInitScript(CAPACITOR_STUB);
  await page.addInitScript(() => {
    window.__pendingSharedFile = { name: 'shared-notes.md', text: '# Shared Notes\n\nFrom another app.\n' };
  });
  await page.goto('/index.html');

  await expect(page.locator('#dirty-text')).toHaveText('shared-notes.md — up to date');
  await expect(page.locator('#section-view textarea').first()).toHaveValue(/Shared Notes/);
});

test('Android: startup with nothing pending behaves normally (no document loaded)', async ({ page }) => {
  await page.addInitScript(CAPACITOR_STUB);
  await page.goto('/index.html');

  await expect(page.locator('#dirty-text')).toHaveText('No document loaded');
});

test('Android: sharing a second file into an already-running app loads it too', async ({ page }) => {
  // launchMode="singleTask" means a share arriving while the app is
  // already open reuses this same page (onNewIntent), not a fresh
  // reload -- the startup-only check above would never see it without
  // MainActivity's onNewIntent firing mdorchestraPendingShare.
  await page.addInitScript(CAPACITOR_STUB);
  await page.goto('/index.html');
  await expect(page.locator('#dirty-text')).toHaveText('No document loaded');

  await page.evaluate(() => {
    window.__pendingSharedFile = { name: 'second-share.md', text: '# Second Share\n\nArrived while already open.\n' };
    window.dispatchEvent(new CustomEvent('mdorchestraPendingShare'));
  });

  await expect(page.locator('#dirty-text')).toHaveText('second-share.md — up to date');
  await expect(page.locator('#section-view textarea').first()).toHaveValue(/Second Share/);
});
