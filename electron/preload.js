const { contextBridge, ipcRenderer } = require('electron');

// The renderer's only way to touch the real filesystem — deliberately this
// narrow (no raw ipcRenderer, no Node access at all: contextIsolation is on
// and nodeIntegration is off in main.js's BrowserWindow). Every one of
// these is re-validated against the main process's own allowlist
// regardless of what the renderer claims, so this bridge itself doesn't
// need to be trusted to enforce anything.
contextBridge.exposeInMainWorld('electronFS', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  readDir: (dirPath) => ipcRenderer.invoke('read-dir', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  exists: (targetPath) => ipcRenderer.invoke('exists', targetPath),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  reallowFolder: (folderPath) => ipcRenderer.invoke('reallow-folder', folderPath),
});

// Auto-update status/controls — separate from electronFS since it has
// nothing to do with the user's own files, just this app's own version.
// onStatus returns an unsubscribe function, the same shape every other
// "subscribe to a stream of events" API in this codebase uses.
contextBridge.exposeInMainWorld('electronUpdater', {
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onStatus: (callback) => {
    const listener = (event, status) => callback(status);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
});
