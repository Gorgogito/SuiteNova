// End-to-end checks for paragraph styles in Nova Writer: create, modify, apply, delete and keep them in .docx.
// Needs `pnpm dev` on :1420.  Usage: node scripts/e2e-writer-styles.mjs [--shots dir]
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
const dialog = () => page.getByRole('dialog');
const styleOf = () => ev(() => { const c = window.__novaWriter.ctl; let r; c.state.doc.descendants((n) => { if (n.type.name === 'paragraph' && r === undefined) r = n.attrs.style; }); return r; });
const menu = async (group, name) => {
  await page.getByRole('button', { name: group }).first().click();
  await page.getByRole('menuitem', { name: new RegExp('^' + name) }).click();
};
await editor.click();
await page.keyboard.type('Texto del título de prueba');

await check('«Crear un estilo…» toma el formato de la selección y se aplica al párrafo', async () => {
  // formato: negrita, rojo, 18 pt, centrado
  await ev(() => {
    const v = window.__novaWriter.ctl.view;
    const s = v.state.schema;
    let tr = v.state.tr;
    const end = v.state.doc.content.size - 2;
    tr = tr.addMark(2, end, s.marks.strong.create()).addMark(2, end, s.marks.color.create({ value: '#cc0000' })).addMark(2, end, s.marks.fontSize.create({ value: 18 }));
    v.dispatch(tr);
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, 4)));
  });
  await page.getByRole('button', { name: 'Gestionar' }).click();
  await page.getByRole('menuitem', { name: /^Crear un estilo/ }).click();
  await page.waitForTimeout(300);
  await shot('crear-estilo');
  assert.equal(await dialog().locator('#st-size').inputValue(), '18');
  await dialog().locator('#st-name').fill('Aviso rojo');
  await dialog().locator('#st-al').selectOption('center');
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(500);
  assert.equal(await styleOf(), 'Avisorojo');
  const opts = await page.getByLabel('Estilo de párrafo').locator('option').allInnerTexts();
  assert.ok(opts.includes('Aviso rojo'), JSON.stringify(opts));
  const css = await page.locator('.nw-style-Avisorojo').first().evaluate((el) => { const s = getComputedStyle(el); return [s.textAlign, s.fontSize]; });
  assert.deepEqual(css, ['center', '24px']); // 18 pt
});

await check('modificar el estilo cambia todos los párrafos que lo usan', async () => {
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Otro párrafo');
  await ev(() => {
    const c = window.__novaWriter.ctl;
    c.view.dispatch(c.view.state.tr.setNodeMarkup(c.view.state.doc.child(0).child(1).nodeSize > 0 ? 1 + c.view.state.doc.child(0).child(0).nodeSize : 0, undefined, { ...c.view.state.doc.child(0).child(1).attrs, style: 'Avisorojo' }));
  });
  assert.equal(await page.locator('.nw-style-Avisorojo').count(), 2);
  await page.getByRole('button', { name: 'Gestionar' }).click();
  await page.getByRole('menuitem', { name: /^Modificar estilo/ }).click();
  await page.waitForTimeout(300);
  await dialog().getByLabel('Cursiva').check();
  await dialog().locator('#st-sa').fill('30');
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(500);
  const all = await page.locator('.nw-style-Avisorojo').evaluateAll((els) => els.map((el) => [getComputedStyle(el).fontStyle, getComputedStyle(el).marginBottom]));
  assert.deepEqual(all, [['italic', '40px'], ['italic', '40px']]);
  await shot('estilo-modificado');
});

await check('el panel «Estilos…» aplica un integrado, y elimina uno propio devolviendo los párrafos a Normal', async () => {
  await page.getByRole('button', { name: 'Gestionar' }).click();
  await page.getByRole('menuitem', { name: /^Estilos…/ }).click();
  await page.waitForTimeout(300);
  await shot('panel-estilos');
  await dialog().getByRole('option', { name: /Título 2/ }).dblclick();
  await page.waitForTimeout(500);
  assert.equal(await ev(() => window.__novaWriter.ctl.currentStyleId()), 'Heading2'); // se aplica al párrafo del cursor
  await page.getByRole('button', { name: 'Gestionar' }).click();
  await page.getByRole('menuitem', { name: /^Estilos…/ }).click();
  await page.waitForTimeout(300);
  await dialog().getByRole('option', { name: /Aviso rojo/ }).click();
  await dialog().getByRole('button', { name: 'Eliminar' }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.nw-style-Avisorojo').count(), 0);
  assert.equal(await dialog().getByRole('option', { name: /Aviso rojo/ }).count(), 0);
  await dialog().getByRole('button', { name: 'Cerrar' }).click();
  await page.waitForTimeout(500);
});

await check('un estilo propio sobrevive a guardar y volver a leer el .docx', async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await page.waitForTimeout(500);
  await editor.click();
  await page.keyboard.type('hola');
  const out = await ev(async () => {
    const w = window.__novaWriter;
    const c = w.ctl;
    const def = c.addStyle({ id: '', name: 'Mi cita', italic: true, color: '#336699', align: 'right', fontSize: 13 });
    c.view.dispatch(c.view.state.tr.setNodeMarkup(1, undefined, { ...c.view.state.doc.child(0).child(0).attrs, style: def.id }));
    const { data } = await w.docx.writeDocx(c.toWriterDoc());
    const back = await w.docx.readDocx(data);
    const para = back.doc.body.child(0).child(0);
    return { style: para.attrs.style, def: back.doc.styles.find((s) => s.id === def.id) };
  });
  assert.equal(out.style, 'Micita');
  assert.deepEqual({ n: out.def.name, i: out.def.italic, c: out.def.color, a: out.def.align, s: out.def.fontSize }, { n: 'Mi cita', i: true, c: '#336699', a: 'right', s: 13 });
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
