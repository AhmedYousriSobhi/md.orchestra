import { resolveWorkspaceLink } from './workspace.js';
import { readWorkspaceFileText } from '../workspaceIO.js';
import { parseMarkdown } from '../markdown/parser.js';

// A session-scoped, best-effort map of outgoing cross-file Markdown links
// between workspace files — relPath -> Set<relPath> it links to. Built
// opportunistically (for free) from whichever files actually get opened
// during this session, since their content is already being parsed anyway
// at that point — see recordLinksFor, called from main.js's loadFromText.
// This deliberately never scans the rest of the workspace on its own,
// matching state/workspace.js's own lazy design (a workspace only ever
// holds lightweight {relPath, name, fileHandle} entries, never every
// file's parsed content up front). Full backlink coverage — knowing every
// file that links to a given one, not just the ones visited so far — needs
// indexWorkspaceLinks() below, which is the one place this module actually
// reads file contents on its own, and only when explicitly asked to.
let outgoing = new Map(); // relPath -> Set<relPath>
let indexedPaths = new Set(); // relPaths whose outgoing links are currently known

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
 * `relPath`) actually contains, resolved against the open workspace —
 * same-page anchors and links outside the workspace are silently dropped
 * (resolveWorkspaceLink already handles that). Safe to call repeatedly
 * (every time the file is opened or edited): always replaces this file's
 * prior entry outright rather than accumulating stale links from before an
 * edit removed one.
 */
export function recordLinksFor(relPath, doc) {
  const hrefs = [];
  collectHrefs(doc, hrefs);
  const targets = new Set();
  hrefs.forEach((href) => {
    const resolved = resolveWorkspaceLink(relPath, href);
    if (resolved && resolved.relPath !== relPath) targets.add(resolved.relPath);
  });
  outgoing.set(relPath, targets);
  indexedPaths.add(relPath);
}

/** Whether `relPath`'s own outgoing links are currently known (it's been opened this session, or covered by a deep scan) — getIncomingLinks() is only ever as complete as this. */
export function isIndexed(relPath) {
  return indexedPaths.has(relPath);
}

export function getOutgoingLinks(relPath) {
  return outgoing.get(relPath) || new Set();
}

/** Every currently-indexed file that links TO `relPath`. Best-effort: only reflects files whose own outgoing links are already known — a file nobody's opened yet and that hasn't been swept by indexWorkspaceLinks() simply isn't counted, even if it does link here. */
export function getIncomingLinks(relPath) {
  const result = new Set();
  outgoing.forEach((targets, from) => { if (targets.has(relPath)) result.add(from); });
  return result;
}

/** A fresh workspace has nothing in common with the last one's link graph. */
export function clearLinkIndex() {
  outgoing = new Map();
  indexedPaths = new Set();
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
        recordLinksFor(entry.relPath, parseMarkdown(text));
      } catch {
        indexedPaths.add(entry.relPath);
      }
    }));
    if (onProgress) onProgress(Math.min(i + BATCH_SIZE, total), total);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }
}
