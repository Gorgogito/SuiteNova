// End-to-end checks for Read Aloud in Nova Slides with the real voices of Windows: the slides are read from the open one on (announced, title first), the
// slide being read is shown and its object selected, the bar shows the sentence with the word marked, the notes can be read, and the reading stops
// when the text changes. Needs `pnpm dev` on :1420.   Usage: node scripts/e2e-slides-voice.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=slides';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 2400, height: 950 } })).newPage();
page.setDefaultTimeout(90000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__novaSlides, null, { timeout: 60000 });
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
const pieces = () => ev(() => { const r = window.__novaSlides.ctl.readAloud.voice.reader; return r.pieces.map((u, i) => r.blockOf(i).text.slice(u.start, u.end)); });

// a deck of two slides: the first has a body before the title (the title is read first), the second has a table; both have notes
await ev(async () => {
  const core = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/slides-core/src/index.ts');
  const c = window.__novaSlides.ctl;
  const deck = core.newDeck();
  const s0 = deck.slides[0];
  const doc = (paras) => core.makeDoc(paras.map((text) => ({ text }))).toJSON();
  const shapes = s0.shapes.filter((e) => e.kind === 'shape' && e.text);
  const title = shapes.find((e) => e.ph && /title/i.test(e.ph.type)) ?? shapes[0];
  const body = shapes.find((e) => e !== title) ?? shapes[0];
  s0.shapes = [
    { ...body, id: 'cuerpo1', text: { ...(body.text ?? { body: {} }), doc: doc(['Primer punto de la lista.', 'Segundo punto de la lista.']) } },
    { ...title, id: 'titulo1', text: { ...(title.text ?? { body: {} }), doc: doc(['Título de la primera']) } },
  ];
  s0.notes = { body: {}, doc: doc(['Nota de la primera diapositiva.']) };
  const s1 = { ...JSON.parse(JSON.stringify(s0)), id: core.newId('s') };
  s1.shapes = [{ ...s1.shapes[1], id: 'titulo2', text: { ...s1.shapes[1].text, doc: doc(['Título de la segunda']) } }];
  s1.notes = { body: {}, doc: doc(['Nota de la segunda.']) };
  deck.slides.push(s1);
  c.load(deck, 'prueba.pptx', null);
});

await check('Ctrl+Alt+Espacio lee desde la diapositiva abierta: la anuncia, el título primero y luego el resto', async () => {
  await ev(() => window.__novaSlides.ctl.goTo(0));
  await page.keyboard.press('Escape');
  await ev(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+Alt+Space');
  await bar().waitFor();
  const p = await pieces();
  assert.deepEqual(p.slice(0, 5), ['Diapositiva 1.', 'Título de la primera', 'Primer punto de la lista.', 'Segundo punto de la lista.', 'Diapositiva 2.']);
  assert.equal(p.length, 6, p.join(' | '));
  assert.equal(await bar().getByText('No hay una voz instalada').count(), 0);
});

await check('mientras lee, muestra la diapositiva que lee, elige el objeto y la barra marca la palabra', async () => {
  await page.waitForFunction(() => window.__novaSlides.ctl.selection.includes('titulo1'), null, { timeout: 30000 });
  const text = page.getByTestId('nv-voicebar-text');
  const words = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && words.size < 2) {
    const w = await text.locator('mark').first().innerText().catch(() => '');
    if (w) words.add(w);
    await page.waitForTimeout(120);
  }
  assert.ok(words.size >= 1, 'palabra marcada en la barra');
  // it goes on to the second slide
  await page.waitForFunction(() => window.__novaSlides.ctl.index === 1, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__novaSlides.ctl.selection.includes('titulo2'), null, { timeout: 30000 });
  await shot('leyendo');
});

await check('al terminar, la barra queda lista y se cierra con ✕ deteniendo la voz', async () => {
  await ev(() => window.__novaSlides.ctl.readAloud.stop());
  await bar().waitFor({ state: 'detached' });
  assert.equal(await ev(() => window.speechSynthesis.speaking), false);
});

await check('«Leer las notas en voz alta» lee solo las notas y las muestra', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.showNotes = false; c.goTo(0); c.touch(); });
  await ev(() => window.__novaSlides.ctl.readAloud.start(true));
  await bar().waitFor();
  assert.deepEqual(await pieces(), ['Notas de la diapositiva 1.', 'Nota de la primera diapositiva.', 'Notas de la diapositiva 2.', 'Nota de la segunda.']);
  await page.waitForFunction(() => window.__novaSlides.ctl.showNotes === true);
  await ev(() => window.__novaSlides.ctl.readAloud.stop());
});

await check('«Incluir las notas al leer» añade las notas tras el texto de cada diapositiva', async () => {
  await ev(() => { window.__novaSlides.ctl.readAloud.withNotes = true; window.__novaSlides.ctl.goTo(0); });
  await ev(() => window.__novaSlides.ctl.readAloud.start());
  await bar().waitFor();
  const p = await pieces();
  assert.ok(p.includes('Notas.') && p.includes('Nota de la primera diapositiva.') && p.indexOf('Notas.') > p.indexOf('Segundo punto de la lista.'), p.join(' | '));
  await ev(() => { window.__novaSlides.ctl.readAloud.stop(); window.__novaSlides.ctl.readAloud.withNotes = false; });
});

await check('si el texto cambia mientras se lee, la lectura se detiene sola', async () => {
  await ev(() => { window.__novaSlides.ctl.goTo(0); window.__novaSlides.ctl.readAloud.start(); });
  await bar().waitFor();
  await ev(async () => {
    const core = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/slides-core/src/index.ts');
    const c = window.__novaSlides.ctl;
    c.apply('cambio', (d) => ({ ...d, slides: d.slides.map((s, i) => (i === 0 ? { ...s, shapes: s.shapes.map((e) => (e.id === 'titulo1' ? { ...e, text: { ...e.text, doc: core.makeDoc([{ text: 'Otro título' }]).toJSON() } } : e)) } : s)) }));
  });
  await bar().waitFor({ state: 'detached' });
  assert.equal(await ev(() => window.speechSynthesis.speaking), false);
});

await check('en la cinta, Revisar › Voz tiene los comandos', async () => {
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  const names = await page.getByRole('button').evaluateAll((l) => l.map((b) => b.getAttribute('aria-label') ?? b.textContent).filter(Boolean));
  assert.ok(names.some((n) => /Leer en voz alta/.test(n)), 'botón «Leer en voz alta»');
});

await check('un texto marcado en otro idioma se lee con una voz de ese idioma', async () => {
  await ev(async () => {
    const core = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/slides-core/src/index.ts');
    const c = window.__novaSlides.ctl;
    c.apply('idioma', (d) => ({ ...d, slides: d.slides.map((s, i) => (i === 0 ? { ...s, shapes: s.shapes.map((e) => (e.id === 'cuerpo1' ? { ...e, text: { ...e.text, doc: core.makeDoc([{ runs: [{ text: 'Texto en español. ' }, { text: 'Text in English.', r: { lang: 'en-US' } }] }]).toJSON() } } : e)) } : s)) }));
    c.goTo(0);
    c.readAloud.start();
  });
  await bar().waitFor();
  const info = await ev(() => { const r = window.__novaSlides.ctl.readAloud.voice.reader; return r.pieces.map((u, i) => [r.blockOf(i).text.slice(u.start, u.end), u.lang]); });
  const en = info.find((x) => x[0] === 'Text in English.');
  assert.ok(en && en[1] === 'en-US', JSON.stringify(info));
  assert.ok(info.some((x) => /^Texto en español/.test(x[0]) && x[1] === 'es-ES'));
  await ev(() => window.__novaSlides.ctl.readAloud.stop());
});

await check('si se abre otra presentación mientras se lee, la lectura se detiene', async () => {
  await ev(() => { window.__novaSlides.ctl.goTo(0); window.__novaSlides.ctl.readAloud.start(); });
  await bar().waitFor();
  await ev(async () => {
    const core = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/slides-core/src/index.ts');
    window.__novaSlides.ctl.load(core.newDeck(), 'otra.pptx', null);
  });
  await bar().waitFor({ state: 'detached' });
  assert.equal(await ev(() => window.speechSynthesis.speaking), false);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
