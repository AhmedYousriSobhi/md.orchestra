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
 * {id, title, level}) is rendered as its own stacked sub-row under that
 * file — one *file* can hold several independently-edited sections, each
 * with its own Save/Discard, rather than the row only ever offering an
 * all-or-nothing confirm for the whole file.
 *
 * Every file group also keeps a file-level Save all / Discard all pair (for
 * the active row: the normal save, and reverting the whole document back to
 * its baseline; for any other file: writing everything pending straight to
 * disk, or dropping the pending snapshot entirely) alongside each section's
 * own controls. Non-active rows are also clickable anywhere on the head —
 * not only their explicit Open button — to switch to that file. `handlers`
 * is `{ onSaveFile(snapshot, isActive), onSaveSection(snapshot, isActive, sectionId),
 * onOpen(snapshot), onOpenSection(snapshot, sectionId),
 * onDiscardFile(snapshot, isActive), onDiscardSection(snapshot, isActive, sectionId) }`.
 * Both discard handlers may show their own confirm dialog and resolve to
 * `false` on cancel — this panel awaits that result before dropping the
 * row/section from its own list, so a still-open confirm never gets raced
 * by the UI already acting as if it were answered.
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
    // ?? (not ||): a snapshot that WAS diffable and genuinely has zero
    // remaining changed sections (e.g. an edit that got undone right back
    // to baseline) must count as 0, not fall back to "at least 1" — that
    // fallback is only for changedSections being null/undefined (couldn't
    // diff at all, a legacy snapshot with no baseline).
    const totalChanges = pending.reduce((sum, s) => sum + (s.changedSections?.length ?? 1) + (s.tagsChanged ? 1 : 0), 0);
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
      const hasSections = sections.length > 0;

      /** Drop one already-resolved section from this file's row in place, and drop the whole row once none are left — without waiting on a full re-fetch from main.js. */
      function removeSectionLocally(sectionId) {
        snap.changedSections = sections.filter((s) => s.id !== sectionId);
        if (!snap.changedSections.length) {
          pending = pending.filter((s) => s.id !== snap.id);
        }
        renderList();
      }

      const fileActions = [
        h('button', {
          class: 'btn btn-primary',
          type: 'button',
          onClick: stop(async () => {
            await handlers.onSaveFile(snap, isActive);
            pending = pending.filter((s) => s.id !== snap.id);
            renderList();
          }),
        }, hasSections ? '💾 Save all' : '💾 Save'),
      ];
      if (!isActive) {
        fileActions.push(h('button', {
          class: 'btn btn-ghost',
          type: 'button',
          onClick: stop(() => { handlers.onOpen(snap); handleClose(); }),
        }, '↪ Open'));
      }
      fileActions.push(h('button', {
        class: 'btn btn-ghost',
        type: 'button',
        onClick: stop(async () => {
          const discarded = await handlers.onDiscardFile(snap, isActive);
          if (!discarded) return;
          pending = pending.filter((s) => s.id !== snap.id);
          renderList();
        }),
      }, hasSections ? '🗑 Discard all' : (isActive ? '🗑 Discard changes' : '🗑 Discard')));

      const changesContent = hasSections
        ? h('div', { class: 'recovery-sections' }, sections.map((sec) => h('div', { class: 'recovery-section-row' }, [
          h('button', {
            class: 'recovery-section-label',
            type: 'button',
            title: `Jump to "${sec.title}"`,
            onClick: stop(() => { handlers.onOpenSection(snap, sec.id); handleClose(); }),
          }, `${'#'.repeat(sec.level)} ${sec.title}`),
          h('div', { class: 'recovery-section-actions' }, [
            h('button', {
              class: 'code-btn',
              type: 'button',
              title: `Save just "${sec.title}"`,
              onClick: stop(async () => {
                await handlers.onSaveSection(snap, isActive, sec.id);
                removeSectionLocally(sec.id);
              }),
            }, '💾'),
            h('button', {
              class: 'code-btn code-btn-danger',
              type: 'button',
              title: `Discard changes to "${sec.title}"`,
              onClick: stop(async () => {
                const discarded = await handlers.onDiscardSection(snap, isActive, sec.id);
                if (!discarded) return;
                removeSectionLocally(sec.id);
              }),
            }, '↩'),
          ]),
        ])))
        : h('p', { class: 'recovery-excerpt' }, excerptOf(snap.markdown));

      // Tags live on the root document, not any one section, so a tags-only
      // edit never shows up in `sections` above (see markdown/diff.js's
      // tagsDiffer) — called out here explicitly rather than leaving the
      // row looking unsaved for a reason nothing else on it explains.
      const tagsChangedRow = snap.tagsChanged ? h('p', { class: 'recovery-tags-changed' }, '🏷️ Tags changed') : null;

      const row = h('div', {
        class: `recovery-row${isActive ? ' recovery-row-active' : ''}`,
      }, [
        h('div', {
          class: `recovery-row-head${isActive ? '' : ' recovery-row-clickable'}`,
          ...(isActive ? {} : {
            role: 'button',
            tabindex: '0',
            onClick: () => { handlers.onOpen(snap); handleClose(); },
            onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlers.onOpen(snap); handleClose(); } },
          }),
        }, [
          h('span', { class: 'recovery-file' }, [
            isActive ? h('span', { class: 'recovery-active-badge', title: 'Currently open' }, '● ') : null,
            snap.workspaceRelPath || snap.fileName,
          ]),
          h('span', { class: 'recovery-time' }, timeAgo(snap.savedAt)),
        ]),
        tagsChangedRow,
        changesContent,
        h('div', { class: 'recovery-row-actions' }, fileActions),
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
