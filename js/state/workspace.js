// A "workspace" is a directory of Markdown files opened together: a flat
// registry of every file found (keyed by its path relative to the chosen
// folder), plus a nested folder/file tree built from those paths for the
// sidebar. It deliberately does NOT hold parsed documents or raw text for
// every file — only the file-loading entry {relPath, name, fileHandle,
// webkitFile} from workspaceIO.js. Opening a file from the tree re-reads it
// on demand and runs it through the exact same single-document pipeline
// (parseMarkdown / store.loadDocument) every other entry point already
// uses, so nothing about editing, saving, or the unsaved-changes guard
// needs to know a workspace is even involved.
//
// More than one can be open at once — each directory keeps its own
// identity (files, tree) independently, the same way a VSCode multi-root
// workspace does, keyed by its own root folder name. Every active-document
// identity elsewhere (recovery snapshots, the link index) already carries
// that same rootName alongside a relPath specifically so two open folders
// can never be confused for one another, even if a file at the same
// relative path exists in both.
//
// No pub/sub of its own: every change here (addWorkspace/removeWorkspace)
// only ever happens right before loading a document into state/store.js,
// whose own subscribers already re-render on every such change — so
// main.js just reads getWorkspaces() fresh whenever that fires.
const workspaces = new Map(); // rootName -> { rootName, files: Map, tree }

export function getWorkspaces() {
  return [...workspaces.values()];
}

export function getWorkspace(rootName) {
  return workspaces.get(rootName) || null;
}

export function hasWorkspaces() {
  return workspaces.size > 0;
}

function buildTree(files) {
  const root = {
    name: '', path: '', type: 'dir', children: [],
  };
  const dirIndex = new Map([['', root]]);

  function dirFor(path) {
    if (dirIndex.has(path)) return dirIndex.get(path);
    const segments = path.split('/');
    const name = segments[segments.length - 1];
    const parentPath = segments.slice(0, -1).join('/');
    const parent = dirFor(parentPath);
    const node = {
      name, path, type: 'dir', children: [],
    };
    parent.children.push(node);
    dirIndex.set(path, node);
    return node;
  }

  files.forEach((file) => {
    const segments = file.relPath.split('/');
    const dirPath = segments.slice(0, -1).join('/');
    dirFor(dirPath).children.push({ name: file.name, path: file.relPath, type: 'file' });
  });

  function sortDir(node) {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach((c) => { if (c.type === 'dir') sortDir(c); });
  }
  sortDir(root);
  return root;
}

/** Add a newly-opened folder alongside whatever's already open. Opening the same rootName again (re-picking the same folder) just refreshes its file list in place rather than duplicating it. */
export function addWorkspace({ rootName, files }) {
  workspaces.set(rootName, {
    rootName,
    files: new Map(files.map((f) => [f.relPath, f])),
    tree: buildTree(files),
  });
}

export function removeWorkspace(rootName) {
  workspaces.delete(rootName);
}

export function getWorkspaceFile(rootName, relPath) {
  return workspaces.get(rootName)?.files.get(relPath) || null;
}

function normalizeSegments(segments) {
  const out = [];
  segments.forEach((seg) => {
    if (seg === '' || seg === '.') return;
    if (seg === '..') out.pop();
    else out.push(seg);
  });
  return out;
}

/**
 * Resolve an <a href="..."> found while rendering `fromRelPath` (a file in
 * the `rootName` workspace) against that same workspace only — a link
 * never crosses into a *different* open folder, since a relative path has
 * no way to name one. Ignores same-page "#anchor" links, absolute URLs
 * (http:, mailto:, //host/...), and anything that isn't a .md/.markdown
 * target; normalizes "./" and "../" relative to fromRelPath's own
 * directory. Returns { relPath, anchor } only when that normalized path is
 * actually a file in this workspace (so a dead link, or one pointing
 * outside the opened folder, is simply left alone by the caller).
 */
export function resolveWorkspaceLink(rootName, fromRelPath, href) {
  const workspace = workspaces.get(rootName);
  if (!workspace || !href || href.startsWith('#')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null;

  const hashIndex = href.indexOf('#');
  const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const anchor = hashIndex === -1 ? null : decodeURIComponent(href.slice(hashIndex + 1));
  if (!pathPart || !/\.(md|markdown)$/i.test(pathPart)) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    decoded = pathPart;
  }

  const fromDir = fromRelPath.split('/').slice(0, -1);
  const baseSegments = decoded.startsWith('/') ? [] : fromDir;
  const relPath = normalizeSegments([...baseSegments, ...decoded.split('/')]).join('/');

  return workspace.files.has(relPath) ? { relPath, anchor } : null;
}
