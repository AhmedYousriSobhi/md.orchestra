import { h } from '../utils/dom.js';
import { openOverlay, closeOverlay } from './transitions.js';
import { getAiSettings, saveAiSettings, clearAiSettings, CLAUDE_MODELS } from '../ai/settings.js';
import { getTheme, setTheme } from '../utils/theme.js';
import { showToast } from './toast.js';

let panelEl = null;

const THEME_OPTIONS = [
  { value: 'system', label: '🖥️ System' },
  { value: 'light', label: '☀️ Light' },
  { value: 'dark', label: '🌙 Dark' },
];

function buildThemeToggle() {
  const wrap = h('div', { class: 'theme-toggle', role: 'radiogroup', 'aria-label': 'Theme' });
  function render() {
    const current = getTheme();
    wrap.innerHTML = '';
    THEME_OPTIONS.forEach(({ value, label }) => {
      wrap.appendChild(h('button', {
        class: `theme-toggle-btn${value === current ? ' theme-toggle-active' : ''}`,
        type: 'button',
        role: 'radio',
        'aria-checked': String(value === current),
        onClick: () => { setTheme(value); render(); },
      }, label));
    });
  }
  render();
  return wrap;
}

function build() {
  const overlay = h('div', { class: 'overlay side-panel-overlay', hidden: true });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(overlay); });

  const settings = getAiSettings();

  const keyInput = h('input', { type: 'password', class: 'settings-input', id: 'ai-key-input', placeholder: 'sk-ant-…', autocomplete: 'off' });
  keyInput.value = settings.apiKey || '';

  const toggleBtn = h('button', {
    class: 'code-btn',
    type: 'button',
    onClick: () => {
      keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
      toggleBtn.textContent = keyInput.type === 'password' ? 'Show' : 'Hide';
    },
  }, 'Show');

  const modelSelect = h('select', { class: 'settings-input', id: 'ai-model-select' },
    CLAUDE_MODELS.map((m) => {
      const opt = h('option', { value: m.id }, m.label);
      if (m.id === settings.model) opt.selected = true;
      return opt;
    }));

  const statusLine = h('p', { class: 'settings-status' }, settings.apiKey ? 'A key is currently saved in this browser.' : 'No key saved yet.');

  const panel = h('div', { class: 'side-panel settings-panel', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'side-panel-head' }, [
      h('h2', {}, 'AI settings'),
      h('button', { class: 'code-btn code-btn-close', type: 'button', onClick: () => closeOverlay(overlay) }, 'Close ✕'),
    ]),
    h('div', { class: 'side-panel-body' }, [
      h('label', { class: 'settings-label' }, 'Appearance'),
      buildThemeToggle(),
      h('hr', { class: 'settings-divider' }),
      h('p', { class: 'settings-help' }, 'Provider support today is limited to Claude (Anthropic). Your key is stored only in this browser’s localStorage and is sent directly to api.anthropic.com — never anywhere else.'),
      h('label', { class: 'settings-label', for: 'ai-model-select' }, 'Model'),
      modelSelect,
      h('label', { class: 'settings-label', for: 'ai-key-input' }, 'Anthropic API key'),
      h('div', { class: 'settings-key-row' }, [keyInput, toggleBtn]),
      statusLine,
      h('div', { class: 'settings-actions' }, [
        h('button', {
          class: 'btn btn-primary',
          type: 'button',
          onClick: () => {
            saveAiSettings({ apiKey: keyInput.value.trim(), model: modelSelect.value, provider: 'claude' });
            statusLine.textContent = 'Saved.';
            showToast('AI settings saved');
          },
        }, 'Save'),
        h('button', {
          class: 'btn btn-ghost',
          type: 'button',
          onClick: () => {
            clearAiSettings();
            keyInput.value = '';
            statusLine.textContent = 'No key saved yet.';
            showToast('AI settings cleared');
          },
        }, 'Clear key'),
      ]),
    ]),
  ]);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  return overlay;
}

export function openSettingsPanel() {
  if (panelEl) panelEl.remove();
  panelEl = build();
  openOverlay(panelEl);
}
