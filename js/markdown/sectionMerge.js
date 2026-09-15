// Building blocks for saving or discarding ONE changed section (see
// diff.js's findChangedNodes) at a time, rather than a whole file's pending
// edits at once — the Changes panel now offers a save/discard action per
// listed section, not just per file (see ui/changesPanel.js).
//
// Same position-based matching as diff.js, and the same caveat: a node's id
// isn't comparable between two independent parseMarkdown() calls, so
// "the same section" between a base tree and an edited one is identified by
// walking both by child index instead. That lines up correctly in the
// overwhelmingly common case (one or a few sections edited, nothing
// reordered), which is all this needs to handle.

function cloneNode(node) {
  return { ...node, children: node.children.map(cloneNode) };
}

/** Path of child-indices from `root` down to the node with `targetId` — e.g. [2, 0] means root.children[2].children[0]. Null if not found. */
function locatePath(root, targetId, path = []) {
  if (root.id === targetId) return path;
  for (let i = 0; i < root.children.length; i += 1) {
    const found = locatePath(root.children[i], targetId, [...path, i]);
    if (found) return found;
  }
  return null;
}

function getAtPath(root, path) {
  let node = root;
  for (const idx of path) {
    if (!node || !node.children[idx]) return null;
    node = node.children[idx];
  }
  return node;
}

function getParentAtPath(root, path) {
  let node = root;
  for (let i = 0; i < path.length - 1; i += 1) node = node.children[path[i]];
  return node;
}

/**
 * The Markdown for saving just one section's change to disk while leaving
 * every OTHER pending section's edit untouched there: a clone of `baseDoc`
 * (the file's current on-disk content) with only the section at `sectionId`
 * (an id from `editedDoc`) replaced by its edited version. A brand-new
 * section (one `baseDoc` doesn't have at that position at all) is inserted
 * rather than overwritten. Returns null if `sectionId` isn't in `editedDoc`.
 */
export function applySectionToBase(baseDoc, editedDoc, sectionId) {
  const path = locatePath(editedDoc, sectionId);
  if (!path) return null;
  const editedNode = getAtPath(editedDoc, path);
  const merged = cloneNode(baseDoc);
  const baseNode = getAtPath(merged, path);
  if (baseNode) {
    baseNode.title = editedNode.title;
    baseNode.bodyMarkdown = editedNode.bodyMarkdown;
  } else {
    const parent = getParentAtPath(merged, path);
    if (!parent) return null;
    parent.children.splice(path[path.length - 1], 0, cloneNode(editedNode));
  }
  return merged;
}

/**
 * The inverse: the document for discarding just one pending section's
 * change, reverting it back to `baseDoc`'s version while leaving every
 * OTHER pending edit in `editedDoc` intact. A section `baseDoc` doesn't
 * have at all (newly added, never saved) is removed outright rather than
 * left half-reverted. Returns null if `sectionId` isn't in `editedDoc`.
 */
export function revertSectionToBase(baseDoc, editedDoc, sectionId) {
  const path = locatePath(editedDoc, sectionId);
  if (!path) return null;
  const baseNode = getAtPath(baseDoc, path);
  const reverted = cloneNode(editedDoc);
  if (baseNode) {
    const node = getAtPath(reverted, path);
    node.title = baseNode.title;
    node.bodyMarkdown = baseNode.bodyMarkdown;
  } else {
    const parent = getParentAtPath(reverted, path);
    if (!parent) return null;
    parent.children.splice(path[path.length - 1], 1);
  }
  return reverted;
}
