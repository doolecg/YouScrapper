// Downloads the standalone yt-dlp binary into ./bin (run on npm install, or with --force to update).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos', linux: 'yt-dlp_linux' };

export const YTDLP = process.env.YTDLP_PATH || path.join(root, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

export async function ensureYtDlp({ force = false } = {}) {
  if (!force && fs.existsSync(YTDLP)) return YTDLP;
  const asset = assets[process.platform];
  if (!asset) throw new Error(`Unsupported platform: ${process.platform}`);
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download yt-dlp: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(YTDLP), { recursive: true });
  const tmp = `${YTDLP}.part`;
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, YTDLP);
  fs.chmodSync(YTDLP, 0o755);
  return YTDLP;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureYtDlp({ force: process.argv.includes('--force') })
    .then((p) => console.log(`yt-dlp ready: ${p}`))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
