// Renders slide N of every sample .pptx in a folder and writes contact sheets. Usage:
//   node scripts/gallery-slides.mjs <samplesDir> <outDir> [filterRegex] [slideIndex]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const [, , dir, out, filter = '.', slideArg = '0'] = process.argv;
fs.mkdirSync(out, { recursive: true });
const files = fs.readdirSync(dir).filter((f) => /\.(pptx|ppsx)$/i.test(f) && new RegExp(filter, 'i').test(f));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:1420/?app=slides', { waitUntil: 'networkidle' });
await page.waitForSelector('#sl-stage');
const shots = [];
for (const f of files) {
  try {
    const bytes = [...fs.readFileSync(path.join(dir, f))];
    const r = await page.evaluate((b) => window.__novaSlides.load(b), bytes);
    const idx = Math.min(Number(slideArg), Math.max(0, r.slides - 1));
    await page.evaluate((i) => window.__novaSlides.show(i), idx);
    await page.waitForTimeout(350);
    const png = await page.locator('#sl-stage').screenshot();
    shots.push({ f, png: png.toString('base64'), slides: r.slides, warn: r.warnings.length });
  } catch (e) {
    shots.push({ f, err: e.message.split('\n')[0] });
  }
}
// contact sheets of 6 (2 × 3)
for (let i = 0, n = 0; i < shots.length; i += 6, n++) {
  const chunk = shots.slice(i, i + 6);
  const html = `<body style="margin:0;background:#444;font:12px sans-serif;color:#fff"><div style="display:grid;grid-template-columns:repeat(2,640px);gap:6px;padding:6px">${chunk.map((s) => `<div><div style="height:16px;overflow:hidden">${s.f} (${s.slides ?? '?'} sl)${s.err ? ' ERR ' + s.err : ''}</div>${s.png ? `<img src="data:image/png;base64,${s.png}" width="640" height="360">` : ''}</div>`).join('')}</div></body>`;
  await page.setContent(html);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, `sheet-${String(n).padStart(2, '0')}.png`), fullPage: true });
}
console.log(files.length, 'files;', errors.length, 'page errors', errors.slice(0, 5));
await browser.close();
