// End-to-end checks of Nova Base's form designer and report designer (and the forms/reports they produce).
// Needs `pnpm dev` running on :1420. Usage: node scripts/e2e-base-designers.mjs [--shots dir]
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
const item = (name) => page.getByRole('button', { name: new RegExp(`${name}$`) });

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

await check('a new form comes with a layout and opens in form view: combo shows the lookup text', async () => {
  await page.locator('.bs-nav-pane li button', { hasText: /^Clientes$/ }).click();
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Formulario', exact: true }).click();
  await page.waitForSelector('.bs-formcanvas');
  const l = await layoutOf('form');
  assert.equal(l.controls.filter((c) => c.type !== 'label').length, 5);
  assert.deepEqual(l.controls.filter((c) => c.type !== 'label').map((c) => c.type), ['text', 'text', 'combo', 'check', 'text']);
  assert.equal(await page.locator('#f-zona_id option:checked').innerText(), 'Sur');
  await page.locator('#f-zona_id').selectOption({ label: 'Norte' });
  await settle();
  assert.deepEqual(await rows(`SELECT zona_id FROM Clientes WHERE id = 1`), [[2]]);
  await page.locator('#f-zona_id').selectOption({ label: 'Sur' });
  await shot('form-run');
});

await check('designer: add a text box, bind it, drag it (snaps), resize and move with the keyboard, delete', async () => {
  await page.getByRole('button', { name: 'Vista Diseño' }).click();
  await page.getByRole('button', { name: 'Cuadro de texto', exact: true }).click();
  const added = item('Texto3');
  await added.waitFor();
  await page.getByLabel('Campo del control').selectOption('saldo');
  const box0 = await added.boundingBox();
  // drag 100 px right and 50 px down
  await page.mouse.move(box0.x + 20, box0.y + box0.height / 2);
  await page.mouse.down();
  await page.mouse.move(box0.x + 70, box0.y + 30, { steps: 4 });
  await page.mouse.move(box0.x + 120, box0.y + box0.height / 2 + 50, { steps: 4 });
  await page.mouse.up();
  const l1 = await layoutOf('form');
  const c1 = l1.controls.find((c) => c.name === 'Texto3');
  assert.ok(c1.x % 8 === 0 && c1.y % 8 === 0, `snapped ${c1.x},${c1.y}`);
  assert.ok(c1.x >= 100, `moved right: ${c1.x}`);
  // keyboard: Shift+Right widens by one grid step, Right moves
  await added.focus();
  const w0 = c1.w;
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ArrowDown');
  const c2 = (await layoutOf('form')).controls.find((c) => c.name === 'Texto3');
  assert.equal(c2.w, w0 + 8);
  assert.equal(c2.y, c1.y + 8);
  // numeric properties
  await page.getByLabel('Izquierda', { exact: true }).fill('400');
  assert.equal((await layoutOf('form')).controls.find((c) => c.name === 'Texto3').x, 400);
  // the form grows to hold it
  assert.ok((await layoutOf('form')).width >= 400 + w0);
  // delete key
  await added.focus();
  await page.keyboard.press('Delete');
  await settle();
  assert.equal((await layoutOf('form')).controls.some((c) => c.name === 'Texto3'), false);
  await shot('form-design');
});

await check('designer: undo and redo of the design', async () => {
  const n = (await layoutOf('form')).controls.length;
  await page.getByRole('button', { name: 'Deshacer el diseño' }).click();
  assert.equal((await layoutOf('form')).controls.length, n + 1);
  await page.getByRole('button', { name: 'Rehacer el diseño' }).click();
  assert.equal((await layoutOf('form')).controls.length, n);
});

await check('designer: drop-down list from values, a button, a calculated box; form view uses them', async () => {
  await page.getByRole('button', { name: 'Lista desplegable', exact: true }).click();
  await page.getByLabel('Campo del control').selectOption('nombre');
  await page.getByLabel('Valores de la lista').fill('Ana\nLuis\nEva\nZoe');
  await page.getByRole('button', { name: 'Cuadro de texto', exact: true }).click();
  await page.getByLabel('Expresión calculada').fill('=[saldo] * 2');
  await page.getByRole('button', { name: 'Botón', exact: true }).click();
  await page.getByLabel('Título del botón').fill('Siguiente');
  await page.getByLabel('Acción del botón').selectOption('next');
  await page.getByRole('button', { name: 'Vista Formulario' }).click();
  await page.waitForSelector('.bs-formcanvas');
  assert.equal(await page.locator('.bs-formcanvas input[readonly][aria-label^="Texto"]').last().inputValue(), '21'); // saldo 10.5 * 2
  assert.equal(await page.locator('.bs-formcanvas select[aria-label="Lista1"] option:checked').innerText(), 'Ana');
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  assert.match(await page.locator('.bs-nav').innerText(), /Registro 2 de 3/);
  assert.equal(await page.locator('.bs-formcanvas input[readonly][aria-label^="Texto"]').last().inputValue(), '6'); // Luis: 3 * 2
  // editing the saldo recalculates the calculated box
  await page.locator('#f-saldo').fill('50');
  await page.locator('#f-saldo').blur();
  await settle();
  assert.equal(await page.locator('.bs-formcanvas input[readonly][aria-label^="Texto"]').last().inputValue(), '100');
  await shot('form-run2');
});

await check('subform: the child rows of the current record; add and delete rows; undo', async () => {
  await page.getByRole('button', { name: 'Vista Diseño' }).click();
  await page.getByRole('button', { name: 'Subformulario', exact: true }).click();
  await page.getByLabel('Tabla del subformulario').selectOption('Pedidos');
  await page.getByLabel('Campo vinculado secundario').selectOption('cliente');
  await page.getByLabel('Campo vinculado principal').selectOption('id');
  await page.getByRole('button', { name: 'Vista Formulario' }).click();
  await page.waitForSelector('.bs-subform');
  assert.equal(await page.locator('.bs-subform tbody tr').count(), 2); // Ana: orders 1 and 2
  await page.getByRole('button', { name: 'Registro siguiente' }).click();
  assert.equal(await page.locator('.bs-subform tbody tr').count(), 1); // Luis: order 3
  await page.getByRole('button', { name: 'Registro siguiente' }).click();
  assert.equal(await page.locator('.bs-subform tbody tr').count(), 0);
  await page.getByRole('button', { name: 'Agregar registro' }).click();
  await settle();
  assert.equal(await page.locator('.bs-subform tbody tr').count(), 1);
  assert.deepEqual(await rows(`SELECT count(*) FROM Pedidos WHERE cliente = 3`), [[1]]);
  await page.locator('.bs-subform tbody tr input[aria-label^="total"]').fill('42');
  await page.locator('.bs-subform tbody tr input[aria-label^="total"]').blur();
  await settle();
  assert.deepEqual(await rows(`SELECT total FROM Pedidos WHERE cliente = 3`), [[42]]);
  await page.getByRole('button', { name: /^Quitar el registro/ }).click();
  await settle();
  assert.deepEqual(await rows(`SELECT count(*) FROM Pedidos WHERE cliente = 3`), [[0]]);
  await page.locator('.bs-tabs').click({ position: { x: 900, y: 10 } });
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual(await rows(`SELECT total FROM Pedidos WHERE cliente = 3`), [[42]]);
  await shot('subform');
});

await check('designed forms survive a save to .sqlite and a reopen', async () => {
  const bytes = await db(() => Array.from(window.__novaBase.ctl.db.export()));
  const again = await db((arr) => {
    const c = window.__novaBase.ctl;
    const f = c.forms.get(c.active);
    return { name: c.tab.name, controls: f.layout.controls.length, bytes: arr.length };
  }, bytes);
  assert.ok(again.controls > 8);
  const reloaded = await db(() => {
    const c = window.__novaBase.ctl;
    const SQLbytes = c.db.export();
    c.openBytes(SQLbytes, 'copia.sqlite', null);
    c.openForm(c.db.objects('form')[0]);
    return c.forms.get(c.active).layout.controls.map((x) => x.type);
  });
  assert.ok(reloaded.includes('subform') && reloaded.includes('combo') && reloaded.includes('button'));
  await page.waitForSelector('.bs-subform');
});

await check('report designer: groups, totals, page numbers, chart, in the paginated preview', async () => {
  await page.locator('.bs-nav-pane li button', { hasText: /^Pedidos$/ }).click();
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Diseño de informe', exact: true }).click();
  await page.waitForSelector('.bs-reportframe');
  const frame = page.frameLocator('.bs-reportframe');
  await frame.locator('section.pg').first().waitFor();
  assert.match(await frame.locator('body').innerText(), /Página 1 de 1/);
  await page.getByRole('button', { name: 'Vista Diseño' }).click();
  await page.getByLabel('Agregar agrupación').selectOption('cliente');
  await page.getByLabel('Alto de Pie de grupo (cliente)').fill('26');
  // a subtotal in the group footer
  await page.getByRole('button', { name: /^Pie de grupo \(cliente\)$/, exact: false }).first().click();
  await page.getByRole('button', { name: 'Campo calculado', exact: true }).click();
  await page.getByLabel('Expresión del control').fill('=Sum([total])');
  await page.getByLabel('Formato', { exact: true }).selectOption('dec2');
  // a chart in the report footer
  await page.getByLabel('Alto de Pie del informe').fill('200');
  await page.getByRole('button', { name: /^Pie del informe/ }).first().click();
  await page.getByRole('button', { name: 'Gráfico', exact: true }).click();
  await page.getByLabel('Campo de categoría').selectOption('cliente');
  await page.getByLabel('Campo de valores').selectOption('total');
  await page.getByLabel('Título del gráfico').fill('Total por cliente');
  await shot('report-design');
  await page.getByRole('button', { name: 'Vista previa' }).click();
  const f2 = page.frameLocator('.bs-reportframe');
  await f2.locator('section.pg').first().waitFor();
  const text = await f2.locator('body').innerText();
  assert.match(text, /12,00/); // client 1: 5 + 7
  assert.match(text, /9,00/); // client 2
  assert.match(text, /Total por cliente/);
  assert.ok(await f2.locator('svg').count());
  assert.match(text, /Página 1 de/);
  await shot('report-preview');
});

await check('report designer: the layout is data — move a control with the keyboard and the preview follows', async () => {
  await page.getByRole('button', { name: 'Vista Diseño' }).click();
  const before = await layoutOf('report');
  const title = before.controls.find((c) => c.name === 'Titulo');
  await page.getByRole('button', { name: /Etiqueta Titulo$/ }).focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ArrowDown');
  const after = (await layoutOf('report')).controls.find((c) => c.name === 'Titulo');
  assert.equal(after.w, Math.round((title.w + 8) / 8) * 8); // snapped to the grid
  assert.equal(after.y, title.y + 8);
  await page.getByLabel('Texto de la etiqueta').fill('Pedidos <por> cliente');
  await page.getByRole('button', { name: 'Vista previa' }).click();
  const f = page.frameLocator('.bs-reportframe');
  await f.locator('section.pg').first().waitFor();
  assert.match(await f.locator('body').innerText(), /Pedidos <por> cliente/); // shown as text, not as markup
});

await check('a long report paginates and numbers its pages', async () => {
  await db(() => {
    const c = window.__novaBase.ctl;
    c.db.execute(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 400) INSERT INTO Pedidos (cliente, total, nota) SELECT 1, i, 'x' FROM n`);
    c.touch();
  });
  await settle();
  const pages = await page.frameLocator('.bs-reportframe').locator('section.pg').count();
  assert.ok(pages >= 4, `pages: ${pages}`);
  assert.match(await page.frameLocator('.bs-reportframe').locator('section.pg').nth(1).innerText(), new RegExp(`Página 2 de ${pages}`));
});

await check('labels: a sheet of labels, one record per label', async () => {
  await page.locator('.bs-nav-pane li button', { hasText: /^Clientes$/ }).click();
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Etiquetas', exact: true }).click();
  const f = page.frameLocator('.bs-reportframe');
  await f.locator('section.pg').first().waitFor();
  const t = await f.locator('body').innerText();
  assert.match(t, /Ana/);
  assert.match(t, /Luis/);
  assert.match(t, /Eva/);
  assert.equal(await f.locator('section.pg').count(), 1);
  await shot('labels');
});

await check('a quick report converts to a free design and keeps its totals', async () => {
  await page.locator('.bs-nav-pane li button', { hasText: /^Pedidos$/ }).click();
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Informe', exact: true }).click();
  await page.getByLabel('Agrupar por', { exact: true }).selectOption('cliente');
  await page.getByRole('checkbox', { name: 'total' }).last().check();
  await page.getByRole('button', { name: 'Convertir en diseño libre' }).click();
  const f = page.frameLocator('.bs-reportframe');
  await f.locator('section.pg').first().waitFor();
  assert.match(await f.locator('body').innerText(), /Subtotal/);
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
