import { h } from '../utils/dom.js';
import { openOverlay, closeOverlay } from './transitions.js';
import { serializeMarkdown } from '../markdown/serializer.js';
import { showToast } from './toast.js';
import { getState } from '../state/store.js';

let overlayEl = null;

/**
 * Read-only view of the live-generated Markdown, for double-checking what's
 * about to be saved (or copying it elsewhere). Saving itself lives in one
 * place only — the header's "💾 Save" button — rather than duplicated here
 * with a different set of options depending on how the file was opened;
 * having two "save" controls with different behavior was confusing.
 */
export function openSourcePanel() {
  const { doc } = getState();
  if (!doc) { showToast('Load a document first', { type: 'error' }); return; }
  const text = serializeMarkdown(doc);

  if (overlayEl) overlayEl.remove();
  overlayEl = h('div', { class: 'overlay side-panel-overlay', hidden: true });
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) closeOverlay(overlayEl); });

  const panel = h('div', { class: 'side-panel source-panel', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'side-panel-head' }, [
      h('h2', {}, 'Markdown source'),
      h('button', { class: 'code-btn code-btn-close', type: 'button', onClick: () => closeOverlay(overlayEl) }, 'Close ✕'),
    ]),
    h('div', { class: 'side-panel-body' }, [
      h('p', { class: 'settings-help' }, 'This is generated live from the cards, notes, and AI suggestions above — exactly what "💾 Save" in the header will write. Use Copy to grab it without saving.'),
      h('textarea', { class: 'source-textarea', readonly: true }),
      h('div', { class: 'settings-actions' }, [
        h('button', {
          class: 'btn btn-ghost',
          type: 'button',
          onClick: async () => {
            await navigator.clipboard.writeText(text);
            showToast('Copied to clipboard');
          },
        }, 'Copy'),
      ]),
    ]),
  ]);

  panel.querySelector('.source-textarea').value = text;
  overlayEl.appendChild(panel);
  document.body.appendChild(overlayEl);
  openOverlay(overlayEl);
}
