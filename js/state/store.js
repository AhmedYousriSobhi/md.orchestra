import { findNode, findParent, getPath } from '../markdown/parser.js';
import { registerTags } from './tagIndex.js';

const listeners = new Set();

let state = {
  doc: null,          // parsed section tree (see markdown/parser.js), or null before a file is loaded
  fileName: null,      // display name of the loaded file
  fileHandle: null,    // File System Access API handle, if the file was opened that way
  selectedId: null,    // id of the section currently focused in the main panel
  dirty: false,        // true once the in-memory doc diverges from the last load/save
  workspaceRelPath: null, // this file's path within its workspace (state/workspace.js), or null if it wasn't opened from one
  workspaceRootName: null, // which open workspace workspaceRelPath belongs to (several can be open at once) — null alongside workspaceRelPath
};

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Isolated per listener: main.js's render() is one of several subscribers
// (crash-recovery snapshotting is another), and a single one throwing —
// from a bad render given some edge-case document/localStorage state —
// used to abort the whole notify() loop, silently skipping every other
// subscriber for that update and, since render() runs on every future
// state change too, potentially wedging the entire UI into looking
// unresponsive from that point on. Logged, not swallowed, so a real bug is
// still visible in the console — it just can't cascade into every other
// subscriber (and everything downstream of them) breaking with it.
function notify() {
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (err) {
      console.error('A store subscriber threw; continuing with the others.', err);
    }
  }
}

export function setState(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  notify();
}

// Per-section undo history: each node id maps to a stack of its previous
// {bodyMarkdown, title} snapshots, oldest first — one entry per updateNode()
// call, so "Undo" on a section's card steps back through its edits one at a
// time (content changes, notes, title renames, an inserted AI suggestion —
// everything that goes through updateNode) regardless of which of those
// touched it most recently. Capped so a long editing session can't grow it
// unboundedly; reset whenever a different document is loaded, since node
// ids from the previous one are meaningless here.
const undoStacks = new Map();
const MAX_UNDO_DEPTH = 20;

export function loadDocument({
  doc, fileName, fileHandle = null, dirty = false, workspaceRelPath = null, workspaceRootName = null,
}) {
  undoStacks.clear();
  registerTags(doc.tags);
  const firstChild = doc.children[0];
  setState({
    doc,
    fileName,
    fileHandle,
    selectedId: firstChild ? firstChild.id : doc.id,
    dirty,
    workspaceRelPath,
    workspaceRootName,
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

/**
 * Replace the whole document tree wholesale — used when the user edits
 * the raw Markdown source directly (see ui/fullDocView.js) rather than
 * through one specific section's own updateNode(). `newDoc` comes from a
 * fresh parseMarkdown() call, so every node in it has a brand-new id
 * (parseMarkdown has no way to know which old node a given line "used to
 * be"); the current selection resets to the new document's own root
 * rather than pointing at an id that no longer exists anywhere. Per-node
 * undo history for the old ids is simply left orphaned in undoStacks — a
 * raw-source edit is undone via the textarea's own native undo instead.
 */
export function replaceWholeDocument(newDoc) {
  if (!state.doc) return;
  registerTags(newDoc.tags);
  setState({ doc: newDoc, selectedId: newDoc.id, dirty: true });
}

/**
 * Replace one node's bodyMarkdown (and optionally title) in place, then
 * mark the doc dirty. Snapshots the node's prior state first, for
 * undoNode() — but only when `patch` actually changes something: a
 * section's own editable body/notes debounce their autosave, and *also*
 * flush unconditionally on blur in case that debounce hadn't fired yet
 * (see editableMarkdownBody.js) — meaning a call here with a patch
 * identical to the node's current state is routine, not a bug, and must
 * stay a no-op for undo's sake: pushing a real entry for it would mean
 * "Undo" has to pop that phantom, unchanged entry first before it can
 * reach the edit the user actually wants to undo. setState() still runs
 * either way, since a render may be overdue regardless (that same "don't
 * rebuild mid-edit" focus guard elsewhere may have suppressed one while
 * this node's own field still had focus).
 */
export function updateNode(id, patch) {
  if (!state.doc) return;
  const node = findNode(state.doc, id);
  if (!node) return;
  const changed = Object.keys(patch).some((key) => patch[key] !== node[key]);
  if (changed) {
    const stack = undoStacks.get(id) || [];
    stack.push({ bodyMarkdown: node.bodyMarkdown, title: node.title });
    if (stack.length > MAX_UNDO_DEPTH) stack.shift();
    undoStacks.set(id, stack);
    Object.assign(node, patch);
  }
  setState({ doc: state.doc, dirty: state.dirty || changed });
}

/**
 * Replace the whole document's own tags (its frontmatter `tags:` entry —
 * see markdown/frontmatter.js), not any one section's. `tags` is
 * expected already-normalized (trimmed, deduped, empties dropped — see
 * ui/tagsEditor.js) since this is a plain replace, not a merge.
 */
export function setDocTags(tags) {
  if (!state.doc) return;
  const changed = JSON.stringify(tags) !== JSON.stringify(state.doc.tags || []);
  if (changed) {
    state.doc.tags = tags;
    registerTags(tags);
    setState({ doc: state.doc, dirty: true });
  }
}

export function canUndoNode(id) {
  const stack = undoStacks.get(id);
  return Boolean(stack && stack.length);
}

/** Step one section back through its own edit history (see updateNode). Returns false if there's nothing to undo. */
export function undoNode(id) {
  if (!state.doc) return false;
  const node = findNode(state.doc, id);
  if (!node) return false;
  const stack = undoStacks.get(id);
  if (!stack || !stack.length) return false;
  Object.assign(node, stack.pop());
  setState({ doc: state.doc, dirty: true });
  return true;
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
