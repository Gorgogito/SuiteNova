// End-to-end checks of Nova Base's queries, third round (Access parity): joins on other comparisons, top percent,
// saved queries as the source of another query, the expression builder, and data-definition SQL.
// Needs `pnpm dev` running on :1420. Usage: node scripts/e2e-base-queries2.mjs [--shots dir]
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
const exact = { exact: true };
const rowsShown = async () => (await page.locator('.bs-query [role=gridcell]').count());
const resultRows = () => db(() => { const c = window.__novaBase.ctl; return c.results.get(c.active)?.rows ?? []; });
const run = async () => { await page.getByRole('button', { name: /^Ejecutar/ }).first().click(); await settle(); };
const newDesign = async () => {
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Diseño de consulta', exact: true }).click();
  await page.waitForSelector('.bs-designer');
};

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__novaBase?.ctl.loading === false);
await db(() => {
  const c = window.__novaBase.ctl;
  c.db.execute(`CREATE TABLE Emp (id INTEGER PRIMARY KEY, nombre TEXT, sueldo REAL);
    INSERT INTO Emp VALUES (1,'Ana',100),(2,'Luis',80),(3,'Eva',120),(4,'Oscar',60),(5,'Zoe',90),(6,'Ivan',70),(7,'Ada',110),(8,'Bea',95),(9,'Cai',50),(10,'Dan',40);
    CREATE TABLE Tramo (id INTEGER PRIMARY KEY, etiqueta TEXT, desde REAL, hasta REAL);
    INSERT INTO Tramo VALUES (1,'bajo',0,70),(2,'medio',70,100),(3,'alto',100,1000);`);
  c.db.saveObject('query', 'Caros', { mode: 'sql', sql: 'SELECT id, nombre, sueldo FROM Emp WHERE sueldo >= 100', design: { tables: [], fields: [] } });
  c.db.clearUndo();
  c.touch();
});
await settle();

await check('top percent: 30 % of ten records is three', async () => {
  await newDesign();
  await page.getByRole('checkbox', { name: 'Emp', exact: true }).check();
  await page.getByLabel('Límite de registros', exact).fill('30');
  await page.getByLabel('Límite en porcentaje', exact).check();
  assert.match(await page.locator('.bs-sqlprev').innerText(), /LIMIT CAST\(\(\(SELECT count\(\*\) FROM/);
  await run();
  assert.equal((await resultRows()).length, 3);
  await shot('top-percent');
});

await check('a join on a comparison other than equality (a range of salaries)', async () => {
  await newDesign();
  await page.getByRole('checkbox', { name: 'Emp', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Tramo', exact: true }).check();
  await page.getByLabel('Combinar 1 izquierda', exact).selectOption('"Emp"."sueldo"');
  await page.getByLabel('Operador de combinación 1', exact).selectOption('>=');
  await page.getByLabel('Combinar 1 derecha', exact).selectOption('"Tramo"."desde"');
  await page.getByLabel('Combinar 2 izquierda', exact).selectOption('"Emp"."sueldo"');
  await page.getByLabel('Operador de combinación 2', exact).selectOption('<');
  await page.getByLabel('Combinar 2 derecha', exact).selectOption('"Tramo"."hasta"');
  assert.match(await page.locator('.bs-sqlprev').innerText(), /"Emp"\."sueldo" >= "Tramo"\."desde"/);
  assert.match(await page.locator('.bs-sqlprev').innerText(), /"Emp"\."sueldo" < "Tramo"\."hasta"/);
  await run();
  const rows = await resultRows();
  assert.equal(rows.length, 10); // every employee falls in exactly one range
  await shot('join-range');
});

await check('a saved query is chosen as the table of another query', async () => {
  await newDesign();
  await page.getByRole('checkbox', { name: 'Consulta como origen Caros', exact: true }).check();
  const sql = await page.locator('.bs-sqlprev').innerText();
  assert.match(sql, /FROM \(SELECT id, nombre, sueldo FROM Emp WHERE sueldo >= 100\) AS "Caros"/);
  await run();
  assert.equal((await resultRows()).length, 3);
  // and joined with a real table
  await page.getByRole('checkbox', { name: 'Emp', exact: true }).check();
  await page.getByLabel('Combinar 1 izquierda', exact).selectOption('"Caros"."id"');
  await page.getByLabel('Combinar 1 derecha', exact).selectOption('"Emp"."id"');
  await run();
  assert.equal((await resultRows()).length, 3);
  await shot('query-as-source');
});

await check('the expression builder inserts fields, functions and operators into a calculated field', async () => {
  await newDesign();
  await page.getByRole('checkbox', { name: 'Emp', exact: true }).check();
  await page.getByRole('button', { name: 'Agregar campo calculado', exact: true }).click();
  const hasCalc = await page.getByLabel(/^Expresión de /).count();
  assert.ok(hasCalc >= 1, 'a calculated field exists');
  await page.getByRole('button', { name: /^Generador de expresiones de /, exact: false }).first().click();
  const box = page.getByLabel('Expresión del generador', exact);
  await box.fill('');
  await page.getByRole('group', { name: 'Funciones' }).getByRole('button', { name: 'round', exact: true }).click();
  await page.getByRole('group', { name: 'Campos' }).getByRole('button', { name: 'Emp.sueldo', exact: true }).click();
  assert.match(await box.inputValue(), /^round\("Emp"\."sueldo", 2\)$|^round\("Emp"\."sueldo"/);
  await page.getByRole('group', { name: 'Operadores' }).getByRole('button', { name: '*', exact: true }).click();
  await shot('expression-builder');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  const expr = await page.getByLabel(/^Expresión de /).first().inputValue();
  assert.match(expr, /round\("Emp"\."sueldo"/);
  assert.match(expr, /\*/);
});

await check('data-definition SQL: CREATE, ALTER and DROP run from a query window, refresh the navigation pane and can be undone', async () => {
  await db(() => window.__novaBase.ctl.newQuery('CREATE TABLE Nueva (id INTEGER PRIMARY KEY, nota TEXT)'));
  await run();
  await page.waitForSelector('.bs-nav-pane li button:has-text("Nueva")');
  assert.ok((await db(() => window.__novaBase.ctl.db.tableNames())).includes('Nueva'));
  await db(() => window.__novaBase.ctl.newQuery('ALTER TABLE Nueva ADD COLUMN extra REAL DEFAULT 5'));
  await run();
  assert.deepEqual((await db(() => window.__novaBase.ctl.db.columns('Nueva'))).map((c) => c.name), ['id', 'nota', 'extra']);
  await db(() => window.__novaBase.ctl.newQuery('CREATE INDEX ix_nota ON Nueva (nota); CREATE VIEW VNueva AS SELECT nota FROM Nueva'));
  await run();
  assert.ok((await db(() => window.__novaBase.ctl.db.viewNames())).includes('VNueva'));
  await db(() => window.__novaBase.ctl.newQuery('DROP TABLE Nueva'));
  await run();
  assert.ok(!(await db(() => window.__novaBase.ctl.db.tableNames())).includes('Nueva'));
  await db(() => window.__novaBase.ctl.db.undo());
  assert.ok((await db(() => window.__novaBase.ctl.db.tableNames())).includes('Nueva'));
  await shot('ddl');
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
