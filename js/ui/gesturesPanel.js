import { h } from '../utils/dom.js';
import { openOverlay, closeOverlay } from './transitions.js';

/**
 * The touch-first counterpart to shortcutsPanel.js's SHORTCUTS table —
 * shown instead of it wherever there's no physical keyboard to bind to
 * (see settingsPanel.js), listing the real swipe/pinch gestures wired up
 * in main.js and mindMap.js rather than key combinations.
 */
export const GESTURES = [
  { gesture: 'Swipe right from the screen’s left edge', action: 'Go back to the parent section, or open the sidebar if you’re already at the top' },
  { gesture: 'Swipe left on the open sidebar', action: 'Close it' },
  { gesture: 'Tap anywhere outside the open sidebar', action: 'Close it' },
  { gesture: 'Pinch in/out on the mind map', action: 'Zoom out / in' },
  { gesture: 'Drag a mind-map node', action: 'Reposition it' },
];

let panelEl = null;

function build() {
  const overlay = h('div', { class: 'overlay side-panel-overlay', hidden: true });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(overlay); });

  const rows = GESTURES.map(({ gesture, action }) => h('tr', {}, [
    h('td', { class: 'shortcuts-keys' }, gesture),
    h('td', {}, action),
  ]));

  const panel = h('div', { class: 'side-panel shortcuts-panel', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'side-panel-head' }, [
      h('h2', {}, 'Touch gestures'),
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

export function openGesturesPanel() {
  if (panelEl) panelEl.remove();
  panelEl = build();
  openOverlay(panelEl);
}
