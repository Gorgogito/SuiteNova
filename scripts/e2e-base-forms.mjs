// End-to-end checks of the second round of Nova Base forms: new controls, conditional formats, continuous view and form properties.
// Needs `pnpm dev` running on :1420. Usage: node scripts/e2e-base-forms.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=base';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
const settle = () => page.waitForTimeout(250);
const rows = (sql) => db((s) => window.__novaBase.ctl.db.execute(s).rows, sql);
const layoutOf = (kind) => db((k) => { const c = window.__novaBase.ctl; return c[k === 'form' ? 'forms' : 'reports'].get(c.active).layout; }, kind);
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__novaBase?.ctl.loading === false);
await page.screenshot();

await db(() => {
  const c = window.__novaBase.ctl;
  c.db.execute(`CREATE TABLE Zonas (id INTEGER PRIMARY KEY, nombre TEXT);
    CREATE TABLE Clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, zona_id INTEGER REFERENCES Zonas(id), activo BOOLEAN, saldo REAL);
    CREATE TABLE Pedidos (id INTEGER PRIMARY KEY, cliente INTEGER, total REAL, nota TEXT);
    INSERT INTO Zonas VALUES (1, 'Sur'), (2, 'Norte');
    INSERT INTO Clientes (nombre, zona_id, activo, saldo) VALUES ('Ana', 1, 1, 10.5), ('Luis', 2, 0, 3), ('Eva', 1, 1, 7);
    INSERT INTO Pedidos VALUES (1, 1, 5, 'a'), (2, 1, 7, 'b'), (3, 2, 9, 'c');`);
  c.db.clearUndo();
  c.touch();
});
await settle();


const setLayout = (fn) => db((s) => { const c = window.__novaBase.ctl; const f = c.forms.get(c.active); const l = new Function('l', `return (${s})(l)`)(JSON.parse(JSON.stringify(f.layout))); c.saveForm(c.active, { ...f, layout: l }); }, fn.toString());
const canvas = '.bs-formcanvas';

await page.locator('.bs-nav-pane li button', { hasText: /^Clientes$/ }).click();
await page.getByRole('tab', { name: 'Crear' }).click();
await page.getByRole('button', { name: 'Formulario', exact: true }).click();
await page.waitForSelector(canvas);

await check('designer: the new controls are added from the toolbar and an empty picture is reported', async () => {
  await page.getByRole('button', { name: 'Vista Diseño' }).click();
  for (const n of ['Grupo de opciones', 'Cuadro de lista', 'Pestañas', 'Hipervínculo', 'Línea', 'Rectángulo', 'Imagen']) await page.getByRole('button', { name: n, exact: true }).click();
  const types = (await layoutOf('form')).controls.map((c) => c.type);
  for (const t of ['option', 'list', 'tabs', 'hyperlink', 'line', 'rect', 'image']) assert.ok(types.includes(t), t);
  assert.match(await page.getByRole('status', { name: 'Avisos del diseño' }).innerText(), /no tiene imagen/);
  await shot('design');
  // leave only the controls of the next checks
  await setLayout((l) => ({ ...l, controls: l.controls.filter((c) => !['option', 'list', 'tabs', 'hyperlink', 'line', 'rect', 'image'].includes(c.type)) }));
});

await check('option group and list box write the chosen value; conditional format changes the look per record', async () => {
  await setLayout((l) => {
    const z = l.controls.find((c) => c.type === 'combo');
    const txt = l.controls.find((c) => c.type === 'text' && c.field === 'saldo');
    txt.cond = [{ expr: '[saldo] < 5', bg: '#ffcccc', bold: true }];
    l.controls = l.controls.filter((c) => c !== z);
    l.controls.push({ id: 'opt1', name: 'Grupo1', type: 'option', x: 16, y: 260, w: 200, h: 90, field: 'zona_id', caption: 'Zona', options: [{ label: 'Sur', value: '1' }, { label: 'Norte', value: '2' }] });
    l.controls.push({ id: 'lst1', name: 'Cuadro1', type: 'list', x: 240, y: 260, w: 200, h: 90, field: 'zona_id', source: { kind: 'table', table: 'Zonas', valueField: 'id', displayField: 'nombre' } });
    l.height = 400;
    return l;
  });
  await page.getByRole('button', { name: 'Vista Formulario' }).click();
  await page.waitForSelector(canvas);
  assert.equal(await page.getByRole('radio', { name: 'Sur' }).isChecked(), true);
  await page.getByRole('radio', { name: 'Norte' }).check();
  await settle();
  assert.deepEqual(await rows('SELECT zona_id FROM Clientes WHERE id = 1'), [[2]]);
  assert.equal(await page.locator('select[aria-label="Cuadro1"]').inputValue(), '2');
  await page.locator('select[aria-label="Cuadro1"]').selectOption({ label: 'Sur' });
  await settle();
  assert.deepEqual(await rows('SELECT zona_id FROM Clientes WHERE id = 1'), [[1]]);
  const bg = () => page.locator('input[aria-label^="Texto"]').last().evaluate((e) => getComputedStyle(e).backgroundColor);
  const first = await bg();
  await page.getByRole('button', { name: 'Registro siguiente' }).click();
  await settle();
  assert.notEqual(await bg(), first, 'Luis (saldo 3) takes the conditional background');
  assert.equal(await bg(), 'rgb(255, 204, 204)');
  await shot('run');
});

await check('continuous view shows every record and edits the one that is touched', async () => {
  await page.getByLabel('Vista de registros').selectOption('continuous');
  await settle();
  assert.equal(await page.locator('.bs-formrec').count(), 3);
  await page.locator('.bs-formrec').nth(2).locator('input[aria-label^="Texto"]').first().click();
  const nameBox = page.locator('.bs-formrec').nth(2).locator('input[type=text]:not([readonly])').nth(0);
  await nameBox.fill('Eva Maria');
  await nameBox.blur();
  await settle();
  assert.deepEqual(await rows('SELECT nombre FROM Clientes WHERE id = 3'), [['Eva Maria']]);
  await shot('continuous');
  await page.getByLabel('Vista de registros').selectOption('single');
});

await check('tabs: a control of a page only shows while that page is selected', async () => {
  await setLayout((l) => {
    l.controls.push({ id: 'tb1', name: 'Pestanas1', type: 'tabs', x: 16, y: 20, w: 300, h: 200, pages: ['Datos', 'Otros'] });
    const n = l.controls.find((c) => c.type === 'text' && c.field === 'nombre');
    n.tab = { id: 'tb1', page: 1 };
    return l;
  });
  await settle();
  console.log('visible editable', await page.locator('input[aria-label^="Texto"]:not([readonly])').count());
  const before = await page.locator(`${canvas} input`).count();
  await page.getByRole('tab', { name: 'Otros' }).click();
  assert.equal(await page.locator(`${canvas} input`).count(), before + 1);
});

await check('form properties: no edits, no additions', async () => {
  await setLayout((l) => ({ ...l, allowEdits: false, allowAdditions: false }));
  await settle();
  assert.equal(await page.getByRole('button', { name: 'Nuevo registro' }).isDisabled(), true);
  assert.equal(await page.locator('input[aria-label^="Texto"]').first().evaluate((e) => e.readOnly), true);
  await setLayout((l) => ({ ...l, navButtons: false }));
  await settle();
  assert.equal(await page.getByRole('toolbar', { name: 'Navegación de registros' }).count(), 0);
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
