// End-to-end checks for Read Aloud in Nova Mail with the real voices of Windows: the open message is read (sender, subject and body), the sentence and
// the word are marked on the message, and the reading stops when another message is opened. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-mail-voice.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=mail';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 2400, height: 950 } })).newPage();
page.setDefaultTimeout(90000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__novaMail, null, { timeout: 60000 });
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
const bar = () => page.getByRole('toolbar', { name: 'Leer en voz alta' });
const html = '<html><body><p>Hola equipo. Les escribo para confirmar la reunión.</p><p>Nos vemos mañana a las diez en la sala grande.</p><ul><li>Traer el informe</li></ul></body></html>';
const raw = (subject, from) =>
  [`From: ${from} <ana@x.org>`, 'To: yo@x.org', `Subject: ${subject}`, 'Date: Fri, 20 Nov 2026 10:00:00 +0000', 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', html].join('\r\n');
const importMsg = (r) => ev((r) => window.__novaMail.ctl.importRaw(r, 'inbox', { read: true }).id, r);
const select = (id) => ev((id) => window.__novaMail.ctl.select(id), id);
const piece = () => ev(() => { const r = window.__novaMail.ctl.readAloud.voice.reader; const s = r.snapshot; return { state: s.state, text: s.index >= 0 ? r.blockOf(s.index)?.text.slice(s.piece.start, s.piece.end) : null }; });
const mark = (name) => ev((name) => { const w = document.querySelector('iframe.ml-frame')?.contentWindow; const h = w?.CSS?.highlights?.get(name); const r = h ? [...h][0] : null; return r ? r.toString() : null; }, name);

let a, b;
await check('Ctrl+Alt+Espacio lee el mensaje abierto: primero quién lo envía y el asunto, luego el texto', async () => {
  a = await importMsg(raw('Confirmación de reunión', 'Ana Pérez'));
  b = await importMsg(raw('Otro asunto', 'Luis Gómez'));
  await select(a);
  await page.waitForSelector('iframe.ml-frame');
  await page.waitForTimeout(600);
  await page.getByRole('tab', { name: 'Vista', exact: true }).click();
  await page.getByRole('button', { name: 'Leer en voz alta', exact: true }).first().click();
  await bar().waitFor();
  assert.equal((await piece()).state, 'playing');
  assert.match((await piece()).text, /^Mensaje de Ana Pérez/);
  const texts = await ev(() => { const r = window.__novaMail.ctl.readAloud.voice.reader; return r.pieces.map((u, i) => r.blockOf(i).text.slice(u.start, u.end)); });
  assert.match(texts[1], /^Asunto: Confirmación de reunión/);
  assert.ok(texts.some((t) => /Hola equipo\./.test(t)) && texts.some((t) => /Traer el informe/.test(t)), texts.join(' | '));
  assert.equal(await bar().getByText('No hay una voz instalada').count(), 0);
  await shot('leyendo');
});

await check('la frase y la palabra que suenan se marcan sobre el mensaje', async () => {
  await page.waitForFunction(() => window.__novaMail.ctl.readAloud.voice.snapshot.block >= 2, null, { timeout: 40000 });
  const words = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && words.size < 3) {
    const w = await mark('nv-word');
    if (w) words.add(w.replace(/[.,]/g, ''));
    await page.waitForTimeout(150);
  }
  assert.ok(words.size >= 2, `palabras marcadas: ${[...words].join(', ')}`);
  const sentence = await mark('nv-piece');
  assert.ok(sentence && /[a-zé]/.test(sentence), `frase marcada: ${sentence}`);
  for (const w of words) assert.match('Hola equipo Les escribo para confirmar la reunión Nos vemos mañana a las diez en la sala grande Traer el informe', new RegExp(w));
});

await check('pausa, continuar y velocidad desde la barra', async () => {
  await bar().getByRole('button', { name: 'Pausa' }).click();
  assert.equal((await piece()).state, 'paused');
  await bar().getByRole('button', { name: 'Reproducir' }).click();
  assert.equal((await piece()).state, 'playing');
  await bar().getByLabel('Velocidad de lectura').selectOption('1.5');
  assert.equal(await ev(() => window.__novaMail.ctl.readAloud.voice.snapshot.rate), 1.5);
});

await check('al abrir otro mensaje la lectura se detiene y se quitan las marcas', async () => {
  await select(b);
  await bar().waitFor({ state: 'detached' });
  assert.equal(await ev(() => window.speechSynthesis.speaking), false);
  assert.equal(await mark('nv-word'), null);
});

await check('con el mensaje abierto otra vez, cerrar la barra detiene la voz', async () => {
  await select(a);
  await page.waitForTimeout(600);
  await ev(() => window.__novaMail.ctl.readAloud.start());
  await bar().waitFor();
  await bar().getByRole('button', { name: 'Cerrar la lectura' }).click();
  await bar().waitFor({ state: 'detached' });
  assert.equal(await ev(() => window.speechSynthesis.speaking), false);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
