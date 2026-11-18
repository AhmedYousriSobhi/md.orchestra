const { test, expect } = require('@playwright/test');

// #34: the app must not depend on any third-party CDN at runtime.
test('renders with every external network request blocked, and requests none', async ({ page }) => {
  const external = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => {
    external.push(route.request().url());
    return route.abort();
  });
  await page.goto('/index.html');
  const libs = await page.evaluate(() => ({
    hljs: typeof window.hljs, md: typeof window.markdownit, purify: typeof window.DOMPurify, mermaid: typeof window.mermaid,
  }));
  expect(libs).toEqual({ hljs: 'object', md: 'function', purify: 'function', mermaid: 'object' });
  expect(external).toEqual([]);
});
