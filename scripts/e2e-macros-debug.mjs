// End-to-end checks for the macro debugger (shared editor): breakpoints, steps, variables, stack, immediate window while stopped. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-macros-debug.mjs [--shots dir]
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
const CODE = ['Sub Principal()', '  Dim x As Integer', '  x = 5', '  Doble x', '  ActiveDocument.Range(0, 0).InsertBefore "x=" & x', 'End Sub', 'Sub Doble(ByRef n As Integer)', '  n = n * 2', 'End Sub', ''].join('\n');

const openEditor = async () => {
  await page.goto(`${BASE}?app=writer`, { waitUntil: 'load' });
  await page.waitForSelector('.ProseMirror');
  await page.evaluate(() => window.__novaWriter.ctl.newDoc());
  await settle(600);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('texto');
  await page.getByRole('tab', { name: 'Programador', exact: true }).click();
  await page.getByRole('button', { name: 'Editor de código…' }).click();
  await page.getByRole('button', { name: 'Nuevo módulo' }).click();
  await page.locator('textarea.nv-mac__code').fill(CODE);
  await settle();
};
const where = () => page.getByRole('region', { name: 'Depuración' }).getByText(/Detenido en/).innerText();
const vars = async () => {
  const rows = await page.getByRole('region', { name: 'Variables' }).locator('tbody tr').allInnerTexts();
  return Object.fromEntries(rows.map((r) => r.split('\t')).map((c) => [c[0], c[1]]));
};
const docText = () => page.evaluate(() => window.__novaWriter.ctl.mainView.state.doc.textContent);

await check('Depurar: se detiene en la primera línea, muestra variables y avanza paso a paso', async () => {
  await openEditor();
  await page.getByRole('button', { name: 'Depurar', exact: true }).click();
  assert.match(await where(), /Principal, línea 3|Principal, línea 2/);
  await shot('stopped');
  await page.getByRole('button', { name: 'Paso a paso por instrucciones' }).click();
  const w = await where();
  assert.match(w, /línea 4/);
  assert.equal((await vars()).x, '5');
  await page.getByRole('button', { name: 'Paso a paso por instrucciones' }).click(); // entra en Doble
  assert.match(await where(), /Doble, línea 8/);
  const stack = await page.getByRole('listbox', { name: 'Pila de llamadas' }).getByRole('option').allInnerTexts();
  assert.deepEqual(stack, ['Doble:8', 'Principal:4']);
  assert.equal((await vars()).n, '5');
  await page.getByRole('button', { name: 'Paso a paso para salir' }).click();
  assert.match(await where(), /Principal, línea 5/);
  assert.equal((await vars()).x, '10');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.locator('.nv-mac__ok').waitFor();
  assert.match(await page.locator('.nv-mac__ok').innerText(), /terminó correctamente/);
  assert.equal(await page.getByRole('region', { name: 'Depuración' }).count(), 0);
});

await check('un punto de interrupción detiene «Ejecutar»; la ventana inmediato evalúa y cambia variables', async () => {
  await openEditor();
  await page.locator('.nv-mac__gutter div[data-line="5"]').click();
  assert.equal(await page.locator('.nv-mac__gutter .is-bp').count(), 1);
  await page.getByRole('button', { name: 'Ejecutar', exact: true }).first().click();
  assert.match(await where(), /Principal, línea 5/);
  assert.equal((await vars()).x, '10');
  const imm = page.getByRole('textbox', { name: 'Instrucción inmediata' });
  await imm.fill('? x * 3');
  await imm.press('Enter');
  assert.match(await page.locator('.nv-mac__out').innerText(), /30/);
  await imm.fill('x = 7');
  await imm.press('Enter');
  assert.equal((await vars()).x, '7');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.locator('.nv-mac__ok').waitFor();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await settle();
  assert.equal(await docText(), 'x=7texto');
});

await check('Detener termina la ejecución sin tocar el documento', async () => {
  await openEditor();
  await page.getByRole('button', { name: 'Depurar', exact: true }).click();
  await page.getByRole('button', { name: 'Detener' }).click();
  assert.match(await page.locator('.nv-mac__ok').innerText(), /detuvo/);
  assert.equal(await page.getByRole('region', { name: 'Depuración' }).count(), 0);
  await page.getByRole('button', { name: 'Ejecutar', exact: true }).first().click(); // se puede volver a ejecutar
  await page.locator('.nv-mac__ok', { hasText: 'terminó' }).waitFor();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await settle();
  assert.equal(await docText(), 'x=10texto');
});

await check('las teclas F8 y F5 depuran y continúan (F5 no recarga la página)', async () => {
  await openEditor();
  await page.locator('textarea.nv-mac__code').press('F8');
  assert.match(await where(), /línea/);
  await page.locator('textarea.nv-mac__code').press('F8');
  await page.locator('textarea.nv-mac__code').press('F5');
  await page.locator('.nv-mac__ok').waitFor();
  assert.match(await page.locator('.nv-mac__ok').innerText(), /terminó/);
});

await check('«Paso a paso» del cuadro Macros abre el editor detenido en la macro', async () => {
  await openEditor();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await settle();
  await page.getByRole('button', { name: 'Macros…' }).first().click();
  await page.getByRole('option', { name: /Principal/ }).click();
  await page.getByRole('button', { name: 'Paso a paso', exact: true }).click();
  await page.getByRole('region', { name: 'Depuración' }).waitFor();
  assert.match(await where(), /Principal/);
  await page.getByRole('button', { name: 'Detener' }).click();
});

await check('un error del programa durante la depuración se muestra con su línea', async () => {
  await openEditor();
  await page.locator('textarea.nv-mac__code').fill('Sub Falla()\n  Dim z\n  z = 1 / 0\nEnd Sub\n');
  await settle();
  await page.getByRole('button', { name: 'Depurar', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  assert.match(await page.locator('.nv-mac__error').innerText(), /ivisi/);
  assert.match(await page.locator('.nv-mac__error').innerText(), /3/);
});

await check('cerrar el cuadro con la ejecución detenida la termina y deja el documento usable', async () => {
  await openEditor();
  await page.getByRole('button', { name: 'Depurar', exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await settle();
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Z');
  assert.match(await docText(), /Z/);
});

// ---- Base
await check('Base: depurar un módulo, ver las variables y continuar', async () => {
  await page.goto(`${BASE}?app=base`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__novaBase?.ctl.loading === false);
  await page.evaluate(() => {
    const c = window.__novaBase.ctl;
    c.db.saveObject('module', 'Modulo1', { code: 'Sub Prueba()\n  Dim a As Integer\n  a = 4\n  a = a * 2\n  Debug.Print "a=" & a\nEnd Sub\n' });
    c.touch();
    c.openModule('Modulo1');
  });
  await settle(600);
  await page.getByRole('button', { name: 'Depurar', exact: true }).click();
  await page.getByRole('region', { name: 'Depuración' }).waitFor();
  await page.getByRole('button', { name: 'Paso a paso por instrucciones' }).click();
  await page.getByRole('button', { name: 'Paso a paso por instrucciones' }).click();
  assert.equal((await vars()).a, '8');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.locator('.bs-ok').waitFor();
  assert.match(await page.locator('.nv-mac__out').innerText(), /a=8/);
});

await check('sin errores de consola', async () => assert.deepEqual(errors, []));
await browser.close();
for (const r of results) console.log(r[0] === 'ok' ? '✔' : '✘', r[1], r[2] ?? '');
process.exit(results.some((r) => r[0] !== 'ok') ? 1 : 0);
