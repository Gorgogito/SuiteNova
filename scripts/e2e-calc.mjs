// End-to-end checks for Nova Calc in a real browser (Edge). Needs `pnpm dev` running on :1420.
// Usage: node scripts/e2e-calc.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=calc';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
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
await page.evaluate(() => {
  // keep the call stack of React render-phase warnings so they can be diagnosed
  window.__stacks = [];
  Error.stackTraceLimit = 60;
  const orig = console.error;
  console.error = function (...a) {
    if (String(a[0]).includes('Cannot update a component')) window.__stacks.push(new Error().stack);
    return orig.apply(this, a);
  };
});
await page.screenshot(); // first capture after load can be blank
await page.waitForTimeout(300);

// grid geometry at 100%: header 22px tall / ~40px wide; cells 64x20
const cell = (col, row) => ({ x: 40 + col * 64 + 32, y: 193 + 22 + row * 20 + 10 });
const gridBox = await page.locator('.calc-grid__scroller').boundingBox();
const at = (col, row) => ({ x: gridBox.x + 40 + col * 64 + 32, y: gridBox.y + 22 + row * 20 + 10 });
const click = async (col, row, opts) => {
  const p = at(col, row);
  await page.mouse.click(p.x, p.y, opts);
};
const nameBox = () => page.inputValue('.calc-fbar__name');
const bar = () => page.inputValue('.calc-fbar__input');
const type = async (text) => {
  await page.keyboard.type(text);
};
// read a cell's computed display text through the debug hook the app exposes in dev mode
const display = (a) => page.evaluate((addr) => window.__novaCalc?.text(addr), a);

await check('app loads with an empty sheet', async () => {
  assert.equal(await nameBox(), 'A1');
  assert.equal(await page.locator('.calc-tab.is-active').innerText(), 'Hoja1');
});

await check('typing text and numbers moves with Tab/Enter', async () => {
  await click(0, 0);
  await type('Producto');
  await page.keyboard.press('Tab');
  await type('Precio');
  await page.keyboard.press('Tab');
  await type('Cantidad');
  await page.keyboard.press('Tab');
  await type('Total');
  await page.keyboard.press('Enter');
  assert.equal(await nameBox(), 'A2', 'Enter after Tabs returns to the first column of the next row');
  await type('Lápiz');
  await page.keyboard.press('Tab');
  await type('1,5');
  await page.keyboard.press('Tab');
  await type('10');
  await page.keyboard.press('Tab');
  await type('=B2*C2');
  await page.keyboard.press('Enter');
  assert.equal(await display('D2'), '15');
  assert.equal(await display('B2'), '1,5');
});
await shot('data');

await check('formula bar shows the localised formula', async () => {
  await click(3, 1);
  assert.equal(await bar(), '=B2*C2');
  assert.equal(await nameBox(), 'D2');
});

await check('Spanish function names work and autosum', async () => {
  await click(0, 2);
  await type('Cuaderno');
  await page.keyboard.press('Tab');
  await type('3,2');
  await page.keyboard.press('Tab');
  await type('4');
  await page.keyboard.press('Tab');
  await type('=B3*C3');
  await page.keyboard.press('Enter');
  await click(3, 3);
  await type('=SUMA(D2:D3)');
  await page.keyboard.press('Enter');
  assert.equal(await display('D4'), '27,8');
});

await check('undo and redo', async () => {
  await page.keyboard.press('Control+z');
  assert.equal(await display('D4'), '');
  await page.keyboard.press('Control+y');
  assert.equal(await display('D4'), '27,8');
});

await check('bold via shortcut and format via ribbon', async () => {
  await click(0, 0);
  await click(3, 0, { modifiers: ['Shift'] });
  await page.keyboard.press('Control+b');
  assert.equal(await page.getAttribute('[data-nv-item="calc.bold"]', 'aria-pressed'), 'true');
  await shot('bold-header');
});

await check('percent format via ribbon button', async () => {
  await click(1, 1);
  await page.click('[data-nv-item="calc.percent"]');
  assert.equal(await display('B2'), '150%');
  await page.keyboard.press('Control+z');
});

await check('formula editing: clicking a cell inserts its reference', async () => {
  await click(5, 5);
  await type('=');
  await click(1, 1);
  await type('+');
  await click(1, 2);
  await page.keyboard.press('Enter');
  assert.equal(await display('F6'), '4,7');
});

await check('copy and paste adjusts references', async () => {
  await click(3, 1);
  await page.keyboard.press('Control+c');
  await click(3, 4);
  await page.keyboard.press('Control+v');
  await click(3, 4);
  assert.equal(await bar(), '=B5*C5');
});

await check('fill handle drag extends a formula', async () => {
  await click(3, 1);
  const handle = at(3, 1);
  // the fill handle sits at the bottom-right corner of the active cell
  const hx = gridBox.x + 40 + 4 * 64;
  const hy = gridBox.y + 22 + 2 * 20;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  const t = at(3, 3);
  await page.mouse.move(t.x, t.y, { steps: 5 });
  await page.mouse.up();
  void handle;
  await click(3, 2);
  assert.equal(await bar(), '=B3*C3');
});

await check('column resize by dragging the header border', async () => {
  const x = gridBox.x + 40 + 64;
  await page.mouse.move(x, gridBox.y + 11);
  await page.mouse.down();
  await page.mouse.move(x + 60, gridBox.y + 11, { steps: 4 });
  await page.mouse.up();
  const w = await page.evaluate(() => window.__novaCalc?.colWidth(0));
  assert.ok(w > 110 && w < 135, `column A width is ${w}`);
});
await shot('resized');

await check('sheet tabs: add, rename, switch', async () => {
  await page.click('.calc-tabs__add');
  assert.equal(await page.locator('.calc-tab.is-active').innerText(), 'Hoja2');
  await page.locator('.calc-tab.is-active').dblclick();
  await page.keyboard.type('Datos');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.calc-tab.is-active').innerText(), 'Datos');
  await page.locator('.calc-tab', { hasText: 'Hoja1' }).click();
  assert.equal(await display('A1'), 'Producto');
});

await check('Tell-me finds commands', async () => {
  await page.keyboard.press('Alt+q');
  await page.keyboard.type('negrita');
  assert.ok(await page.locator('.nv-tellme__list li').first().innerText().then((t) => /Negrita/i.test(t)));
  await page.keyboard.press('Escape');
});

await check('insert function dialog opens and inserts', async () => {
  await click(6, 8);
  await page.click('.calc-fbar__fx');
  await page.fill('input[placeholder="Buscar una función"]', 'BUSCARV');
  await page.getByRole('option', { name: 'BUSCARV' }).first().click();
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(await page.inputValue('.calc-editor'), '=BUSCARV(');
  await page.waitForTimeout(250); // focus returns to the editor shortly after the dialog closes
  assert.equal(await page.evaluate(() => document.activeElement?.className), 'calc-editor');
  await page.keyboard.press('Escape');
});

await check('insert a chart from the selection, move it and restyle it', async () => {
  await click(0, 0);
  await page.keyboard.down('Shift');
  await click(3, 2);
  await page.keyboard.up('Shift');
  await page.getByRole('tab', { name: 'Insertar' }).click();
  await page.click('[data-nv-item="chartMenu:primary"]');
  await page.waitForSelector('.calc-chart canvas');
  assert.equal(await page.locator('.calc-chart').count(), 1);
  assert.ok(await page.getByRole('tab', { name: /Diseño de gráfico/ }).isVisible(), 'contextual tab appears');
  const box1 = await page.locator('.calc-chart').boundingBox();
  assert.ok(box1.width > 400 && box1.height > 250);
  // drag it
  await page.mouse.move(box1.x + 100, box1.y + 100);
  await page.mouse.down();
  await page.mouse.move(box1.x + 160, box1.y + 160, { steps: 5 });
  await page.mouse.up();
  const box2 = await page.locator('.calc-chart').boundingBox();
  assert.ok(Math.abs(box2.x - box1.x - 60) < 4 && Math.abs(box2.y - box1.y - 60) < 4, `moved by ${box2.x - box1.x},${box2.y - box1.y}`);
  // contextual tab: change to a line chart
  await page.getByRole('tab', { name: /Diseño de gráfico/ }).click();
  await page.click('[data-nv-item="chartTypeMenu"]');
  await page.getByRole('menuitem', { name: 'Líneas', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__novaCalc.doc.sheet.charts[0].type), 'line');
  await shot('chart');
  // undo the type change, then delete with the keyboard
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => window.__novaCalc.doc.sheet.charts[0].type), 'column');
  await page.locator('.calc-chart').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('.calc-chart').count(), 0);
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('.calc-chart').count(), 1);
  await page.getByRole('tab', { name: 'Inicio' }).click();
});

await check('Home ribbon collapses groups in a narrow window', async () => {
  await page.setViewportSize({ width: 760, height: 700 });
  await page.waitForTimeout(400);
  assert.ok((await page.locator('.nv-group--collapsed').count()) > 0);
  await shot('narrow');
  await page.setViewportSize({ width: 1280, height: 800 });
});

await check('no runtime errors were logged', async () => {
  // Fluent UI's focus-visible helper logs this dev-only warning when a dialog unmounts; it is not an app error
  const real = errors.filter((m) => !/Keyborg instance .* is being disposed incorrectly/.test(m));
  assert.deepEqual(real, []);
});

if (process.env.NOVA_DEBUG) {
  console.log(errors.join('\n---\n'));
  const stacks = await page.evaluate(() => window.__stacks ?? []);
  if (stacks[0]) console.log(stacks[0].split('\n').slice(0, 30).map((l) => l.replace(/http:\/\/localhost:1420\/(node_modules\/\.vite\/deps\/|src\/)/, '')).join('\n'));
}
await browser.close();
for (const r of results) console.log(r[0].padEnd(5), r[1], r[2] ? `— ${r[2]}` : '');
const failed = results.filter((r) => r[0] !== 'ok').length;
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
