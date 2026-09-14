import { h } from '../utils/dom.js';
import { paletteFor } from '../utils/colors.js';
import { getPath } from '../markdown/parser.js';
import { dropZoneFor, clearDropHighlight, setDropHighlight } from './dragDrop.js';

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
 * A collapsible heading tree for choosing where a new section goes (used
 * by "+ New section"). Two ways to pick a spot:
 *  - click a heading to place it inside that section (as the last child) —
 *    quick default, same as before;
 *  - drag the "New section" handle onto the tree: hovering the top/bottom
 *    third of a row places it immediately before/after that heading (as a
 *    sibling, at the exact spot — not just "first/last of the whole
 *    section"), the middle third places it inside, at the end.
 * Both call onDrop({ referenceId, placement }).
 */
export function renderTreePicker(container, doc, selectedTarget, onDrop) {
  container.innerHTML = '';
  const selectedId = selectedTarget ? selectedTarget.referenceId : null;
  const trailIds = selectedId ? getPath(doc, selectedId).map((n) => n.id) : [];
  const rerender = () => renderTreePicker(container, doc, selectedTarget, onDrop);

  const rootRow = h('div', { class: 'nav-row tree-picker-drop-row' });
  const rootBtn = h('button', {
    class: `nav-link nav-link-top tree-picker-root${selectedId === doc.id ? ' nav-link-current' : ''}`,
    type: 'button',
    onClick: () => onDrop({ referenceId: doc.id, placement: 'inside-end' }),
  }, [
    h('span', { class: 'nav-icon' }, '⌂'),
    h('span', { class: 'nav-label' }, 'Top of document'),
  ]);
  wireDropZone(rootRow, rootBtn, container, () => doc.id, () => 'inside-end', onDrop, 'inside');
  rootRow.appendChild(h('span', { class: 'nav-chevron nav-chevron-spacer' }));
  rootRow.appendChild(rootBtn);
  container.appendChild(rootRow);

  const list = h('ul', { class: 'nav-tree' });
  doc.children.forEach((node, index) => list.appendChild(buildItem(node, index, trailIds, selectedId, onDrop, rerender, container)));
  container.appendChild(list);
}

function buildItem(node, topLevelIndex, trailIds, selectedId, onDrop, rerender, pickerRoot) {
  const { accent } = paletteFor(topLevelIndex);
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === selectedId;
  const isTop = node.level === 1;
  const expanded = hasChildren && isExpanded(node, trailIds);

  const li = h('li', {
    class: `nav-item nav-level-${node.level}${isTop ? ' nav-item-top' : ''}`,
    style: isTop ? `--accent:${accent};` : null,
  });

  const row = h('div', { class: 'nav-row tree-picker-drop-row' });
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

  const link = h(
    'button',
    {
      class: `nav-link${isTop ? ' nav-link-top' : ''}${isSelected ? ' nav-link-current' : ''}`,
      type: 'button',
      onClick: () => onDrop({ referenceId: node.id, placement: 'inside-end' }),
    },
    [
      isTop ? h('span', { class: 'nav-icon' }, '\u{1F4C4}') : h('span', { class: 'nav-dot' }),
      h('span', { class: 'nav-label' }, node.title || '(untitled)'),
    ],
  );
  wireDropZone(row, link, pickerRoot, () => node.id, (zone) => (zone === 'inside' ? 'inside-end' : zone), onDrop);
  row.appendChild(link);
  li.appendChild(row);

  if (expanded) {
    const sublist = h('ul', { class: 'nav-tree' });
    node.children.forEach((child) => sublist.appendChild(buildItem(child, topLevelIndex, trailIds, selectedId, onDrop, rerender, pickerRoot)));
    li.appendChild(sublist);
  }
  return li;
}

/**
 * Make `row` a drag-and-drop target: highlights the before/inside/after
 * third under the cursor and reports the resolved placement on drop.
 * `forceZone`, when given, ignores the cursor position entirely (used for
 * the document root, which has no siblings to be "before"/"after").
 */
function wireDropZone(row, highlightEl, pickerRoot, getReferenceId, resolvePlacement, onDrop, forceZone) {
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropHighlight(pickerRoot);
    setDropHighlight(highlightEl, forceZone || dropZoneFor(row, e.clientY));
  });
  row.addEventListener('dragleave', () => highlightEl.classList.remove('tree-drop-before', 'tree-drop-inside', 'tree-drop-after'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    clearDropHighlight(pickerRoot);
    const zone = forceZone || dropZoneFor(row, e.clientY);
    onDrop({ referenceId: getReferenceId(), placement: resolvePlacement(zone) });
  });
}
