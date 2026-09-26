# YouScrapper

A fast, simple Windows desktop app for downloading **MP4 video** or **MP3 audio** from **YouTube, TikTok and Instagram**. Paste a link, pick a format, and you're done.

Built with **React + Electron**, powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org/).

---

## Features

- 🎬 **MP4 video** at best quality, or capped at 2160p / 1440p / 1080p / 720p / 480p / 360p
- 🎵 **MP3 audio** at best VBR, 320, 192 or 128 kbps, with embedded cover art and metadata
- 🔗 **Paste to fetch**: pasting a link instantly shows the title, thumbnail, uploader and duration
- 📊 **Live progress** with speed and ETA, plus several downloads at once and a cancel button
- 📁 **Show in folder** or **Save as…** when a download finishes
- 🍪 **Browser cookies** (optional) for private or login-only posts, which is mostly an Instagram issue
- 🔄 **Update yt-dlp** from the menu when a site changes and downloads stop working
- 📦 No setup needed: yt-dlp and ffmpeg ship inside the app

## Download & install

Grab one of the builds from the `release/` folder (or the GitHub Releases page):

| File | What it is |
| --- | --- |
| `YouScrapper Setup x.y.z.exe` | Installer with a Start Menu shortcut and uninstaller |
| `YouScrapper x.y.z.exe` | Portable version, which runs without installing |

> Windows SmartScreen may warn you because the app isn't code-signed. Click **More info → Run anyway**.

Files are saved to **`%USERPROFILE%\Downloads\YouScrapper`**. You can also open that folder from **File → Open downloads folder**.

## Usage

1. Copy a video link from YouTube, TikTok or Instagram.
2. Paste it into YouScrapper with **Ctrl+V** or the **Paste** button. The video info loads automatically.
3. Pick **MP4 Video** or **MP3 Audio** and a quality.
4. Click **Download**.

### Troubleshooting

| Problem | Fix |
| --- | --- |
| A site suddenly stops working | **File → Update yt-dlp**. Sites change often and yt-dlp updates fix most breakages. |
| Instagram says "login required" | Open **Advanced** and pick a browser you're logged into Instagram with. **Firefox** works best; recent Chrome/Edge versions encrypt cookies so tools can't read them. |
| "Sign in to confirm you're not a bot" on YouTube | Same fix: use browser cookies from **Advanced**. |

## Building from source

**Requirements:** [Node.js](https://nodejs.org/) 20+ on Windows.

```bash
git clone <this repo>
cd YouScrapper
npm install          # also downloads yt-dlp into ./bin
npm start            # build the UI and open the desktop app
```

If npm blocks install scripts (npm 11+), approve the ones that download the binaries:

```bash
npm approve-scripts electron ffmpeg-static esbuild electron-winstaller
npm rebuild
```

### Scripts

| Command | Description |
| --- | --- |
| `npm start` | Build the UI and launch the desktop app |
| `npm run dev` | Browser dev mode with hot reload (UI at http://localhost:5173) |
| `npm run dist` | Build the Windows installer and portable `.exe` into `release/` |
| `npm run update-ytdlp` | Re-download the latest yt-dlp into `./bin` |

## How it works

```
┌──────────────── Electron window ────────────────┐
│  React UI (src/)                                │
│      │  fetch /api/*  +  Server-Sent Events     │
│      ▼                                          │
│  Express server (server/index.js, 127.0.0.1)    │
│      │  spawns                                  │
│      ▼                                          │
│  yt-dlp.exe ──► ffmpeg (merge / MP3 convert)    │
└─────────────────────────────────────────────────┘
```

- **`electron/main.js`** starts the local API server on a random localhost port and opens the window.
- **`server/index.js`** wraps yt-dlp: `/api/info` reads metadata, `/api/download` starts a job, and `/api/jobs/:id/events` streams progress.
- **`src/`** holds the React UI, built with Vite.
- **`scripts/ytdlp.js`** downloads the right yt-dlp binary for your platform.

The server only listens on `127.0.0.1`, so nothing is exposed to your network.

## Project structure

```
YouScrapper/
├── electron/main.js     # Desktop window, menu, packaging paths
├── server/index.js      # Local API around yt-dlp + ffmpeg
├── scripts/ytdlp.js     # yt-dlp downloader/updater
├── src/                 # React UI (App.jsx, styles.css)
├── index.html
├── vite.config.js
└── package.json         # Scripts + electron-builder config
```

## Legal

YouScrapper is intended for downloading content you own, content that is in the public domain or licensed for reuse, or content you otherwise have permission to save. Respect copyright and each platform's Terms of Service.
