import { svg } from '../utils/dom.js';
import { paletteFor } from '../utils/colors.js';
import { countDescendants } from '../markdown/parser.js';

const SIZE = 380;
const CENTER = SIZE / 2;
const HUB_R = 34;
const MAX_OUTER_R = SIZE / 2 - 8;
const FULL_CIRCLE = Math.PI * 2 - 0.001; // never draw a literal 360° arc — see layout()

function weight(node) {
  return 1 + countDescendants(node);
}

function maxHeadingLevel(doc) {
  let max = 1;
  function walk(node) {
    if (node.level > max) max = node.level;
    node.children.forEach(walk);
  }
  doc.children.forEach(walk);
  return Math.min(max, 6);
}

/**
 * Sunburst layout: each node gets an angular wedge sized by how much content
 * it (and its descendants) hold, nested one ring per heading level. Mirrors
 * the classic "partition" layout used by D3-style sunbursts.
 */
function layout(doc) {
  const wedges = [];
  function place(nodes, a0, a1, inheritedTopIndex) {
    const total = nodes.reduce((sum, n) => sum + weight(n), 0) || 1;
    let angle = a0;
    nodes.forEach((node, i) => {
      const span = ((a1 - a0) * weight(node)) / total;
      const topIndex = inheritedTopIndex === null ? i : inheritedTopIndex;
      wedges.push({ node, a0: angle, a1: angle + span, topIndex });
      place(node.children, angle, angle + span, topIndex);
      angle += span;
    });
  }
  place(doc.children, -Math.PI / 2, -Math.PI / 2 + FULL_CIRCLE, null);
  return { wedges, maxLevel: maxHeadingLevel(doc) };
}

function arcPath(rInner, rOuter, a0, a1) {
  const largeArc = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r, a) => [CENTER + r * Math.cos(a), CENTER + r * Math.sin(a)];
  const [x0o, y0o] = p(rOuter, a0);
  const [x1o, y1o] = p(rOuter, a1);
  const [x1i, y1i] = p(rInner, a1);
  const [x0i, y0i] = p(rInner, a0);
  return `M ${x0o} ${y0o} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x1o} ${y1o} L ${x1i} ${y1i} A ${rInner} ${rInner} 0 ${largeArc} 0 ${x0i} ${y0i} Z`;
}

function truncateLabel(title, span, rOuter) {
  const arcLen = span * rOuter;
  const maxChars = Math.max(3, Math.floor(arcLen / 6));
  const t = title || '';
  return t.length > maxChars ? `${t.slice(0, Math.max(1, maxChars - 1))}…` : t;
}

function buildWedgeLabel(node, a0, a1, rInner, rOuter) {
  const midAngle = (a0 + a1) / 2;
  const midR = (rInner + rOuter) / 2;
  const x = CENTER + midR * Math.cos(midAngle);
  const y = CENTER + midR * Math.sin(midAngle);
  let rotationDeg = (midAngle * 180) / Math.PI;
  let anchor = 'start';
  if (Math.cos(midAngle) < 0) { rotationDeg += 180; anchor = 'end'; } // keep text upright on the left half
  return svg('text', {
    x, y, 'text-anchor': anchor, 'dominant-baseline': 'middle', class: 'radial-label',
    transform: `rotate(${rotationDeg} ${x} ${y})`,
  }, truncateLabel(node.title, a1 - a0, rOuter));
}

function build(doc, selectedId, onPick) {
  const { wedges, maxLevel } = layout(doc);
  const ringWidth = (MAX_OUTER_R - HUB_R) / maxLevel;

  const root = svg('svg', {
    viewBox: `0 0 ${SIZE} ${SIZE}`,
    class: 'radial-svg',
    style: 'display:block; font-family: -apple-system, Helvetica, Arial, sans-serif;',
  });

  const hubSelected = selectedId === doc.id;
  root.appendChild(svg('g', {
    class: `radial-hub${hubSelected ? ' radial-selected' : ''}`,
    tabindex: '0',
    role: 'button',
    'aria-label': 'Top of document',
    onClick: () => onPick(doc.id),
    onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(doc.id); } },
  }, [
    svg('circle', { cx: CENTER, cy: CENTER, r: HUB_R }),
    svg('text', { x: CENTER, y: CENTER, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'radial-hub-label' }, '⌂'),
    svg('title', {}, 'Top of document (no parent heading)'),
  ]));

  const group = svg('g', {});
  wedges.forEach(({ node, a0, a1, topIndex }) => {
    const rInner = HUB_R + (node.level - 1) * ringWidth;
    const rOuter = HUB_R + node.level * ringWidth;
    const accent = paletteFor(topIndex).accent;
    const isSelected = node.id === selectedId;

    const wedgeG = svg('g', {
      class: `radial-wedge${isSelected ? ' radial-selected' : ''}`,
      style: `--accent:${accent}`,
      tabindex: '0',
      role: 'button',
      'aria-label': node.title,
      onClick: () => onPick(node.id),
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(node.id); } },
    });
    wedgeG.appendChild(svg('path', { d: arcPath(rInner, rOuter, a0, a1), class: 'radial-arc' }));
    wedgeG.appendChild(svg('title', {}, node.title || ''));
    if (a1 - a0 > 0.12 && rOuter - rInner > 8) {
      wedgeG.appendChild(buildWedgeLabel(node, a0, a1, rInner, rOuter));
    }
    group.appendChild(wedgeG);
  });
  root.appendChild(group);

  return root;
}

/** Render a sunburst diagram of the whole document into `container`; clicking a wedge (or the center hub) calls onPick(nodeId). */
export function renderRadialPicker(container, doc, selectedId, onPick) {
  container.innerHTML = '';
  container.appendChild(build(doc, selectedId, onPick));
}
