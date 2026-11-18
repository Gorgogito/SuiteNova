// Genera con Nova un .docx, un .pptx y un .xlsx con las mismas 5 ecuaciones, para abrirlos con Word, PowerPoint y Excel reales (COM).
// Necesita `pnpm dev` en :1420. Uso: node scripts/real-equations.mjs outdir
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const TEXS = [String.raw`a^2+b^2=c^2`, String.raw`\frac{a}{b}`, String.raw`\sqrt{x^2+y^2}`, String.raw`\sum_{i=1}^{n} i`, String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`];
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const save = (name, b64) => fs.writeFileSync(path.join(out, name), Buffer.from(b64, 'base64'));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const open = async (app, sel) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('ERROR', app, e.message));
  await p.goto(`http://localhost:1420/?app=${app}`, { waitUntil: 'load' });
  await p.waitForSelector(sel);
  await p.waitForTimeout(600);
  return p;
};

const w = await open('writer', '.ProseMirror');
await w.evaluate(() => window.__novaWriter.ctl.newDoc());
await w.waitForTimeout(600);
await w.locator('.ProseMirror').click();
const wb = await w.evaluate(async (texs) => {
  const c = window.__novaWriter.ctl;
  texs.forEach((tex, i) => {
    const v = c.mainView;
    v.dispatch(v.state.tr.insertText(`Ecuación ${i + 1}: `).replaceSelectionWith(v.state.schema.nodes.math.create({ tex, display: i % 2 === 1 })).insertText(' fin. '));
  });
  const { data } = await window.__novaWriter.docx.writeDocx(c.toWriterDoc());
  let s = '';
  for (const b of data) s += String.fromCharCode(b);
  return btoa(s);
}, TEXS);
save('ecuaciones.docx', wb);

const s = await open('slides', '.sl-surface');
const pb = await s.evaluate(async (texs) => {
  const m = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/slides-core/src/index.ts');
  const c = window.__novaSlides.ctl;
  c.newDoc();
  texs.forEach((tex, i) => c.addElement(m.newMathBox({ tex, display: true, size: 20 + i * 4 }, 60, 40 + i * 90, 400, 70)));
  return await window.__novaSlides.write();
}, TEXS);
fs.writeFileSync(path.join(out, 'ecuaciones.pptx'), Buffer.from(pb));

const x = await open('calc', '.calc-grid__scroller');
const xb = await x.evaluate(async ([texs, png]) => {
  const d = window.__novaCalc.doc;
  const bytes = Uint8Array.from(atob(png), (ch) => ch.charCodeAt(0));
  texs.forEach((tex, i) => {
    d.selectRange({ r1: i * 4, c1: 0, r2: i * 4, c2: 0 });
    d.x.insertEquation(tex, 14 + i * 2, { bytes, w: 260, h: 50 });
  });
  const { writeXlsx } = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/xlsx-io/src/index.ts');
  const data = await writeXlsx(d.wb);
  let s = '';
  for (const b of data) s += String.fromCharCode(b);
  return btoa(s);
}, [TEXS, PNG]);
save('ecuaciones.xlsx', xb);
await browser.close();
console.log('listo:', fs.readdirSync(out).join(', '));
