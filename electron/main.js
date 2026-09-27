import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSettings, resetSettings, setSettingsFromUi } from './settings.js';
import { checkForUpdates, cleanupOldPortable, portableExe, REPO } from './updater.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));

// The packaged app ships yt-dlp.exe in resources/bin (see "extraResources" in package.json).
// Program Files is read-only, so run a copy from AppData that "Update yt-dlp" can overwrite.
if (app.isPackaged) {
  const name = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const userCopy = path.join(app.getPath('userData'), 'bin', name);
  if (!fs.existsSync(userCopy)) {
    fs.mkdirSync(path.dirname(userCopy), { recursive: true });
    fs.copyFileSync(path.join(process.resourcesPath, 'bin', name), userCopy);
  }
  process.env.YTDLP_PATH = userCopy;
}

if (!app.requestSingleInstanceLock()) app.quit();

let win;
let server;

async function createWindow() {
  // Imported after YTDLP_PATH is set so the server picks it up.
  server ??= await import('../server/index.js');
  server.setDownloadDir(getSettings().downloadDir);
  const port = await server.startServer(0);

  win = new BrowserWindow({
    width: 900,
    height: 820,
    minWidth: 480,
    minHeight: 500,
    title: 'YouScrapper',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(DIR, 'preload.cjs') },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(`http://127.0.0.1:${port}`);
}

function ytDlpPath() {
  return process.env.YTDLP_PATH || server.YTDLP;
}

function getYtDlpVersion() {
  return new Promise((resolve) => {
    execFile(ytDlpPath(), ['--version'], { windowsHide: true }, (err, stdout) => resolve(err ? null : stdout.trim()));
  });
}

function updateYtDlp() {
  return new Promise((resolve) => {
    execFile(ytDlpPath(), ['-U'], { windowsHide: true }, async (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout + stderr).trim(), version: await getYtDlpVersion() });
    });
  });
}

async function updateYtDlpWithDialog() {
  const result = await updateYtDlp();
  dialog.showMessageBox(win, {
    type: result.ok ? 'info' : 'error',
    title: 'Update yt-dlp',
    message: result.ok ? 'yt-dlp update finished' : 'Update failed',
    detail: result.output,
  });
}

function openSettings() {
  win?.webContents.send('open-settings');
}

// Only accept IPC from our own window.
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== win?.webContents) throw new Error('Unknown sender');
    return fn(...args);
  });
}

handle('settings:get', () => getSettings());
handle('settings:set', (patch) => {
  const settings = setSettingsFromUi(patch);
  if (patch && 'downloadDir' in patch) server.setDownloadDir(settings.downloadDir);
  return settings;
});
handle('settings:reset', () => {
  const settings = resetSettings();
  server.setDownloadDir(settings.downloadDir);
  return settings;
});
handle('app:versions', async () => ({
  app: app.getVersion(),
  electron: process.versions.electron,
  ytdlp: await getYtDlpVersion(),
  portable: !!portableExe,
  packaged: app.isPackaged,
  releaseNotes: `https://github.com/${REPO}/releases/tag/v${app.getVersion()}`,
  releasesPage: `https://github.com/${REPO}/releases`,
}));
handle('updates:check', () => checkForUpdates(win, { manual: true }));
handle('ytdlp:update', () => updateYtDlp());
handle('downloads:choose', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose download folder',
    defaultPath: server.getDownloadDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths[0]) return getSettings();
  const settings = setSettingsFromUi({ downloadDir: filePaths[0] });
  server.setDownloadDir(settings.downloadDir);
  return settings;
});

Menu.setApplicationMenu(Menu.buildFromTemplate([
  {
    label: 'File',
    submenu: [
      { label: 'Open downloads folder', click: () => shell.openPath(server.getDownloadDir()) },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openSettings },
      { type: 'separator' },
      { label: 'Check for app updates', click: () => checkForUpdates(win, { manual: true, showResult: true }) },
      { label: 'Update yt-dlp (fixes broken sites)', click: updateYtDlpWithDialog },
      { type: 'separator' },
      { role: 'quit' },
    ],
  },
  { role: 'editMenu' },
  { role: 'viewMenu' },
]));

app.on('second-instance', () => {
  if (win?.isMinimized()) win.restore();
  win?.focus();
});
app.on('before-quit', () => server?.cancelAll());
app.on('window-all-closed', () => app.quit());
app.whenReady().then(async () => {
  cleanupOldPortable();
  await createWindow();
  const settings = getSettings();
  if (settings.autoUpdateYtDlp) updateYtDlp();
  if (settings.autoCheckUpdates) checkForUpdates(win);
});
