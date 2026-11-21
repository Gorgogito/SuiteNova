// End-to-end checks for the shared reader (`speech-core`) with the real speech engine of the browser (the voices Windows has installed): it speaks,
// follows the words, pauses and goes on, changes speed, goes next and previous, and stops. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-voice-core.mjs
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
page.setDefaultTimeout(90000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
await page.goto('http://localhost:1420/?app=notes', { waitUntil: 'load' });
await page.waitForSelector('.nn-canvas');

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 8).join(' | ')]);
  }
};

// a reader in the page, and a log of what it reports
await page.evaluate(async () => {
  const core = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/speech-core/src/index.ts');
  const { webSpeech } = await import('/src/voice/webSpeech.ts');
  let voices = webSpeech.voices();
  if (!voices.length) await new Promise((r) => { webSpeech.onVoicesChanged?.(r); setTimeout(r, 3000); });
  const reader = new core.Reader(webSpeech, { lang: 'es-ES' });
  const log = { words: [], states: [], texts: [] };
  reader.subscribe(() => {
    const s = reader.snapshot;
    log.states.push(s.state);
    if (s.word) log.words.push([s.block, s.word.start, s.word.end]);
  });
  window.__v = { core, reader, log };
});
const snap = () => page.evaluate(() => window.__v.reader.snapshot);
const waitState = (state, ms = 60000) => page.waitForFunction((s) => window.__v.reader.snapshot.state === s, state, { timeout: ms });

const BLOCKS = [{ text: 'Esta es la primera frase. Y esta es la segunda.' }, { text: 'Un segundo párrafo breve.' }];

await check('el sistema ofrece voces en español', async () => {
  const voices = await page.evaluate(() => (window.speechSynthesis.getVoices() || []).map((x) => x.lang));
  assert.ok(voices.some((l) => /^es/i.test(l)), `voces: ${voices.join(',')}`);
});

await check('lee todo el texto de principio a fin, pieza a pieza, y termina sola', async () => {
  await page.evaluate((b) => { window.__v.reader.load(b); window.__v.reader.play(); }, BLOCKS);
  assert.equal((await snap()).state, 'playing');
  await waitState('idle');
  const log = await page.evaluate(() => window.__v.log);
  assert.ok(log.states.includes('playing'));
  assert.equal((await snap()).error, '');
});

await check('va marcando las palabras que lee, y están en su sitio del texto escrito', async () => {
  const log = await page.evaluate(() => window.__v.log);
  assert.ok(log.words.length >= 6, `palabras seguidas: ${log.words.length}`);
  for (const [block, s, e] of log.words) {
    const w = BLOCKS[block].text.slice(s, e);
    assert.match(w, /^[\p{L}.]+$/u, `«${w}» en el bloque ${block}`);
  }
  const seen = new Set(log.words.map(([b, s, e]) => BLOCKS[b].text.slice(s, e).replace(/[.,]/g, '').toLowerCase()));
  for (const w of ['primera', 'segunda', 'párrafo']) assert.ok(seen.has(w), `no marcó «${w}»: ${[...seen].join(' ')}`);
});

await check('pausa y continúa desde la palabra donde estaba', async () => {
  await page.evaluate((b) => { window.__v.log.words.length = 0; window.__v.reader.load(b); window.__v.reader.play(); }, [{ text: 'Una frase bastante larga que tarda unos segundos en leerse completa para poder pausarla.' }]);
  await page.waitForFunction(() => window.__v.log.words.length >= 3, null, { timeout: 30000 });
  await page.evaluate(() => window.__v.reader.pause());
  assert.equal((await snap()).state, 'paused');
  const at = await page.evaluate(() => window.__v.log.words.at(-1));
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.__v.log.words.length), (await page.evaluate(() => window.__v.log.words.length)), 'quieta');
  await page.evaluate(() => window.__v.reader.resume());
  assert.equal((await snap()).state, 'playing');
  await page.waitForFunction((n) => window.__v.log.words.length > n, await page.evaluate(() => window.__v.log.words.length), { timeout: 30000 });
  const after = await page.evaluate(() => window.__v.log.words.at(-1));
  assert.ok(after[1] >= at[1], `sigue desde ${at[1]} y va por ${after[1]}`);
  await waitState('idle');
});

await check('cambiar la velocidad se oye al momento, y «siguiente» y «anterior» saltan de frase', async () => {
  await page.evaluate((b) => { window.__v.reader.load(b); window.__v.reader.play(); }, [{ text: 'Primera frase de la prueba. Segunda frase de la prueba. Tercera frase de la prueba.' }]);
  await page.waitForFunction(() => window.__v.reader.snapshot.state === 'playing');
  await page.evaluate(() => window.__v.reader.setRate(2));
  assert.equal((await snap()).rate, 2);
  await page.evaluate(() => window.__v.reader.next());
  assert.equal((await snap()).index, 1);
  await page.evaluate(() => window.__v.reader.next());
  assert.equal((await snap()).index, 2);
  await page.evaluate(() => window.__v.reader.previous());
  assert.ok((await snap()).index >= 1);
  await page.evaluate(() => window.__v.reader.stop());
  assert.equal((await snap()).state, 'idle');
  await page.evaluate(() => window.__v.reader.setRate(1));
});

await check('detener corta lo que suena y no vuelve a empezar solo', async () => {
  await page.evaluate((b) => { window.__v.reader.load(b); window.__v.reader.play(); }, [{ text: 'Un texto algo largo para poder detenerlo antes de que termine de leerse por completo.' }]);
  await page.waitForFunction(() => window.__v.reader.snapshot.state === 'playing');
  await page.evaluate(() => window.__v.reader.stop());
  await page.waitForTimeout(1500);
  assert.equal((await snap()).state, 'idle');
  assert.equal(await page.evaluate(() => window.speechSynthesis.speaking), false);
});

await check('un texto en inglés se lee con una voz en inglés', async () => {
  const voice = await page.evaluate(async () => {
    const out = [];
    const orig = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = (u) => { out.push(u.voice?.lang ?? u.lang); return orig(u); };
    window.__v.reader.load([{ text: 'This is a short sentence.', lang: 'en-US' }]);
    window.__v.reader.play();
    await new Promise((r) => setTimeout(r, 400));
    window.__v.reader.stop();
    window.speechSynthesis.speak = orig;
    return out[0];
  });
  assert.match(voice, /^en/i);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
