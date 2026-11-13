// End-to-end checks for sheet and workbook protection in Nova Calc. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-calc-protect.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=calc';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
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
  await page.waitForTimeout(250);
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
await page.waitForTimeout(400);
await page.mouse.click(300, 400);
const ev = (fn, arg) => page.evaluate(fn, arg);
const text = (a) => ev((addr) => window.__novaCalc.text(addr), a);
const select = (r, c) => ev(([rr, cc]) => window.__novaCalc.doc.selectCell(rr, cc), [r, c]);
const type = async (r, c, t) => {
  await select(r, c);
  await page.keyboard.type(t);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
};
const ribbonTab = async (name) => {
  await page.getByRole('tab', { name, exact: true }).first().click();
  await page.waitForTimeout(150);
};
const btn = (name) => page.getByRole('button', { name }).first();
const notice = () => ev(() => window.__novaCalc.doc.notice);

await type(0, 0, '10');
await type(1, 0, '20');
await type(0, 1, '1');

await check('Formato de celdas > Protección: desbloquear B1 desde el cuadro', async () => {
  await select(0, 1);
  await page.keyboard.press('Control+1');
  await page.getByRole('tab', { name: 'Protección' }).click();
  await shot('formato-proteccion');
  await page.getByLabel('Bloqueada').uncheck();
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(200);
  assert.equal(await ev(() => window.__novaCalc.doc.wb.getStyle(window.__novaCalc.doc.activeSheetId, 0, 1).locked), false);
});

await check('Revisar > Proteger hoja con contraseña', async () => {
  await ribbonTab('Revisar');
  await shot('revisar');
  await btn('Proteger hoja…').click();
  await page.waitForTimeout(200);
  await page.locator('#ps-pw').fill('abc');
  await page.locator('#ps-pw2').fill('abd');
  await shot('proteger-hoja-no-coincide');
  assert.equal(await page.getByRole('button', { name: 'Aceptar' }).isDisabled(), true);
  await page.locator('#ps-pw2').fill('abc');
  await page.getByLabel('Insertar filas').check();
  await shot('proteger-hoja');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(500);
  assert.equal(await ev(() => window.__novaCalc.doc.prot.isProtected()), true);
});

await check('en la hoja protegida solo se edita la celda desbloqueada', async () => {
  await type(0, 0, '99');
  assert.equal(await text('A1'), '10');
  assert.match(String(await notice()), /protegida/);
  await shot('aviso-celda-bloqueada');
  await type(0, 1, '7');
  assert.equal(await text('B1'), '7');
});

await check('suprimir, dar formato y ordenar están bloqueados; insertar filas está permitido', async () => {
  await select(0, 0);
  await page.keyboard.press('Delete');
  assert.equal(await text('A1'), '10');
  await ev(() => window.__novaCalc.doc.applyStyle({ bold: true }));
  assert.equal(await ev(() => window.__novaCalc.doc.wb.getStyle(window.__novaCalc.doc.activeSheetId, 0, 0).bold ?? false), false);
  await select(5, 0);
  await ev(() => window.__novaCalc.doc.insertRows());
  assert.equal(await ev(() => window.__novaCalc.doc.notice !== null && /Insertar/.test(window.__novaCalc.doc.notice)), false);
});

await check('Quitar protección: contraseña mala y buena', async () => {
  await btn('Quitar protección de la hoja').click();
  await page.waitForTimeout(200);
  await page.locator('#unp-pw').fill('mala');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(150);
  await shot('contrasena-incorrecta');
  assert.equal(await page.getByText('La contraseña no es correcta.').isVisible(), true);
  await page.locator('#unp-pw').fill('abc');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(300);
  assert.equal(await ev(() => window.__novaCalc.doc.prot.isProtected()), false);
  await type(0, 0, '5');
  assert.equal(await text('A1'), '5');
});

await check('Proteger libro: no se puede añadir una hoja', async () => {
  await btn('Proteger libro…').click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(300);
  const before = await ev(() => window.__novaCalc.doc.wb.sheets.length);
  await ev(() => window.__novaCalc.doc.addSheet());
  assert.equal(await ev(() => window.__novaCalc.doc.wb.sheets.length), before);
  assert.match(String(await notice()), /estructura del libro/);
  await shot('libro-protegido');
  await btn('Quitar protección del libro').click();
  await page.waitForTimeout(200);
  await ev(() => window.__novaCalc.doc.addSheet());
  assert.equal(await ev(() => window.__novaCalc.doc.wb.sheets.length), before + 1);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors.filter((e) => !/Keyborg/.test(e)), []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
