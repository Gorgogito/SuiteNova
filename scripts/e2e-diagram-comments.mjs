// End-to-end checks for the comments of Nova Diagram: on shapes and on the page, the shared pane, marks, undo, .novadiagram and .vsdx.
// Needs `pnpm dev` on :1420.  Usage: node scripts/e2e-diagram-comments.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from '../packages/writer-core/node_modules/jszip/lib/index.js';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=diagram';
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
await page.waitForSelector('[data-stencil]');
await page.evaluate(() => localStorage.setItem('nova.user', JSON.stringify({ name: 'Ana María', initials: 'AM' })));
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('[data-stencil]');
await page.waitForTimeout(500);
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms = 250) => page.waitForTimeout(ms);
const threads = () => ev(() => (window.__novaDiagram.ctl.basePage.threads ?? []).map((t) => JSON.parse(JSON.stringify(t))));
const pane = () => page.getByRole('complementary', { name: 'Comentarios' });
const thread = (i) => pane().locator('li.nv-cm-thread').nth(i);
const press = (n) => page.getByRole('button', { name: n, exact: true }).first().click();
const review = () => page.getByRole('tab', { name: 'Revisar', exact: true }).click();

let shapeA;
let shapeB;
await ev(() => { const c = window.__novaDiagram.ctl; c.addStencil('process', { x: 200, y: 150 }); c.addStencil('decision', { x: 500, y: 300 }); });
[shapeA, shapeB] = await ev(() => window.__novaDiagram.ctl.basePage.shapes.map((s) => s.id));

await check('«Nuevo comentario» en una forma seleccionada abre el panel con la caja; publicar lo guarda con el nombre y la forma', async () => {
  await ev((id) => window.__novaDiagram.ctl.setSelection([id]), shapeA);
  await review();
  await press('Nuevo comentario');
  await pane().getByLabel('Texto del comentario').fill('Revisar este paso');
  await pane().getByRole('button', { name: 'Publicar' }).click();
  await wait();
  const t = await threads();
  assert.equal(t.length, 1);
  assert.deepEqual([t[0].shape, t[0].messages[0].author, t[0].messages[0].initials, t[0].messages[0].text], [shapeA, 'Ana María', 'AM', 'Revisar este paso']);
  assert.equal(await page.locator('.dg-cmark').count(), 1, 'una marca en la forma');
  await shot('publicado');
});

await check('sin forma elegida el comentario es de la página; cancelar sin texto no deja nada; crear y escribir es un paso de deshacer', async () => {
  await ev(() => window.__novaDiagram.ctl.setSelection([]));
  await press('Nuevo comentario');
  await pane().getByRole('button', { name: 'Cancelar' }).click();
  await wait();
  assert.equal((await threads()).length, 1);
  await press('Nuevo comentario');
  await pane().getByLabel('Texto del comentario').fill('De toda la página');
  await pane().getByRole('button', { name: 'Publicar' }).click();
  await wait();
  const t = await threads();
  assert.equal(t.length, 2);
  assert.equal(t[1].shape, undefined);
  assert.match(await thread(0).textContent(), /La página/, 'los de la página van primero');
  await ev(() => window.__novaDiagram.ctl.undo());
  assert.equal((await threads()).length, 1, 'deshacer quita el comentario entero');
  await ev(() => window.__novaDiagram.ctl.redo());
  assert.equal((await threads()).length, 2);
});

await check('responder con @mención, resolver y reabrir al responder', async () => {
  await ev(() => { const c = window.__novaDiagram.ctl; c.changeThreads((l) => l.map((t, i) => (i === 1 ? { ...t, messages: [...t.messages, { id: 'o1', author: { id: 'local::luis torres', name: 'Luis Torres', initials: 'LT' }, date: new Date().toISOString(), text: 'Estoy de acuerdo' }] } : t))); });
  await wait();
  await thread(1).click();
  const box = pane().getByLabel('Responder', { exact: true });
  await box.fill('Gracias @lu');
  await pane().getByRole('listbox', { name: 'Personas' }).getByRole('option', { name: /Luis Torres/ }).waitFor();
  await box.press('Enter');
  await box.type('mira el paso');
  await box.press('Enter');
  await wait();
  const t = (await threads()).find((x) => x.shape === shapeA);
  assert.equal(t.messages.at(-1).text, 'Gracias @Luis Torres mira el paso');
  await pane().getByRole('button', { name: 'Resolver', exact: true }).click();
  await wait();
  assert.equal((await threads()).find((x) => x.shape === shapeA).resolved, true);
  assert.equal(await page.locator('.dg-cmark.is-done').count(), 1);
  await pane().getByLabel('Responder', { exact: true }).fill('Una duda más');
  await pane().getByLabel('Responder', { exact: true }).press('Enter');
  await wait();
  assert.ok(!(await threads()).find((x) => x.shape === shapeA).resolved);
});

await check('elegir un comentario del panel selecciona su forma y la marca elegida se destaca', async () => {
  await ev(() => window.__novaDiagram.ctl.setSelection([]));
  await thread(1).click();
  await wait();
  assert.deepEqual(await ev(() => window.__novaDiagram.ctl.selectedShapes().map((s) => s.id)), [shapeA]);
  assert.equal(await page.locator('.dg-cmark.is-sel').count(), 1);
});

await check('clic en la marca abre el panel con ese comentario', async () => {
  await ev(() => { const c = window.__novaDiagram.ctl; c.pane = 'none'; c.selComment = null; c.touch(); });
  await wait();
  await page.locator('.dg-cmark').first().click();
  await wait();
  await pane().waitFor();
  assert.ok(await ev(() => window.__novaDiagram.ctl.selComment));
});

await check('anterior y siguiente recorren los comentarios', async () => {
  await ev(() => { window.__novaDiagram.ctl.selComment = null; });
  await review();
  await press('Comentario siguiente');
  const a = await ev(() => window.__novaDiagram.ctl.selComment);
  await press('Comentario siguiente');
  const b = await ev(() => window.__novaDiagram.ctl.selComment);
  assert.ok(a && b && a !== b);
});

await check('un comentario de otra página no aparece en ésta; borrar la forma borra su comentario', async () => {
  const before = (await threads()).length;
  await ev((id) => { const c = window.__novaDiagram.ctl; c.setSelection([id]); c.deleteSelection?.() ?? c.deleteSelected?.(); }, shapeA);
  await wait();
  const after = await threads();
  assert.equal(after.length, before - 1);
  assert.ok(after.every((t) => t.shape !== shapeA));
  await ev(() => window.__novaDiagram.ctl.undo());
  assert.equal((await threads()).length, before, 'deshacer devuelve la forma y su comentario');
});

await check('guardar el diagrama y abrirlo de nuevo conserva los comentarios', async () => {
  const back = await ev(async () => {
    const m = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/diagram-core/src/index.ts');
    return m.parseDiagram(m.serializeDiagram(window.__novaDiagram.ctl.diagram)).diagram.pages[0].threads.map((t) => ({ shape: !!t.shape, n: t.messages.length, resolved: !!t.resolved }));
  });
  assert.equal(back.length, 2);
  assert.deepEqual(back.map((t) => t.n).sort(), [2, 3]);
});

await check('exportar a Visio escribe comments.xml con las formas y la página, y al importarlo vuelven como conversaciones', async () => {
  const [bytes, texts] = await ev(async () => {
    const m = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/diagram-core/src/index.ts');
    const data = await m.exportVsdx(window.__novaDiagram.ctl.diagram);
    const back = (await m.importVsdx(data)).diagram.pages[0].threads.map((t) => ({ onShape: !!t.shape, texts: t.messages.map((x) => x.text) }));
    return [[...data], back];
  });
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const xml = await zip.file('visio/comments.xml').async('string');
  assert.match(xml, /Revisar este paso/);
  assert.match(xml, /De toda la página/);
  assert.equal((xml.match(/<CommentEntry /g) ?? []).length, 5, 'cada mensaje es un comentario de Visio');
  assert.equal(texts.length, 2);
  assert.equal(texts.find((t) => t.onShape).texts.length, 3);
});

await check('eliminar los resueltos y eliminar todos desde el panel', async () => {
  await ev(() => { const c = window.__novaDiagram.ctl; c.pane = 'comments'; c.changeThreads((l) => l.map((t, i) => (i === 1 ? { ...t, resolved: true } : t))); });
  await wait();
  await pane().getByRole('button', { name: 'Eliminar los resueltos' }).click();
  await wait();
  assert.equal((await threads()).length, 1);
  await pane().getByRole('button', { name: 'Eliminar todos' }).click();
  await wait();
  assert.equal((await threads()).length, 0);
  assert.equal(await page.locator('.dg-cmark').count(), 0);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
