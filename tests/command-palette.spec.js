const { test, expect } = require('@playwright/test');
const { openDemoFile } = require('./helpers');

test('fuzzy filter: subsequence match, ranked, disabled commands excluded', async ({ page }) => {
  await page.goto('/index.html');
  const out = await page.evaluate(async () => {
    const { fuzzyScore, filterCommands } = await import('/js/ui/commandPalette.js');
    const cmds = [
      { title: 'Open a folder' }, { title: 'Open Changes (unsaved edits)' },
      { title: 'Save file to disk', disabled: true }, { title: 'Open Settings' },
    ];
    return {
      noMatch: fuzzyScore('zzz', 'Open Settings'),
      subseq: fuzzyScore('ops', 'Open Settings') !== null,
      ranked: filterCommands(cmds, 'chan').map((c) => c.title),
      disabledHidden: filterCommands(cmds, 'disk').length,
      empty: filterCommands(cmds, '').map((c) => c.title),
    };
  });
  expect(out).toEqual({
    noMatch: null, subseq: true, ranked: ['Open Changes (unsaved edits)'], disabledHidden: 0,
    empty: ['Open a folder', 'Open Changes (unsaved edits)', 'Open Settings'],
  });
});

test('Ctrl+Shift+P opens the palette; typing filters; Enter runs the command; Esc closes', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);

  await page.keyboard.press('Control+Shift+P');
  const input = page.getByRole('combobox', { name: 'Command' });
  await expect(input).toBeFocused();
  await expect(page.locator('.command-palette-item').first()).toBeVisible();

  await input.fill('shortc');
  await expect(page.locator('.command-palette-item')).toHaveCount(1);
  await input.press('Enter');
  await expect(page.getByText('Keyboard shortcuts').first()).toBeVisible();

  await page.keyboard.press('Control+Shift+P');
  await expect(page.getByRole('combobox', { name: 'Command' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.command-palette-overlay')).toBeHidden();
});

test('arrow keys move the selection and no-match shows a message', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);
  await page.keyboard.press('Control+Shift+P');
  const input = page.getByRole('combobox', { name: 'Command' });
  await expect(page.locator('.command-palette-active')).toHaveCount(1);
  const first = await page.locator('.command-palette-active').innerText();
  await input.press('ArrowDown');
  expect(await page.locator('.command-palette-active').innerText()).not.toBe(first);
  await input.fill('qqqqzz');
  await expect(page.getByText('No matching command.')).toBeVisible();
});
