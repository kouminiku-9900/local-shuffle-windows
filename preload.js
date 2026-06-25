const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  listVideos: (folderPath) => ipcRenderer.invoke('fs:listVideos', folderPath),
  getStore: (key) => ipcRenderer.invoke('store:get', key),
  setStore: (key, value) => ipcRenderer.invoke('store:set', key, value),
  analyzeMedia: (filePath) => ipcRenderer.invoke('media:analyze', filePath),
  onRestoreFolder: (cb) => {
    ipcRenderer.on('app:restoreFolder', (_evt, folderPath) => cb(folderPath));
  },
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  openDownload: (url) => ipcRenderer.invoke('update:openDownload', url),
  onUpdateAvailable: (cb) => {
    ipcRenderer.on('app:updateAvailable', (_evt, info) => cb(info));
  },
  onUpdateNotAvailable: (cb) => {
    ipcRenderer.on('app:updateNotAvailable', (_evt, info) => cb(info));
  },
  onUpdateError: (cb) => {
    ipcRenderer.on('app:updateError', (_evt, msg) => cb(msg));
  }
});
