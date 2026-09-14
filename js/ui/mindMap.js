import { svg } from '../utils/dom.js';
import { paletteFor } from '../utils/colors.js';

// A small force-directed layout (repulsion between every pair of nodes,
// springs along edges, a weak pull toward center) — an Obsidian-graph-style
// "mind map" of the whole document, as an alternative to the indented tree:
// nodes are free-floating and can be dragged, rather than fixed to a row.
// The simulation keeps running (not just a one-shot layout): it settles to
// near-zero motion on its own, and the cursor acts as a gentle repulsive
// field, so hovering near a cluster nudges it apart instead of the graph
// being inert once drawn.
const REPULSION = 14000;
const SPRING_LENGTH = 85;
const SPRING_K = 0.05;
const CENTER_K = 0.012;
const DAMPING = 0.82;
const SETTLE_ITERATIONS = 220;
const CURSOR_RADIUS = 130;
const CURSOR_STRENGTH = 2600;
// Inverse-square repulsion can spike hugely for one frame if two nodes
// happen to pass very close together (a real occurrence once the cursor
// field is nudging things around); capping per-frame speed keeps that from
// flinging a node off-screen instead of just sliding it quickly.
const MAX_SPEED = 22;

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

  const neighbors = new Map(nodes.map((n) => [n.id, new Set()]));
  edges.forEach(({ a, b }) => { neighbors.get(a.id).add(b.id); neighbors.get(b.id).add(a.id); });

  return {
    nodes, edges, neighbors,
  };
}

/** Deterministic seed (by index, not Math.random()) so re-opening the same document settles into the same starting layout. */
function seedPositions(nodes, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const seedRadius = Math.min(width, height) * 0.32;
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
    const wobble = 0.6 + 0.4 * ((i * 7) % 5) / 4;
    n.x = cx + seedRadius * wobble * Math.cos(angle);
    n.y = cy + seedRadius * wobble * Math.sin(angle);
  });
}

/** One physics step: accumulate repulsion/spring/center/cursor forces, then integrate with damping. */
function step(nodes, edges, width, height, cursor) {
  const cx = width / 2;
  const cy = height / 2;
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

  if (cursor) {
    nodes.forEach((n) => {
      if (n.dragging) return;
      const dx = n.x - cursor.x;
      const dy = n.y - cursor.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      if (dist >= CURSOR_RADIUS) return;
      const force = (CURSOR_STRENGTH * (CURSOR_RADIUS - dist)) / CURSOR_RADIUS;
      n.fx += (dx / dist) * force;
      n.fy += (dy / dist) * force;
    });
  }

  nodes.forEach((n) => {
    if (n.dragging) return;
    n.fx += (cx - n.x) * CENTER_K;
    n.fy += (cy - n.y) * CENTER_K;
    n.vx = (n.vx + n.fx) * DAMPING;
    n.vy = (n.vy + n.fy) * DAMPING;
    const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
    if (speed > MAX_SPEED) {
      n.vx = (n.vx / speed) * MAX_SPEED;
      n.vy = (n.vy / speed) * MAX_SPEED;
    }
    n.x += n.vx;
    n.y += n.vy;
  });
}

/** Convert a client-space point to this SVG's own user-space coordinates, accounting for the viewBox scale. */
function toSvgPoint(svgEl, clientX, clientY) {
  if (!svgEl.createSVGPoint) return null;
  const pt = svgEl.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return null;
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

/** Let the user drag a node to reposition it; a plain click (no movement) fires onClick instead. */
function wireDrag(groupEl, node, onClick) {
  let dragging = false;
  let moved = false;

  groupEl.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    dragging = true;
    moved = false;
    node.dragging = true;
    node.vx = 0; node.vy = 0;
    groupEl.setPointerCapture(e.pointerId);
  });
  groupEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const p = toSvgPoint(groupEl.ownerSVGElement, e.clientX, e.clientY);
    if (!p) return;
    if (Math.abs(p.x - node.x) > 2 || Math.abs(p.y - node.y) > 2) moved = true;
    node.x = p.x;
    node.y = p.y;
  });
  groupEl.addEventListener('pointerup', () => {
    dragging = false;
    node.dragging = false;
    if (!moved) onClick();
  });
}

/** Render an Obsidian-style force-directed "mind map" of the whole document into `container`. Returns a stop() to cancel its animation loop. */
export function renderMindMap(container, doc, selectedId, onPick) {
  const width = container.clientWidth || 900;
  const height = Math.max(container.clientHeight || 600, 480);
  const { nodes, edges, neighbors } = buildGraph(doc);
  seedPositions(nodes, width, height);
  for (let i = 0; i < SETTLE_ITERATIONS; i += 1) step(nodes, edges, width, height, null);

  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    style: 'display:block; width:100%; height:100%; font-family: -apple-system, Helvetica, Arial, sans-serif;',
  });

  const edgeLayer = svg('g', { class: 'mindmap-edges' });
  edges.forEach((edge) => {
    edge.el = svg('line', { class: 'mindmap-edge' });
    edgeLayer.appendChild(edge.el);
  });
  root.appendChild(edgeLayer);

  // Hover is driven from the tracked cursor position inside tick() below,
  // not from native pointerenter/pointerleave on the node <g> elements.
  // Those elements get a fresh `transform` every animation frame (the whole
  // point of "dynamic" nodes), and a continuously-moving element can drift
  // out from under a perfectly still cursor and back again, which fires
  // spurious leave/enter pairs and makes the highlight flicker or drop out
  // right when it's queried.
  //
  // A tight, fixed radius isn't enough either: the cursor's own repulsion
  // field (CURSOR_RADIUS/CURSOR_STRENGTH above) actively pushes whichever
  // node is closest to the pointer AWAY from it, every frame, by design —
  // a node the user just hovered gets shoved outside a small radius almost
  // immediately, even with the pointer held perfectly still, as it's pushed
  // out toward the edge of the repulsion field. Rather than chase a single
  // "still the same node?" identity through that motion, just highlight
  // whichever node is nearest the cursor right now, using a radius generous
  // enough to comfortably contain where a repelled node settles (it
  // equilibrates around CURSOR_RADIUS away, plus overshoot from momentum) —
  // that node stays the natural answer to "nearest" even as it's pushed
  // outward, since nothing else is closer to the cursor than it is.
  let hoveredId = null;
  const HOVER_RADIUS = CURSOR_RADIUS + 90;
  function applyHighlight() {
    const related = hoveredId ? neighbors.get(hoveredId) : null;
    nodes.forEach((n) => {
      const dim = hoveredId && n.id !== hoveredId && !(related && related.has(n.id));
      n.el.classList.toggle('mindmap-dim', Boolean(dim));
      n.el.classList.toggle('mindmap-focused', n.id === hoveredId);
    });
    edges.forEach((e) => {
      const involved = hoveredId && (e.a.id === hoveredId || e.b.id === hoveredId);
      e.el.classList.toggle('mindmap-edge-dim', Boolean(hoveredId) && !involved);
      e.el.classList.toggle('mindmap-edge-active', Boolean(involved));
    });
  }
  function updateHover() {
    let nextId = null;
    if (cursor && !nodes.some((n) => n.dragging)) {
      let bestDist = HOVER_RADIUS;
      nodes.forEach((n) => {
        const dx = n.x - cursor.x;
        const dy = n.y - cursor.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= bestDist) { bestDist = dist; nextId = n.id; }
      });
    }
    if (nextId !== hoveredId) {
      hoveredId = nextId;
      applyHighlight();
    }
  }

  const nodeLayer = svg('g', { class: 'mindmap-nodes' });
  nodes.forEach((n) => {
    const accent = paletteFor(n.topIndex).accent;
    const r = Math.max(13 - n.level * 1.4, 5);
    const isCurrent = n.id === selectedId;
    const group = svg('g', {
      class: `mindmap-node${isCurrent ? ' mindmap-node-current' : ''}`,
      style: `--accent:${accent}`,
    });
    group.appendChild(svg('circle', { r, class: 'mindmap-dot' }));
    group.appendChild(svg('text', { x: r + 6, y: 4, class: 'mindmap-label' }, n.title || '(untitled)'));
    group.appendChild(svg('title', {}, n.title || ''));
    wireDrag(group, n, () => onPick(n.id));
    n.el = group;
    nodeLayer.appendChild(group);
  });
  root.appendChild(nodeLayer);

  let cursor = null;
  root.addEventListener('pointermove', (e) => { cursor = toSvgPoint(root, e.clientX, e.clientY); });
  root.addEventListener('pointerleave', () => { cursor = null; updateHover(); });

  let rafId = null;
  function tick() {
    step(nodes, edges, width, height, cursor);
    nodes.forEach((n) => n.el.setAttribute('transform', `translate(${n.x},${n.y})`));
    edges.forEach((e) => {
      e.el.setAttribute('x1', e.a.x); e.el.setAttribute('y1', e.a.y);
      e.el.setAttribute('x2', e.b.x); e.el.setAttribute('y2', e.b.y);
    });
    updateHover();
    rafId = requestAnimationFrame(tick);
  }
  tick();

  container.innerHTML = '';
  container.appendChild(root);

  return function stop() {
    if (rafId !== null) cancelAnimationFrame(rafId);
  };
}
