// Direct browser -> Anthropic API call. There is no backend/proxy in this
// project: the key the user enters in Settings is stored in localStorage and
// sent only to api.anthropic.com via the header Anthropic documents for
// client-side use (`anthropic-dangerous-direct-browser-access`).
// In VS Code (hosted mode) the call is made by the extension host instead
// (vscode-extension/aiProxy.js), with the key from VS Code SecretStorage,
// so the key never enters this webview; the error messages below are still
// produced here, in one place.
import { isVSCode, request } from '../core/vscodeBridge.js';

const API_URL = 'https://api.anthropic.com/v1/messages';

function httpError(status, detail) {
  if (status === 401) return new Error('Claude rejected the API key (401 Unauthorized). Check it in Settings.');
  if (status === 429) return new Error('Rate limited by the Claude API (429). Try again shortly.');
  return new Error(`Claude request failed (${status}). ${detail}`);
}

async function callClaudeViaHost({ model, system, prompt, maxTokens }) {
  const r = await request('ai', {
    model, system, prompt, maxTokens,
  });
  if (r && r.ok) return r.text;
  if (r?.untrusted) throw new Error('Claude requests are disabled until this VS Code workspace is trusted.');
  if (r?.noKey) throw new Error('No Claude API key configured. Run "MD.Orchestra: Set Claude API Key" or open Settings and add one.');
  if (r?.networkError) throw new Error(`Could not reach the Claude API (network error): ${r.networkError}`);
  throw httpError(r?.status, r?.detail || '');
}

export async function callClaude({ apiKey, model, system, prompt, maxTokens = 1200 }) {
  if (isVSCode) return callClaudeViaHost({
    model, system, prompt, maxTokens,
  });
  if (!apiKey) {
    throw new Error('No Claude API key configured. Open Settings and add one.');
  }
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (err) {
    throw new Error(`Could not reach the Claude API (network error): ${err.message}`);
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
    throw httpError(res.status, detail);
  }

  const data = await res.json();
  return (data.content || []).map((block) => block.text || '').join('\n').trim();
}

/** Pull the first {...} JSON object out of a Claude text response. */
export function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude response did not contain JSON.');
  return JSON.parse(match[0]);
}
