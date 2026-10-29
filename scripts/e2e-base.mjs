// End-to-end checks for Nova Base in a real browser (Edge). Needs `pnpm dev` running on :1420.
// Usage: node scripts/e2e-base.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from '../packages/writer-core/node_modules/jszip/lib/index.js';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=base';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-base-'));

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
const dialogs = [];
page.on('dialog', (d) => {
  if (d.type() === 'confirm' && /^¿Eliminar/.test(d.message())) return void d.accept();
  dialogs.push(d.message());
  d.dismiss();
});

let step = 0;
const shot = async (name) => {
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 7).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
const db = (fn, arg) => page.evaluate(fn, arg);
const settle = () => page.waitForTimeout(150);
const nav = (name) => page.locator('.bs-nav-pane li button', { hasText: new RegExp(`^${name}$`) });
const cellText = (r, c) => page.locator(`.bs-grid [role="row"][aria-rowindex="${r + 2}"] [role="gridcell"][aria-colindex="${c + 1}"]`).innerText();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__novaBase?.ctl.loading === false);
await page.screenshot(); // first capture after load can be blank

await check('engine loads; ribbon tabs and navigation pane', async () => {
  for (const tab of ['Inicio', 'Crear', 'Datos externos', 'Herramientas', 'Vista', 'Ayuda']) assert.ok(await page.getByRole('tab', { name: tab, exact: true }).count(), tab);
  for (const g of ['Tablas', 'Consultas', 'Formularios', 'Informes']) assert.ok(await page.locator('.bs-nav-pane h3', { hasText: g }).count(), g);
  assert.equal(await db(() => window.__novaBase.ctl.error), null);
});

await check('design a table: fields, types, constraints, save', async () => {
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Tabla', exact: true }).click();
  await page.getByLabel('Nombre de la tabla').fill('Clientes');
  await page.getByLabel('Nombre del campo 2').fill('Nombre');
  await page.getByRole('button', { name: 'Agregar campo' }).click();
  await page.getByLabel('Nombre del campo 3').fill('Edad');
  await page.getByLabel('Tipo de datos 3').selectOption('INTEGER');
  await page.getByLabel('Requerido 3').check();
  await page.getByRole('button', { name: 'Agregar campo' }).click();
  await page.getByLabel('Nombre del campo 4').fill('Alta');
  await page.getByLabel('Tipo de datos 4').selectOption('DATE');
  await page.getByRole('button', { name: 'Agregar campo' }).click();
  await page.getByLabel('Nombre del campo 5').fill('Activo');
  await page.getByLabel('Tipo de datos 5').selectOption('BOOLEAN');
  await page.getByRole('button', { name: 'Guardar tabla' }).click();
  await settle();
  assert.ok(await nav('Clientes').count());
  const cols = await db(() => window.__novaBase.ctl.db.columns('Clientes').map((c) => [c.name, c.type, c.notNull, c.primaryKey, c.autoIncrement]));
  assert.deepEqual(cols, [['Id', 'INTEGER', false, true, true], ['Nombre', 'TEXT', false, false, false], ['Edad', 'INTEGER', true, false, false], ['Alta', 'DATE', false, false, false], ['Activo', 'BOOLEAN', false, false, false]]);
  await shot('design');
});

await check('datasheet: add records, edit cells, validation errors', async () => {
  await nav('Clientes').dblclick();
  await page.waitForSelector('.bs-grid');
  for (const [n, e, a] of [['Ana', '31', '2024-03-01'], ['Luis', '25', '2023-12-15'], ['Marta', '47', '2022-06-30']]) {
    await page.getByRole('button', { name: 'Nuevo registro' }).click();
    await settle();
    const r = (await db(() => window.__novaBase.ctl.db.count('Clientes'))) - 1;
    await page.locator(`.bs-grid [role="row"][aria-rowindex="${r + 2}"] [role="gridcell"][aria-colindex="2"]`).dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(n);
    await page.keyboard.press('Tab');
    await page.keyboard.type(e);
    await page.keyboard.press('Tab');
    await page.keyboard.type(a);
    await page.keyboard.press('Enter');
  }
  assert.equal(await db(() => window.__novaBase.ctl.db.count('Clientes')), 3);
  assert.equal(await cellText(0, 1), 'Ana');
  assert.equal(await cellText(2, 2), '47');
  // an invalid value keeps the cell open with an explanation
  await page.locator('.bs-grid [role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="3"]').dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('abc');
  await page.keyboard.press('Enter');
  assert.match(await page.locator('.bs-error').innerText(), /entero/);
  await page.keyboard.press('Escape');
  assert.equal(await cellText(0, 2), '31');
  // a required field refuses to be emptied
  await page.locator('.bs-grid [role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="3"]').dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  assert.match(await page.locator('.bs-error').innerText(), /no admite valores vac/);
  await page.keyboard.press('Escape');
  assert.equal(await cellText(0, 2), '31');
  await shot('datasheet');
});

await check('sort by header, search, boolean toggle, delete records', async () => {
  await page.locator('.bs-ch', { hasText: 'Edad' }).click();
  assert.deepEqual([await cellText(0, 2), await cellText(1, 2), await cellText(2, 2)], ['25', '31', '47']);
  await page.locator('.bs-ch', { hasText: 'Edad' }).click();
  assert.equal(await cellText(0, 2), '47');
  await page.locator('.bs-ch', { hasText: 'Edad' }).click();
  await page.getByLabel('Buscar en la tabla').fill('mar');
  await settle();
  assert.match(await page.locator('.bs-count').innerText(), /1 de 3/);
  assert.equal(await cellText(0, 1), 'Marta');
  await page.getByLabel('Buscar en la tabla').fill('');
  await settle();
  await page.locator('.bs-grid [role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="5"]').click();
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  assert.equal(await db(() => window.__novaBase.ctl.db.execute('SELECT Activo FROM Clientes WHERE Nombre=\'Ana\'').rows[0][0]), 1);
  await page.locator('.bs-row[aria-rowindex="3"] .bs-rh').click();
  await page.getByRole('button', { name: 'Eliminar registros' }).click();
  await settle();
  assert.equal(await db(() => window.__novaBase.ctl.db.count('Clientes')), 2);
});

await check('SQL query: run, error message, save, results grid', async () => {
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Consulta SQL', exact: true }).click();
  await page.getByLabel('SQL', { exact: true }).fill('SELEKT 1');
  await page.keyboard.press('Control+Enter');
  assert.ok((await page.locator('.bs-error').count()) >= 1);
  await page.getByLabel('SQL', { exact: true }).fill('SELECT Nombre, Edad FROM Clientes ORDER BY Edad DESC');
  await page.getByRole('button', { name: /Ejecutar/ }).click();
  assert.match(await page.locator('.bs-result .bs-count').innerText(), /2 registros/);
  assert.equal(await page.locator('.bs-result [role="gridcell"]').first().innerText(), 'Marta');
  await page.getByLabel('Nombre de la consulta').fill('Por edad');
  await page.getByRole('button', { name: 'Guardar consulta' }).click();
  await settle();
  assert.ok(await nav('Por edad').count());
  // statements that change data report the rows affected
  await page.getByLabel('SQL', { exact: true }).fill("UPDATE Clientes SET Edad = Edad + 1 WHERE Nombre = 'Ana'");
  await page.getByRole('button', { name: /Ejecutar/ }).click();
  assert.match(await page.locator('.bs-result').innerText(), /1 filas afectadas/);
  assert.equal(await db(() => window.__novaBase.ctl.db.execute("SELECT Edad FROM Clientes WHERE Nombre='Ana'").rows[0][0]), 32);
});

await check('query designer: tables, criteria, sort, generated SQL', async () => {
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Consulta SQL', exact: true }).click();
  await page.getByRole('button', { name: 'Diseño', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Clientes' }).check();
  await page.getByLabel('Mostrar Id').uncheck();
  await page.getByLabel('Criterios de Edad').fill('>30');
  await page.getByLabel('Orden de Nombre').selectOption('desc');
  const sql = await page.locator('.bs-sqlprev').innerText();
  assert.match(sql, /"Edad" > 30/);
  assert.match(sql, /ORDER BY "Nombre" DESC/);
  assert.doesNotMatch(sql, /"Id"/);
  await page.getByRole('button', { name: /Ejecutar/ }).click();
  assert.match(await page.locator('.bs-result .bs-count').innerText(), /[12] registros/);
  const rows = await db(() => window.__novaBase.ctl.results.get(window.__novaBase.ctl.active).rows.map((r) => r[0]));
  assert.ok(rows.every((n) => ['Ana', 'Marta'].includes(n)));
  await page.getByRole('button', { name: 'SQL', exact: true }).click();
  assert.match(await page.getByLabel('SQL', { exact: true }).inputValue(), /SELECT/);
  await shot('designer');
});

await check('form: navigate records, edit a field, new record', async () => {
  await nav('Clientes').click();
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Formulario', exact: true }).click();
  await page.waitForSelector('.bs-formcanvas');
  assert.match(await page.getByText(/Registro 1 de 2/).innerText(), /Registro 1 de 2/);
  await page.getByRole('button', { name: 'Registro siguiente' }).click();
  assert.match(await page.locator('.bs-nav').innerText(), /Registro 2 de 2/);
  const nombre = page.locator('#f-Nombre');
  await nombre.fill('Marta Ruiz');
  await nombre.blur();
  assert.equal(await db(() => window.__novaBase.ctl.db.execute("SELECT count(*) FROM Clientes WHERE Nombre='Marta Ruiz'").rows[0][0]), 1);
  await page.getByRole('button', { name: 'Nuevo registro' }).click();
  assert.match(await page.locator('.bs-nav').innerText(), /Registro 3 de 3/);
  await page.locator('#f-Edad').fill('xx');
  await page.locator('#f-Edad').blur();
  assert.match(await page.locator('.bs-error').innerText(), /entero/);
  await shot('form');
});

await check('report: grouping, totals, escaped text in the preview', async () => {
  await db(() => window.__novaBase.ctl.db.execute("CREATE TABLE Ventas (Zona TEXT, Producto TEXT, Importe REAL); INSERT INTO Ventas VALUES ('Sur','<b>x</b>',10),('Norte','y',5),('Sur','z',2.5)"));
  await db(() => window.__novaBase.ctl.touch());
  await nav('Ventas').click();
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Informe', exact: true }).click();
  await page.waitForSelector('.bs-reportframe');
  await page.getByLabel('Agrupar por').selectOption('Zona');
  await page.locator('.bs-reportcfg fieldset', { hasText: 'Totales' }).getByLabel('Importe').check();
  await settle();
  const html = await page.locator('.bs-reportframe').evaluate((f) => f.srcdoc);
  assert.match(html, /Zona: Norte/);
  assert.match(html, /Subtotal \(2\)/);
  assert.match(html, /12,5/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  await shot('report');
});

await check('import CSV and Excel files into new tables', async () => {
  await page.getByRole('tab', { name: 'Datos externos' }).click();
  const csv = path.join(tmp, 'pedidos.csv');
  fs.writeFileSync(csv, 'Pedido;Importe;Fecha;Entregado\n1;10,5;2024-01-02;true\n2;7;2024-01-03;false\n', 'utf8');
  const [c1] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Importar texto o CSV…' }).click()]);
  await c1.setFiles(csv);
  await page.waitForFunction(() => window.__novaBase.ctl.db.tableNames().includes('pedidos'));
  const types = await db(() => window.__novaBase.ctl.db.columns('pedidos').map((c) => c.type));
  assert.deepEqual(types, ['INTEGER', 'TEXT', 'DATE', 'BOOLEAN']); // "10,5" with a decimal comma stays text: it is not guessed
  // a minimal .xlsx written by hand
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Stock" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Artículo</t></is></c><c r="B1" t="inlineStr"><is><t>Unidades</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Tornillo</t></is></c><c r="B2"><v>120</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Tuerca</t></is></c><c r="B3"><v>85</v></c></row></sheetData></worksheet>');
  const xlsx = path.join(tmp, 'stock.xlsx');
  fs.writeFileSync(xlsx, await zip.generateAsync({ type: 'nodebuffer' }));
  const [c2] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Importar libro de Excel…' }).click()]);
  await c2.setFiles(xlsx);
  await page.waitForFunction(() => window.__novaBase.ctl.db.tableNames().includes('Stock'));
  assert.deepEqual(await db(() => window.__novaBase.ctl.db.columns('Stock').map((c) => [c.name, c.type])), [['Artículo', 'TEXT'], ['Unidades', 'INTEGER']]);
  assert.equal(await db(() => window.__novaBase.ctl.db.execute('SELECT sum(Unidades) FROM Stock').rows[0][0]), 205);
});

await check('rename and delete objects from the navigation pane', async () => {
  await page.getByRole('tab', { name: 'Inicio' }).click();
  await nav('Stock').click();
  await page.keyboard.press('F2');
  await page.getByLabel('Nombre nuevo').fill('Existencias');
  await page.keyboard.press('Enter');
  await settle();
  assert.ok(await nav('Existencias').count());
  assert.ok(!(await nav('Stock').count()));
  await nav('Existencias').click();
  await page.getByRole('button', { name: 'Eliminar objeto' }).click();
  await settle();
  assert.ok(!(await nav('Existencias').count()));
});

await check('save as .sqlite, reopen: tables, data, queries, forms and reports persist', async () => {
  const sig = () => db(() => {
    const d = window.__novaBase.ctl.db;
    return JSON.stringify({ t: d.tableNames(), q: d.objects('query'), f: d.objects('form'), r: d.objects('report'), c: d.count('Clientes'), n: d.execute('SELECT Nombre FROM Clientes ORDER BY Id').rows.flat() });
  });
  const before = await sig();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  const file = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(file);
  assert.match(dl.suggestedFilename(), /\.sqlite$/);
  assert.equal(fs.readFileSync(file).subarray(0, 15).toString(), 'SQLite format 3');
  await db(() => window.__novaBase.ctl.newDb());
  assert.equal(await db(() => window.__novaBase.ctl.db.tableNames().length), 0);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
  await chooser.setFiles(file);
  await page.waitForFunction(() => window.__novaBase.ctl.db.tableNames().includes('Clientes'));
  assert.equal(await sig(), before);
  // an Access file or any other file is refused with an explanation
  const bad = path.join(tmp, 'datos.accdb');
  fs.writeFileSync(bad, Buffer.from('\u0000\u0001\u0000\u0000Standard ACE DB'.repeat(40)));
  const [c2] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
  await c2.setFiles(bad);
  await page.waitForTimeout(400);
  assert.equal(dialogs.length, 1);
  assert.match(dialogs.pop(), /no es una base de datos SQLite válida/);
});

await check('export a table to CSV', async () => {
  await nav('Clientes').dblclick();
  await page.getByRole('tab', { name: 'Datos externos' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar a CSV…' }).click()]);
  const f = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(f);
  const text = fs.readFileSync(f, 'utf8');
  assert.match(text, /^﻿Id,Nombre,Edad,Alta,Activo\r\n/);
  assert.match(text, /Ana,32/);
});

await check('a large table stays responsive (20 000 records, virtualized)', async () => {
  await db(() => window.__novaBase.ctl.db.execute('CREATE TABLE Grande (n INTEGER PRIMARY KEY, txt TEXT); WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 20000) INSERT INTO Grande SELECT x, \'fila \' || x FROM c'));
  await db(() => window.__novaBase.ctl.touch());
  await nav('Grande').dblclick();
  await page.waitForSelector('.bs-grid');
  assert.match(await page.locator('.bs-count').innerText(), /20000 registros/);
  assert.ok((await page.locator('.bs-grid [role="gridcell"]').count()) < 200, 'only the visible rows are in the DOM');
  await page.locator('.bs-grid').evaluate((el) => (el.scrollTop = 19990 * 26));
  await page.waitForTimeout(300);
  assert.match(await page.locator('.bs-grid').innerText(), /fila 199\d\d/);
  const t0 = Date.now();
  await page.getByLabel('Buscar en la tabla').fill('fila 12345');
  await page.waitForTimeout(200);
  assert.match(await page.locator('.bs-count').innerText(), /1 de 20000|\d+ de 20000/);
  assert.ok(Date.now() - t0 < 3000);
});

await check('dark theme and no console errors or unexpected dialogs', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(200);
  await shot('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  assert.deepEqual(errors, []);
  assert.deepEqual(dialogs, []);
});

await browser.close();
let failed = 0;
for (const [s, n, msg] of results) {
  if (s !== 'ok') failed++;
  console.log(`${s === 'ok' ? '✓' : '✗'} ${n}${msg ? '\n    ' + msg : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
