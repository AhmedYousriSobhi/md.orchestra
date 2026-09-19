const {
  app, BrowserWindow, dialog, ipcMain,
} = require('electron');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');

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

// ---------------------------------------------------------------------
// Atomic file writes: temp file in the same directory -> fsync it ->
// rename over the target -> fsync the directory. A plain fs.writeFile()
// opens the existing file, truncates it, then streams the new bytes in —
// a crash (SIGKILL, power loss, a full disk) between the truncate and the
// write completing leaves the file shorter than either version, not the
// old one and not the new one. POSIX rename() is atomic, so a crash at any
// point before it leaves the real file byte-for-byte untouched (with at
// worst a harmless, unpublished .tmp-* file next to it); a crash after it
// is indistinguishable from a normal save. The directory fsync matters
// too: the rename isn't guaranteed durable on disk until the directory
// entry pointing at it is flushed, not just the file's own data.
// ---------------------------------------------------------------------
async function atomicWriteFile(filePath, content) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp-${crypto.randomBytes(8).toString('hex')}`);
  // rename() replaces the target's inode (and therefore its permission
  // bits) with the temp file's — so without this, every save through here
  // would silently narrow an existing file from whatever it actually was
  // (e.g. group/other-readable) down to whatever the temp file happened to
  // be created with, which fs.writeFile()'s in-place open+truncate never
  // did. Match the file's current mode when it already exists; a brand
  // new file gets a normal, non-secretive default.
  const existingMode = await fs.stat(filePath).then((st) => st.mode & 0o777).catch(() => 0o644);
  const fh = await fs.open(tmpPath, 'w', existingMode);
  try {
    await fh.writeFile(content, 'utf-8');
    await fh.sync();
  } catch (err) {
    await fh.close().catch(() => {});
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
  await fh.close();
  try {
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
  const dirHandle = await fs.open(dir, 'r');
  try {
    await dirHandle.sync();
  } finally {
    await dirHandle.close();
  }
}

// ---------------------------------------------------------------------
// Stale-overwrite detection: the mtime/size a file had the last time this
// process actually read (or wrote) its bytes, keyed by absolute path.
// Editing a file here while it also changes on disk (git checkout, vim,
// another process) used to be a silent lost update on the next save —
// write-file below now refuses to overwrite a file whose on-disk state
// has moved since we last saw it, rather than blindly trusting whatever's
// in the renderer's memory. No baseline recorded yet (a file this session
// has never actually read) is not an error — there's nothing to compare
// against, same as a brand-new file being created for the first time.
// ---------------------------------------------------------------------
const knownStat = new Map();

async function recordStat(filePath) {
  try {
    const st = await fs.stat(filePath);
    knownStat.set(filePath, { mtimeMs: st.mtimeMs, size: st.size });
  } catch {
    knownStat.delete(filePath);
  }
}

async function assertNotChangedExternally(filePath) {
  const expected = knownStat.get(filePath);
  if (!expected) return;
  let current = null;
  try {
    const st = await fs.stat(filePath);
    current = { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    current = null;
  }
  if (current && (current.mtimeMs !== expected.mtimeMs || current.size !== expected.size)) {
    throw new Error(`"${path.basename(filePath)}" changed on disk since it was opened here — reload it before saving, or you'll overwrite that change.`);
  }
}

// ---------------------------------------------------------------------
// Which folders the user has ever actually granted access to via the
// real native picker, persisted to disk (not just the in-memory
// allowlist, which starts empty every launch). reallow-folder (below)
// re-grants access to the *last-opened* folder on startup without a
// fresh dialog prompt — the renderer remembers which path that was, in
// its own localStorage, but a renderer-supplied path is not something
// this process can trust on its own: only a path this same process
// already saw come back from a real dialog.showOpenDialog() call is
// eligible to be re-granted.
// ---------------------------------------------------------------------
const grantedFoldersFile = () => path.join(app.getPath('userData'), 'granted-folders.json');

async function readGrantedFolders() {
  try {
    const raw = await fs.readFile(grantedFoldersFile(), 'utf-8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

async function rememberGrantedFolder(folderPath) {
  const resolved = path.resolve(folderPath);
  const list = await readGrantedFolders();
  if (list.includes(resolved)) return;
  list.push(resolved);
  try {
    await fs.mkdir(path.dirname(grantedFoldersFile()), { recursive: true });
    await atomicWriteFile(grantedFoldersFile(), JSON.stringify(list));
  } catch {
    // Best-effort — worst case, the next launch's reallow-folder call
    // just fails closed and asks the user to re-pick the folder, which is
    // the safe direction to fail in.
  }
}

// ---------------------------------------------------------------------
// Auto-update: electron-updater checks electron-builder's own GitHub
// Releases feed (configured via package.json's "build.publish", and only
// present at all in a real packaged build — see the app.isPackaged guard
// below, since an unpacked `npm start` dev run has no app-update.yml for
// it to read and would otherwise just throw). A background check runs
// once shortly after launch; the renderer can also trigger one on demand
// (Settings → Check for updates) — both paths funnel through the same
// event handlers below, which push a status to whichever window is open
// so the UI can show something better than nothing happening.
// ---------------------------------------------------------------------
autoUpdater.autoDownload = true;
// "Later" in the dialog below has to actually mean something — installing
// on the next quit regardless (not only when quitAndInstall() is called
// directly) is what makes that true, rather than a downloaded update
// silently going nowhere until someone happens to open Settings again.
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow = null;
// The Settings panel's own status listener only exists while Settings is
// actually open — a status pushed before that (the background check on
// launch fires 3s in, almost always before anyone's clicked Settings) would
// otherwise just be missed, leaving the panel stuck on its generic initial
// text even after a real check already ran and found something worth
// showing. Remembering the latest one here lets get-app-version hand it
// over on open, alongside the version it already returns.
let lastStatus = null;

function sendUpdateStatus(status) {
  lastStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', status);
  }
}

autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }));
autoUpdater.on('update-not-available', () => sendUpdateStatus({ state: 'up-to-date' }));
autoUpdater.on('update-available', (info) => sendUpdateStatus({ state: 'downloading', version: info.version }));
autoUpdater.on('error', (err) => sendUpdateStatus({ state: 'error', message: err?.message || String(err) }));
autoUpdater.on('update-downloaded', (info) => {
  sendUpdateStatus({ state: 'ready', version: info.version });
  // Reuses the same window's own close-confirmation logic (see the
  // 'close' handler below) rather than bypassing it: quitAndInstall()
  // quits the app like any other quit, so unsaved work still gets its
  // normal "quit anyway?" prompt first if there's any.
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'info',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: `MD.Orchestra ${info.version} is ready to install.`,
    detail: 'Restart now to finish updating, or keep working — it installs next time you quit either way.',
  });
  if (choice === 0) autoUpdater.quitAndInstall();
});

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
  mainWindow = win;
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
  // Unpacked (npm start) runs have no app-update.yml for electron-updater
  // to read — it throws immediately if asked to check in that case, so
  // this only ever runs against a real packaged build. A few seconds'
  // delay keeps it out of the way of the window's own first paint.
  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths.length) return null;
  const [folderPath] = result.filePaths;
  allow('dir', folderPath);
  await rememberGrantedFolder(folderPath);
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
  await recordStat(filePath);
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
  const text = await fs.readFile(filePath, 'utf-8');
  await recordStat(filePath);
  return text;
});

ipcMain.handle('write-file', async (event, filePath, content) => {
  assertAllowed(filePath);
  await assertNotChangedExternally(filePath);
  await atomicWriteFile(filePath, content);
  await recordStat(filePath);
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
  // Keyed the same (unresolved) way recordStat()/assertNotChangedExternally()
  // key it above — resolving here and not there would leave a stale entry
  // behind that a file later re-created at this exact path would then get
  // incorrectly flagged against.
  knownStat.delete(filePath);
});

/**
 * Reopening the last-used folder on launch (see js/main.js) needs it back
 * in the allowlist before any read-dir/read-file call for it can succeed —
 * the renderer remembers the *path* (in localStorage, like every other
 * preference), but the allowlist itself is main-process, in-memory state
 * that a fresh launch starts empty. This re-grants it without a fresh
 * dialog prompt, the same trust a real desktop app extends to a workspace
 * you've already explicitly opened before — but only after checking this
 * exact path is one this process itself actually saw come back from a
 * real native folder picker at some point (see rememberGrantedFolder),
 * and that it's still a real, existing directory rather than something
 * since deleted or renamed. A renderer that can't point to a path in that
 * persisted history — including one making the call up entirely — gets
 * nothing.
 */
ipcMain.handle('reallow-folder', async (event, folderPath) => {
  const resolved = path.resolve(folderPath);
  const granted = await readGrantedFolders();
  if (!granted.includes(resolved)) {
    throw new Error(`Not allowed: "${folderPath}" was never granted through the folder picker.`);
  }
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`"${folderPath}" no longer exists — pick it again.`);
  }
  allow('dir', resolved);
});

ipcMain.handle('get-app-version', () => ({ version: app.getVersion(), isPackaged: app.isPackaged, lastStatus }));

/** On-demand check (Settings → Check for updates) — status still arrives via the same 'update-status' push the background check on launch uses, not this call's own return value, so the two paths behave identically from the renderer's side. */
ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    sendUpdateStatus({ state: 'error', message: 'Updates only work in a packaged build, not a dev run.' });
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    sendUpdateStatus({ state: 'error', message: err?.message || String(err) });
  }
});
