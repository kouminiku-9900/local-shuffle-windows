const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const Store = require('electron-store');
const pkg = require('./package.json');
const _miMod = require('mediainfo.js');
const MediaInfoFactory = _miMod.default || _miMod.mediaInfoFactory || _miMod;

const store = new Store({
  defaults: {
    lastFolder: null,
    isShuffled: false,
    volume: 0.8,
    isMuted: false,
    autoUpdateCheck: true
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
    if (store.get('autoUpdateCheck')) {
      // small delay so the first check doesn't compete with initial render
      setTimeout(() => checkForUpdates(win, { silent: true }), 4000);
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

const WASM_PATH = path.join(
  __dirname,
  'node_modules',
  'mediainfo.js',
  'dist',
  'MediaInfoModule.wasm'
);

async function locateWasm() {
  // electron-builder asarUnpack puts the file under app.asar.unpacked when packaged
  const candidates = [
    WASM_PATH,
    WASM_PATH.replace(/app\.asar([\\/])/i, 'app.asar.unpacked$1')
  ];
  for (const c of candidates) {
    try {
      await fs.access(c);
      return c;
    } catch {}
  }
  return WASM_PATH;
}

ipcMain.handle('media:analyze', async (_evt, filePath) => {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    return { error: 'cannot stat file: ' + String(err) };
  }
  const fileSize = stat.size;
  let fh;
  try {
    fh = await fs.open(filePath, 'r');
  } catch (err) {
    return { error: 'cannot open file: ' + String(err) };
  }
  let mi;
  try {
    const wasmFile = await locateWasm();
    const wasmBin = await fs.readFile(wasmFile);
    mi = await MediaInfoFactory({
      format: 'object',
      locateFile: () => wasmFile,
      // newer Emscripten-based builds also accept wasmBinary directly
      wasmBinary: wasmBin
    });
    const result = await mi.analyzeData(
      () => fileSize,
      async (size, offset) => {
        const buf = Buffer.alloc(size);
        const { bytesRead } = await fh.read(buf, 0, size, offset);
        return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
      }
    );
    return { ok: true, fileSize, result };
  } catch (err) {
    return { error: String(err && err.stack || err) };
  } finally {
    try { await fh.close(); } catch {}
    try { mi && mi.close(); } catch {}
  }
});

// ===== Auto update check (GitHub Releases) =====
// This is a *portable* app, so we don't silently replace the running exe.
// Instead we poll the GitHub Releases API on startup and periodically, and when
// a newer version is published we notify the renderer so it can show a banner
// with a one-click download link.
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

function parseRepo(url) {
  const m = /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/i.exec(String(url || ''));
  return m ? { owner: m[1], repo: m[2] } : null;
}
const REPO = parseRepo(pkg.repository && pkg.repository.url);

// Compare dotted versions (e.g. "0.7.0" vs "0.6.0"). Returns >0 if a is newer.
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function fetchLatestRelease() {
  if (!REPO) throw new Error('repository not configured');
  const url = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/releases/latest`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `${pkg.name}/${app.getVersion()}`
    }
  });
  if (!res.ok) throw new Error(`GitHub API responded ${res.status}`);
  return res.json();
}

let updateChecking = false;
let latestUpdate = null;

async function checkForUpdates(win, { silent = true } = {}) {
  if (updateChecking) return latestUpdate;
  updateChecking = true;
  try {
    const rel = await fetchLatestRelease();
    if (!rel || !rel.tag_name) throw new Error('no release found');
    const current = app.getVersion();
    const isNewer = compareVersions(rel.tag_name, current) > 0;
    // Prefer a portable .exe asset; fall back to the release page.
    const asset = (rel.assets || []).find((a) => /\.exe$/i.test(a.name || ''));
    const info = {
      current,
      version: String(rel.tag_name).replace(/^v/i, ''),
      tag: rel.tag_name,
      name: rel.name || rel.tag_name,
      notes: rel.body || '',
      downloadUrl: asset ? asset.browser_download_url : rel.html_url,
      pageUrl: rel.html_url,
      isNewer
    };
    latestUpdate = info;
    if (win && !win.isDestroyed()) {
      if (isNewer) win.webContents.send('app:updateAvailable', info);
      else if (!silent) win.webContents.send('app:updateNotAvailable', info);
    }
    return info;
  } catch (err) {
    console.warn('update check failed:', (err && err.message) || err);
    if (!silent && win && !win.isDestroyed()) {
      win.webContents.send('app:updateError', String((err && err.message) || err));
    }
    return null;
  } finally {
    updateChecking = false;
  }
}

ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('update:check', async () => {
  const win = BrowserWindow.getAllWindows()[0] || null;
  return checkForUpdates(win, { silent: false });
});
ipcMain.handle('update:openDownload', async (_evt, url) => {
  if (typeof url === 'string' && /^https:\/\//i.test(url)) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

app.whenReady().then(() => {
  createWindow();
  // Re-check on an interval; the active window (if any) gets the notification.
  setInterval(() => {
    if (!store.get('autoUpdateCheck')) return;
    const win = BrowserWindow.getAllWindows()[0];
    if (win) checkForUpdates(win, { silent: true });
  }, UPDATE_INTERVAL_MS);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
