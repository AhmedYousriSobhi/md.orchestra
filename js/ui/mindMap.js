import { h, svg } from '../utils/dom.js';
import { paletteFor } from '../utils/colors.js';
import { attachPanZoom, toSvgPoint } from './panZoom.js';

// A small force-directed layout (repulsion between every pair of nodes,
// springs along edges, a weak pull toward center) — an Obsidian-graph-style
// "mind map" of the whole document, as an alternative to the indented tree:
// nodes are free-floating and can be dragged, rather than fixed to a row.
// The simulation keeps running (not just a one-shot layout): it settles to
// near-zero motion on its own.
//
// Two things layer on top of that physics, both driven by the tracked
// cursor position every frame:
//  - A zoom/pan "world" transform, auto-fit to the settled layout's actual
//    bounding box when the view opens. This is what keeps a big document's
//    graph from being cropped: no matter how much space the physics needs
//    (which grows with node count), the whole thing is scaled to fit inside
//    the visible viewport at open time, and the user can still scroll to
//    zoom or drag the background to pan into a dense cluster.
//  - A per-node fisheye magnify+pull effect, like the Dock or an Apple
//    Watch springboard: nodes near the cursor grow and nudge slightly
//    toward it, tapering smoothly back to normal size within a radius.
//    This is what actually makes hovering the graph feel alive, and it's a
//    render-only effect layered on top of the physics positions — it never
//    touches velocity, so it can't destabilize the layout the way physically
//    repelling nodes from the cursor previously did.
const REPULSION = 14000;
const SPRING_LENGTH = 85;
const SPRING_K = 0.05;
const CENTER_K = 0.012;
const DAMPING = 0.82;
const SETTLE_ITERATIONS = 220;
// Inverse-square repulsion can spike hugely for one frame if two nodes
// happen to pass very close together; capping per-frame speed keeps that
// from flinging a node off-screen instead of just sliding it quickly.
const MAX_SPEED = 22;

const FISHEYE_RADIUS = 170;
const FISHEYE_MAX_SCALE = 1.85;
const FISHEYE_MAX_PULL = 20;
const HOVER_RADIUS = FISHEYE_RADIUS;

const MIN_ZOOM = 0.12;
const MAX_ZOOM = 4;
const FIT_PADDING = 56;
const FIT_MAX_INITIAL_ZOOM = 1.35;

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
function seedPositions(nodes, size) {
  const seedRadius = size * 0.32;
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
    const wobble = 0.6 + 0.4 * ((i * 7) % 5) / 4;
    n.x = seedRadius * wobble * Math.cos(angle);
    n.y = seedRadius * wobble * Math.sin(angle);
  });
}

/** One physics step: accumulate repulsion/spring/center forces, then integrate with damping. Runs in "world" space, independent of the viewport's zoom/pan. */
function step(nodes, edges) {
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
    if (n.dragging) return;
    n.fx += -n.x * CENTER_K;
    n.fy += -n.y * CENTER_K;
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

/** Let the user drag a node to reposition it (in world space); a plain click (no movement) fires onClick instead. */
function wireDrag(groupEl, node, root, world, onClick) {
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
    const p = toSvgPoint(root, world, e.clientX, e.clientY);
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
  let viewW = container.clientWidth || 900;
  let viewH = Math.max(container.clientHeight || 600, 480);
  const { nodes, edges, neighbors } = buildGraph(doc);

  // The physics runs in its own "world" space sized to the node count, not
  // to the visible viewport — a big document just needs more room, and the
  // view-fit step below scales that down to whatever actually fits.
  const worldSize = Math.max(700, Math.sqrt(nodes.length) * 220);
  seedPositions(nodes, worldSize);
  for (let i = 0; i < SETTLE_ITERATIONS; i += 1) step(nodes, edges);

  const root = svg('svg', {
    viewBox: `0 0 ${viewW} ${viewH}`,
    style: 'display:block; width:100%; height:100%; font-family: -apple-system, Helvetica, Arial, sans-serif; touch-action: none;',
  });

  const world = svg('g', { class: 'mindmap-world' });
  root.appendChild(world);

  const edgeLayer = svg('g', { class: 'mindmap-edges' });
  edges.forEach((edge) => {
    edge.el = svg('line', { class: 'mindmap-edge' });
    edgeLayer.appendChild(edge.el);
  });
  world.appendChild(edgeLayer);

  let hoveredId = null;
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
    wireDrag(group, n, root, world, () => onPick(n.id));
    n.r = r;
    n.el = group;
    nodeLayer.appendChild(group);
  });
  world.appendChild(nodeLayer);

  // --- View (pan/zoom), auto-fit to whatever the physics actually needs,
  // plus cursor tracking for the fisheye effect below --- all delegated to
  // the shared pan/wheel-zoom/pinch-zoom helper Tree and Workspace mode
  // now use too (see panZoom.js).
  function contentBounds() {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    nodes.forEach((n) => {
      const labelW = 10 + (n.title || '(untitled)').length * 6.4;
      minX = Math.min(minX, n.x - n.r - 4);
      maxX = Math.max(maxX, n.x + n.r + labelW);
      minY = Math.min(minY, n.y - n.r - 10);
      maxY = Math.max(maxY, n.y + n.r + 10);
    });
    if (!Number.isFinite(minX)) return {
      minX: -viewW / 2, minY: -viewH / 2, maxX: viewW / 2, maxY: viewH / 2,
    };
    return {
      minX, minY, maxX, maxY,
    };
  }

  let cursorWorld = null;
  const panZoom = attachPanZoom(root, world, container, {
    getContentBounds: contentBounds,
    shouldStartPan: (e) => !(e.target.closest && e.target.closest('.mindmap-node')),
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    fitPadding: FIT_PADDING,
    fitMaxInitialZoom: FIT_MAX_INITIAL_ZOOM,
    onPointerMove: (p) => { cursorWorld = p; },
  });
  root.addEventListener('pointerleave', () => { cursorWorld = null; });

  const fitBtn = h('button', {
    class: 'mindmap-fit-btn',
    type: 'button',
    title: 'Fit the whole map in view',
    onClick: () => panZoom.fitToContent(),
  }, '⤢ Fit');

  function updateHover() {
    let nextId = null;
    if (cursorWorld && !nodes.some((n) => n.dragging)) {
      let bestDist = HOVER_RADIUS;
      nodes.forEach((n) => {
        const dist = Math.hypot(n.x - cursorWorld.x, n.y - cursorWorld.y);
        if (dist <= bestDist) { bestDist = dist; nextId = n.id; }
      });
    }
    if (nextId !== hoveredId) {
      hoveredId = nextId;
      applyHighlight();
    }
  }

  // A continuous rAF loop is fine on a plugged-in desktop tab; on a phone
  // it's a direct battery drain for as long as this view happens to be
  // left open — including while the app itself is backgrounded, since
  // requestAnimationFrame's own browser-level throttling while hidden
  // isn't guaranteed consistent across WebView implementations the way it
  // is in a real desktop browser. Explicitly stopping on visibilitychange
  // (and picking back up when visible again) means this costs nothing at
  // all while it can't be seen, on any platform, not just Android.
  let rafId = null;
  function handleVisibilityChange() {
    if (document.hidden) {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    } else if (rafId === null) {
      tick();
    }
  }
  document.addEventListener('visibilitychange', handleVisibilityChange);

  function tick() {
    step(nodes, edges);
    nodes.forEach((n) => {
      let scale = 1;
      let dxAdd = 0;
      let dyAdd = 0;
      if (cursorWorld && !n.dragging) {
        const dx = cursorWorld.x - n.x;
        const dy = cursorWorld.y - n.y;
        const dist = Math.hypot(dx, dy);
        if (dist < FISHEYE_RADIUS) {
          const t = 1 - dist / FISHEYE_RADIUS;
          const ease = t * t * (3 - 2 * t); // smoothstep: gentle taper, no hard edge
          scale = 1 + (FISHEYE_MAX_SCALE - 1) * ease;
          const pull = FISHEYE_MAX_PULL * ease;
          if (dist > 0.01) { dxAdd = (dx / dist) * pull; dyAdd = (dy / dist) * pull; }
        }
      }
      n.el.setAttribute('transform', `translate(${n.x + dxAdd},${n.y + dyAdd}) scale(${scale})`);
    });
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
  container.appendChild(fitBtn);

  return function stop() {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    panZoom.stop();
    if (rafId !== null) cancelAnimationFrame(rafId);
  };
}
