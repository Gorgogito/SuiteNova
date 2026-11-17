// Comprobaciones de extremo a extremo del editor de ecuaciones compartido (en Writer y en Slides). Necesita `pnpm dev` en :1420.
// Uso: node scripts/e2e-math-editor.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.NOVA_URL ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
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
const code = () => page.locator('#nw-eq-src').inputValue();
const editor = () => page.locator('[data-testid=equation-editor]');
const savedTex = () =>
  page.evaluate(() => {
    let t = '';
    window.__novaWriter.ctl.mainView.state.doc.descendants((n) => void (n.type.name === 'math' && (t = n.attrs.tex)));
    return t;
  });

await page.goto(`${BASE}?app=writer`, { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await settle(500);
await page.evaluate(() => window.__novaWriter.ctl.newDoc());
await settle(700);
await page.locator('.ProseMirror').click();
const openDialog = async () => {
  await page.evaluate(() => window.__novaWriter.ctl.onDialog('equation', {}));
  await editor().waitFor();
  await editor().click();
};

await check('el editor se enfoca solo y dibuja el cursor', async () => {
  await openDialog();
  assert.equal(await page.locator('[data-testid=equation-editor] math .nm-caret').count(), 1);
  await shot('editor-vacio');
});

await check('teclado: «/» hace una fracción, «^» un índice y «\\alpha» + espacio una letra griega', async () => {
  await page.keyboard.type('x=a/b');
  await settle(150);
  assert.equal(await code(), String.raw`x=\frac{a}{b}`);
  assert.equal(await page.locator('[data-testid=equation-editor] mfrac').count(), 1);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('+y^2+');
  await page.keyboard.type('\\alpha ');
  await settle(150);
  assert.equal(await code(), String.raw`x=\frac{a}{b}+y^2+\alpha`);
  await shot('editor-escrito');
});

await check('flechas, Retroceso y deshacer', async () => {
  await page.keyboard.press('Backspace'); // quita α
  await settle(100);
  assert.equal(await code(), String.raw`x=\frac{a}{b}+y^2+`);
  await page.keyboard.press('Control+z');
  await settle(100);
  assert.equal(await code(), String.raw`x=\frac{a}{b}+y^2+\alpha`);
  await page.keyboard.press('Control+z'); // deshace «α»
  await page.keyboard.press('Control+Shift+z');
  await settle(100);
  assert.equal(await code(), String.raw`x=\frac{a}{b}+y^2+\alpha`);
});

await check('galería: estructuras y símbolos se insertan en el cursor', async () => {
  await page.getByLabel('Galería de ecuaciones').selectOption('Radicales');
  await page.getByRole('button', { name: 'Raíz cuadrada' }).click();
  await page.keyboard.type('z');
  await settle(150);
  assert.match(await code(), /\\sqrt\{z\}$/);
  await page.keyboard.press('ArrowRight'); // sale de la raíz
  await page.getByLabel('Galería de ecuaciones').selectOption('Griegas minúsculas');
  await page.locator('[data-symbol="π"]').click();
  await settle(150);
  assert.match(await code(), /\\sqrt\{z\}\\pi$/);
  await page.getByLabel('Galería de ecuaciones').selectOption('Matrices');
  await page.locator('[data-structure="matrix-p"]').click();
  await page.keyboard.type('1');
  await page.keyboard.press('Tab');
  await page.keyboard.type('2');
  await settle(150);
  assert.match(await code(), /\\begin\{pmatrix\}\s*1 & 2/);
  assert.equal(await page.locator('[data-testid=equation-editor] mtable').count(), 1);
  await shot('galeria');
});

await check('ratón: un clic coloca el cursor en una casilla y se sigue escribiendo ahí', async () => {
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('a/b');
  await settle(150);
  await page.locator('[data-testid=equation-editor] mfrac > mrow').first().click();
  await page.keyboard.type('x');
  await settle(150);
  assert.match(await code(), /\\frac\{.*x.*\}\{b\}|\\frac\{ax\}\{b\}|\\frac\{xa\}\{b\}/);
});

await check('seleccionar y pegar: lo copiado se pega como ecuación', async () => {
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  assert.equal(await code(), '');
  await page.keyboard.press('Control+v');
  await settle(150);
  assert.match(await code(), /\\frac/);
});

await check('el código LaTeX y el editor se mantienen sincronizados en los dos sentidos', async () => {
  await page.locator('#nw-eq-src').fill(String.raw`\sum_{i=1}^{n} i^2`);
  await settle(200);
  assert.equal(await page.locator('[data-testid=equation-editor] munderover').count(), 1);
  await editor().click();
  await page.keyboard.press('End');
  await page.keyboard.type('+1');
  await settle(150);
  assert.match(await code(), /\+1$/);
});

await check('Aceptar guarda la ecuación en el documento y se vuelve a abrir en el editor', async () => {
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await settle(400);
  assert.match(await savedTex(), /\\sum/);
  await page.locator('.ProseMirror .nw-math').dblclick();
  await editor().waitFor();
  assert.equal(await page.locator('[data-testid=equation-editor] munderover').count(), 1);
  await shot('reabierta');
  await page.getByRole('button', { name: 'Cancelar' }).click();
});

await check('Slides: el mismo editor escribe la fórmula y la imagen se dibuja con ella', async () => {
  await page.goto(`${BASE}?app=slides`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.sl-surface');
  await settle(800);
  await page.evaluate(() => {
    const c = window.__novaSlides.ctl;
    c.newDoc();
    c.goTo(0);
  });
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.setViewportSize({ width: 1900, height: 950 });
  await page.getByRole('button', { name: 'Ecuación…', exact: true }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('[data-testid=equation-editor]').waitFor();
  await dlg.locator('[data-testid=equation-editor]').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('a^2+b^2=c^2');
  await settle(250);
  assert.equal(await dlg.getByLabel('Fórmula en LaTeX').inputValue(), 'a^2+b^2=c^2');
  assert.ok(await dlg.locator('[data-testid=eq-preview] math').count(), 'la vista previa de la imagen sigue');
  await shot('slides-editor');
  await dlg.getByRole('button', { name: 'Insertar' }).click();
  await page.waitForFunction(() => window.__novaSlides.ctl.selected[0]?.name === 'Ecuación');
});

await check('sin errores de consola', async () => assert.deepEqual(errors, []));

let fail = 0;
for (const [s, name, why] of results) {
  console.log(`${s === 'ok' ? 'ok ' : 'FAIL'} ${name}${why ? `\n     ${why}` : ''}`);
  if (s !== 'ok') fail++;
}
await browser.close();
process.exit(fail ? 1 : 0);
