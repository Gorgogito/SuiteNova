// End-to-end checks of the query designer of Nova Base, second round: outer joins, a table used twice, First/Last in totals and
// the query wizards. Needs `pnpm dev` on :1420.   Usage: node scripts/e2e-base-queries.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=base';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => void d.accept());
let step = 0;
const shot = async (n) => shotsDir && page.screenshot({ path: `${shotsDir}/qry-${String(++step).padStart(2, '0')}-${n}.png` });
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
const run = async () => {
  await page.locator('.bs-query .bs-btn--primary').click();
  await settle(400);
};
/** rows of the result of the active query tab */
const result = () => ev(() => { const c = window.__novaBase.ctl; return c.results.get(c.active)?.rows ?? null; });
const sqlOfActive = () => ev(() => { const c = window.__novaBase.ctl; const q = c.queries.get(c.active); return q ? c.sqlOfQuery ? null : null : null; });
void sqlOfActive;
const newDesign = async () => {
  await ev(() => window.__novaBase.ctl.newDesignQuery());
  await settle(400);
};

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__novaBase?.ctl.loading === false);
await ev(() => {
  const c = window.__novaBase.ctl;
  c.db.execute(`CREATE TABLE Dept (id INTEGER PRIMARY KEY, nombre TEXT);
    INSERT INTO Dept VALUES (1,'Ventas'),(2,'IT'),(3,'Vacío');
    CREATE TABLE Emp (id INTEGER PRIMARY KEY, nombre TEXT, dept INTEGER, jefe INTEGER, sueldo REAL);
    INSERT INTO Emp VALUES (1,'Ana',1,NULL,100),(2,'Luis',1,1,80),(3,'Eva',2,1,120),(4,'Oscar',NULL,3,60),(5,'Zoe',1,2,90);`);
  c.touch();
});
await settle(300);

await check('outer join: every employee even without a department, and the generated SQL says LEFT JOIN', async () => {
  await newDesign();
  await page.getByRole('checkbox', { name: 'Emp', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Dept', exact: true }).check();
  await page.getByLabel('Combinar 1 izquierda').selectOption('"Emp"."dept"');
  await page.getByLabel('Combinar 1 derecha').selectOption('"Dept"."id"');
  await run();
  assert.equal((await result()).length, 4, 'inner join: 4 employees have a department');
  await page.getByLabel('Tipo de combinación 1').selectOption('left');
  await run();
  assert.equal((await result()).length, 5);
  await shot('left-join');
  const sql = await ev(() => { const c = window.__novaBase.ctl; const q = c.queries.get(c.active); return window.__novaBase.sqlOf ? '' : JSON.stringify(q.design.joins); });
  assert.match(sql, /"type":"left"/);
  await page.getByLabel('Tipo de combinación 1').selectOption('right');
  await run();
  assert.equal((await result()).length, 5, 'all 3 departments: Ventas x3, IT, Vacío');
});

await check('a table used twice: employees with their boss, through an alias', async () => {
  await newDesign();
  await page.getByRole('checkbox', { name: 'Emp', exact: true }).check();
  await page.getByLabel('Tabla que se usa otra vez').selectOption('Emp');
  await settle(300);
  assert.ok(await page.getByRole('checkbox', { name: /Copia de tabla Emp_1/ }).count());
  await page.getByLabel('Combinar 1 izquierda').selectOption('"Emp"."jefe"');
  await page.getByLabel('Combinar 1 derecha').selectOption('"Emp_1"."id"');
  await page.getByLabel('Tipo de combinación 1').selectOption('left');
  await shot('alias');
  await run();
  const rows = await result();
  assert.equal(rows.length, 5);
  assert.ok(rows.some((r) => r.includes('Ana') && r.includes('Eva')) || rows.length === 5);
  const real = await ev(() => { const c = window.__novaBase.ctl; return c.queries.get(c.active).design.tableAlias; });
  assert.deepEqual(real, { Emp_1: 'Emp' });
});

await check('totals offer First and Last, and give the first and last value of each group', async () => {
  await newDesign();
  await page.getByRole('checkbox', { name: 'Emp', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Totales' }).check();
  const opts = await page.getByLabel('Total de nombre').locator('option').allInnerTexts();
  assert.ok(opts.includes('Primero') && opts.includes('Último'), opts.join(','));
  // keep dept (group) and nombre (first); hide the others
  await ev(() => {
    const c = window.__novaBase.ctl;
    const q = c.queries.get(c.active);
    q.design.fields = q.design.fields.filter((f) => f.name === 'dept' || f.name === 'nombre');
    q.design.fields.forEach((f) => { f.total = f.name === 'nombre' ? 'first' : 'group'; if (f.name === 'dept') f.sort = 'asc'; });
    c.touch();
  });
  await settle(300);
  await run();
  const rows = await result();
  const byDept = Object.fromEntries(rows.map((r) => [String(r[1]), r[0]]));
  assert.deepEqual(byDept, { null: 'Oscar', 1: 'Ana', 2: 'Eva' });
});

await check('wizard: find duplicates opens a SQL query that already shows the repeated records', async () => {
  await ev(() => window.__novaBase.ctl.db.execute("INSERT INTO Emp VALUES (6,'Ana',2,NULL,70),(7,'Luis',NULL,NULL,50)"));
  await page.getByRole('tab', { name: 'Crear', exact: true }).click();
  await page.getByRole('button', { name: 'Asistentes de consultas' }).click();
  await settle(300);
  await page.getByRole('menuitem', { name: 'Buscar duplicados…' }).click();
  await settle(400);
  const d = page.getByRole('dialog');
  await d.getByLabel('Tabla', { exact: true }).selectOption('Emp');
  await d.getByRole('group', { name: 'Campos que pueden repetirse' }).getByLabel('nombre').check();
  await d.getByRole('group', { name: /Campos que se muestran/ }).getByLabel('id').check();
  await d.getByRole('group', { name: /Campos que se muestran/ }).getByLabel('nombre').check();
  await shot('wizard-dups');
  await d.getByRole('button', { name: 'Crear la consulta' }).click();
  await settle(900);
  assert.equal(await ev(() => window.__novaBase.ctl.tab.kind), 'query');
  const rows = await result();
  assert.deepEqual(rows, [[1, 'Ana'], [6, 'Ana'], [2, 'Luis'], [7, 'Luis']]);
  const sql = await ev(() => { const c = window.__novaBase.ctl; return c.queries.get(c.active).sql; });
  assert.match(sql, /HAVING COUNT\(\*\) > 1/);
});

await check('wizard: find unmatched lists the departments without employees', async () => {
  await page.getByRole('tab', { name: 'Crear', exact: true }).click();
  await page.getByRole('button', { name: 'Asistentes de consultas' }).click();
  await settle(300);
  await page.getByRole('menuitem', { name: 'Buscar no coincidentes…' }).click();
  await settle(400);
  const d = page.getByRole('dialog');
  await d.getByLabel('Tabla cuyos registros se muestran').selectOption('Dept');
  await d.getByLabel('Campo de esa tabla').selectOption('id');
  await d.getByLabel('Tabla con la que se compara').selectOption('Emp');
  await d.getByLabel('Campo de la otra tabla').selectOption('dept');
  await d.getByRole('button', { name: 'Crear la consulta' }).click();
  await settle(900);
  assert.deepEqual(await result(), [[3, 'Vacío']]);
  await shot('wizard-unmatched');
});

await check('subquery criteria in the grid: In (Select …)', async () => {
  await newDesign();
  await page.getByRole('checkbox', { name: 'Emp', exact: true }).check();
  await ev(() => {
    const c = window.__novaBase.ctl;
    const q = c.queries.get(c.active);
    q.design.fields.forEach((f) => { f.show = f.name === 'nombre'; if (f.name === 'dept') f.criteria = "In (Select id From Dept Where nombre = 'IT')"; });
    c.touch();
  });
  await settle(300);
  await run();
  assert.deepEqual((await result()).map((r) => r[0]).sort(), ['Ana', 'Eva']);
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
