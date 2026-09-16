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

/**
 * The indented-tree layout, shared by document Tree mode and Workspace
 * mode (see buildWorkspaceMapDoc) — parent/child position and a
 * connecting line say everything both need: a document's own heading
 * nesting, or a folder's actual nesting on disk. `nodeMeta(node)` is
 * optional (only Workspace mode passes it): `{ isDir, clickable }`, used
 * to prefix a 📁/📄 icon and mute a non-interactive folder row rather
 * than let it look identically clickable to a file — document Tree mode
 * has no such distinction (every heading is equally "clickable"), so it's
 * simply omitted there.
 */
function buildSvg(doc, selectedId, onPick, nodeMeta) {
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
    const meta = nodeMeta ? nodeMeta(node) : null;
    // A plain, uniform color for file-system hierarchy (folders/files
    // don't have a "topic" the way a document's own top-level sections
    // do) — the rainbow-per-top-level-section palette stays for an actual
    // document's heading tree, where it's genuinely meaningful.
    const accent = meta ? 'var(--text-faint)' : paletteFor(topIndex).accent;
    const isCurrent = node.id === selectedId;
    const clickable = !meta || meta.clickable;
    const cy = y + ROW_H / 2;
    const label = meta ? `${meta.isDir ? '📁' : '📄'} ${truncate(node.title)}` : truncate(node.title);

    const group = svg('g', {
      class: `map-node${isCurrent ? ' map-node-current' : ''}${clickable ? '' : ' map-node-inert'}`,
      style: `--accent:${accent}`,
      tabindex: clickable ? '0' : '-1',
      role: clickable ? 'button' : undefined,
      'aria-label': node.title,
      onClick: clickable ? () => onPick(node.id) : undefined,
      onKeydown: clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(node.id); } } : undefined,
    });
    if (!meta) group.appendChild(svg('circle', { cx: x, cy, r: isCurrent ? MARKER_R + 2 : MARKER_R, class: 'map-dot' }));
    group.appendChild(svg('text', { x: meta ? x : x + MARKER_R + 8, y: cy, class: 'map-label', 'dominant-baseline': 'middle' }, label));
    group.appendChild(svg('title', {}, node.title || ''));
    nodeLayer.appendChild(group);
  });
  root.appendChild(nodeLayer);

  return root;
}

/**
 * Convert a workspace's plain folder/file tree (state/workspace.js's
 * `{name, path, type, children}` shape) into the {id, title, level,
 * children} shape buildSvg's tree layout expects (the same shape a parsed
 * document's heading tree already has) — its own synthetic "document",
 * one node per file or folder instead of one per heading. `idInfo` maps
 * each synthetic id back to {type, relPath} so a click can tell a file
 * node (open it) from a folder node (nothing to open, just structure).
 */
function buildWorkspaceMapDoc(workspace) {
  const idInfo = new Map();
  let counter = 0;
  function convert(node, depth) {
    const id = `wsmap-${counter}`;
    counter += 1;
    idInfo.set(id, { type: node.type, relPath: node.path });
    return {
      id,
      title: node.type === 'dir' ? (node.name || workspace.rootName) : node.name,
      level: depth,
      children: node.type === 'dir' ? node.children.map((child) => convert(child, depth + 1)) : [],
    };
  }
  const root = convert(workspace.tree, 1);
  root.title = workspace.rootName;
  return { doc: { children: [root] }, idInfo };
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
      subtitleEl.textContent = `${workspace.rootName} — folder structure only, not file content; click a file to open it`;
      const { doc: wsDoc, idInfo } = buildWorkspaceMapDoc(workspace);
      const onPickWorkspaceNode = (id) => {
        const info = idInfo.get(id);
        if (info && info.type === 'file' && onOpenWorkspaceFile) {
          handleClose();
          onOpenWorkspaceFile(workspace.rootName, info.relPath);
        }
      };
      // The same plain indented-tree layout Tree mode uses for a document's
      // headings — a physics-based mind map free-floats every node with no
      // regard for how deep it's nested, which reads fine for a few dozen
      // headings but turns an actual directory (parent folders, nested
      // subfolders, files) into an unreadable hairball; fixed rows plus a
      // connecting line say "this is inside that" the way file-system
      // hierarchy actually needs, however many files there are — you just
      // scroll further, rather than everything degrading into noise.
      scroll.appendChild(buildSvg(wsDoc, null, onPickWorkspaceNode, (node) => {
        const info = idInfo.get(node.id);
        return { isDir: info?.type === 'dir', clickable: info?.type === 'file' };
      }));
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
