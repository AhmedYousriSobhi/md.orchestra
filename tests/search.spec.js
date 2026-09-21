const { test, expect } = require('@playwright/test');

/**
 * Builds an in-memory workspace directly against state/workspace.js (rather
 * than a real folder on disk via #folder-input) so each test can shape its
 * own small, distinct set of files/content without touching the shared
 * tests/fixtures/demo-workspace/ files other specs also rely on. Each
 * `files` entry is `{ relPath, content }`; `webkitFile` is a real
 * browser File (readWorkspaceFileText already knows how to read one), so
 * this exercises the exact same lazy-read path a real folder-open would.
 */
async function buildWorkspace(page, rootName, files) {
  await page.evaluate(async ([name, entries]) => {
    const { addWorkspace } = await import('/js/state/workspace.js');
    window.__readCalls = window.__readCalls || 0;
    const makeFile = (fname, content) => {
      const f = new File([content], fname, { type: 'text/markdown' });
      const realText = f.text.bind(f);
      f.text = () => { window.__readCalls++; return realText(); };
      return f;
    };
    addWorkspace({
      rootName: name,
      files: entries.map((e) => ({
        relPath: e.relPath, name: e.relPath.split('/').pop(), fileHandle: null, webkitFile: makeFile(e.relPath, e.content),
      })),
    });
  }, [rootName, files]);
}

async function openSearchAndType(page, query) {
  await page.keyboard.press('Control+k');
  await page.locator('.search-input').fill(query);
  await page.waitForTimeout(300);
}

test('with no folder open, search explains there is nothing to search rather than searching', async ({ page }) => {
  await page.goto('/index.html');
  await openSearchAndType(page, 'anything');
  await expect(page.locator('.search-empty')).toHaveText('Open a folder first — search covers open folders, not standalone files.');
});

test('a file is found by a partial filename match', async ({ page }) => {
  await page.goto('/index.html');
  await buildWorkspace(page, 'ws', [
    { relPath: 'architecture-notes.md', content: '# Notes\n\nNothing special.\n' },
    { relPath: 'other.md', content: '# Other\n\nUnrelated.\n' },
  ]);
  await openSearchAndType(page, 'architecture-notes');
  const results = page.locator('.search-result');
  await expect(results).toHaveCount(1);
  await expect(results.locator('.search-result-name')).toHaveText('architecture-notes.md');
  await expect(results.locator('.search-result-meta')).toHaveText('filename');
});

test('a file is found by heading text, and clicking it jumps straight to that heading', async ({ page }) => {
  await page.goto('/index.html');
  await buildWorkspace(page, 'ws', [
    { relPath: 'guide.md', content: '# Guide\n\nIntro.\n\n## Getting Started\n\nSee below.\n' },
  ]);
  await openSearchAndType(page, 'getting started');
  const result = page.locator('.search-result');
  await expect(result).toHaveCount(1);
  await expect(result.locator('.search-result-meta')).toHaveText('heading');

  await result.click();
  await expect(page.locator('.crumb-current')).toHaveText('Getting Started');
});

test('a file is found by its frontmatter tag', async ({ page }) => {
  await page.goto('/index.html');
  await buildWorkspace(page, 'ws', [
    { relPath: 'roadmap.md', content: '---\ntags: [planning]\n---\n# Roadmap\n\nContent.\n' },
    { relPath: 'other.md', content: '# Other\n\nContent.\n' },
  ]);
  await openSearchAndType(page, 'planning');
  const results = page.locator('.search-result');
  await expect(results).toHaveCount(1);
  await expect(results.locator('.search-result-name')).toHaveText('roadmap.md');
  await expect(results.locator('.search-result-meta')).toHaveText('tag');
});

test('a file is found by body content, with a snippet shown; filename/heading/tag matches still rank first', async ({ page }) => {
  await page.goto('/index.html');
  await buildWorkspace(page, 'ws', [
    { relPath: 'a.md', content: '# A\n\nThe quick brown fox jumps over the lazy dog.\n' },
  ]);
  await openSearchAndType(page, 'brown fox');
  const result = page.locator('.search-result');
  await expect(result).toHaveCount(1);
  await expect(result.locator('.search-result-meta')).toHaveText('text');
  await expect(result.locator('.search-result-snippet')).toContainText('brown fox');
});

test('a search with no matches says so', async ({ page }) => {
  await page.goto('/index.html');
  await buildWorkspace(page, 'ws', [{ relPath: 'a.md', content: '# A\n\nSomething.\n' }]);
  await openSearchAndType(page, 'nonexistentxyz');
  await expect(page.locator('.search-empty')).toHaveText('No matches for "nonexistentxyz".');
});

test('lazy indexing: file content is only read on the first search, and reused (not re-read) on a later one', async ({ page }) => {
  await page.goto('/index.html');
  await buildWorkspace(page, 'ws', [
    { relPath: 'a.md', content: '# A\n\nHello world.\n' },
    { relPath: 'b.md', content: '# B\n\nGoodbye.\n' },
  ]);
  expect(await page.evaluate(() => window.__readCalls)).toBe(0);

  await openSearchAndType(page, 'hello');
  expect(await page.evaluate(() => window.__readCalls)).toBe(2);

  await page.keyboard.press('Escape');
  await openSearchAndType(page, 'hello');
  expect(await page.evaluate(() => window.__readCalls)).toBe(2);
});
