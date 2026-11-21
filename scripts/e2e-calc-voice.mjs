// End-to-end checks for «Hablar celdas» in Nova Calc with the real voices of Windows: the selected cells are read by rows or by columns, the bar shows the
// cell being read, empty and hidden cells are skipped, and a cell can be said as it is entered. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-calc-voice.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=calc';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 2400, height: 950 } })).newPage();
page.setDefaultTimeout(90000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|404|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.calc-grid__scroller');
await page.waitForFunction(() => !!window.__novaCalc);
await page.waitForTimeout(500);
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
const ev = (fn, arg) => page.evaluate(fn, arg);
const bar = () => page.getByRole('toolbar', { name: 'Leer en voz alta' });
const texts = () => ev(() => { const r = window.__novaCalc.doc.reader.voice.reader; return r.pieces.map((u, i) => r.blockOf(i).text.slice(u.start, u.end)); });

// A1:C3 with a gap, and a hidden column
await ev(() => {
  const d = window.__novaCalc.doc;
  const put = (r, c, v) => d.wb.setInput(d.activeSheetId, r, c, v);
  put(0, 0, 'Producto'); put(0, 1, 'Unidades'); put(0, 2, 'Precio');
  put(1, 0, 'Lápiz'); put(1, 1, '12'); put(1, 2, '3,5');
  put(2, 0, 'Cuaderno'); put(2, 2, '1200');
});
const select = (r1, c1, r2, c2) => ev(([r1, c1, r2, c2]) => { const d = window.__novaCalc.doc; d.selectCell(r1, c1); d.selectCell(r2, c2, { extend: true }); }, [r1, c1, r2, c2]);

await check('«Hablar celdas» lee la selección por filas, salta las vacías y muestra la barra', async () => {
  await select(0, 0, 2, 2);
  await ev(() => window.__novaCalc.doc.reader.start());
  await bar().waitFor();
  assert.deepEqual(await texts(), ['Producto', 'Unidades', 'Precio', 'Lápiz', '12', '3,5', 'Cuaderno', '1200']);
  assert.equal(await bar().getByText('No hay una voz instalada').count(), 0);
  await shot('filas');
});

await check('la barra dice qué celda lee y marca la palabra', async () => {
  const text = page.getByTestId('nv-voicebar-text');
  await page.waitForFunction(() => /^[A-Z]+\d+: /.test(document.querySelector('[data-testid=nv-voicebar-text]')?.textContent ?? ''), null, { timeout: 20000 });
  assert.match(await text.innerText(), /^A1: Producto/);
  assert.equal(await ev(() => window.__novaCalc.doc.sel.ranges[0].r2), 2, 'la selección no se mueve');
});

await check('por columnas lee de arriba abajo y luego hacia la derecha', async () => {
  await ev(() => window.__novaCalc.doc.reader.stop());
  await ev(() => { window.__novaCalc.doc.reader.byColumns = true; });
  await select(0, 0, 2, 2);
  await ev(() => window.__novaCalc.doc.reader.start());
  await bar().waitFor();
  assert.deepEqual(await texts(), ['Producto', 'Lápiz', 'Cuaderno', 'Unidades', '12', 'Precio', '3,5', '1200']);
  await ev(() => { window.__novaCalc.doc.reader.stop(); window.__novaCalc.doc.reader.byColumns = false; });
});

await check('con una sola celda lee esa celda; las filas y columnas ocultas no se leen', async () => {
  await select(1, 0, 1, 0);
  await ev(() => window.__novaCalc.doc.reader.start());
  await bar().waitFor();
  assert.deepEqual(await texts(), ['Lápiz']);
  await ev(() => window.__novaCalc.doc.reader.stop());
  await ev(() => { const d = window.__novaCalc.doc; d.sheet.hiddenCols.add(1); });
  await select(0, 0, 2, 2);
  await ev(() => window.__novaCalc.doc.reader.start());
  const t = await texts();
  assert.ok(!t.includes('Unidades') && !t.includes('12') && t.includes('Precio'), t.join(' | '));
  await ev(() => { const d = window.__novaCalc.doc; window.__novaCalc.doc.reader.stop(); d.sheet.hiddenCols.delete(1); });
});

await check('pausa, continuar y detener desde la barra', async () => {
  await select(0, 0, 2, 2);
  await ev(() => window.__novaCalc.doc.reader.start());
  await bar().waitFor();
  await bar().getByRole('button', { name: 'Pausa' }).click();
  assert.equal(await ev(() => window.__novaCalc.doc.reader.voice.snapshot.state), 'paused');
  await bar().getByRole('button', { name: 'Reproducir' }).click();
  assert.equal(await ev(() => window.__novaCalc.doc.reader.voice.snapshot.state), 'playing');
  await bar().getByRole('button', { name: 'Cerrar la lectura' }).click();
  await bar().waitFor({ state: 'detached' });
  assert.equal(await ev(() => window.speechSynthesis.speaking), false);
});

await check('«Hablar celdas al pulsar Intro» dice la celda que se acaba de escribir (sin barra)', async () => {
  await ev(() => { window.__novaCalc.doc.reader.speakOnEnter = true; });
  await ev(() => window.__novaCalc.doc.selectCell(6, 0));
  await ev(() => { const d = window.__novaCalc.doc; d.beginEdit({ text: 'Escrito ahora', mode: 'enter' }); d.commitEdit('down'); });
  await page.waitForFunction(() => window.speechSynthesis.speaking || window.__novaCalc.doc.reader.voice.reader.snapshot.state === 'playing', null, { timeout: 8000 });
  assert.equal(await bar().count(), 0, 'no abre la barra');
  assert.equal(await ev(() => { const r = window.__novaCalc.doc.reader.voice.reader; return r.blockOf(0)?.text; }), 'Escrito ahora');
  await ev(() => { const r = window.__novaCalc.doc.reader; r.speakOnEnter = false; });
  assert.equal(await ev(() => window.speechSynthesis.speaking), false);
});

await check('en la cinta, Vista › Voz tiene «Hablar celdas»', async () => {
  await page.getByRole('tab', { name: 'Vista', exact: true }).click();
  const names = await page.getByRole('button').evaluateAll((l) => l.map((b) => b.getAttribute('aria-label') ?? b.textContent).filter(Boolean));
  assert.ok(names.some((n) => /Hablar celdas/.test(n)), 'botón «Hablar celdas»');
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
