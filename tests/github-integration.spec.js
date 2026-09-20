const { test, expect } = require('@playwright/test');
const { mockGithubRepo } = require('./helpers');

test('parseGithubRepoInput accepts every input shape it claims to', async ({ page }) => {
  await page.goto('/index.html');
  const results = await page.evaluate(async () => {
    const mod = await import('/js/core/githubIO.js');
    const cases = [
      'acme/demo',
      'https://github.com/acme/demo',
      'https://github.com/acme/demo/tree/develop',
      'git@github.com:acme/demo.git',
      'not-a-repo',
      '',
    ];
    return cases.map((c) => [c, mod.parseGithubRepoInput(c)]);
  });
  expect(results[0][1]).toEqual({ owner: 'acme', repo: 'demo', branch: null });
  expect(results[1][1]).toEqual({ owner: 'acme', repo: 'demo', branch: null });
  expect(results[2][1]).toEqual({ owner: 'acme', repo: 'demo', branch: 'develop' });
  expect(results[3][1]).toEqual({ owner: 'acme', repo: 'demo', branch: null });
  expect(results[4][1]).toBeNull();
  expect(results[5][1]).toBeNull();
});

test('loading a public repo opens its README and lists its files in the Explorer', async ({ page }) => {
  await mockGithubRepo(page, {
    owner: 'acme',
    repo: 'demo',
    files: {
      'README.md': '# Demo Repo\n\n## Section One\nHello from GitHub.\n',
      'docs/guide.md': '# Guide\n\nA nested doc.\n',
    },
  });
  await page.goto('/index.html');

  await page.click('#open-github-btn');
  await page.locator('.insight-panel input').first().fill('acme/demo');
  await page.click('text=Load repo');
  await page.waitForTimeout(500);

  await expect(page.locator('#dirty-text')).toHaveText('README.md — up to date');
  await expect(page.locator('.insight-overlay')).toBeHidden();

  // Nested file navigation through the Explorer's FocalGraph.
  await page.locator('#workspace-tree g[aria-label="docs"]').click();
  await page.locator('#workspace-tree g[aria-label="guide.md"]').click();
  await expect(page.locator('#dirty-text')).toHaveText('guide.md — up to date');
});

test('a GitHub-sourced workspace is read-only: no write target, and Save fails with an honest message', async ({ page }) => {
  await mockGithubRepo(page, {
    owner: 'acme',
    repo: 'demo',
    files: { 'README.md': '# Demo Repo\n\nHello.\n' },
  });
  await page.goto('/index.html');
  await page.click('#open-github-btn');
  await page.locator('.insight-panel input').first().fill('acme/demo');
  await page.click('text=Load repo');
  await page.waitForTimeout(500);

  await page.click('#add-file-btn');
  const targetOptions = await page.locator('.insight-panel select option, .insight-panel p.settings-help').allTextContents();
  expect(targetOptions.join(' ')).not.toContain('acme/demo');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+Shift+S');
  await expect(page.locator('.toast', { hasText: 'read-only' })).toBeVisible();
});
