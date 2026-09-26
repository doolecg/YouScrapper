// Publishes the built MSI + portable exe to the public releases repo: `npm run release`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const REPO = 'doolecg/YouScrapper';
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const files = [`release/YouScrapper-Setup-${version}.msi`, `release/YouScrapper-Portable-${version}.exe`];
for (const f of files) if (!fs.existsSync(f)) throw new Error(`Missing ${f}. Run npm run dist first.`);

execFileSync('gh', ['release', 'create', `v${version}`, ...files, '--repo', REPO, '--title', `YouScrapper v${version}`, '--generate-notes'], { stdio: 'inherit' });
