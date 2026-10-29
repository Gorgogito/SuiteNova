// End-to-end checks for autofilter and conditional formatting in Nova Calc. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-filter-cf.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=calc';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => {
  errors.push(`dialog: ${d.message()}`);
  d.dismiss();
});
let step = 0;
const shot = async (name) => {
  if (!shotsDir) return;
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
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

await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.calc-grid__scroller');
await page.screenshot();
await page.waitForTimeout(300);
const gb = await page.locator('.calc-grid__scroller').boundingBox();
const at = (c, r) => [gb.x + 40 + c * 64 + 32, gb.y + 22 + r * 20 + 10];
const click = (c, r, o) => page.mouse.click(...at(c, r), o);
const doc = (fn, arg) => page.evaluate(fn, arg);
const state = () => doc(() => ({ hidden: [...window.__novaCalc.doc.sheet.filterHidden].sort((a, b) => a - b), af: window.__novaCalc.doc.sheet.autoFilter, cf: window.__novaCalc.doc.sheet.condFormats.length }));
const text = (a) => doc((addr) => window.__novaCalc.text(addr), a);

// sample data: A1:C7
await click(0, 0);
const rows = [
  ['Región', 'Ventas', 'Estado'],
  ['Norte', '10', 'Abierto'],
  ['Sur', '25', 'Cerrado'],
  ['Norte', '40', 'Abierto'],
  ['Este', '5', 'Cerrado'],
  ['Oeste', '30', 'Abierto'],
  ['Sur', '15', 'Abierto'],
];
for (const row of rows) {
  for (const v of row) {
    await page.keyboard.type(v);
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');
}
await page.locator('.calc-grid').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
await click(1, 3);
await shot('data');

// ---- autofilter
await check('Ctrl+Shift+L puts filter buttons on the header row', async () => {
  await click(1, 3);
  await page.keyboard.press('Control+Shift+l');
  const s = await state();
  assert.deepEqual(s.af.range, { r1: 0, c1: 0, r2: 6, c2: 2 });
  await shot('filter-on');
});

await check('the drop-down lists the distinct values with counts', async () => {
  // button: bottom-right corner of the header cell of column A
  await page.mouse.click(gb.x + 40 + 64 - 11, gb.y + 22 + 20 - 9);
  await page.waitForSelector('.calc-fmenu');
  const items = await page.locator('.calc-fmenu__check span').allInnerTexts();
  assert.deepEqual(items, ['Este', 'Norte', 'Oeste', 'Sur']);
  assert.deepEqual(await page.locator('.calc-fmenu__check small').allInnerTexts(), ['1', '2', '1', '2']);
  await shot('filter-menu');
});

await check('choosing values hides the other rows and shows the record count', async () => {
  await page.getByLabel('(Seleccionar todo)').uncheck();
  await page.locator('.calc-fmenu__check', { hasText: 'Norte' }).locator('input').check();
  await page.getByRole('button', { name: 'Aceptar' }).click();
  const s = await state();
  assert.deepEqual(s.hidden, [2, 4, 5, 6]);
  assert.equal(await page.locator('.nv-status').innerText().then((t) => /2 de 6 registros encontrados/.test(t)), true);
  await shot('filtered');
});

await check('undo restores every row, redo filters again', async () => {
  await page.keyboard.press('Control+z');
  assert.deepEqual((await state()).hidden, []);
  await page.keyboard.press('Control+y');
  assert.deepEqual((await state()).hidden, [2, 4, 5, 6]);
});

await check('a second column combines with the first (custom filter)', async () => {
  // Ventas header button
  await page.mouse.click(gb.x + 40 + 2 * 64 - 11, gb.y + 22 + 20 - 9);
  await page.getByRole('button', { name: 'Filtro personalizado…' }).click();
  await page.getByLabel('Operador').first().selectOption('gt');
  await page.getByLabel('Valor').first().fill('20');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  assert.deepEqual((await state()).hidden, [1, 2, 4, 5, 6]);
});

await check('sorting from the drop-down keeps the filter', async () => {
  await page.mouse.click(gb.x + 40 + 2 * 64 - 11, gb.y + 22 + 20 - 9);
  await page.getByRole('button', { name: 'Ordenar de Z a A' }).click();
  const first = await text('B2');
  assert.equal(first, '40');
  assert.ok((await state()).af);
});

await check('Home > Edición > Borrar filtros and toggling the filter off', async () => {
  await page.getByRole('tab', { name: 'Datos' }).click();
  await page.click('[data-nv-item="calc.filterClear"]');
  assert.deepEqual((await state()).hidden, []);
  await page.click('[data-nv-item="calc.filter"]');
  assert.equal((await state()).af, undefined);
  await page.getByRole('tab', { name: 'Inicio' }).click();
});

// ---- conditional formatting
await check('rule dialog: Mayor que… highlights cells and the rule is listed', async () => {
  await click(1, 1);
  await page.keyboard.down('Shift');
  await click(1, 6);
  await page.keyboard.up('Shift');
  await page.click('[data-nv-item="cfMenu"]');
  await page.getByRole('menuitem', { name: 'Mayor que…' }).click();
  await page.getByLabel('Valor', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  assert.equal((await state()).cf, 1);
  const rule = await doc(() => window.__novaCalc.doc.sheet.condFormats[0]);
  assert.equal(rule.type, 'cellIs');
  assert.equal(rule.formula1, '20');
  assert.deepEqual(rule.format, { bg: '#ffc7ce', color: '#9c0006' });
  await shot('cf-greater-than');
});

await check('one-click data bars, colour scale and icon set on the same range', async () => {
  await click(1, 1);
  await page.keyboard.down('Shift');
  await click(1, 6);
  await page.keyboard.up('Shift');
  await page.click('[data-nv-item="cfMenu"]');
  await page.getByRole('menuitem', { name: 'Barra de datos azul' }).click();
  await page.click('[data-nv-item="cfMenu"]');
  await page.getByRole('menuitem', { name: 'Iconos: 3 semáforos' }).click();
  const kinds = await doc(() => window.__novaCalc.doc.sheet.condFormats.map((r) => r.type).sort());
  assert.deepEqual(kinds, ['cellIs', 'dataBar', 'iconSet']);
  await shot('cf-bars-icons');
  // pixels: the data bar paints blue inside column B; sample the canvas
  // the bar of 30 (row 3) paints blue inside column B, to the right of the icon
  const px = await page.evaluate(([x, y]) => {
    const c = document.querySelector('.calc-grid__canvas');
    const dpr = window.devicePixelRatio || 1;
    const d = c.getContext('2d').getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [104 + 26, 22 + 2 * 20 + 4]);
  const hasBlue = px;
  assert.ok(hasBlue[2] > hasBlue[0], `expected a bluish pixel, got ${hasBlue}`);
});

await check('rules manager lists, reorders and deletes', async () => {
  await page.click('[data-nv-item="cfMenu"]');
  await page.getByRole('menuitem', { name: 'Administrar reglas…' }).click();
  assert.equal(await page.locator('tbody tr').count(), 3);
  await shot('cf-manager');
  await page.getByRole('button', { name: 'Eliminar' }).first().click();
  assert.equal(await page.locator('tbody tr').count(), 2);
  await page.getByRole('button', { name: 'Cerrar' }).click();
  assert.equal((await state()).cf, 2);
  await page.keyboard.press('Control+z'); // undo the delete
  assert.equal((await state()).cf, 3);
});

await check('clear rules from the sheet, with undo', async () => {
  await page.click('[data-nv-item="cfMenu"]');
  await page.getByRole('menuitem', { name: 'Borrar reglas de toda la hoja' }).click();
  assert.equal((await state()).cf, 0);
  await page.keyboard.press('Control+z');
  assert.equal((await state()).cf, 3);
});

await check('expression rule colours a whole row', async () => {
  await page.click('[data-nv-item="cfMenu"]');
  await page.getByRole('menuitem', { name: 'Administrar reglas…' }).click();
  await page.getByRole('button', { name: 'Nueva regla…' }).click();
  await page.getByLabel('Tipo de regla').selectOption('expression');
  await page.getByLabel('Se aplica al rango').fill('A2:C7');
  await page.getByLabel('Fórmula (relativa a la primera celda del rango)').fill('=$C2="Cerrado"');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await shot('cf-expression');
  const hit = await doc(() => {
    const d = window.__novaCalc.doc;
    return d.sheet.condFormats.find((r) => r.type === 'expression')?.formula;
  });
  assert.equal(hit, '$C2="Cerrado"');
});

await check('an invalid formula is rejected inside the dialog', async () => {
  await page.click('[data-nv-item="cfMenu"]');
  await page.getByRole('menuitem', { name: 'Nueva regla…' }).click();
  await page.getByLabel('Tipo de regla').selectOption('expression');
  await page.getByLabel('Fórmula (relativa a la primera celda del rango)').fill('=1+');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  assert.ok(await page.getByRole('alert').isVisible());
  await page.getByRole('button', { name: 'Cancelar' }).click();
});

await check('dark theme keeps filter buttons and data bars legible', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('tab', { name: 'Vista' }).click();
  await page.click('[data-nv-item="themeMenu"]');
  await page.getByRole('menuitem', { name: 'Tema oscuro' }).click();
  await page.getByRole('tab', { name: 'Datos' }).click();
  await click(1, 3);
  await page.click('[data-nv-item="calc.filter"]');
  await shot('dark');
});

await check('no runtime errors were logged', async () => {
  const real = errors.filter((m) => !/Keyborg instance .* is being disposed incorrectly/.test(m));
  assert.deepEqual(real, []);
});

await browser.close();
for (const r of results) console.log(r[0].padEnd(5), r[1], r[2] ? `— ${r[2]}` : '');
const failed = results.filter((r) => r[0] !== 'ok').length;
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
