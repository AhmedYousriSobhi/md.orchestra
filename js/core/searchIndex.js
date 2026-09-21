import { readWorkspaceFileText } from './workspaceIO.js';
import { parseMarkdown } from '../markdown/parser.js';
import { buildSlugMaps } from '../markdown/slug.js';

/**
 * Per-workspace, per-file content cache powering search — lazily filled:
 * a file's text/headings/tags are only read and parsed the first time it's
 * actually searched, not eagerly when the folder is opened, matching this
 * app's existing lazy-loading model for workspace files (see
 * state/workspace.js). rootName -> Map(relPath -> { text, tags, headings }).
 */
const cache = new Map();

function workspaceCache(rootName) {
  if (!cache.has(rootName)) cache.set(rootName, new Map());
  return cache.get(rootName);
}

function indexText(text) {
  const doc = parseMarkdown(text);
  const { idToSlug } = buildSlugMaps(doc);
  const headings = [];
  (function walk(node) {
    if (node.level > 0) headings.push({ title: node.title, anchor: idToSlug.get(node.id) });
    node.children.forEach(walk);
  }(doc));
  return { text, tags: doc.tags || [], headings };
}

/** Keeps a just-saved file's cached copy in sync, so a search run right after saving doesn't turn up stale content. */
export function cacheFileText(rootName, relPath, text) {
  workspaceCache(rootName).set(relPath, indexText(text));
}

/** Forgets everything cached for a workspace — called when it's closed, so a re-opened folder of the same name starts fresh rather than replaying stale content. */
export function clearWorkspaceCache(rootName) {
  cache.delete(rootName);
}

async function getIndexed(rootName, relPath, file) {
  const wsCache = workspaceCache(rootName);
  if (wsCache.has(relPath)) return wsCache.get(relPath);
  const text = await readWorkspaceFileText(file);
  const indexed = indexText(text);
  wsCache.set(relPath, indexed);
  return indexed;
}

/** A short, single-line excerpt centered on `index`, for showing why a body match matched. */
function snippetAround(text, index, queryLen) {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + queryLen + 40);
  const middle = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + middle + (end < text.length ? '…' : '');
}

/**
 * Search one open workspace's files for `query`: filename, then heading
 * text, then tags, then full body content, in that priority order — a
 * file appears at most once, under its single best match. `files` is a
 * workspace's file entries (state/workspace.js's `files.values()`), each
 * read on demand via readWorkspaceFileText and cached for the rest of the
 * session (see module doc comment above).
 */
export async function searchWorkspace(rootName, files, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results = [];
  for (const file of files) {
    let indexed;
    try {
      indexed = await getIndexed(rootName, file.relPath, file);
    } catch {
      continue; // unreadable file (e.g. permission revoked mid-session) — skip rather than fail the whole search
    }
    const { text, tags, headings } = indexed;
    if (file.name.toLowerCase().includes(q)) {
      results.push({ rootName, relPath: file.relPath, name: file.name, matchType: 'filename', anchor: null, snippet: null });
      continue;
    }
    const matchedHeading = headings.find((h) => h.title.toLowerCase().includes(q));
    if (matchedHeading) {
      results.push({
        rootName, relPath: file.relPath, name: file.name, matchType: 'heading', anchor: matchedHeading.anchor, snippet: matchedHeading.title,
      });
      continue;
    }
    const matchedTag = tags.find((t) => t.toLowerCase().includes(q));
    if (matchedTag) {
      results.push({ rootName, relPath: file.relPath, name: file.name, matchType: 'tag', anchor: null, snippet: matchedTag });
      continue;
    }
    const bodyIndex = text.toLowerCase().indexOf(q);
    if (bodyIndex !== -1) {
      results.push({
        rootName, relPath: file.relPath, name: file.name, matchType: 'body', anchor: null, snippet: snippetAround(text, bodyIndex, q.length),
      });
    }
  }
  return results;
}
