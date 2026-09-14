import { nextId, resetIdCounter } from '../utils/id.js';

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const FENCE_RE = /^(```+|~~~+)(.*)$/;

function makeNode(level, title) {
  return {
    id: nextId('sec'),
    level,
    title: title.trim(),
    bodyLines: [],
    children: [],
  };
}

function cleanTitle(rawTitle) {
  // Strip an optional CommonMark closing ATX sequence, e.g. "## Title ##".
  return rawTitle.replace(/\s+#+\s*$/, '').trim();
}

/**
 * Parse a Markdown document into a section tree. Every heading (any level)
 * becomes a node; `bodyMarkdown` holds that node's own raw content (verbatim,
 * fences included) up to its first child heading. The synthetic root (level 0)
 * holds any content that appears before the first heading.
 */
export function parseMarkdown(mdText) {
  resetIdCounter();
  const lines = String(mdText ?? '').replace(/\r\n/g, '\n').split('\n');
  const root = makeNode(0, 'Document');
  const stack = [root];
  let fenceMarker = null;

  for (const line of lines) {
    if (fenceMarker) {
      stack[stack.length - 1].bodyLines.push(line);
      const closeMatch = line.match(FENCE_RE);
      if (closeMatch && closeMatch[1][0] === fenceMarker[0] && closeMatch[1].length >= fenceMarker.length && closeMatch[2].trim() === '') {
        fenceMarker = null;
      }
      continue;
    }

    const fenceOpen = line.match(FENCE_RE);
    if (fenceOpen) {
      fenceMarker = fenceOpen[1];
      stack[stack.length - 1].bodyLines.push(line);
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      const node = makeNode(level, cleanTitle(heading[2]));
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else {
      stack[stack.length - 1].bodyLines.push(line);
    }
  }

  finalizeNode(root);
  return root;
}

function finalizeNode(node) {
  while (node.bodyLines.length && node.bodyLines[0].trim() === '') node.bodyLines.shift();
  while (node.bodyLines.length && node.bodyLines[node.bodyLines.length - 1].trim() === '') node.bodyLines.pop();
  node.bodyMarkdown = node.bodyLines.join('\n');
  delete node.bodyLines;
  node.children.forEach(finalizeNode);
}

export function findNode(root, id) {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export function findParent(root, id) {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

/** Path of nodes from the root (exclusive) down to and including `id`. */
export function getPath(root, id) {
  const path = [];
  function walk(node, trail) {
    const nextTrail = node.level > 0 ? [...trail, node] : trail;
    if (node.id === id) {
      path.push(...nextTrail);
      return true;
    }
    return node.children.some((c) => walk(c, nextTrail));
  }
  walk(root, []);
  return path;
}

/** Index of `id`'s top-level (root.children) ancestor, or -1 if not found. */
export function getTopLevelIndex(root, id) {
  const path = getPath(root, id);
  if (!path.length) return -1;
  return root.children.findIndex((c) => c.id === path[0].id);
}

export function countDescendants(node) {
  let count = 0;
  for (const child of node.children) count += 1 + countDescendants(child);
  return count;
}
