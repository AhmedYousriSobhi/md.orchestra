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

/**
 * Splice a brand-new section node into the tree as a child of `parentId`
 * (which may be the document root itself), at the start or end of its
 * existing children. Unlike updateNode this is a structural change — used
 * for authoring whole new sections, not annotating an existing one.
 */
export function insertSection({ parentId, node, position = 'end' }) {
  if (!state.doc) return false;
  const parent = findNode(state.doc, parentId);
  if (!parent) return false;
  if (position === 'start') parent.children.unshift(node);
  else parent.children.push(node);
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
