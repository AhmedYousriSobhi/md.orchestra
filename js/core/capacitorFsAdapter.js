// Android (Capacitor) equivalent of electronFsAdapter.js — same adapter
// shape (FileSystemDirectoryHandle/FileSystemFileHandle-compatible objects),
// this time backed by @daniele-rolli/capacitor-scoped-storage, a Capacitor
// plugin wrapping Android's Storage Access Framework: the user picks a
// folder once via the native tree picker, grants persist across app
// restarts (the plugin calls takePersistableUriPermission under the hood),
// and every read/write/list call after that goes through the OS-enforced
// scope of that one folder — the mobile-native version of "only what
// you've explicitly opened," the same principle the Electron allowlist and
// the browser File System Access API both already enforce their own way.
//
// The plugin registers itself on window.Capacitor.Plugins.ScopedStorage
// (its @CapacitorPlugin(name = "ScopedStorage") annotation) rather than
// needing an ES module import — this project has no bundler, so there's no
// npm-resolution story for a bare `import ... from '@daniele-rolli/...'`
// specifier at runtime anyway; the native bridge global is the same kind of
// injected-by-the-host-runtime object window.electronFS already is.
//
// One real gap, not papered over: this plugin only offers a *folder* tree
// picker (ACTION_OPEN_DOCUMENT_TREE) — there's no single-file equivalent of
// "Open .md file" here yet. Opening a whole folder is this app's primary
// workflow anyway (see the README), so that's what this adapter covers;
// single-file picking on Android is a follow-up, not silently assumed done.
//
// Saving *does* have a real single-file story though: saveFileAs()/
// writeFileAtUri() are additions patched into the vendored plugin (see
// patches/@daniele-rolli+capacitor-scoped-storage+*.patch) wrapping
// ACTION_CREATE_DOCUMENT — Android's own "Save As" picker. Without this,
// saving a document with no live folder handle (a brand-new standalone
// file, or one opened without one) fell back to the browser-style
// anchor-download trick, which on Android silently drops the file into
// Downloads with no way to choose where it actually goes.

export const isCapacitor = typeof window !== 'undefined'
  && Boolean(window.Capacitor?.isNativePlatform?.())
  && Boolean(window.Capacitor?.Plugins?.ScopedStorage);

function plugin() {
  return window.Capacitor.Plugins.ScopedStorage;
}

function joinPath(dirPath, name) {
  return dirPath ? `${dirPath}/${name}` : name;
}

/**
 * Every call needs the *root* folder's own reference (an opaque
 * {id, name} — id is the SAF tree URI) plus a path relative to that root;
 * there's no "handle to a subfolder" on the native side the way a real
 * FileSystemDirectoryHandle carries one; the relative path is reconstructed
 * fresh on every operation instead, same as the path string
 * electronFsAdapter.js's handles already carry (just relative-to-root here
 * instead of absolute-on-disk).
 */
export function makeCapacitorFileHandle(folder, relPath, name) {
  return {
    kind: 'file',
    name,
    path: relPath,
    async getFile() {
      const { data } = await plugin().readFile({ folder, path: relPath, encoding: 'utf8' });
      return { text: async () => data };
    },
    async createWritable() {
      let buf = '';
      return {
        write: async (chunk) => { buf += chunk; },
        close: async () => {
          await plugin().writeFile({
            folder, path: relPath, data: buf, encoding: 'utf8', mimeType: 'text/markdown',
          });
        },
      };
    },
  };
}

export function makeCapacitorDirHandle(folder, relPath, name) {
  return {
    kind: 'directory',
    name,
    // The root handle's own .path needs to be a stable identity that
    // survives a relaunch (see reopenCapacitorFolder) — its relative path
    // is always '', which isn't one. Every other handle's .path is unused
    // elsewhere in this codebase (only the root's is ever read, by
    // workspaceIO.js's openDirectoryPicker), so exposing the plain
    // relative path there is harmless and arguably more useful for
    // debugging than the alternative.
    path: relPath === '' ? folder.id : relPath,
    async *entries() {
      // readdir's own path option is *optional* and must be omitted (not
      // passed as '') to list the root itself — the native side treats a
      // present-but-empty path as "path missing" and rejects the call.
      const { entries } = await plugin().readdir(relPath ? { folder, path: relPath } : { folder });
      for (const entry of entries) {
        const childPath = joinPath(relPath, entry.name);
        yield [
          entry.name,
          entry.type === 'directory'
            ? makeCapacitorDirHandle(folder, childPath, entry.name)
            : makeCapacitorFileHandle(folder, childPath, entry.name),
        ];
      }
    },
    async getFileHandle(name, opts = {}) {
      const childPath = joinPath(relPath, name);
      const { exists } = await plugin().exists({ folder, path: childPath });
      if (!exists) {
        if (opts.create) {
          // writeFile creates the file (and any missing parent
          // directories) when it doesn't exist yet — the same "ensure,
          // don't just assume" semantics electronFsAdapter.js's
          // write-file IPC handler has on the desktop side.
          await plugin().writeFile({
            folder, path: childPath, data: '', encoding: 'utf8', mimeType: 'text/markdown',
          });
          return makeCapacitorFileHandle(folder, childPath, name);
        }
        const err = new Error(`"${name}" not found`);
        err.name = 'NotFoundError';
        throw err;
      }
      return makeCapacitorFileHandle(folder, childPath, name);
    },
    async removeEntry(name) {
      await plugin().deleteFile({ folder, path: joinPath(relPath, name) });
    },
  };
}

/** The Android equivalent of window.showDirectoryPicker()/electronPickFolder() — the native SAF tree picker. Returns the root directory handle, or null if the user backed out of it. */
export async function capacitorPickFolder() {
  const { folder } = await plugin().pickFolder();
  if (!folder) return null;
  const handle = makeCapacitorDirHandle(folder, '', folder.name);
  // .path carries the persisted tree URI, the same role electronFsAdapter's
  // handles use it for (letting main.js remember/reopen a workspace across
  // launches) — Android's own OS-level grant from takePersistableUriPermission
  // already survives a relaunch on its own, so unlike the Electron desktop
  // shell's own allowlist, reopening this later needs no separate re-grant
  // IPC call at all; see reopenCapacitorFolder below.
  return handle;
}

/** Rebuilds a root directory handle for a folder granted in a *previous* launch, from its remembered {id, name} — no picker, no native call: Android's own persisted URI-permission grant (see capacitorPickFolder's comment) means the OS itself still honors it, the same trust a real file-manager app extends to a folder you've already said yes to before. */
export function reopenCapacitorFolder(id, name) {
  return makeCapacitorDirHandle({ id, name }, '', name);
}

/**
 * A file-handle-shaped object (same createWritable().write()/.close()
 * contract as makeCapacitorFileHandle) backed by a single already-granted
 * content:// URI rather than a {folder, relPath} pair — what capacitorSaveFileAs
 * returns, since a document created via ACTION_CREATE_DOCUMENT has no
 * "parent folder handle" of its own to route ordinary writeFile() calls
 * through.
 */
function makeCapacitorUriFileHandle(uri, name) {
  return {
    kind: 'file',
    name,
    path: uri,
    async createWritable() {
      let buf = '';
      return {
        write: async (chunk) => { buf += chunk; },
        close: async () => {
          await plugin().writeFileAtUri({ uri, data: buf, encoding: 'utf8' });
        },
      };
    },
  };
}

/**
 * The Android equivalent of a desktop "Save As..." dialog: the native
 * ACTION_CREATE_DOCUMENT picker, for a document with no live write handle
 * yet (a brand-new standalone file, or one opened without one). Returns a
 * handle usable exactly like any other — a *later* save through it writes
 * straight back to the now-granted URI without asking again — or `null`
 * if the user backed out of the picker.
 */
export async function capacitorSaveFileAs(suggestedName) {
  let result;
  try {
    result = await plugin().saveFileAs({ suggestedName, mimeType: 'text/markdown' });
  } catch {
    return null;
  }
  if (!result?.uri) return null;
  return makeCapacitorUriFileHandle(result.uri, result.name || suggestedName);
}

/**
 * A .md file opened via Android's own "Open with" (ACTION_VIEW) or shared
 * in from another app's "Share" sheet (ACTION_SEND) — see
 * ShareReceiverPlugin (registered directly on MainActivity, not part of
 * the vendored ScopedStorage plugin, since it's tied to the Activity's own
 * onCreate/onNewIntent lifecycle rather than filesystem access). Called
 * once on startup; consumes whatever's pending so a later, unrelated
 * relaunch never replays a stale share. Returns `null` on browser/desktop,
 * or if nothing was actually shared in.
 */
export async function capacitorTakePendingSharedFile() {
  if (typeof window === 'undefined' || !window.Capacitor?.Plugins?.ShareReceiver) return null;
  let result;
  try {
    result = await window.Capacitor.Plugins.ShareReceiver.takePendingSharedFile();
  } catch {
    return null;
  }
  if (!result?.name || result.text == null) return null;
  return { name: result.name, text: result.text };
}
