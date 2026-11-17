// Edición de ecuaciones dentro del documento de Writer: nueva ecuación, teclado, cinta «Ecuación», guardar y volver a editar. Necesita `pnpm dev` en :1420.
// Uso: node scripts/e2e-writer-math.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
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
const settle = (ms = 300) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
const maths = () =>
  ev(() => {
    const out = [];
    window.__novaWriter.ctl.mainView.state.doc.descendants((n) => void (n.type.name === 'math' && out.push({ tex: n.attrs.tex, display: n.attrs.display })));
    return out;
  });
const tab = async (n) => {
  const t = n === 'Ecuación' ? page.locator('[role=tab]').filter({ hasText: 'Herramientas de ecuación' }) : page.getByRole('tab', { name: n, exact: true });
  if ((await t.getAttribute('aria-selected')) !== 'true') await t.click();
};
const editing = () => page.locator('.ProseMirror .nw-math-editing');

await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await settle(500);
await ev(() => window.__novaWriter.ctl.newDoc());
await settle(700);
await page.locator('.ProseMirror').click();
await page.keyboard.type('Sea ');

await check('Insertar > Ecuación > Nueva ecuación: se edita en el documento, con cursor', async () => {
  await tab('Insertar');
  await page.getByRole('button', { name: 'Ecuación' }).last().click();
  await page.getByRole('menuitem', { name: 'Nueva ecuación' }).click();
  await editing().waitFor();
  assert.equal(await page.locator('.nw-math-editing .nm-caret').count(), 1, 'cursor');
  await shot('nueva');
});

await check('teclado: «/» fracción, «^» índice, «\\alpha» + espacio; Intro guarda y deja la ecuación elegida', async () => {
  await page.keyboard.type('x=a/b');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('+y^2+');
  await page.keyboard.type('\\alpha ');
  await shot('escrita');
  assert.equal((await maths())[0].tex, '', 'aún sin guardar mientras se edita');
  await page.keyboard.press('Enter');
  await settle();
  assert.equal(await editing().count(), 0);
  assert.equal((await maths())[0].tex, String.raw`x=\frac{a}{b}+y^2+\alpha`);
  assert.equal(await page.locator('.ProseMirror .nw-math mfrac').count(), 1);
  await shot('guardada');
});

await check('aparece la pestaña «Ecuación» con la ecuación elegida', async () => {
  await page.locator('[role=tab]').filter({ hasText: 'Herramientas de ecuación' }).waitFor();
});

await check('Intro vuelve a editarla y la cinta inserta estructuras y símbolos en el sitio', async () => {
  await page.locator('.ProseMirror').focus();
  await page.keyboard.press('Enter');
  await editing().waitFor();
  await page.keyboard.press('End');
  await tab('Ecuación');
  await page.getByRole('button', { name: 'Radicales', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Raíz cuadrada' }).click();
  await page.keyboard.type('z');
  await page.keyboard.press('ArrowRight');
  await tab('Ecuación');
  await page.getByRole('button', { name: 'Griegas minúsculas', exact: true }).click();
  await page.getByRole('menuitem', { name: /^π/ }).click();
  await shot('cinta');
  await page.keyboard.press('Escape');
  await settle();
  assert.equal((await maths())[0].tex.replace(/\s+/g, ''), String.raw`x=\frac{a}{b}+y^2+\alpha\sqrt{z}\pi`);
});

await check('«Ecuación en su propia línea» la pasa a bloque', async () => {
  await tab('Ecuación');
  await page.getByRole('button', { name: 'Ecuación en su propia línea', exact: true }).click();
  await settle();
  assert.equal((await maths())[0].display, true);
  assert.equal(await page.locator('.ProseMirror .nw-math[data-display="1"]').count(), 1);
});

await check('un clic en el texto guarda lo que se estaba escribiendo', async () => {
  await page.locator('.ProseMirror .nw-math').dblclick();
  await editing().waitFor();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('1+1');
  await page.locator('.ProseMirror p', { hasText: 'Sea' }).first().click({ position: { x: 5, y: 5 } });
  await settle();
  assert.equal(await editing().count(), 0);
  assert.equal((await maths())[0].tex, '1+1');
});

await check('deshacer del documento devuelve la ecuación anterior', async () => {
  await page.locator('.ProseMirror').focus();
  await ev(() => window.__novaWriter.ctl.mainView.focus());
  await page.keyboard.press('Control+z');
  await settle();
  assert.match((await maths())[0].tex, /frac/);
});

await check('una ecuación vacía se quita al salir', async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await settle(600);
  await page.locator('.ProseMirror').click();
  await tab('Insertar');
  await page.getByRole('button', { name: 'Ecuación' }).last().click();
  await page.getByRole('menuitem', { name: 'Nueva ecuación' }).click();
  await editing().waitFor();
  await page.keyboard.press('Escape');
  await settle();
  assert.equal((await maths()).length, 0);
});

await check('la ecuación editada en el documento sobrevive a guardar y leer .docx', async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await settle(600);
  await page.locator('.ProseMirror').click();
  await tab('Insertar');
  await page.getByRole('button', { name: 'Ecuación' }).last().click();
  await page.getByRole('menuitem', { name: 'Nueva ecuación' }).click();
  await editing().waitFor();
  await page.keyboard.type('(a+b)^2=a^2+2ab+b^2');
  await page.keyboard.press('Enter');
  await settle();
  const tex = await ev(async () => {
    const { ctl, docx } = window.__novaWriter;
    const { data } = await docx.writeDocx(ctl.toWriterDoc());
    const { doc } = await docx.readDocx(data);
    let t = '';
    doc.body.descendants((n) => void (n.type.name === 'math' && (t = n.attrs.tex)));
    return t;
  });
  assert.match(tex.replace(/\s+/g, ''), /\(a\+b\)\^2=a\^2\+2ab\+b\^2|\{\\left\(a\+b\\right\)\}\^2=a\^2\+2ab\+b\^2/);
});

await check('sin errores de consola', async () => assert.deepEqual(errors, []));

let fail = 0;
for (const [s, name, why] of results) {
  console.log(`${s === 'ok' ? 'ok ' : 'FAIL'} ${name}${why ? `\n     ${why}` : ''}`);
  if (s !== 'ok') fail++;
}
await browser.close();
process.exit(fail ? 1 : 0);
