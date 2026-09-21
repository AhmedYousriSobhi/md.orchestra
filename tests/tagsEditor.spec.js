const { test, expect } = require('@playwright/test');
const { openDemoFile } = require('./helpers');

test('an untagged document shows an empty tag row; adding a tag via Enter shows a chip and marks the document dirty', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);

  await expect(page.locator('.tag-chip')).toHaveCount(0);
  await expect(page.locator('#dirty-indicator')).not.toHaveClass(/is-dirty/);

  await page.locator('.tag-input').fill('project');
  await page.locator('.tag-input').press('Enter');

  await expect(page.locator('.tag-chip')).toHaveText(['project×']);
  await expect(page.locator('.tag-input')).toHaveValue('');
  await expect(page.locator('#dirty-indicator')).toHaveClass(/is-dirty/);
});

test('a comma also commits a tag, and the chip\'s remove button removes it again', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);

  await page.locator('.tag-input').pressSequentially('ideas,');
  await expect(page.locator('.tag-chip')).toHaveText(['ideas×']);

  await page.locator('.tag-chip-remove').click();
  await expect(page.locator('.tag-chip')).toHaveCount(0);
});

test('backspace on an empty input removes the last chip', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);

  await page.locator('.tag-input').pressSequentially('a,');
  await page.locator('.tag-input').pressSequentially('b,');
  await expect(page.locator('.tag-chip')).toHaveText(['a×', 'b×']);

  await page.locator('.tag-input').press('Backspace');
  await expect(page.locator('.tag-chip')).toHaveText(['a×']);
});

test('a tag used on one document is suggested by autocomplete when tagging another', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);
  await page.locator('.tag-input').pressSequentially('architecture,');
  await expect(page.locator('.tag-chip')).toHaveText(['architecture×']);

  // Open a second, untagged document (still within the same session, so
  // state/tagIndex.js's tag pool from the first document persists).
  await page.evaluate(async () => {
    const { setState } = await import('/js/state/store.js');
    const { parseMarkdown } = await import('/js/markdown/parser.js');
    const doc = parseMarkdown('# Other Doc\n');
    setState({
      doc, fileName: 'other.md', dirty: false,
      workspaceRelPath: null, workspaceRootName: null, selectedId: doc.id,
    });
  });
  await expect(page.locator('.tag-chip')).toHaveCount(0);

  await page.locator('.tag-input').fill('arch');
  await expect(page.locator('.tag-suggestion')).toHaveText(['architecture']);

  await page.locator('.tag-suggestion').click();
  await expect(page.locator('.tag-chip')).toHaveText(['architecture×']);
});

test('tags survive a save/reload round trip through the actual serializer', async ({ page }) => {
  await page.goto('/index.html');
  await openDemoFile(page);

  await page.locator('.tag-input').pressSequentially('roundtrip,');
  await expect(page.locator('.tag-chip')).toHaveText(['roundtrip×']);

  const savedText = await page.evaluate(async () => {
    const { getState } = await import('/js/state/store.js');
    const { serializeMarkdown } = await import('/js/markdown/serializer.js');
    return serializeMarkdown(getState().doc);
  });
  expect(savedText).toContain('tags: [roundtrip]');

  const reloadedTags = await page.evaluate(async (text) => {
    const { parseMarkdown } = await import('/js/markdown/parser.js');
    return parseMarkdown(text).tags;
  }, savedText);
  expect(reloadedTags).toEqual(['roundtrip']);
});
