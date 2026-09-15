import { h } from '../utils/dom.js';
import { openOverlay, closeOverlay } from './transitions.js';

let currentOverlay = null;

/**
 * An in-app replacement for window.confirm() — returns a Promise<boolean>.
 * Native confirm()/alert() calls fired repeatedly on the same page (very
 * plausible across a long editing session with lots of unsaved-changes
 * guards) can get silently auto-suppressed by the browser after enough of
 * them appear in a short time — some browsers offer a "prevent this page
 * from creating additional dialogs" checkbox, and once that's ticked (or
 * after enough of them), the next confirm() just returns false immediately
 * with no dialog shown at all. From the user's side that's indistinguishable
 * from the button "doing nothing". A page-owned modal never has that
 * failure mode, and it also looks consistent with the rest of the app
 * instead of a native browser prompt.
 */
export function confirmDialog({
  title = 'Are you sure?', message = '', confirmLabel = 'Continue', cancelLabel = 'Cancel', danger = false,
} = {}) {
  if (currentOverlay) currentOverlay.remove();

  return new Promise((resolve) => {
    const overlay = h('div', { class: 'overlay confirm-overlay', hidden: true });
    currentOverlay = overlay;
    let resolved = false;

    // Covers every dismissal path with one mechanism: the Cancel/Confirm
    // buttons close explicitly (see finish() below), but a backdrop click or
    // the app-wide Escape handler (transitions.js) also just calls
    // closeOverlay() directly — this catches those too, without needing its
    // own duplicate Escape listener.
    const observer = new MutationObserver(() => {
      if (overlay.hidden && !resolved) {
        resolved = true;
        observer.disconnect();
        resolve(false);
      }
    });
    observer.observe(overlay, { attributes: true, attributeFilter: ['hidden'] });

    function finish(result) {
      if (resolved) return;
      resolved = true;
      observer.disconnect();
      closeOverlay(overlay, () => overlay.remove());
      resolve(result);
    }

    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(overlay, () => overlay.remove()); });

    const panel = h('div', { class: 'confirm-panel', role: 'alertdialog', 'aria-modal': 'true' }, [
      h('h2', { class: 'confirm-title' }, title),
      message ? h('p', { class: 'confirm-message' }, message) : null,
      h('div', { class: 'confirm-actions' }, [
        h('button', {
          class: 'btn btn-ghost', type: 'button', onClick: () => finish(false),
        }, cancelLabel),
        h('button', {
          class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onClick: () => finish(true),
        }, confirmLabel),
      ]),
    ]);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    openOverlay(overlay);
    panel.querySelector('button.btn-ghost')?.focus();
  });
}
