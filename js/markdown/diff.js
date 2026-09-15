// Structural diffing between two parses of "the same" document — typically
// a dirty in-memory doc and its crash-recovery snapshot's own baseline
// (the content this editing session started from). Node ids can't be
// compared directly between them: each comes from its own independent
// parseMarkdown() call, so the ids are unrelated numbers. But the two
// trees are the same document just before and after some edits, so
// walking them together by position — same index at each level — almost
// always lines corresponding headings up correctly, even though nothing
// about the id values themselves is shared.

/**
 * Every node (in reading order) whose own bodyMarkdown differs between
 * `newNode`'s tree and the equivalent position in `oldNode`'s, or that's
 * newly added (no corresponding old position at all) — one entry per
 * *section*, not per file, so two independently-edited sections in the
 * same document are reported as two separate changes. Skips the synthetic
 * level-0 root's own entry (there's nothing to "jump to" for the whole
 * document) but still walks into its children. Returns
 * [{ id, title, level }], `out` accumulates across the recursion.
 */
export function findChangedNodes(newNode, oldNode, out = []) {
  if (!newNode) return out;
  const bodyChanged = !oldNode || (newNode.bodyMarkdown || '').trim() !== (oldNode.bodyMarkdown || '').trim();
  if (newNode.level > 0 && bodyChanged) {
    out.push({ id: newNode.id, title: newNode.title || '(untitled)', level: newNode.level });
  }
  const oldChildren = oldNode ? oldNode.children : [];
  newNode.children.forEach((child, i) => findChangedNodes(child, oldChildren[i], out));
  return out;
}
