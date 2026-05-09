const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  listVideos: (folderPath) => ipcRenderer.invoke('fs:listVideos', folderPath),
  getStore: (key) => ipcRenderer.invoke('store:get', key),
  setStore: (key, value) => ipcRenderer.invoke('store:set', key, value),
  analyzeMedia: (filePath) => ipcRenderer.invoke('media:analyze', filePath),
  onRestoreFolder: (cb) => {
    ipcRenderer.on('app:restoreFolder', (_evt, folderPath) => cb(folderPath));
  }
});
