import { resolveWorkspaceLink } from './workspace.js';
import { readWorkspaceFileText } from '../core/workspaceIO.js';
import { parseMarkdown } from '../markdown/parser.js';

// A session-scoped, best-effort map of outgoing cross-file Markdown links
// between workspace files — key -> Set<key> it links to, where key is
// `${rootName}::${relPath}` (several workspaces can be open at once, and a
// relPath is only unique within its own one). Built opportunistically (for
// free) from whichever files actually get opened during this session,
// since their content is already being parsed anyway at that point — see
// recordLinksFor, called from main.js's loadFromText. This deliberately
// never scans the rest of a workspace on its own, matching
// state/workspace.js's own lazy design (a workspace only ever holds
// lightweight {relPath, name, fileHandle} entries, never every file's
// parsed content up front). Full backlink coverage — knowing every file
// that links to a given one, not just the ones visited so far — needs
// indexWorkspaceLinks() below, which is the one place this module actually
// reads file contents on its own, and only when explicitly asked to.
let outgoing = new Map(); // key -> Set<key>
let indexedKeys = new Set(); // keys whose outgoing links are currently known

function keyFor(rootName, relPath) {
  return `${rootName}::${relPath}`;
}

// Deliberately simple (not a full CommonMark link parser): matches
// `[text](target)`, with an optional title, same as every other
// hand-rolled pattern in this codebase (see markdown/parser.js's own
// heading/fence regexes) — good enough for finding links to other
// Markdown files, not meant to handle every edge case inline code or a
// literal `](` in link text could produce.
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function extractHrefs(bodyMarkdown) {
  const hrefs = [];
  let match;
  LINK_RE.lastIndex = 0;
  while ((match = LINK_RE.exec(bodyMarkdown || ''))) hrefs.push(match[1]);
  return hrefs;
}

function collectHrefs(node, hrefs) {
  hrefs.push(...extractHrefs(node.bodyMarkdown));
  node.children.forEach((child) => collectHrefs(child, hrefs));
}

/**
 * Record every outgoing cross-file link `doc` (the just-parsed content of
 * `relPath`, within the `rootName` workspace) actually contains, resolved
 * against that same workspace — same-page anchors, links outside it, and
 * links to a *different* open workspace (there's no such thing — a
 * relative path can't name one) are silently dropped (resolveWorkspaceLink
 * already handles that). Safe to call repeatedly (every time the file is
 * opened or edited): always replaces this file's prior entry outright
 * rather than accumulating stale links from before an edit removed one.
 */
export function recordLinksFor(rootName, relPath, doc) {
  const hrefs = [];
  collectHrefs(doc, hrefs);
  const targets = new Set();
  hrefs.forEach((href) => {
    const resolved = resolveWorkspaceLink(rootName, relPath, href);
    if (resolved && resolved.relPath !== relPath) targets.add(keyFor(rootName, resolved.relPath));
  });
  outgoing.set(keyFor(rootName, relPath), targets);
  indexedKeys.add(keyFor(rootName, relPath));
}

/** Whether `relPath`'s own outgoing links (within `rootName`) are currently known (it's been opened this session, or covered by a deep scan) — getIncomingLinks() is only ever as complete as this. */
export function isIndexed(rootName, relPath) {
  return indexedKeys.has(keyFor(rootName, relPath));
}

export function getOutgoingLinks(rootName, relPath) {
  const targets = outgoing.get(keyFor(rootName, relPath)) || new Set();
  return new Set([...targets].map((key) => key.slice(rootName.length + 2)));
}

/** Every currently-indexed file (within `rootName`) that links TO `relPath`. Best-effort: only reflects files whose own outgoing links are already known — a file nobody's opened yet and that hasn't been swept by indexWorkspaceLinks() simply isn't counted, even if it does link here. */
export function getIncomingLinks(rootName, relPath) {
  const target = keyFor(rootName, relPath);
  const result = new Set();
  outgoing.forEach((targets, from) => {
    if (from.startsWith(`${rootName}::`) && targets.has(target)) result.add(from.slice(rootName.length + 2));
  });
  return result;
}

/** Forget everything tracked for one closed workspace, leaving every other open one's link graph untouched. */
export function clearLinkIndex(rootName) {
  const prefix = `${rootName}::`;
  [...outgoing.keys()].filter((k) => k.startsWith(prefix)).forEach((k) => outgoing.delete(k));
  [...indexedKeys].filter((k) => k.startsWith(prefix)).forEach((k) => indexedKeys.delete(k));
}

/**
 * Read and scan every not-yet-indexed file in `workspace` for outgoing
 * links, for full backlink coverage — the one place this module does I/O
 * on its own, and only when a caller explicitly asks (never automatically,
 * unlike recordLinksFor's free ride on files already being opened). Always
 * re-reads every file, even ones already indexed — deliberately not an
 * incremental "only fill in the gaps" scan: a file already indexed once
 * can still have picked up new links since (edited and saved without ever
 * being reopened, which is the common case for whatever's currently the
 * active document), and this is the one place that can catch that, since
 * nothing else re-syncs an already-known file's links after its first
 * open. Processes in small batches with a yield between them so a large
 * workspace doesn't freeze the UI; `onProgress(done, total)` fires after
 * each batch. A file that fails to read is marked indexed anyway (with no
 * known links) so a scan doesn't retry it forever.
 */
export async function indexWorkspaceLinks(workspace, onProgress) {
  const entries = [...workspace.files.values()];
  const total = entries.length;
  const BATCH_SIZE = 8;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(batch.map(async (entry) => {
      try {
        const text = await readWorkspaceFileText(entry);
        recordLinksFor(workspace.rootName, entry.relPath, parseMarkdown(text));
      } catch {
        indexedKeys.add(keyFor(workspace.rootName, entry.relPath));
      }
    }));
    if (onProgress) onProgress(Math.min(i + BATCH_SIZE, total), total);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }
}
