// End-to-end checks of Nova Base's tables, third round (Access parity): calculated fields and attachments,
// from the table designer, the datasheet and a form.
// Needs `pnpm dev` running on :1420. Usage: node scripts/e2e-base-tables.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=base';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
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
const cols = (t) => db((n) => window.__novaBase.ctl.db.columns(n), t);
const exact = { exact: true };
const save = async () => { await page.getByRole('button', { name: 'Guardar tabla', exact: true }).click(); await settle(); };

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__novaBase?.ctl.loading === false);
await db(() => {
  const c = window.__novaBase.ctl;
  c.db.execute(`CREATE TABLE Lineas (id INTEGER PRIMARY KEY AUTOINCREMENT, producto TEXT, precio REAL, cantidad INTEGER);
    INSERT INTO Lineas (producto, precio, cantidad) VALUES ('Tornillo', 2.5, 4), ('Tuerca', 1, 10);`);
  c.db.clearUndo();
  c.touch();
});
await settle();

await check('a calculated field is added in the designer, computed by the table and refused for writing', async () => {
  await db(() => window.__novaBase.ctl.openDesign('Lineas'));
  await page.getByRole('button', { name: 'Agregar campo', exact: true }).click();
  await page.getByLabel('Nombre del campo 5', exact).fill('total');
  await page.getByLabel('Tipo de datos 5', exact).selectOption('CALC');
  await page.getByLabel('Expresión del campo calculado', exact).fill('[precio] * [cantidad]');
  await shot('calculated-design');
  await save();
  const c = (await cols('Lineas')).find((x) => x.name === 'total');
  assert.deepEqual(c.generated, { expr: '"precio" * "cantidad"', stored: false });
  assert.deepEqual(await rows('SELECT total FROM Lineas ORDER BY id'), [[10], [10]]);
  const err = await db(() => { try { window.__novaBase.ctl.db.updateCell('Lineas', 1, 'total', '5'); return null; } catch (e) { return e.message; } });
  assert.match(err, /es calculado/);
});

await check('the datasheet shows the calculated column and does not open an editor on it', async () => {
  await db(() => window.__novaBase.ctl.openTable('Lineas'));
  await page.waitForSelector('[role=gridcell][data-col=total]');
  assert.equal(await page.locator('[role=gridcell][data-col=total]').first().innerText(), '10');
  await page.locator('[role=gridcell][data-col=total]').first().dblclick();
  assert.equal(await page.locator('input[aria-label=total]').count(), 0);
  await page.locator('[role=gridcell][data-col=cantidad]').first().dblclick();
  assert.equal(await page.locator('input[aria-label=cantidad]').count(), 1);
  await page.keyboard.press('Escape');
  await shot('calculated-datasheet');
});

await check('renaming a field in the design is followed by the expression; the result can be stored', async () => {
  await db(() => window.__novaBase.ctl.openDesign('Lineas'));
  await page.getByLabel('Nombre del campo 3', exact).fill('unitario');
  await page.getByLabel('Nombre del campo 5', exact).click();
  await page.getByLabel('Guardar el resultado', exact).check();
  await save();
  const c = (await cols('Lineas')).find((x) => x.name === 'total');
  assert.deepEqual(c.generated, { expr: '"unitario" * "cantidad"', stored: true });
  assert.deepEqual(await rows('SELECT unitario, total FROM Lineas ORDER BY id'), [[2.5, 10], [1, 10]]);
  assert.equal((await db(() => window.__novaBase.ctl.db.getMeta('Lineas').fields.total.calc)), '[unitario] * [cantidad]');
});

await check('an expression with a missing field, or one that changes every time, is explained and nothing is saved', async () => {
  await db(() => window.__novaBase.ctl.openDesign('Lineas'));
  await page.getByLabel('Nombre del campo 5', exact).click();
  await page.getByLabel('Expresión del campo calculado', exact).fill('[nada] * 2');
  await save();
  assert.match(await page.getByRole('alert').innerText(), /\[nada\] no existe/);
  await page.getByLabel('Expresión del campo calculado', exact).fill('Fecha()');
  await save();
  assert.match(await page.getByRole('alert').innerText(), /siempre el mismo resultado/);
  assert.equal((await cols('Lineas')).find((x) => x.name === 'total').generated.expr, '"unitario" * "cantidad"');
  await page.getByLabel('Expresión del campo calculado', exact).fill('[unitario] * [cantidad] * 2');
  await save();
  assert.deepEqual(await rows('SELECT total FROM Lineas ORDER BY id'), [[20], [20]]);
});

await check('a forms for the table shows the calculated field read-only', async () => {
  await page.locator('.bs-nav-pane li button', { hasText: /^Lineas$/ }).click();
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Formulario', exact: true }).click();
  await page.waitForSelector('.bs-formcanvas');
  assert.equal(await page.locator('#f-total').getAttribute('readonly'), '');
});

await check('attachments: a field of that kind shows how many files, and its window adds, saves and removes them', async () => {
  await db(() => window.__novaBase.ctl.openDesign('Lineas'));
  await page.getByRole('button', { name: 'Agregar campo', exact: true }).click();
  await page.getByLabel('Nombre del campo 6', exact).fill('adj');
  await page.getByLabel('Tipo de datos 6', exact).selectOption('TEXT:attachment');
  await save();
  await db(() => window.__novaBase.ctl.openTable('Lineas'));
  await page.waitForSelector('[role=gridcell][data-col=adj]');
  await page.getByRole('button', { name: 'adj adjuntos 1', exact: true }).click();
  await page.getByLabel('Archivos a adjuntar', exact).setInputFiles([
    { name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('hola adjunto') },
    { name: 'datos.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1, 2, 255]) },
  ]);
  await page.getByRole('table', { name: 'Archivos adjuntos' }).waitFor();
  assert.equal(await page.getByRole('table', { name: 'Archivos adjuntos' }).locator('tbody tr').count(), 2);
  await shot('attachments-dialog');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Guardar una copia de nota.txt', exact: true }).click()]);
  assert.equal(download.suggestedFilename(), 'nota.txt');
  assert.equal(fs.readFileSync(await download.path(), 'utf8'), 'hola adjunto');
  const stored = JSON.parse((await rows('SELECT adj FROM Lineas WHERE id = 1'))[0][0]);
  assert.deepEqual(stored.map((a) => [a.name, a.size]), [['nota.txt', 12], ['datos.bin', 4]]);
  await page.getByRole('button', { name: 'Quitar datos.bin', exact: true }).click();
  assert.equal(JSON.parse((await rows('SELECT adj FROM Lineas WHERE id = 1'))[0][0]).length, 1);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'adj adjuntos 1', exact: true }).innerText(), '📎 1');
  assert.equal(await page.getByRole('button', { name: 'adj adjuntos 2', exact: true }).innerText(), '＋');
});

await check('the undo takes an attachment back, and a form of the table gets the attachments button', async () => {
  await db(() => window.__novaBase.ctl.db.undo());
  assert.equal(JSON.parse((await rows('SELECT adj FROM Lineas WHERE id = 1'))[0][0]).length, 2);
  await db(() => window.__novaBase.ctl.db.redo());
  await page.locator('.bs-nav-pane li button', { hasText: /^Lineas$/ }).click();
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Formulario', exact: true }).click();
  await page.waitForSelector('.bs-formcanvas');
  const layout = await db(() => { const c = window.__novaBase.ctl; return c.forms.get(c.active).layout; });
  assert.ok(layout.controls.some((c) => c.type === 'attachment' && c.field === 'adj'));
  await page.locator('button.bs-fc', { hasText: 'Datos adjuntos' }).click();
  await page.getByRole('table', { name: 'Archivos adjuntos' }).waitFor();
  assert.equal(await page.getByRole('table', { name: 'Archivos adjuntos' }).locator('tbody tr').count(), 1);
  await shot('attachments-form');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
});

await check('the file keeps both: calculated field and attachments', async () => {
  const ok = await db(() => {
    const c = window.__novaBase.ctl;
    const again = c.db.constructor.open(c.db.SQL, c.db.export());
    const g = again.columns('Lineas').filter((x) => x.generated).map((x) => x.name);
    const n = JSON.parse(again.execute('SELECT adj FROM Lineas WHERE id = 1').rows[0][0]).length;
    return { g, n, meta: again.getMeta('Lineas').fields.adj.kind };
  });
  assert.deepEqual(ok, { g: ['total'], n: 1, meta: 'attachment' });
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
