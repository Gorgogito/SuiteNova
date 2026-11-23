// Cuts the corpus into sentences with the shared reader's rules (`speech-core`) and writes them to a JSON file, to compare with Word's. Needs `pnpm dev` on :1420.
// Usage: node scripts/voice-compare/ours.mjs <out.json>
import { chromium } from '../../apps/suite/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const corpus = JSON.parse(fs.readFileSync(new URL('./corpus.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext()).newPage();
await page.goto('http://localhost:1420/?app=notes', { waitUntil: 'load' });
await page.waitForSelector('.nn-canvas');
const out = await page.evaluate(async (corpus) => {
  const core = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/speech-core/src/index.ts');
  return corpus.map((t) => core.pieces(t).map((s) => t.slice(s.start, s.end)));
}, corpus);
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
await browser.close();
console.log(`${out.length} párrafos, ${out.flat().length} frases`);
