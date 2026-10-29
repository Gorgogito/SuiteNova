// End-to-end checks for comments, tracked changes and protection in Nova Writer. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-review.mjs [--shots dir]
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
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.nw-doc');
await page.waitForTimeout(500);
const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = () => page.waitForTimeout(500);
const text = () => ev(() => window.__novaWriter.ctl.text());
const fresh = async (t) => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await settle();
  await page.locator('.nw-doc').click();
  await page.keyboard.type(t);
};
const tab = (n) => page.getByRole('tab', { name: n, exact: true }).click();
const html = () => ev(() => window.__novaWriter.ctl.mainView.dom.innerHTML);
// arrows move the browser caret; ProseMirror learns it from selectionchange, which can arrive after the next key
const syncSel = () =>
  page.waitForFunction(() => {
    const v = window.__novaWriter.ctl.mainView;
    const s = getSelection();
    return !!s.anchorNode && v.state.selection.head === v.posAtDOM(s.focusNode, s.focusOffset);
  });

await check('comments: add from the ribbon, edit in the pane, reply, resolve, delete', async () => {
  await fresh('Primera frase de prueba');
  await page.keyboard.press('Control+Home');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await tab('Revisar');
  await page.getByRole('button', { name: 'Nuevo comentario' }).click();
  await page.locator('.nw-card-edit').fill('Cambiar esta palabra');
  await page.getByRole('button', { name: 'Publicar' }).click();
  await settle();
  assert.equal(await page.locator('.nw-doc .nw-comment').count(), 1);
  assert.equal(await page.locator('.nw-doc .nw-comment').first().innerText(), 'Primera');
  assert.equal(await page.locator('.nw-card-text').first().innerText(), 'Cambiar esta palabra');
  await shot('comment');
  // reply
  await page.locator('.nw-thread').first().click();
  await page.locator('.nw-reply-input').fill('De acuerdo');
  await page.locator('.nw-reply-input').press('Enter');
  assert.equal(await page.locator('.nw-reply .nw-card-text').count(), 1);
  // resolve
  await page.getByRole('button', { name: 'Resolver' }).click();
  assert.ok((await page.locator('.nw-thread.is-done').count()) === 1);
  await page.getByRole('button', { name: 'Reabrir' }).click();
  const n = await ev(() => window.__novaWriter.ctl.comments.length);
  assert.equal(n, 2);
  // delete the thread: anchor and data go away
  await page.getByRole('button', { name: 'Eliminar', exact: true }).first().click();
  assert.equal(await page.locator('.nw-doc .nw-comment').count(), 0);
  assert.equal(await ev(() => window.__novaWriter.ctl.comments.length), 0);
});

await check('comments survive a .docx round trip with their anchor and replies', async () => {
  await fresh('Texto con comentario');
  await page.keyboard.press('Control+Home');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await tab('Revisar');
  await page.getByRole('button', { name: 'Nuevo comentario' }).click();
  await page.locator('.nw-card-edit').fill('Nota uno');
  await page.getByRole('button', { name: 'Publicar' }).click();
  await ev(() => { const c = window.__novaWriter.ctl; c.replyTo(c.comments[0].id, 'Respuesta'); });
  const back = await ev(async () => {
    const { docx, ctl } = window.__novaWriter;
    const w = await docx.writeDocx(ctl.toWriterDoc());
    const r = await docx.readDocx(w.data);
    return { comments: r.doc.comments.map((c) => [c.text, !!c.parent]), marks: JSON.stringify(r.doc.body.toJSON()).includes('"comment"') };
  });
  assert.deepEqual(back.comments.map((c) => c[0]).sort(), ['Nota uno', 'Respuesta']);
  assert.equal(back.marks, true);
});

await check('track changes: typing and deleting leave marks; accept all and reject all', async () => {
  await fresh('Hola mundo');
  await tab('Revisar');
  await page.getByRole('button', { name: 'Control de cambios' }).click();
  await page.locator('.nw-doc').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' feliz');
  for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace'); // our own insertion: removed for real
  assert.equal(await page.locator('.nw-doc ins.nw-ins').count(), 0);
  await page.keyboard.type(' nuevo');
  assert.equal(await page.locator('.nw-doc ins.nw-ins').first().innerText(), ' nuevo');
  // delete the word "mundo" (original text): it stays, struck through
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await syncSel();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Delete');
  assert.ok((await page.locator('.nw-doc del.nw-del').count()) >= 1);
  const marked = await text();
  assert.ok(marked.includes('Hola mundo'), marked);
  await shot('track-changes');
  await page.getByRole('button', { name: 'Panel de revisiones' }).click();
  assert.ok((await page.locator('.nw-review .nw-thread').count()) >= 2);
  await shot('revisions-pane');
  // reject all returns the original; accept all keeps the edits
  const before = await ev(() => window.__novaWriter.ctl.body.toJSON());
  await page.getByRole('button', { name: 'Rechazar todos los cambios' }).click();
  assert.equal(await text(), 'Hola mundo');
  await ev((json) => { const v = window.__novaWriter.ctl.mainView; v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, v.state.schema.nodeFromJSON(json).content).setMeta('nw-no-track', true)); }, before);
  await settle();
  await page.getByRole('button', { name: 'Aceptar todos los cambios' }).click();
  const accepted = await text();
  assert.ok(accepted.includes(' nuevo') && !accepted.includes('mundo') || accepted.includes('Hola'), accepted);
  assert.equal(await ev(() => window.__novaWriter.ctl.mainView.dom.querySelectorAll('ins.nw-ins, del.nw-del').length), 0);
  await page.getByRole('button', { name: 'Control de cambios' }).click();
});

await check('markup views: simple hides the deleted text, original shows what it was', async () => {
  await fresh('uno dos tres');
  await tab('Revisar');
  await page.getByRole('button', { name: 'Control de cambios' }).click();
  await page.locator('.nw-doc').click();
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Delete');
    await page.waitForTimeout(80);
  }
  await page.keyboard.type('2');
  const vis = (sel) => ev((s) => [...document.querySelectorAll(s)].some((e) => getComputedStyle(e).display !== 'none'), sel);
  assert.equal(await vis('.nw-doc del.nw-del'), true);
  await page.locator('[data-nv-item="markupMenu"]').click();
  await page.getByRole('menuitem', { name: 'Marcas simples' }).click();
  assert.equal(await vis('.nw-doc del.nw-del'), false);
  assert.equal(await vis('.nw-doc ins.nw-ins'), true);
  await page.locator('[data-nv-item="markupMenu"]').click();
  await page.getByRole('menuitem', { name: 'Original' }).click();
  assert.equal(await vis('.nw-doc ins.nw-ins'), false);
  assert.equal(await vis('.nw-doc del.nw-del'), true);
  await page.locator('[data-nv-item="markupMenu"]').click();
  await page.getByRole('menuitem', { name: 'Todas las marcas' }).click();
  await page.getByRole('button', { name: 'Control de cambios' }).click();
});

await check('protection: read only blocks typing, the password is needed to stop it', async () => {
  await fresh('Documento protegido');
  await tab('Revisar');
  await page.getByRole('button', { name: 'Proteger' }).click();
  await page.getByRole('button', { name: 'Restringir edición…' }).click();
  await page.locator('#nw-prot-pw').fill('clave');
  await page.locator('#nw-prot-pw2').fill('clave');
  await page.getByRole('button', { name: 'Sí, aplicar la protección' }).click();
  await settle();
  const t0 = await text();
  await page.locator('.nw-doc').click();
  await page.keyboard.type('xxx');
  assert.equal(await text(), t0);
  await page.getByRole('button', { name: 'Proteger' }).click();
  await page.getByRole('button', { name: 'Detener la protección…' }).click();
  await page.locator('#nw-unprot-pw').fill('mala');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  assert.equal(await page.getByRole('alert').count(), 1);
  await page.locator('#nw-unprot-pw').fill('clave');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await settle();
  await page.locator('.nw-doc').click();
  await page.keyboard.type('!');
  assert.ok((await text()).endsWith('!'));
});

await check('no console errors', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
