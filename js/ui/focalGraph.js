import { h, svg } from '../utils/dom.js';
import {
  getOutgoingLinks, getIncomingLinks, isIndexed, indexWorkspaceLinks, indexedCount,
} from '../state/linkIndex.js';
import { showToast } from './toast.js';

// A focal-neighborhood view of the open workspace: instead of the sidebar's
// other mode (filesPanel.js's always-fully-expanded tree), this shows only
// the *current* directory's own contents — one hop — with every deeper
// subdirectory collapsed into a "+N" ghost node until explicitly expanded,
// so a deep/wide repo never dumps hundreds of nodes on screen at once. The
// directory a step up is always shown too (click it to re-center the whole
// view one level up, or use the breadcrumb strip to jump straight to any
// higher ancestor in one step), and a small tray below surfaces cross-file
// Markdown links to/from the active file that aren't already visible as
// filesystem neighbors — see state/linkIndex.js.
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
// manualCollapse pattern) — which directory the graph is currently centered
// on, and which of ITS descendants (beyond the directly-shown 1-hop tier)
// have been expanded further. Reset whenever the active file changes to one
// outside the current view, so opening a different file always starts from
// a sane, freshly-scoped neighborhood rather than an unrelated leftover
// expansion state from wherever you were browsing before.
let focalCenter = null;
let focalExpanded = new Set();
let lastActiveRelPath = undefined;

// FLIP bookkeeping: each node's last-rendered (x, y), keyed by something
// stable across renders (a file/dir's own path — not array position, which
// shifts whenever a row above it expands/collapses). Read before laying out
// the new frame, written after, so positionNode() can tell "moved" from
// "brand new" for every node on every render.
let lastKnownPos = new Map();

function dirname(relPath) {
  return relPath.includes('/') ? relPath.split('/').slice(0, -1).join('/') : '';
}

function basename(path) {
  const segments = path.split('/');
  return segments[segments.length - 1] || '';
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
function layoutRows(centerNode, expanded, activeRelPath) {
  const rows = [];
  function place(node, depth, parentRow) {
    const isDir = node.type === 'dir';
    const row = {
      node,
      depth,
      parentRow,
      isDir,
      isActive: !isDir && node.path === activeRelPath,
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
function positionNode(group, key, x, y) {
  const prev = lastKnownPos.get(key);
  lastKnownPos.set(key, { x, y });

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
  label, isDir, isActive, isExpanded, count, onClick,
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
  }
  group.appendChild(svg('title', {}, label));
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
export function renderFocalGraph(container, workspace, activeRelPath, onOpenFile) {
  container.innerHTML = '';
  if (!workspace) return;

  const activeDir = activeRelPath ? dirname(activeRelPath) : '';
  if (activeRelPath !== lastActiveRelPath) {
    lastActiveRelPath = activeRelPath;
    focalCenter = activeDir;
    focalExpanded = new Set();
    lastKnownPos = new Map();
  }
  if (focalCenter === null) focalCenter = activeDir;

  const centerNode = findDirNode(workspace.tree, focalCenter) || workspace.tree;
  const hasParent = focalCenter !== '';
  const parentPath = hasParent ? dirname(focalCenter) : null;

  function rerender() { renderFocalGraph(container, workspace, activeRelPath, onOpenFile); }
  function jumpTo(path) { focalCenter = path; focalExpanded = new Set(); rerender(); }

  container.appendChild(renderGraphHead(workspace, focalCenter, jumpTo));

  const rows = layoutRows(centerNode, focalExpanded, activeRelPath);
  const bodyRowCount = rows.length + (hasParent ? 1 : 0);
  const height = Math.max(bodyRowCount, 1) * ROW_H + 6;

  const svgRoot = svg('svg', {
    width: GRAPH_WIDTH, height, viewBox: `0 0 ${GRAPH_WIDTH} ${height}`, class: 'focal-graph-svg',
  });
  const edgeLayer = svg('g', { class: 'focal-graph-edges' });
  const nodeLayer = svg('g', { class: 'focal-graph-nodes' });

  let rowIndex = 0;
  let parentPos = null;

  if (hasParent) {
    const y = rowIndex * ROW_H + 3;
    const label = parentPath ? basename(parentPath) : workspace.rootName;
    const { group } = buildNodeGroup({
      label, isDir: true, isActive: false, isExpanded: false, count: 0, onClick: () => jumpTo(parentPath),
    });
    group.classList.add('focal-node-parent');
    nodeLayer.appendChild(group);
    positionNode(group, `parent:${focalCenter}`, PAD_X, y);
    parentPos = { x: PAD_X, y: y + (ROW_H - 6) / 2 };
    rowIndex += 1;
  }

  rows.forEach((row) => {
    const x = PAD_X + row.depth * INDENT_W + (hasParent ? INDENT_W : 0);
    const y = rowIndex * ROW_H + 3;
    const onClick = row.isDir
      ? () => {
        if (focalExpanded.has(row.node.path)) focalExpanded.delete(row.node.path);
        else focalExpanded.add(row.node.path);
        rerender();
      }
      : () => onOpenFile(row.node.path);

    const { group } = buildNodeGroup({
      label: row.node.name, isDir: row.isDir, isActive: row.isActive, isExpanded: row.isExpanded, count: row.count, onClick,
    });
    nodeLayer.appendChild(group);
    positionNode(group, `${row.isDir ? 'dir' : 'file'}:${row.node.path}`, x, y);

    const fromPos = row.parentRow ? row.parentRow._pos : parentPos;
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

  renderLinkedTray(container, workspace, activeRelPath, rows, onOpenFile, rerender);
}

function renderLinkedTray(container, workspace, activeRelPath, rows, onOpenFile, rerender) {
  if (!activeRelPath) return;

  const shown = new Set(rows.map((r) => r.node.path));
  shown.add(activeRelPath);
  const linked = new Set([...getOutgoingLinks(activeRelPath), ...getIncomingLinks(activeRelPath)]);
  const linkedOnly = [...linked].filter((p) => !shown.has(p) && workspace.files.has(p));

  const tray = h('div', { class: 'focal-graph-links' });
  const fullyIndexed = indexedCount() >= workspace.files.size;

  tray.appendChild(h('div', { class: 'focal-graph-links-head' }, [
    h('span', {}, `🔗 Linked notes${linkedOnly.length ? ` (${linkedOnly.length})` : ''}`),
    !fullyIndexed ? h('button', {
      class: 'code-btn',
      type: 'button',
      title: 'Scan every file in this workspace for links, for complete backlink coverage (only files opened so far are known otherwise)',
      onClick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Scanning…';
        await indexWorkspaceLinks(workspace, (done, total) => { btn.textContent = `Scanning ${done}/${total}…`; });
        showToast('Finished scanning the workspace for links.');
        rerender();
      },
    }, '🔍 Scan for links') : null,
  ]));

  if (!linkedOnly.length) {
    tray.appendChild(h('p', { class: 'sidebar-empty focal-graph-links-empty' }, isIndexed(activeRelPath)
      ? 'No cross-file links beyond what\'s already shown above.'
      : 'No links found yet — open this file to check, or scan the whole workspace.'));
  } else {
    const list = h('div', { class: 'focal-graph-links-list' });
    linkedOnly.forEach((relPath) => {
      list.appendChild(h('button', {
        class: 'focal-link-chip',
        type: 'button',
        title: relPath,
        onClick: () => onOpenFile(relPath),
      }, `📄 ${truncate(basename(relPath), 28)}`));
    });
    tray.appendChild(list);
  }

  container.appendChild(tray);
}
