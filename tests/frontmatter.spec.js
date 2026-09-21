const { test, expect } = require('@playwright/test');

test('a document with inline-array frontmatter tags parses them and preserves them across a round trip', async ({ page }) => {
  await page.goto('/index.html');
  const result = await page.evaluate(async () => {
    const { parseMarkdown } = await import('/js/markdown/parser.js');
    const { serializeMarkdown } = await import('/js/markdown/serializer.js');
    const doc = parseMarkdown('---\ntags: [project, ideas]\n---\n# Title\n\nBody.\n');
    return { tags: doc.tags, text: serializeMarkdown(doc) };
  });
  expect(result.tags).toEqual(['project', 'ideas']);
  expect(result.text).toContain('tags: [project, ideas]');
  expect(result.text).toContain('# Title');
  expect(result.text).toContain('Body.');
});

test('a document with block-list frontmatter tags parses them the same way', async ({ page }) => {
  await page.goto('/index.html');
  const tags = await page.evaluate(async () => {
    const { parseMarkdown } = await import('/js/markdown/parser.js');
    const doc = parseMarkdown('---\ntags:\n  - project\n  - ideas\n---\n# Title\n');
    return doc.tags;
  });
  expect(tags).toEqual(['project', 'ideas']);
});

test('other frontmatter keys are preserved verbatim even though only tags are read', async ({ page }) => {
  await page.goto('/index.html');
  const text = await page.evaluate(async () => {
    const { parseMarkdown } = await import('/js/markdown/parser.js');
    const { serializeMarkdown } = await import('/js/markdown/serializer.js');
    const doc = parseMarkdown('---\ntitle: My Doc\ntags: [x]\n---\n# Title\n');
    return serializeMarkdown(doc);
  });
  expect(text).toContain('title: My Doc');
  expect(text).toContain('tags: [x]');
});

test('a document with no frontmatter and no tags round-trips with no frontmatter block added', async ({ page }) => {
  await page.goto('/index.html');
  const result = await page.evaluate(async () => {
    const { parseMarkdown } = await import('/js/markdown/parser.js');
    const { serializeMarkdown } = await import('/js/markdown/serializer.js');
    const doc = parseMarkdown('# Title\n\nBody.\n');
    return { tags: doc.tags, text: serializeMarkdown(doc) };
  });
  expect(result.tags).toEqual([]);
  expect(result.text.startsWith('---')).toBe(false);
});

test('setting tags on a previously-untagged document adds a frontmatter block; clearing them removes it again', async ({ page }) => {
  await page.goto('/index.html');
  const result = await page.evaluate(async () => {
    const { parseMarkdown } = await import('/js/markdown/parser.js');
    const { serializeMarkdown } = await import('/js/markdown/serializer.js');
    const doc = parseMarkdown('# Title\n');
    doc.tags = ['new-tag'];
    const withTag = serializeMarkdown(doc);
    doc.tags = [];
    const withoutTag = serializeMarkdown(doc);
    return { withTag, withoutTag };
  });
  expect(result.withTag).toContain('tags: [new-tag]');
  expect(result.withoutTag.startsWith('---')).toBe(false);
});
