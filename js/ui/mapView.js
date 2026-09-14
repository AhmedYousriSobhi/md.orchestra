import { h, svg } from '../utils/dom.js';
import { paletteFor } from '../utils/colors.js';
import { openOverlay, closeOverlay } from './transitions.js';
import { getState, selectSection } from '../state/store.js';
import { renderMindMap } from './mindMap.js';

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

export function openMapView() {
  const { doc, fileName, selectedId } = getState();
  if (!doc) return;

  if (overlayEl) overlayEl.remove();
  overlayEl = h('div', { class: 'overlay map-overlay', hidden: true });
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) closeOverlay(overlayEl); });

  const scroll = h('div', { class: 'map-scroll' });
  const onPick = (id) => {
    selectSection(id);
    closeOverlay(overlayEl);
  };

  const treeBtn = h('button', { class: 'map-mode-btn', type: 'button' }, '🌳 Tree');
  const mindBtn = h('button', { class: 'map-mode-btn', type: 'button' }, '🧠 Mind map');

  function renderMode() {
    treeBtn.classList.toggle('map-mode-active', mapMode === 'tree');
    mindBtn.classList.toggle('map-mode-active', mapMode === 'mind');
    scroll.innerHTML = '';
    if (mapMode === 'tree') {
      scroll.appendChild(buildSvg(doc, selectedId, onPick));
    } else {
      const mindContainer = h('div', { class: 'mindmap-container' });
      scroll.appendChild(mindContainer);
      // needs real layout dimensions, which only exist once it's in the DOM
      requestAnimationFrame(() => renderMindMap(mindContainer, doc, selectedId, onPick));
    }
  }
  treeBtn.addEventListener('click', () => { mapMode = 'tree'; renderMode(); });
  mindBtn.addEventListener('click', () => { mapMode = 'mind'; renderMode(); });

  const panel = h('div', { class: 'map-panel', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'side-panel-head' }, [
      h('div', {}, [
        h('h2', {}, '🗺️ Document map'),
        h('div', { class: 'insight-subtitle' }, `${fileName || ''} — click any heading to jump there, or drag a node in Mind map to rearrange it`),
      ]),
      h('div', { class: 'map-mode-toggle' }, [treeBtn, mindBtn]),
      h('button', { class: 'code-btn code-btn-close', type: 'button', onClick: () => closeOverlay(overlayEl) }, 'Close ✕'),
    ]),
    scroll,
  ]);

  overlayEl.appendChild(panel);
  document.body.appendChild(overlayEl);
  openOverlay(overlayEl);
  renderMode();
}
