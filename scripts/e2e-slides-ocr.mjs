// End-to-end checks for the text of pictures (OCR) in Nova Slides with the real Tesseract engine: reading what is inserted, finding it with Find,
// the dialog with where it is, the .pptx, and that a file's own pictures are not read until asked. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-slides-ocr.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from '../apps/suite/node_modules/jszip/lib/index.js';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=slides';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 2400, height: 950 } })).newPage();
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => void d.dismiss());
let step = 0;
const shot = async (name) => {
  if (!shotsDir) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 8).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.sl-stage, .sl-canvas, [data-slide]', { timeout: 60000 }).catch(() => {});
await page.waitForFunction(() => !!window.__novaSlides, null, { timeout: 60000 });
await page.waitForTimeout(600);
const ev = (fn, arg) => page.evaluate(fn, arg);
// a command of the picture tab: on its own button, or inside its group when the ribbon is too narrow to show it
const cmd = async (label) => {
  const b = page.getByRole('button', { name: label, exact: true }).first();
  if (await b.isVisible().catch(() => false)) await b.click();
  else {
    await page.getByRole('button', { name: 'Texto', exact: true }).first().click();
    await page.getByRole('menuitem', { name: label }).click();
  }
};

const makePng = () =>
  ev(() => {
    const c = document.createElement('canvas');
    c.width = 700;
    c.height = 220;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 700, 220);
    g.fillStyle = '#000';
    g.textBaseline = 'top';
    g.font = '48px Arial';
    g.fillText('Factura número 4821', 30, 30);
    g.fillText('Total a pagar 350 euros', 30, 120);
    return c.toDataURL('image/png').split(',')[1];
  });
const insertPng = (b64) => ev((b64) => window.__novaSlides.ctl.emit('files', [new File([Uint8Array.from(atob(b64), (x) => x.charCodeAt(0))], 'factura.png', { type: 'image/png' })]), b64);
const pics = () => ev(() => { const c = window.__novaSlides.ctl; const out = []; for (const s of c.realDeck.slides) for (const e of s.shapes) if (e.kind === 'pic') out.push({ id: e.id, ocr: c.realDeck.assets[e.src]?.ocr ? JSON.parse(JSON.stringify(c.realDeck.assets[e.src].ocr)) : null }); return out; });
const waitRead = () => page.waitForFunction(() => { const c = window.__novaSlides.ctl; const d = c.realDeck; let n = 0, k = 0; for (const s of d.slides) for (const e of s.shapes) if (e.kind === 'pic') { n++; if (d.assets[e.src]?.ocr) k++; } return n > 0 && k === n && !c.imageOcr.state.running; }, null, { timeout: 120000 });

const B64 = await makePng();

await check('una imagen insertada se lee sola y guarda las palabras con su caja', async () => {
  await insertPng(B64);
  await waitRead();
  const [p] = await pics();
  assert.match(p.ocr.text, /Factura/);
  assert.match(p.ocr.text, /4821/);
  assert.ok(p.ocr.lines.length >= 2);
  assert.deepEqual(p.ocr.size, [700, 220]);
  await shot('leida');
});

await check('Buscar y reemplazar encuentra el texto de dentro de la imagen, la elige, y reemplazar no la toca', async () => {
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  await page.getByRole('button', { name: 'Buscar y reemplazar…' }).first().click();
  await page.getByLabel('Buscar', { exact: true }).fill('TOTAL a pagar');
  await page.getByRole('button', { name: 'Buscar siguiente', exact: true }).click();
  assert.match(await page.getByRole('status').last().innerText(), /Coincidencia 1 de 1.*Total a pagar/);
  const sel = await ev(() => window.__novaSlides.ctl.selected.map((e) => e.kind));
  assert.deepEqual(sel, ['pic']);
  await page.getByLabel('Reemplazar con').fill('XX');
  await page.getByRole('button', { name: 'Reemplazar todas', exact: true }).click();
  const [p] = await pics();
  assert.match(p.ocr.text, /Total a pagar/);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
});

await check('el cuadro «Texto de la imagen» señala dónde está lo buscado y lee solo una zona', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; const p = c.slide.shapes.find((e) => e.kind === 'pic'); c.select([p.id]); });
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
  await cmd('Texto de la imagen…');
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Buscar en el texto de la imagen').fill('total');
  await dlg.locator('rect[data-ocr="found"]').waitFor();
  const y = Number(await dlg.locator('rect[data-ocr="found"]').getAttribute('y'));
  assert.ok(y > 100, `y=${y}`);
  await shot('dialogo');
  const svg = dlg.locator('svg[aria-label="Arrastra para elegir la zona que se lee"]');
  const b = await svg.boundingBox();
  await page.mouse.move(b.x + 2, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 2, b.y + b.height - 2, { steps: 5 });
  await page.mouse.up();
  await dlg.getByRole('button', { name: 'Leer solo la zona' }).click();
  await page.waitForFunction(() => { const c = window.__novaSlides.ctl; const p = c.slide.shapes.find((e) => e.kind === 'pic'); const t = c.realDeck.assets[p.src].ocr?.text ?? ''; return /Total/.test(t) && !/Factura/.test(t); });
  await dlg.getByRole('button', { name: 'Quitar la zona' }).click();
  await dlg.getByRole('button', { name: 'Leer con estos ajustes' }).click();
  await page.waitForFunction(() => { const c = window.__novaSlides.ctl; const p = c.slide.shapes.find((e) => e.kind === 'pic'); const t = c.realDeck.assets[p.src].ocr?.text ?? ''; return /Factura/.test(t) && /Total/.test(t); });
  await dlg.getByRole('button', { name: 'Cerrar' }).click();
});

await check('copiar el texto de la imagen lo deja en el portapapeles', async () => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await ev(() => { const c = window.__novaSlides.ctl; const p = c.slide.shapes.find((e) => e.kind === 'pic'); c.select([p.id]); });
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
  await cmd('Copiar el texto de la imagen');
  assert.match(await ev(() => navigator.clipboard.readText()), /Factura número 4821/);
});

await check('el .pptx lleva el texto en una parte propia, vuelve a abrirse con él, y no está en el texto de la diapositiva', async () => {
  const bytes = await ev(async () => await window.__novaSlides.write());
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  assert.ok(zip.file('customXml/novaOcr1.xml'), 'sin parte propia');
  const slideXml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.ok(!slideXml.includes('4821'));
  const r = await ev(async (b) => {
    const m = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/slides-core/src/index.ts');
    const d = (await m.readPptx(Uint8Array.from(b))).deck;
    const out = [];
    for (const s of d.slides) for (const e of s.shapes) if (e.kind === 'pic') out.push(d.assets[e.src]?.ocr?.text ?? null);
    return out;
  }, bytes);
  assert.match(r[0], /Factura/);
});

await check('las imágenes que ya tenía un archivo no se leen solas, y «Leer el texto de las imágenes» las lee', async () => {
  const bytes = await ev(async () => {
    const c = window.__novaSlides.ctl;
    const m = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/slides-core/src/index.ts');
    const d = { ...c.realDeck, assets: Object.fromEntries(Object.entries(c.realDeck.assets).map(([k, a]) => { const { ocr, ...rest } = a; return [k, rest]; })) };
    return [...(await m.writePptx(d)).data];
  });
  await ev((b) => window.__novaSlides.load(b, 'abierto.pptx'), bytes);
  await page.waitForTimeout(4000);
  assert.equal((await pics())[0].ocr, null, 'no debe leerse sola');
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: 'Leer el texto de las imágenes' }).click();
  await waitRead();
  assert.match((await pics())[0].ocr.text, /Factura/);
});

await check('con «Leer las imágenes nuevas» desactivado, una imagen nueva no se lee', async () => {
  await page.getByRole('button', { name: 'Leer las imágenes nuevas al insertarlas' }).click();
  assert.equal(await ev(() => window.__novaSlides.ctl.imageOcr.auto), false);
  await ev((b) => window.__novaSlides.ctl.emit('files', [new File([Uint8Array.from(atob(b), (x) => x.charCodeAt(0))], 'otra.png', { type: 'image/png' })]), await ev(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 100; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 300, 100); g.fillStyle = '#000'; g.font = '40px Arial'; g.fillText('Otra imagen', 10, 30); return c.toDataURL('image/png').split(',')[1]; }));
  await page.waitForTimeout(4000);
  assert.ok((await pics()).some((p) => p.ocr === null), 'la imagen nueva sigue sin leer');
  await page.getByRole('button', { name: 'Leer las imágenes nuevas al insertarlas' }).click();
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
