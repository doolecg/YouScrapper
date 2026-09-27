// Exposes a small, safe API to the settings page. Sandboxed preloads must be CommonJS.
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, data) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('youscrapper', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  getVersions: () => ipcRenderer.invoke('app:versions'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  updateYtDlp: () => ipcRenderer.invoke('ytdlp:update'),
  chooseDownloadDir: () => ipcRenderer.invoke('downloads:choose'),
  onUpdateStatus: (callback) => subscribe('updates:status', callback),
  onOpenSettings: (callback) => subscribe('open-settings', callback),
});
