// End-to-end checks of Nova Base's third round of forms (Access parity): wizard, filter and order, default values,
// locked/disabled/tab stop, control events, shortcut keys, timer, datasheet and split views, linked and nested subforms.
// Needs `pnpm dev` running on :1420. Usage: node scripts/e2e-base-forms2.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=base';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
const dialogs = [];
page.on('dialog', (d) => {
  dialogs.push(`${d.type()}: ${d.message()}`);
  d.accept();
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
const settle = () => page.waitForTimeout(300);
const rows = (sql) => db((s) => window.__novaBase.ctl.db.execute(s).rows, sql);
const layoutOf = () => db(() => { const c = window.__novaBase.ctl; return c.forms.get(c.active).layout; });
const setLayout = (fn) => db((s) => { const c = window.__novaBase.ctl; const f = c.forms.get(c.active); const l = new Function('l', `return (${s})(l)`)(JSON.parse(JSON.stringify(f.layout))); c.saveForm(c.active, { ...f, layout: l }); }, fn.toString());
const canvas = '.bs-formcanvas';
const toRun = async () => { if (await page.locator(canvas).count()) return; await page.getByRole('button', { name: 'Vista Formulario' }).click(); await page.waitForSelector(canvas); await settle(); };
const toDesign = async () => { if (await page.locator('.bs-fdcanvas').count()) return; await page.getByRole('button', { name: 'Vista Diseño' }).click(); await page.waitForSelector('.bs-fdcanvas'); };

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__novaBase?.ctl.loading === false);

await db(() => {
  const c = window.__novaBase.ctl;
  c.db.execute(`CREATE TABLE Clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, zona TEXT, saldo REAL, alta TEXT);
    CREATE TABLE Pedidos (id INTEGER PRIMARY KEY, cliente INTEGER, anio INTEGER, total REAL);
    CREATE TABLE Lineas (id INTEGER PRIMARY KEY, pedido INTEGER, producto TEXT);
    CREATE TABLE Bitacora (msg TEXT);
    INSERT INTO Clientes (nombre, zona, saldo) VALUES ('Ana', 'Sur', 10), ('Luis', 'Norte', 3), ('Eva', 'Sur', 7), ('Zoe', 'Este', 1);
    INSERT INTO Pedidos VALUES (1, 1, 2024, 5), (2, 1, 2025, 7), (3, 2, 2024, 9);
    INSERT INTO Lineas VALUES (1, 1, 'Tornillo'), (2, 1, 'Tuerca'), (3, 2, 'Clavo');`);
  c.db.saveObject('module', 'Ev', { code: `Sub Marca()\n    CurrentDb.Execute "INSERT INTO Bitacora VALUES ('marca')"\nEnd Sub\nSub Clic()\n    CurrentDb.Execute "INSERT INTO Bitacora VALUES ('clic')"\nEnd Sub\nSub Foco()\n    CurrentDb.Execute "INSERT INTO Bitacora VALUES ('foco')"\nEnd Sub\nSub Tic()\n    CurrentDb.Execute "INSERT INTO Bitacora VALUES ('tic')"\nEnd Sub\n` });
  c.db.clearUndo();
  c.touch();
});
await settle();

await check('the form wizard builds a form with only the chosen fields', async () => {
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Asistente de formularios…' }).click();
  await page.getByLabel('Tabla del formulario').selectOption('Clientes');
  await page.getByRole('group', { name: 'Campos del formulario' }).getByLabel('alta').uncheck();
  await page.getByLabel('Título del formulario nuevo').fill('Ficha de clientes');
  await page.getByRole('button', { name: 'Crear el formulario' }).click();
  await page.waitForSelector(canvas);
  const l = await layoutOf();
  assert.equal(l.caption, 'Ficha de clientes');
  assert.deepEqual(l.controls.filter((c) => c.type === 'text').map((c) => c.field), ['id', 'nombre', 'zona', 'saldo']);
  await shot('wizard-form');
});

await check('wizard styles: datasheet and split views show the records as a grid', async () => {
  await page.getByLabel('Vista de registros').selectOption('datasheet');
  await settle();
  assert.equal(await page.getByRole('group', { name: 'Hoja de datos del formulario' }).locator('tbody tr').count(), 4);
  assert.equal(await page.locator(canvas).count(), 0);
  await shot('datasheet-view');
  await page.getByLabel('Vista de registros').selectOption('split');
  await settle();
  assert.equal(await page.locator(canvas).count(), 1);
  await page.getByLabel('nombre 2').fill('Luis Miguel');
  await page.getByLabel('nombre 2').blur();
  await settle();
  assert.deepEqual(await rows(`SELECT nombre FROM Clientes WHERE id = 2`), [['Luis Miguel']]);
  // clicking a row makes it the current record of the form above
  assert.match(await page.getByText(/Registro 2 de 4/).innerText(), /Registro 2 de 4/);
  await page.getByLabel('Vista de registros').selectOption('single');
  await settle();
});

await check('filter by the user: text, by selection, and removing it', async () => {
  await page.getByLabel('Filtro de los registros').fill('[zona] = "Sur"');
  await page.getByRole('button', { name: 'Aplicar filtro' }).click();
  await settle();
  assert.match(await page.getByText(/Registro 1 de 2/).innerText(), /de 2/);
  await page.getByRole('button', { name: 'Quitar filtro' }).click();
  await settle();
  assert.match(await page.getByText(/Registro 1 de 4/).innerText(), /de 4/);
  await page.locator('#f-zona').focus();
  await page.getByRole('button', { name: 'Filtrar por selección' }).click();
  await settle();
  assert.match(await page.getByText(/de 2/).first().innerText(), /de 2/); // Ana is Sur
  assert.equal(await page.getByLabel('Filtro de los registros').inputValue(), '[zona] = "Sur"');
  await page.getByLabel('Filtro de los registros').fill('@@');
  await page.getByRole('button', { name: 'Aplicar filtro' }).click();
  await settle();
  assert.match(await page.getByRole('alert').innerText(), /No se entiende/);
  await page.getByRole('button', { name: 'Quitar filtro' }).click();
  await settle();
});

await check('order by the user changes which record comes first', async () => {
  await page.getByLabel('Ordenar los registros por').selectOption('saldo');
  await page.getByRole('button', { name: 'Ascendente' }).click();
  await settle();
  assert.equal(await page.locator('#f-nombre').inputValue(), 'Zoe');
  await page.getByRole('button', { name: 'Descendente' }).click();
  await settle();
  assert.equal(await page.locator('#f-nombre').inputValue(), 'Ana');
  await page.getByLabel('Ordenar los registros por').selectOption('');
  await settle();
});

await check('form filter and order saved in the design apply when it opens', async () => {
  await toDesign();
  await page.getByLabel('Filtro del formulario').fill('[saldo] >= 3');
  await page.getByLabel('Agregar orden del formulario').selectOption('saldo');
  await page.getByLabel('Orden descendente de saldo').check();
  const l = await layoutOf();
  assert.equal(l.filter, '[saldo] >= 3');
  assert.deepEqual(l.orderBy, [{ field: 'saldo', desc: true }]);
  await toRun();
  assert.match(await page.getByText(/Registro 1 de 3/).innerText(), /de 3/);
  assert.equal(await page.locator('#f-nombre').inputValue(), 'Ana');
  await page.getByRole('button', { name: 'Registro siguiente' }).click();
  await settle();
  assert.equal(await page.locator('#f-nombre').inputValue(), 'Eva');
  await toDesign();
  await page.getByLabel('Filtro del formulario').fill('@@');
  assert.match(await page.getByRole('status', { name: 'Avisos del diseño' }).innerText(), /Filtro del formulario/);
  await page.getByLabel('Filtro del formulario').fill('');
  await page.getByRole('button', { name: 'Quitar el orden por saldo' }).click();
});

await check('default value, locked, disabled and tab stop on controls', async () => {
  await setLayout((l) => {
    const z = l.controls.find((c) => c.type === 'text' && c.field === 'zona');
    z.defaultValue = 'Centro';
    const s = l.controls.find((c) => c.type === 'text' && c.field === 'saldo');
    s.locked = true;
    s.tabStop = false;
    const n = l.controls.find((c) => c.type === 'text' && c.field === 'nombre');
    n.defaultValue = '=Left("Nuevo cliente", 5)';
    const i = l.controls.find((c) => c.type === 'text' && c.field === 'id');
    i.enabled = false;
    return l;
  });
  await toRun();
  assert.equal(await page.locator('#f-saldo').getAttribute('readonly'), '');
  assert.equal(await page.locator('#f-saldo').getAttribute('tabindex'), '-1');
  assert.equal(await page.locator('#f-id').isDisabled(), true);
  await page.getByRole('button', { name: 'Nuevo registro' }).click();
  await settle();
  assert.equal(await page.locator('#f-zona').inputValue(), 'Centro');
  assert.equal(await page.locator('#f-nombre').inputValue(), 'Nuevo');
  assert.deepEqual(await rows(`SELECT nombre, zona FROM Clientes ORDER BY id DESC LIMIT 1`), [['Nuevo', 'Centro']]);
  await shot('defaults');
});

await check('control events (click, focus) and a shortcut key run code; the timer ticks', async () => {
  await setLayout((l) => {
    const n = l.controls.find((c) => c.type === 'text' && c.field === 'nombre');
    n.on = { gotFocus: { kind: 'proc', name: 'Foco' } };
    const lab = l.controls.find((c) => c.type === 'label');
    lab.on = { click: { kind: 'proc', name: 'Clic' } };
    l.keys = [{ key: 'Ctrl+M', handler: { kind: 'proc', name: 'Marca' } }];
    l.events = { ...l.events, onTimer: { kind: 'proc', name: 'Tic' } };
    l.timerInterval = 400;
    return l;
  });
  await toRun();
  await page.locator('#f-nombre').focus();
  await settle();
  assert.ok((await rows(`SELECT count(*) FROM Bitacora WHERE msg = 'foco'`))[0][0] >= 1, 'focus event');
  await page.locator('.bs-fc-label').first().click();
  await settle();
  assert.equal((await rows(`SELECT count(*) FROM Bitacora WHERE msg = 'clic'`))[0][0], 1);
  await page.keyboard.press('Control+m');
  await settle();
  assert.equal((await rows(`SELECT count(*) FROM Bitacora WHERE msg = 'marca'`))[0][0], 1);
  await page.waitForTimeout(1300);
  assert.ok((await rows(`SELECT count(*) FROM Bitacora WHERE msg = 'tic'`))[0][0] >= 2, 'timer ticks');
  // the designer takes the same settings from the interface
  await toDesign();
  assert.ok(await page.getByLabel('Atajo 1').inputValue() === 'Ctrl+M');
  assert.equal(await page.getByLabel('Intervalo del temporizador').inputValue(), '400');
  await setLayout((l) => { delete l.events.onTimer; l.keys = []; return l; });
});

await check('tab order panel: move a control up and the list order follows', async () => {
  await setLayout((l) => { for (const c of l.controls) { delete c.tabStop; delete c.enabled; } return l; });
  await toDesign();
  const before = (await layoutOf()).controls.filter((c) => c.type === 'text').map((c) => c.name);
  const items = await page.getByRole('list', { name: 'Orden de tabulación' }).locator('li').allInnerTexts();
  assert.ok(items.length >= 3);
  const second = (await layoutOf()).controls.filter((c) => c.type === 'text' && c.tabStop !== false && c.enabled !== false)[1].name;
  await page.getByRole('button', { name: `Subir ${second}`, exact: true }).click();
  const after = (await layoutOf()).controls.filter((c) => c.type === 'text' && c.tabStop !== false && c.enabled !== false).map((c) => c.name);
  assert.equal(after[0], second);
  assert.notDeepEqual((await layoutOf()).controls.filter((c) => c.type === 'text').map((c) => c.name), before);
});

await check('a subform linked by two fields and a second level', async () => {
  await page.locator('.bs-nav-pane li button', { hasText: /^Clientes$/ }).click();
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Formulario', exact: true }).click();
  await page.waitForSelector(canvas);
  await page.getByRole('button', { name: 'Vista Diseño' }).click();
  await page.getByRole('button', { name: 'Subformulario', exact: true }).click();
  await page.getByLabel('Tabla del subformulario').selectOption('Pedidos');
  await page.getByLabel('Campo vinculado secundario').selectOption('cliente');
  await page.getByLabel('Campo vinculado principal').selectOption('id');
  await page.getByRole('button', { name: 'Agregar enlace' }).click();
  await page.getByLabel('Campo secundario del enlace 1').selectOption('anio');
  // the clients have no "anio": the warning says so
  await page.getByLabel('Campo principal del enlace 1').selectOption('saldo');
  await page.getByLabel('Tabla del segundo nivel').selectOption('Lineas');
  await page.getByLabel('Campo secundario del segundo nivel').selectOption('pedido');
  await page.getByLabel('Campo principal del segundo nivel').selectOption('id');
  const sub = (await layoutOf()).controls.find((c) => c.type === 'subform');
  assert.deepEqual(sub.extraLinks, [{ child: 'anio', parent: 'saldo' }]);
  assert.deepEqual(sub.nested, { table: 'Lineas', childField: 'pedido', parentField: 'id' });
  // make the second link realistic: link the year of the order with the number of the client's saldo (2024 for Ana)
  await db(() => window.__novaBase.ctl.db.execute('UPDATE Clientes SET saldo = 2024 WHERE id = 1'));
  await toRun();
  const subform = page.getByRole('group', { name: sub.name });
  assert.equal(await subform.locator('tbody tr:not(.bs-nested)').count(), 1); // client 1, year 2024 only
  await subform.getByRole('button', { name: /^Segundo nivel del registro/ }).click();
  await settle();
  assert.equal(await subform.locator('.bs-nested tbody tr').count(), 2); // Tornillo, Tuerca
  await subform.getByLabel(/^Lineas producto/).first().fill('Perno');
  await subform.getByLabel(/^Lineas producto/).first().blur();
  await settle();
  assert.deepEqual(await rows(`SELECT producto FROM Lineas WHERE id = 1`), [['Perno']]);
  await subform.getByRole('button', { name: 'Agregar a Lineas' }).click();
  await settle();
  assert.equal((await rows(`SELECT count(*) FROM Lineas WHERE pedido = 1`))[0][0], 3);
  // "add" on the subform fills both links
  await subform.getByRole('button', { name: 'Agregar registro' }).click();
  await settle();
  assert.deepEqual(await rows(`SELECT cliente, anio FROM Pedidos ORDER BY id DESC LIMIT 1`), [[1, 2024]]);
  await shot('nested-subform');
});

await check('no console errors; the only dialogs were confirmations', async () => {
  assert.deepEqual(errors, []);
  assert.deepEqual(dialogs.filter((d) => !d.startsWith('confirm')), []);
});

await browser.close();
let failed = 0;
for (const [s, n, msg] of results) {
  if (s !== 'ok') failed++;
  console.log(`${s === 'ok' ? '✓' : '✗'} ${n}${msg ? '\n    ' + msg : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
