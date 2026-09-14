import { buildSlugMaps } from './slug.js';

const TOC_TITLE_RE = /table of contents|^toc$/i;

/** Heuristic: does this heading's title look like it's meant to hold a Table of Contents? */
export function looksLikeTocSection(node) {
  return TOC_TITLE_RE.test((node.title || '').trim());
}

/**
 * Build a nested Markdown bullet list of every heading in the document
 * (in order, indented by structural depth), each linking to the anchor
 * GitHub itself would generate for it. `excludeId` (typically the ToC
 * section's own id) is skipped, along with its own children, so a Table of
 * Contents never lists itself.
 */
export function generateTocMarkdown(doc, { excludeId } = {}) {
  const { idToSlug } = buildSlugMaps(doc);
  const lines = [];

  function walk(nodes, depth) {
    nodes.forEach((node) => {
      if (node.id === excludeId) return;
      const slug = idToSlug.get(node.id);
      lines.push(`${'  '.repeat(depth)}- [${node.title}](#${slug})`);
      walk(node.children, depth + 1);
    });
  }
  walk(doc.children, 0);
  return lines.join('\n');
}
