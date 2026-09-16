import { h } from '../utils/dom.js';
import { openOverlay, closeOverlay } from './transitions.js';
import { showToast } from './toast.js';

let overlayEl = null;

/**
 * A small form for naming a brand-new Markdown file. `targets` is every
 * valid destination the caller already worked out (write-capable open
 * workspace roots/folders, or a single specific folder when opened from
 * that folder's own context menu) — each `{ label, value }`, `value` being
 * whatever shape the caller finds useful (an object, a sentinel string,
 * anything — a plain array index becomes the actual <option> value
 * instead, since HTML only allows a string there, so `value` itself never
 * needs to survive being stringified). A single target skips the picker
 * entirely and just states where the file is going. `onCreate(fileName,
 * value)` does the actual creation and closing/toasting itself, since what
 * "created" means differs (a real file on disk vs. a brand-new blank
 * standalone document when there's no write-capable workspace open at
 * all).
 */
export function openNewFileModal({ targets, onCreate }) {
  if (overlayEl) overlayEl.remove();
  overlayEl = h('div', { class: 'overlay insight-overlay', hidden: true });
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) closeOverlay(overlayEl); });

  const nameInput = h('input', { type: 'text', class: 'settings-input', placeholder: 'e.g. "notes.md"' });

  let targetSelect = null;
  const targetField = targets.length > 1
    ? (() => {
      targetSelect = h('select', { class: 'settings-input' }, targets.map((t, i) => h('option', { value: String(i) }, t.label)));
      return h('div', { class: 'insight-section' }, [h('h3', {}, 'Where'), targetSelect]);
    })()
    : h('p', { class: 'settings-help' }, `Will be created in ${targets[0]?.label || 'a new blank document'}.`);

  const submit = () => {
    let name = nameInput.value.trim();
    if (!name) { showToast('Give the new file a name first', { type: 'error' }); return; }
    if (!/\.(md|markdown)$/i.test(name)) name += '.md';
    const target = targets[targetSelect ? Number(targetSelect.value) : 0];
    onCreate(name, target?.value);
  };

  const panel = h('div', { class: 'insight-panel add-section-panel', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'side-panel-head' }, [
      h('div', {}, [
        h('h2', {}, '+ New file'),
        h('div', { class: 'insight-subtitle' }, 'A brand-new, empty Markdown file.'),
      ]),
      h('button', { class: 'code-btn code-btn-close', type: 'button', onClick: () => closeOverlay(overlayEl) }, 'Close ✕'),
    ]),
    h('div', { class: 'insight-body' }, [
      h('div', { class: 'insight-section' }, [
        h('h3', {}, 'File name'),
        nameInput,
      ]),
      targetField,
      h('button', { class: 'btn btn-primary', type: 'button', onClick: submit }, 'Create'),
    ]),
  ]);

  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

  overlayEl.appendChild(panel);
  document.body.appendChild(overlayEl);
  openOverlay(overlayEl);
  nameInput.focus();
}

export function closeNewFileModal() {
  if (overlayEl) closeOverlay(overlayEl);
}
