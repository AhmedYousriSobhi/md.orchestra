import { h } from '../utils/dom.js';
import { renderFocalGraph } from './focalGraph.js';

// Session-only: which folders the user has collapsed, keyed by
// `${rootName}::${path}` so two open workspaces with similarly-shaped
// subdirectories don't share collapse state. Everything starts expanded —
// unlike the heading tree, a directory of Markdown files is usually
// shallow enough that showing it all at once is more useful than guessing
// what to hide.
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

/**
 * Render one open workspace's folder/file tree into `container` — the
 * Explorer's own equivalent of a VSCode multi-root folder entry: always
 * fully expanded (like every other open folder in Explorer), regardless of
 * which file is currently active elsewhere, so the sidebar never
 * reshuffles or hides a folder just because you switched to a different
 * file. `activeRelPath` highlights whichever file is currently loaded
 * (pass null if the active document isn't one of this workspace's own
 * files); `onOpenFile(relPath)` is called when the user clicks a file;
 * `onClose` (optional) renders a small "close workspace" control. Renders
 * nothing (clears the container) when `workspace` is null. Several open
 * workspaces are rendered as separate calls into separate containers — see
 * renderWorkspacesPanel.
 *
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
  const { viewMode = 'list', onToggleViewMode, pendingPaths = new Set() } = options;
  container.innerHTML = '';
  if (!workspace) return;

  const rerender = () => renderFilesTree(container, workspace, activeRelPath, onOpenFile, onClose, options);

  const head = h('div', { class: 'files-tree-head' }, [
    h('span', { class: 'files-tree-icon' }, '🗂️'),
    h('span', { class: 'files-tree-name', title: workspace.rootName }, workspace.rootName),
    onToggleViewMode ? h('button', {
      class: 'icon-btn files-tree-view-toggle',
      type: 'button',
      title: viewMode === 'graph' ? 'Switch to the plain folder list' : 'Switch to the focal-neighborhood graph',
      'aria-label': 'Toggle between list and graph view',
      onClick: onToggleViewMode,
    }, viewMode === 'graph' ? '📋' : '🕸️') : null,
    onClose ? h('button', {
      class: 'icon-btn files-tree-close',
      type: 'button',
      title: 'Close this folder',
      'aria-label': 'Close this folder',
      onClick: onClose,
    }, '✕') : null,
  ]);
  container.appendChild(head);

  if (viewMode === 'graph') {
    const graphWrap = h('div', { class: 'focal-graph-wrap' });
    container.appendChild(graphWrap);
    renderFocalGraph(graphWrap, workspace, activeRelPath, onOpenFile, pendingPaths);
    return;
  }

  const list = h('ul', { class: 'nav-tree nav-tree-root files-tree' });
  workspace.tree.children.forEach((node) => {
    list.appendChild(buildNode(workspace.rootName, node, activeRelPath, onOpenFile, rerender, pendingPaths));
  });
  container.appendChild(list);
}

function buildNode(rootName, node, activeRelPath, onOpenFile, rerender, pendingPaths) {
  if (node.type === 'dir') {
    const collapseKey = `${rootName}::${node.path}`;
    const collapsed = manualCollapse.has(collapseKey);
    const li = h('li', { class: 'nav-item files-dir' });
    const row = h('div', { class: 'nav-row' });
    row.appendChild(h('button', {
      class: `nav-chevron${collapsed ? '' : ' nav-chevron-open'}`,
      type: 'button',
      'aria-label': collapsed ? 'Expand folder' : 'Collapse folder',
      onClick: () => {
        if (collapsed) manualCollapse.delete(collapseKey); else manualCollapse.add(collapseKey);
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
      node.children.forEach((child) => sublist.appendChild(buildNode(rootName, child, activeRelPath, onOpenFile, rerender, pendingPaths)));
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

/**
 * Render every currently-open workspace into `container`, one block per
 * folder, stacked in the order they were opened — the multi-root
 * equivalent of renderFilesTree above, which this calls once per workspace
 * into its own child div. Only the workspace that actually owns
 * `activeWorkspaceRootName` gets `activeRelPath` highlighted/passed through
 * to its own pending-paths lookup; every other open folder shows plainly,
 * with nothing marked current in it — but every one, active or not, always
 * shows its full contents (see renderFilesTree), the same way Explorer's
 * multi-root view never hides a folder just because it isn't the one
 * you're currently editing in. `options` is the same shape renderFilesTree
 * takes, applied identically to each block, except
 * `onOpenFile`/`onClose`/`pendingPaths` which are called per-workspace
 * (see main.js) since each folder is its own independent identity.
 */
export function renderWorkspacesPanel(container, workspaces, activeWorkspaceRootName, activeRelPath, options = {}) {
  const { onOpenFile, onClose, pendingPathsFor, ...rest } = options;
  container.innerHTML = '';
  workspaces.forEach((workspace) => {
    const block = h('div', { class: 'workspace-block' });
    container.appendChild(block);
    const isActiveWorkspace = workspace.rootName === activeWorkspaceRootName;
    renderFilesTree(
      block,
      workspace,
      isActiveWorkspace ? activeRelPath : null,
      (relPath) => onOpenFile(workspace.rootName, relPath),
      () => onClose(workspace.rootName),
      { ...rest, pendingPaths: pendingPathsFor ? pendingPathsFor(workspace) : new Set() },
    );
  });
}
