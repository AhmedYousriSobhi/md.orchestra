import { findNode, findParent, getPath } from '../markdown/parser.js';

const listeners = new Set();

let state = {
  doc: null,          // parsed section tree (see markdown/parser.js), or null before a file is loaded
  fileName: null,      // display name of the loaded file
  fileHandle: null,    // File System Access API handle, if the file was opened that way
  selectedId: null,    // id of the section currently focused in the main panel
  dirty: false,        // true once the in-memory doc diverges from the last load/save
};

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(state);
}

export function setState(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  notify();
}

export function loadDocument({ doc, fileName, fileHandle = null }) {
  const firstChild = doc.children[0];
  setState({
    doc,
    fileName,
    fileHandle,
    selectedId: firstChild ? firstChild.id : doc.id,
    dirty: false,
  });
}

export function selectSection(id) {
  setState({ selectedId: id });
}

export function getSelectedNode() {
  if (!state.doc || !state.selectedId) return null;
  return findNode(state.doc, state.selectedId);
}

export function getSelectedPath() {
  if (!state.doc || !state.selectedId) return [];
  return getPath(state.doc, state.selectedId);
}

/** Replace one node's bodyMarkdown (and optionally title) in place, then mark the doc dirty. */
export function updateNode(id, patch) {
  if (!state.doc) return;
  const node = findNode(state.doc, id);
  if (!node) return;
  Object.assign(node, patch);
  setState({ doc: state.doc, dirty: true });
}

/** Remove a section (and everything nested under it) from the tree. Returns the parent id, or null. */
export function removeSection(id) {
  if (!state.doc || id === state.doc.id) return null;
  const parent = findParent(state.doc, id);
  if (!parent) return null;
  parent.children = parent.children.filter((c) => c.id !== id);
  setState({ doc: state.doc, dirty: true });
  return parent.id;
}

function isDescendant(node, id) {
  return node.children.some((c) => c.id === id || isDescendant(c, id));
}

/** Set node.level to `newLevel` and shift every descendant by the same amount, clamped to 1-6. */
function relevelSubtree(node, newLevel) {
  const delta = newLevel - node.level;
  function walk(n, level) {
    n.level = Math.min(Math.max(level, 1), 6);
    n.children.forEach((c) => walk(c, level + 1));
  }
  walk(node, newLevel);
  return delta;
}

/**
 * Resolve a {referenceId, placement} drop target — used by both
 * insertSection (brand-new content) and moveSection (repositioning
 * existing content) — into the array it belongs in, the index to splice
 * at, and the heading level a node dropped there should take.
 * placement: 'before' | 'after' (sibling of referenceId) or
 * 'inside-start' | 'inside-end' (child of referenceId, first or last).
 */
function resolveDropTarget(doc, referenceId, placement) {
  if (placement === 'inside-start' || placement === 'inside-end') {
    const parent = findNode(doc, referenceId);
    if (!parent) return null;
    const level = referenceId === doc.id ? 1 : Math.min(parent.level + 1, 6);
    return { siblings: parent.children, index: placement === 'inside-start' ? 0 : parent.children.length, level };
  }
  if (referenceId === doc.id) return null; // the root has no siblings to be "before"/"after"
  const parent = findParent(doc, referenceId);
  if (!parent) return null;
  const refIndex = parent.children.findIndex((c) => c.id === referenceId);
  if (refIndex === -1) return null;
  const refNode = parent.children[refIndex];
  return { siblings: parent.children, index: placement === 'before' ? refIndex : refIndex + 1, level: refNode.level };
}

/**
 * Splice a brand-new section node into the tree at a precise drop target
 * (see resolveDropTarget) rather than only "first/last child of a parent" —
 * dragging it onto the tree picker (or clicking a heading, which drops it
 * inside that heading's end) sets `referenceId`/`placement`. Unlike
 * updateNode this is a structural change, for authoring whole new
 * sections rather than annotating an existing one.
 */
export function insertSection({ node, referenceId, placement }) {
  if (!state.doc) return false;
  const target = resolveDropTarget(state.doc, referenceId, placement);
  if (!target) return false;
  target.siblings.splice(target.index, 0, node);
  setState({ doc: state.doc, dirty: true });
  return true;
}

/**
 * Move an *existing* node to a new drop target, re-leveling it (and its
 * subtree) to fit its new position. Used for drag-and-drop reordering in
 * the sidebar. Refuses to move a node into itself or its own descendant.
 */
export function moveSection({ nodeId, referenceId, placement }) {
  if (!state.doc || nodeId === state.doc.id || nodeId === referenceId) return false;
  const node = findNode(state.doc, nodeId);
  const oldParent = findParent(state.doc, nodeId);
  if (!node || !oldParent || isDescendant(node, referenceId)) return false;

  const target = resolveDropTarget(state.doc, referenceId, placement);
  if (!target) return false;

  const oldIndex = oldParent.children.indexOf(node);
  oldParent.children.splice(oldIndex, 1);
  // If the target list is the same array we just removed from, and the
  // removal shifted indices before the target slot, account for that.
  const sameParent = target.siblings === oldParent.children;
  const insertIndex = sameParent && oldIndex < target.index ? target.index - 1 : target.index;

  relevelSubtree(node, target.level);
  target.siblings.splice(insertIndex, 0, node);
  setState({ doc: state.doc, dirty: true });
  return true;
}
