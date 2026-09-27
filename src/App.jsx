import { useCallback, useEffect, useRef, useState } from 'react';
import Settings from './Settings.jsx';

const VIDEO_QUALITIES = [2160, 1440, 1080, 720, 480, 360];
const AUDIO_QUALITIES = [
  { value: 'best', label: 'Best (VBR)' },
  { value: '320', label: '320 kbps' },
  { value: '192', label: '192 kbps' },
  { value: '128', label: '128 kbps' },
];
const PLATFORM_LABEL = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', other: 'Web' };
// Download preferences, kept in localStorage so they also work in browser mode.
const PREF_DEFAULTS = { cookies: 'none', defaultFormat: 'mp4', defaultVideoQuality: 'best', defaultAudioQuality: 'best' };

async function api(path, body) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function formatDuration(sec) {
  if (!sec) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

function loadPrefs() {
  const prefs = {};
  for (const [key, fallback] of Object.entries(PREF_DEFAULTS)) {
    try {
      prefs[key] = localStorage.getItem(key) || fallback;
    } catch {
      prefs[key] = fallback;
    }
  }
  return prefs;
}

function defaultQuality(prefs, format) {
  return format === 'mp4' ? prefs.defaultVideoQuality : prefs.defaultAudioQuality;
}

export default function App() {
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [prefs, setPrefs] = useState(loadPrefs);
  const [format, setFormat] = useState(prefs.defaultFormat);
  const [quality, setQuality] = useState(() => defaultQuality(prefs, prefs.defaultFormat));
  const [jobs, setJobs] = useState([]);
  const [config, setConfig] = useState({});
  const [view, setView] = useState('home');
  const lookupId = useRef(0);
  const { cookies } = prefs;

  const loadConfig = useCallback(() => {
    fetch('/api/config').then((r) => r.json()).then(setConfig).catch(() => {});
  }, []);

  useEffect(loadConfig, [loadConfig]);
  useEffect(() => window.youscrapper?.onOpenSettings(() => setView('settings')), []);

  // Save preferences and apply new defaults to the form if nothing has been fetched yet.
  function updatePrefs(patch) {
    const updated = { ...prefs, ...patch };
    for (const key of Object.keys(patch)) {
      try {
        localStorage.setItem(key, updated[key]);
      } catch {}
    }
    setPrefs(updated);
    if (!info) {
      setFormat(updated.defaultFormat);
      setQuality(defaultQuality(updated, updated.defaultFormat));
    }
  }

  async function lookup(link = url) {
    if (!link.trim()) return;
    const id = ++lookupId.current;
    setLoading(true);
    setError('');
    setInfo(null);
    try {
      const data = await api('/info', { url: link, cookies });
      if (id === lookupId.current) setInfo(data);
    } catch (e) {
      if (id === lookupId.current) setError(e.message);
    } finally {
      if (id === lookupId.current) setLoading(false);
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        setUrl(text);
        lookup(text);
      }
    } catch {
      setError('Clipboard access was blocked. Paste with Ctrl+V instead.');
    }
  }

  async function startDownload() {
    setError('');
    try {
      const job = await api('/download', { url, format, quality, cookies, title: info?.title });
      setJobs((list) => [job, ...list]);
      track(job.id);
    } catch (e) {
      setError(e.message);
    }
  }

  function track(id) {
    const es = new EventSource(`/api/jobs/${id}/events`);
    es.onmessage = (ev) => {
      const job = JSON.parse(ev.data);
      setJobs((list) => list.map((j) => (j.id === id ? job : j)));
      if (['done', 'error', 'cancelled'].includes(job.status)) es.close();
    };
    es.onerror = () => es.close();
  }

  const videoOptions = info?.heights?.length
    ? VIDEO_QUALITIES.filter((h) => h <= info.heights[0])
    : VIDEO_QUALITIES;
  // A default like 2160p may not exist for this video; yt-dlp then picks the best below it.
  const shownQuality = format === 'mp4' && quality !== 'best' && !videoOptions.includes(Number(quality)) ? 'best' : quality;

  const closeSettings = useCallback(() => setView('home'), []);

  if (view === 'settings') {
    return (
      <main className="app">
        <Settings
          prefs={prefs}
          setPref={(key, value) => updatePrefs({ [key]: value })}
          resetPrefs={() => updatePrefs(PREF_DEFAULTS)}
          config={config}
          onConfigChange={loadConfig}
          onClose={closeSettings}
        />
      </main>
    );
  }

  return (
    <main className="app">
      <header>
        <button type="button" className="ghost small settings-button" onClick={() => setView('settings')} title="Settings (Ctrl+,)">
          ⚙ Settings
        </button>
        <h1>You<span>Scrapper</span></h1>
        <p>Download MP3 or MP4 from YouTube, TikTok and Instagram.</p>
      </header>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (info) startDownload();
          else lookup();
        }}
      >
        <div className="url-row">
          <input
            type="url"
            placeholder="Paste a YouTube, TikTok or Instagram link"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setInfo(null);
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text').trim();
              if (text) {
                e.preventDefault();
                setUrl(text);
                lookup(text);
              }
            }}
            autoFocus
          />
          <button type="button" className="ghost" onClick={pasteFromClipboard}>Paste</button>
          {!info && (
            <button type="submit" disabled={loading || !url.trim()}>
              {loading ? 'Checking…' : 'Fetch'}
            </button>
          )}
        </div>

        {loading && <div className="skeleton" />}
        {error && <div className="error">{error}</div>}

        {info && (
          <>
            <div className="preview">
              {info.thumbnail && <img src={info.thumbnail} alt="" referrerPolicy="no-referrer" />}
              <div>
                <span className={`badge ${info.platform}`}>{PLATFORM_LABEL[info.platform]}</span>
                <h2>{info.title}</h2>
                <p className="muted">
                  {[info.uploader, formatDuration(info.duration)].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>

            <div className="options">
              <div className="toggle" role="radiogroup" aria-label="Format">
                {['mp4', 'mp3'].map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={format === f}
                    className={format === f ? 'active' : ''}
                    onClick={() => {
                      setFormat(f);
                      setQuality(defaultQuality(prefs, f));
                    }}
                  >
                    {f === 'mp4' ? 'MP4 Video' : 'MP3 Audio'}
                  </button>
                ))}
              </div>

              <label>
                Quality
                <select value={shownQuality} onChange={(e) => setQuality(e.target.value)}>
                  {format === 'mp4' ? (
                    <>
                      <option value="best">Best available</option>
                      {videoOptions.map((h) => (
                        <option key={h} value={h}>{h}p</option>
                      ))}
                    </>
                  ) : (
                    AUDIO_QUALITIES.map((q) => (
                      <option key={q.value} value={q.value}>{q.label}</option>
                    ))
                  )}
                </select>
              </label>

              <button type="submit" className="primary">Download</button>
            </div>
          </>
        )}

        {config.downloadDir && (
          <p className="muted footnote">
            Saving to <code>{config.downloadDir}</code>{' '}
            <button type="button" className="link" onClick={() => api('/open-folder')}>Open</button>
            {cookies !== 'none' && <> · Using {cookies} cookies</>}
          </p>
        )}
      </form>

      {jobs.length > 0 && (
        <section className="jobs">
          <h3>Downloads</h3>
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </section>
      )}
    </main>
  );
}

function JobRow({ job }) {
  const active = ['starting', 'downloading', 'processing'].includes(job.status);
  const statusText = {
    starting: 'Starting…',
    downloading: [`${job.percent.toFixed(1)}%`, job.speed, job.eta && `ETA ${job.eta}`].filter(Boolean).join(' · '),
    processing: job.format === 'mp3' ? 'Converting to MP3…' : 'Merging video and audio…',
    done: 'Done',
    error: job.error,
    cancelled: 'Cancelled',
  }[job.status];

  return (
    <div className={`job ${job.status}`}>
      <div className="job-head">
        <span className="tag">{job.format.toUpperCase()}</span>
        <span className="job-title" title={job.fileName || job.title}>{job.fileName || job.title}</span>
      </div>
      <div className="bar">
        <div
          className={job.status === 'processing' || job.status === 'starting' ? 'indeterminate' : ''}
          style={{ width: `${job.status === 'done' ? 100 : job.percent}%` }}
        />
      </div>
      <div className="job-foot">
        <span className="muted">{statusText}</span>
        <span className="actions">
          {active && (
            <button className="ghost small" onClick={() => api(`/jobs/${job.id}/cancel`)}>Cancel</button>
          )}
          {job.status === 'done' && (
            <>
              <button className="ghost small" onClick={() => api('/open-folder', { id: job.id })}>Show in folder</button>
              <a className="button small" href={`/api/jobs/${job.id}/file`} download>Save as…</a>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
