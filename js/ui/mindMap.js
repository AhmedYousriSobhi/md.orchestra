import { svg } from '../utils/dom.js';
import { paletteFor } from '../utils/colors.js';

// A small force-directed layout (repulsion between every pair of nodes,
// springs along edges, a weak pull toward center) — an Obsidian-graph-style
// "mind map" of the whole document, as an alternative to the indented tree:
// nodes are free-floating and can be dragged, rather than fixed to a row.
const REPULSION = 14000;
const SPRING_LENGTH = 85;
const SPRING_K = 0.05;
const CENTER_K = 0.012;
const DAMPING = 0.82;
const ITERATIONS = 260;

function buildGraph(doc) {
  const nodes = [];
  const nodeById = new Map();
  const parentOf = new Map();

  function collect(node, topIndex, parentId) {
    const n = {
      id: node.id, title: node.title, level: node.level, topIndex, x: 0, y: 0, vx: 0, vy: 0,
    };
    nodes.push(n);
    nodeById.set(node.id, n);
    parentOf.set(node.id, parentId);
    node.children.forEach((c) => collect(c, topIndex, node.id));
  }
  doc.children.forEach((node, i) => collect(node, i, null));

  const edges = [];
  parentOf.forEach((parentId, id) => {
    if (parentId) edges.push({ a: nodeById.get(parentId), b: nodeById.get(id) });
  });
  return { nodes, edges };
}

function settle(nodes, edges, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  // Deterministic seed (by index, not Math.random()) so re-opening the same
  // document settles into the same layout instead of shuffling every time.
  const seedRadius = Math.min(width, height) * 0.32;
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
    const wobble = 0.6 + 0.4 * ((i * 7) % 5) / 4;
    n.x = cx + seedRadius * wobble * Math.cos(angle);
    n.y = cy + seedRadius * wobble * Math.sin(angle);
  });

  for (let iter = 0; iter < ITERATIONS; iter += 1) {
    nodes.forEach((n) => { n.fx = 0; n.fy = 0; });

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = Math.max(dx * dx + dy * dy, 1);
        const dist = Math.sqrt(distSq);
        const force = REPULSION / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.fx += fx; a.fy += fy;
        b.fx -= fx; b.fy -= fy;
      }
    }

    edges.forEach(({ a, b }) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const stretch = (dist - SPRING_LENGTH) * SPRING_K;
      const fx = (dx / dist) * stretch;
      const fy = (dy / dist) * stretch;
      a.fx += fx; a.fy += fy;
      b.fx -= fx; b.fy -= fy;
    });

    nodes.forEach((n) => {
      n.fx += (cx - n.x) * CENTER_K;
      n.fy += (cy - n.y) * CENTER_K;
      n.vx = (n.vx + n.fx) * DAMPING;
      n.vy = (n.vy + n.fy) * DAMPING;
      n.x += n.vx;
      n.y += n.vy;
    });
  }
}

/** Let the user drag a node to reposition it; a plain click (no movement) fires onClick instead. */
function wireDrag(groupEl, node, edges, onClick) {
  let dragging = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;

  groupEl.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    dragging = true;
    moved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    groupEl.setPointerCapture(e.pointerId);
  });
  groupEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    if (!moved) return;
    const ctm = groupEl.ownerSVGElement.getScreenCTM();
    const scale = ctm ? 1 / ctm.a : 1;
    node.x += dx * scale;
    node.y += dy * scale;
    lastX = e.clientX;
    lastY = e.clientY;
    groupEl.setAttribute('transform', `translate(${node.x},${node.y})`);
    edges.forEach((edge) => {
      if (edge.a === node || edge.b === node) {
        edge.el.setAttribute('x1', edge.a.x); edge.el.setAttribute('y1', edge.a.y);
        edge.el.setAttribute('x2', edge.b.x); edge.el.setAttribute('y2', edge.b.y);
      }
    });
  });
  groupEl.addEventListener('pointerup', () => {
    dragging = false;
    if (!moved) onClick();
  });
}

/** Render an Obsidian-style force-directed "mind map" of the whole document into `container`. */
export function renderMindMap(container, doc, selectedId, onPick) {
  const width = container.clientWidth || 900;
  const height = Math.max(container.clientHeight || 600, 480);
  const { nodes, edges } = buildGraph(doc);
  settle(nodes, edges, width, height);

  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    style: 'display:block; width:100%; height:100%; font-family: -apple-system, Helvetica, Arial, sans-serif;',
  });

  const edgeLayer = svg('g', { class: 'mindmap-edges' });
  edges.forEach((edge) => {
    edge.el = svg('line', {
      x1: edge.a.x, y1: edge.a.y, x2: edge.b.x, y2: edge.b.y, class: 'mindmap-edge',
    });
    edgeLayer.appendChild(edge.el);
  });
  root.appendChild(edgeLayer);

  const nodeLayer = svg('g', { class: 'mindmap-nodes' });
  nodes.forEach((n) => {
    const accent = paletteFor(n.topIndex).accent;
    const r = Math.max(13 - n.level * 1.4, 5);
    const isCurrent = n.id === selectedId;
    const group = svg('g', {
      class: `mindmap-node${isCurrent ? ' mindmap-node-current' : ''}`,
      style: `--accent:${accent}`,
      transform: `translate(${n.x},${n.y})`,
    });
    group.appendChild(svg('circle', { r, class: 'mindmap-dot' }));
    group.appendChild(svg('text', { x: r + 6, y: 4, class: 'mindmap-label' }, n.title || '(untitled)'));
    group.appendChild(svg('title', {}, n.title || ''));
    wireDrag(group, n, edges, () => onPick(n.id));
    nodeLayer.appendChild(group);
  });
  root.appendChild(nodeLayer);

  container.innerHTML = '';
  container.appendChild(root);
}
