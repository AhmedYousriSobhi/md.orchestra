import { h } from '../utils/dom.js';
import { splitBody, joinBody } from '../markdown/markers.js';
import { renderMarkdownToSafeHtml, enhanceRenderedContent } from '../markdown/render.js';
import { buildSlugIndex } from '../markdown/slug.js';
import { updateNode } from '../state/store.js';
import { attachMarkdownEditingHelpers } from './markdownEditing.js';
import { wireImageAttach, createAttachImageButton } from './imageAttach.js';

const SCOPE_KEY = 'mdDashboard.previewScope';
const OPEN_KEY = 'mdDashboard.previewOpen';

export function getPreviewScope() {
  try {
    return localStorage.getItem(SCOPE_KEY) === 'document' ? 'document' : 'section';
  } catch {
    return 'section';
  }
}

export function setPreviewScope(scope) {
  try { localStorage.setItem(SCOPE_KEY, scope); } catch { /* ignore */ }
}

/** Whether the preview panel should be open — on by default (every newly-selected section previews live alongside it), remembered per-browser once the user has explicitly toggled it via the edge tab. */
export function getPreviewOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setPreviewOpen(open) {
  try { localStorage.setItem(OPEN_KEY, open ? 'true' : 'false'); } catch { /* ignore */ }
}

// A handful of paper colors, cycling regardless of the app's own accent
// palette or light/dark theme — real sticky notes don't change color to
// match dark mode, and part of the point is that they read as a distinct,
// physical-feeling layer on top of the document rather than blending into
// its running text (unlike the main content, which does follow the theme).
const NOTE_COLORS = ['#fef08a', '#fecdd3', '#bbf7d0', '#bfdbfe', '#fed7aa', '#e9d5ff'];

function renderNoteCard(note, index) {
  const card = h('div', {
    class: 'preview-sticky-note',
    style: `--note-bg:${NOTE_COLORS[index % NOTE_COLORS.length]}; --note-tilt:${(index % 2 === 0 ? -1 : 1) * (1.5 + (index % 3))}deg;`,
  });
  card.innerHTML = renderMarkdownToSafeHtml(note.text);
  return card;
}

/**
 * A section's content, in the preview: rendered read-only by default, with
 * a "✎" button (revealed on hover) that swaps it for a plain-Markdown
 * textarea — the same editing model the card view's own "Edit content"
 * already uses, just reachable without leaving the preview. Saving writes
 * straight back to that exact node via updateNode(), so the change is
 * immediately part of the document, not a preview-only copy of it.
 */
function renderSectionBody(container, node, opts) {
  container.innerHTML = '';
  const { main } = splitBody(node.bodyMarkdown);

  function showView() {
    container.innerHTML = '';
    const editBtn = h('button', {
      class: 'icon-btn preview-edit-btn',
      type: 'button',
      title: 'Edit this section',
      'aria-label': 'Edit this section',
      onClick: showEdit,
    }, '✎');

    if (!main) {
      container.appendChild(h('div', { class: 'preview-body-wrap preview-body-empty' }, [
        h('p', { class: 'card-empty-note' }, 'No content directly under this heading.'),
        editBtn,
      ]));
      return;
    }
    const bodyEl = h('div', { class: 'rendered-markdown preview-body' });
    bodyEl.innerHTML = renderMarkdownToSafeHtml(main);
    enhanceRenderedContent(bodyEl, opts);
    container.appendChild(h('div', { class: 'preview-body-wrap' }, [bodyEl, editBtn]));
  }

  function showEdit() {
    container.innerHTML = '';
    const textarea = h('textarea', { class: 'content-edit-textarea preview-edit-textarea' });
    textarea.value = main;
    attachMarkdownEditingHelpers(textarea);
    wireImageAttach(textarea);

    const save = () => {
      const parts = splitBody(node.bodyMarkdown);
      updateNode(node.id, { bodyMarkdown: joinBody({ ...parts, main: textarea.value }) });
      // updateNode() triggers a full app re-render (main.js), which rebuilds
      // this whole panel from the now-updated document — no need to call
      // showView() here, and doing so anyway would just be redone a moment
      // later against stale content.
    };
    container.appendChild(textarea);
    container.appendChild(h('div', { class: 'edit-toolbar' }, [
      createAttachImageButton(textarea),
      h('span', { class: 'editing-hint' }, 'Enter continues a list · Tab/Shift+Tab indents · Ctrl/⌘+B/I/` formats · paste or drag an image in'),
    ]));
    container.appendChild(h('div', { class: 'edit-actions' }, [
      h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, 'Save'),
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: showView }, 'Cancel'),
    ]));
    textarea.focus();
  }

  showView();
}

/** Recursively render `node` (and its subsections) as a flowing, GitHub/PDF-style document: real heading tags, each section's own content (editable in place — see renderSectionBody), and — styled distinctly as sticky notes rather than blended into the running text — any notes attached to it. */
function renderNode(node, opts) {
  const frag = document.createDocumentFragment();

  if (node.level > 0) {
    const tag = `h${Math.min(node.level, 6)}`;
    frag.appendChild(h(tag, {}, node.title || '(untitled)'));
  }

  const bodyContainer = h('div', { class: 'preview-section-body' });
  renderSectionBody(bodyContainer, node, opts);
  frag.appendChild(bodyContainer);

  const { notes } = splitBody(node.bodyMarkdown);
  const withText = notes.filter((n) => n.text.trim());
  if (withText.length) {
    const notesWrap = h('div', { class: 'preview-notes' });
    withText.forEach((n, i) => notesWrap.appendChild(renderNoteCard(n, i)));
    frag.appendChild(notesWrap);
  }

  node.children.forEach((child) => frag.appendChild(renderNode(child, opts)));
  return frag;
}

/**
 * A clean, read-only, single flowing page — headings, prose, tables, code,
 * mermaid diagrams, notes as sticky notes — as an alternative to the app's
 * card-based editing view, closer to how the file would look rendered on
 * GitHub or exported to PDF. `scope` is 'section' (the given `node` and its
 * own subsections only) or 'document' (the whole thing, from `doc`).
 */
export function renderPreviewPanel(container, {
  doc, node, scope, onScopeChange, onClose, onOpenCode, onNavigate, onNavigateFile, fileName,
}) {
  container.innerHTML = '';

  const scopeToggle = h('div', { class: 'preview-scope-toggle' }, [
    h('button', {
      class: `preview-scope-btn${scope === 'section' ? ' preview-scope-active' : ''}`,
      type: 'button',
      onClick: () => onScopeChange('section'),
    }, 'This section'),
    h('button', {
      class: `preview-scope-btn${scope === 'document' ? ' preview-scope-active' : ''}`,
      type: 'button',
      onClick: () => onScopeChange('document'),
    }, 'Whole document'),
  ]);

  container.appendChild(h('div', { class: 'preview-head' }, [
    h('div', {}, [
      h('span', { class: 'preview-file-name' }, fileName || 'Document'),
      scopeToggle,
    ]),
    h('button', {
      class: 'code-btn code-btn-close', type: 'button', 'aria-label': 'Close preview', onClick: onClose,
    }, '✕'),
  ]));

  const root = scope === 'document' ? doc : node;
  const slugIndex = buildSlugIndex(doc);
  const page = h('div', { class: 'preview-document' });
  page.appendChild(renderNode(root, {
    onOpenCode, slugIndex, onNavigate, onNavigateFile,
  }));
  container.appendChild(page);
}
