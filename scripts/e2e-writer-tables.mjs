// End-to-end checks for tables in Nova Writer: properties, table styles, sort, column widths, text <-> table and .docx.
// Needs `pnpm dev` on :1420.  Usage: node scripts/e2e-writer-tables.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => {
  errors.push(`dialog: ${d.message()}`);
  d.dismiss();
});
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
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(500);
const ev = (fn, arg) => page.evaluate(fn, arg);
const editor = page.locator('.ProseMirror').first();
const dialog = () => page.getByRole('dialog');
const ok = async () => {
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(400);
};
const tableAttrs = () => ev(() => { let r; window.__novaWriter.ctl.state.doc.descendants((n) => { if (n.type.name === 'table' && !r) r = n.attrs; }); return r; });
/** Solo las propiedades que trata «Propiedades de la tabla» (la tabla tiene además título, estilo, etc.). */
const PROPS = ['borders', 'align', 'borderColor', 'borderWidth', 'padding', 'headerRow'];
const props = (a) => Object.fromEntries(PROPS.filter((k) => k in a).map((k) => [k, a[k]]));
const grid = () => ev(() => { const out = []; window.__novaWriter.ctl.state.doc.descendants((n) => { if (n.type.name === 'table_row') { const r = []; n.forEach((c) => r.push(c.textContent)); out.push(r); } }); return out; });
const cellBg = () => ev(() => { const out = []; window.__novaWriter.ctl.state.doc.descendants((n) => { if (n.type.name === 'table_cell' || n.type.name === 'table_header') out.push(n.attrs.background ?? null); }); return out; });
/** Pulsa un botón del grupo «Datos»; si la cinta lo ha colapsado en un desplegable, lo abre antes. */
const dataBtn = async (re) => {
  const direct = page.getByRole('button', { name: re });
  if (!(await direct.count())) await page.getByRole('button', { name: /^Datos/ }).click();
  await page.getByRole('button', { name: re }).first().click();
};
const tabTable = () => page.getByRole('tab', { name: 'Tabla' });
/** Escribe una tabla de 3 columnas × 4 filas y deja el cursor en la primera celda. */
const makeTable = (rows) =>
  ev((rows) => {
    const c = window.__novaWriter.ctl;
    const v = c.view;
    const { nodes } = v.state.schema;
    const cell = (x) => nodes.table_cell.create({ colwidth: [120] }, nodes.paragraph.create(null, x ? v.state.schema.text(x) : undefined));
    const t = nodes.table.create({ borders: true }, rows.map((r) => nodes.table_row.create(null, r.map(cell))));
    v.dispatch(v.state.tr.replaceSelectionWith(t));
    let pos = -1;
    v.state.doc.descendants((n, p) => { if (n.type.name === 'paragraph' && pos < 0 && n.textContent === rows[0][0]) pos = p + 1; });
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(pos))));
  }, rows);

await editor.click();
await makeTable([['Producto', 'Cantidad', 'Precio'], ['Pera', '30', '1,5'], ['manzana', '5', '12'], ['Uva', '1200', '0,75']]);
await page.waitForTimeout(400);

await check('la pestaña contextual «Tabla» ofrece estilos, ordenar, distribuir y propiedades', async () => {
  await tabTable().click();
  await shot('pestana-tabla');
  for (const n of ['Estilos de tabla', 'Propiedades de la tabla…', 'Ordenar…', 'Distribuir columnas', 'Ajustar a la ventana', 'Convertir en texto…']) {
    const re = new RegExp('^' + n.replace('…', ''));
    if (!(await page.getByRole('button', { name: re }).count()) && (await page.getByRole('button', { name: /^Datos/ }).count())) await page.getByRole('button', { name: /^Datos/ }).click();
    assert.ok((await page.getByRole('button', { name: re }).count()) > 0, n);
    await page.keyboard.press('Escape');
  }
});

await check('«Propiedades de la tabla»: centrada, borde rojo grueso, márgenes y encabezado', async () => {
  await page.getByRole('button', { name: /^Propiedades de la tabla/ }).click();
  await page.waitForTimeout(300);
  await shot('propiedades');
  await dialog().locator('#tp-al').selectOption('center');
  await dialog().locator('#tp-bc').fill('#cc0000');
  await dialog().locator('#tp-bw').fill('2');
  await dialog().locator('#tp-px').fill('9');
  await dialog().locator('#tp-py').fill('3');
  await dialog().getByLabel(/primera fila es un encabezado/).check();
  await ok();
  assert.deepEqual(props(await tableAttrs()), { borders: true, align: 'center', borderColor: '#cc0000', borderWidth: 2, padding: { x: 9, y: 3 }, headerRow: true });
  const css = await page.locator('table.nw-table').first().evaluate((el) => ({ ml: el.style.marginLeft, bc: el.style.getPropertyValue('--nw-bc'), bw: el.style.getPropertyValue('--nw-bw') }));
  assert.deepEqual(css, { ml: 'auto', bc: '#cc0000', bw: '2pt' });
  const td = await page.locator('table.nw-table td').first().evaluate((el) => { const s = getComputedStyle(el); return [s.borderTopColor, s.paddingLeft, s.paddingTop]; });
  assert.deepEqual(td, ['rgb(204, 0, 0)', '12px', '4px']); // 9 pt y 3 pt
});

await check('un estilo de tabla (Medio – Énfasis 1) pinta encabezado y filas alternas, y «Borrar estilo» los quita', async () => {
  const bgs = () => page.locator('table.nw-table tr').evaluateAll((rows) => rows.map((r) => getComputedStyle(r.firstElementChild).backgroundColor));
  await tabTable().click();
  await page.getByRole('button', { name: /^Estilos de tabla/ }).click();
  await page.getByRole('button', { name: 'Medio – Énfasis 1', exact: true }).click();
  await page.waitForTimeout(400);
  await shot('estilo-medio');
  assert.equal((await tableAttrs()).tstyle, 'medium-1');
  const bg = await bgs();
  assert.equal(bg[0], 'rgb(68, 114, 196)'); // encabezado = Énfasis 1 del tema (Office)
  assert.notEqual(bg[1], bg[2]); // bandas alternas
  await page.getByRole('button', { name: /^Estilos de tabla/ }).click();
  await page.getByRole('button', { name: 'Borrar estilo' }).click();
  await page.waitForTimeout(300);
  assert.equal((await tableAttrs()).tstyle, null);
  assert.ok((await bgs()).every((c) => c === 'rgba(0, 0, 0, 0)'));
});

await check('ordenar por una columna numérica (el encabezado se queda arriba) y por texto descendente', async () => {
  await tabTable().click();
  await dataBtn(/^Ordenar/);
  await page.waitForTimeout(300);
  await dialog().locator('#so-col').selectOption('1');
  await dialog().locator('#so-type').selectOption('number');
  await shot('ordenar');
  await ok();
  assert.deepEqual((await grid()).map((r) => r[1]), ['Cantidad', '5', '30', '1200']);
  await dataBtn(/^Ordenar/);
  await page.waitForTimeout(300);
  await dialog().locator('#so-col').selectOption('0');
  await dialog().locator('#so-dir').selectOption('desc');
  await ok();
  assert.deepEqual((await grid()).map((r) => r[0]), ['Producto', 'Uva', 'Pera', 'manzana']);
});

await check('distribuir columnas y ajustar a la ventana', async () => {
  await ev(() => {
    const c = window.__novaWriter.ctl;
    const v = c.view;
    let i = 0;
    const targets = [];
    v.state.doc.descendants((n, p) => { if (n.type.name === 'table_cell' && i++ % 3 === 0) targets.push([p, n.attrs]); });
    const tr = v.state.tr;
    for (const [p, attrs] of targets) tr.setNodeMarkup(p, undefined, { ...attrs, colwidth: [60] });
    v.dispatch(tr);
  });
  await tabTable().click();
  await dataBtn(/^Distribuir columnas/);
  await page.waitForTimeout(300);
  const w1 = await ev(() => { const out = []; window.__novaWriter.ctl.state.doc.firstChild.firstChild.firstChild; window.__novaWriter.ctl.state.doc.descendants((n) => { if (n.type.name === 'table_cell') out.push(n.attrs.colwidth[0]); }); return out.slice(0, 3); });
  assert.deepEqual(w1, [100, 100, 100]); // (60+120+120)/3
  await dataBtn(/^Ajustar a la ventana/);
  await page.waitForTimeout(300);
  const total = await ev(() => { const out = []; window.__novaWriter.ctl.state.doc.descendants((n) => { if (n.type.name === 'table_cell') out.push(n.attrs.colwidth[0]); }); return out.slice(0, 3).reduce((a, b) => a + b, 0); });
  const page_ = await ev(() => { const p = window.__novaWriter.ctl.page; return (p.width - p.marginLeft - p.marginRight) * (96 / 72); });
  assert.ok(Math.abs(total - page_) <= 2, `${total} vs ${page_}`);
});

await check('de tabla a texto y de texto a tabla', async () => {
  await tabTable().click();
  await dataBtn(/^Convertir en texto/);
  await page.waitForTimeout(300);
  await dialog().locator('#cv-sep').selectOption('semicolon');
  await ok();
  assert.equal(await ev(() => { let n = 0; window.__novaWriter.ctl.state.doc.descendants((x) => { if (x.type.name === 'table') n++; }); return n; }), 0);
  const text = await ev(() => window.__novaWriter.ctl.state.doc.textContent);
  assert.ok(text.includes('Producto;Cantidad;Precio'), text);
  // seleccionar todo y convertir a tabla
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: /^Texto a tabla/ }).click();
  await page.waitForTimeout(300);
  await dialog().locator('#cv-sep').selectOption('semicolon');
  await shot('texto-a-tabla');
  await ok();
  const g = await grid();
  assert.equal(g.length, 4);
  assert.deepEqual(g[0], ['Producto', 'Cantidad', 'Precio']);
});

await check('las propiedades de la tabla sobreviven a guardar y volver a leer el .docx', async () => {
  const out = await ev(async () => {
    const w = window.__novaWriter;
    const c = w.ctl;
    const v = c.view;
    let tp;
    v.state.doc.descendants((n, p) => { if (n.type.name === 'table' && tp === undefined) tp = p; });
    const t = v.state.doc.nodeAt(tp);
    v.dispatch(v.state.tr.setNodeMarkup(tp, undefined, { ...t.attrs, align: 'right', borderColor: '#336699', borderWidth: 1.5, padding: { x: 7, y: 2 }, headerRow: true, borders: true }));
    const { data } = await w.docx.writeDocx(c.toWriterDoc());
    const back = await w.docx.readDocx(data);
    let attrs;
    back.doc.body.descendants((n) => { if (n.type.name === 'table' && !attrs) attrs = n.attrs; });
    return attrs;
  });
  assert.deepEqual(props(out), { borders: true, align: 'right', borderColor: '#336699', borderWidth: 1.5, padding: { x: 7, y: 2 }, headerRow: true });
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
