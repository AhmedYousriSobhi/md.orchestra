import { h } from '../utils/dom.js';
import { renderFocalGraph } from './focalGraph.js';

// Which open workspaces (by rootName) are folded down to just their own
// header row — a standing preference like the sidebar's other display
// toggles, not a per-session thing, so a folder you've folded away stays
// folded next time. Unrelated to the focal graph's own "+N" ghost nodes
// for a deep/wide subdirectory (see focalGraph.js) — this is one level up,
// collapsing an entire open root the way a VSCode multi-root Explorer lets
// you fold a whole workspace folder shut.
const COLLAPSED_KEY = 'mdDashboard.explorerCollapsedWorkspaces';

function getCollapsedWorkspaces() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function setWorkspaceCollapsed(rootName, collapsed) {
  const set = getCollapsedWorkspaces();
  if (collapsed) set.add(rootName); else set.delete(rootName);
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

/** Drop a closed workspace's own fold preference — see main.js's handleCloseWorkspace. Without this, every distinct folder name ever opened stays in this persisted set for good, even long after it's been closed. */
export function forgetWorkspaceCollapsed(rootName) {
  setWorkspaceCollapsed(rootName, false);
}

/**
 * Render one open workspace's contents (the focal-neighborhood graph — see
 * focalGraph.js) into `container`. `activeRelPath` highlights whichever
 * file is currently loaded (pass null if the active document isn't one of
 * this workspace's own files); `onOpenFile(relPath)` is called when the
 * user clicks a file; `onClose` (optional) renders a small "close
 * workspace" control. Renders nothing (clears the container) when
 * `workspace` is null. Several open workspaces are rendered as separate
 * calls into separate containers — see renderWorkspacesPanel.
 *
 * The head row's own fold chevron collapses this one workspace down to
 * just its header (persisted — see COLLAPSED_KEY above); a pending-changes
 * dot appears next to its name while collapsed if anything inside it has
 * unsaved edits waiting, so folding a folder away never hides that fact.
 * `options.pendingPaths` (a Set of relPaths) is also what drives the same
 * dot on individual files inside the graph (see main.js's recovery-
 * snapshot tracking), so switching freely between files (nothing is ever
 * discarded — see loadFromText) still leaves a visible trail of what's
 * been touched.
 */
function renderFilesTree(container, workspace, activeRelPath, onOpenFile, onClose, options = {}) {
  const { pendingPaths = new Set() } = options;
  container.innerHTML = '';
  if (!workspace) return;

  const collapsed = getCollapsedWorkspaces().has(workspace.rootName);
  const rerender = () => renderFilesTree(container, workspace, activeRelPath, onOpenFile, onClose, options);

  const head = h('div', { class: 'files-tree-head' }, [
    h('button', {
      class: `nav-chevron${collapsed ? '' : ' nav-chevron-open'}`,
      type: 'button',
      'aria-label': collapsed ? 'Expand this folder' : 'Collapse this folder',
      onClick: () => { setWorkspaceCollapsed(workspace.rootName, !collapsed); rerender(); },
    }, '▸'),
    h('span', { class: 'files-tree-icon' }, '🗂️'),
    h('span', { class: 'files-tree-name', title: workspace.rootName }, workspace.rootName),
    collapsed && pendingPaths.size ? h('span', { class: 'nav-pending-dot', title: 'Unsaved changes inside' }) : null,
    onClose ? h('button', {
      class: 'icon-btn files-tree-close',
      type: 'button',
      title: 'Close this folder',
      'aria-label': 'Close this folder',
      onClick: onClose,
    }, '✕') : null,
  ]);
  container.appendChild(head);

  if (collapsed) return;
  const graphWrap = h('div', { class: 'focal-graph-wrap' });
  container.appendChild(graphWrap);
  renderFocalGraph(graphWrap, workspace, activeRelPath, onOpenFile, pendingPaths);
}

/**
 * Render every currently-open workspace into `container`, one block per
 * folder, stacked in the order they were opened — the multi-root
 * equivalent of renderFilesTree above, which this calls once per workspace
 * into its own child div. Only the workspace that actually owns
 * `activeWorkspaceRootName` gets `activeRelPath` highlighted/passed through
 * to its own pending-paths lookup; every other open folder shows plainly,
 * with nothing marked current in it — but every one, active or not,
 * always shows its full contents unless the user folded it away
 * themselves (see renderFilesTree), the same way Explorer's multi-root
 * view never hides a folder just because it isn't the one you're
 * currently editing in. `options` is the same shape renderFilesTree
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
