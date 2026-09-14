import { h } from '../utils/dom.js';
import { paletteFor } from '../utils/colors.js';

/**
 * Render the full heading tree into `container`. `activeTrailIds` is the set
 * of node ids from root to the currently selected node (used to keep the
 * active branch expanded and highlighted).
 */
export function renderSidebar(container, doc, activeTrailIds, onSelect) {
  container.innerHTML = '';
  if (!doc || !doc.children.length) {
    container.appendChild(h('p', { class: 'sidebar-empty' }, 'No document loaded yet.'));
    return;
  }

  const list = h('ul', { class: 'nav-tree nav-tree-root' });
  doc.children.forEach((node, index) => {
    list.appendChild(buildItem(node, index, activeTrailIds, onSelect));
  });
  container.appendChild(list);
}

function buildItem(node, topLevelIndex, activeTrailIds, onSelect) {
  const accent = paletteFor(topLevelIndex).accent;
  const isActive = activeTrailIds.includes(node.id);
  const isCurrent = activeTrailIds[activeTrailIds.length - 1] === node.id;

  const link = h(
    'button',
    {
      class: `nav-link${isActive ? ' nav-link-active' : ''}${isCurrent ? ' nav-link-current' : ''}`,
      type: 'button',
      style: `--accent:${accent}`,
      onClick: () => onSelect(node.id),
    },
    [
      h('span', { class: 'nav-dot' }),
      h('span', { class: 'nav-label' }, node.title || '(untitled)'),
    ],
  );

  const li = h('li', { class: `nav-item nav-level-${node.level}` }, [link]);

  if (node.children.length) {
    const sublist = h('ul', { class: 'nav-tree' });
    node.children.forEach((child) => sublist.appendChild(buildItem(child, topLevelIndex, activeTrailIds, onSelect)));
    li.appendChild(sublist);
  }
  return li;
}
