// Self-updater that works for both the MSI install and the portable exe.
// Releases are read from a public GitHub repo, so no token is needed.
import { app, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REPO = 'doolecg/YouScrapper-releases';
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

// electron-builder sets this when running the portable exe.
const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;

function isNewer(latest, current) {
  const a = latest.replace(/^v/, '').split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

async function download(url, dest, win) {
  const res = await fetch(url, { headers: { Accept: 'application/octet-stream' } });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    if (total) win?.setProgressBar(received / total);
  });
  await pipeline(body, fs.createWriteStream(dest));
  win?.setProgressBar(-1);
}

// Remove the previous portable exe left behind by the last update.
export function cleanupOldPortable() {
  if (portableExe) fs.rm(`${portableExe}.old`, { force: true }, () => {});
}

export async function checkForUpdates(win, { silent = true } = {}) {
  if (!app.isPackaged) return;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'YouScrapper' },
    });
    if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}`);
    const release = await res.json();
    const current = app.getVersion();

    if (!isNewer(release.tag_name, current)) {
      if (!silent) dialog.showMessageBox(win, { message: `You're on the latest version (v${current}).` });
      return;
    }

    const asset = release.assets.find((a) => (portableExe ? /-Portable-.*\.exe$/i : /\.msi$/i).test(a.name));
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update available',
      message: `YouScrapper ${release.tag_name} is available (you have v${current}).`,
      detail: release.body?.slice(0, 1500) || '',
      buttons: asset ? ['Update now', 'Later', 'View release'] : ['View release', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (!asset) {
      if (response === 0) shell.openExternal(RELEASES_PAGE);
      return;
    }
    if (response === 2) return shell.openExternal(release.html_url);
    if (response !== 0) return;

    const tmp = path.join(os.tmpdir(), asset.name);
    await download(asset.browser_download_url, tmp, win);

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
  } catch (err) {
    if (!silent) {
      dialog.showMessageBox(win, { type: 'error', message: 'Could not check for updates', detail: err.message });
    }
  }
}
