import { h } from '../utils/dom.js';
import { buildSlugMaps } from '../markdown/slug.js';
import { createEditableMarkdownBody } from './editableMarkdownBody.js';

/**
 * One node's own heading, plus its "main" content as a plain, always-
 * editable Markdown textarea (see editableMarkdownBody.js — the same
 * component cardGrid.js's focused card uses) rather than a rendered,
 * read-only view: full document view is the document's raw source, one
 * continuous page, not a formatted read of it — that's the preview
 * panel's job (previewPanel.js, unchanged).
 */
function buildSectionBlock(node, idToSlug) {
  const frag = document.createDocumentFragment();

  if (node.level > 0) {
    const slug = idToSlug.get(node.id);
    const headingEl = h(`h${node.level}`, {}, node.title);
    headingEl.dataset.sectionId = node.id;
    if (slug) headingEl.id = slug;
    frag.appendChild(headingEl);
  }

  frag.appendChild(createEditableMarkdownBody(node));

  node.children.forEach((child) => frag.appendChild(buildSectionBlock(child, idToSlug)));
  return frag;
}

/**
 * Render the entire document as one continuous page of raw Markdown
 * instead of fragmenting it into per-section cards (see docViewMode.js
 * for when this is chosen over cardGrid.js's renderSectionView).
 * `focusNodeId` — the currently-selected node from state/store.js,
 * unrelated to this mode but shared with section view so switching modes
 * or clicking the Explorer/Outline keeps your place — scrolls to that
 * heading once rendered, if it's not the document root.
 */
export function renderFullDocView(container, doc, fileName, { focusNodeId } = {}) {
  container.innerHTML = '';
  const card = h('article', { class: 'card card-full-doc' });
  card.appendChild(h('div', { class: 'card-head' }, [
    h('h2', { class: 'card-title' }, fileName || 'Document'),
  ]));

  const { idToSlug } = buildSlugMaps(doc);
  const bodyEl = h('div', { class: 'full-doc-body' });
  bodyEl.appendChild(buildSectionBlock(doc, idToSlug));
  card.appendChild(bodyEl);
  container.appendChild(card);

  if (focusNodeId) {
    const target = bodyEl.querySelector(`[data-section-id="${focusNodeId}"]`);
    if (target) target.scrollIntoView({ block: 'start' });
  }
}
