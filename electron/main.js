import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkForUpdates, cleanupOldPortable } from './updater.js';

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
  const port = await server.startServer(0);

  win = new BrowserWindow({
    width: 900,
    height: 820,
    minWidth: 480,
    minHeight: 500,
    title: 'YouScrapper',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(`http://127.0.0.1:${port}`);
}

function updateYtDlp() {
  execFile(process.env.YTDLP_PATH || server.YTDLP, ['-U'], { windowsHide: true }, (err, stdout, stderr) => {
    dialog.showMessageBox(win, {
      type: err ? 'error' : 'info',
      title: 'Update yt-dlp',
      message: err ? 'Update failed' : 'yt-dlp update finished',
      detail: (stdout + stderr).trim(),
    });
  });
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  {
    label: 'File',
    submenu: [
      { label: 'Open downloads folder', click: () => shell.openPath(server.DOWNLOAD_DIR) },
      { label: 'Check for app updates', click: () => checkForUpdates(win, { silent: false }) },
      { label: 'Update yt-dlp (fixes broken sites)', click: updateYtDlp },
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
  checkForUpdates(win);
});
