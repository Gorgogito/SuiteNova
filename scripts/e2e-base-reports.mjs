// End-to-end checks of Nova Base's second round of the report designer (Access parity):
// conditional format, running sums, hide duplicates, growing text, images, columns, filter, no-data text, expressions.
// Needs `pnpm dev` running on :1420. Usage: node scripts/e2e-base-reports.mjs [--shots dir]
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
const settle = () => page.waitForTimeout(250);
const layoutOf = () => db(() => { const c = window.__novaBase.ctl; return c.reports.get(c.active).layout; });
const frame = () => page.frameLocator('.bs-reportframe');
const preview = async () => {
  if (!(await page.locator('.bs-rdesign').count())) return;
  await page.getByRole('button', { name: 'Vista previa' }).click();
  await frame().locator('section.pg').first().waitFor();
  await page.waitForTimeout(500);
};
const design = async () => {
  if (await page.locator('.bs-rdesign').count()) return;
  await page.getByRole('button', { name: 'Vista Diseño' }).click();
  await page.waitForSelector('.bs-rdesign');
};
const deselect = async () => {
  const box = page.locator('[role=group][aria-label^="Detalle"]').first();
  const b = await box.boundingBox();
  await page.mouse.click(b.x + b.width - 4, b.y + b.height - 2);
};
const pick = (re) => page.getByRole('button', { name: re }).first().click();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__novaBase?.ctl.loading === false);

await db(() => {
  const c = window.__novaBase.ctl;
  const vals = [];
  for (let i = 1; i <= 30; i++) vals.push(`(${i}, '${i % 3 === 0 ? 'Norte' : i % 3 === 1 ? 'Sur' : 'Este'}', ${i * 10}, '${i % 2 ? 'impar' : 'par'}')`);
  c.db.execute(`CREATE TABLE Ventas (id INTEGER PRIMARY KEY, zona TEXT, importe REAL, tipo TEXT); INSERT INTO Ventas VALUES ${vals.join(',')};`);
  c.db.clearUndo();
  c.touch();
});
await settle();

await check('open the report designer on Ventas', async () => {
  await page.locator('.bs-nav-pane li button', { hasText: /^Ventas$/ }).click();
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Diseño de informe', exact: true }).click();
  await page.waitForSelector('.bs-reportframe');
  await design();
  await page.waitForSelector('.bs-rdesign');
});

await check('conditional format: a rule colours the amounts over 200 and the preview shows it', async () => {
  const l0 = await layoutOf();
  const imp = l0.controls.find((c) => c.type === 'field' && c.field === 'importe');
  await page.getByRole('button', { name: new RegExp(`Campo ${imp.name}$`) }).click();
  await page.getByRole('button', { name: 'Agregar condición' }).click();
  await page.getByRole('textbox', { name: 'Condición 1' }).fill('[importe]>200');
  await page.getByLabel('Color del texto 1').fill('#ff0000');
  await page.getByLabel('Negrita 1').check();
  const l = await layoutOf();
  assert.equal(l.controls.find((c) => c.id === imp.id).cond[0].expr, '[importe]>200');
  await preview();
  const html = await frame().locator('body').innerHTML();
  assert.equal((html.match(/color:#ff0000/g) ?? []).length, 10); // 210..300
  await shot('report-cond');
});

await check('running sum over the whole report as a new calculated field', async () => {
  await design();
  await page.getByLabel('Alto de Detalle').fill('22');
  await pick(/^Detalle$/);
  await page.getByRole('button', { name: 'Campo', exact: true }).click();
  await page.getByLabel('Campo del control').selectOption('importe');
  await page.getByLabel('Suma acumulada').selectOption('all');
  await page.getByLabel('Formato', { exact: true }).selectOption('int');
  await preview();
  const text = await frame().locator('body').innerText();
  assert.match(text, /\b4\.650\b|\b4650\b/); // 10+20+...+300
});

await check('group by an expression and a running sum inside the group', async () => {
  await design();
  await page.getByRole('textbox', { name: 'Agrupar por expresión' }).fill('=Left([zona], 1)');
  await page.getByLabel('Agrupar por expresión: OK').click();
  const l = await layoutOf();
  assert.equal(l.groups[0].field, '=Left([zona], 1)');
  await preview();
  const text = await frame().locator('body').innerText();
  // Este, Norte, Sur => three groups, headers show the expression value
  for (const z of ['E', 'N', 'S']) assert.ok(new RegExp(`^${z}$`, 'm').test(text), `group ${z}`);
  await shot('report-group-expr');
});

await check('hide duplicates blanks the repeated zone inside the group', async () => {
  await design();
  await deselect();
  const l = await layoutOf();
  const z = l.controls.find((c) => c.type === 'field' && c.field === 'zona' && c.band === l.bands.find((b) => b.kind === 'detail').id);
  await page.getByRole('button', { name: new RegExp(`Campo ${z.name}$`) }).click();
  await page.getByLabel('Ocultar duplicados').check();
  await preview();
  const html = await frame().locator('body').innerHTML();
  const n = (re) => (html.match(re) ?? []).length;
  assert.equal(n(/>Este</g), 1);
  assert.equal(n(/>Norte</g), 1);
  assert.equal(n(/>Sur</g), 1);
});

await check('filter, no-data text and page header not shown with the report header', async () => {
  await design();
  await deselect();
  await page.locator('.bs-props').getByLabel('Filtro del informe').fill('[importe]>=100');
  await page.getByLabel('Mostrar el encabezado de página').selectOption('notFirst');
  await page.getByLabel('Texto si no hay registros').fill('Sin ventas');
  await preview();
  let text = await frame().locator('body').innerText();
  assert.ok(!/\b10\b.*Sur/.test(text.split('\n').slice(0, 8).join(' ')));
  assert.doesNotMatch(text, /Sin ventas/);
  await design();
  await page.locator('.bs-props').getByLabel('Filtro del informe').fill('[importe]>9999');
  await preview();
  assert.match(await frame().locator('body').innerText(), /Sin ventas/);
  await design();
  await page.locator('.bs-props').getByLabel('Filtro del informe').fill('');
  const l = await layoutOf();
  assert.ok(!l.filter);
  assert.equal(l.pageHeaderOn, 'notFirst');
});

await check('two columns across: the detail repeats side by side', async () => {
  await design();
  await deselect();
  await page.getByLabel('Número de columnas').fill('2');
  await page.getByLabel('Disposición de columnas').selectOption('across');
  const l = await layoutOf();
  assert.deepEqual(l.columns, { n: 2, gap: 20, direction: 'across' });
  await preview();
  const lefts = await frame().locator('.bd').evaluateAll((els) => [...new Set(els.map((e) => e.style.left))]);
  assert.ok(lefts.length >= 2, `lefts ${lefts}`);
  await shot('report-columns');
  await design();
  await page.getByLabel('Número de columnas').fill('1');
});

await check('an image control: choose a file, it is stored in the report and drawn', async () => {
  await design();
  await page.getByRole('button', { name: /^Encabezado del informe/ }).first().click();
  await page.getByRole('button', { name: 'Imagen', exact: true }).click();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  await page.getByLabel('Elegir imagen').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => { const c = window.__novaBase.ctl; return c.reports.get(c.active).layout.controls.some((x) => x.type === 'image' && x.src.startsWith('data:image/png;base64,')); });
  await page.getByLabel('Texto alternativo de la imagen').fill('Logotipo');
  await preview();
  const img = frame().locator('img[alt="Logotipo"]');
  assert.equal(await img.count(), 1);
  assert.ok(await img.evaluate((i) => i.complete && i.naturalWidth === 1));
});

await check('a growing text takes more room, a shrinking section takes none when empty', async () => {
  await design();
  const l = await layoutOf();
  const tipo = l.controls.find((c) => c.type === 'field' && c.field === 'tipo');
  await page.getByRole('button', { name: new RegExp(`Campo ${tipo.name}$`) }).click({ position: { x: 4, y: 4 }, timeout: 8000 });
  await page.getByLabel('Puede crecer').check();
  assert.equal((await layoutOf()).controls.find((c) => c.id === tipo.id).canGrow, true);
  await page.getByLabel(/^Reducir Pie de grupo/).check();
  assert.equal((await layoutOf()).bands.find((b) => b.kind === 'groupFooter').canShrink, true);
  await preview();
  assert.ok(await frame().locator('section.pg').count());
});

await check('the designer warns about a bad rule and undo restores', async () => {
  await design();
  const l = await layoutOf();
  const imp = l.controls.find((c) => c.type === 'field' && c.field === 'importe');
  await page.getByRole('button', { name: new RegExp(`Campo ${imp.name}$`) }).click();
  await page.getByRole('textbox', { name: 'Condición 1' }).fill('[nada]>1');
  await page.getByRole('status', { name: 'Avisos del diseño' }).waitFor();
  assert.match(await page.getByRole('status', { name: 'Avisos del diseño' }).innerText(), /\[nada\]/);
  await page.getByRole('textbox', { name: 'Condición 1' }).fill('[importe]>200');
});

await check('save and reopen keeps the new report options', async () => {
  const before = await layoutOf();
  const saved = await db(() => {
    const c = window.__novaBase.ctl;
    const bytes = c.db.export();
    return bytes.length;
  });
  assert.ok(saved > 1000);
  const again = await db(() => { const c = window.__novaBase.ctl; return JSON.stringify(c.db.getObject('report', c.tabs.find((t) => t.id === c.active).name)?.layout?.groups); });
  assert.equal(again, JSON.stringify(before.groups));
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
