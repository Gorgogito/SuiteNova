// End-to-end checks of Nova Base's tools, third round (Access parity): compact and repair with a report, password protection of the
// file (set, save, open with the password, remove) and custom groups in the navigation pane.
// Needs `pnpm dev` running on :1420. Usage: node scripts/e2e-base-tools.mjs [--shots dir]
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
const tools = async () => { await page.getByRole('tab', { name: 'Herramientas' }).click(); };

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__novaBase?.ctl.loading === false);
await db(() => {
  const c = window.__novaBase.ctl;
  c.db.execute(`CREATE TABLE Clientes (id INTEGER PRIMARY KEY, nombre TEXT, nota TEXT);
    CREATE TABLE Pedidos (id INTEGER PRIMARY KEY, cliente INTEGER, total REAL);
    INSERT INTO Clientes (id, nombre) VALUES (1, 'Ana'), (2, 'Luis');
    INSERT INTO Pedidos VALUES (1, 1, 5);
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 300) INSERT INTO Clientes (id, nombre, nota) SELECT 100 + i, 'x', printf('%0500d', i) FROM n;
    DELETE FROM Clientes WHERE id > 100;`);
  c.db.saveObject('query', 'Consulta1', { mode: 'sql', sql: 'SELECT 1', design: { tables: [], fields: [] } });
  c.touch();
});
await settle();

await check('compact and repair shows what it did, and the earlier changes can still be undone', async () => {
  await tools();
  await page.getByRole('button', { name: 'Compactar y reparar', exact: true }).click();
  const box = page.getByRole('status', { name: 'Resultado de compactar y reparar' });
  await box.waitFor();
  const text = await box.innerText();
  assert.match(text, /Tamaño antes: .* Tamaño ahora: /);
  assert.match(text, /Se recuperaron/);
  assert.match(text, /el archivo está sano/);
  assert.match(text, /registros sin correspondencia|sano/);
  await shot('compact');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  assert.equal(await db(() => window.__novaBase.ctl.db.canUndo), true);
});

await check('a password encrypts the saved file; opening it asks for the password and a wrong one is refused', async () => {
  await tools();
  assert.equal(await page.getByRole('button', { name: 'Quitar la contraseña', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Cifrar con contraseña…', exact: true }).click();
  await page.getByLabel('Contraseña', exact).fill('clave 123');
  await page.getByLabel('Repita la contraseña', exact).fill('otra');
  await page.getByRole('button', { name: 'Cifrar', exact: true }).click();
  assert.match(await page.getByRole('alert').innerText(), /no coinciden/);
  await page.getByLabel('Repita la contraseña', exact).fill('clave 123');
  await page.getByRole('button', { name: 'Cifrar', exact: true }).click();
  await settle();
  assert.equal(await db(() => window.__novaBase.ctl.password), 'clave 123');
  const header = await db(async () => {
    const bytes = await window.__novaBase.ctl.exportFile();
    let s = '';
    for (const b of bytes.slice(0, 11)) s += String.fromCharCode(b);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    window.__enc = btoa(bin);
    return s;
  });
  assert.equal(header, 'NOVADB-ENC1');
  // open it: the password is asked
  await db(() => window.__novaBase.load(window.__enc, 'cifrada.sqlite'));
  await page.getByLabel('Contraseña', exact).fill('equivocada');
  await page.getByRole('button', { name: 'Abrir', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /contraseña no es correcta/);
  await shot('password-open');
  await page.getByLabel('Contraseña', exact).fill('clave 123');
  await page.getByRole('button', { name: 'Abrir', exact: true }).click();
  await settle();
  assert.ok((await db(() => window.__novaBase.ctl.db.tableNames())).includes('Pedidos'));
  assert.equal(await db(() => window.__novaBase.ctl.password), 'clave 123');
  assert.equal(await db(() => window.__novaBase.ctl.fileName), 'cifrada.sqlite');
});

await check('removing the password saves the file as a plain SQLite file again', async () => {
  await tools();
  await page.getByRole('button', { name: 'Quitar la contraseña', exact: true }).click();
  assert.equal(await db(() => window.__novaBase.ctl.password), null);
  const header = await db(async () => {
    const bytes = await window.__novaBase.ctl.exportFile();
    let s = '';
    for (const b of bytes.slice(0, 15)) s += String.fromCharCode(b);
    return s;
  });
  assert.equal(header, 'SQLite format 3');
});

await check('custom groups in the navigation pane: create, add objects from the menu, remove, delete', async () => {
  await page.getByLabel('Ver los objetos por', exact).selectOption('groups');
  await page.getByLabel('Nombre del grupo nuevo', exact).fill('Ventas');
  await page.getByRole('button', { name: 'Agregar grupo', exact: true }).click();
  assert.deepEqual((await db(() => window.__novaBase.ctl.navGroups())).map((g) => g.name), ['Ventas']);
  // every object is "ungrouped" at first
  assert.ok((await page.getByRole('region', { name: 'Objetos sin agrupar' }).locator('li').count()) >= 3);
  await page.getByRole('region', { name: 'Objetos sin agrupar' }).getByRole('button', { name: 'Clientes', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Agregar al grupo «Ventas»' }).click();
  await page.getByRole('region', { name: 'Objetos sin agrupar' }).getByRole('button', { name: 'Pedidos', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Agregar al grupo «Ventas»' }).click();
  const names = await page.getByRole('region', { name: 'Ventas', exact: true }).locator('li button').allInnerTexts();
  assert.deepEqual(names.sort(), ['Clientes', 'Pedidos']);
  await shot('nav-groups');
  // renaming an object keeps it in its group
  await db(() => window.__novaBase.ctl.rename('table', 'Pedidos', 'Compras'));
  assert.deepEqual((await page.getByRole('region', { name: 'Ventas', exact: true }).locator('li button').allInnerTexts()).sort(), ['Clientes', 'Compras']);
  // remove one from the group, then delete the group: the objects stay
  await page.getByRole('region', { name: 'Ventas', exact: true }).getByRole('button', { name: 'Compras', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Quitar del grupo «Ventas»' }).click();
  assert.deepEqual(await page.getByRole('region', { name: 'Ventas', exact: true }).locator('li button').allInnerTexts(), ['Clientes']);
  await page.getByRole('button', { name: 'Eliminar el grupo Ventas', exact: true }).click();
  assert.deepEqual(await db(() => window.__novaBase.ctl.navGroups()), []);
  assert.ok((await db(() => window.__novaBase.ctl.db.tableNames())).includes('Clientes'));
  await page.getByLabel('Ver los objetos por', exact).selectOption('type');
});

await check('a group that already exists is refused, and the groups are saved with the file', async () => {
  await db(() => { const c = window.__novaBase.ctl; c.addNavGroup('Uno'); c.addToNavGroup('Uno', { kind: 'table', name: 'Clientes' }); });
  const err = await db(() => { try { window.__novaBase.ctl.addNavGroup('uno'); return null; } catch (e) { return e.message; } });
  assert.match(err, /Ya existe un grupo/);
  const stored = await db(() => {
    const c = window.__novaBase.ctl;
    const again = c.db.constructor.open(c.db.SQL, c.db.export());
    return again.getObject('navgroups', 'groups');
  });
  assert.deepEqual(stored, { groups: [{ name: 'Uno', items: [{ kind: 'table', name: 'Clientes' }] }] });
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
