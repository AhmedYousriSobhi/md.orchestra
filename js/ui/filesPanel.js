import { h } from '../utils/dom.js';

// Session-only: which folders the user has collapsed. Everything starts
// expanded — unlike the heading tree, a directory of Markdown files is
// usually shallow enough that showing it all at once is more useful than
// guessing what to hide.
const manualCollapse = new Set();

/**
 * Render the open workspace's folder/file tree into `container` (a sidebar
 * slot separate from the current file's own heading tree below it).
 * `activeRelPath` highlights whichever file is currently loaded;
 * `onOpenFile(relPath)` is called when the user clicks a file;
 * `onClose` (optional) renders a small "close workspace" control.
 * Renders nothing (clears the container) when `workspace` is null.
 */
export function renderFilesTree(container, workspace, activeRelPath, onOpenFile, onClose) {
  container.innerHTML = '';
  if (!workspace) return;

  const rerender = () => renderFilesTree(container, workspace, activeRelPath, onOpenFile, onClose);

  container.appendChild(h('div', { class: 'files-tree-head' }, [
    h('span', { class: 'files-tree-icon' }, '🗂️'),
    h('span', { class: 'files-tree-name', title: workspace.rootName }, workspace.rootName),
    onClose ? h('button', {
      class: 'icon-btn files-tree-close',
      type: 'button',
      title: 'Close this folder',
      'aria-label': 'Close this folder',
      onClick: onClose,
    }, '✕') : null,
  ]));

  const list = h('ul', { class: 'nav-tree nav-tree-root files-tree' });
  workspace.tree.children.forEach((node) => {
    list.appendChild(buildNode(node, activeRelPath, onOpenFile, rerender));
  });
  container.appendChild(list);
}

function buildNode(node, activeRelPath, onOpenFile, rerender) {
  if (node.type === 'dir') {
    const collapsed = manualCollapse.has(node.path);
    const li = h('li', { class: 'nav-item files-dir' });
    const row = h('div', { class: 'nav-row' });
    row.appendChild(h('button', {
      class: `nav-chevron${collapsed ? '' : ' nav-chevron-open'}`,
      type: 'button',
      'aria-label': collapsed ? 'Expand folder' : 'Collapse folder',
      onClick: () => {
        if (collapsed) manualCollapse.delete(node.path); else manualCollapse.add(node.path);
        rerender();
      },
    }, '▸'));
    row.appendChild(h('span', { class: 'nav-link files-dir-label' }, [
      h('span', { class: 'nav-icon' }, '📁'),
      h('span', { class: 'nav-label' }, node.name),
    ]));
    li.appendChild(row);
    if (!collapsed) {
      const sublist = h('ul', { class: 'nav-tree' });
      node.children.forEach((child) => sublist.appendChild(buildNode(child, activeRelPath, onOpenFile, rerender)));
      li.appendChild(sublist);
    }
    return li;
  }

  const isCurrent = node.path === activeRelPath;
  const li = h('li', { class: 'nav-item' });
  const row = h('div', { class: 'nav-row' });
  row.appendChild(h('span', { class: 'nav-chevron nav-chevron-spacer' }));
  row.appendChild(h('button', {
    class: `nav-link${isCurrent ? ' nav-link-current' : ''}`,
    type: 'button',
    onClick: () => onOpenFile(node.path),
  }, [
    h('span', { class: 'nav-icon' }, '📄'),
    h('span', { class: 'nav-label' }, node.name),
  ]));
  li.appendChild(row);
  return li;
}
