import { h } from '../utils/dom.js';
import { splitBody, joinBody } from '../markdown/markers.js';
import { renderMarkdownToSafeHtml, enhanceRenderedContent } from '../markdown/render.js';
import { buildSlugMaps } from '../markdown/slug.js';
import { updateNode } from '../state/store.js';
import { openCodeViewer } from './codeViewer.js';
import { attachMarkdownEditingHelpers } from './markdownEditing.js';
import { wireImageAttach, createAttachImageButton } from './imageAttach.js';

/**
 * One node's own heading (built directly here, not left to markdown-it —
 * flattening the whole document into one Markdown string and positionally
 * matching its rendered <h1>-<h6> elements back to the tree would break
 * the moment any section's own body contains a raw HTML heading tag of its
 * own, since markdown-it runs with `html: true`) plus its "main" content
 * (marker-stripped — see markers.js splitBody, the same content its own
 * section-view card would show), editable in place via the small ✎ button
 * every heading row carries — full document view is meant to be a
 * continuous read, but that shouldn't cost the ability to fix a typo
 * without switching to Sections just for that.
 */
function buildSectionBlock(node, idToSlug) {
  const frag = document.createDocumentFragment();
  const { main } = splitBody(node.bodyMarkdown);
  let bodyEl;

  function showRendered() {
    bodyEl.innerHTML = main.trim() ? renderMarkdownToSafeHtml(main) : '';
    if (!main.trim() && node.level > 0) {
      bodyEl.appendChild(h('p', { class: 'card-empty-note' }, 'No content directly under this heading.'));
    }
  }

  function enterEdit() {
    bodyEl.innerHTML = '';
    const textarea = h('textarea', { class: 'content-edit-textarea' });
    textarea.value = main;
    attachMarkdownEditingHelpers(textarea);
    wireImageAttach(textarea);

    const save = () => {
      const parts = splitBody(node.bodyMarkdown);
      updateNode(node.id, { bodyMarkdown: joinBody({ ...parts, main: textarea.value }) });
    };

    bodyEl.appendChild(textarea);
    bodyEl.appendChild(h('div', { class: 'edit-toolbar' }, [
      createAttachImageButton(textarea),
      h('span', { class: 'editing-hint' }, 'Enter continues a list · Tab/Shift+Tab indents · Ctrl/⌘+B/I/` formats · paste or drag an image in'),
    ]));
    bodyEl.appendChild(h('div', { class: 'edit-actions' }, [
      h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, 'Save content'),
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: showRendered }, 'Cancel'),
    ]));
    textarea.focus();
  }

  const rowChildren = [];
  if (node.level > 0) {
    const slug = idToSlug.get(node.id);
    const headingEl = h(`h${node.level}`, {}, node.title);
    headingEl.dataset.sectionId = node.id;
    if (slug) headingEl.id = slug;
    rowChildren.push(headingEl);
  }
  rowChildren.push(h('button', {
    class: 'icon-btn full-doc-edit-btn',
    type: 'button',
    'aria-label': node.level > 0 ? `Edit "${node.title}"` : 'Edit this document’s lead content',
    title: 'Edit this section’s content',
    onClick: () => enterEdit(),
  }, '✎'));
  frag.appendChild(h('div', { class: 'full-doc-heading-row' }, rowChildren));

  bodyEl = h('div', { class: 'full-doc-section-body' });
  showRendered();
  frag.appendChild(bodyEl);

  node.children.forEach((child) => frag.appendChild(buildSectionBlock(child, idToSlug)));
  return frag;
}

/**
 * Render the entire document as one continuous, read-first page instead of
 * fragmenting it into per-section cards (see docViewMode.js for when this
 * is chosen over cardGrid.js's renderSectionView). `focusNodeId` — the
 * currently-selected node from state/store.js, unrelated to this mode but
 * shared with section view so switching modes or clicking the
 * Explorer/Outline keeps your place — scrolls to that heading once
 * rendered, if it's not the document root.
 */
export function renderFullDocView(container, doc, fileName, { onNavigateFile, focusNodeId } = {}) {
  container.innerHTML = '';
  const card = h('article', { class: 'card card-full-doc' });
  card.appendChild(h('div', { class: 'card-head' }, [
    h('h2', { class: 'card-title' }, fileName || 'Document'),
  ]));

  const { slugToId, idToSlug } = buildSlugMaps(doc);
  const bodyEl = h('div', { class: 'full-doc-body' });
  bodyEl.appendChild(buildSectionBlock(doc, idToSlug));
  card.appendChild(bodyEl);
  container.appendChild(card);

  enhanceRenderedContent(bodyEl, {
    onOpenCode: ({ lang, code }) => openCodeViewer({ lang, code, title: fileName }),
    slugIndex: slugToId,
    onNavigate: (id) => {
      const target = bodyEl.querySelector(`[data-section-id="${id}"]`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    onNavigateFile,
  });

  if (focusNodeId) {
    const target = bodyEl.querySelector(`[data-section-id="${focusNodeId}"]`);
    if (target) target.scrollIntoView({ block: 'start' });
  }
}
