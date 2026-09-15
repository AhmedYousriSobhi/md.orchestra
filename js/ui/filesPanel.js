import { h } from '../utils/dom.js';
import { renderFocalGraph } from './focalGraph.js';

// Session-only: which folders the user has collapsed. Everything starts
// expanded — unlike the heading tree, a directory of Markdown files is
// usually shallow enough that showing it all at once is more useful than
// guessing what to hide.
const manualCollapse = new Set();

// Whether the workspace panel shows the focal-neighborhood graph (see
// focalGraph.js) or the plain always-expanded tree (the older behavior,
// still available as a fallback) — a standing preference, not a
// per-session toggle, so it's persisted the same way as the other sidebar
// display preferences below. Defaults to the graph; explicitly switching to
// the plain list (via the sidebar's own toggle) is what's remembered from
// then on, not the other way around.
const VIEW_MODE_KEY = 'mdDashboard.sidebarViewMode';

export function getWorkspaceViewMode() {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'graph';
  } catch {
    return 'graph';
  }
}

export function setWorkspaceViewMode(mode) {
  try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch { /* ignore */ }
}

// Whether the currently-active file (workspace file or not) is kept at the
// top of the sidebar, with the workspace tree collapsing out of the way
// when it isn't the active context — see main.js's render() for the actual
// reordering. Persisted since it's a standing preference, not a
// per-session toggle.
const ACTIVE_ON_TOP_KEY = 'mdDashboard.sidebarActiveOnTop';

export function getSidebarActiveOnTop() {
  try {
    const raw = localStorage.getItem(ACTIVE_ON_TOP_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function setSidebarActiveOnTop(value) {
  try { localStorage.setItem(ACTIVE_ON_TOP_KEY, value ? '1' : '0'); } catch { /* ignore */ }
}

// While the workspace tree is auto-collapsed (not the active context), the
// user can still peek at it without that changing which section leads —
// this remembers that per open workspace, reset whenever the tree stops
// being auto-collapsed so a later, unrelated collapse starts fresh.
let peeking = false;

/**
 * Render the open workspace's folder/file tree into `container` (a sidebar
 * slot next to the current file's own heading tree). `activeRelPath`
 * highlights whichever file is currently loaded; `onOpenFile(relPath)` is
 * called when the user clicks a file; `onClose` (optional) renders a small
 * "close workspace" control. Renders nothing (clears the container) when
 * `workspace` is null.
 *
 * `options.collapsed` renders just the head row (folder name + a peek
 * toggle) instead of the full tree — used when a non-workspace file (e.g.
 * a sample) is the active document, so the directory doesn't visually read
 * as "containing" a file it has nothing to do with. `options.activeOnTop`
 * / `options.onToggleActiveOnTop` back a small pin control that switches
 * between that behavior and always leaving the tree where it is.
 * `options.viewMode` ('list' | 'graph') / `options.onToggleViewMode` switch
 * between this plain always-expanded tree and the focal-neighborhood graph
 * (see focalGraph.js) — same header, different body. `options.pendingPaths`
 * (a Set of relPaths) marks which files have unsaved changes waiting (see
 * main.js's recovery-snapshot tracking) with a small dot, so switching
 * freely between files (nothing is ever discarded — see loadFromText)
 * still leaves a visible trail of what's been touched, without needing the
 * Changes panel open to see it.
 */
export function renderFilesTree(container, workspace, activeRelPath, onOpenFile, onClose, options = {}) {
  const {
    collapsed = false, activeOnTop = true, onToggleActiveOnTop, viewMode = 'list', onToggleViewMode, pendingPaths = new Set(),
  } = options;
  container.innerHTML = '';
  if (!workspace) return;
  if (!collapsed) peeking = false; // start fresh next time it auto-collapses

  const rerender = () => renderFilesTree(container, workspace, activeRelPath, onOpenFile, onClose, options);
  const showTree = !collapsed || peeking;

  const head = h('div', { class: 'files-tree-head' }, [
    collapsed ? h('button', {
      class: `nav-chevron${showTree ? ' nav-chevron-open' : ''}`,
      type: 'button',
      'aria-label': showTree ? 'Collapse folder view' : 'Peek at folder contents',
      onClick: () => { peeking = !peeking; rerender(); },
    }, '▸') : null,
    h('span', { class: 'files-tree-icon' }, '🗂️'),
    h('span', { class: 'files-tree-name', title: workspace.rootName }, workspace.rootName),
    onToggleViewMode ? h('button', {
      class: 'icon-btn files-tree-view-toggle',
      type: 'button',
      title: viewMode === 'graph' ? 'Switch to the plain folder list' : 'Switch to the focal-neighborhood graph',
      'aria-label': 'Toggle between list and graph view',
      onClick: onToggleViewMode,
    }, viewMode === 'graph' ? '📋' : '🕸️') : null,
    onToggleActiveOnTop ? h('button', {
      class: `icon-btn files-tree-pin${activeOnTop ? ' files-tree-pin-active' : ''}`,
      type: 'button',
      title: activeOnTop
        ? 'Keeping the active file on top — click to always leave the folder where it is'
        : 'Folder stays put — click to keep the active file on top instead',
      'aria-label': 'Toggle whether the active file leads the sidebar',
      onClick: onToggleActiveOnTop,
    }, activeOnTop ? '🔝' : '📌') : null,
    onClose ? h('button', {
      class: 'icon-btn files-tree-close',
      type: 'button',
      title: 'Close this folder',
      'aria-label': 'Close this folder',
      onClick: onClose,
    }, '✕') : null,
  ]);
  container.appendChild(head);

  if (!showTree) return;

  if (viewMode === 'graph') {
    const graphWrap = h('div', { class: 'focal-graph-wrap' });
    container.appendChild(graphWrap);
    renderFocalGraph(graphWrap, workspace, activeRelPath, onOpenFile, pendingPaths);
    return;
  }

  const list = h('ul', { class: 'nav-tree nav-tree-root files-tree' });
  workspace.tree.children.forEach((node) => {
    list.appendChild(buildNode(node, activeRelPath, onOpenFile, rerender, pendingPaths));
  });
  container.appendChild(list);
}

function buildNode(node, activeRelPath, onOpenFile, rerender, pendingPaths) {
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
      node.children.forEach((child) => sublist.appendChild(buildNode(child, activeRelPath, onOpenFile, rerender, pendingPaths)));
      li.appendChild(sublist);
    }
    return li;
  }

  const isCurrent = node.path === activeRelPath;
  const isPending = pendingPaths.has(node.path);
  const li = h('li', { class: 'nav-item' });
  const row = h('div', { class: 'nav-row' });
  row.appendChild(h('span', { class: 'nav-chevron nav-chevron-spacer' }));
  row.appendChild(h('button', {
    class: `nav-link${isCurrent ? ' nav-link-current' : ''}`,
    type: 'button',
    title: isPending ? `${node.name} — unsaved changes` : node.name,
    onClick: () => onOpenFile(node.path),
  }, [
    h('span', { class: 'nav-icon' }, '📄'),
    h('span', { class: 'nav-label' }, node.name),
    isPending ? h('span', { class: 'nav-pending-dot', title: 'Unsaved changes' }) : null,
  ]));
  li.appendChild(row);
  return li;
}
