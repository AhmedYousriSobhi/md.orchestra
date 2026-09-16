import { svg } from '../utils/dom.js';

// A proper node-link tree for Workspace mode's whole-folder map — branches
// fan out left-to-right by depth, and a parent sits vertically centered on
// its own children (the standard "tidy tree" layout: leaves get
// sequential rows top-to-bottom, then every parent's row is just the
// midpoint of its direct children's), rather than every node stacked in
// one flat, indented vertical list the way the Explorer sidebar's own
// focalGraph.js reads (a deliberate, different tradeoff there — narrow
// and one-hop-at-a-time suits a sidebar; this suits a wide, full-screen
// map, where spreading the actual shape of the tree out in two
// dimensions is the whole point of calling it a graph at all). Click to
// expand/collapse a folder still works exactly the same way; only the
// layout is different.

const LEVEL_W = 210;
const ROW_H = 40;
const NODE_H = 26;
const PAD = 20;

// Which folders are expanded, per workspace root — a standing memory for
// this graph specifically (not shared with focalGraph.js's own, since
// they're different views with no reason to force the same expansion
// state onto each other), so reopening the map keeps whatever shape you
// last left it in rather than snapping back to just the root every time.
const expandedByWorkspace = new Map();

function getExpanded(rootName) {
  let set = expandedByWorkspace.get(rootName);
  if (!set) {
    set = new Set();
    expandedByWorkspace.set(rootName, set);
  }
  return set;
}

function truncate(text, max = 26) {
  const t = text || '(untitled)';
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
}

/** Post-order: every leaf (or collapsed folder) gets the next sequential row; a folder with visible children sits at the midpoint of theirs. Returns { positioned, leafRows, maxDepth }. */
function layoutTidyTree(root, expanded) {
  const positioned = [];
  let leafRow = 0;
  let maxDepth = 0;

  function place(node, depth, parent) {
    maxDepth = Math.max(maxDepth, depth);
    const isDir = node.type === 'dir';
    const isExpanded = depth === 0 || (isDir && expanded.has(node.path));
    const hasVisibleChildren = isDir && isExpanded && node.children.length > 0;

    const entry = {
      node, depth, isDir, isExpanded, x: depth * LEVEL_W, y: 0, parent,
    };
    positioned.push(entry);

    if (hasVisibleChildren) {
      const childYs = node.children.map((child) => place(child, depth + 1, entry));
      entry.y = (Math.min(...childYs) + Math.max(...childYs)) / 2;
    } else {
      entry.y = leafRow * ROW_H;
      leafRow += 1;
    }
    return entry.y;
  }
  place(root, 0, null);

  return { positioned, leafRows: Math.max(leafRow, 1), maxDepth };
}

// +2 accounts for the "📂"/"📄" icon and the space after it, ahead of the
// name itself, and +2.5 more when a +/− toggle also needs room at the
// other end — so the box is actually sized for everything it needs to
// hold, rather than the raw name alone leaving too little room and
// forcing the label to truncate more than the box's own width suggests
// it should have to.
function nodeWidth(label, hasToggle) {
  const chars = label.length + 2 + (hasToggle ? 2.5 : 0);
  return Math.min(210, Math.max(80, chars * 6.6 + 44));
}

function nodeHasToggle(entry) {
  return entry.isDir && entry.node.children.length > 0 && entry.depth > 0;
}

export function renderWorkspaceGraph(container, workspace, onOpenFile) {
  const expanded = getExpanded(workspace.rootName);

  function rerender() {
    container.innerHTML = '';

    const { positioned, leafRows, maxDepth } = layoutTidyTree(workspace.tree, expanded);
    const width = (maxDepth + 1) * LEVEL_W + PAD * 2;
    const height = leafRows * ROW_H + PAD * 2;

    const root = svg('svg', {
      width, height, viewBox: `0 0 ${width} ${height}`, class: 'wsgraph-svg',
    });

    const edgeLayer = svg('g', { class: 'wsgraph-edges' });
    const nodeLayer = svg('g', { class: 'wsgraph-nodes' });

    positioned.forEach((entry) => {
      const x = entry.x + PAD;
      const y = entry.y + PAD;
      const hasToggle = nodeHasToggle(entry);
      const w = nodeWidth(entry.node.name || workspace.rootName, hasToggle);

      if (entry.parent) {
        const pw = nodeWidth(entry.parent.node.name || workspace.rootName, nodeHasToggle(entry.parent));
        const fromX = entry.parent.x + PAD + pw;
        const fromY = entry.parent.y + PAD;
        const midX = (fromX + x) / 2;
        edgeLayer.appendChild(svg('path', {
          d: `M ${fromX} ${fromY} C ${midX} ${fromY} ${midX} ${y} ${x} ${y}`,
          class: 'wsgraph-edge',
        }));
      }

      const isDir = entry.isDir;
      const clickable = isDir || Boolean(onOpenFile);
      const group = svg('g', {
        class: `wsgraph-node${isDir ? ' wsgraph-node-dir' : ''}${!clickable ? ' wsgraph-node-inert' : ''}`,
        transform: `translate(${x}, ${y - NODE_H / 2})`,
        tabindex: clickable ? '0' : '-1',
        role: clickable ? 'button' : undefined,
        'aria-label': entry.node.name || workspace.rootName,
        onClick: !clickable ? undefined : () => {
          if (isDir) {
            if (entry.isExpanded && entry.depth > 0) expanded.delete(entry.node.path);
            else expanded.add(entry.node.path);
            rerender();
          } else {
            onOpenFile(entry.node.path);
          }
        },
        onKeydown: !clickable ? undefined : (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          group.dispatchEvent(new Event('click'));
        },
      });
      group.appendChild(svg('rect', {
        width: w, height: NODE_H, rx: NODE_H / 2, class: 'wsgraph-node-bg',
      }));
      const maxChars = Math.max(3, Math.floor((w - 44 - (hasToggle ? 16.5 : 0)) / 6.6 + 0.01) - 2);
      const label = `${isDir ? (entry.isExpanded ? '📂' : '📁') : '📄'} ${truncate(entry.node.name || workspace.rootName, maxChars)}`;
      group.appendChild(svg('text', {
        x: 12, y: NODE_H / 2, class: 'wsgraph-node-label', 'dominant-baseline': 'middle',
      }, label));
      if (hasToggle) {
        group.appendChild(svg('text', {
          x: w - 10, y: NODE_H / 2, class: 'wsgraph-node-toggle', 'dominant-baseline': 'middle', 'text-anchor': 'end',
        }, entry.isExpanded ? '−' : '+'));
      }
      group.appendChild(svg('title', {}, entry.node.name || workspace.rootName));
      nodeLayer.appendChild(group);
    });

    root.appendChild(edgeLayer);
    root.appendChild(nodeLayer);
    container.appendChild(root);
  }

  rerender();
}

/** Drops a closed workspace's own remembered expansion state — see main.js's handleCloseWorkspace, which does the same for focalGraph.js. */
export function forgetWorkspaceGraphState(rootName) {
  expandedByWorkspace.delete(rootName);
}
