// End-to-end checks for Read Aloud in Nova Writer with the real voices of Windows: from the cursor, the bar, the sentence and word shown in the
// document, pause and go on, speed and voice kept, a selection, and stopping when the text changes. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-voice.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1900, height: 950 } })).newPage();
page.setDefaultTimeout(90000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(600);
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
const ev = (fn, arg) => page.evaluate(fn, arg);
const editor = page.locator('.ProseMirror').first();
const bar = page.getByRole('toolbar', { name: 'Leer en voz alta' });
const snap = () => ev(() => window.__novaWriter.ctl.readAloud.voice.snapshot);
const setCursor = (text) =>
  ev((text) => {
    const v = window.__novaWriter.ctl.mainView;
    let pos = null;
    v.state.doc.descendants((n, p) => { if (n.isText && pos === null && n.text.includes(text)) pos = p + n.text.indexOf(text); });
    const { TextSelection } = window.__novaWriter.pm ?? {};
    const sel = v.state.selection.constructor;
    v.dispatch(v.state.tr.setSelection(sel.near ? sel.near(v.state.doc.resolve(pos)) : v.state.selection));
    return pos;
  }, text);

await editor.click();
await page.keyboard.type('Primer párrafo de la prueba. Segunda frase del primer párrafo.');
await page.keyboard.press('Enter');
await page.keyboard.type('Segundo párrafo que se lee después. Con otra frase más.');
await page.keyboard.press('Enter');
await page.keyboard.type('Tercer párrafo final.');

await check('Ctrl+Alt+Espacio lee desde el cursor y muestra la barra', async () => {
  await setCursor('Segundo párrafo');
  await page.keyboard.press('Control+Alt+Space');
  await bar.waitFor();
  const s = await snap();
  assert.equal(s.state, 'playing');
  const first = await ev(() => { const r = window.__novaWriter.ctl.readAloud.voice.reader; return r.blockOf(r.snapshot.index)?.text.slice(r.snapshot.piece.start, r.snapshot.piece.end); });
  assert.match(first, /^Segundo párrafo/);
  assert.equal(await bar.getByText('No hay una voz instalada').count(), 0, 'hay voces en español: no debe avisar');
  await shot('leyendo');
});

await check('la frase y la palabra que suenan se marcan en el documento, en su sitio', async () => {
  await page.waitForSelector('.nw-reading', { timeout: 30000 });
  const piece = (await page.locator('.nw-reading-piece').allInnerTexts()).join('');
  assert.match(piece, /Segundo párrafo/);
  const words = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 12000 && words.size < 3) {
    const w = await page.locator('.nw-reading').first().innerText().catch(() => '');
    if (w) words.add(w.replace(/[.,]/g, ''));
    await page.waitForTimeout(150);
  }
  assert.ok(words.size >= 2, `palabras marcadas: ${[...words].join(', ')}`);
  for (const w of words) assert.match('Segundo párrafo que se lee después. Con otra frase más.', new RegExp(w));
});

await check('pausa y continúa desde la barra, y la velocidad y la voz elegidas se guardan', async () => {
  await bar.getByRole('button', { name: 'Pausa' }).click();
  assert.equal((await snap()).state, 'paused');
  await bar.getByRole('button', { name: 'Reproducir' }).click();
  assert.equal((await snap()).state, 'playing');
  await bar.getByLabel('Velocidad de lectura').selectOption('1.5');
  assert.equal((await snap()).rate, 1.5);
  const names = await bar.getByLabel('Voz de lectura').locator('option').allInnerTexts();
  assert.ok(names.length >= 2, `voces: ${names.join(',')}`);
  await bar.getByLabel('Voz de lectura').selectOption({ index: 1 });
  const saved = await ev(() => JSON.parse(localStorage.getItem('nova.voice')));
  assert.equal(saved.rate, 1.5);
  assert.ok(saved.voices.es, 'la voz del español queda guardada');
  await bar.getByLabel('Velocidad de lectura').selectOption('2');
});

await check('siguiente salta de frase; detener cierra la barra y quita las marcas', async () => {
  const i = (await snap()).index;
  await bar.getByRole('button', { name: 'Voz siguiente' }).click();
  assert.ok((await snap()).index > i || (await snap()).state === 'idle');
  await bar.getByRole('button', { name: 'Cerrar la lectura' }).click();
  await bar.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.nw-reading, .nw-reading-piece').count(), 0);
  assert.equal(await ev(() => window.speechSynthesis.speaking), false);
});

await check('con texto seleccionado lee solo la selección', async () => {
  await ev(() => {
    const v = window.__novaWriter.ctl.mainView;
    let from = null, to = null;
    v.state.doc.descendants((n, p) => { if (n.isText && n.text.includes('Tercer párrafo final.')) { from = p + n.text.indexOf('Tercer'); to = from + 'Tercer párrafo final.'.length; } });
    const S = v.state.selection.constructor;
    v.dispatch(v.state.tr.setSelection(S.create ? S.create(v.state.doc, from, to) : v.state.selection));
  });
  await ev(() => window.__novaWriter.ctl.mainView.focus());
  await page.keyboard.press('Control+Alt+Space');
  await bar.waitFor();
  const text = await ev(() => { const r = window.__novaWriter.ctl.readAloud.voice.reader; return r.pieces.map((u) => r.blockOf(0)?.text.slice(u.start, u.end)).join(' '); });
  assert.equal(text, 'Tercer párrafo final.');
  await ev(() => window.__novaWriter.ctl.readAloud.stop());
});

await check('si el texto cambia mientras se lee, la lectura se detiene sola', async () => {
  await setCursor('Primer párrafo');
  await ev(() => window.__novaWriter.ctl.readAloud.start());
  await bar.waitFor();
  await ev(() => { const v = window.__novaWriter.ctl.mainView; v.dispatch(v.state.tr.insertText('ZZZ', 1)); });
  await bar.waitFor({ state: 'detached' });
  assert.equal(await ev(() => window.speechSynthesis.speaking), false);
});

await check('«Detener la lectura» y la lectura de un documento sin texto no fallan', async () => {
  await ev(() => { const c = window.__novaWriter.ctl; c.newDoc(); c.readAloud.start(); });
  await bar.waitFor();
  assert.equal((await snap()).count, 0);
  assert.match(await bar.innerText(), /Nada que leer/);
  await bar.getByRole('button', { name: 'Cerrar la lectura' }).click();
  await bar.waitFor({ state: 'detached' });
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
