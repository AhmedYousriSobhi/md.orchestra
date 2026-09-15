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

function excerptOf(markdown, max = 110) {
  const plain = (markdown || '').replace(/[#*_`>[\]()~-]/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trim()}…` : (plain || '(empty)');
}

/**
 * A git-status-like list of every file with unsaved changes right now —
 * the active document (if dirty) plus any other file with a pending
 * crash-recovery snapshot elsewhere (see recovery.js's per-file tracking)
 * — so having more than one file's worth of unsaved work never has to be
 * tracked purely from memory. `activeId` marks whichever snapshot (if any)
 * corresponds to the live document. Each snapshot's `changedSections`
 * (from main.js's enrichSnapshot()/enrichActiveSnapshot(), a list of
 * {id, title, level}) is rendered as individually-clickable chips — one
 * *file* can hold several independent changes, each jumpable on its own,
 * rather than the row only ever representing "this whole file changed".
 *
 * Every row offers Save (write straight to disk — for the active row
 * that's just the normal save; for any other, without switching away from
 * what you're doing) and Discard (for the active row, revert it back to
 * its last-saved baseline; for any other, drop that pending snapshot for
 * good). Non-active rows are also clickable anywhere on the row — not only
 * their explicit Open button — to switch to that file. `handlers` is
 * `{ onSave(snapshot, isActive), onOpen(snapshot), onOpenSection(snapshot, sectionId), onDiscard(snapshot, isActive) }`.
 */
export function openChangesPanel(snapshots, activeId, handlers) {
  if (panelEl) panelEl.remove();
  const overlay = h('div', { class: 'overlay side-panel-overlay', hidden: true });
  panelEl = overlay;

  function handleClose() { closeOverlay(overlay); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) handleClose(); });

  let pending = snapshots;
  const body = h('div', { class: 'side-panel-body' });
  const subtitle = h('div', { class: 'insight-subtitle' }, '');

  function renderList() {
    const totalChanges = pending.reduce((sum, s) => sum + (s.changedSections?.length || 1), 0);
    subtitle.textContent = pending.length
      ? `${totalChanges} change${totalChanges === 1 ? '' : 's'} across ${pending.length} file${pending.length === 1 ? '' : 's'}`
      : 'Everything is saved';
    body.innerHTML = '';
    if (!pending.length) {
      body.appendChild(h('p', { class: 'sidebar-empty' }, 'Nothing to save or discard right now.'));
      return;
    }

    const list = h('div', { class: 'recovery-list' });
    pending.forEach((snap) => {
      const isActive = snap.id === activeId;
      const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
      const sections = snap.changedSections || [];

      const actions = [
        h('button', {
          class: 'btn btn-primary',
          type: 'button',
          onClick: stop(async () => {
            await handlers.onSave(snap, isActive);
            if (!isActive) { pending = pending.filter((s) => s.id !== snap.id); renderList(); }
          }),
        }, '💾 Save'),
      ];
      if (!isActive) {
        actions.push(h('button', {
          class: 'btn btn-ghost',
          type: 'button',
          onClick: stop(() => { handlers.onOpen(snap); handleClose(); }),
        }, '↪ Open'));
      }
      actions.push(h('button', {
        class: 'btn btn-ghost',
        type: 'button',
        onClick: stop(() => {
          handlers.onDiscard(snap, isActive);
          pending = pending.filter((s) => s.id !== snap.id);
          renderList();
        }),
      }, isActive ? '🗑 Discard changes' : '🗑 Discard'));

      const changesContent = sections.length
        ? h('div', { class: 'recovery-sections' }, sections.map((sec) => h('button', {
          class: 'recovery-section-chip',
          type: 'button',
          title: `Jump to "${sec.title}"`,
          onClick: stop(() => { handlers.onOpenSection(snap, sec.id); handleClose(); }),
        }, sec.title)))
        : h('p', { class: 'recovery-excerpt' }, excerptOf(snap.markdown));

      const row = h('div', {
        class: `recovery-row${isActive ? ' recovery-row-active' : ' recovery-row-clickable'}`,
        ...(isActive ? {} : {
          role: 'button',
          tabindex: '0',
          onClick: () => { handlers.onOpen(snap); handleClose(); },
          onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlers.onOpen(snap); handleClose(); } },
        }),
      }, [
        h('div', { class: 'recovery-row-head' }, [
          h('span', { class: 'recovery-file' }, [
            isActive ? h('span', { class: 'recovery-active-badge', title: 'Currently open' }, '● ') : null,
            snap.workspaceRelPath || snap.fileName,
          ]),
          h('span', { class: 'recovery-time' }, timeAgo(snap.savedAt)),
        ]),
        changesContent,
        h('div', { class: 'recovery-row-actions' }, actions),
      ]);
      list.appendChild(row);
    });
    body.appendChild(list);
  }

  const panel = h('div', { class: 'side-panel recovery-panel', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'side-panel-head' }, [
      h('div', {}, [
        h('h2', {}, '📝 Changes'),
        subtitle,
      ]),
      h('button', { class: 'code-btn code-btn-close', type: 'button', onClick: handleClose }, 'Close ✕'),
    ]),
    body,
  ]);

  renderList();
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  openOverlay(overlay);
}
