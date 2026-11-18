// The Claude call, made from the extension host instead of the webview, so
// the API key (kept in context.secrets) never enters webview memory or
// state. Returns raw outcomes; turning them into user-facing messages stays
// in one place, js/ai/client.js.
const vscode = require('vscode');

const SECRET_KEY = 'mdOrchestra.claudeApiKey';
const DEFAULT_API_URL = 'https://api.anthropic.com/v1/messages';

// Overridable only by the extension-host tests (see extension.js, which
// exposes the setter only when context.extensionMode is Test).
let apiUrl = DEFAULT_API_URL;
function setApiUrlForTests(url) { apiUrl = url || DEFAULT_API_URL; }

async function callClaude(secrets, {
  model, system, prompt, maxTokens = 1200,
}) {
  if (!vscode.workspace.isTrusted) return { ok: false, untrusted: true };
  const apiKey = await secrets.get(SECRET_KEY);
  if (!apiKey) return { ok: false, noKey: true };
  let res;
  try {
    res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (err) {
    return { ok: false, networkError: err.message };
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
    return { ok: false, status: res.status, detail };
  }
  const data = await res.json();
  return { ok: true, text: (data.content || []).map((block) => block.text || '').join('\n').trim() };
}

async function hasApiKey(secrets) { return Boolean(await secrets.get(SECRET_KEY)); }
async function setApiKey(secrets, value) {
  const key = String(value || '').trim();
  if (!key) return false;
  await secrets.store(SECRET_KEY, key);
  return true;
}
async function clearApiKey(secrets) { await secrets.delete(SECRET_KEY); }

module.exports = {
  SECRET_KEY, callClaude, hasApiKey, setApiKey, clearApiKey, setApiUrlForTests,
};
