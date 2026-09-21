/**
 * A small, tags-focused frontmatter reader/writer — not a general YAML
 * parser. YAML frontmatter (`---\n...\n---` at the very top of a file) is
 * the convention most other Markdown tools (Obsidian, Jekyll, Hugo, …)
 * already use for a file's own `tags:`, which is why it was chosen here
 * over this app's existing HTML-comment marker style (markers.js) — a
 * tagged file stays meaningful if it's ever opened somewhere else, which
 * fits "plain .md files, no lock-in" better than a marker only this app
 * understands.
 *
 * Everything in the block *other than* the `tags:` entry is kept as
 * opaque text and reproduced verbatim on save — so frontmatter written by
 * another tool (a `title:`, a `date:`, …) is never silently dropped, even
 * though this app only ever reads/writes the tags line itself.
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function unquote(raw) {
  const s = raw.trim();
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseInlineList(inner) {
  if (!inner.trim()) return [];
  return inner.split(',').map((s) => unquote(s.trim())).filter(Boolean);
}

/**
 * Splits `text` into `{ tags, otherLines, rest }`: `tags` is whatever the
 * frontmatter's `tags:` entry held (as a flat array of strings, `[]` if
 * there wasn't one), `otherLines` is every other line of the frontmatter
 * block verbatim, and `rest` is the document text after the block (or the
 * whole text, unchanged, if there was no frontmatter block at all).
 */
export function extractFrontmatter(text) {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return { tags: [], otherLines: [], rest: text };

  const lines = match[1].split('\n');
  const tags = [];
  const otherLines = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const inline = line.match(/^tags:\s*\[(.*)\]\s*$/);
    if (inline) {
      tags.push(...parseInlineList(inline[1]));
      i += 1;
      continue;
    }
    if (/^tags:\s*$/.test(line)) {
      i += 1;
      while (i < lines.length && /^\s*-\s*.+$/.test(lines[i])) {
        tags.push(unquote(lines[i].replace(/^\s*-\s*/, '')));
        i += 1;
      }
      continue;
    }
    otherLines.push(line);
    i += 1;
  }
  return { tags, otherLines, rest: text.slice(match[0].length) };
}

function quoteIfNeeded(tag) {
  return /[,[\]:#"]/.test(tag) ? `"${tag.replace(/"/g, '\\"')}"` : tag;
}

/**
 * Rebuilds a frontmatter block from a tags array and the preserved
 * "other" lines from extractFrontmatter — or '' if there's nothing worth
 * writing (no tags, and nothing else was there to begin with), so a file
 * that never used frontmatter doesn't get an empty `---\n---\n` block
 * added just because tags briefly existed and were then removed.
 */
export function buildFrontmatter(tags, otherLines) {
  const cleanOther = (otherLines || []).filter((l) => l.trim() !== '');
  const cleanTags = (tags || []).filter(Boolean);
  if (!cleanTags.length && !cleanOther.length) return '';
  const lines = ['---', ...cleanOther];
  if (cleanTags.length) lines.push(`tags: [${cleanTags.map(quoteIfNeeded).join(', ')}]`);
  lines.push('---');
  return `${lines.join('\n')}\n\n`;
}
