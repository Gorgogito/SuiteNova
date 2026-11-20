// End-to-end checks for the comments of Nova Calc: conversations on the shared pane, notes, converting between them and the .xlsx.
// Needs `pnpm dev` on :1420.  Usage: node scripts/e2e-calc-comments.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=calc';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 900 } })).newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => (errors.push(`dialog: ${d.message()}`), d.dismiss().catch(() => {})));
let step = 0;
const shot = async (name) => {
  if (shotsDir) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
  }
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
await page.waitForSelector('.calc-grid__scroller');
await page.evaluate(() => localStorage.setItem('nova.user', JSON.stringify({ name: 'Ana María', initials: 'AM' })));
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.calc-grid__scroller');
await page.waitForTimeout(500);
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms = 250) => page.waitForTimeout(ms);
const threads = () => ev(() => window.__novaCalc.doc.sheet.threads.map((t) => JSON.parse(JSON.stringify(t))));
const notes = () => ev(() => window.__novaCalc.doc.sheet.comments.map((t) => ({ ...t })));
const select = (r, c) => ev(([a, b]) => window.__novaCalc.doc.selectCell(a, b), [r, c]);
const pane = () => page.getByRole('complementary', { name: 'Comentarios' });
const thread = (i) => pane().locator('li.nv-cm-thread').nth(i);
const review = () => page.getByRole('tab', { name: 'Revisar', exact: true }).click();
const press = (n) => page.getByRole('button', { name: n, exact: true }).first().click();

await check('«Nuevo comentario» abre el panel con la caja; publicar lo guarda con el nombre y la celda', async () => {
  await select(1, 1);
  await review();
  await press('Nuevo comentario');
  await pane().getByLabel('Texto del comentario').fill('Revisar este dato');
  await pane().getByRole('button', { name: 'Publicar' }).click();
  await wait();
  const t = await threads();
  assert.equal(t.length, 1);
  assert.deepEqual([t[0].row, t[0].col, t[0].messages[0].author, t[0].messages[0].initials, t[0].messages[0].text], [1, 1, 'Ana María', 'AM', 'Revisar este dato']);
  assert.match(await thread(0).locator('.nv-cm-anchor').textContent(), /B2/);
  await shot('publicado');
});

await check('cancelar un comentario nuevo sin texto no deja nada, y crear con texto es un solo paso de deshacer', async () => {
  await select(4, 4);
  await press('Nuevo comentario');
  await pane().getByRole('button', { name: 'Cancelar' }).click();
  await wait();
  assert.equal((await threads()).length, 1);
  await press('Nuevo comentario');
  await pane().getByLabel('Texto del comentario').fill('Efímero');
  await pane().getByRole('button', { name: 'Publicar' }).click();
  await wait();
  assert.equal((await threads()).length, 2);
  await ev(() => window.__novaCalc.doc.undo());
  assert.equal((await threads()).length, 1, 'deshacer quita el comentario entero');
  await ev(() => window.__novaCalc.doc.redo());
  assert.equal((await threads()).length, 2);
  await ev(() => window.__novaCalc.doc.undo());
});

await check('una respuesta con @mención y resolver; responder a un resuelto lo reabre', async () => {
  await ev(() => window.__novaCalc.doc.x.changeThreads('x', (l) => l.map((t) => ({ ...t, messages: [...t.messages, { id: 'o1', author: { id: 'local::luis torres', name: 'Luis Torres', initials: 'LT' }, date: new Date().toISOString(), text: 'Estoy de acuerdo' }] }))));
  await wait();
  await select(1, 1);
  await wait();
  const box = pane().getByLabel('Responder', { exact: true });
  await box.fill('Gracias @lu');
  await pane().getByRole('listbox', { name: 'Personas' }).getByRole('option', { name: /Luis Torres/ }).waitFor();
  await box.press('Enter');
  await box.type('mira el dato');
  await box.press('Enter');
  await wait();
  const t = (await threads())[0];
  assert.equal(t.messages.at(-1).text, 'Gracias @Luis Torres mira el dato');
  await pane().getByRole('button', { name: 'Resolver', exact: true }).click();
  await wait();
  assert.equal((await threads())[0].resolved, true);
  await pane().getByLabel('Estado').selectOption('open');
  assert.match(await pane().textContent(), /Ningún comentario coincide/);
  await pane().getByLabel('Estado').selectOption('all');
  await pane().getByLabel('Responder', { exact: true }).fill('Una duda más');
  await pane().getByLabel('Responder', { exact: true }).press('Enter');
  await wait();
  assert.ok(!(await threads())[0].resolved, 'responder reabre');
});

await check('una celda tiene nota o comentario, no los dos: lo que no corresponde está desactivado', async () => {
  await select(1, 1);
  await review();
  assert.equal(await page.getByRole('button', { name: 'Nueva nota', exact: true }).first().isDisabled(), true, 'en una celda con comentario no se puede añadir nota');
  await ev(() => window.__novaCalc.doc.x.saveComment(6, 6, 'Una nota clásica', 'Pablo'));
  await select(6, 6);
  await wait();
  assert.equal(await page.getByRole('button', { name: 'Nuevo comentario', exact: true }).first().isDisabled(), true, 'en una celda con nota no se puede añadir comentario');
});

await check('convertir la nota en comentario y el comentario en nota (las respuestas pasan al texto)', async () => {
  await select(6, 6);
  await ev(() => window.__novaCalc.doc.x.convertToThread());
  await wait();
  assert.equal((await notes()).length, 0);
  const t = (await threads()).find((x) => x.row === 6 && x.col === 6);
  assert.deepEqual([t.messages[0].author, t.messages[0].text], ['Pablo', 'Una nota clásica']);
  await select(1, 1);
  await ev(() => window.__novaCalc.doc.x.convertToNote());
  await wait();
  const n = (await notes()).find((x) => x.row === 1 && x.col === 1);
  assert.equal(n.author, 'Ana María');
  assert.match(n.text, /Revisar este dato\n↳ Luis Torres: Estoy de acuerdo\n↳ Ana María: Gracias @Luis Torres mira el dato/);
  assert.equal((await threads()).some((x) => x.row === 1), false);
  await ev(() => window.__novaCalc.doc.undo());
  assert.equal((await threads()).some((x) => x.row === 1), true, 'deshacer devuelve el comentario');
});

await check('anterior y siguiente pasan de un comentario a otro y seleccionan su celda', async () => {
  await ev(() => { window.__novaCalc.doc.x.changeThreads('x', (l) => l); });
  await select(0, 0);
  await ev(() => window.__novaCalc.doc.x.goToThread(1));
  const a = await ev(() => ({ ...window.__novaCalc.doc.sel.active }));
  await ev(() => window.__novaCalc.doc.x.goToThread(1));
  const b = await ev(() => ({ ...window.__novaCalc.doc.sel.active }));
  assert.deepEqual([a.row, a.col], [1, 1]);
  assert.deepEqual([b.row, b.col], [6, 6]);
});

await check('elegir un comentario del panel selecciona su celda', async () => {
  await select(0, 0);
  await wait();
  await thread(1).click();
  await wait();
  assert.deepEqual(await ev(() => ({ ...window.__novaCalc.doc.sel.active })), { row: 6, col: 6 });
});

await check('el comentario se mueve con su celda al insertar una fila', async () => {
  await ev(() => window.__novaCalc.doc.wb.shiftStructure(window.__novaCalc.doc.activeSheetId, 'row', 0, 2));
  await wait();
  assert.deepEqual((await threads()).map((t) => t.row).sort(), [3, 8]);
  await ev(() => window.__novaCalc.doc.undo());
});

await check('guardar como .xlsx y abrirlo de nuevo conserva las conversaciones, las respuestas y «resuelto»', async () => {
  await ev(() => window.__novaCalc.doc.x.changeThreads('r', (l) => l.map((t) => (t.anchor.row === 6 ? { ...t, resolved: true } : t))));
  const back = await ev(async () => {
    const { writeXlsx, readXlsx } = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/xlsx-io/src/index.ts');
    const d = window.__novaCalc.doc;
    const wb = (await readXlsx(await writeXlsx(d.wb))).workbook;
    const s = wb.sheets[0];
    return { notes: s.comments.length, threads: s.threads.map((t) => ({ row: t.row, col: t.col, resolved: !!t.resolved, texts: t.messages.map((m) => m.text), authors: t.messages.map((m) => m.author) })) };
  });
  assert.equal(back.threads.length, 2);
  const t1 = back.threads.find((t) => t.row === 1);
  assert.equal(t1.texts.length, 4);
  assert.equal(t1.authors[0], 'Ana María');
  assert.equal(back.threads.find((t) => t.row === 6).resolved, true);
});

await check('eliminar los resueltos y eliminar todos desde el panel', async () => {
  await pane().getByRole('button', { name: 'Eliminar los resueltos' }).click();
  await wait();
  assert.deepEqual((await threads()).map((t) => t.row), [1]);
  await pane().getByRole('button', { name: 'Eliminar todos' }).click();
  await wait();
  assert.equal((await threads()).length, 0);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
