// Screenshot helper: node scripts/shot.mjs <url> <out.png> [width] [height] [--script file.mjs]
// Uses the Microsoft Edge that ships with Windows (no browser download).
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [url, out, w = '1280', h = '800', scriptFlag, scriptPath] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node scripts/shot.mjs <url> <out.png> [width] [height] [--script file.mjs]');
  process.exit(2);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
if (scriptFlag === '--script' && scriptPath) {
  const mod = await import(pathToFileURL(path.resolve(scriptPath)).href);
  await mod.default(page);
}
// The first capture after load can come back blank in headless Edge; take a throwaway one first.
await page.screenshot();
await page.waitForTimeout(300);
await page.screenshot({ path: out });
await browser.close();
if (logs.length) console.log(logs.join('\n'));
console.log('saved', out);
