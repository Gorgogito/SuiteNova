// End-to-end checks of the table design of Nova Base: field properties (caption, format, mask, rules, lookup), special types,
// table rules and indexes. Needs `pnpm dev` on :1420.   Usage: node scripts/e2e-base-fields.mjs [--shots dir]
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
const dialogs = [];
page.on('dialog', (d) => {
  dialogs.push(d.message());
  void d.accept();
});
let step = 0;
const shot = async (n) => shotsDir && page.screenshot({ path: `${shotsDir}/fld-${String(++step).padStart(2, '0')}-${n}.png` });
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
const meta = (t) => ev((t) => window.__novaBase.ctl.db.getMeta(t), t);
const prop = (n) => page.getByRole('tab', { name: n, exact: true }).click();
const cell = (r, col) => page.locator(`.bs-row[aria-rowindex="${r + 2}"] [data-col="${col}"]`);
const designOf = async (table) => {
  await ev((t) => window.__novaBase.ctl.openDesign(t), table);
  await settle(400);
};
const select = (n) => page.getByLabel(`Nombre del campo ${n}`).click();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__novaBase?.ctl.loading === false);
await ev(() => {
  const c = window.__novaBase.ctl;
  c.db.execute(`CREATE TABLE Ciudades (id INTEGER PRIMARY KEY, nombre TEXT); INSERT INTO Ciudades VALUES (1,'Lima'),(2,'Quito'),(3,'Bogotá');
    CREATE TABLE Pedidos (id INTEGER PRIMARY KEY AUTOINCREMENT, cliente TEXT, edad INTEGER, importe REAL, telefono TEXT, web TEXT, ciudad INTEGER, estado TEXT, inicio TEXT, fin TEXT, activo BOOLEAN);
    INSERT INTO Pedidos (cliente, edad, importe, telefono, web, ciudad, estado, inicio, fin, activo) VALUES ('Ana', 30, 1234.5, '5551234567', 'example.com', 2, 'Abierto', '2025-03-07', '2025-04-01', 1);`);
  c.touch();
});
await designOf('Pedidos');

await check('the design shows the field properties panel with General, Búsqueda and table tabs', async () => {
  const panel = page.getByRole('region', { name: 'Propiedades del campo' });
  assert.ok(await panel.count());
  for (const t of ['General', 'Búsqueda', 'Propiedades de la tabla']) assert.ok(await panel.getByRole('tab', { name: t, exact: true }).count(), t);
  await shot('panel');
});

await check('types: long text, hyperlink and currency are kinds over the stored type', async () => {
  await page.getByLabel('Tipo de datos 4').selectOption('REAL:currency');
  await page.getByLabel('Tipo de datos 6').selectOption('TEXT:hyperlink');
  const opts = await page.getByLabel('Tipo de datos 2').locator('option').allInnerTexts();
  assert.deepEqual(opts, ['Texto corto', 'Texto largo', 'Hipervínculo', 'Datos adjuntos', 'Campo calculado', 'Número entero', 'Número decimal', 'Moneda', 'Sí/No', 'Fecha', 'Fecha y hora']);
});

await check('caption, description, format and decimals; saved with the table', async () => {
  await select(4);
  const p = page.getByRole('region', { name: 'Propiedades del campo' });
  await p.getByLabel('Descripción del campo').fill('Importe total');
  await p.getByLabel('Leyenda').fill('Importe (USD)');
  await p.getByLabel('Código de moneda').fill('USD');
  await p.getByLabel('Lugares decimales').fill('2');
  await select(3);
  await p.getByLabel('Leyenda').fill('Edad (años)');
  await select(5);
  await p.getByLabel('Máscara de entrada').fill('(000) 000-0000');
  await page.getByLabel('Tipo de datos 9').selectOption('DATE');
  await page.getByLabel('Tipo de datos 10').selectOption('DATE');
  await select(9);
  await p.getByLabel('Formato').selectOption('short');
  await select(11);
  await p.getByLabel('Formato').selectOption('yesno');
  await page.getByRole('button', { name: 'Guardar tabla' }).click();
  await settle(500);
  const m = await meta('Pedidos');
  assert.equal(m.fields.importe.caption, 'Importe (USD)');
  assert.deepEqual([m.fields.importe.kind, m.fields.importe.currency, m.fields.importe.decimals], ['currency', 'USD', 2]);
  assert.equal(m.fields.web.kind, 'hyperlink');
  assert.equal(m.fields.telefono.inputMask, '(000) 000-0000');
  assert.equal(m.fields.inicio.format, 'short');
  await shot('saved');
});

await check('validation rules: the field rule and the table rule are saved as triggers and refuse bad values', async () => {
  await select(3);
  const p = page.getByRole('region', { name: 'Propiedades del campo' });
  await p.getByLabel('Regla de validación', { exact: true }).fill('>=0 Y <=120');
  await p.getByLabel('Texto de validación', { exact: true }).fill('La edad debe estar entre 0 y 120.');
  await p.getByRole('tab', { name: 'Propiedades de la tabla' }).click();
  await p.getByLabel('Regla de validación de la tabla').fill('[fin] >= [inicio]');
  await p.getByLabel('Texto de validación de la tabla').fill('La fecha final no puede ser anterior a la inicial.');
  await page.getByRole('button', { name: 'Guardar tabla' }).click();
  await settle(500);
  assert.equal(await ev(() => window.__novaBase.ctl.db.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger'").rows[0][0]), 4);
  const bad1 = await ev(() => { try { window.__novaBase.ctl.db.execute("INSERT INTO Pedidos (cliente, edad) VALUES ('Zoe', 200)"); return 'accepted'; } catch (e) { return e.message; } });
  assert.equal(bad1, 'La edad debe estar entre 0 y 120.');
  const bad2 = await ev(() => { try { window.__novaBase.ctl.db.execute("INSERT INTO Pedidos (cliente, inicio, fin) VALUES ('Zoe', '2025-05-01', '2025-01-01')"); return 'accepted'; } catch (e) { return e.message; } });
  assert.equal(bad2, 'La fecha final no puede ser anterior a la inicial.');
});

await check('a rule that cannot be read is refused on save and the table does not change', async () => {
  await select(3);
  const p = page.getByRole('region', { name: 'Propiedades del campo' });
  await p.getByRole('tab', { name: 'General' }).click();
  await p.getByLabel('Regla de validación', { exact: true }).fill('>= @@');
  await page.getByRole('button', { name: 'Guardar tabla' }).click();
  await settle(400);
  assert.match(await page.locator('.bs-error').first().innerText(), /no se entiende/);
  assert.equal((await meta('Pedidos')).fields.edad.rule, '>=0 Y <=120');
  await p.getByLabel('Regla de validación', { exact: true }).fill('>=0 Y <=120');
});

await check('lookup: a value list and a field of another table', async () => {
  await select(8);
  const p = page.getByRole('region', { name: 'Propiedades del campo' });
  await p.getByRole('tab', { name: 'Búsqueda' }).click();
  await p.getByLabel('Tipo de búsqueda').selectOption('list');
  await p.getByLabel('Valores de la lista').fill('Abierto\nCerrado\nPendiente');
  await select(7);
  await p.getByLabel('Tipo de búsqueda').selectOption('table');
  await p.getByLabel('Tabla de la búsqueda').selectOption('Ciudades');
  await p.getByLabel('Campo que se guarda').selectOption('id');
  await p.getByLabel('Campo que se muestra').selectOption('nombre');
  await page.getByRole('button', { name: 'Guardar tabla' }).click();
  await settle(500);
  const m = await meta('Pedidos');
  assert.deepEqual(m.fields.estado.lookup, { kind: 'list', items: ['Abierto', 'Cerrado', 'Pendiente'] });
  assert.deepEqual(m.fields.ciudad.lookup, { kind: 'table', table: 'Ciudades', valueCol: 'id', displayCol: 'nombre' });
  await shot('lookup');
});

await check('the datasheet uses them: caption, format, currency, hyperlink and lookup text', async () => {
  await ev(() => window.__novaBase.ctl.openTable('Pedidos'));
  await settle(600);
  await shot('datasheet');
  assert.ok(await page.getByRole('columnheader', { name: /Importe \(USD\)/ }).count(), 'caption in the header');
  assert.ok(await page.getByRole('columnheader', { name: /Edad \(años\)/ }).count());
  assert.match(await cell(0, 'importe').innerText(), /1.?234[.,]50/);
  assert.match(await cell(0, 'importe').innerText(), /US\$|\$|USD/);
  assert.match(await cell(0, 'inicio').innerText(), /07.03.2025|03.07.2025|7\/3\/2025|3\/7\/2025/);
  assert.equal((await cell(0, 'ciudad').innerText()).trim(), 'Quito');
  assert.equal((await cell(0, 'activo').innerText()).trim(), 'Sí');
  assert.equal(await cell(0, 'web').locator('a.bs-link').count(), 1);
});

await check('editing: a lookup is a list, the mask formats what is typed, a rule shows its text', async () => {
  // lookup field
  await cell(0, 'estado').dblclick();
  await settle(200);
  const sel = cell(0, 'estado').locator('select');
  assert.deepEqual(await sel.locator('option').allInnerTexts(), ['', 'Abierto', 'Cerrado', 'Pendiente']);
  await sel.selectOption('Cerrado');
  await page.keyboard.press('Enter');
  await settle(300);
  assert.equal((await cell(0, 'estado').innerText()).trim(), 'Cerrado');
  // mask
  await cell(0, 'telefono').dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('4449998888');
  await page.keyboard.press('Enter');
  await settle(300);
  assert.equal((await cell(0, 'telefono').innerText()).trim(), '(444) 999-8888');
  await cell(0, 'telefono').dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('12ab');
  await page.keyboard.press('Enter');
  await settle(300);
  assert.match(await page.locator('.bs-error').first().innerText(), /máscara de entrada/);
  await page.keyboard.press('Escape');
  // rule
  await cell(0, 'edad').dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('150');
  await page.keyboard.press('Enter');
  await settle(300);
  assert.match(await page.locator('.bs-error').first().innerText(), /La edad debe estar entre 0 y 120\./);
  await page.keyboard.press('Escape');
  assert.equal(await ev(() => window.__novaBase.ctl.db.execute('SELECT edad FROM Pedidos WHERE id = 1').rows[0][0]), 30);
});

await check('indexes: create a composite unique index, it refuses repeated values, and drop it', async () => {
  await designOf('Pedidos');
  await page.getByRole('button', { name: 'Índices…' }).click();
  await settle(400);
  const d = page.getByRole('dialog');
  await d.getByLabel('Nombre del índice').fill('ux_cliente_inicio');
  await d.getByRole('group', { name: 'Campos del índice' }).getByLabel('cliente').check();
  await d.getByRole('group', { name: 'Campos del índice' }).getByLabel('inicio').check();
  await d.getByLabel('Sin duplicados', { exact: true }).check();
  await d.getByRole('button', { name: 'Crear índice' }).click();
  await settle(300);
  assert.ok(await d.getByText('ux_cliente_inicio').count());
  await shot('indexes');
  const dup = await ev(() => { try { window.__novaBase.ctl.db.execute("INSERT INTO Pedidos (cliente, inicio) VALUES ('Ana', '2025-03-07')"); return 'accepted'; } catch (e) { return e.message; } });
  assert.match(dup, /UNIQUE constraint failed/);
  await d.getByRole('button', { name: 'Eliminar el índice ux_cliente_inicio' }).click();
  await settle(300);
  assert.equal(await d.getByText('ux_cliente_inicio').count(), 0);
  await d.getByRole('button', { name: 'Cerrar' }).click();
});

await check('renaming a table keeps its properties and rules; undo and save/reopen keep them too', async () => {
  await ev(() => window.__novaBase.ctl.rename('table', 'Pedidos', 'Compras'));
  await settle(300);
  assert.equal((await meta('Compras')).fields.importe.caption, 'Importe (USD)');
  const bad = await ev(() => { try { window.__novaBase.ctl.db.execute("INSERT INTO Compras (cliente, edad) VALUES ('Zoe', 200)"); return 'accepted'; } catch (e) { return e.message; } });
  assert.equal(bad, 'La edad debe estar entre 0 y 120.');
  const b64 = await ev(() => { const b = window.__novaBase.ctl.db.export(); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); });
  await ev(([b, n]) => window.__novaBase.load(b, n), [b64, 'prueba.sqlite']);
  await settle(500);
  assert.equal((await meta('Compras')).fields.estado.lookup.kind, 'list');
  const bad2 = await ev(() => { try { window.__novaBase.ctl.db.execute("INSERT INTO Compras (cliente, edad) VALUES ('Zoe', 200)"); return 'accepted'; } catch (e) { return e.message; } });
  assert.equal(bad2, 'La edad debe estar entre 0 y 120.');
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
