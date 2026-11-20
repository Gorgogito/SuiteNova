// End-to-end checks for the comments of Nova Writer on the shared comments pane: new comment, reply with a mention, resolve, filters, edit, delete,
// previous/next and the .docx. Needs `pnpm dev` on :1420.  Usage: node scripts/e2e-writer-comments.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from '../packages/writer-core/node_modules/jszip/lib/index.js';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => (errors.push(`dialog: ${d.message()}`), d.dismiss().catch(() => {})));
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
const wait = (ms = 250) => page.waitForTimeout(ms);
const comments = () => ev(() => window.__novaWriter.ctl.comments.map((c) => ({ ...c })));
const marks = () => ev(() => { let n = 0; window.__novaWriter.ctl.body.descendants((x) => { if (x.marks.some((m) => m.type.name === 'comment')) n++; }); return n; });
const pane = () => page.getByRole('complementary', { name: 'Revisión' });
const thread = (i) => pane().getByRole('listitem').nth(i);
const select = (from, to) => ev(([a, b]) => { const { ctl } = window.__novaWriter; const v = ctl.mainView; const S = v.state.selection.constructor; v.dispatch(v.state.tr.setSelection(S.create(v.state.doc, a, b))); v.focus(); }, [from, to]);

// the person writing
await ev(() => localStorage.setItem('nova.user', JSON.stringify({ name: 'Ana María', initials: 'AM' })));
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await wait(500);
await page.locator('.ProseMirror').first().click();
await page.keyboard.type('Primera frase del informe. Segunda frase con cifras. Tercera frase final.');
await wait();

await check('nuevo comentario: se escribe en el panel y se publica con el nombre guardado', async () => {
  await select(1, 8);
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo comentario', exact: true }).click();
  await pane().getByLabel('Texto del comentario').fill('Revisar esta frase');
  await pane().getByRole('button', { name: 'Publicar' }).click();
  await wait();
  const c = await comments();
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].author, c[0].initials, c[0].text, c[0].done], ['Ana María', 'AM', 'Revisar esta frase', false]);
  assert.equal(c[0].edited, undefined, 'el primer texto no es una edición');
  assert.equal(await marks() > 0, true);
  assert.match(await thread(0).textContent(), /Revisar esta frase/);
  await shot('nuevo');
});

await check('el comentario cita el texto al que está unido', async () => {
  assert.match(await thread(0).locator('.nv-cm-anchor').textContent(), /Primer/);
});

await check('una respuesta con @mención: la lista ofrece a la persona y el texto la marca', async () => {
  // someone else wrote too, so there is someone to mention
  await ev(() => { const c = window.__novaWriter.ctl; c.comments = [...c.comments, { id: 'otro1', author: 'Luis Torres', initials: 'LT', date: new Date().toISOString(), text: 'Estoy de acuerdo', parent: c.comments[0].id, done: false }]; c.touch(); });
  await wait();
  await thread(0).click();
  const box = pane().getByLabel('Responder');
  await box.fill('Gracias @lu');
  await pane().getByRole('listbox', { name: 'Personas' }).getByRole('option', { name: /Luis Torres/ }).waitFor();
  await shot('mencion');
  await box.press('Enter'); // completes the name
  assert.match(await box.inputValue(), /@Luis Torres $/);
  await box.type('mira la cifra');
  await box.press('Enter');
  await wait();
  const c = await comments();
  assert.equal(c.at(-1).text, 'Gracias @Luis Torres mira la cifra');
  assert.equal(c.at(-1).parent, c[0].id);
  assert.equal(await pane().locator('mark.nv-cm-mention-mark').count(), 1);
  assert.equal(await pane().locator('mark.nv-cm-mention-mark').textContent(), '@Luis Torres');
});

await check('editar una respuesta propia anota «editado»; no se puede editar la de otro', async () => {
  const mine = thread(0).locator('.nv-cm-msg').last();
  await mine.getByRole('button', { name: 'Editar' }).click();
  const ta = pane().getByLabel('Texto del comentario');
  await ta.fill('Gracias, ya lo miro');
  await pane().getByRole('button', { name: 'Publicar' }).click();
  await wait();
  const c = await comments();
  assert.equal(c.at(-1).text, 'Gracias, ya lo miro');
  assert.ok(c.at(-1).edited);
  assert.match(await thread(0).locator('.nv-cm-msg').last().textContent(), /editado/);
  assert.equal(await thread(0).locator('.nv-cm-msg').nth(1).getByRole('button', { name: 'Editar' }).count(), 0, 'la respuesta de Luis no tiene botón de editar');
});

await check('Escape al editar deja el texto como estaba', async () => {
  await thread(0).locator('.nv-cm-msg').last().getByRole('button', { name: 'Editar' }).click();
  const ta = pane().getByLabel('Texto del comentario');
  await ta.fill('otro texto');
  await ta.press('Escape');
  await wait();
  assert.equal((await comments()).at(-1).text, 'Gracias, ya lo miro');
});

await check('resolver: queda marcado como resuelto, el filtro «Abiertos» lo oculta y responder lo reabre', async () => {
  await thread(0).click();
  await pane().getByRole('button', { name: 'Resolver', exact: true }).click();
  await wait();
  assert.ok((await comments()).every((c) => c.done), 'todo el hilo queda resuelto');
  assert.match(await thread(0).textContent(), /✓ Resuelto/);
  await pane().getByLabel('Estado').selectOption('open');
  assert.match(await pane().textContent(), /Ningún comentario coincide/);
  await pane().getByLabel('Estado').selectOption('resolved');
  assert.equal(await pane().getByRole('listitem').count(), 1);
  await pane().getByLabel('Estado').selectOption('all');
  await thread(0).click();
  await pane().getByLabel('Responder').fill('Una duda más');
  await pane().getByLabel('Responder').press('Enter');
  await wait();
  assert.ok((await comments()).every((c) => !c.done), 'responder reabre');
});

await check('los filtros de persona y de texto', async () => {
  await ev(() => { const c = window.__novaWriter.ctl; c.comments = [...c.comments, { id: 'k2', author: 'Luis Torres', initials: 'LT', date: new Date().toISOString(), text: 'Segundo asunto sobre cifras', parent: null, done: false }]; c.touch(); });
  await wait();
  assert.equal(await pane().getByRole('listitem').count(), 2);
  await pane().getByLabel('Buscar en los comentarios').fill('cifras');
  assert.equal(await pane().getByRole('listitem').count(), 1);
  await pane().getByLabel('Buscar en los comentarios').fill('');
  await pane().getByLabel('Persona').selectOption({ label: 'Luis Torres' });
  assert.equal(await pane().getByRole('listitem').count(), 2, 'Luis escribió en los dos');
  await pane().getByLabel('Persona').selectOption('');
});

await check('anterior y siguiente recorren los comentarios con texto y los seleccionan', async () => {
  await select(30, 36);
  await ev(() => { const { ctl } = window.__novaWriter; const v = ctl.mainView; const S = v.state.selection.constructor; v.dispatch(v.state.tr.addMark(30, 40, v.state.schema.marks.comment.create({ id: 'k2' }))); });
  await wait();
  await page.getByRole('button', { name: 'Comentario anterior' }).first().click();
  await wait();
  const a = await ev(() => window.__novaWriter.ctl.activeComment);
  await page.getByRole('button', { name: 'Siguiente comentario' }).first().click();
  await wait();
  const b = await ev(() => window.__novaWriter.ctl.activeComment);
  assert.notEqual(a, b);
  assert.ok(a && b);
});

await check('todo sobrevive a guardar como .docx y abrirlo de nuevo (respuestas, resuelto, autor)', async () => {
  await ev(() => { const c = window.__novaWriter.ctl; const first = c.comments.find((x) => !x.parent); c.resolveComment(first.id, true); });
  const back = await ev(async () => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    return (await w.docx.readDocx(data)).doc.comments.map((c) => ({ author: c.author, text: c.text, done: c.done, reply: !!c.parent }));
  });
  assert.equal(back.length, 5);
  assert.deepEqual(back.filter((c) => !c.reply).map((c) => [c.author, c.done]), [['Ana María', true], ['Luis Torres', false]]);
  assert.equal(back.filter((c) => c.reply).length, 3);
  assert.ok(back.some((c) => c.text === 'Gracias, ya lo miro'));
});

await check('eliminar una respuesta deja el hilo; eliminar los resueltos quita solo esos y su marca', async () => {
  const before = await comments();
  const reply = thread(0).locator('.nv-cm-msg').last();
  await thread(0).click();
  await reply.getByRole('button', { name: 'Eliminar la respuesta' }).click();
  await wait();
  assert.equal((await comments()).length, before.length - 1);
  const m0 = await marks();
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: 'Eliminar', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Eliminar los comentarios resueltos' }).click();
  await wait();
  const left = await comments();
  assert.deepEqual(left.filter((c) => !c.parent).map((c) => c.id), ['k2']);
  assert.ok((await marks()) < m0, 'la marca del comentario resuelto se quitó del texto');
});

await check('eliminar todos los comentarios desde el panel', async () => {
  await pane().getByRole('button', { name: 'Eliminar todos' }).click();
  await wait();
  assert.equal((await comments()).length, 0);
  assert.equal(await marks(), 0);
  assert.match(await pane().textContent(), /No hay comentarios/);
});

await check('cambios controlados de dos revisores: filtrar por revisor y aceptar solo los de uno', async () => {
  await ev(() => { window.__novaWriter.ctl.trackChanges = true; });
  const end = () => ev(() => { const v = window.__novaWriter.ctl.mainView; const S = v.state.selection.constructor; v.dispatch(v.state.tr.setSelection(S.atEnd(v.state.doc))); v.focus(); });
  await end();
  await page.keyboard.type(' Añadido por Ana.');
  await ev(() => localStorage.setItem('nova.user', JSON.stringify({ name: 'Luis Torres', initials: 'LT' })));
  await end();
  await page.keyboard.type(' Añadido por Luis.');
  await wait();
  await page.getByRole('tab', { name: 'Revisiones' }).click();
  assert.equal(await pane().getByRole('listitem').count(), 2);
  await pane().getByLabel('Revisor').selectOption('Luis Torres');
  assert.equal(await pane().getByRole('listitem').count(), 1);
  await pane().getByRole('button', { name: 'Aceptar los de Luis Torres' }).click();
  await wait();
  assert.equal(await ev(() => { let n = 0; window.__novaWriter.ctl.body.descendants((x) => { if (x.marks.some((m) => m.type.name === 'ins' && m.attrs.author === 'Luis Torres')) n++; }); return n; }), 0, 'lo de Luis ya no está marcado');
  await pane().getByLabel('Revisor').selectOption('');
  assert.equal(await pane().getByRole('listitem').count(), 1, 'queda lo de Ana');
  assert.match(await ev(() => window.__novaWriter.ctl.body.textContent), /Añadido por Luis\./);
});

await check('un cambio de formato controlado: se anota con el formato de antes, sale en Revisiones como «Formato» y rechazarlo lo devuelve', async () => {
  await ev(() => { window.__novaWriter.ctl.trackChanges = true; localStorage.setItem('nova.user', JSON.stringify({ name: 'Ana María', initials: 'AM' })); });
  await select(2, 7);
  await ev(() => { const v = window.__novaWriter.ctl.mainView; v.dispatch(v.state.tr.addMark(2, 7, v.state.schema.marks.strong.create())); });
  await wait();
  await page.getByRole('tab', { name: 'Revisiones' }).click();
  assert.match(await pane().textContent(), /Formato/);
  const hasBold = () => ev(() => { let n = 0; window.__novaWriter.ctl.body.descendants((x) => { if (x.marks.some((m) => m.type.name === 'strong')) n++; }); return n; });
  assert.ok((await hasBold()) > 0);
  const item = pane().getByRole('listitem').filter({ hasText: 'Formato' }).first();
  await item.click();
  await item.getByRole('button', { name: 'Rechazar' }).click();
  await wait();
  assert.equal(await hasBold(), 0, 'rechazar quita la negrita');
  assert.equal(await ev(() => { let n = 0; window.__novaWriter.ctl.body.descendants((x) => { if (x.marks.some((m) => m.type.name === 'fmt')) n++; }); return n; }), 0);
  const bytes = await ev(async () => {
    const v = window.__novaWriter.ctl.mainView;
    v.dispatch(v.state.tr.addMark(2, 7, v.state.schema.marks.em.create()));
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    return [...data];
  });
  const v2 = (await (await JSZip.loadAsync(Buffer.from(bytes))).file('word/document.xml').async('string')).includes('<w:rPrChange ');
  assert.ok(v2, 'el .docx lleva el cambio de formato (rPrChange)');
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
