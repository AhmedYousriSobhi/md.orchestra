// Wraps the electron/preload.js IPC bridge in objects shaped exactly like
// the browser's own FileSystemDirectoryHandle/FileSystemFileHandle (same
// method names, same NotFoundError-named throw on a missing entry) — so
// workspaceIO.js's existing logic (the recursive collector,
// createFileInDirectory, uniqueFileNameIn, deleteFileFromDirectory) works
// completely unchanged against a real absolute path, backed by Node's own
// fs in the main process, instead of the browser API. Proven shape: this
// mirrors the Playwright test mock (fakefs.js) already used to validate
// the Explorer's Delete/Copy/Paste/Add-file work against a fake handle
// tree — an Electron-backed handle is just a real one instead of a fake.

export const isElectron = typeof window !== 'undefined' && Boolean(window.electronFS);

function joinPath(dirPath, name) {
  return dirPath ? `${dirPath}/${name}` : name;
}

export function makeElectronFileHandle(absPath, name) {
  return {
    kind: 'file',
    name,
    path: absPath,
    async getFile() {
      const text = await window.electronFS.readFile(absPath);
      return { text: async () => text };
    },
    async createWritable() {
      let buf = '';
      return {
        write: async (chunk) => { buf += chunk; },
        close: async () => { await window.electronFS.writeFile(absPath, buf); },
      };
    },
  };
}

export function makeElectronDirHandle(absPath, name) {
  return {
    kind: 'directory',
    name,
    path: absPath,
    async *entries() {
      const children = await window.electronFS.readDir(absPath);
      for (const child of children) {
        const childPath = joinPath(absPath, child.name);
        yield [
          child.name,
          child.kind === 'directory'
            ? makeElectronDirHandle(childPath, child.name)
            : makeElectronFileHandle(childPath, child.name),
        ];
      }
    },
    async getFileHandle(name, opts = {}) {
      const filePath = joinPath(absPath, name);
      const exists = await window.electronFS.exists(filePath);
      if (!exists) {
        if (opts.create) {
          await window.electronFS.writeFile(filePath, '');
          return makeElectronFileHandle(filePath, name);
        }
        const err = new Error(`"${name}" not found`);
        err.name = 'NotFoundError';
        throw err;
      }
      return makeElectronFileHandle(filePath, name);
    },
    async removeEntry(name) {
      await window.electronFS.deleteFile(joinPath(absPath, name));
    },
  };
}

/** The Electron equivalent of the browser's window.showDirectoryPicker() — a native OS dialog, but backed by a real, persistent path rather than a per-session permission grant. Returns the root directory handle, or null if the user cancelled. */
export async function electronPickFolder() {
  const picked = await window.electronFS.pickFolder();
  if (!picked) return null;
  return makeElectronDirHandle(picked.path, picked.name);
}

/**
 * Re-opens a folder the user picked in a *previous* launch, by its
 * remembered absolute path (see js/main.js) — no dialog, since they
 * already granted access to it before. The main process's own allowlist
 * (electron/main.js) is in-memory and starts empty on every launch, so it
 * needs to be told about this path again before any read-dir/read-file
 * call for it can succeed; a real desktop app extends that same trust to
 * a workspace you've already explicitly opened, the way VSCode reopens
 * your last workspace without re-prompting for folder access.
 */
export async function electronReopenFolder(path, name) {
  await window.electronFS.reallowFolder(path);
  return makeElectronDirHandle(path, name);
}

/** The Electron equivalent of window.showOpenFilePicker() — returns { path, name, text, fileHandle }, or null if cancelled. */
export async function electronPickFile() {
  const picked = await window.electronFS.pickFile();
  if (!picked) return null;
  return {
    path: picked.path,
    name: picked.name,
    text: picked.text,
    fileHandle: makeElectronFileHandle(picked.path, picked.name),
  };
}
