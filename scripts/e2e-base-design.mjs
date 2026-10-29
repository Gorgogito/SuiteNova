// End-to-end checks of Nova Base's undo, query designer (totals, parameters, crosstab, union, action) and relationships window.
// Needs `pnpm dev` running on :1420. Usage: node scripts/e2e-base-design.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=base';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
const dialogs = [];
let acceptNext = [];
page.on('dialog', (d) => {
  dialogs.push(`${d.type()}: ${d.message()}`);
  if (d.type() === 'confirm' && acceptNext.some((re) => re.test(d.message()))) return void d.accept();
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
const settle = () => page.waitForTimeout(200);
const nav = (name) => page.locator('.bs-nav-pane li button', { hasText: new RegExp(`^${name}$`) });
const rows = (sql) => db((s) => window.__novaBase.ctl.db.execute(s).rows, sql);
const cellText = (r, c) => page.locator(`.bs-grid [role="row"][aria-rowindex="${r + 2}"] [role="gridcell"][aria-colindex="${c + 1}"]`).innerText();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__novaBase?.ctl.loading === false);
await page.screenshot();

// sample data through the engine
await db(() => {
  const c = window.__novaBase.ctl;
  c.db.execute(`CREATE TABLE Clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, zona TEXT);
    CREATE TABLE Ventas (id INTEGER PRIMARY KEY, cliente INTEGER, anio INTEGER, importe REAL);
    INSERT INTO Clientes (nombre, zona) VALUES ('Ana','Norte'), ('Luis','Sur'), ('Eva','Norte');
    INSERT INTO Ventas VALUES (1,1,2023,100), (2,1,2024,50), (3,2,2023,30), (4,2,2024,70), (5,3,2024,10);
    CREATE VIEW V_norte AS SELECT nombre FROM Clientes WHERE zona = 'Norte';
    CREATE TABLE Bitacora (msg TEXT);
    CREATE TRIGGER t_cli AFTER INSERT ON Clientes BEGIN INSERT INTO Bitacora VALUES ('alta ' || NEW.nombre); END;
    CREATE INDEX ix_lower ON Clientes (lower(nombre));
    CREATE INDEX ix_norte ON Clientes (nombre) WHERE zona = 'Norte';`);
  c.db.clearUndo();
  c.touch();
});
await settle();

await check('undo and redo: Ctrl+Z, ribbon, status message, not inside a text box', async () => {
  await nav('Clientes').dblclick();
  await page.waitForSelector('.bs-grid');
  await page.locator('.bs-grid [role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="2"]').dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Ana María');
  await page.keyboard.press('Enter');
  assert.equal(await cellText(0, 1), 'Ana María');
  assert.equal(await page.getByRole('button', { name: 'Deshacer' }).first().isEnabled(), true);
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal(await cellText(0, 1), 'Ana');
  assert.match(await page.locator('.nova-statusbar, [role="status"], footer').first().innerText().catch(() => ''), /./);
  assert.match(await db(() => window.__novaBase.ctl.notice), /Se deshizo: Editar Clientes\.nombre/);
  await page.keyboard.press('Control+y');
  await settle();
  assert.equal(await cellText(0, 1), 'Ana María');
  // delete a record, undo from the ribbon
  await page.locator('.bs-row[aria-rowindex="3"] .bs-rh').click();
  await page.getByRole('button', { name: 'Eliminar registros' }).click();
  acceptNext = [/Eliminar/];
  await settle();
  assert.equal(await db(() => window.__novaBase.ctl.db.count('Clientes')), 3);
});
acceptNext = [/Eliminar/];
await check('undo: a deleted record comes back through the ribbon button', async () => {
  await page.locator('.bs-row[aria-rowindex="3"] .bs-rh').click();
  await page.getByRole('button', { name: 'Eliminar registros' }).click();
  await settle();
  assert.equal(await db(() => window.__novaBase.ctl.db.count('Clientes')), 2);
  await page.getByRole('tab', { name: 'Inicio' }).click();
  await page.getByRole('button', { name: 'Deshacer', exact: true }).first().click();
  await settle();
  assert.equal(await db(() => window.__novaBase.ctl.db.count('Clientes')), 3);
  assert.equal(await cellText(1, 1), 'Luis');
});

await check('Ctrl+Z inside the SQL editor edits the text, not the data', async () => {
  await db(() => window.__novaBase.ctl.db.updateCell('Clientes', 1, 'zona', 'Este'));
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Consulta SQL', exact: true }).click();
  const ta = page.getByLabel('SQL', { exact: true });
  await ta.fill('SELECT 1');
  await ta.focus();
  await page.keyboard.press('Control+z');
  assert.equal(await rows(`SELECT zona FROM Clientes WHERE id = 1`).then((r) => r[0][0]), 'Este');
  await ta.blur();
  await page.locator('.bs-tabs').click({ position: { x: 600, y: 10 } });
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal(await rows(`SELECT zona FROM Clientes WHERE id = 1`).then((r) => r[0][0]), 'Norte');
});

await check('designer: totals with grouping, alias and a criteria on the sum', async () => {
  await page.getByRole('button', { name: 'Diseño', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Clientes' }).check();
  await page.getByRole('checkbox', { name: 'Ventas' }).check();
  // the join must be set by hand here (no relationship exists yet)
  await page.getByLabel('Combinar 1 izquierda').selectOption('"Clientes"."id"');
  await page.getByLabel('Combinar 1 derecha').selectOption('"Ventas"."cliente"');
  // keep only Clientes.nombre and Ventas.importe: remove Ventas.id first (the second "id"), then the rest
  await page.getByRole('button', { name: 'Quitar id' }).nth(1).click();
  await page.getByRole('button', { name: 'Quitar id' }).first().click();
  await page.getByRole('button', { name: 'Quitar zona' }).click();
  await page.getByRole('checkbox', { name: 'Totales' }).check();
  await page.getByLabel('Total de importe').selectOption('sum');
  await page.getByLabel('Criterios de importe').fill('>=40');
  await page.getByLabel('Orden de importe').selectOption('desc');
  for (const f of ['cliente', 'anio']) await page.getByRole('button', { name: `Quitar ${f}` }).click();
  const sql = await page.locator('.bs-sqlprev').innerText();
  assert.match(sql, /GROUP BY/);
  assert.match(sql, /HAVING SUM\("Ventas"\."importe"\) >= 40/);
  await page.getByRole('button', { name: /Ejecutar/ }).click();
  await settle();
  const res = await db(() => window.__novaBase.ctl.results.get(window.__novaBase.ctl.active));
  assert.deepEqual(res.columns.slice(-1), ['Suma de importe']);
  assert.deepEqual(res.rows.map((r) => r[r.length - 1]), [150, 100]);
  await shot('totals');
});

await check('designer: [parameters] ask for a value and are bound', async () => {
  await page.getByRole('button', { name: 'Crear' }).first().click().catch(() => {});
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Diseño de consulta', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Ventas' }).check();
  await page.getByLabel('Criterios de importe').fill('>[Importe mínimo]');
  assert.ok(await page.getByRole('group', { name: 'Parámetros' }).count());
  await page.getByLabel('Valor de Importe mínimo').fill('45');
  await page.getByRole('button', { name: /Ejecutar/ }).click();
  await settle();
  const res = await db(() => window.__novaBase.ctl.results.get(window.__novaBase.ctl.active));
  assert.deepEqual(res.rows.map((r) => r[3]).sort((a, b) => a - b), [50, 70, 100]);
  // hostile value: nothing is executed, nothing matches
  await page.getByLabel('Valor de Importe mínimo').fill('0; DROP TABLE Ventas; --');
  await page.getByRole('button', { name: /Ejecutar/ }).click();
  await settle();
  assert.equal(await db(() => window.__novaBase.ctl.db.count('Ventas')), 5);
});

await check('designer: crosstab builds its columns from the data', async () => {
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Diseño de consulta', exact: true }).click();
  await page.getByLabel('Tipo de consulta').selectOption('crosstab');
  await page.getByRole('checkbox', { name: 'Ventas' }).check();
  await page.getByLabel('Referencia cruzada de cliente').selectOption('row');
  await page.getByLabel('Referencia cruzada de anio').selectOption('column');
  await page.getByLabel('Referencia cruzada de importe').selectOption('value');
  await page.getByRole('button', { name: /Ejecutar/ }).click();
  await settle();
  const res = await db(() => window.__novaBase.ctl.results.get(window.__novaBase.ctl.active));
  assert.deepEqual(res.columns, ['cliente', '2023', '2024', 'Total']);
  assert.deepEqual(res.rows, [[1, 100, 50, 150], [2, 30, 70, 100], [3, null, 10, 10]]);
  await shot('crosstab');
});

await check('designer: union of two tables', async () => {
  await db(() => window.__novaBase.ctl.db.execute(`CREATE TABLE A (x INTEGER, y TEXT); CREATE TABLE B (x INTEGER, y TEXT); INSERT INTO A VALUES (1,'a'),(2,'b'); INSERT INTO B VALUES (2,'b'),(3,'c')`));
  await db(() => window.__novaBase.ctl.touch());
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Diseño de consulta', exact: true }).click();
  await page.getByLabel('Tipo de consulta').selectOption('union');
  await page.getByRole('button', { name: 'Agregar origen' }).click();
  await page.getByRole('button', { name: 'Agregar origen' }).click();
  await page.getByLabel('Origen 1', { exact: true }).selectOption('A');
  await page.getByLabel('Origen 2', { exact: true }).selectOption('B');
  await page.getByRole('button', { name: /Ejecutar/ }).click();
  await settle();
  assert.equal((await db(() => window.__novaBase.ctl.results.get(window.__novaBase.ctl.active).rows)).length, 3);
  await page.getByLabel('Conservar duplicados (UNION ALL)').check();
  await page.getByRole('button', { name: /Ejecutar/ }).click();
  await settle();
  assert.equal((await db(() => window.__novaBase.ctl.results.get(window.__novaBase.ctl.active).rows)).length, 4);
});

await check('designer: a delete query asks first and can be undone', async () => {
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Diseño de consulta', exact: true }).click();
  await page.getByLabel('Tipo de consulta').selectOption('delete');
  await page.getByRole('checkbox', { name: 'Ventas' }).check();
  await page.getByLabel('Criterios de importe').fill('<40');
  assert.match(await page.locator('.bs-sqlprev').innerText(), /^DELETE FROM "Ventas"/);
  // refusing the confirmation does nothing
  acceptNext = [];
  await page.getByRole('button', { name: /Ejecutar/ }).click();
  await settle();
  assert.equal(await db(() => window.__novaBase.ctl.db.count('Ventas')), 5);
  acceptNext = [/modifica datos/];
  await page.getByRole('button', { name: /Ejecutar/ }).click();
  await settle();
  assert.equal(await db(() => window.__novaBase.ctl.db.count('Ventas')), 3);
  assert.match(await page.locator('.bs-result').innerText(), /2 filas afectadas/);
  await page.keyboard.press('Escape');
  await page.locator('.bs-tabs').click({ position: { x: 700, y: 10 } });
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal(await db(() => window.__novaBase.ctl.db.count('Ventas')), 5);
  acceptNext = [/Eliminar/];
});

await check('relationships window: create with cascade, see the line, cascade really deletes', async () => {
  await page.getByRole('tab', { name: 'Herramientas' }).click();
  await page.getByRole('button', { name: 'Relaciones', exact: true }).click();
  await page.waitForSelector('.bs-reldiagram svg');
  assert.ok(await page.locator('.bs-relbox').count() >= 5);
  await page.getByLabel('Tabla secundaria', { exact: true }).selectOption('Ventas');
  await page.getByLabel('Campo secundario').selectOption('cliente');
  await page.getByLabel('Tabla principal', { exact: true }).selectOption('Clientes');
  await page.getByLabel('Campo principal').selectOption('id');
  await page.getByLabel('Nueva: al eliminar').selectOption('CASCADE');
  await page.getByRole('button', { name: 'Crear relación' }).click();
  await settle();
  assert.match(await page.locator('.bs-relside .bs-ok').innerText(), /Se creó la relación/);
  assert.equal(await page.locator('[data-testid="rel-hit"]').count(), 1);
  assert.match(await page.locator('.bs-rellist').innerText(), /Ventas\.cliente → Clientes\.id/);
  // the view, trigger and expression/partial indexes of Clientes were not touched (only Ventas was rebuilt)
  assert.equal(await db(() => window.__novaBase.ctl.db.relations()[0].onDelete), 'CASCADE');
  await shot('relations');
  // cascade: deleting a customer deletes its sales
  await db(() => window.__novaBase.ctl.db.execute('DELETE FROM Clientes WHERE nombre = \'Eva\''));
  assert.equal(await db(() => window.__novaBase.ctl.db.count('Ventas')), 4);
  await page.keyboard.press('Escape');
  await page.locator('.bs-tabs').click({ position: { x: 700, y: 10 } });
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal(await db(() => window.__novaBase.ctl.db.count('Ventas')), 5);
});

await check('relationships window: change the actions and delete the relationship', async () => {
  await page.locator('.bs-rellist button').first().click();
  await page.getByLabel('Al eliminar el registro principal').selectOption('SET NULL');
  await page.getByRole('button', { name: 'Aplicar cambios' }).click();
  await settle();
  assert.equal(await db(() => window.__novaBase.ctl.db.relations()[0].onDelete), 'SET NULL');
  assert.equal(await db(() => window.__novaBase.ctl.db.count('Ventas')), 5);
  acceptNext = [/Eliminar la relación/];
  await page.getByRole('button', { name: 'Eliminar relación' }).click();
  await settle();
  assert.equal(await db(() => window.__novaBase.ctl.db.relations().length), 0);
  assert.equal(await db(() => window.__novaBase.ctl.db.count('Ventas')), 5);
  acceptNext = [/Eliminar/];
});

await check('a relationship that existing data would break is refused with a reason', async () => {
  await db(() => window.__novaBase.ctl.db.execute('INSERT INTO Ventas VALUES (99, 777, 2024, 1)'));
  await page.getByLabel('Tabla secundaria', { exact: true }).selectOption('Ventas');
  await page.getByLabel('Campo secundario').selectOption('cliente');
  await page.getByLabel('Tabla principal', { exact: true }).selectOption('Clientes');
  await page.getByLabel('Campo principal').selectOption('id');
  await page.getByRole('button', { name: 'Crear relación' }).click();
  await settle();
  assert.match(await page.locator('.bs-relside .bs-error').innerText(), /correspondencia/);
  assert.equal(await db(() => window.__novaBase.ctl.db.relations().length), 0);
  await db(() => window.__novaBase.ctl.db.execute('DELETE FROM Ventas WHERE id = 99'));
});

await check('redesign keeps the view, trigger, expression and partial indexes; says what it kept', async () => {
  await db(() => window.__novaBase.ctl.openDesign('Clientes'));
  await settle();
  await page.getByRole('button', { name: 'Agregar campo' }).click();
  await page.getByLabel('Nombre del campo 4').fill('telefono');
  await page.getByRole('button', { name: 'Guardar tabla' }).click();
  await settle();
  const msg = await page.locator('.bs-design .bs-ok').innerText();
  assert.match(msg, /Se conservaron 2 índices, 1 vistas y 1 disparadores/);
  assert.deepEqual(await rows(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='Clientes' ORDER BY name`), [['ix_lower'], ['ix_norte']]);
  assert.deepEqual(await rows('SELECT nombre FROM V_norte ORDER BY nombre'), [['Ana María'], ['Eva']]);
  await db(() => window.__novaBase.ctl.db.execute(`INSERT INTO Clientes (nombre, zona) VALUES ('Zoe','Sur')`));
  assert.deepEqual(await rows(`SELECT msg FROM Bitacora ORDER BY rowid DESC LIMIT 1`), [['alta Zoe']]);
  // rename a column used by the view: the view follows
  await page.getByLabel('Nombre del campo 2').fill('titulo');
  await page.getByRole('button', { name: 'Guardar tabla' }).click();
  await settle();
  assert.deepEqual(await rows('SELECT titulo FROM V_norte ORDER BY titulo'), [['Ana María'], ['Eva']]);
  // removing a column that the view needs: reported, not silently lost
  await page.getByLabel('Nombre del campo 3').click();
  await page.getByLabel('Nombre del campo 2').click();
  await page.getByRole('button', { name: 'Eliminar campo' }).click();
  await page.getByRole('button', { name: 'Guardar tabla' }).click();
  await settle();
  assert.match(await page.locator('.bs-design .bs-ok').innerText(), /No se pudieron conservar: .*vista V_norte/);
  assert.deepEqual(await rows(`SELECT name FROM sqlite_master WHERE type='view'`), []);
  await shot('redesign');
  // and the whole redesign is one undo step
  await page.locator('.bs-tabs').click({ position: { x: 700, y: 10 } });
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual(await rows(`SELECT name FROM sqlite_master WHERE type='view'`), [['V_norte']]);
});

await check('no console errors; dialogs were only the expected confirmations', async () => {
  assert.deepEqual(errors, []);
  const unexpected = dialogs.filter((d) => !/Eliminar|modifica datos/.test(d));
  assert.deepEqual(unexpected, []);
});

await browser.close();
let failed = 0;
for (const [s, n, msg] of results) {
  if (s !== 'ok') failed++;
  console.log(`${s === 'ok' ? '✓' : '✗'} ${n}${msg ? '\n    ' + msg : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
