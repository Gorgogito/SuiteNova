// End-to-end checks for the macro recorder (Writer and Calc): record what the user does, stop, and play the macro back. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-macros-record.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => d.accept());
let step = 0;
const shot = async (name) => {
  if (!shotsDir) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 8).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
const settle = (ms = 400) => page.waitForTimeout(ms);

// ------------------------------------------------------------------------------------------------ Writer
const openWriter = async () => {
  await page.goto(`${BASE}?app=writer`, { waitUntil: 'load' });
  await page.waitForSelector('.ProseMirror');
  await page.evaluate(() => window.__novaWriter.ctl.newDoc());
  await settle(600);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('uno dos');
};
const docState = () => page.evaluate(() => ({ text: window.__novaWriter.ctl.mainView.state.doc.textContent, strong: window.__novaWriter.ctl.mainView.state.doc.textContent && document.querySelectorAll('.ProseMirror strong').length }));

await check('Writer: grabar teclear, negrita y estilo; detener; la macro queda en «Grabadas»', async () => {
  await openWriter();
  await page.getByRole('tab', { name: 'Programador', exact: true }).click();
  await page.getByRole('button', { name: 'Grabar macro…' }).click();
  await page.getByRole('dialog', { name: 'Grabar macro' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Nombre de la macro' }).inputValue(), 'Macro1');
  await page.getByRole('textbox', { name: 'Nombre de la macro' }).fill('Mi macro'); // con espacio: no vale
  assert.ok(await page.getByText(/sin espacios/).count());
  assert.equal(await page.getByRole('button', { name: 'Grabar', exact: true }).isDisabled(), true);
  await page.getByRole('textbox', { name: 'Nombre de la macro' }).fill('MiMacro');
  await page.getByRole('textbox', { name: 'Descripción' }).fill('Prueba de grabación');
  await page.getByRole('button', { name: 'Grabar', exact: true }).click();
  await page.locator('.nv-mac__rec').waitFor();
  assert.match(await page.locator('.nv-mac__rec').innerText(), /Grabando macro «MiMacro»/);
  await shot('grabando');
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' tres');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.type('fin');
  await page.locator('.nv-mac__rec').getByRole('button', { name: 'Detener grabación' }).click();
  await page.locator('.nv-mac__rec').waitFor({ state: 'detached' });
  const mods = await page.evaluate(() => window.__novaWriter.ctl.macros);
  assert.deepEqual(mods.map((m) => m.name), ['Grabadas']);
  const code = mods[0].code;
  assert.match(code, /Sub MiMacro\(\)/);
  assert.match(code, /Prueba de grabación/);
  assert.match(code, /Selection\.TypeText Text:=" tres"/);
  assert.match(code, /Selection\.Font\.Bold = True/);
  assert.match(code, /Selection\.TypeParagraph/);
  assert.match(code, /Selection\.TypeText Text:="fin"/);
  assert.match(await page.locator('span[role=status]', { hasText: 'se guardó en el módulo' }).innerText(), /MiMacro/);
  await shot('detenida');
});

await check('Writer: la macro grabada, reproducida en un documento igual, da el mismo resultado', async () => {
  const recorded = await docState();
  const code = await page.evaluate(() => window.__novaWriter.ctl.macros[0].code);
  await page.evaluate(() => window.__novaWriter.ctl.newDoc());
  await settle(600);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('uno dos');
  await page.evaluate((c) => {
    const ctl = window.__novaWriter.ctl;
    ctl.macros = [{ name: 'Grabadas', code: c }];
    ctl.contentEnabled = true;
  }, code);
  const r = await page.evaluate(() => window.__novaWriter.ctl.macroRt.run('MiMacro'));
  assert.equal(r.ok, true, r.error);
  const replayed = await docState();
  assert.equal(replayed.text, recorded.text);
  assert.equal(replayed.strong, recorded.strong);
  assert.equal(replayed.text, 'Uno dos tresfin');
});

await check('Writer: pausar no graba; el editor muestra el código grabado', async () => {
  await openWriter();
  await page.evaluate(() => window.__novaWriter.ctl.startRecording('Pausada', ''));
  await page.locator('.nv-mac__rec').waitFor();
  await page.getByRole('button', { name: 'Pausar grabación' }).click();
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' NO');
  await page.getByRole('button', { name: 'Reanudar grabación' }).click();
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' SI');
  await page.getByRole('button', { name: 'Detener grabación' }).first().click();
  const code = await page.evaluate(() => window.__novaWriter.ctl.macros.find((m) => m.name === 'Grabadas').code);
  assert.ok(!code.includes('NO'), code);
  assert.match(code, /" SI"/);
  await page.getByRole('tab', { name: 'Programador', exact: true }).click();
  await page.getByRole('button', { name: 'Editor de código…' }).click();
  assert.match(await page.locator('textarea.nv-mac__code').inputValue(), /Sub Pausada/);
  await page.getByRole('button', { name: 'Cerrar' }).click();
});

// ------------------------------------------------------------------------------------------------ Calc
const calcCell = async (col, row) => {
  const box = await page.locator('.calc-grid__scroller').boundingBox();
  await page.mouse.click(box.x + 40 + col * 64 + 32, box.y + 22 + row * 20 + 10);
};
const cell = (addr) => page.evaluate((a) => window.__novaCalc.text(a), addr);

await check('Calc: grabar escribir en celdas y dar formato; la macro se reproduce en otro libro', async () => {
  await page.goto(`${BASE}?app=calc`, { waitUntil: 'load' });
  await page.waitForSelector('.calc-grid__scroller');
  await settle(600);
  await page.getByRole('tab', { name: 'Programador', exact: true }).click();
  await page.getByRole('button', { name: 'Grabar macro…' }).click();
  await page.getByRole('textbox', { name: 'Nombre de la macro' }).fill('Tabla');
  await page.getByRole('button', { name: 'Grabar', exact: true }).click();
  await page.locator('.nv-mac__rec').waitFor();
  await calcCell(0, 0);
  for (const k of ['Producto', 'Tab', 'Precio', 'Enter']) await (k === 'Tab' || k === 'Enter' ? page.keyboard.press(k) : page.keyboard.type(k));
  await calcCell(0, 1);
  for (const k of ['Pan', 'Tab', '12', 'Enter']) await (k === 'Tab' || k === 'Enter' ? page.keyboard.press(k) : page.keyboard.type(k));
  for (const k of ['Sal', 'Tab', '=B2*2', 'Enter']) await (k === 'Tab' || k === 'Enter' ? page.keyboard.press(k) : page.keyboard.type(k));
  await calcCell(0, 0);
  await page.keyboard.down('Shift');
  await calcCell(1, 0);
  await page.keyboard.up('Shift');
  await page.keyboard.press('Control+b');
  await shot('calc-grabando');
  await page.locator('.nv-mac__rec').getByRole('button', { name: 'Detener grabación' }).click();
  await page.locator('.nv-mac__rec').waitFor({ state: 'detached' });
  const code = await page.evaluate(() => window.__novaCalc.doc.wb.macros[0].code);
  assert.match(code, /Sub Tabla\(\)/);
  assert.match(code, /Range\("A1"\)\.Value = "Producto"/);
  assert.match(code, /Range\("B3"\)\.Formula = "=B2\*2"/);
  assert.match(code, /Range\("B2"\)\.Value = "12"/);
  assert.match(code, /Selection\.Font\.Bold = True/);
  const recorded = await page.evaluate(() => ['A1', 'B1', 'A2', 'B2', 'A3', 'B3'].map((a) => window.__novaCalc.text(a)));
  // a new workbook plays it back
  await page.evaluate((c) => {
    const d = window.__novaCalc.doc;
    d.newBook?.();
    d.wb.macros = [{ name: 'Grabadas', code: c }];
    d.contentEnabled = true;
  }, code);
  const replayed = await page.evaluate(() => {
    const d = window.__novaCalc.doc;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) d.wb.setInput(d.activeSheetId, r, c, '');
    const res = d.macros.run('Tabla');
    return { ok: res.ok, error: res.error, cells: ['A1', 'B1', 'A2', 'B2', 'A3', 'B3'].map((a) => window.__novaCalc.text(a)), bold: d.wb.getStyle(d.activeSheetId, 0, 0).bold };
  });
  assert.equal(replayed.ok, true, replayed.error);
  assert.deepEqual(replayed.cells, recorded);
  assert.equal(replayed.bold, true);
});

await check('sin errores de consola', async () => assert.deepEqual(errors, []));
await browser.close();
for (const r of results) console.log(r[0] === 'ok' ? '✔' : '✘', r[1], r[2] ?? '');
process.exit(results.some((r) => r[0] !== 'ok') ? 1 : 0);
