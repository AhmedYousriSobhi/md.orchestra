import { h, svg } from '../utils/dom.js';
import { paletteFor } from '../utils/colors.js';
import { openOverlay, closeOverlay } from './transitions.js';
import { getState, selectSection } from '../state/store.js';
import { renderMindMap } from './mindMap.js';
import { renderWorkspaceGraph } from './workspaceGraph.js';
import { attachPanZoom } from './panZoom.js';

const TREE_FIT_PADDING = 24;

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

/**
 * The indented-tree layout for a document's own heading structure (Tree
 * mode) — parent/child position and a connecting line say everything it
 * needs. Workspace mode uses focalGraph.js instead (see openMapView), the
 * same click-to-expand graph the Explorer sidebar already browses this
 * exact workspace with.
 *
 * Renders into `container` and wires up the same pan/wheel-zoom/pinch-zoom
 * behavior mind-map already has (see panZoom.js) — the tree used to just
 * be a content-sized SVG inside a scrolling div, so a big document had no
 * way to zoom out and see its own shape at once. Returns a `stop()` to
 * disconnect the pan/zoom listeners when the mode is switched away from
 * or the panel closes, matching renderMindMap/renderWorkspaceGraph.
 */
function renderTreeMap(container, doc, selectedId, onPick) {
  const { nodes, edges, rows, maxX } = layoutTree(doc);
  const contentWidth = maxX + LABEL_MAX * 6.4 + 24;
  const contentHeight = Math.max(rows * ROW_H, ROW_H) + 16;

  const root = svg('svg', {
    style: 'display:block; width:100%; height:100%; font-family: -apple-system, Helvetica, Arial, sans-serif; touch-action: none;',
  });
  const world = svg('g', { class: 'map-world' });
  root.appendChild(world);

  const edgeLayer = svg('g', { class: 'map-edges' });
  edges.forEach(({ from, to }) => {
    edgeLayer.appendChild(svg('path', {
      d: `M ${from.x + MARKER_R} ${from.y + ROW_H / 2} V ${to.y + ROW_H / 2} H ${to.x - MARKER_R - 2}`,
      class: 'map-edge',
    }));
  });
  world.appendChild(edgeLayer);

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
  world.appendChild(nodeLayer);

  const panZoom = attachPanZoom(root, world, container, {
    getContentBounds: () => ({
      minX: 0, minY: 0, maxX: contentWidth, maxY: contentHeight,
    }),
    shouldStartPan: (e) => !(e.target.closest && e.target.closest('.map-node')),
    fitPadding: TREE_FIT_PADDING,
  });

  const fitBtn = h('button', {
    class: 'mindmap-fit-btn',
    type: 'button',
    title: 'Fit the whole tree in view',
    onClick: () => panZoom.fitToContent(),
  }, '⤢ Fit');

  container.innerHTML = '';
  container.appendChild(root);
  container.appendChild(fitBtn);

  return panZoom.stop;
}

export function openMapView({ workspace = null, onOpenWorkspaceFile } = {}) {
  const { doc, fileName, selectedId } = getState();
  if (!doc) return;

  if (overlayEl) overlayEl.remove();
  overlayEl = h('div', { class: 'overlay map-overlay', hidden: true });

  const scroll = h('div', { class: 'map-scroll' });

  // Every mode now wires up its own pan/zoom listeners (mind map's own
  // continuous requestAnimationFrame loop on top of that) — all of it must
  // be explicitly torn down whenever we leave that mode, or a ResizeObserver
  // and, for mind map, the rAF loop keep running forever in the background.
  let stopCurrentMode = null;
  function teardownCurrentMode() {
    if (stopCurrentMode) { stopCurrentMode(); stopCurrentMode = null; }
  }

  // transitions.js's global Escape handler closes any open overlay directly
  // (it doesn't know about this component's own pan/zoom listeners), so
  // this panel needs its own Escape listener purely to tear those down when
  // that happens — removed again on every close path, so repeated opens
  // don't pile up.
  function onEscape(e) { if (e.key === 'Escape') handleClose(); }
  function handleClose() {
    teardownCurrentMode();
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
    teardownCurrentMode();
    treeBtn.classList.toggle('map-mode-active', mapMode === 'tree');
    mindBtn.classList.toggle('map-mode-active', mapMode === 'mind');
    if (workspaceBtn) workspaceBtn.classList.toggle('map-mode-active', mapMode === 'workspace');
    scroll.innerHTML = '';
    if (mapMode === 'tree') {
      subtitleEl.textContent = `${fileName || ''} — click any heading to jump there`;
      const treeContainer = h('div', { class: 'map-canvas-container' });
      scroll.appendChild(treeContainer);
      // needs real layout dimensions, which only exist once it's in the DOM
      requestAnimationFrame(() => { stopCurrentMode = renderTreeMap(treeContainer, doc, selectedId, onPick); });
    } else if (mapMode === 'mind') {
      subtitleEl.textContent = `${fileName || ''} — click a heading to jump there, or drag a node to rearrange it`;
      const mindContainer = h('div', { class: 'map-canvas-container' });
      scroll.appendChild(mindContainer);
      // needs real layout dimensions, which only exist once it's in the DOM
      requestAnimationFrame(() => { stopCurrentMode = renderMindMap(mindContainer, doc, selectedId, onPick); });
    } else {
      subtitleEl.textContent = `${workspace.rootName} — click a folder to expand it, a file to open it`;
      // A real node-link tree (workspaceGraph.js) — branches fan out by
      // depth and a parent centers on its own children, rather than every
      // node stacked in one flat vertical list; click to expand/collapse a
      // folder still works the same way, just laid out to actually look
      // like the shape of the tree instead of a plain scrolling list of
      // rows.
      const graphWrap = h('div', { class: 'map-canvas-container' });
      scroll.appendChild(graphWrap);
      requestAnimationFrame(() => {
        stopCurrentMode = renderWorkspaceGraph(graphWrap, workspace, (relPath) => {
          handleClose();
          onOpenWorkspaceFile(workspace.rootName, relPath);
        });
      });
    }
  }
  treeBtn.addEventListener('click', () => { mapMode = 'tree'; renderMode(); });
  mindBtn.addEventListener('click', () => { mapMode = 'mind'; renderMode(); });
  if (workspaceBtn) workspaceBtn.addEventListener('click', () => { mapMode = 'workspace'; renderMode(); });

  // A dedicated header layout, not the shared .side-panel-head pattern
  // other panels use: this one genuinely has three things to fit (title,
  // mode toggle, close button), not two, and cramming all three into one
  // non-wrapping row is exactly what was cropping the mode toggle and the
  // close button off the right edge on a narrow phone screen. Title+close
  // share one row (so close stays reachable at a predictable spot no
  // matter what), and the mode toggle gets its own full-width row below,
  // free to wrap onto a second line — keeping every mode's full label
  // (deliberately not collapsing to icon-only) without cropping anything.
  const panel = h('div', { class: 'map-panel', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'map-panel-head' }, [
      h('div', { class: 'map-panel-head-top' }, [
        h('div', {}, [
          h('h2', {}, '🗺️ Document map'),
          subtitleEl,
        ]),
        h('button', {
          class: 'icon-btn map-panel-close',
          type: 'button',
          onClick: handleClose,
          'aria-label': 'Close document map',
          title: 'Close',
        }, '✕'),
      ]),
      h('div', { class: 'map-mode-toggle' }, [treeBtn, mindBtn, workspaceBtn]),
    ]),
    scroll,
  ]);

  overlayEl.appendChild(panel);
  document.body.appendChild(overlayEl);
  openOverlay(overlayEl);
  renderMode();
}
