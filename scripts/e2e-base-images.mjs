// End-to-end checks of the picture control of Nova Base forms: file, size mode and alternative text.
// Needs `pnpm dev` running on :1420. Usage: node scripts/e2e-base-images.mjs [--shots dir]
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
await page.getByRole('button', { name: 'Vista Diseño' }).click();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const imageCtl = async () => (await layoutOf('form')).controls.find((c) => c.type === 'image');

await check('an image control without a file is reported; choosing the file stores it and the name becomes its alternative text', async () => {
  await page.getByRole('button', { name: 'Imagen', exact: true }).click();
  assert.match(await page.getByRole('status', { name: 'Avisos del diseño' }).innerText(), /no tiene imagen/);
  await page.getByLabel('Elegir imagen').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => { const c = window.__novaBase.ctl; return c.forms.get(c.active).layout.controls.some((x) => x.type === 'image' && x.src.startsWith('data:image/png;base64,')); });
  const c = await imageCtl();
  assert.equal(c.mode, 'fit');
  assert.equal(c.alt, 'logo');
  assert.doesNotMatch(await page.getByRole('status', { name: 'Avisos del diseño' }).innerText().catch(() => ''), /no tiene imagen/);
});

await check('the size mode and the alternative text are chosen in the properties', async () => {
  await page.getByLabel('Ajuste de la imagen').selectOption('stretch');
  await page.getByLabel('Texto alternativo de la imagen').fill('Logotipo del cliente');
  const c = await imageCtl();
  assert.equal(c.mode, 'stretch');
  assert.equal(c.alt, 'Logotipo del cliente');
  assert.equal(await page.locator('img[alt="Logotipo del cliente"]').first().evaluate((i) => i.style.objectFit), 'fill');
  await shot('design');
});

await check('the form view draws the picture in each mode with its alternative text', async () => {
  await page.getByRole('button', { name: 'Vista Formulario' }).click();
  const img = page.locator('img.bs-fc-img[alt="Logotipo del cliente"]');
  await img.waitFor();
  assert.equal(await img.evaluate((i) => i.style.objectFit), 'fill');
  await page.getByRole('button', { name: 'Vista Diseño' }).click();
  await page.locator('img[alt="Logotipo del cliente"]').first().click();
  await page.getByLabel('Ajuste de la imagen').selectOption('clip');
  await page.getByRole('button', { name: 'Vista Formulario' }).click();
  assert.equal(await page.locator('img.bs-fc-img').evaluate((i) => i.style.objectFit), 'none');
  await page.getByRole('button', { name: 'Vista Diseño' }).click();
  await page.locator('img[alt="Logotipo del cliente"]').first().click();
  await page.getByLabel('Ajuste de la imagen').selectOption('fit');
  await page.getByRole('button', { name: 'Vista Formulario' }).click();
  assert.equal(await page.locator('img.bs-fc-img').evaluate((i) => i.style.objectFit), 'contain');
});

await check('a file of more than 1.5 MB is refused and the control keeps its picture', async () => {
  await page.getByRole('button', { name: 'Vista Diseño' }).click();
  await page.locator('img[alt="Logotipo del cliente"]').first().click();
  const before = (await imageCtl()).src;
  await page.getByLabel('Elegir imagen').setInputFiles({ name: 'grande.png', mimeType: 'image/png', buffer: Buffer.alloc(1_600_000, 1) });
  await settle();
  assert.equal((await imageCtl()).src, before);
});

await check('no console errors', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
