import { h } from '../utils/dom.js';
import { paletteFor } from '../utils/colors.js';
import { countDescendants } from '../markdown/parser.js';

// Session-only UI state: which branches the user has explicitly
// expanded/collapsed, overriding the "expand whatever's on the active path"
// default. Kept outside render so it survives re-renders without touching
// the document model. Keyed by node id, so it works at every nesting level.
const manualExpand = new Set();
const manualCollapse = new Set();

function isExpanded(node, activeTrailIds) {
  if (manualExpand.has(node.id)) return true;
  if (manualCollapse.has(node.id)) return false;
  return activeTrailIds.includes(node.id);
}

/**
 * Render the full heading tree into `container`. `activeTrailIds` is the set
 * of node ids from root to the currently selected node: that path is
 * expanded by default (everything else starts collapsed, so a large
 * document doesn't dump its whole outline on screen at once) and
 * highlighted.
 */
export function renderSidebar(container, doc, activeTrailIds, onSelect) {
  container.innerHTML = '';
  if (!doc || !doc.children.length) {
    container.appendChild(h('p', { class: 'sidebar-empty' }, 'No document loaded yet.'));
    return;
  }

  const rerender = () => renderSidebar(container, doc, activeTrailIds, onSelect);
  const list = h('ul', { class: 'nav-tree nav-tree-root' });
  doc.children.forEach((node, index) => {
    list.appendChild(buildItem(node, index, activeTrailIds, onSelect, rerender));
  });
  container.appendChild(list);
}

function buildItem(node, topLevelIndex, activeTrailIds, onSelect, rerender) {
  const { accent, soft } = paletteFor(topLevelIndex);
  const isActive = activeTrailIds.includes(node.id);
  const isCurrent = activeTrailIds[activeTrailIds.length - 1] === node.id;
  const hasChildren = node.children.length > 0;
  const expanded = hasChildren && isExpanded(node, activeTrailIds);
  const isTop = node.level === 1;

  const li = h('li', {
    class: `nav-item nav-level-${node.level}${isTop ? ' nav-item-top' : ''}`,
    style: isTop ? `--accent:${accent}; --accent-soft:${soft};` : null,
  });

  const row = h('div', { class: 'nav-row' });

  row.appendChild(hasChildren
    ? h('button', {
      class: `nav-chevron${expanded ? ' nav-chevron-open' : ''}`,
      type: 'button',
      'aria-label': expanded ? 'Collapse section' : 'Expand section',
      onClick: (e) => {
        e.stopPropagation();
        if (expanded) { manualCollapse.add(node.id); manualExpand.delete(node.id); } else { manualExpand.add(node.id); manualCollapse.delete(node.id); }
        rerender();
      },
    }, '▸')
    : h('span', { class: 'nav-chevron nav-chevron-spacer' }));

  row.appendChild(h(
    'button',
    {
      class: `nav-link${isTop ? ' nav-link-top' : ''}${isActive ? ' nav-link-active' : ''}${isCurrent ? ' nav-link-current' : ''}`,
      type: 'button',
      onClick: () => onSelect(node.id),
    },
    [
      isTop ? h('span', { class: 'nav-icon' }, '\u{1F4C4}') : h('span', { class: 'nav-dot' }),
      h('span', { class: 'nav-label' }, node.title || '(untitled)'),
      isTop && hasChildren ? h('span', { class: 'nav-count' }, String(countDescendants(node))) : null,
    ],
  ));

  li.appendChild(row);

  if (expanded) {
    const sublist = h('ul', { class: 'nav-tree' });
    node.children.forEach((child) => sublist.appendChild(buildItem(child, topLevelIndex, activeTrailIds, onSelect, rerender)));
    li.appendChild(sublist);
  }
  return li;
}
