import { splitBody } from './markers.js';

/**
 * Total length of a document's own readable content (every node's "main"
 * body, marker-stripped — see markers.js splitBody) plus how many actual
 * headings it has. Used to decide whether a hierarchical, per-section
 * breakdown is worth the fragmentation it costs a short document, or
 * whether there's nothing meaningful to split in the first place — see
 * ui/docViewMode.js.
 */
export function computeDocStats(root) {
  let totalChars = 0;
  let headingCount = 0;
  function walk(node) {
    totalChars += splitBody(node.bodyMarkdown).main.length;
    if (node.level > 0) headingCount += 1;
    node.children.forEach(walk);
  }
  walk(root);
  return { totalChars, headingCount };
}
