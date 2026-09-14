import { h } from '../utils/dom.js';
import { paletteFor } from '../utils/colors.js';
import { getPath } from '../markdown/parser.js';

// Session-only expand/collapse overrides, kept separate from the main
// sidebar's own state (js/ui/sidebar.js) so opening this picker never
// changes what the sidebar itself has expanded.
const manualExpand = new Set();
const manualCollapse = new Set();

function isExpanded(node, trailIds) {
  if (manualExpand.has(node.id)) return true;
  if (manualCollapse.has(node.id)) return false;
  return trailIds.includes(node.id);
}

/**
 * A collapsible heading tree for picking one existing section as a parent
 * (used by "+ New section"). Familiar/scannable in the way a plain <select>
 * of headings wasn't, and scales to large documents the way a from-scratch
 * diagram doesn't — same interaction model as the sidebar, just for picking
 * instead of navigating.
 */
export function renderTreePicker(container, doc, selectedId, onPick) {
  container.innerHTML = '';
  const trailIds = selectedId ? getPath(doc, selectedId).map((n) => n.id) : [];
  const rerender = () => renderTreePicker(container, doc, selectedId, onPick);

  container.appendChild(h('div', { class: 'nav-row' }, [
    h('span', { class: 'nav-chevron nav-chevron-spacer' }),
    h('button', {
      class: `nav-link nav-link-top tree-picker-root${selectedId === doc.id ? ' nav-link-current' : ''}`,
      type: 'button',
      onClick: () => onPick(doc.id),
    }, [
      h('span', { class: 'nav-icon' }, '⌂'),
      h('span', { class: 'nav-label' }, 'Top of document'),
    ]),
  ]));

  const list = h('ul', { class: 'nav-tree' });
  doc.children.forEach((node, index) => list.appendChild(buildItem(node, index, trailIds, selectedId, onPick, rerender)));
  container.appendChild(list);
}

function buildItem(node, topLevelIndex, trailIds, selectedId, onPick, rerender) {
  const { accent, soft } = paletteFor(topLevelIndex);
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === selectedId;
  const isTop = node.level === 1;
  const expanded = hasChildren && isExpanded(node, trailIds);

  const li = h('li', {
    class: `nav-item nav-level-${node.level}${isTop ? ' nav-item-top' : ''}`,
    style: isTop ? `--accent:${accent}; --accent-soft:${soft};` : null,
  });

  const row = h('div', { class: 'nav-row' });
  row.appendChild(hasChildren
    ? h('button', {
      class: `nav-chevron${expanded ? ' nav-chevron-open' : ''}`,
      type: 'button',
      'aria-label': expanded ? 'Collapse' : 'Expand',
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
      class: `nav-link${isTop ? ' nav-link-top' : ''}${isSelected ? ' nav-link-current' : ''}`,
      type: 'button',
      onClick: () => onPick(node.id),
    },
    [
      isTop ? h('span', { class: 'nav-icon' }, '\u{1F4C4}') : h('span', { class: 'nav-dot' }),
      h('span', { class: 'nav-label' }, node.title || '(untitled)'),
    ],
  ));
  li.appendChild(row);

  if (expanded) {
    const sublist = h('ul', { class: 'nav-tree' });
    node.children.forEach((child) => sublist.appendChild(buildItem(child, topLevelIndex, trailIds, selectedId, onPick, rerender)));
    li.appendChild(sublist);
  }
  return li;
}
