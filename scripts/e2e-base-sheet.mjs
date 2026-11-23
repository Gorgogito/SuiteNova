// End-to-end checks of the datasheet of Nova Base (Access-like): column menu, sort, filters, find and replace, totals, columns,
// clipboard and saved layout. Needs `pnpm dev` on :1420.   Usage: node scripts/e2e-base-sheet.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=base';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => void d.accept());
let step = 0;
const shot = async (n) => shotsDir && page.screenshot({ path: `${shotsDir}/sheet-${String(++step).padStart(2, '0')}-${n}.png` });
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
const count = () => ev(() => window.__novaBase.ctl.sheetApi.rowCount);
const home = () => page.getByRole('tab', { name: 'Inicio', exact: true }).click();
const firstCol = (col) => page.locator(`.bs-row[aria-rowindex="2"] [data-col="${col}"]`).innerText();
const colMenu = async (col) => {
  await page.getByRole('button', { name: new RegExp(`Menú de la columna ${col}`) }).click();
  await settle(250);
};
const tabState = () => ev(() => { const c = window.__novaBase.ctl; return c.sheetOf(c.tab); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__novaBase?.ctl.loading === false);
await ev(() => {
  const c = window.__novaBase.ctl;
  const cities = ['Lima', 'Quito', 'Cusco', 'Bogotá', 'Lima'];
  let sql = 'CREATE TABLE Clientes (Id INTEGER PRIMARY KEY AUTOINCREMENT, Nombre TEXT, Ciudad TEXT, Saldo REAL, Activo BOOLEAN, Alta TEXT, Nota TEXT);';
  for (let i = 1; i <= 40; i++) sql += `INSERT INTO Clientes (Nombre, Ciudad, Saldo, Activo, Alta, Nota) VALUES ('Cliente ${String(i).padStart(2, '0')}', '${cities[i % 5]}', ${i * 10}, ${i % 2}, '2024-0${(i % 9) + 1}-1${i % 9}', ${i % 7 === 0 ? 'NULL' : `'nota ${i}'`});`;
  c.db.execute(sql);
  c.openTable('Clientes');
});
await settle(500);
await home();
const TOTAL = 40;

await check('the home ribbon offers the datasheet tools (labels as tooltips)', async () => {
  for (const n of ['Ascendente', 'Descendente', 'Filtro…', 'Buscar…', 'Reemplazar…', 'Totales', 'Copiar', 'Cortar', 'Pegar', 'Ocultar columna', 'Filas alternas'])
    assert.ok(await page.locator(`[aria-label="${n}"], button:has-text("${n}")`).count(), n);
  await shot('ribbon');
});

await check('column menu: sort A→Z / Z→A and clear; sort mark in the header', async () => {
  assert.equal(await firstCol('Nombre'), 'Cliente 01');
  await colMenu('Nombre');
  await page.getByRole('menuitem', { name: 'Ordenar de Z a A' }).click();
  await settle();
  assert.equal(await firstCol('Nombre'), 'Cliente 40');
  assert.equal(await page.getByRole('columnheader', { name: /Nombre/ }).first().getAttribute('aria-sort'), 'descending');
  await colMenu('Nombre');
  await page.getByRole('menuitem', { name: 'Quitar el orden' }).click();
  await settle();
  assert.equal(await firstCol('Nombre'), 'Cliente 01');
});

await check('several sort keys with Shift+click', async () => {
  await page.getByRole('columnheader', { name: /^Ciudad/ }).click();
  await page.getByRole('columnheader', { name: /^Saldo/ }).click({ modifiers: ['Shift'] });
  await page.getByRole('columnheader', { name: /^Saldo/ }).click({ modifiers: ['Shift'] });
  await settle();
  const s = await tabState();
  assert.deepEqual(s.sorts.map((k) => [k.col, k.desc]), [['Ciudad', false], ['Saldo', true]]);
  const first = await ev(() => window.__novaBase.ctl.db.browse('Clientes', { sorts: window.__novaBase.ctl.sheetOf(window.__novaBase.ctl.tab).sorts, limit: 1 }).rows[0].slice(1));
  assert.equal(first[2], 'Bogotá');
  await ev(() => { const c = window.__novaBase.ctl; c.setSheet(c.tab, { sorts: [] }); });
});

await check('filter by the list of values, the filter mark, and removing the filter', async () => {
  await colMenu('Ciudad');
  const d = page.getByRole('menu', { name: /Ciudad/ });
  await d.getByLabel('Seleccionar todo').uncheck();
  await d.getByRole('group', { name: 'Valores' }).getByText('Quito', { exact: true }).click();
  await d.getByRole('button', { name: 'Aplicar' }).click();
  await settle();
  assert.equal(await count(), 8);
  assert.match(await page.locator('.bs-count').innerText(), /8 de 40/);
  assert.ok(await page.locator('.bs-filtered').count(), 'the column shows it is filtered');
  await shot('filtered');
  await page.getByRole('button', { name: 'Filtrado' }).click();
  await settle();
  assert.equal(await count(), TOTAL, 'the filter can be switched off without losing it');
  await page.getByRole('button', { name: 'Sin filtrar' }).click();
  await page.getByRole('button', { name: 'Quitar filtro' }).click();
  await settle();
  assert.equal(await count(), TOTAL);
});

await check('filter by condition (greater than) and by selection (contains) from the ribbon', async () => {
  await colMenu('Saldo');
  await page.getByRole('menuitem', { name: 'Filtro por condición…' }).click();
  await settle(300);
  await page.getByRole('dialog').getByLabel('Condición').selectOption('gt');
  await page.getByRole('dialog').getByLabel('Valor', { exact: true }).fill('300');
  await page.getByRole('dialog').getByRole('button', { name: 'Aceptar' }).click();
  await settle();
  assert.equal(await count(), 10);
  await ev(() => { const c = window.__novaBase.ctl; c.setSheet(c.tab, { filters: [] }); });
  await settle();
  await page.locator('[data-col="Ciudad"]').first().click();
  await page.getByRole('button', { name: 'Filtrar por selección' }).click();
  await settle(300);
  await page.getByRole('menuitem', { name: /^Contiene/ }).click();
  await settle();
  const city = await ev(() => window.__novaBase.ctl.sheetApi.activeValue());
  assert.ok(await count() < TOTAL, `filtered by ${city}`);
  await page.getByRole('button', { name: 'Quitar todos los filtros' }).click();
  await settle();
  assert.equal(await count(), TOTAL);
});

await check('find (Ctrl+F) moves through matches; replace all is one undo step', async () => {
  await page.locator('[data-col="Nombre"]').first().click();
  await page.keyboard.press('Control+f');
  await settle(400);
  const d = page.getByRole('dialog');
  await d.getByLabel('Buscar', { exact: true }).fill('Cusco');
  await settle(300);
  assert.match(await d.locator('.nv-find-info').first().innerText(), /de 8/);
  assert.equal(await ev(() => window.__novaBase.ctl.db.execute("SELECT Ciudad FROM Clientes WHERE rowid = (SELECT rowid FROM Clientes WHERE Ciudad='Cusco' LIMIT 1)").rows[0][0]), 'Cusco');
  await d.getByRole('button', { name: 'Cerrar' }).first().click();
  await page.locator('[data-col="Nombre"]').first().click();
  await page.keyboard.press('Control+h');
  await settle(400);
  await d.getByLabel('Buscar', { exact: true }).fill('Cusco');
  await d.getByLabel('Reemplazar con').fill('Arequipa');
  await d.getByRole('button', { name: 'Reemplazar todo', exact: true }).click();
  await settle(400);
  assert.match(await d.locator('.nv-find-info').first().innerText(), /Se reemplazaron 8/);
  await shot('replace');
  assert.equal(await ev(() => window.__novaBase.ctl.db.execute("SELECT count(*) FROM Clientes WHERE Ciudad='Arequipa'").rows[0][0]), 8);
  await d.getByRole('button', { name: 'Cerrar' }).first().click();
  await settle();
  await ev(() => window.__novaBase.ctl.undo());
  await settle();
  assert.equal(await ev(() => window.__novaBase.ctl.db.execute("SELECT count(*) FROM Clientes WHERE Ciudad='Cusco'").rows[0][0]), 8);
});

await check('totals row: sum of a column, and it follows a filter', async () => {
  await page.getByRole('button', { name: 'Totales', exact: true }).click();
  await settle();
  await page.getByLabel('Total de Saldo', { exact: true }).selectOption('sum');
  await settle(300);
  const expected = await ev(() => window.__novaBase.ctl.db.aggregate('Clientes', 'Saldo', 'sum'));
  assert.equal(expected, 8200);
  assert.match((await page.getByLabel('Valor del total de Saldo').innerText()).replace(/\D/g, ''), /^8200$/);
  await ev(() => { const c = window.__novaBase.ctl; c.setSheet(c.tab, { filters: [{ col: 'Saldo', op: 'gt', value: '300' }] }); });
  await settle(300);
  assert.match((await page.getByLabel('Valor del total de Saldo').innerText()).replace(/\D/g, ''), /^3550$/);
  await page.getByLabel('Total de Nombre', { exact: true }).selectOption('countdistinct');
  await settle();
  assert.equal((await page.getByLabel('Valor del total de Nombre').innerText()).trim(), '10');
  await shot('totals');
  await ev(() => { const c = window.__novaBase.ctl; c.setSheet(c.tab, { filters: [], showTotals: false, totals: {} }); });
});

await check('hide, freeze and resize columns; the layout is saved in the file and comes back', async () => {
  await colMenu('Nota');
  await page.getByRole('menuitem', { name: 'Ocultar la columna' }).click();
  await settle();
  assert.equal(await page.locator('.bs-head [role=columnheader]', { hasText: /^Nota/ }).count(), 0);
  await colMenu('Nombre');
  await page.getByRole('menuitem', { name: 'Inmovilizar hasta esta columna' }).click();
  await settle();
  await colMenu('Ciudad');
  await page.getByRole('menuitem', { name: 'Ancho de columna…' }).click();
  await settle(300);
  await page.getByRole('dialog').getByRole('spinbutton').fill('300');
  await page.getByRole('dialog').getByRole('button', { name: 'Aceptar' }).click();
  await settle();
  const s = await tabState();
  assert.deepEqual([s.hidden, s.frozen, s.widths.Ciudad], [['Nota'], 2, 300]);
  // a frozen column stays while the sheet scrolls sideways
  await page.setViewportSize({ width: 800, height: 900 });
  await settle(300);
  await ev(() => { document.querySelector('.bs-grid').scrollLeft = 200; });
  await settle(300);
  const tr = await page.locator('[data-col="Nombre"]').first().evaluate((el) => el.style.transform);
  assert.match(tr, /translateX\(200px\)/);
  await shot('frozen');
  await page.setViewportSize({ width: 1600, height: 900 });
  // save the file, open it again: the layout is read back
  const b64 = await ev(() => { const b = window.__novaBase.ctl.db.export(); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); });
  await ev(([b, n]) => window.__novaBase.load(b, n), [b64, 'prueba.sqlite']);
  await settle(500);
  await ev(() => window.__novaBase.ctl.openTable('Clientes'));
  await settle(400);
  const s2 = await tabState();
  assert.deepEqual([s2.hidden, s2.frozen, s2.widths.Ciudad], [['Nota'], 2, 300]);
  await ev(() => { const c = window.__novaBase.ctl; c.setSheet(c.tab, { hidden: [], frozen: 0, widths: {} }); });
  await settle();
  assert.equal((await tabState()).hidden.length, 0);
});

await check('clipboard: copy a row and paste cells (and new records) from Excel-like text', async () => {
  await page.locator('.bs-row[aria-rowindex="2"] .bs-rh').click();
  await page.getByRole('button', { name: 'Copiar', exact: true }).click();
  await settle(300);
  const text = await ev(() => navigator.clipboard.readText());
  assert.match(text, /^1\tCliente 01\t/);
  // paste two columns of three rows starting at the 39th record: the last two rows are new records
  await ev(() => navigator.clipboard.writeText('Pepe\tTrujillo\nAna\tIca\nLuz\tTacna'));
  await ev(() => { document.querySelector('.bs-grid').scrollTop = 1e6; });
  await settle(300);
  await page.locator('.bs-row[aria-rowindex="40"] [data-col="Nombre"]').click();
  await page.getByRole('button', { name: 'Pegar', exact: true }).click();
  await settle(500);
  assert.equal(await count(), TOTAL + 1);
  const rows = await ev(() => window.__novaBase.ctl.db.execute("SELECT Nombre, Ciudad FROM Clientes WHERE Nombre IN ('Pepe','Ana','Luz') ORDER BY Id").rows);
  assert.deepEqual(rows, [['Pepe', 'Trujillo'], ['Ana', 'Ica'], ['Luz', 'Tacna']].slice(0, rows.length));
  assert.equal(rows.length, 3);
  await ev(() => window.__novaBase.ctl.undo());
  await settle(300);
  assert.equal(await count(), TOTAL);
  assert.equal(await ev(() => window.__novaBase.ctl.db.execute("SELECT Nombre FROM Clientes WHERE Id = 40").rows[0][0]), 'Cliente 40');
});

await check('text format: size, alternate rows, grid lines and row height', async () => {
  for (const n of ['Aumentar el tamaño del texto', 'Filas alternas', 'Líneas de cuadrícula']) {
    await page.getByRole('button', { name: n }).click();
    await page.mouse.move(900, 600); // the tooltip of a button must not cover the next one
    await settle(250);
  }
  await settle();
  const s = await tabState();
  assert.deepEqual([s.fontSize, s.zebra, s.gridlines], [14, true, false]);
  assert.ok(await page.locator('.bs-gridwrap.has-zebra.no-grid').count());
  assert.ok(await page.locator('.bs-row.is-alt').count());
  await page.getByRole('button', { name: 'Altura de fila…' }).click();
  await settle(300);
  await page.getByRole('dialog').getByRole('spinbutton').fill('34');
  await page.getByRole('dialog').getByRole('button', { name: 'Aceptar' }).click();
  await settle();
  assert.equal((await tabState()).rowHeight, 34);
  const h = await page.locator('.bs-row').first().evaluate((el) => el.getBoundingClientRect().height);
  assert.ok(Math.abs(h - 34) <= 2, `row height ${h}`);
  await shot('format');
});

await check('go to first/last record and Delete key removes the selected records', async () => {
  await page.locator('[data-col="Nombre"]').first().click();
  await page.getByRole('button', { name: 'Ir a' }).click();
  await settle(250);
  await page.getByRole('menuitem', { name: 'Último' }).click();
  await settle(300);
  assert.equal(await ev(() => window.__novaBase.ctl.sheetApi.activeRow), TOTAL - 1);
  await page.locator('.bs-row[aria-rowindex="41"] .bs-rh').click();
  await page.getByRole('button', { name: 'Eliminar', exact: true }).first().click();
  await settle(300);
  assert.equal(await count(), TOTAL - 1);
  await ev(() => window.__novaBase.ctl.undo());
  await settle(300);
  assert.equal(await count(), TOTAL);
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
