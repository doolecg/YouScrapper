import { useEffect, useState } from 'react';

// Provided by electron/preload.cjs; undefined when running in a plain browser (npm run dev).
const desktop = window.youscrapper;

const VIDEO_QUALITIES = [2160, 1440, 1080, 720, 480, 360];
const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const AUDIO_QUALITIES = [
  { value: 'best', label: 'Best (VBR)' },
  { value: '320', label: '320 kbps' },
  { value: '192', label: '192 kbps' },
  { value: '128', label: '128 kbps' },
];

function timeAgo(ms) {
  if (!ms) return 'never';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const sec = Math.round((ms - Date.now()) / 1000);
  for (const [unit, size] of [['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(sec) >= size) return rtf.format(Math.round(sec / size), unit);
  }
  return 'just now';
}

function updateStatusText(s) {
  switch (s?.state) {
    case 'checking': return 'Checking for updates…';
    case 'latest': return "You're on the latest version.";
    case 'available': return `Version ${s.latest} is available.`;
    case 'downloading': return `Downloading ${s.latest}… ${s.percent ?? 0}%`;
    case 'installing': return `Installing ${s.latest}. YouScrapper will restart.`;
    case 'error': return `Couldn't check for updates: ${s.error}`;
    case 'dev': return 'Updates are turned off when running from source.';
    default: return '';
  }
}

function Setting({ label, hint, children, disabled }) {
  return (
    <div className={`setting${disabled ? ' disabled' : ''}`}>
      <div className="setting-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange, disabled, label }) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="switch"
      aria-label={label}
      checked={!!checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

export default function Settings({ prefs, setPref, resetPrefs, config, onConfigChange, onClose }) {
  const [settings, setSettings] = useState(null);
  const [versions, setVersions] = useState(null);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [ytdlp, setYtdlp] = useState({ busy: false, message: '' });

  useEffect(() => {
    if (!desktop) return;
    desktop.getSettings().then(setSettings);
    desktop.getVersions().then(setVersions);
    return desktop.onUpdateStatus(setUpdateStatus);
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function change(patch) {
    setSettings(await desktop.setSettings(patch));
    if ('downloadDir' in patch) onConfigChange();
  }

  async function checkNow() {
    setUpdateStatus({ state: 'checking' });
    const status = await desktop.checkForUpdates();
    if (status.state !== 'busy') setUpdateStatus(status);
    setSettings(await desktop.getSettings());
  }

  async function updateYtDlp() {
    setYtdlp({ busy: true, message: 'Updating yt-dlp…' });
    const result = await desktop.updateYtDlp();
    const last = result.output.split(/\r?\n/).filter(Boolean).at(-1) || '';
    setYtdlp({ busy: false, ok: result.ok, message: result.ok ? last || 'yt-dlp is up to date.' : `Update failed: ${last}` });
    if (result.version) setVersions((v) => ({ ...v, ytdlp: result.version }));
  }

  async function chooseFolder() {
    setSettings(await desktop.chooseDownloadDir());
    onConfigChange();
  }

  async function resetAll() {
    if (!confirm('Reset all settings to their defaults?')) return;
    if (desktop) setSettings(await desktop.resetSettings());
    resetPrefs();
    onConfigChange();
  }

  const busyUpdating = ['checking', 'downloading', 'installing'].includes(updateStatus?.state);
  const customFolder = config.downloadDir && config.downloadDir !== config.defaultDownloadDir;

  return (
    <div className="settings">
      <div className="settings-head">
        <button type="button" className="ghost small" onClick={onClose}>← Back</button>
        <h2>Settings</h2>
      </div>

      <section className="card">
        <h3>Appearance</h3>
        <Setting label="Theme" hint="System follows your Windows light/dark setting.">
          <div className="toggle" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={prefs.theme === t.value}
                className={prefs.theme === t.value ? 'active' : ''}
                onClick={() => setPref('theme', t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Setting>
      </section>

      <section className="card">
        <h3>App updates</h3>
        {desktop ? (
          <>
            <div className="version-row">
              <div>
                <div className="version">
                  YouScrapper <strong>v{versions?.app ?? '…'}</strong>
                  {versions?.packaged && <span className="tag">{versions.portable ? 'Portable' : 'Installed'}</span>}
                </div>
                <p className="muted">
                  Last checked {timeAgo(settings?.lastUpdateCheck)}
                  {versions && (
                    <>
                      {' · '}<a href={versions.releaseNotes} target="_blank" rel="noreferrer">Release notes</a>
                      {' · '}<a href={versions.releasesPage} target="_blank" rel="noreferrer">All releases</a>
                    </>
                  )}
                </p>
              </div>
              <button type="button" className="primary" onClick={checkNow} disabled={busyUpdating}>
                {updateStatus?.state === 'checking' ? 'Checking…' : 'Check for updates'}
              </button>
            </div>

            {updateStatus && (
              <div className={`status ${updateStatus.state}`}>
                {updateStatusText(updateStatus)}
                {updateStatus.state === 'downloading' && (
                  <div className="bar"><div style={{ width: `${updateStatus.percent ?? 0}%` }} /></div>
                )}
              </div>
            )}

            {settings && (
              <>
                <Setting label="Check for updates on startup" hint="Looks for a new version each time the app opens.">
                  <Switch label="Check for updates on startup" checked={settings.autoCheckUpdates} onChange={(v) => change({ autoCheckUpdates: v })} />
                </Setting>
                <Setting
                  label="Install updates automatically"
                  hint="Download and install new versions on startup without asking. The installer may still ask for admin permission."
                  disabled={!settings.autoCheckUpdates}
                >
                  <Switch
                    label="Install updates automatically"
                    checked={settings.autoInstallUpdates}
                    disabled={!settings.autoCheckUpdates}
                    onChange={(v) => change({ autoInstallUpdates: v })}
                  />
                </Setting>
                <Setting label="Include pre-release versions" hint="Get beta builds before they're marked as the latest release.">
                  <Switch label="Include pre-release versions" checked={settings.includePrereleases} onChange={(v) => change({ includePrereleases: v })} />
                </Setting>
                {settings.skippedVersion && (
                  <Setting label={`Skipped version ${settings.skippedVersion}`} hint="You won't be reminded about this version on startup.">
                    <button type="button" className="ghost small" onClick={() => change({ skippedVersion: null })}>Un-skip</button>
                  </Setting>
                )}
              </>
            )}
          </>
        ) : (
          <p className="muted">App updates are managed by the desktop app.</p>
        )}
      </section>

      <section className="card">
        <h3>yt-dlp</h3>
        <p className="muted">
          yt-dlp does the actual downloading. Sites change often, so update it when a site stops working.
        </p>
        {desktop ? (
          <>
            <div className="version-row">
              <div className="version">
                Version <strong>{versions ? versions.ytdlp || 'unknown' : '…'}</strong>
              </div>
              <button type="button" className="ghost" onClick={updateYtDlp} disabled={ytdlp.busy}>
                {ytdlp.busy ? 'Updating…' : 'Update yt-dlp'}
              </button>
            </div>
            {ytdlp.message && <div className={`status ${ytdlp.ok === false ? 'error' : ''}`}>{ytdlp.message}</div>}
            {settings && (
              <Setting label="Update yt-dlp on startup" hint="Keeps site support current without you having to think about it.">
                <Switch label="Update yt-dlp on startup" checked={settings.autoUpdateYtDlp} onChange={(v) => change({ autoUpdateYtDlp: v })} />
              </Setting>
            )}
          </>
        ) : (
          <p className="muted">Run <code>npm run update-ytdlp</code> to update it.</p>
        )}
      </section>

      <section className="card">
        <h3>Downloads</h3>
        <Setting label="Download folder" hint={config.downloadDir ? <code>{config.downloadDir}</code> : null}>
          <span className="actions">
            <button type="button" className="ghost small" onClick={() => fetch('/api/open-folder', { method: 'POST' })}>Open</button>
            {desktop && <button type="button" className="ghost small" onClick={chooseFolder}>Change…</button>}
            {desktop && customFolder && (
              <button type="button" className="ghost small" onClick={() => change({ downloadDir: null })}>Reset</button>
            )}
          </span>
        </Setting>
        <Setting label="Default format">
          <div className="toggle" role="radiogroup" aria-label="Default format">
            {['mp4', 'mp3'].map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={prefs.defaultFormat === f}
                className={prefs.defaultFormat === f ? 'active' : ''}
                onClick={() => setPref('defaultFormat', f)}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </Setting>
        <Setting label="Default video quality" hint="Uses the closest lower quality if a video doesn't have it.">
          <select value={prefs.defaultVideoQuality} onChange={(e) => setPref('defaultVideoQuality', e.target.value)}>
            <option value="best">Best available</option>
            {VIDEO_QUALITIES.map((h) => (
              <option key={h} value={h}>{h}p</option>
            ))}
          </select>
        </Setting>
        <Setting label="Default audio quality">
          <select value={prefs.defaultAudioQuality} onChange={(e) => setPref('defaultAudioQuality', e.target.value)}>
            {AUDIO_QUALITIES.map((q) => (
              <option key={q.value} value={q.value}>{q.label}</option>
            ))}
          </select>
        </Setting>
        <Setting
          label="Browser cookies"
          hint="For private or login-only posts (mostly Instagram). Firefox works best."
        >
          <select value={prefs.cookies} onChange={(e) => setPref('cookies', e.target.value)}>
            <option value="none">Don't use cookies</option>
            <option value="firefox">Firefox</option>
            <option value="chrome">Chrome</option>
            <option value="edge">Edge</option>
            <option value="brave">Brave</option>
          </select>
        </Setting>
      </section>

      <section className="card">
        <h3>About</h3>
        {versions && (
          <p className="muted">
            YouScrapper v{versions.app} · Electron {versions.electron} · yt-dlp {versions.ytdlp || 'unknown'}
          </p>
        )}
        <Setting label="Reset settings" hint="Restore every setting on this page to its default.">
          <button type="button" className="ghost small" onClick={resetAll}>Reset all</button>
        </Setting>
      </section>
    </div>
  );
}
