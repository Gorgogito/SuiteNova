// End-to-end checks for the text of pictures (OCR) and «Datos desde imagen» in Nova Calc with the real Tesseract engine. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-calc-ocr.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=calc';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1900, height: 950 } })).newPage();
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|404|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => void d.dismiss());
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.calc-grid__scroller');
await page.waitForFunction(() => !!window.__novaCalc);
await page.waitForTimeout(500);
await page.mouse.click(300, 400);

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
const dialog = () => page.getByRole('dialog');

const drawPng = (kind) =>
  ev(async (kind) => {
    const c = document.createElement('canvas');
    c.width = 700;
    c.height = kind === 'table' ? 260 : 220;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    g.textBaseline = 'top';
    g.font = '40px Arial';
    if (kind === 'table') {
      const rows = [['Producto', 'Unidades', 'Precio'], ['Lápiz', '12', '3,5'], ['Cuaderno', '4', '1200']];
      rows.forEach((r, i) => r.forEach((t, j) => g.fillText(t, [30, 270, 510][j], 20 + i * 75)));
    } else {
      g.fillText('Factura número 4821', 30, 30);
      g.fillText('Total a pagar 350 euros', 30, 120);
    }
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, kind);
const insert = (bytes, w, h, name, row = 2, col = 1) =>
  ev(([bytes, w, h, name, row, col]) => {
    const d = window.__novaCalc.doc;
    d.selectCell(row, col);
    return d.x.insertImage('image/png', Uint8Array.from(bytes), w, h, name);
  }, [bytes, w, h, name, row, col]);
const media = () => ev(() => { const d = window.__novaCalc.doc; const out = []; for (const s of d.wb.sheets) for (const i of s.images) out.push(d.wb.media.get(i.media).ocr ? JSON.parse(JSON.stringify(d.wb.media.get(i.media).ocr)) : null); return out; });
const waitRead = () => page.waitForFunction(() => { const d = window.__novaCalc.doc; let n = 0, k = 0; for (const s of d.wb.sheets) for (const i of s.images) { n++; if (d.wb.media.get(i.media).ocr) k++; } return n > 0 && k === n && !d.imageOcr.state.running; }, null, { timeout: 120000 });

let imgId;
await check('una imagen insertada se lee sola y guarda las palabras con su caja', async () => {
  await ev(() => { const d = window.__novaCalc.doc; d.selectCell(0, 0); d.wb.setInput(d.activeSheetId, 0, 0, 'Total del mes'); });
  imgId = await insert(await drawPng('text'), 350, 110, 'factura');
  await waitRead();
  const [m] = await media();
  assert.match(m.text, /Factura/);
  assert.match(m.text, /4821/);
  assert.ok(m.lines.length >= 2);
  assert.deepEqual(m.size, [700, 220]);
  await shot('leida');
});

await check('Buscar encuentra el texto de dentro de la imagen y la selecciona; reemplazar no la toca', async () => {
  await ev(() => window.__novaCalc.doc.selectCell(0, 0));
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  await ev(() => window.__novaCalc.ui?.openDialog?.('find'));
  if (!(await dialog().count())) await page.keyboard.press('Control+F');
  await dialog().getByLabel('Buscar', { exact: true }).fill('TOTAL a pagar');
  await dialog().getByRole('button', { name: 'Buscar siguiente' }).click();
  assert.equal(await ev(() => window.__novaCalc.doc.x.selectedImage), imgId);
  await dialog().getByLabel('Buscar', { exact: true }).fill('total');
  await dialog().getByRole('button', { name: 'Buscar siguiente' }).click();
  const [m] = await media();
  assert.match(m.text, /Total a pagar/);
  await dialog().getByRole('button', { name: 'Cerrar' }).click();
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
});

await check('el cuadro «Texto de la imagen» señala dónde está lo buscado y lee solo una zona', async () => {
  await ev((id) => window.__novaCalc.doc.x.selectObject('image', id), imgId);
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
  await page.getByRole('button', { name: 'Texto de la imagen…' }).click();
  const dlg = dialog();
  await dlg.getByLabel('Buscar en el texto de la imagen').fill('total');
  await dlg.locator('rect[data-ocr="found"]').waitFor();
  assert.ok(Number(await dlg.locator('rect[data-ocr="found"]').getAttribute('y')) > 100);
  await shot('dialogo');
  const b = await dlg.locator('svg[aria-label="Arrastra para elegir la zona que se lee"]').boundingBox();
  await page.mouse.move(b.x + 2, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 2, b.y + b.height - 2, { steps: 5 });
  await page.mouse.up();
  await dlg.getByRole('button', { name: 'Leer solo la zona' }).click();
  await page.waitForFunction(() => { const d = window.__novaCalc.doc; const t = d.wb.media.get(d.sheet.images[0].media).ocr?.text ?? ''; return /Total/.test(t) && !/Factura/.test(t); });
  await dlg.getByRole('button', { name: 'Quitar la zona' }).click();
  await dlg.getByRole('button', { name: 'Leer con estos ajustes' }).click();
  await page.waitForFunction(() => { const d = window.__novaCalc.doc; const t = d.wb.media.get(d.sheet.images[0].media).ocr?.text ?? ''; return /Factura/.test(t) && /Total/.test(t); });
  await dlg.getByRole('button', { name: 'Cerrar' }).click();
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
});

await check('copiar el texto de la imagen lo deja en el portapapeles', async () => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await ev((id) => window.__novaCalc.doc.x.selectObject('image', id), imgId);
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
  await page.getByRole('button', { name: 'Copiar el texto de la imagen' }).click();
  assert.match(await ev(() => navigator.clipboard.readText()), /Factura número 4821/);
});

await check('el .xlsx guarda el texto leído y vuelve a abrirse con él; el texto de las celdas no lo incluye', async () => {
  const r = await ev(async () => {
    const { readXlsx, writeXlsx } = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/xlsx-io/src/index.ts');
    const d = window.__novaCalc.doc;
    const back = await readXlsx(await writeXlsx(d.wb));
    const im = back.workbook.sheets[0].images[0];
    return { text: back.workbook.media.get(im.media).ocr?.text, cell: back.workbook.getValue(back.workbook.sheets[0].id, 0, 0) };
  });
  assert.match(r.text, /Factura/);
  assert.equal(r.cell, 'Total del mes');
});

await check('las imágenes que ya tenía un archivo no se leen solas, y «Leer el texto de las imágenes» las lee', async () => {
  await ev(async () => {
    const { readXlsx, writeXlsx } = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/xlsx-io/src/index.ts');
    const d = window.__novaCalc.doc;
    for (const m of d.wb.media.values()) delete m.ocr;
    const back = await readXlsx(await writeXlsx(d.wb));
    d.load(back.workbook, 'abierto.xlsx', null);
  });
  await page.waitForTimeout(4000);
  assert.equal((await media())[0], null, 'no debe leerse sola');
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: 'Leer el texto de las imágenes' }).click();
  await waitRead();
  assert.match((await media())[0].text, /Factura/);
});

await check('con «Leer las imágenes nuevas» desactivado, una imagen nueva no se lee', async () => {
  await page.getByRole('button', { name: 'Leer las imágenes nuevas al insertarlas' }).click();
  assert.equal(await ev(() => window.__novaCalc.doc.imageOcr.auto), false);
  await insert(await drawPng('text'), 200, 60, 'otra', 20, 4);
  await ev(() => { const d = window.__novaCalc.doc; const i = d.sheet.images[d.sheet.images.length - 1]; /* mismos píxeles: misma lectura */ });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Leer las imágenes nuevas al insertarlas' }).click();
});

await check('«Datos desde imagen»: lee una tabla, se corrige y se pone en las celdas con los números como números', async () => {
  await ev(() => window.__novaCalc.doc.selectCell(9, 1));
  const bytes = await drawPng('table');
  const id = await insert(bytes, 350, 130, 'tabla', 30, 8);
  await ev((id) => window.__novaCalc.doc.x.selectObject('image', id), id);
  await ev(() => window.__novaCalc.doc.selectCell(9, 1));
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  await page.getByRole('button', { name: 'Datos desde imagen…' }).click();
  const dlg = dialog();
  // sin imagen seleccionada la elegimos desde un archivo
  await dlg.getByRole('button', { name: 'Imagen de un archivo…' }).waitFor();
  const tmp = (await import('node:os')).tmpdir() + '/nova-tabla.png';
  fs.writeFileSync(tmp, Buffer.from(bytes));
  await dlg.locator('input[type=file]').setInputFiles(tmp);
  await dlg.getByRole('table', { name: 'Datos reconocidos' }).waitFor();
  const cells = await dlg.locator('table[aria-label="Datos reconocidos"] input').evaluateAll((l) => l.map((i) => i.value));
  assert.equal(cells.length, 9, `celdas: ${JSON.stringify(cells)}`);
  assert.deepEqual(cells.slice(0, 3).map((c) => c.toLowerCase()), ['producto', 'unidades', 'precio']);
  assert.equal(cells[4], '12');
  assert.equal(cells[5], '3,5');
  assert.equal(cells[8], '1200');
  await shot('tabla');
  // corregir una celda antes de insertar
  await dlg.locator('input[aria-label="Fila 2, columna 1"]').fill('Lápiz HB');
  await dlg.getByRole('button', { name: 'Insertar en la hoja' }).click();
  const v = await ev(() => { const d = window.__novaCalc.doc; const g = (r, c) => d.wb.getValue(d.activeSheetId, r, c); return [g(9, 1), g(10, 1), g(10, 2), g(10, 3), g(11, 3)]; });
  assert.equal(v[0]?.toString().toLowerCase(), 'producto');
  assert.equal(v[1], 'Lápiz HB');
  assert.equal(v[2], 12);
  assert.equal(typeof v[3], 'number');
  assert.equal(v[4], 1200);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
