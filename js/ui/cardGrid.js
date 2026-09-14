import { h } from '../utils/dom.js';
import { paletteFor } from '../utils/colors.js';
import { analyzeContent, toPlainExcerpt } from '../markdown/analyze.js';
import { splitBody, withNote, withAiInsert } from '../markdown/markers.js';
import { renderMarkdownToSafeHtml, enhanceRenderedContent } from '../markdown/render.js';
import { getPath, getTopLevelIndex } from '../markdown/parser.js';
import { getState, selectSection, updateNode } from '../state/store.js';
import { createNotesEditor } from './notesPanel.js';
import { openCodeViewer } from './codeViewer.js';
import { openInsightModal } from './insightModal.js';

const LEVEL_LABEL = ['DOC', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];

/** Render the focused card for `node` plus a grid of its direct children into `container`. */
export function renderSectionView(container, node) {
  container.innerHTML = '';
  const { doc, fileName } = getState();
  const path = getPath(doc, node.id);
  const topLevelIndex = node.level === 0 ? -1 : getTopLevelIndex(doc, node.id);
  const accent = topLevelIndex >= 0 ? paletteFor(topLevelIndex).accent : '#475569';
  const breadcrumbTitles = path.map((n) => n.title);

  container.appendChild(buildFocusedCard(node, accent, breadcrumbTitles, fileName));

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

function buildFocusedCard(node, accent, breadcrumbTitles, fileName) {
  const { main, aiInsert, note } = splitBody(node.bodyMarkdown);
  const card = h('article', { class: 'card card-focused', style: `--accent:${accent}` });

  card.appendChild(h('div', { class: 'card-head' }, [
    node.level > 0 ? h('span', { class: 'card-badge' }, LEVEL_LABEL[node.level] || `H${node.level}`) : null,
    h('h2', { class: 'card-title' }, node.level === 0 ? (fileName || 'Document') : node.title),
  ]));

  const bodyEl = h('div', { class: 'card-body rendered-markdown' });
  if (main) {
    bodyEl.innerHTML = renderMarkdownToSafeHtml(main);
    enhanceRenderedContent(bodyEl, { onOpenCode: ({ lang, code }) => openCodeViewer({ lang, code, title: node.title }) });
  } else {
    bodyEl.appendChild(h('p', { class: 'card-empty-note' }, 'No content directly under this heading.'));
  }
  card.appendChild(bodyEl);

  if (aiInsert) {
    card.appendChild(h('div', { class: 'callout callout-ai' }, [
      h('div', { class: 'callout-head' }, [
        h('span', {}, '✨ Claude suggestion'),
        h('button', {
          class: 'code-btn',
          type: 'button',
          onClick: () => updateNode(node.id, { bodyMarkdown: withAiInsert(node.bodyMarkdown, '') }),
        }, 'Remove'),
      ]),
      h('div', { class: 'rendered-markdown', html: renderMarkdownToSafeHtml(aiInsert) }),
    ]));
  }

  card.appendChild(createNotesEditor(note, (text) => updateNode(node.id, { bodyMarkdown: withNote(node.bodyMarkdown, text) })));

  card.appendChild(h('div', { class: 'card-actions' }, [
    h('button', {
      class: 'btn btn-insight',
      type: 'button',
      onClick: () => openInsightModal(node, breadcrumbTitles),
    }, '✨ Understand & suggest'),
  ]));

  return card;
}

function buildPreviewCard(node, accent) {
  const { main, note } = splitBody(node.bodyMarkdown);
  const stats = analyzeContent(main);
  const excerpt = toPlainExcerpt(main, 140)
    || (node.children.length ? `${node.children.length} subsection${node.children.length > 1 ? 's' : ''}` : 'No content yet.');

  const badges = [];
  if (stats.codeBlocks) badges.push(h('span', { class: 'stat-badge' }, `💻 ${stats.codeBlocks}`));
  if (stats.mermaidBlocks) badges.push(h('span', { class: 'stat-badge' }, `🧭 ${stats.mermaidBlocks}`));
  if (stats.tables) badges.push(h('span', { class: 'stat-badge' }, `▦ ${stats.tables}`));
  if (stats.hasDetails) badges.push(h('span', { class: 'stat-badge' }, '⌄ collapsible'));
  if (node.children.length) badges.push(h('span', { class: 'stat-badge' }, `${node.children.length} sub`));
  if (note) badges.push(h('span', { class: 'stat-badge stat-badge-note' }, '📝 note'));

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
