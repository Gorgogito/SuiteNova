// End-to-end checks for equations in Nova Calc: insert with the shared structured editor, draw as MathML, edit again, save/reopen as
// .xlsx (a14:m with the picture as fallback), undo and print. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-calc-equation.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=calc';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const results = [];
let step = 0;

const session = async (fn) => {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 950 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404/.test(m.text()) && errors.push(m.text()));
  page.on('dialog', (d) => {
    errors.push(`dialog: ${d.message()}`);
    d.dismiss().catch(() => {});
  });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('.calc-grid__scroller');
  await page.waitForTimeout(400);
  await page.mouse.click(300, 400);
  const shot = async (name) => {
    if (shotsDir) {
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
    }
  };
  try {
    await fn(page, shot);
    assert.deepEqual(errors, [], 'sin errores de consola');
  } finally {
    await ctx.close();
  }
};
const check = async (name, fn) => {
  try {
    await session(fn);
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ') + ' @ ' + (e.stack.split(String.fromCharCode(10)).find((l) => l.includes('e2e-calc-equation')) ?? '').trim()]);
  }
};

const shapes = (page) => page.evaluate(() => window.__novaCalc.doc.sheet.shapes.map((s) => ({ ...s, math: s.math && { ...s.math } })));
const insertEquation = async (page, text) => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'Ecuación…', exact: true }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('[data-testid=equation-editor]').waitFor();
  if (text) {
    await dlg.locator('[data-testid=equation-editor]').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(text);
    await page.waitForTimeout(250);
  }
  return dlg;
};

await check('Insertar › Ecuación…: el editor estructurado escribe la fórmula y queda un cuadro con ella, dibujado como MathML', async (page, shot) => {
  const dlg = await insertEquation(page, 'a^2+b^2=c^2');
  assert.equal(await dlg.getByLabel('Fórmula en LaTeX').inputValue(), 'a^2+b^2=c^2');
  await shot('dialogo');
  await dlg.getByRole('button', { name: 'Insertar' }).click();
  await page.waitForFunction(() => window.__novaCalc.doc.sheet.shapes.length === 1);
  const s = (await shapes(page))[0];
  assert.equal(s.kind, 'textBox');
  assert.equal(s.name, 'Ecuación');
  assert.equal(s.math.tex, 'a^2+b^2=c^2');
  assert.equal(s.math.size, 14);
  assert.equal(s.text, undefined, 'el contenido es la fórmula, no texto');
  assert.ok(s.math.fallback, 'imagen de respaldo');
  assert.ok(s.width > 20 && s.height > 10, 'tamaño natural de la fórmula');
  assert.ok(await page.locator('[data-testid=calc-math] math').count(), 'dibujada con MathML');
  await shot('insertada');
});

await check('doble clic la edita de nuevo (nueva fórmula y tamaño) y deshacer devuelve la anterior', async (page) => {
  const dlg = await insertEquation(page, 'x+y');
  await dlg.getByRole('button', { name: 'Insertar' }).click();
  await page.waitForFunction(() => window.__novaCalc.doc.sheet.shapes.length === 1);
  const before = (await shapes(page))[0];
  await page.locator('[data-shape-id]').first().dblclick();
  const d2 = page.getByRole('dialog');
  await d2.getByLabel('Fórmula en LaTeX').waitFor();
  assert.equal(await d2.getByLabel('Fórmula en LaTeX').inputValue(), 'x+y');
  await d2.getByLabel('Fórmula en LaTeX').fill('\\frac{a}{b}');
  await d2.getByLabel('Tamaño de la ecuación (pt)').fill('24');
  await d2.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await page.waitForFunction(() => window.__novaCalc.doc.sheet.shapes[0].math.tex.includes('frac'));
  const after = (await shapes(page))[0];
  assert.equal(after.id, before.id);
  assert.equal(after.math.size, 24);
  assert.ok(after.height > before.height, 'el cuadro toma el tamaño de la nueva fórmula');
  assert.ok(await page.locator('[data-testid=calc-math] mfrac').count(), 'se dibuja la fracción');
  await page.evaluate(() => window.__novaCalc.doc.undo());
  await page.waitForTimeout(400);
  assert.equal((await shapes(page))[0].math.tex, 'x+y');
});

await check('guardar y volver a leer el .xlsx: a14:m con la imagen de respaldo, y se lee como ecuación', async (page) => {
  const dlg = await insertEquation(page, '');
  await dlg.getByRole('button', { name: 'Fórmula cuadrática', exact: true }).click();
  await dlg.getByRole('button', { name: 'Insertar' }).click();
  await page.waitForFunction(() => window.__novaCalc.doc.sheet.shapes.length === 1);
  const rt = await page.evaluate(() => window.__novaCalc.xlsxRoundTrip());
  assert.match(rt.drawing, /Requires="a14"[\s\S]*<a14:m>[\s\S]*<m:oMathPara/, 'la ecuación es texto, no imagen');
  assert.ok(rt.drawing.includes('<xdr:pic>'), 'la imagen de la fórmula es la alternativa');
  assert.equal(rt.shapes.length, 1);
  assert.match(rt.shapes[0].math.tex, /sqrt/);
  assert.ok(rt.shapes[0].math.fallback, 'la imagen vuelve');
  assert.equal(rt.shapes[0].text, undefined);
});

await check('Quitar con Supr borra la ecuación y deshacer la devuelve', async (page) => {
  const dlg = await insertEquation(page, 'e^x');
  await dlg.getByRole('button', { name: 'Insertar' }).click();
  await page.waitForFunction(() => window.__novaCalc.doc.sheet.shapes.length === 1);
  await page.getByRole('button', { name: 'Eliminar forma' }).first().click().catch(() => {});
  await page.evaluate(() => window.__novaCalc.doc.x.deleteShape(window.__novaCalc.doc.sheet.shapes[0].id));
  await page.waitForFunction(() => window.__novaCalc.doc.sheet.shapes.length === 0);
  await page.evaluate(() => window.__novaCalc.doc.undo());
  await page.waitForFunction(() => window.__novaCalc.doc.sheet.shapes.length === 1);
  assert.equal((await shapes(page))[0].math.tex, 'e^x');
});

let fail = 0;
for (const [s, name, why] of results) {
  console.log(`${s === 'ok' ? 'ok ' : 'FAIL'} ${name}${why ? `\n     ${why}` : ''}`);
  if (s !== 'ok') fail++;
}
await browser.close();
process.exit(fail ? 1 : 0);
