import { h } from '../utils/dom.js';
import { openOverlay, closeOverlay } from './transitions.js';

let panelEl = null;

function timeAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function excerptOf(markdown, max = 140) {
  const plain = (markdown || '').replace(/[#*_`>[\]()~-]/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trim()}…` : (plain || '(empty)');
}

/**
 * Show every pending crash-recovery snapshot at once, letting the user
 * restore or discard each one independently — the point being an actual
 * decision per file, rather than one blind window.confirm() covering
 * whatever the app happened to cache most recently. `onRestore(snapshot)`
 * and `onDiscard(snapshot)` do the actual work (loading a document, or
 * removing the localStorage entry); this panel only manages its own list
 * and closes once nothing is left to decide on.
 */
export function openRecoveryPanel(snapshots, { onRestore, onDiscard }) {
  if (panelEl) panelEl.remove();
  const overlay = h('div', { class: 'overlay side-panel-overlay', hidden: true });
  panelEl = overlay;

  function handleClose() { closeOverlay(overlay); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) handleClose(); });

  let pending = snapshots;
  const body = h('div', { class: 'side-panel-body' });

  function renderList() {
    body.innerHTML = '';
    if (!pending.length) {
      body.appendChild(h('p', { class: 'sidebar-empty' }, 'Nothing left to recover.'));
      return;
    }
    const list = h('div', { class: 'recovery-list' });
    pending.forEach((snap) => {
      list.appendChild(h('div', { class: 'recovery-row' }, [
        h('div', { class: 'recovery-row-head' }, [
          h('span', { class: 'recovery-file' }, snap.workspaceRelPath || snap.fileName),
          h('span', { class: 'recovery-time' }, timeAgo(snap.savedAt)),
        ]),
        h('p', { class: 'recovery-excerpt' }, excerptOf(snap.markdown)),
        h('div', { class: 'recovery-row-actions' }, [
          h('button', {
            class: 'btn btn-ghost',
            type: 'button',
            onClick: () => {
              onDiscard(snap);
              pending = pending.filter((s) => s.id !== snap.id);
              renderList();
            },
          }, 'Discard'),
          h('button', {
            class: 'btn btn-primary',
            type: 'button',
            onClick: () => {
              onRestore(snap);
              handleClose();
            },
          }, 'Restore'),
        ]),
      ]));
    });
    body.appendChild(list);
  }

  const panel = h('div', { class: 'side-panel recovery-panel', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'side-panel-head' }, [
      h('div', {}, [
        h('h2', {}, '🗂️ Recover unsaved work'),
        h('div', { class: 'insight-subtitle' }, "These reflect this app's last known state for each file — if you've edited any of them outside the app since, restoring won't include those changes."),
      ]),
      h('div', { style: 'display:flex; gap:0.4rem;' }, [
        pending.length > 1 ? h('button', {
          class: 'code-btn',
          type: 'button',
          onClick: () => {
            pending.slice().forEach((snap) => onDiscard(snap));
            pending = [];
            handleClose();
          },
        }, 'Discard all') : null,
        h('button', { class: 'code-btn code-btn-close', type: 'button', onClick: handleClose }, 'Close ✕'),
      ]),
    ]),
    body,
  ]);

  renderList();
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  openOverlay(overlay);
}
