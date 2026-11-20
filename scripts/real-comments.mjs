// Crea con Nova un .pptx con comentarios (con respuestas, uno resuelto y posiciones) para abrirlo con PowerPoint real por COM
// (scripts/real-comments.ps1). Necesita `pnpm dev` en :1420. Uso: node scripts/real-comments.mjs outdir
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('ERROR', e.message));
await page.goto('http://localhost:1420/?app=slides', { waitUntil: 'load' });
await page.waitForSelector('.sl-surface');
await page.waitForTimeout(600);
const bytes = await page.evaluate(async () => {
  const m = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/slides-core/src/index.ts');
  const c = window.__novaSlides.ctl;
  const t0 = Date.UTC(2026, 10, 20, 10, 0);
  const cm = (id, author, initials, text, extra = {}) => ({ id, author, initials, text, at: t0 + Object.keys(extra).length, x: 100, y: 80, ...extra });
  c.apply('c', (d) => m.updateSlide(d, c.slide.id, (s) => ({ ...s, comments: [
    cm('c1', 'Ana María', 'AM', 'Revisar este título', { x: 100, y: 80 }),
    cm('c2', 'Luis Torres', 'LT', 'De acuerdo @Ana María\nSegunda línea', { replyTo: 'c1', at: t0 + 60000 }),
    cm('c3', 'Luis Torres', 'LT', 'Otro asunto resuelto', { x: 300, y: 200, resolved: true, at: t0 + 120000 }),
  ] })));
  return await window.__novaSlides.write();
});
fs.writeFileSync(path.join(out, 'comentarios.pptx'), Buffer.from(bytes));
await browser.close();
console.log('ok');
