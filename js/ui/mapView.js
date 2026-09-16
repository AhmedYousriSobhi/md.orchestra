import { h, svg } from '../utils/dom.js';
import { paletteFor } from '../utils/colors.js';
import { openOverlay, closeOverlay } from './transitions.js';
import { getState, selectSection } from '../state/store.js';
import { renderMindMap } from './mindMap.js';
import { renderWorkspaceGraph } from './workspaceGraph.js';

let overlayEl = null;
let mapMode = 'tree';

const ROW_H = 24;
const INDENT_W = 18;
const MARKER_R = 4;
const LABEL_MAX = 64;

function truncate(title, max = LABEL_MAX) {
  const t = title || '(untitled)';
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
}

/** Depth-first layout: one row per heading, in document order, indented by level. */
function layoutTree(doc) {
  const nodes = [];
  const edges = [];
  let row = 0;
  let maxX = 0;

  doc.children.forEach((top, topIndex) => {
    function place(node, depth, parentPos) {
      const x = depth * INDENT_W;
      const y = row * ROW_H;
      const pos = { x, y };
      nodes.push({ node, x, y, topIndex });
      if (parentPos) edges.push({ from: parentPos, to: pos });
      maxX = Math.max(maxX, x);
      row += 1;
      node.children.forEach((child) => place(child, depth + 1, pos));
    }
    place(top, 0, null);
  });

  return { nodes, edges, rows: row, maxX };
}

/** The indented-tree layout for a document's own heading structure (Tree mode) — parent/child position and a connecting line say everything it needs. Workspace mode uses focalGraph.js instead (see openMapView), the same click-to-expand graph the Explorer sidebar already browses this exact workspace with. */
function buildSvg(doc, selectedId, onPick) {
  const { nodes, edges, rows, maxX } = layoutTree(doc);
  const width = maxX + LABEL_MAX * 6.4 + 24;
  const height = Math.max(rows * ROW_H, ROW_H) + 16;

  const root = svg('svg', {
    width, height, viewBox: `0 0 ${width} ${height}`,
    style: 'display:block; font-family: -apple-system, Helvetica, Arial, sans-serif;',
  });

  const edgeLayer = svg('g', { class: 'map-edges' });
  edges.forEach(({ from, to }) => {
    edgeLayer.appendChild(svg('path', {
      d: `M ${from.x + MARKER_R} ${from.y + ROW_H / 2} V ${to.y + ROW_H / 2} H ${to.x - MARKER_R - 2}`,
      class: 'map-edge',
    }));
  });
  root.appendChild(edgeLayer);

  const nodeLayer = svg('g', { class: 'map-nodes' });
  nodes.forEach(({ node, x, y, topIndex }) => {
    const accent = paletteFor(topIndex).accent;
    const isCurrent = node.id === selectedId;
    const cy = y + ROW_H / 2;

    const group = svg('g', {
      class: `map-node${isCurrent ? ' map-node-current' : ''}`,
      style: `--accent:${accent}`,
      tabindex: '0',
      role: 'button',
      'aria-label': node.title,
      onClick: () => onPick(node.id),
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(node.id); } },
    });
    group.appendChild(svg('circle', { cx: x, cy, r: isCurrent ? MARKER_R + 2 : MARKER_R, class: 'map-dot' }));
    group.appendChild(svg('text', { x: x + MARKER_R + 8, y: cy, class: 'map-label', 'dominant-baseline': 'middle' }, truncate(node.title)));
    group.appendChild(svg('title', {}, node.title || ''));
    nodeLayer.appendChild(group);
  });
  root.appendChild(nodeLayer);

  return root;
}

export function openMapView({ workspace = null, onOpenWorkspaceFile } = {}) {
  const { doc, fileName, selectedId } = getState();
  if (!doc) return;

  if (overlayEl) overlayEl.remove();
  overlayEl = h('div', { class: 'overlay map-overlay', hidden: true });

  const scroll = h('div', { class: 'map-scroll' });

  // The mind map runs a continuous requestAnimationFrame loop (so it can
  // keep reacting to the cursor) — it must be explicitly stopped whenever
  // we leave it, or it keeps ticking forever in the background.
  let stopMindMap = null;
  function teardownMindMap() {
    if (stopMindMap) { stopMindMap(); stopMindMap = null; }
  }

  // transitions.js's global Escape handler closes any open overlay directly
  // (it doesn't know about this component's animation loop), so this panel
  // needs its own Escape listener purely to stop the loop when that happens
  // — removed again on every close path, so repeated opens don't pile up.
  function onEscape(e) { if (e.key === 'Escape') handleClose(); }
  function handleClose() {
    teardownMindMap();
    document.removeEventListener('keydown', onEscape);
    closeOverlay(overlayEl);
  }
  document.addEventListener('keydown', onEscape);

  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) handleClose(); });

  const onPick = (id) => {
    handleClose();
    selectSection(id);
  };

  // The workspace-wide map has no active section to fall back to (it isn't
  // even the same document), so switching to it when no folder is open at
  // all would otherwise show an empty overlay with no way back — same
  // fallback loadMode() below applies whenever it's picked without one.
  if (mapMode === 'workspace' && !workspace) mapMode = 'tree';

  const treeBtn = h('button', { class: 'map-mode-btn', type: 'button' }, '🌳 Tree');
  const mindBtn = h('button', { class: 'map-mode-btn', type: 'button' }, '🧠 Mind map');
  const workspaceBtn = workspace
    ? h('button', { class: 'map-mode-btn', type: 'button' }, '🗂️ Workspace')
    : null;

  const subtitleEl = h('div', { class: 'insight-subtitle' });

  function renderMode() {
    teardownMindMap();
    treeBtn.classList.toggle('map-mode-active', mapMode === 'tree');
    mindBtn.classList.toggle('map-mode-active', mapMode === 'mind');
    if (workspaceBtn) workspaceBtn.classList.toggle('map-mode-active', mapMode === 'workspace');
    scroll.innerHTML = '';
    if (mapMode === 'tree') {
      subtitleEl.textContent = `${fileName || ''} — click any heading to jump there`;
      scroll.appendChild(buildSvg(doc, selectedId, onPick));
    } else if (mapMode === 'mind') {
      subtitleEl.textContent = `${fileName || ''} — click a heading to jump there, or drag a node to rearrange it`;
      const mindContainer = h('div', { class: 'mindmap-container' });
      scroll.appendChild(mindContainer);
      // needs real layout dimensions, which only exist once it's in the DOM
      requestAnimationFrame(() => { stopMindMap = renderMindMap(mindContainer, doc, selectedId, onPick); });
    } else {
      subtitleEl.textContent = `${workspace.rootName} — click a folder to expand it, a file to open it`;
      // A real node-link tree (workspaceGraph.js) — branches fan out by
      // depth and a parent centers on its own children, rather than every
      // node stacked in one flat vertical list; click to expand/collapse a
      // folder still works the same way, just laid out to actually look
      // like the shape of the tree instead of a plain scrolling list of
      // rows.
      const graphWrap = h('div', { class: 'map-workspace-graph' });
      scroll.appendChild(graphWrap);
      renderWorkspaceGraph(graphWrap, workspace, (relPath) => {
        handleClose();
        onOpenWorkspaceFile(workspace.rootName, relPath);
      });
    }
  }
  treeBtn.addEventListener('click', () => { mapMode = 'tree'; renderMode(); });
  mindBtn.addEventListener('click', () => { mapMode = 'mind'; renderMode(); });
  if (workspaceBtn) workspaceBtn.addEventListener('click', () => { mapMode = 'workspace'; renderMode(); });

  const panel = h('div', { class: 'map-panel', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'side-panel-head' }, [
      h('div', {}, [
        h('h2', {}, '🗺️ Document map'),
        subtitleEl,
      ]),
      h('div', { class: 'map-mode-toggle' }, [treeBtn, mindBtn, workspaceBtn]),
      h('button', {
        class: 'code-btn code-btn-close',
        type: 'button',
        onClick: handleClose,
      }, 'Close ✕'),
    ]),
    scroll,
  ]);

  overlayEl.appendChild(panel);
  document.body.appendChild(overlayEl);
  openOverlay(overlayEl);
  renderMode();
}
