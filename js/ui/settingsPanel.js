import { h } from '../utils/dom.js';
import { openOverlay, closeOverlay } from './transitions.js';
import { getAiSettings, saveAiSettings, clearAiSettings, CLAUDE_MODELS } from '../ai/settings.js';
import { getTheme, setTheme } from '../utils/theme.js';
import { showToast } from './toast.js';
import { openShortcutsPanel } from './shortcutsPanel.js';
import { isElectron } from '../core/electronFsAdapter.js';

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

/**
 * Electron-only: version + a manual "Check for updates" button, wired to
 * electron-updater via preload.js's window.electronUpdater bridge (absent
 * entirely in browser mode, where there's no packaged build to update).
 * Returns { section, unsubscribe } so the caller can tear the status
 * listener down when the panel closes, rather than piling one up on every
 * reopen.
 */
function buildUpdateSection() {
  if (!isElectron || !window.electronUpdater) return null;

  const statusLine = h('p', { class: 'settings-status' }, 'Checking your version…');
  const checkBtn = h('button', {
    class: 'btn btn-ghost',
    type: 'button',
    onClick: () => {
      statusLine.textContent = 'Checking for updates…';
      window.electronUpdater.checkForUpdates();
    },
  }, '🔄 Check for updates');

  const STATUS_TEXT = {
    checking: () => 'Checking for updates…',
    'up-to-date': () => "You're up to date.",
    downloading: (s) => `Downloading ${s.version}…`,
    ready: (s) => `${s.version} is ready — restart to install.`,
    error: (s) => `Couldn't check: ${s.message}`,
  };

  window.electronUpdater.getVersion().then(({ version, isPackaged, lastStatus }) => {
    checkBtn.disabled = !isPackaged;
    if (!isPackaged) { statusLine.textContent = `MD.Orchestra ${version} (dev build)`; return; }
    // A background check almost always already ran (3s after launch) by
    // the time anyone opens Settings — show what it actually found rather
    // than a generic placeholder that quietly contradicts it.
    statusLine.textContent = lastStatus
      ? `MD.Orchestra ${version} — ${(STATUS_TEXT[lastStatus.state] || (() => ''))(lastStatus)}`
      : `MD.Orchestra ${version}`;
  });

  const unsubscribe = window.electronUpdater.onStatus((status) => {
    statusLine.textContent = (STATUS_TEXT[status.state] || (() => ''))(status);
  });

  const section = h('div', {}, [
    h('label', { class: 'settings-label' }, 'Software update'),
    h('div', { class: 'settings-key-row' }, [checkBtn, statusLine]),
    h('hr', { class: 'settings-divider' }),
  ]);
  return { section, unsubscribe };
}

function build() {
  const overlay = h('div', { class: 'overlay side-panel-overlay', hidden: true });
  const updateSection = buildUpdateSection();
  // transitions.js's global Escape handler closes any open overlay
  // directly (querySelectorAll + closeOverlay), bypassing this function
  // entirely — harmless for a panel with nothing to clean up, but this one
  // now holds a live update-status subscription that would otherwise leak
  // one listener per Escape-dismissed open. A local Escape listener (torn
  // down the same way every other close path is) closes that gap; both
  // handlers firing for the same keypress is fine; closeOverlay() twice on
  // the same element is a no-op the second time.
  function onEscape(e) { if (e.key === 'Escape') handleClose(); }
  function handleClose() {
    updateSection?.unsubscribe();
    document.removeEventListener('keydown', onEscape);
    closeOverlay(overlay);
  }
  document.addEventListener('keydown', onEscape);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) handleClose(); });

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
      h('button', { class: 'code-btn code-btn-close', type: 'button', onClick: handleClose }, 'Close ✕'),
    ]),
    h('div', { class: 'side-panel-body' }, [
      h('label', { class: 'settings-label' }, 'Appearance'),
      buildThemeToggle(),
      h('hr', { class: 'settings-divider' }),
      updateSection?.section,
      h('label', { class: 'settings-label' }, 'Help'),
      h('button', {
        class: 'btn btn-ghost',
        type: 'button',
        onClick: () => { handleClose(); openShortcutsPanel(); },
      }, '⌨ Keyboard shortcuts'),
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
  // Stashed on the element itself (not just closed over) so a *second*
  // open — panelEl.remove() below, without ever going through this
  // instance's own close paths — can still tear down its update-status
  // subscription instead of leaking it.
  overlay.__cleanup = () => { updateSection?.unsubscribe(); document.removeEventListener('keydown', onEscape); };
  return overlay;
}

export function openSettingsPanel() {
  if (panelEl) { panelEl.__cleanup?.(); panelEl.remove(); }
  panelEl = build();
  openOverlay(panelEl);
}
