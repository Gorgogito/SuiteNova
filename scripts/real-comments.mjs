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
const xb = await page.evaluate(async () => {
  const { Workbook } = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/calc-engine/src/index.ts');
  const { writeXlsx } = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/xlsx-io/src/index.ts');
  const w = new Workbook();
  w.editObjects(w.sheets[0].id, (s) => {
    s.threads.push({ id: 't1', row: 1, col: 1, resolved: true, messages: [
      { id: 'm1', author: 'Ana María', date: '2026-11-20T10:00:00.000Z', text: 'Revisar este dato' },
      { id: 'm2', author: 'Luis Torres', date: '2026-11-20T10:05:00.000Z', text: 'De acuerdo @Ana María' },
    ] });
    s.threads.push({ id: 't2', row: 5, col: 2, messages: [{ id: 'm3', author: 'Luis Torres', date: '2026-11-20T11:00:00.000Z', text: 'Otro asunto' }] });
    s.comments.push({ row: 3, col: 3, author: 'Pablo', text: 'Una nota clásica' });
  });
  const data = await writeXlsx(w);
  return [...data];
});
fs.writeFileSync(path.join(out, 'comentarios.xlsx'), Buffer.from(xb));
const vb = await page.evaluate(async () => {
  const m = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/diagram-core/src/index.ts');
  let d = m.newDiagram('Con comentarios');
  const ra = m.addShape(d.pages[0], 'process', 200, 150, { text: 'Paso uno' });
  const rb = m.addShape(ra.page, 'decision', 500, 300, { text: 'Decision' });
  const msg = (id, author, text, min) => ({ id, author, initials: author[0], date: new Date(Date.UTC(2026, 10, 20, 10, min)).toISOString(), text });
  const p = { ...rb.page, threads: [
    { id: 't1', shape: ra.shape.id, messages: [msg('m1', 'Ana María', 'Revisar este paso', 0), msg('m2', 'Luis Torres', 'De acuerdo', 5)] },
    { id: 't2', shape: rb.shape.id, resolved: true, messages: [msg('m3', 'Luis Torres', 'Revisar la decisión', 10)] },
    { id: 't3', messages: [msg('m4', 'Ana María', 'De toda la página', 20)] },
  ] };
  d = { ...d, pages: [p] };
  return [...(await m.exportVsdx(d))];
});
fs.writeFileSync(path.join(out, 'comentarios.vsdx'), Buffer.from(vb));
await browser.close();
console.log('ok');
