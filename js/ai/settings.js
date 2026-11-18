import { isVSCode } from '../core/vscodeBridge.js';

const STORAGE_KEY = 'mdDashboard.aiSettings.v1';

export const CLAUDE_MODELS = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (recommended)' },
  { id: 'claude-opus-5', label: 'Claude Opus 5 (most capable)' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fastest)' },
];

const DEFAULTS = {
  provider: 'claude',
  apiKey: '',
  model: CLAUDE_MODELS[0].id,
};

// In VS Code the key lives in the extension host's SecretStorage, never in
// webview storage: it is stripped on read and on write.
function withoutKeyInVSCode(settings) {
  return isVSCode ? { ...settings, apiKey: '' } : settings;
}

export function getAiSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return withoutKeyInVSCode({ ...DEFAULTS, ...JSON.parse(raw) });
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAiSettings(settings) {
  const merged = withoutKeyInVSCode({ ...getAiSettings(), ...settings });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

export function clearAiSettings() {
  localStorage.removeItem(STORAGE_KEY);
}
