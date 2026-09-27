import express from 'express';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureYtDlp, YTDLP } from '../scripts/ytdlp.js';

const PORT = Number(process.env.PORT) || 5174;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
// Inside a packaged Electron app, native binaries live outside the read-only app.asar archive.
const FFMPEG = ffmpegPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const DEFAULT_DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(os.homedir(), 'Downloads', 'YouScrapper');
let DOWNLOAD_DIR = DEFAULT_DOWNLOAD_DIR;
const COOKIE_BROWSERS = new Set(['firefox', 'chrome', 'edge', 'brave', 'opera', 'vivaldi', 'safari']);
const HEIGHTS = new Set(['2160', '1440', '1080', '720', '480', '360']);
const BITRATES = new Set(['320', '192', '128']);

fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
await ensureYtDlp();

const app = express();
app.use(express.json());

/** @type {Map<string, any>} */
const jobs = new Map();

function platformOf(url) {
  const host = new URL(url).hostname.replace(/^www\.|^m\./, '');
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return 'youtube';
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok';
  if (/(^|\.)(instagram\.com|instagr\.am)$/.test(host)) return 'instagram';
  return 'other';
}

function parseUrl(raw) {
  try {
    const url = new URL(String(raw).trim());
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch {}
  return null;
}

function runYtDlp(args) {
  return spawn(YTDLP, args, {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    windowsHide: true,
  });
}

function commonArgs(cookies) {
  const args = ['--no-playlist', '--no-warnings', '--ffmpeg-location', FFMPEG];
  if (COOKIE_BROWSERS.has(cookies)) args.push('--cookies-from-browser', cookies);
  return args;
}

// Fetch title/thumbnail/available qualities without downloading.
app.post('/api/info', (req, res) => {
  const url = parseUrl(req.body?.url);
  if (!url) return res.status(400).json({ error: 'Enter a valid http(s) link.' });

  const proc = runYtDlp([...commonArgs(req.body?.cookies), '-J', '--', url]);
  let out = '';
  let err = '';
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (err += d));
  proc.on('close', (code) => {
    if (code !== 0) return res.status(422).json({ error: cleanError(err) });
    try {
      const info = JSON.parse(out);
      const heights = [...new Set((info.formats || [])
        .filter((f) => f.vcodec && f.vcodec !== 'none' && f.height)
        .map((f) => f.height))].sort((a, b) => b - a);
      res.json({
        title: info.title,
        uploader: info.uploader || info.channel || info.uploader_id,
        thumbnail: info.thumbnail,
        duration: info.duration,
        platform: platformOf(url),
        heights,
      });
    } catch {
      res.status(500).json({ error: 'Could not read video info.' });
    }
  });
});

// Start a download job.
app.post('/api/download', (req, res) => {
  const { format, quality = 'best', cookies, title } = req.body || {};
  const url = parseUrl(req.body?.url);
  if (!url) return res.status(400).json({ error: 'Enter a valid http(s) link.' });
  if (format !== 'mp3' && format !== 'mp4') return res.status(400).json({ error: 'Format must be mp3 or mp4.' });

  const args = [
    ...commonArgs(cookies),
    '-P', DOWNLOAD_DIR,
    '-o', '%(title).120B [%(id)s].%(ext)s',
    '--windows-filenames',
    '--embed-metadata',
    '--newline', '--progress',
    '--progress-template', 'download:PROG|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
    '--print', 'after_move:FILE|%(filepath)s',
  ];
  if (format === 'mp3') {
    const q = BITRATES.has(String(quality)) ? `${quality}K` : '0';
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', q, '--embed-thumbnail');
  } else {
    const res = HEIGHTS.has(String(quality)) ? `res:${quality}` : 'res';
    args.push('-f', 'bv*+ba/b', '-S', `${res},ext:mp4:m4a`, '--merge-output-format', 'mp4');
  }
  args.push('--', url);

  const job = {
    id: randomUUID(),
    url,
    title: title || url,
    format,
    quality,
    platform: platformOf(url),
    status: 'starting',
    percent: 0,
    speed: '',
    eta: '',
    file: null,
    error: null,
    listeners: new Set(),
  };
  jobs.set(job.id, job);

  const proc = runYtDlp(args);
  job.proc = proc;
  let stderr = '';
  let buf = '';
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) handleLine(job, line.trim());
  });
  proc.stderr.on('data', (d) => (stderr += d));
  proc.on('close', (code) => {
    if (buf) handleLine(job, buf.trim());
    if (job.status === 'cancelled') return;
    if (code === 0 && job.file) {
      Object.assign(job, { status: 'done', percent: 100, speed: '', eta: '' });
    } else {
      Object.assign(job, { status: 'error', error: cleanError(stderr) || `yt-dlp exited with code ${code}` });
    }
    emit(job);
  });

  res.json(publicJob(job));
});

function handleLine(job, line) {
  if (line.startsWith('PROG|')) {
    const [, pct, speed, eta] = line.split('|');
    job.status = 'downloading';
    job.percent = parseFloat(pct) || job.percent;
    job.speed = speed?.trim() === 'Unknown B/s' ? '' : speed?.trim();
    job.eta = eta?.trim() === 'Unknown' ? '' : eta?.trim();
    emit(job);
  } else if (line.startsWith('FILE|')) {
    job.file = line.slice(5);
    emit(job);
  } else if (/^\[(ExtractAudio|Merger|EmbedThumbnail|Metadata|FixupM3u8|VideoConvertor)\]/.test(line)) {
    job.status = 'processing';
    emit(job);
  }
}

function cleanError(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.startsWith('ERROR'));
  return (lines.at(-1) || text.trim().split(/\r?\n/).at(-1) || '').replace(/^ERROR:\s*/, '');
}

function publicJob(job) {
  const { proc, listeners, ...rest } = job;
  return { ...rest, fileName: job.file ? path.basename(job.file) : null };
}

function emit(job) {
  const data = `data: ${JSON.stringify(publicJob(job))}\n\n`;
  for (const res of job.listeners) res.write(data);
}

// Live progress via Server-Sent Events.
app.get('/api/jobs/:id/events', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.sendStatus(404);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify(publicJob(job))}\n\n`);
  job.listeners.add(res);
  req.on('close', () => job.listeners.delete(res));
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.sendStatus(404);
  if (job.status !== 'done' && job.status !== 'error') {
    job.status = 'cancelled';
    job.proc?.kill();
    emit(job);
  }
  res.json(publicJob(job));
});

// Send the finished file to the browser (Save As).
app.get('/api/jobs/:id/file', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job?.file || !fs.existsSync(job.file)) return res.sendStatus(404);
  res.download(job.file);
});

// Reveal the file (or the downloads folder) in the OS file manager.
app.post('/api/open-folder', (req, res) => {
  const file = jobs.get(req.body?.id)?.file;
  const target = file && fs.existsSync(file) ? file : null;
  if (process.platform === 'win32') {
    spawn('explorer', target ? [`/select,${target}`] : [DOWNLOAD_DIR], { detached: true });
  } else if (process.platform === 'darwin') {
    spawn('open', target ? ['-R', target] : [DOWNLOAD_DIR], { detached: true });
  } else {
    spawn('xdg-open', [DOWNLOAD_DIR], { detached: true });
  }
  res.json({ ok: true });
});

app.get('/api/config', (_req, res) => res.json({ downloadDir: DOWNLOAD_DIR, defaultDownloadDir: DEFAULT_DOWNLOAD_DIR }));

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

export { YTDLP };

export function getDownloadDir() {
  return DOWNLOAD_DIR;
}

// Change where new downloads are saved (falsy = back to the default folder).
export function setDownloadDir(dir) {
  DOWNLOAD_DIR = dir || DEFAULT_DOWNLOAD_DIR;
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// Stop any running yt-dlp processes (called when the desktop app quits).
export function cancelAll() {
  for (const job of jobs.values()) {
    if (job.proc && job.proc.exitCode === null) job.proc.kill();
  }
}

export function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => resolve(server.address().port));
    server.on('error', reject);
  });
}

// Run standalone (browser mode) when executed directly with `node server/index.js`.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = await startServer();
  console.log(`YouScrapper running at http://localhost:${port}`);
  console.log(`Saving files to ${DOWNLOAD_DIR}`);
}
