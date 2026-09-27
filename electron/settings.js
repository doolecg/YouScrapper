// App-level settings, saved as JSON in %APPDATA%\YouScrapper\settings.json.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  autoCheckUpdates: true,
  autoInstallUpdates: false,
  includePrereleases: false,
  skippedVersion: null,
  lastUpdateCheck: null,
  autoUpdateYtDlp: false,
  downloadDir: null, // null = %USERPROFILE%\Downloads\YouScrapper
};

// Keys the settings page may change, with the type each one must have.
const EDITABLE = {
  autoCheckUpdates: 'boolean',
  autoInstallUpdates: 'boolean',
  includePrereleases: 'boolean',
  autoUpdateYtDlp: 'boolean',
  skippedVersion: 'string',
  downloadDir: 'string',
};

const file = () => path.join(app.getPath('userData'), 'settings.json');
let current;

export function getSettings() {
  if (!current) {
    try {
      current = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
    } catch {
      current = { ...DEFAULTS };
    }
  }
  return current;
}

function save(next) {
  current = next;
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(current, null, 2));
  return current;
}

// Internal updates (e.g. lastUpdateCheck) skip validation.
export function setSettings(patch) {
  return save({ ...getSettings(), ...patch });
}

// Updates coming from the renderer: only known keys, right type, or null to reset.
export function setSettingsFromUi(patch) {
  const clean = {};
  for (const [key, value] of Object.entries(patch || {})) {
    const type = EDITABLE[key];
    if (!type) continue;
    if (value === null && DEFAULTS[key] === null) clean[key] = null;
    else if (typeof value === type) clean[key] = value;
  }
  return setSettings(clean);
}

export function resetSettings() {
  return save({ ...DEFAULTS });
}
