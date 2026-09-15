import { h, svg } from '../utils/dom.js';

// A focal-neighborhood view of the open workspace: instead of the sidebar's
// other mode (filesPanel.js's always-fully-expanded tree), this shows only
// the *current* directory's own contents — one hop — with every deeper
// subdirectory collapsed into a "+N" ghost node until explicitly expanded,
// so a deep/wide repo never dumps hundreds of nodes on screen at once. The
// breadcrumb strip above the graph body is the only way up — click any
// ancestor in it to re-center there directly, however many levels that is
// — rather than a separate "parent" node duplicating just the immediate
// step of that in the graph body itself, on top of the sidebar's own
// folder-name header right above it.
//
// Deliberately no physics/force layout: this is a hierarchy, not an organic
// cluster, so a fixed depth-first stack (same layout style as mapView.js's
// document tree) reads more predictably than anything that jiggles or
// resettles. Re-centering and expanding still animate, just via a FLIP
// transform (see positionNode) — a node that was already visible slides
// from its last known spot to its new one; a genuinely new node fades in
// instead, since it has no "last known spot" to slide from.

const ROW_H = 28;
const INDENT_W = 18;
const PAD_X = 10;
const LABEL_MAX = 24;
const GRAPH_WIDTH = 280;

// Session-scoped view state (mirrors filesPanel.js's own module-level
// manualCollapse pattern) — which directory each open workspace's graph is
// currently centered on, and which of ITS descendants (beyond the
// directly-shown 1-hop tier) have been expanded further, plus its own FLIP
// bookkeeping (each node's last-rendered (x, y), keyed by something stable
// across renders — a file/dir's own path, not array position, which shifts
// whenever a row above it expands/collapses). Keyed by workspace rootName —
// several workspaces can be open and rendered at once (see main.js), each
// its own directory the user browses independently; sharing one flat set
// of this across all of them meant switching the active file in ONE
// workspace silently reset every OTHER open workspace's graph back to its
// root the next time it re-rendered, discarding whatever it was showing.
// Reset per-workspace whenever THAT workspace's own active file changes to
// one outside its current view, so opening a different file always starts
// from a sane, freshly-scoped expansion state rather than an unrelated
// leftover from wherever you were browsing before.
const viewStateByWorkspace = new Map();

function getViewState(rootName) {
  let vs = viewStateByWorkspace.get(rootName);
  if (!vs) {
    vs = {
      center: null, expanded: new Set(), lastActiveRelPath: undefined, knownPos: new Map(),
    };
    viewStateByWorkspace.set(rootName, vs);
  }
  return vs;
}

/** Drop a closed workspace's own navigation state — see main.js's handleCloseWorkspace. Without this, every distinct folder ever opened in a session stays in viewStateByWorkspace for good, even long after it's been closed. */
export function forgetWorkspaceViewState(rootName) {
  viewStateByWorkspace.delete(rootName);
}

function dirname(relPath) {
  return relPath.includes('/') ? relPath.split('/').slice(0, -1).join('/') : '';
}

function truncate(text, max = LABEL_MAX) {
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function findDirNode(node, path) {
  if (node.path === path) return node;
  for (const child of node.children) {
    if (child.type !== 'dir') continue;
    const found = findDirNode(child, path);
    if (found) return found;
  }
  return null;
}

function countFiles(dirNode) {
  let count = 0;
  dirNode.children.forEach((c) => { count += c.type === 'file' ? 1 : countFiles(c); });
  return count;
}

/** Depth-first, pre-order flatten of `centerNode`'s children — a directory only recurses into its own children when its path is in `expanded`; otherwise it's a single collapsed row with a file count. */
function layoutRows(centerNode, expanded, activeRelPath, pendingPaths) {
  const rows = [];
  function place(node, depth, parentRow) {
    const isDir = node.type === 'dir';
    const row = {
      node,
      depth,
      parentRow,
      isDir,
      isActive: !isDir && node.path === activeRelPath,
      isPending: !isDir && pendingPaths.has(node.path),
      count: isDir ? countFiles(node) : 0,
      isExpanded: isDir && expanded.has(node.path),
    };
    rows.push(row);
    if (isDir && row.isExpanded) {
      node.children.forEach((child) => place(child, depth + 1, row));
    }
  }
  centerNode.children.forEach((child) => place(child, 0, null));
  return rows;
}

function nodeWidth(label) {
  return Math.min(160, Math.max(64, label.length * 6.4 + 22));
}

/**
 * Move `group` to (x, y) — smoothly, via a FLIP transform, if it occupied a
 * different spot on the previous render (same `key` as last time: a node
 * that only shifted because a row above it expanded/collapsed slides to its
 * new spot instead of jumping); a `key` never seen before fades+grows in
 * instead, since there's no earlier position to animate from. `key` must be
 * stable across renders for the same conceptual node — a file/dir's own
 * path, not its row index (which changes constantly as siblings
 * expand/collapse above it).
 */
function positionNode(knownPos, group, key, x, y) {
  const prev = knownPos.get(key);
  knownPos.set(key, { x, y });

  if (!prev) {
    group.setAttribute('transform', `translate(${x}, ${y})`);
    group.classList.add('focal-node-enter');
    requestAnimationFrame(() => {
      group.getBoundingClientRect(); // commit the enter state before transitioning away from it
      group.classList.remove('focal-node-enter');
    });
    return;
  }

  if (prev.x === x && prev.y === y) {
    group.setAttribute('transform', `translate(${x}, ${y})`);
    return;
  }

  group.style.transition = 'none';
  group.setAttribute('transform', `translate(${prev.x}, ${prev.y})`);
  group.getBoundingClientRect(); // commit the "first" position before animating to "last"
  requestAnimationFrame(() => {
    group.style.transition = '';
    group.setAttribute('transform', `translate(${x}, ${y})`);
  });
}

function buildNodeGroup({
  label, isDir, isActive, isExpanded, isPending, count, onClick,
}) {
  const w = nodeWidth(label);
  const classes = ['focal-node'];
  if (isDir) classes.push('focal-node-dir');
  if (isActive) classes.push('focal-node-active');
  if (isExpanded) classes.push('focal-node-expanded');

  const group = svg('g', {
    class: classes.join(' '),
    tabindex: '0',
    role: 'button',
    'aria-label': label,
    onClick,
    onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } },
  });
  group.appendChild(svg('rect', {
    width: w, height: ROW_H - 6, rx: (ROW_H - 6) / 2, class: 'focal-node-bg',
  }));
  group.appendChild(svg('text', {
    x: 10, y: (ROW_H - 6) / 2, class: 'focal-node-label', 'dominant-baseline': 'middle',
  }, `${isDir ? '📁' : '📄'} ${truncate(label)}`));
  if (isDir) {
    group.appendChild(svg('text', {
      x: w - 8, y: (ROW_H - 6) / 2, class: 'focal-node-badge', 'dominant-baseline': 'middle', 'text-anchor': 'end',
    }, isExpanded ? '−' : `+${count}`));
  } else if (isPending) {
    // A file with unsaved changes waiting (see main.js's recovery-snapshot
    // tracking) — nothing is ever lost switching away from it now, but this
    // is the only visual trail of that once you've navigated elsewhere.
    group.appendChild(svg('circle', {
      class: 'focal-node-pending-dot', cx: w - 9, cy: (ROW_H - 6) / 2, r: 3.5,
    }));
  }
  group.appendChild(svg('title', {}, isPending ? `${label} — unsaved changes` : label));
  return { group, width: w };
}

/** Root down to `centerPath`, as {label, path} steps — path '' is the workspace root itself. Each step (but the last) is a clickable jump straight to that ancestor, without stepping through every level in between. */
function buildBreadcrumbSteps(workspace, centerPath) {
  const steps = [{ label: workspace.rootName, path: '' }];
  if (centerPath) {
    let cumulative = '';
    centerPath.split('/').forEach((part) => {
      cumulative = cumulative ? `${cumulative}/${part}` : part;
      steps.push({ label: part, path: cumulative });
    });
  }
  return steps;
}

function renderGraphHead(workspace, centerPath, onJump) {
  const steps = buildBreadcrumbSteps(workspace, centerPath);
  const crumbs = [];
  steps.forEach((step, i) => {
    if (i > 0) crumbs.push(h('span', { class: 'crumb-sep' }, '›'));
    const isLast = i === steps.length - 1;
    crumbs.push(isLast
      ? h('span', { class: 'crumb crumb-current' }, step.label)
      : h('button', {
        class: 'crumb', type: 'button', onClick: () => onJump(step.path),
      }, step.label));
  });
  return h('div', { class: 'focal-graph-head' }, [
    h('span', { class: 'focal-graph-icon' }, '📂'),
    h('div', { class: 'focal-breadcrumb' }, crumbs),
  ]);
}

/**
 * Render the focal-neighborhood graph into `container` — a sibling mode to
 * filesPanel.js's plain tree, toggled from the same sidebar header (see
 * main.js). `onOpenFile(relPath)` opens a clicked file node exactly like
 * the plain tree's own file rows do.
 */
export function renderFocalGraph(container, workspace, activeRelPath, onOpenFile, pendingPaths = new Set()) {
  container.innerHTML = '';
  if (!workspace) return;

  const vs = getViewState(workspace.rootName);
  const activeDir = activeRelPath ? dirname(activeRelPath) : '';
  // `activeRelPath` is null whenever THIS workspace isn't the one owning
  // the currently active file (see renderWorkspacesPanel) — every switch
  // to a file in a *different* open workspace flips it between a real path
  // and null for every other workspace's own render call, even though
  // nothing about what this workspace was showing actually changed. Only a
  // genuine change to a new real path re-centers and resets the expansion
  // state; a workspace with no active file of its own just keeps showing
  // whatever it already had (or its root, the first time).
  if (activeRelPath && activeRelPath !== vs.lastActiveRelPath) {
    vs.lastActiveRelPath = activeRelPath;
    vs.center = activeDir;
    vs.expanded = new Set();
    vs.knownPos = new Map();
  }
  if (vs.center === null) vs.center = activeDir;

  const centerNode = findDirNode(workspace.tree, vs.center) || workspace.tree;

  function rerender() { renderFocalGraph(container, workspace, activeRelPath, onOpenFile, pendingPaths); }
  function jumpTo(path) { vs.center = path; vs.expanded = new Set(); rerender(); }

  // Jumping to any ancestor — including the immediate parent — is what the
  // breadcrumb strip above the graph is for; a separate "parent" ghost node
  // in the graph body itself used to duplicate exactly that (Phase 1,
  // before the breadcrumb existed in Phase 2), stacking a third repeat of
  // the same path information on top of the sidebar's own folder-name
  // header and the breadcrumb right above it — removed rather than kept
  // as a redundant, taller-than-it-needs-to-be third copy of it. At the
  // workspace root specifically, the breadcrumb itself is now ALSO just
  // that one root name and nothing else — still fully redundant with the
  // Explorer block's own header directly above it — so it's skipped
  // entirely until you've actually drilled into a subdirectory, where it
  // starts earning its keep (jumping back several levels at once).
  if (vs.center) container.appendChild(renderGraphHead(workspace, vs.center, jumpTo));

  const rows = layoutRows(centerNode, vs.expanded, activeRelPath, pendingPaths);
  const height = Math.max(rows.length, 1) * ROW_H + 6;

  const svgRoot = svg('svg', {
    width: GRAPH_WIDTH, height, viewBox: `0 0 ${GRAPH_WIDTH} ${height}`, class: 'focal-graph-svg',
  });
  const edgeLayer = svg('g', { class: 'focal-graph-edges' });
  const nodeLayer = svg('g', { class: 'focal-graph-nodes' });

  let rowIndex = 0;

  rows.forEach((row) => {
    const x = PAD_X + row.depth * INDENT_W;
    const y = rowIndex * ROW_H + 3;
    const onClick = row.isDir
      ? () => {
        if (vs.expanded.has(row.node.path)) vs.expanded.delete(row.node.path);
        else vs.expanded.add(row.node.path);
        rerender();
      }
      : () => onOpenFile(row.node.path);

    const { group } = buildNodeGroup({
      label: row.node.name, isDir: row.isDir, isActive: row.isActive, isExpanded: row.isExpanded, isPending: row.isPending, count: row.count, onClick,
    });
    nodeLayer.appendChild(group);
    positionNode(vs.knownPos, group, `${row.isDir ? 'dir' : 'file'}:${row.node.path}`, x, y);

    // Only nested rows (a directory's own children, revealed by expanding
    // it) connect to anything — a top-level row has no parent node to draw
    // a line from anymore (see above), so it just sits on its own.
    const fromPos = row.parentRow ? row.parentRow._pos : null;
    if (fromPos) {
      edgeLayer.appendChild(svg('path', {
        d: `M ${fromPos.x} ${fromPos.y} V ${y + (ROW_H - 6) / 2} H ${x - 6}`,
        class: 'focal-edge',
      }));
    }
    // eslint-disable-next-line no-underscore-dangle
    row._pos = { x, y: y + (ROW_H - 6) / 2 };
    rowIndex += 1;
  });

  svgRoot.appendChild(edgeLayer);
  svgRoot.appendChild(nodeLayer);
  container.appendChild(svgRoot);
}
