const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');

// Every folder/file path the user has explicitly picked (via the native
// dialog), plus everything under it — the desktop-app equivalent of the
// browser File System Access API's own "only what you granted" scoping.
// A renderer that only ever talks to the main process through the narrow
// IPC surface in preload.js has no way to name a path outside this list;
// every handler below re-checks it regardless, so a bug anywhere in the
// renderer can't turn into arbitrary filesystem access.
const allowlist = [];

function isAllowed(targetPath) {
  const resolved = path.resolve(targetPath);
  return allowlist.some((entry) => {
    const root = path.resolve(entry.path);
    if (entry.type === 'file') return resolved === root;
    return resolved === root || resolved.startsWith(root + path.sep);
  });
}

function allow(type, targetPath) {
  allowlist.push({ type, path: targetPath });
}

function assertAllowed(targetPath) {
  if (!isAllowed(targetPath)) {
    throw new Error(`Not allowed: "${targetPath}" is outside every folder/file you've opened.`);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'index.html'));

  // js/main.js's own beforeunload guard shows a browser tab's native "leave
  // site?" prompt when the active document has unsaved changes — a
  // mechanism that doesn't carry over to a BrowserWindow's own close
  // button: Chromium still runs beforeunload and still blocks the unload,
  // but nothing here was telling *Electron* to then show a real dialog and
  // actually decide whether to proceed, so clicking the window's own ✕
  // just silently did nothing every time the guard fired. This intercepts
  // the window's close directly instead: ask the page (a plain
  // executeJavaScript call reaches into it regardless of contextIsolation,
  // same as devtools would) whether it's dirty, and only *then* show a
  // real native confirm — closing for real if the user confirms (or if
  // there was nothing unsaved to begin with), leaving the window open on
  // Cancel.
  let confirmedClose = false;
  win.on('close', (e) => {
    if (confirmedClose) return;
    e.preventDefault();
    win.webContents.executeJavaScript('window.__mdOrchestraIsDirty ? window.__mdOrchestraIsDirty() : false')
      .then((isDirty) => {
        if (!isDirty) {
          confirmedClose = true;
          win.close();
          return;
        }
        const choice = dialog.showMessageBoxSync(win, {
          type: 'question',
          buttons: ['Quit', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          message: 'This file has unsaved changes.',
          detail: 'Quitting now will lose them. Quit anyway?',
        });
        if (choice === 0) {
          confirmedClose = true;
          win.close();
        }
      })
      .catch(() => {
        // The page failed to answer (e.g. it's already gone) — err toward
        // actually closing rather than leaving the window stuck forever.
        confirmedClose = true;
        win.close();
      });
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths.length) return null;
  const [folderPath] = result.filePaths;
  allow('dir', folderPath);
  return { path: folderPath, name: path.basename(folderPath) };
});

ipcMain.handle('pick-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const [filePath] = result.filePaths;
  allow('file', filePath);
  const text = await fs.readFile(filePath, 'utf-8');
  return { path: filePath, name: path.basename(filePath), text };
});

/** Every entry directly inside `dirPath`, unfiltered — js/core/workspaceIO.js's own recursive walk already skips dotfiles and non-Markdown files exactly the way it does for the browser API's real FileSystemDirectoryHandle.entries(), so that filtering isn't duplicated here. */
ipcMain.handle('read-dir', async (event, dirPath) => {
  assertAllowed(dirPath);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.map((e) => ({ name: e.name, kind: e.isDirectory() ? 'directory' : 'file' }));
});

ipcMain.handle('read-file', async (event, filePath) => {
  assertAllowed(filePath);
  return fs.readFile(filePath, 'utf-8');
});

ipcMain.handle('write-file', async (event, filePath, content) => {
  assertAllowed(filePath);
  await fs.writeFile(filePath, content, 'utf-8');
});

ipcMain.handle('exists', async (event, targetPath) => {
  assertAllowed(targetPath);
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('delete-file', async (event, filePath) => {
  assertAllowed(filePath);
  await fs.unlink(filePath);
});

/**
 * Reopening the last-used folder on launch (see js/main.js) needs it back
 * in the allowlist before any read-dir/read-file call for it can succeed —
 * the renderer remembers the *path* (in localStorage, like every other
 * preference), but the allowlist itself is main-process, in-memory state
 * that a fresh launch starts empty. This re-grants it without a fresh
 * dialog prompt, the same trust a real desktop app extends to a workspace
 * you've already explicitly opened before.
 */
ipcMain.handle('reallow-folder', async (event, folderPath) => {
  allow('dir', folderPath);
});
