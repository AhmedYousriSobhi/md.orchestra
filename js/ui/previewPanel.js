import { h } from '../utils/dom.js';
import { splitBody } from '../markdown/markers.js';
import { renderMarkdownToSafeHtml, enhanceRenderedContent } from '../markdown/render.js';
import { buildSlugIndex } from '../markdown/slug.js';

const SCOPE_KEY = 'mdDashboard.previewScope';

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

function renderNoteCard(note) {
  const card = h('div', { class: 'preview-note-card' });
  card.innerHTML = renderMarkdownToSafeHtml(note.text);
  return card;
}

/** Recursively render `node` (and its subsections) as a flowing, GitHub/PDF-style document: real heading tags, each section's own content, and any notes attached to it. */
function renderNode(node, opts) {
  const frag = document.createDocumentFragment();

  if (node.level > 0) {
    const tag = `h${Math.min(node.level, 6)}`;
    frag.appendChild(h(tag, {}, node.title || '(untitled)'));
  }

  const { main, notes } = splitBody(node.bodyMarkdown);
  if (main) {
    const bodyEl = h('div', { class: 'rendered-markdown preview-body' });
    bodyEl.innerHTML = renderMarkdownToSafeHtml(main);
    enhanceRenderedContent(bodyEl, opts);
    frag.appendChild(bodyEl);
  }

  const withText = notes.filter((n) => n.text.trim());
  if (withText.length) {
    const notesWrap = h('div', { class: 'preview-notes' });
    withText.forEach((n) => notesWrap.appendChild(renderNoteCard(n)));
    frag.appendChild(notesWrap);
  }

  node.children.forEach((child) => frag.appendChild(renderNode(child, opts)));
  return frag;
}

/**
 * A clean, read-only, single flowing page — headings, prose, tables, code,
 * mermaid diagrams, notes — as an alternative to the app's card-based
 * editing view, closer to how the file would look rendered on GitHub or
 * exported to PDF. `scope` is 'section' (the given `node` and its own
 * subsections only) or 'document' (the whole thing, from `doc`).
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
