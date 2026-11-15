// End-to-end checks of data exchange in Nova Base: export formats, import sources, copy a table, backup, documenter and the
// context menu of the navigation pane. Needs `pnpm dev` on :1420.   Usage: node scripts/e2e-base-exchange.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from '../packages/writer-core/node_modules/jszip/lib/index.js';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=base';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => void d.accept());
let step = 0;
const shot = async (n) => shotsDir && page.screenshot({ path: `${shotsDir}/exc-${String(++step).padStart(2, '0')}-${n}.png` });
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
    await shot('FAIL-' + name.replace(/\W+/g, '-'));
    for (let i = 0; i < 3 && (await page.locator('[role=dialog]').count()); i++) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(250);
    }
  }
};
const ev = (f, a) => page.evaluate(f, a);
const settle = (ms = 300) => page.waitForTimeout(ms);
const external = () => page.getByRole('tab', { name: 'Datos externos', exact: true }).click();
/** presses a button in the dialog and returns the downloaded file */
const download = async (click) => {
  const dl = page.waitForEvent('download');
  await click();
  const f = await dl;
  const path = await f.path();
  return { name: f.suggestedFilename(), data: fs.readFileSync(path) };
};
const exportDialog = async (format, source) => {
  await external();
  await page.getByRole('button', { name: 'Exportar…', exact: true }).click();
  await settle(400);
  const d = page.getByRole('dialog');
  if (source) await d.getByLabel('Qué exportar').selectOption(source);
  await d.getByLabel('Formato de exportación').selectOption(format);
  return d;
};
const closeDialog = async () => {
  await page.getByRole('dialog').getByRole('button', { name: /^(Cerrar|Cancelar)$/ }).first().click();
  await settle(300);
};
const rowsOf = (sql) => ev((s) => window.__novaBase.ctl.db.execute(s).rows, sql);

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__novaBase?.ctl.loading === false);
await ev(() => {
  const c = window.__novaBase.ctl;
  c.db.execute(`CREATE TABLE Clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, ciudad TEXT, saldo REAL, activo BOOLEAN);
    INSERT INTO Clientes (nombre, ciudad, saldo, activo) VALUES ('Ana & Co', 'Lima', 120.5, 1), ('Luis <x>', 'Quito', 80, 0), ('Eva', NULL, 15.25, 1), ('Oscar', 'Lima', 9, 1);
    CREATE INDEX ix_ciudad ON Clientes (ciudad);`);
  c.openTable('Clientes');
  c.touch();
});
await settle(500);

await check('export to Excel: a workbook with a header row and the records', async () => {
  const d = await exportDialog('xlsx', 'table:Clientes');
  const f = await download(() => d.getByRole('button', { name: 'Exportar', exact: true }).click());
  assert.equal(f.name, 'Clientes.xlsx');
  const zip = await JSZip.loadAsync(f.data);
  const strings = await zip.file('xl/sharedStrings.xml').async('string');
  for (const s of ['nombre', 'ciudad', 'Ana &amp; Co', 'Quito']) assert.ok(strings.includes(s), s);
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.ok(sheet.includes('120.5'));
  await shot('export-dialog');
  await closeDialog();
});

await check('export to CSV with ";" and without the header; to text with tabs', async () => {
  let d = await exportDialog('csv', 'table:Clientes');
  await d.getByLabel('Separador', { exact: true }).selectOption(';');
  await d.getByLabel('Incluir los nombres de campo').uncheck();
  let f = await download(() => d.getByRole('button', { name: 'Exportar', exact: true }).click());
  const text = f.data.toString('utf8').replace(/^﻿/, '');
  assert.ok(text.startsWith('1;Ana & Co;Lima;120.5;1'), text.slice(0, 40));
  assert.equal(text.trim().split(/\r?\n/).length, 4);
  await closeDialog();
  d = await exportDialog('tsv', 'table:Clientes');
  f = await download(() => d.getByRole('button', { name: 'Exportar', exact: true }).click());
  assert.equal(f.name, 'Clientes.txt');
  assert.ok(f.data.toString('utf8').includes('id\tnombre\tciudad'));
  await closeDialog();
});

await check('export to JSON of only what the datasheet shows (filter and order)', async () => {
  await ev(() => { const c = window.__novaBase.ctl; const t = c.tabs.find((x) => x.kind === 'table'); c.setSheet(t, { filters: [{ col: 'ciudad', op: 'eq', value: 'Lima' }], sorts: [{ col: 'saldo', desc: false }], hidden: ['activo'] }); });
  const d = await exportDialog('json', 'table:Clientes');
  const f = await download(() => d.getByRole('button', { name: 'Exportar', exact: true }).click());
  const j = JSON.parse(f.data.toString('utf8'));
  assert.deepEqual(j.map((r) => r.nombre), ['Oscar', 'Ana & Co']);
  assert.ok(!('activo' in j[0]));
  await d.getByLabel(/Solo lo que se ve/).uncheck();
  const all = JSON.parse((await download(() => d.getByRole('button', { name: 'Exportar', exact: true }).click())).data.toString('utf8'));
  assert.equal(all.length, 4);
  assert.ok('activo' in all[0]);
  await closeDialog();
  await ev(() => { const c = window.__novaBase.ctl; const t = c.tabs.find((x) => x.kind === 'table'); c.setSheet(t, { filters: [], sorts: [], hidden: [] }); });
});

await check('export to XML and HTML escape the text; the SQL script recreates the table elsewhere', async () => {
  let d = await exportDialog('xml', 'table:Clientes');
  let f = await download(() => d.getByRole('button', { name: 'Exportar', exact: true }).click());
  let x = f.data.toString('utf8');
  assert.ok(x.includes('<Tabla nombre="Clientes">') && x.includes('<nombre>Ana &amp; Co</nombre>') && x.includes('Luis &lt;x&gt;'));
  assert.equal((x.match(/<ciudad>/g) ?? []).length, 3, 'the empty city has no element');
  await closeDialog();
  d = await exportDialog('html', 'table:Clientes');
  f = await download(() => d.getByRole('button', { name: 'Exportar', exact: true }).click());
  x = f.data.toString('utf8');
  assert.ok(x.includes('<th>saldo</th>') && x.includes('Luis &lt;x&gt;'));
  await closeDialog();
  d = await exportDialog('sql', 'table:Clientes');
  f = await download(() => d.getByRole('button', { name: 'Exportar', exact: true }).click());
  x = f.data.toString('utf8');
  assert.equal(f.name, 'Clientes.sql');
  const n = await ev((sql) => { const db = window.__novaBase.ctl.db; const fresh = db.constructor.open(db.SQL); fresh.execute(sql); return [fresh.count('Clientes'), fresh.indexes('Clientes').some((i) => i.name === 'ix_ciudad')]; }, x);
  assert.deepEqual(n, [4, true]);
  await closeDialog();
});

await check('import a JSON file as a table', async () => {
  await external();
  await page.getByRole('button', { name: 'Otros orígenes…' }).click();
  await settle(300);
  const fc = page.waitForEvent('filechooser');
  await page.getByRole('dialog').getByRole('button', { name: 'Elegir archivo…' }).click();
  await (await fc).setFiles({ name: 'productos.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([{ codigo: 'A1', precio: 10.5, stock: 3 }, { codigo: 'B2', precio: 20, stock: 0, nota: 'nuevo' }])) });
  await settle(400);
  const d = page.getByRole('dialog');
  assert.match(await d.innerText(), /3 filas/);
  await shot('import-json');
  await d.getByRole('button', { name: 'Importar', exact: true }).click();
  await settle(400);
  assert.match(await d.getByRole('status').innerText(), /2 registros en «productos»/);
  assert.deepEqual(await rowsOf('SELECT codigo, nota FROM productos ORDER BY codigo'), [['A1', null], ['B2', 'nuevo']]);
  await closeDialog();
});

await check('import a delimited text file choosing the delimiter, and paste cells from the clipboard', async () => {
  await external();
  await page.getByRole('button', { name: 'Otros orígenes…' }).click();
  await settle(300);
  const fc = page.waitForEvent('filechooser');
  await page.getByRole('dialog').getByRole('button', { name: 'Elegir archivo…' }).click();
  await (await fc).setFiles({ name: 'ventas.txt', mimeType: 'text/plain', buffer: Buffer.from('x;y\n1;uno\n2;dos\n') });
  await settle(400);
  let d = page.getByRole('dialog');
  await d.getByLabel('Separador de campos').selectOption(';');
  await d.getByRole('button', { name: 'Importar', exact: true }).click();
  await settle(400);
  assert.deepEqual(await rowsOf('SELECT x, y FROM ventas ORDER BY x'), [[1, 'uno'], [2, 'dos']]);
  await closeDialog();
  // from the clipboard (tab separated, as Excel copies)
  await ev(() => navigator.clipboard.writeText('item\tcantidad\nlápiz\t5\ngoma\t2'));
  await external();
  await page.getByRole('button', { name: 'Pegar como tabla…' }).click();
  await settle(700);
  d = page.getByRole('dialog');
  await d.getByLabel('Nombre de la tabla nueva').fill('Pegados');
  await d.getByRole('button', { name: 'Importar', exact: true }).click();
  await settle(400);
  assert.deepEqual(await rowsOf('SELECT item, cantidad FROM Pegados ORDER BY item'), [['goma', 2], ['lápiz', 5]]);
  await closeDialog();
});

await check('import tables from another SQLite database; a name that exists is renamed', async () => {
  const b64 = await ev(() => {
    const db = window.__novaBase.ctl.db;
    const other = db.constructor.open(db.SQL);
    other.execute("CREATE TABLE Clientes (id INTEGER PRIMARY KEY, nombre TEXT); INSERT INTO Clientes VALUES (1,'Zoe'),(2,'Max'); CREATE TABLE Notas (txt TEXT); INSERT INTO Notas VALUES ('hola'); CREATE INDEX ix_n ON Notas (txt);");
    const b = other.export();
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  });
  await external();
  await page.getByRole('button', { name: 'Otros orígenes…' }).click();
  await settle(300);
  const fc = page.waitForEvent('filechooser');
  await page.getByRole('dialog').getByRole('button', { name: 'Elegir archivo…' }).click();
  await (await fc).setFiles({ name: 'otra.sqlite', mimeType: 'application/octet-stream', buffer: Buffer.from(b64, 'base64') });
  await settle(500);
  const d = page.getByRole('dialog');
  assert.ok(await d.getByRole('group', { name: 'Tablas del archivo' }).getByText(/Clientes/).count());
  await shot('import-db');
  await d.getByRole('button', { name: 'Importar', exact: true }).click();
  await settle(500);
  assert.match(await d.getByRole('status').innerText(), /2 tablas y 3 registros/);
  assert.match(await d.getByRole('status').innerText(), /«Clientes» ya existía: se llama «Clientes_1»/);
  assert.deepEqual(await rowsOf('SELECT nombre FROM Clientes_1 ORDER BY id'), [['Zoe'], ['Max']]);
  assert.equal((await rowsOf("SELECT count(*) FROM sqlite_master WHERE type='index' AND name='ix_n'"))[0][0], 1);
  await closeDialog();
});

await check('copy a table: structure and data, structure only, and append', async () => {
  await ev(() => window.__novaBase.ctl.openTable('Clientes'));
  await page.locator('.bs-nav-pane li button', { hasText: /^Clientes$/ }).click();
  await page.getByRole('tab', { name: 'Crear', exact: true }).click();
  await page.getByRole('button', { name: 'Copiar tabla…' }).click();
  await settle(300);
  let d = page.getByRole('dialog');
  await d.getByLabel('Nombre de la tabla nueva').fill('Clientes_copia');
  await d.getByRole('button', { name: 'Aceptar' }).click();
  await settle(400);
  assert.equal((await rowsOf('SELECT count(*) FROM Clientes_copia'))[0][0], 4);
  await page.locator('.bs-nav-pane li button', { hasText: /^Clientes$/ }).click();
  await page.getByRole('button', { name: 'Copiar tabla…' }).click();
  await settle(300);
  d = page.getByRole('dialog');
  await d.getByLabel('Solo la estructura').check();
  await d.getByLabel('Nombre de la tabla nueva').fill('Clientes_vacia');
  await d.getByRole('button', { name: 'Aceptar' }).click();
  await settle(400);
  assert.equal((await rowsOf('SELECT count(*) FROM Clientes_vacia'))[0][0], 0);
  await page.locator('.bs-nav-pane li button', { hasText: /^Clientes$/ }).click();
  await page.getByRole('button', { name: 'Copiar tabla…' }).click();
  await settle(300);
  d = page.getByRole('dialog');
  await d.getByLabel('Anexar los datos a una tabla que existe').check();
  await d.getByLabel('Tabla de destino').selectOption('Clientes_vacia');
  await d.getByRole('button', { name: 'Aceptar' }).click();
  await settle(400);
  assert.equal((await rowsOf('SELECT count(*) FROM Clientes_vacia'))[0][0], 4);
});

await check('backup: a SQLite file with the date in its name', async () => {
  await page.getByRole('tab', { name: 'Herramientas', exact: true }).click();
  const f = await download(() => page.getByRole('button', { name: 'Copia de seguridad…' }).click());
  assert.match(f.name, /-copia-\d{8}-\d{4}\.sqlite$/);
  assert.equal(f.data.subarray(0, 15).toString('latin1'), 'SQLite format 3');
});

await check('documenter: describes tables, fields and rules; can be saved as HTML', async () => {
  await ev(() => window.__novaBase.ctl.db.setMeta('Clientes', { description: 'Personas y empresas', rule: '[saldo] >= 0', ruleText: 'Saldo negativo', fields: { saldo: { caption: 'Saldo (USD)', kind: 'currency' } } }));
  await page.getByRole('tab', { name: 'Herramientas', exact: true }).click();
  await page.getByRole('button', { name: 'Documentador' }).click();
  await settle(700);
  const d = page.getByRole('dialog');
  const html = await d.locator('iframe').getAttribute('srcdoc');
  for (const s of ['<h3>Clientes</h3>', 'Personas y empresas', 'Saldo (USD)', 'clave principal', 'Regla de la tabla', '[saldo] &gt;= 0', 'ix_ciudad']) assert.ok(html.includes(s), s);
  await shot('documenter');
  await d.getByLabel('Consultas').uncheck();
  const f = await download(() => d.getByRole('button', { name: 'Guardar como HTML…' }).click());
  assert.match(f.name, /documentacion\.html$/);
  assert.ok(f.data.toString('utf8').includes('<h2>Tablas</h2>'));
  await closeDialog();
});

await check('right click on a table in the navigation pane: menu with open, design, rename, copy, export and delete', async () => {
  await page.locator('.bs-nav-pane li button', { hasText: /^Clientes$/ }).click({ button: 'right' });
  await settle(250);
  const m = page.locator('.bs-colmenu');
  assert.equal(await m.count(), 1, 'one menu is open');
  for (const n of ['Abrir', 'Vista Diseño', 'Cambiar nombre', 'Copiar tabla…', 'Exportar…', 'Eliminar objeto']) assert.ok(await m.getByRole('menuitem', { name: n, exact: true }).count(), n);
  await shot('nav-menu');
  await m.getByRole('menuitem', { name: 'Cambiar nombre' }).click();
  await settle(300);
  assert.ok(await page.getByLabel('Nombre nuevo').count());
  await page.keyboard.press('Escape');
  await page.locator('.bs-nav-pane li button', { hasText: /^Clientes$/ }).click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Vista Diseño' }).click();
  await settle(500);
  assert.equal(await ev(() => window.__novaBase.ctl.tab.kind), 'design');
});

await check('no console errors', async () => assert.deepEqual(errors, []));
await browser.close();
let failed = 0;
for (const [s, n, m] of results) {
  if (s !== 'ok') failed++;
  console.log(`${s === 'ok' ? '✓' : '✗'} ${n}${m ? '\n    ' + m : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
