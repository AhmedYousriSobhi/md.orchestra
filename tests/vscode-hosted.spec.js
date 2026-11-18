// The webview side of the VS Code extension (js/hostedMode.js,
// js/core/vscodeBridge.js), run in plain Chromium with VSCODE_STUB standing
// in for VS Code's acquireVsCodeApi(). The extension-host side runs in a
// real VS Code: see vscode-extension/test/ (`npm run test:vscode`).
const { test, expect } = require('@playwright/test');
const { VSCODE_STUB } = require('./helpers');

const DOC = '# Title\n\nIntro.\n\n## First\n\nFirst body with a [link](other.md) and ![pic](img/pic.png).\n\n## Second\n\nSecond body.\n';
const BASE = 'https://file+.vscode-resource.vscode-cdn.net/home/user/notes';

const outbox = (page) => page.evaluate(() => window.__vscodeOutbox);
const sentOfType = async (page, type) => (await outbox(page)).filter((m) => m.type === type);

async function hostLoad(page, text = DOC) {
  await expect.poll(async () => (await sentOfType(page, 'ready')).length).toBe(1);
  await page.evaluate(([t, base]) => window.__vscodeSend({
    type: 'load', text: t, fileName: 'doc.md', isDirty: false, documentBaseUri: base, syncId: 1,
  }), [text, BASE]);
  await expect(page.locator('#dirty-text')).toHaveText('doc.md — up to date');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(VSCODE_STUB);
  await page.goto('/index.html');
});

test('posts ready, renders the document the host sends, and posts no edit for an untouched load', async ({ page }) => {
  await hostLoad(page);
  await expect(page.locator('#heading-tree .nav-label', { hasText: 'Second' })).toBeVisible();
  await page.waitForTimeout(800);
  expect(await sentOfType(page, 'edit')).toEqual([]);
});

test('an in-app edit posts the whole serialized document, once', async ({ page }) => {
  await hostLoad(page);
  await page.locator('#view-mode-full-btn').click();
  await page.locator('.full-doc-source-textarea').fill(`${DOC}Added line.\n`);
  await expect.poll(async () => (await sentOfType(page, 'edit')).length, { timeout: 5000 }).toBe(1);
  const [edit] = await sentOfType(page, 'edit');
  expect(edit.text).toBe(`${DOC}Added line.\n`);
  expect(edit.syncId).toBe(1);
  await page.waitForTimeout(500);
  expect(await sentOfType(page, 'edit')).toHaveLength(1);
});

test('full-text typing sends the raw text on the keystroke itself; the model re-parses later without sending it back', async ({ page }) => {
  await hostLoad(page);
  await page.locator('#view-mode-full-btn').click();
  const ta = page.locator('.full-doc-source-textarea');
  await ta.focus();
  // Extra blank lines: the serializer would normalize these to one.
  const typed = `${DOC}\n\n\n# Brand new heading\n\nNew body.\n`;
  await ta.evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, typed);
  // Sent synchronously, as typed, before the outline (the model) knows about it.
  expect((await sentOfType(page, 'edit')).map((m) => m.text)).toEqual([typed]);
  await expect(page.locator('#heading-tree .nav-label', { hasText: 'Brand new heading' })).toHaveCount(0);
  // The field's own debounce re-parses the model (the outline itself
  // redraws once focus leaves the field, as in the standalone app)...
  await page.waitForTimeout(1000);
  await ta.evaluate((el) => el.blur());
  await expect(page.locator('#heading-tree .nav-label', { hasText: 'Brand new heading' })).toHaveCount(1, { timeout: 5000 });
  await page.waitForTimeout(500);
  // ...and the normalized form is not sent back over what the user typed.
  expect(await sentOfType(page, 'edit')).toHaveLength(1);
});

test('externalChange reloads the text and keeps the selected heading (by slug)', async ({ page }) => {
  await hostLoad(page);
  await page.locator('#heading-tree .nav-label', { hasText: 'Second' }).click();
  await expect(page.locator('#heading-tree .nav-link-current')).toContainText('Second');
  await page.evaluate((t) => window.__vscodeSend({ type: 'externalChange', text: t, isDirty: true }), DOC.replace('Intro.', 'Intro changed.'));
  await expect(page.locator('#dirty-text')).toHaveText('doc.md — unsaved changes');
  await expect(page.locator('#heading-tree .nav-link-current')).toContainText('Second');
  await page.locator('#view-mode-full-btn').click();
  await expect(page.locator('.full-doc-source-textarea')).toHaveValue(/Intro changed\./);
  await page.waitForTimeout(500);
  expect(await sentOfType(page, 'edit')).toEqual([]);
});

test("VS Code owns Ctrl+S, Ctrl+Shift+S, Ctrl+Shift+P and Ctrl+K: the app neither handles nor blocks them", async ({ page }) => {
  await hostLoad(page);
  await page.evaluate(() => {
    window.__prevented = [];
    window.addEventListener('keydown', (e) => {
      if (!['Control', 'Shift', 'Meta', 'Alt'].includes(e.key)) window.__prevented.push(e.defaultPrevented);
    });
  });
  for (const combo of ['Control+s', 'Control+Shift+S', 'Control+Shift+P', 'Control+k']) await page.keyboard.press(combo);
  expect(await page.evaluate(() => window.__prevented)).toEqual([false, false, false, false]);
  expect(await sentOfType(page, 'save')).toEqual([]);
  await expect(page.locator('.toast')).toHaveCount(0);
  await expect(page.locator('.overlay.overlay-open')).toHaveCount(0);
});

test("the dirty indicator mirrors VS Code's dirty flag, and clicking it asks VS Code to save", async ({ page }) => {
  await hostLoad(page);
  await page.evaluate(() => window.__vscodeSend({ type: 'dirty', isDirty: true }));
  await expect(page.locator('#dirty-text')).toHaveText('doc.md — unsaved changes');
  await page.locator('#dirty-indicator').click();
  expect(await sentOfType(page, 'save')).toHaveLength(1);
  await page.evaluate(() => window.__vscodeSend({ type: 'dirty', isDirty: false }));
  await expect(page.locator('#dirty-text')).toHaveText('doc.md — up to date');
});

test('each keystroke is sent at once (no debounce window), and the flush request reports it with its syncId', async ({ page }) => {
  await hostLoad(page);
  await page.locator('#view-mode-full-btn').click();
  const ta = page.locator('.full-doc-source-textarea');
  await ta.focus();
  await ta.evaluate((el) => { el.value += 'Typed fast.\n'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  // Synchronously, before any debounce could have fired.
  const edits = await sentOfType(page, 'edit');
  expect(edits).toHaveLength(1);
  expect(edits[0].text).toBe(`${DOC}Typed fast.\n`);
  await page.evaluate(() => window.__vscodeSend({ type: 'hostRequest', id: 7, op: 'flush' }));
  await expect.poll(async () => (await sentOfType(page, 'hostResponse')).length).toBe(1);
  const [reply] = await sentOfType(page, 'hostResponse');
  expect(reply.id).toBe(7);
  expect(reply.result.text).toBe(`${DOC}Typed fast.\n`);
  expect(reply.result.syncId).toBe(1);
  // Focus stays in the field (nothing is blurred to flush).
  await expect(ta).toBeFocused();
});

test('the Claude call goes through a host request, not fetch, and never carries an API key', async ({ page }) => {
  let networkCalls = 0;
  await page.route('https://api.anthropic.com/**', (route) => { networkCalls += 1; route.abort(); });
  await page.evaluate(() => {
    localStorage.setItem('mdDashboard.aiSettings.v1', JSON.stringify({ apiKey: 'sk-ant-local-secret', model: 'claude-sonnet-5' }));
    window.__vscodeAutoReply = (m) => (m.op === 'ai' ? { ok: true, text: 'reply from host' } : undefined);
  });
  const text = await page.evaluate(async () => {
    const { callClaude } = await import('/js/ai/client.js');
    const { getAiSettings } = await import('/js/ai/settings.js');
    const s = getAiSettings();
    return callClaude({ apiKey: s.apiKey, model: s.model, prompt: 'hello' });
  });
  expect(text).toBe('reply from host');
  const requests = (await outbox(page)).filter((m) => m.type === 'request');
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ op: 'ai', model: 'claude-sonnet-5', prompt: 'hello' });
  expect(JSON.stringify(await outbox(page))).not.toContain('sk-ant-local-secret');
  expect(networkCalls).toBe(0);

  await page.evaluate(() => { window.__vscodeAutoReply = (m) => (m.op === 'ai' ? { ok: false, noKey: true } : undefined); });
  const error = await page.evaluate(async () => {
    const { callClaude } = await import('/js/ai/client.js');
    try { await callClaude({ model: 'm', prompt: 'p' }); return null; } catch (e) { return e.message; }
  });
  expect(error).toMatch(/No Claude API key configured/);
});

test('Settings sends a new key to the host and never shows or stores it in the webview', async ({ page }) => {
  await page.evaluate(() => {
    window.__vscodeAutoReply = (m) => {
      if (m.op === 'hasApiKey') return Boolean(window.__hasKey);
      if (m.op === 'setApiKey') { window.__hasKey = true; return true; }
      if (m.op === 'clearApiKey') { window.__hasKey = false; return true; }
      return undefined;
    };
  });
  await page.locator('#settings-btn').click();
  await expect(page.locator('.settings-status')).toHaveText('No key saved yet.');
  await expect(page.locator('.theme-toggle')).toHaveCount(0);
  await page.locator('#ai-key-input').fill('sk-ant-new-key');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.settings-status')).toHaveText('A key is saved in VS Code SecretStorage.');
  await expect(page.locator('#ai-key-input')).toHaveValue('');
  const set = (await outbox(page)).find((m) => m.op === 'setApiKey');
  expect(set.value).toBe('sk-ant-new-key');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify(window.__vscodeState || {}));
  expect(stored).not.toContain('sk-ant-new-key');
});

test('a relative link is handed to the host instead of navigating, and a relative image resolves against the document folder', async ({ page }) => {
  await hostLoad(page);
  await page.locator('#heading-tree .nav-label', { hasText: 'First' }).click();
  const link = page.locator('#preview-panel a', { hasText: 'link' });
  await expect(link).toBeVisible();
  await expect(page.locator('#preview-panel img')).toHaveAttribute('src', `${BASE}/img/pic.png`);
  const url = page.url();
  await link.click();
  expect(await sentOfType(page, 'openLink')).toEqual([{ type: 'openLink', href: 'other.md' }]);
  expect(page.url()).toBe(url);
});

test('a file dropped onto the webview never replaces the hosted document', async ({ page }) => {
  await hostLoad(page);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['# Other file\n'], 'other.md', { type: 'text/markdown' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(500);
  await expect(page.locator('#dirty-text')).toHaveText('doc.md — up to date');
  expect(await sentOfType(page, 'edit')).toEqual([]);
});

test("with css/vscode.css (as the extension injects it) the app's file-management chrome is hidden", async ({ page }) => {
  await page.addStyleTag({ url: '/css/vscode.css' });
  await hostLoad(page);
  for (const id of ['#explorer-section', '#open-file-btn', '#open-folder-btn', '#open-github-btn', '#add-file-btn', '#changes-btn', '#search-btn']) {
    await expect(page.locator(id)).toBeHidden();
  }
  await expect(page.locator('#outline-section')).toBeVisible();
});
