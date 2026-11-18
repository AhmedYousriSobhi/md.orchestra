import { buildFrontmatter } from './frontmatter.js';

/**
 * The normalizing serializer: each node's raw `bodyMarkdown` is reproduced
 * verbatim, but heading lines are regenerated from level + title and the
 * spacing between blocks is normalized to one blank line (see below for why
 * serializeMarkdown() doesn't always use this output as-is).
 */
export function serializeNormalized(root) {
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
  const frontmatter = buildFrontmatter(root.tags, root.frontmatterOtherLines);
  return frontmatter + blocks.join('\n\n').trim() + '\n';
}

/**
 * Turn a section tree back into a single Markdown string.
 *
 * Opening and re-saving a file you didn't touch must reproduce it
 * byte-for-byte (SPEC 'Data guarantees'), but the tree itself is normalized
 * at parse time (headings regenerated, blank lines between blocks collapsed,
 * CRLF folded to LF, ...). So parseMarkdown() remembers the original text
 * plus what the normalizing serializer produced for the freshly parsed tree
 * (`root.source`, non-enumerable so it never shows up in comparisons or
 * clones). If the tree still serializes to exactly that, nothing was edited
 * and the original text is returned verbatim — also after an undo back to
 * the original. Once something has been edited, the normalized output is
 * used, but keeps the file's own line endings and final-newline state so a
 * one-section edit doesn't also rewrite every line ending in the file.
 */
export function serializeMarkdown(root) {
  const normalized = serializeNormalized(root);
  const source = root.source;
  if (!source) return normalized;
  if (normalized === source.normalized) return source.text;
  let out = normalized;
  if (!source.endsWithNewline) out = out.replace(/\n$/, '');
  if (source.eol === '\r\n') out = out.replace(/\n/g, '\r\n');
  return out;
}
