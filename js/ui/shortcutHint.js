// One-time, dismissible tip that the keyboard shortcuts exist (docs/UI_UX_REVIEW.md
// gap #1). Shown once ever per browser profile — the seen-flag is set when it
// first appears, so ignoring it also counts. Not shown on touch-only devices,
// where there's no keyboard to press `?` on, nor in the narrow layout.
import { h } from '../utils/dom.js';

const SEEN_KEY = 'mdDashboard.shortcutHintSeen';

function hasBeenSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; }
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
}

export function maybeShowShortcutHint({ onOpenShortcuts }) {
  if (hasBeenSeen()) return;
  // Touch-only devices have no keyboard, and the narrow (mobile) layout has no
  // spare room: a floating bar there would cover the sidebar's own items.
  if (window.matchMedia
    && window.matchMedia('(pointer: coarse) and (hover: none), (max-width: 860px)').matches) return;
  markSeen();
  const bar = h('div', { class: 'shortcut-hint', role: 'status' }, [
    h('span', {}, [
      'Tip: press ',
      h('kbd', {}, '?'),
      ' any time to see keyboard shortcuts.',
    ]),
    h('button', {
      class: 'btn btn-ghost shortcut-hint-open', type: 'button',
      onClick: () => { bar.remove(); onOpenShortcuts(); },
    }, 'Show'),
    h('button', {
      class: 'shortcut-hint-close', type: 'button', 'aria-label': 'Dismiss tip',
      onClick: () => bar.remove(),
    }, '×'),
  ]);
  document.body.appendChild(bar);
}
