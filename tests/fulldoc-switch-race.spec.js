const { test, expect } = require('@playwright/test');
const { openDemoFile, fixturePath } = require('./helpers');

// Regression for #17: editing the raw-source textarea and switching files
// before its 700ms debounce fires used to overwrite the newly active
// document with the old file's text.
test.describe('full-document source edit racing a file switch (#17)', () => {
  test('switching immediately after typing keeps the new file intact and the edit with the old file', async ({ page }) => {
    await page.goto('/index.html');
    await openDemoFile(page);
    const source = page.locator('.full-doc-source-textarea');
    await expect(source).toBeVisible();
    await source.click();
    await source.press('Control+End');
    await source.type('\n\nRACE-MARKER');

    // No wait: switch well inside the 700ms debounce window.
    await page.setInputFiles('#file-input', fixturePath('docs', 'guide.md'));
    await page.waitForTimeout(1500);

    // The new active document is guide.md's own content, not the old file's text.
    const activeSource = await page.locator('.full-doc-source-textarea').inputValue();
    expect(activeSource).toContain('# Guide');
    expect(activeSource).not.toContain('RACE-MARKER');

    // The edit was not lost: it sits in the first file's recovery snapshot.
    const snapshots = await page.evaluate(() => localStorage.getItem('mdDashboard.recovery.v2'));
    expect(snapshots).toContain('RACE-MARKER');
  });
});
