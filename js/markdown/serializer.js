/**
 * Turn a section tree back into a single Markdown string. Each node's raw
 * `bodyMarkdown` (main content + marker-wrapped AI insert / note, see
 * markers.js) is reproduced verbatim; only heading lines are regenerated
 * from level + title and inter-block spacing is normalized to one blank
 * line. This is a faithful re-serialization, not a byte-for-byte one:
 * untouched documents keep their content and structure, but incidental
 * whitespace between blocks is normalized.
 */
export function serializeMarkdown(root) {
  const blocks = [];

  function walk(node) {
    if (node.level > 0) {
      blocks.push(`${'#'.repeat(node.level)} ${node.title.trim()}`);
      if (node.bodyMarkdown && node.bodyMarkdown.trim()) blocks.push(node.bodyMarkdown.trim());
    } else if (node.bodyMarkdown && node.bodyMarkdown.trim()) {
      blocks.push(node.bodyMarkdown.trim());
    }
    node.children.forEach(walk);
  }

  walk(root);
  return blocks.join('\n\n').trim() + '\n';
}
