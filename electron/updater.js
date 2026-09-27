// Self-updater that works for both the MSI install and the portable exe.
// Releases are read from a public GitHub repo, so no token is needed.
import { app, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getSettings, setSettings } from './settings.js';

export const REPO = 'doolecg/YouScrapper';
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'YouScrapper' };

// electron-builder sets this when running the portable exe.
export const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;

let busy = false;

// Compares "1.2.3" style versions; a pre-release ("1.2.0-beta.1") sorts before its final release.
function isNewer(latest, current) {
  const parse = (v) => {
    const [main, pre] = v.replace(/^v/, '').split('-');
    return { nums: main.split('.').map(Number), pre };
  };
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if ((a.nums[i] || 0) !== (b.nums[i] || 0)) return (a.nums[i] || 0) > (b.nums[i] || 0);
  }
  if (a.pre && b.pre) return a.pre.localeCompare(b.pre, undefined, { numeric: true }) > 0;
  return !a.pre && !!b.pre;
}

function sendStatus(win, status) {
  if (win && !win.isDestroyed()) win.webContents.send('updates:status', status);
}

async function fetchLatestRelease(includePrereleases) {
  if (!includePrereleases) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: HEADERS });
    if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}`);
    return res.json();
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, { headers: HEADERS });
  if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}`);
  const releases = (await res.json()).filter((r) => !r.draft);
  if (!releases.length) throw new Error('No releases found');
  return releases.reduce((best, r) => (isNewer(r.tag_name, best.tag_name) ? r : best));
}

async function download(url, dest, win, version) {
  const res = await fetch(url, { headers: { Accept: 'application/octet-stream' } });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  let lastPercent = -1;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    if (!total) return;
    win?.setProgressBar(received / total);
    const percent = Math.floor((received / total) * 100);
    if (percent !== lastPercent) {
      lastPercent = percent;
      sendStatus(win, { state: 'downloading', latest: version, percent });
    }
  });
  await pipeline(body, fs.createWriteStream(dest));
  win?.setProgressBar(-1);
}

async function install(release, asset, win) {
  const tmp = path.join(os.tmpdir(), asset.name);
  sendStatus(win, { state: 'downloading', latest: release.tag_name, percent: 0 });
  await download(asset.browser_download_url, tmp, win, release.tag_name);
  sendStatus(win, { state: 'installing', latest: release.tag_name });

  if (portableExe) {
    // A running exe can be renamed but not overwritten, so move it aside first.
    fs.renameSync(portableExe, `${portableExe}.old`);
    fs.copyFileSync(tmp, portableExe);
    fs.rmSync(tmp, { force: true });
    spawn(portableExe, [], { detached: true, stdio: 'ignore' }).unref();
  } else {
    // The MSI upgrades the existing install in Program Files (Windows asks for admin).
    spawn('msiexec', ['/i', tmp, '/passive', '/norestart'], { detached: true, stdio: 'ignore' }).unref();
  }
  app.quit();
}

// Remove the previous portable exe left behind by the last update.
export function cleanupOldPortable() {
  if (portableExe) fs.rm(`${portableExe}.old`, { force: true }, () => {});
}

/**
 * Checks GitHub for a newer release and offers to install it.
 * - Startup checks respect "skip this version" and "install automatically".
 * - manual: the user asked (menu or settings page), so skipped versions are offered again.
 * - showResult: also show a dialog for "up to date" and errors (the settings page shows these inline).
 * Resolves to a status object the settings page can display.
 */
export async function checkForUpdates(win, { manual = false, showResult = false } = {}) {
  const current = app.getVersion();
  if (!app.isPackaged) return { state: 'dev', current };
  if (busy) return { state: 'busy', current };
  busy = true;
  sendStatus(win, { state: 'checking' });
  try {
    const settings = getSettings();
    const release = await fetchLatestRelease(settings.includePrereleases);
    setSettings({ lastUpdateCheck: Date.now() });
    const latest = release.tag_name;

    if (!isNewer(latest, current)) {
      const status = { state: 'latest', current, latest };
      sendStatus(win, status);
      if (showResult) dialog.showMessageBox(win, { message: `You're on the latest version (v${current}).` });
      return status;
    }

    const status = { state: 'available', current, latest, url: release.html_url };
    sendStatus(win, status);
    if (!manual && settings.skippedVersion === latest) return status;

    const asset = release.assets.find((a) => (portableExe ? /-Portable-.*\.exe$/i : /\.msi$/i).test(a.name));
    if (!asset) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Update available',
        message: `YouScrapper ${latest} is available (you have v${current}).`,
        detail: 'This release has no installer for your version of the app. Download it from the releases page.',
        buttons: ['View release', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) shell.openExternal(release.html_url || RELEASES_PAGE);
      return status;
    }

    if (!manual && settings.autoInstallUpdates) {
      await install(release, asset, win);
      return { ...status, state: 'installing' };
    }

    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update available',
      message: `YouScrapper ${latest} is available (you have v${current}).`,
      detail: release.body?.slice(0, 1500) || '',
      buttons: ['Update now', 'Later', 'Skip this version', 'View release'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 2) setSettings({ skippedVersion: latest });
    if (response === 3) shell.openExternal(release.html_url);
    if (response !== 0) return status;

    await install(release, asset, win);
    return { ...status, state: 'installing' };
  } catch (err) {
    win?.setProgressBar(-1);
    const status = { state: 'error', current, error: err.message };
    sendStatus(win, status);
    if (showResult) {
      dialog.showMessageBox(win, { type: 'error', message: 'Could not check for updates', detail: err.message });
    }
    return status;
  } finally {
    busy = false;
  }
}
