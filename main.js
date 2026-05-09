const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const Store = require('electron-store');

const store = new Store({
  defaults: {
    lastFolder: null,
    isShuffled: false,
    volume: 0.8,
    isMuted: false
  }
});

const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.wmv']);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 640,
    minHeight: 360,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.webContents.on('did-finish-load', () => {
    const lastFolder = store.get('lastFolder');
    if (lastFolder) {
      win.webContents.send('app:restoreFolder', lastFolder);
    }
  });
}

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

async function walkVideos(rootPath) {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && VIDEO_EXTS.has(path.extname(e.name).toLowerCase())) {
        out.push(full);
      }
    }
  }
  await walk(rootPath);
  return out;
}

ipcMain.handle('fs:listVideos', async (_evt, folderPath) => {
  if (!folderPath) return [];
  let files;
  try {
    files = await walkVideos(folderPath);
  } catch (err) {
    return { error: String(err) };
  }
  files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return files;
});

ipcMain.handle('store:get', (_evt, key) => store.get(key));
ipcMain.handle('store:set', (_evt, key, value) => {
  store.set(key, value);
  return true;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
