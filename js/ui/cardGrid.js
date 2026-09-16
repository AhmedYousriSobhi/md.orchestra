import { h } from '../utils/dom.js';
import { paletteFor } from '../utils/colors.js';
import { analyzeContent, toPlainExcerpt } from '../markdown/analyze.js';
import {
  splitBody, joinBody, withAiInsert, addNote,
} from '../markdown/markers.js';
import { renderMarkdownToSafeHtml, enhanceRenderedContent } from '../markdown/render.js';
import { getPath, getTopLevelIndex } from '../markdown/parser.js';
import { buildSlugIndex } from '../markdown/slug.js';
import { generateTocMarkdown, looksLikeTocSection } from '../markdown/toc.js';
import {
  getState, selectSection, updateNode, removeSection, canUndoNode, undoNode,
} from '../state/store.js';
import { createNotesSection, focusNewestNoteTextarea } from './notesPanel.js';
import { openCodeViewer } from './codeViewer.js';
import { openInsightModal } from './insightModal.js';
import { showToast } from './toast.js';
import { attachMarkdownEditingHelpers } from './markdownEditing.js';
import { wireImageAttach, createAttachImageButton } from './imageAttach.js';
import { confirmDialog } from './confirmDialog.js';

const LEVEL_LABEL = ['DOC', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];

/** Render the focused card for `node` plus a grid of its direct children into `container`. `onNavigateFile` (optional) handles a link to another file in an open workspace — see markdown/render.js. */
export function renderSectionView(container, node, onNavigateFile) {
  container.innerHTML = '';
  const { doc, fileName } = getState();
  const path = getPath(doc, node.id);
  const topLevelIndex = node.level === 0 ? -1 : getTopLevelIndex(doc, node.id);
  const accent = topLevelIndex >= 0 ? paletteFor(topLevelIndex).accent : '#475569';
  const breadcrumbTitles = path.map((n) => n.title);
  const slugIndex = buildSlugIndex(doc);

  container.appendChild(buildFocusedCard(node, accent, breadcrumbTitles, fileName, slugIndex, onNavigateFile));

  if (node.children.length) {
    container.appendChild(h('h3', { class: 'grid-heading' }, node.level === 0 ? 'Sections' : 'Subsections'));
    const grid = h('div', { class: 'card-grid' });
    node.children.forEach((child, i) => {
      const childAccent = topLevelIndex >= 0 ? accent : paletteFor(i).accent;
      grid.appendChild(buildPreviewCard(child, childAccent));
    });
    container.appendChild(grid);
  } else if (node.level > 0) {
    container.appendChild(h('p', { class: 'grid-empty' }, 'This section has no subsections.'));
  }
}

function buildFocusedCard(node, accent, breadcrumbTitles, fileName, slugIndex, onNavigateFile) {
  const { main, aiInsert, notes } = splitBody(node.bodyMarkdown);
  const card = h('article', { class: 'card card-focused', style: `--accent:${accent}` });
  // Always re-read node.bodyMarkdown (not the `main`/`aiInsert`/`notes` above)
  // at the moment of each edit: several independent fields (multiple notes,
  // the AI-insert callout, the main body) can each change without the others
  // triggering a full re-render — see main.js's focus guard — so a stale
  // closure here would silently revert whichever field wasn't just edited.
  const currentParts = () => splitBody(node.bodyMarkdown);
  const onNavigate = (id) => selectSection(id);
  const renderBody = () => renderMarkdownToSafeHtml(main);

  const headEl = h('div', { class: 'card-head' });
  card.appendChild(headEl);
  renderTitle(headEl, node, fileName);

  const bodyEl = h('div', { class: 'card-body rendered-markdown' });
  function showRenderedBody() {
    bodyEl.innerHTML = '';
    if (main) {
      bodyEl.innerHTML = renderBody();
      enhanceRenderedContent(bodyEl, {
        onOpenCode: ({ lang, code }) => openCodeViewer({ lang, code, title: node.title }),
        slugIndex,
        onNavigate,
        onNavigateFile,
      });
    } else {
      bodyEl.appendChild(h('p', { class: 'card-empty-note' }, 'No content directly under this heading.'));
    }
  }
  showRenderedBody();
  card.appendChild(bodyEl);

  const editContentBtn = h('button', {
    class: 'code-btn',
    type: 'button',
    onClick: () => enterContentEditMode(bodyEl, main, node, showRenderedBody),
  }, '✎ Edit content');

  // Steps back through this section's own edit history (see store.js's
  // updateNode/undoNode) — content edits, notes, title renames, an inserted
  // AI suggestion, a regenerated ToC — one step per click, oldest edits
  // last. Disabled rather than hidden when there's nothing to undo yet, so
  // it doesn't shift the other buttons around as history accumulates.
  const undoBtn = h('button', {
    class: 'code-btn',
    type: 'button',
    disabled: !canUndoNode(node.id),
    title: 'Undo the last change to this section',
    onClick: () => {
      if (undoNode(node.id)) showToast('Undid the last change to this section');
    },
  }, '↩ Undo');

  if (aiInsert) {
    const aiBodyEl = h('div', { class: 'rendered-markdown', html: renderMarkdownToSafeHtml(aiInsert) });
    enhanceRenderedContent(aiBodyEl, {
      onOpenCode: ({ lang, code }) => openCodeViewer({ lang, code, title: node.title }),
      slugIndex,
      onNavigate,
      onNavigateFile,
    });
    card.appendChild(h('div', { class: 'callout callout-ai' }, [
      h('div', { class: 'callout-head' }, [
        h('span', {}, '✨ Claude suggestion'),
        h('button', {
          class: 'code-btn',
          type: 'button',
          onClick: () => updateNode(node.id, { bodyMarkdown: withAiInsert(node.bodyMarkdown, '') }),
        }, 'Remove'),
      ]),
      aiBodyEl,
    ]));
  }

  const handleAddNote = () => {
    const countBefore = document.querySelectorAll('.notes-textarea').length;
    updateNode(node.id, { bodyMarkdown: addNote(node.bodyMarkdown) });
    focusNewestNoteTextarea(countBefore);
  };

  // Notes only get their own (deliberately understated — see cards.css)
  // section once there's actually one to show; an empty notes drawer
  // permanently below every section's content competed with that content
  // for attention despite having nothing in it yet. With none yet, adding
  // the first one is just another action alongside Edit content/Undo —
  // the same visual weight as everything else that isn't the document
  // itself.
  if (notes.length > 0) {
    card.appendChild(createNotesSection(notes, {
      onUpdate: (id, text) => {
        const parts = currentParts();
        updateNode(node.id, { bodyMarkdown: joinBody({ ...parts, notes: parts.notes.map((n) => (n.id === id ? { ...n, text } : n)) }) });
      },
      onAdd: handleAddNote,
      onDelete: (id) => {
        const parts = currentParts();
        updateNode(node.id, { bodyMarkdown: joinBody({ ...parts, notes: parts.notes.filter((n) => n.id !== id) }) });
      },
    }));
  }

  const actions = [editContentBtn, undoBtn];
  if (!notes.length) {
    actions.push(h('button', { class: 'code-btn', type: 'button', onClick: handleAddNote }, '📝 Add note'));
  }

  if (looksLikeTocSection(node)) {
    actions.push(h('button', {
      class: 'code-btn',
      type: 'button',
      onClick: () => {
        const regenerated = generateTocMarkdown(getState().doc, { excludeId: node.id });
        updateNode(node.id, { bodyMarkdown: joinBody({ ...currentParts(), main: regenerated }) });
        showToast('Table of contents regenerated from the current headings');
      },
    }, '🔄 Regenerate from headings'));
  }

  if (node.level > 0) {
    actions.push(h('button', {
      class: 'code-btn code-btn-danger',
      type: 'button',
      onClick: async () => {
        const count = 1 + countAllDescendants(node);
        const ok = await confirmDialog({
          title: `Delete "${node.title}"?`,
          message: count > 1 ? `This will also delete its ${count - 1} subsection(s). This can't be undone.` : "This can't be undone.",
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        const parentId = removeSection(node.id);
        if (parentId) selectSection(parentId);
        showToast(`Deleted "${node.title}"`);
      },
    }, '🗑 Delete section'));
  }

  card.appendChild(h('div', { class: 'card-actions' }, [
    h('div', { class: 'card-actions-left' }, actions),
    h('button', {
      class: 'btn btn-insight',
      type: 'button',
      title: 'Understand & suggest — ask Claude about this section',
      'aria-label': 'Understand & suggest — ask Claude about this section',
      onClick: () => openInsightModal(node, breadcrumbTitles),
    }, [
      h('span', { class: 'btn-insight-icon' }, '✨'),
      h('span', { class: 'btn-insight-label' }, 'Understand & suggest'),
    ]),
  ]));

  return card;
}

function countAllDescendants(node) {
  return node.children.reduce((sum, c) => sum + 1 + countAllDescendants(c), 0);
}

function renderTitle(headEl, node, fileName) {
  headEl.innerHTML = '';
  if (node.level > 0) headEl.appendChild(h('span', { class: 'card-badge' }, LEVEL_LABEL[node.level] || `H${node.level}`));
  headEl.appendChild(h('h2', { class: 'card-title' }, node.level === 0 ? (fileName || 'Document') : node.title));
  if (node.level > 0) {
    headEl.appendChild(h('button', {
      class: 'icon-btn title-edit-btn',
      type: 'button',
      'aria-label': 'Edit title',
      title: 'Edit title',
      onClick: () => enterTitleEditMode(headEl, node, fileName),
    }, '✎'));
  }
}

function enterTitleEditMode(headEl, node, fileName) {
  headEl.innerHTML = '';
  const input = h('input', { type: 'text', class: 'title-edit-input' });
  input.value = node.title;
  let cancelled = false;

  // Route Enter/Escape through blur() rather than committing directly: the
  // main render loop skips rebuilding this card while a field inside it has
  // focus (so an in-progress edit elsewhere isn't clobbered — see main.js),
  // so a title change only becomes visible in the sidebar/breadcrumb once
  // this input isn't the focused element any more, which blur() guarantees.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelled = true; input.blur(); }
  });
  input.addEventListener('blur', () => {
    if (cancelled) { renderTitle(headEl, node, fileName); return; }
    const value = input.value.trim();
    // Deferred to a fresh macrotask: this blur is very often *caused* by
    // the user clicking a different heading (sidebar or workspace file
    // tree), and updateNode() re-renders that same tree — rebuilding the
    // very element mid-click and swallowing it (see notesPanel.js's blur
    // handler for the same reasoning in more detail). Only the actual
    // state-changing path needs this; the no-op branch below doesn't
    // trigger a re-render, so it's not racy.
    if (value && value !== node.title) setTimeout(() => updateNode(node.id, { title: value }), 0);
    else renderTitle(headEl, node, fileName);
  });

  headEl.appendChild(input);
  input.focus();
  input.select();
}

function enterContentEditMode(bodyEl, main, node, onDone) {
  bodyEl.innerHTML = '';
  const textarea = h('textarea', { class: 'content-edit-textarea' });
  textarea.value = main;
  attachMarkdownEditingHelpers(textarea);
  wireImageAttach(textarea);

  if (!main.trim() && looksLikeTocSection(node)) {
    // Starting to fill in an empty "Table of Contents" section: give it a
    // first draft from the document's current headings straight away,
    // same idea as "Regenerate from headings" but offered up front.
    textarea.value = generateTocMarkdown(getState().doc, { excludeId: node.id });
  }

  const save = () => {
    const parts = splitBody(node.bodyMarkdown);
    updateNode(node.id, { bodyMarkdown: joinBody({ ...parts, main: textarea.value }) });
  };
  const cancel = () => onDone();

  bodyEl.appendChild(textarea);
  bodyEl.appendChild(h('div', { class: 'edit-toolbar' }, [
    createAttachImageButton(textarea),
    h('span', { class: 'editing-hint' }, 'Enter continues a list · Tab/Shift+Tab indents · Ctrl/⌘+B/I/` formats · paste or drag an image in'),
  ]));
  bodyEl.appendChild(h('div', { class: 'edit-actions' }, [
    h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, 'Save content'),
    h('button', { class: 'btn btn-ghost', type: 'button', onClick: cancel }, 'Cancel'),
  ]));
  textarea.focus();
}

function buildPreviewCard(node, accent) {
  const { main, notes } = splitBody(node.bodyMarkdown);
  const stats = analyzeContent(main);
  const excerpt = toPlainExcerpt(main, 140)
    || (node.children.length ? `${node.children.length} subsection${node.children.length > 1 ? 's' : ''}` : 'No content yet.');

  const badges = [];
  if (stats.codeBlocks) badges.push(h('span', { class: 'stat-badge' }, `💻 ${stats.codeBlocks}`));
  if (stats.mermaidBlocks) badges.push(h('span', { class: 'stat-badge' }, `🧭 ${stats.mermaidBlocks}`));
  if (stats.tables) badges.push(h('span', { class: 'stat-badge' }, `▦ ${stats.tables}`));
  if (stats.hasDetails) badges.push(h('span', { class: 'stat-badge' }, '⌄ collapsible'));
  if (node.children.length) badges.push(h('span', { class: 'stat-badge' }, `${node.children.length} sub`));
  if (notes.length) badges.push(h('span', { class: 'stat-badge stat-badge-note' }, `📝 ${notes.length > 1 ? `${notes.length} notes` : 'note'}`));

  return h('article', {
    class: 'card card-preview',
    style: `--accent:${accent}`,
    tabindex: '0',
    role: 'button',
    onClick: () => selectSection(node.id),
    onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSection(node.id); } },
  }, [
    h('div', { class: 'card-head' }, [
      h('span', { class: 'card-badge' }, LEVEL_LABEL[node.level] || `H${node.level}`),
      h('h3', { class: 'card-title card-title-sm' }, node.title),
    ]),
    h('p', { class: 'card-excerpt' }, excerpt),
    badges.length ? h('div', { class: 'card-stats' }, badges) : null,
  ]);
}
