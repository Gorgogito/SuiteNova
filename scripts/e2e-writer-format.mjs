// End-to-end checks for the Font and Paragraph dialogs, change case, format painter and symbols of Nova Writer.
// Needs `pnpm dev` on :1420.  Usage: node scripts/e2e-writer-format.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => {
  errors.push(`dialog: ${d.message()}`);
  d.dismiss();
});
let step = 0;
const shot = async (name) => {
  if (!shotsDir) return;
  await page.waitForTimeout(300);
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
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(500);
const ev = (fn, arg) => page.evaluate(fn, arg);
const editor = page.locator('.ProseMirror').first();
const html = () => editor.evaluate((el) => el.innerHTML);
const selectAllText = async () => {
  // Fluent devuelve el foco al cerrar un cuadro: se reintenta hasta que la selección exista
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(400);
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.waitForTimeout(150);
    if (await ev(() => !window.__novaWriter.ctl.state.selection.empty)) return;
  }
  throw new Error('no se pudo seleccionar todo el texto');
};
await editor.click();
await page.keyboard.type('hOLA mUNDO. segunda oración aquí');

await check('Fuente…: subrayado doble con color, espaciado y versalitas desde el cuadro', async () => {
  await selectAllText();
  await page.keyboard.press('Control+D');
  await page.waitForTimeout(300);
  await shot('dialogo-fuente');
  await page.locator('#ft-u').selectOption('double');
  await page.locator('input[type=color][aria-label="Color de subrayado"]').fill('#ff0000');
  await page.locator('#ft-sp').selectOption('expanded');
  await page.locator('#ft-spby').fill('2');
  await page.getByRole('dialog').getByLabel('Versalitas').check();
  await page.getByRole('dialog').getByLabel('Negrita').check();
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(400);
  const h = await html();
  assert.match(h, /nw-u-double/);
  assert.match(h, /letter-spacing:\s*2pt/);
  assert.match(h, /small-caps/);
  assert.match(h, /<strong>/);
  await shot('fuente-aplicada');
});

await check('Cambiar mayúsculas: Tipo oración, MAYÚSCULAS y poner cada palabra en mayúscula', async () => {
  const apply = async (label) => {
    await selectAllText();
    await page.getByRole('button', { name: 'Mayús./minús.' }).click();
    await page.getByRole('menuitem', { name: new RegExp('^' + label) }).click();
    await page.waitForTimeout(250);
  };
  await apply('Tipo oración');
  assert.equal((await editor.innerText()).replace(/\s+/g, ' ').trim().toLowerCase().startsWith('hola mundo. segunda'), true);
  assert.match(await editor.innerText(), /Hola mundo\. Segunda oración aquí/);
  await apply('MAYÚSCULAS');
  assert.match(await editor.innerText(), /HOLA MUNDO\. SEGUNDA ORACIÓN AQUÍ/);
  await apply('Poner en mayúscula cada palabra');
  assert.match(await editor.innerText(), /Hola Mundo\. Segunda Oración Aquí/);
  await shot('mayusculas');
});

await check('Párrafo…: sangría, interlineado exacto, conservar líneas juntas y nivel de esquema', async () => {
  await editor.click();
  await page.getByRole('button', { name: 'Párrafo…' }).click();
  await page.waitForTimeout(300);
  await shot('dialogo-parrafo');
  await page.locator('#pg-al').selectOption('justify');
  await page.locator('#pg-l').fill('1.5');
  await page.locator('#pg-sp').selectOption('first');
  await page.locator('#pg-spby').fill('1');
  await page.locator('#pg-lr').selectOption('exact');
  await page.locator('#pg-lb').fill('22');
  await page.getByRole('dialog').getByLabel('Conservar líneas juntas').check();
  await page.locator('#pg-ol').selectOption('1');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(400);
  const a = await ev(() => {
    const s = window.__novaWriter.ctl.state;
    let r;
    s.doc.descendants((n) => { if (n.type.name === 'paragraph' && !r) r = n.attrs; });
    return r;
  });
  assert.equal(a.align, 'justify');
  assert.ok(Math.abs(a.indentLeft - 42.5) < 0.5, `sangría ${a.indentLeft}`);
  assert.equal(a.lineRule, 'exact');
  assert.equal(a.lineHeight, 22);
  assert.equal(a.keepLines, true);
  assert.equal(a.outlineLevel, 1);
  assert.match(await html(), /line-height:\s*22pt/);
  await shot('parrafo-aplicado');
});

await check('Copiar formato: el formato de una palabra pasa a otra con un clic en el botón', async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await page.waitForTimeout(500);
  await editor.click();
  await page.keyboard.type('negra y plana');
  // «negra» en negrita y rojo
  await page.keyboard.press('Home');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Control+B');
  await ev(() => {
    const v = window.__novaWriter.ctl.view;
    const mt = v.state.schema.marks.color;
    v.dispatch(v.state.tr.addMark(v.state.selection.from, v.state.selection.to, mt.create({ value: '#ff0000' })));
  });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Copiar formato' }).click();
  assert.equal(await ev(() => !!window.__novaWriter.ctl.painter), true);
  // selecciona «plana» (las últimas 5 letras)
  await page.keyboard.press('End');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  assert.equal(await ev(() => !!window.__novaWriter.ctl.painter), false);
  const marks = await ev(() => {
    const out = [];
    window.__novaWriter.ctl.state.doc.descendants((n) => { if (n.isText) out.push([n.text, n.marks.map((m) => m.type.name).sort().join('+')]); });
    return out;
  });
  const flat = marks.find((m) => m[0].includes('plana'));
  assert.ok(flat && /color/.test(flat[1]) && /strong/.test(flat[1]), JSON.stringify(marks));
  await shot('copiar-formato');
});

await check('Símbolo…: inserta con doble clic y con el botón; espacio de no separación con el teclado', async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await page.waitForTimeout(500);
  await editor.click();
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  // a este ancho el grupo «Texto» de Insertar se pliega en un desplegable: se abre si hace falta
  const sym = page.getByRole('button', { name: 'Símbolo…' });
  if (!(await sym.first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Texto', exact: true }).first().click();
    await page.getByRole('button', { name: 'Símbolo…' }).click();
  } else await sym.click();
  await page.waitForTimeout(300);
  await shot('dialogo-simbolo');
  await page.getByRole('button', { name: 'Copyright', exact: true }).dblclick();
  await page.getByRole('tab', { name: 'Griego' }).click();
  await page.getByRole('button', { name: 'Letra griega minúscula pi', exact: true }).click();
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await page.waitForTimeout(300);
  await editor.click();
  await page.keyboard.press('Control+Shift+Space');
  await page.keyboard.type('x');
  const txt = await editor.innerText();
  assert.ok(txt.includes('©π'), JSON.stringify(txt));
  assert.ok(txt.includes(' x'), 'espacio de no separación');
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
