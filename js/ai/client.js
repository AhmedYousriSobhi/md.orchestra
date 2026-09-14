// Direct browser -> Anthropic API call. There is no backend/proxy in this
// project: the key the user enters in Settings is stored in localStorage and
// sent only to api.anthropic.com via the header Anthropic documents for
// client-side use (`anthropic-dangerous-direct-browser-access`).
const API_URL = 'https://api.anthropic.com/v1/messages';

export async function callClaude({ apiKey, model, system, prompt, maxTokens = 1200 }) {
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
    if (res.status === 401) throw new Error('Claude rejected the API key (401 Unauthorized). Check it in Settings.');
    if (res.status === 429) throw new Error('Rate limited by the Claude API (429). Try again shortly.');
    throw new Error(`Claude request failed (${res.status}). ${detail}`);
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
