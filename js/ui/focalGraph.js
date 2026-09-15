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
// view one level up), and a small tray below surfaces cross-file Markdown
// links to/from the active file that aren't already visible as filesystem
// neighbors — see state/linkIndex.js.
//
// Deliberately no physics/force layout: this is a hierarchy, not an organic
// cluster, so a fixed depth-first stack (same layout style as mapView.js's
// document tree) reads more predictably than anything that jiggles or
// resettles. Re-centering and expanding are still smooth, just via a plain
// CSS transition on each node's SVG transform (see css/layout.css) rather
// than a running simulation.

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

function buildNodeGroup({
  x, y, label, isDir, isActive, isExpanded, count, onClick,
}) {
  const w = nodeWidth(label);
  const cy = y + ROW_H / 2;
  const classes = ['focal-node'];
  if (isDir) classes.push('focal-node-dir');
  if (isActive) classes.push('focal-node-active');
  if (isExpanded) classes.push('focal-node-expanded');

  const group = svg('g', {
    class: classes.join(' '),
    transform: `translate(${x}, ${cy - ROW_H / 2 + 3})`,
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
  }
  if (focalCenter === null) focalCenter = activeDir;

  const centerNode = findDirNode(workspace.tree, focalCenter) || workspace.tree;
  const hasParent = focalCenter !== '';
  const parentPath = hasParent ? dirname(focalCenter) : null;

  function rerender() { renderFocalGraph(container, workspace, activeRelPath, onOpenFile); }

  container.appendChild(h('div', { class: 'focal-graph-head' }, [
    h('span', { class: 'focal-graph-icon' }, '📂'),
    h('span', {
      class: 'focal-graph-dirname',
      title: focalCenter || workspace.rootName,
    }, focalCenter ? basename(focalCenter) : workspace.rootName),
  ]));

  const rows = layoutRows(centerNode, focalExpanded, activeRelPath);
  const bodyRowCount = rows.length + (hasParent ? 1 : 0);
  const height = Math.max(bodyRowCount, 1) * ROW_H + 6;

  const svgRoot = svg('svg', {
    width: GRAPH_WIDTH, height, viewBox: `0 0 ${GRAPH_WIDTH} ${height}`, class: 'focal-graph-svg',
  });
  const edgeLayer = svg('g', { class: 'focal-graph-edges' });
  const nodeLayer = svg('g', { class: 'focal-graph-nodes' });

  const rowMeta = []; // parallel to `rows`, filled in as we place each node — {x, y, parentPos}
  let rowIndex = 0;
  let parentPos = null;

  if (hasParent) {
    const y = rowIndex * ROW_H;
    const label = parentPath ? basename(parentPath) : workspace.rootName;
    const { group } = buildNodeGroup({
      x: PAD_X,
      y,
      label,
      isDir: true,
      isActive: false,
      isExpanded: false,
      count: 0,
      onClick: () => { focalCenter = parentPath; focalExpanded = new Set(); rerender(); },
    });
    group.classList.add('focal-node-parent');
    nodeLayer.appendChild(group);
    parentPos = { x: PAD_X, y: y + ROW_H / 2 };
    rowIndex += 1;
  }

  rows.forEach((row) => {
    const x = PAD_X + row.depth * INDENT_W + (hasParent ? INDENT_W : 0);
    const y = rowIndex * ROW_H;
    const label = row.isDir ? row.node.name : row.node.name;
    const onClick = row.isDir
      ? () => {
        if (focalExpanded.has(row.node.path)) focalExpanded.delete(row.node.path);
        else focalExpanded.add(row.node.path);
        rerender();
      }
      : () => onOpenFile(row.node.path);

    const { group } = buildNodeGroup({
      x, y, label, isDir: row.isDir, isActive: row.isActive, isExpanded: row.isExpanded, count: row.count, onClick,
    });
    nodeLayer.appendChild(group);

    const fromPos = row.parentRow ? row.parentRow._pos : parentPos;
    if (fromPos) {
      edgeLayer.appendChild(svg('path', {
        d: `M ${fromPos.x} ${fromPos.y} V ${y + ROW_H / 2} H ${x - 6}`,
        class: 'focal-edge',
      }));
    }
    // eslint-disable-next-line no-underscore-dangle
    row._pos = { x, y: y + ROW_H / 2 };
    rowMeta.push(row);
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
