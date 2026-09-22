const { test, expect } = require('@playwright/test');
const { openDemoFile, fixturePath } = require('./helpers');

/**
 * Edits the "Overview" section's body text, marking the active document
 * dirty, and waits for that edit to actually commit (the dirty indicator
 * flipping) before returning. This fixture is small enough to render via
 * the raw full-document source editor (see js/ui/docViewMode.js's
 * recommendedMode), which debounces its own commit — switching files
 * before that debounce fires is a real, separate, pre-existing race (the
 * stale debounced save can land on whichever document happens to be
 * active by then) that has nothing to do with the close-confirmation bug
 * these tests are for, so every test here waits it out first, the same
 * way a real user pauses to see their edit register as unsaved before
 * clicking away to a different file.
 */
async function editOverviewSection(page) {
  await page.locator('#heading-tree .nav-label', { hasText: 'Overview' }).click();
  const textarea = page.locator('#section-view textarea').first();
  await textarea.click();
  await textarea.type(' Extra sentence.');
  await expect(page.locator('#dirty-text')).toContainText('unsaved changes');
}

/**
 * Opens a second standalone file (docs/guide.md), which — per
 * loadFromText()'s own switching logic in js/main.js — flushes whatever
 * dirty edit the first file (README.md) had into its own recovery
 * snapshot and makes guide.md the new active document. README.md is left
 * open (see openStandaloneFileNames) but no longer active/focused: the
 * exact "switched to a different entity in the sidebar" scenario the
 * reported bug described.
 */
async function switchToSecondFile(page) {
  await page.setInputFiles('#file-input', fixturePath('docs', 'guide.md'));
  await page.waitForTimeout(400);
}

test.describe('unsaved-changes warning for a file that is not the active/focused one', () => {
  test('closing a dirty standalone file from the Explorer\'s "Open files" list warns first, and cancelling keeps the file open with its edit intact', async ({ page }) => {
    await page.goto('/index.html');
    await openDemoFile(page);
    await editOverviewSection(page);

    await switchToSecondFile(page);
    const readmeRow = page.locator('.explorer-open-files .standalone-file-head-pending', { hasText: 'README.md' });
    await expect(readmeRow).toBeVisible();

    // Previously: this closed instantly, discarding the edit, because the
    // handler decided whether to warn based on "is README.md the active
    // document" (always false here) instead of whether README.md itself
    // actually has unsaved changes.
    await readmeRow.locator('.files-tree-close').click();
    const dialog = page.locator('.confirm-panel');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.confirm-title')).toHaveText('Discard unsaved changes?');

    // Cancelling must leave everything exactly as it was — the previous
    // bug's other half was that even a caller which DID show a dialog
    // never waited for its answer before closing the file anyway.
    await dialog.locator('button.btn-ghost').click();
    await expect(dialog).toBeHidden();
    await expect(readmeRow).toBeVisible();

    await page.locator('.standalone-file-switch', { hasText: 'README.md' }).click();
    await expect(page.locator('#dirty-text')).toContainText('unsaved changes');
    await expect(page.locator('#section-view textarea').first()).toHaveValue(/Extra sentence\./);
  });

  test('confirming the close discards the non-active file\'s changes and removes it from Explorer', async ({ page }) => {
    await page.goto('/index.html');
    await openDemoFile(page);
    await editOverviewSection(page);
    await switchToSecondFile(page);

    const readmeRow = page.locator('.explorer-open-files .standalone-file-head-pending', { hasText: 'README.md' });
    await readmeRow.locator('.files-tree-close').click();
    await page.locator('.confirm-panel button.btn-danger').click();
    await expect(readmeRow).toBeHidden();
  });

  test('discarding a non-active file\'s changes from the Changes panel also warns before dropping the snapshot', async ({ page }) => {
    await page.goto('/index.html');
    await openDemoFile(page);
    await editOverviewSection(page);
    await switchToSecondFile(page);
    // Let the crash-recovery debounce flush README.md's edit to a real
    // recovery snapshot, so this exercises the snapshot-backed path (not
    // just the not-yet-flushed in-memory gap).
    await page.waitForTimeout(1700);

    await page.locator('#changes-btn').click();
    await page.waitForTimeout(150);
    const row = page.locator('.recovery-row', { hasText: 'README.md' });
    await expect(row).toBeVisible();

    await row.locator('.recovery-row-actions button', { hasText: 'Discard' }).click();
    const dialog = page.locator('.confirm-panel');
    await expect(dialog).toBeVisible();

    await dialog.locator('button.btn-ghost').click();
    await expect(dialog).toBeHidden();
    await expect(row).toBeVisible();

    await row.locator('.recovery-row-actions button', { hasText: 'Discard' }).click();
    await page.locator('.confirm-panel button.btn-danger').click();
    await expect(row).toBeHidden();
  });

  test('a pending non-active file counts toward the whole-app close/quit guard, not just the active document\'s own dirty flag', async ({ page }) => {
    await page.goto('/index.html');
    await openDemoFile(page);
    await editOverviewSection(page);
    await switchToSecondFile(page);
    await page.waitForTimeout(1700);

    // The active document (guide.md) is clean — only README.md, switched
    // away from, has anything unsaved. Electron's window-close handler and
    // the browser's beforeunload guard both read this one global function
    // (see js/main.js), precisely so quitting the whole app can't silently
    // drop a file just because it isn't the one currently on screen.
    await expect(page.locator('#dirty-text')).toContainText('up to date');
    const globallyDirty = await page.evaluate(() => window.__mdOrchestraIsDirty());
    expect(globallyDirty).toBe(true);
  });
});
