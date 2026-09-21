import { h } from '../utils/dom.js';
import { openOverlay, closeOverlay } from './transitions.js';

/**
 * The single source of truth for every global keyboard shortcut this app
 * binds — both this guide's own table and main.js's keydown listener read
 * from it, so the two can never silently drift apart.
 */
export const SHORTCUTS = [
  { keys: 'Ctrl/⌘ + K', action: 'Search every open folder — filenames, headings, tags, and content' },
  { keys: 'Ctrl/⌘ + S', action: 'Save what you’re currently editing (not to disk — every field autosaves already; this just commits it right now)' },
  { keys: 'Ctrl/⌘ + Shift + S', action: 'Save the whole file to disk' },
  { keys: 'Alt + O', action: 'Open a .md file' },
  { keys: 'Alt + D', action: 'Open a folder' },
  { keys: 'Alt + F', action: 'Add a new file' },
  { keys: 'Alt + A', action: 'Add a new section' },
  { keys: 'Alt + N', action: 'Add a note to the selected section' },
  { keys: 'Alt + C', action: 'Open Changes (every file with unsaved edits)' },
  { keys: 'Alt + M', action: 'Open the workspace Map' },
  { keys: 'Alt + P', action: 'Toggle the preview panel' },
  { keys: 'Alt + V', action: 'Toggle Full text / Sections view' },
  { keys: 'Alt + R', action: 'Open the raw Markdown source panel' },
  { keys: 'Alt + ,', action: 'Open Settings' },
  { keys: '?', action: 'Show this shortcuts guide' },
];

let panelEl = null;

function build() {
  const overlay = h('div', { class: 'overlay side-panel-overlay', hidden: true });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(overlay); });

  const rows = SHORTCUTS.map(({ keys, action }) => h('tr', {}, [
    h('td', { class: 'shortcuts-keys' }, keys.split(' + ').map((k, i) => (
      i === 0 ? h('kbd', {}, k) : h('span', {}, [' + ', h('kbd', {}, k)])
    ))),
    h('td', {}, action),
  ]));

  const panel = h('div', { class: 'side-panel shortcuts-panel', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'side-panel-head' }, [
      h('h2', {}, 'Keyboard shortcuts'),
      h('button', { class: 'code-btn code-btn-close', type: 'button', onClick: () => closeOverlay(overlay) }, 'Close ✕'),
    ]),
    h('div', { class: 'side-panel-body' }, [
      h('table', { class: 'shortcuts-table' }, [
        h('tbody', {}, rows),
      ]),
    ]),
  ]);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  return overlay;
}

export function openShortcutsPanel() {
  if (panelEl) panelEl.remove();
  panelEl = build();
  openOverlay(panelEl);
}
