export const supportsDirectoryPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

const MD_RE = /\.(md|markdown)$/i;

/**
 * Walk a FileSystemDirectoryHandle (Chromium's File System Access API) and
 * collect every Markdown file, keeping a live handle on each one so it can
 * be saved back in place later — the same guarantee "Open .md file" already
 * gives for a single file. Hidden entries (dotfiles/dotfolders — .git,
 * .obsidian, etc.) are skipped; there's no size cap here (a documentation
 * directory should be small enough that this is fine), but the caller can
 * decide to warn on huge results.
 */
async function collectFromDirectoryHandle(dirHandle, prefix = '', dirHandles) {
  const files = [];
  dirHandles.set(prefix, dirHandle);
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue;
    const relPath = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      files.push(...await collectFromDirectoryHandle(handle, relPath, dirHandles));
    } else if (MD_RE.test(name)) {
      files.push({
        relPath, name, fileHandle: handle, webkitFile: null,
      });
    }
  }
  return files;
}

/**
 * Chromium/Edge path: a native folder picker with live read/write handles.
 * `dirHandles` (relDirPath -> FileSystemDirectoryHandle, the root itself
 * keyed by '') is what makes creating/deleting/copying files possible
 * later (see createFileInDirectory/deleteFileFromDirectory below) — a
 * capability the webkitdirectory fallback below can never offer, since it
 * only ever gets plain File objects, never a directory handle to write
 * through.
 */
export async function openDirectoryPicker() {
  if (!supportsDirectoryPicker) return null;
  const dirHandle = await window.showDirectoryPicker();
  const dirHandles = new Map();
  const files = await collectFromDirectoryHandle(dirHandle, '', dirHandles);
  return { rootName: dirHandle.name, files, dirHandles };
}

/**
 * Fallback for browsers without showDirectoryPicker (notably Firefox): an
 * <input type="file" webkitdirectory multiple> gives a flat FileList where
 * each File carries its path via .webkitRelativePath, *including* the
 * chosen folder's own name as its first segment (e.g.
 * "my-docs/sub/guide.md") — unlike the FSA path above, whose relPaths are
 * already relative to the folder you picked. Stripped here so both paths
 * produce the same shape (relPath never includes the workspace root name
 * itself), which is what the folder tree and link resolution assume. There's
 * no live handle in this fallback, so files picked this way can only be
 * saved by download — same trade-off "Open .md file" already makes on a
 * browser without the File System Access API.
 */
export function workspaceFromFileList(fileList) {
  const files = [];
  let rootName = '';
  Array.from(fileList).forEach((file) => {
    if (!MD_RE.test(file.name)) return;
    const rel = file.webkitRelativePath || file.name;
    const segments = rel.split('/');
    if (!rootName && segments.length > 1) [rootName] = segments;
    files.push({
      relPath: segments.length > 1 ? segments.slice(1).join('/') : rel,
      name: file.name,
      fileHandle: null,
      webkitFile: file,
    });
  });
  return { rootName, files };
}

export async function readWorkspaceFileText(entry) {
  if (entry.fileHandle) return (await entry.fileHandle.getFile()).text();
  if (entry.webkitFile) return entry.webkitFile.text();
  throw new Error('No readable handle for this file.');
}

async function fileExistsIn(dirHandle, fileName) {
  try {
    await dirHandle.getFileHandle(fileName);
    return true;
  } catch (err) {
    if (err.name === 'NotFoundError') return false;
    throw err;
  }
}

/** Create a brand-new Markdown file inside `dirHandle`. Refuses to silently overwrite an existing one — `getFileHandle(name, {create: true})` alone would happily hand back the existing file instead of failing. */
export async function createFileInDirectory(dirHandle, fileName, initialText = '') {
  if (await fileExistsIn(dirHandle, fileName)) {
    throw new Error(`"${fileName}" already exists here.`);
  }
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(initialText);
  await writable.close();
  return fileHandle;
}

