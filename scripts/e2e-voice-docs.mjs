// Read Aloud with big documents and rough use, with the real voices of Windows: how long it takes to start with a long document (Writer), a message with a
// thousand paragraphs (Mail), sixty slides (Slides) and five thousand cells (Calc); a long reading that goes through every sentence without stopping; and
// a hundred commands thrown at the reader (play, pause, next, previous, speed, stop) that must leave it in a sane state. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-voice-docs.mjs
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 2000, height: 950 } });
const errors = [];
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 8).join(' | ')]);
  }
};
const open = async (app, ready) => {
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.on('pageerror', (e) => errors.push(`${app}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED|404/.test(m.text()) && errors.push(`${app}: ${m.text()}`));
  await page.goto(`http://localhost:1420/?app=${app}`, { waitUntil: 'load' });
  await page.waitForFunction(ready, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  return page;
};
const SENT = 'Esta es una frase de prueba con varias palabras para leer en voz alta';

// ---------------------------------------------------------------- Writer: a long document
await check('Writer: un documento de 600 párrafos empieza a leer en menos de 1,5 s desde la mitad y se detiene al instante', async () => {
  const page = await open('writer', () => !!window.__novaWriter);
  const n = await page.evaluate((SENT) => {
    const v = window.__novaWriter.ctl.mainView;
    const p = v.state.schema.nodes.paragraph;
    const paras = Array.from({ length: 600 }, (_x, i) => p.create(null, v.state.schema.text(`Párrafo ${i + 1}. ${SENT}. Y otra frase, con coma, que sigue. ¿Se entiende? Sí.`)));
    v.dispatch(v.state.tr.insert(1, paras));
    return paras.length;
  }, SENT);
  assert.equal(n, 600);
  const t = await page.evaluate(() => {
    const ctl = window.__novaWriter.ctl;
    const v = ctl.mainView;
    let mid = null; let k = 0;
    v.state.doc.descendants((node, pos) => { if (node.isTextblock && ++k === 300) mid = pos + 2; });
    const S = v.state.selection.constructor;
    v.dispatch(v.state.tr.setSelection(S.near(v.state.doc.resolve(mid))));
    const t0 = performance.now();
    ctl.readAloud.start();
    const ms = performance.now() - t0;
    const r = ctl.readAloud.voice.reader;
    const first = r.blockOf(r.snapshot.index).text.slice(0, 12);
    const count = r.snapshot.count;
    const t1 = performance.now();
    ctl.readAloud.stop();
    return { ms, first, count, stop: performance.now() - t1 };
  });
  assert.ok(t.ms < 1500, `empezar tardó ${Math.round(t.ms)} ms`);
  assert.match(t.first, /^Párrafo 30\d/);
  assert.ok(t.count > 2000, `piezas: ${t.count}`);
  assert.ok(t.stop < 300, `detener tardó ${Math.round(t.stop)} ms`);
  await page.close();
});

// ---------------------------------------------------------------- Mail: a message with a thousand paragraphs
await check('Mail: un mensaje con mil párrafos se prepara en menos de 1,5 s', async () => {
  const page = await open('mail', () => !!window.__novaMail);
  const t = await page.evaluate(async (SENT) => {
    const html = '<html><body>' + Array.from({ length: 1000 }, (_x, i) => `<p>Párrafo ${i + 1}. ${SENT}.</p>`).join('') + '</body></html>';
    const raw = ['From: Ana <ana@x.org>', 'To: yo@x.org', 'Subject: Largo', 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', html].join('\r\n');
    const c = window.__novaMail.ctl;
    const id = c.importRaw(raw, 'inbox', { read: true }).id;
    c.select(id);
    await new Promise((r) => setTimeout(r, 1500));
    const t0 = performance.now();
    c.readAloud.start();
    const ms = performance.now() - t0;
    const count = c.readAloud.voice.snapshot.count;
    c.readAloud.stop();
    return { ms, count };
  }, SENT);
  assert.ok(t.ms < 1500, `${Math.round(t.ms)} ms`);
  assert.ok(t.count >= 2000, `piezas: ${t.count}`);
  await page.close();
});

// ---------------------------------------------------------------- Slides: sixty slides
await check('Slides: 60 diapositivas con notas se preparan en menos de 1,5 s', async () => {
  const page = await open('slides', () => !!window.__novaSlides);
  const t = await page.evaluate(async (SENT) => {
    const core = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/slides-core/src/index.ts');
    const c = window.__novaSlides.ctl;
    const deck = core.newDeck();
    const s0 = deck.slides[0];
    const doc = (t) => core.makeDoc([{ text: t }]).toJSON();
    const base = s0.shapes.find((e) => e.kind === 'shape' && e.text);
    deck.slides = Array.from({ length: 60 }, (_x, i) => ({ ...JSON.parse(JSON.stringify(s0)), id: core.newId('s'), shapes: [{ ...base, id: `t${i}`, text: { ...base.text, doc: doc(`Diapositiva con título ${i + 1}. ${SENT}.`) } }], notes: { body: {}, doc: doc(`Nota ${i + 1}. ${SENT}.`) } }));
    c.load(deck, 'grande.pptx', null);
    c.readAloud.withNotes = true;
    const t0 = performance.now();
    c.readAloud.start();
    const ms = performance.now() - t0;
    const count = c.readAloud.voice.snapshot.count;
    c.readAloud.stop();
    c.readAloud.withNotes = false;
    return { ms, count };
  }, SENT);
  assert.ok(t.ms < 1500, `${Math.round(t.ms)} ms`);
  assert.ok(t.count >= 240, `piezas: ${t.count}`);
  await page.close();
});

// ---------------------------------------------------------------- Calc: five thousand cells
await check('Calc: 5000 celdas se preparan en menos de 1,5 s y no pasan del límite', async () => {
  const page = await open('calc', () => !!window.__novaCalc);
  const t = await page.evaluate(() => {
    const d = window.__novaCalc.doc;
    for (let r = 0; r < 1100; r++) for (let c = 0; c < 5; c++) d.wb.setInput(d.activeSheetId, r, c, `Celda ${r + 1}-${c + 1}`);
    d.selectCell(0, 0);
    d.selectCell(1099, 4, { extend: true });
    const t0 = performance.now();
    d.reader.start();
    const ms = performance.now() - t0;
    const count = d.reader.voice.snapshot.count;
    d.reader.stop();
    return { ms, count };
  });
  assert.ok(t.ms < 1500, `${Math.round(t.ms)} ms`);
  assert.equal(t.count, 5000, 'lee hasta 5000 celdas y no más');
  await page.close();
});

// ---------------------------------------------------------------- a long reading and rough use
const noteApp = await open('notes', () => !!window.__novaNotes);
await noteApp.evaluate(async () => {
  const core = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/speech-core/src/index.ts');
  const { webSpeech } = await import('/src/voice/webSpeech.ts');
  let v = webSpeech.voices();
  if (!v.length) await new Promise((r) => { webSpeech.onVoicesChanged?.(r); setTimeout(r, 3000); });
  const reader = new core.Reader(webSpeech, { lang: 'es-ES' });
  const seen = [];
  let last = -2;
  reader.subscribe(() => { const s = reader.snapshot; if (s.state === 'playing' && s.index !== last) { last = s.index; seen.push(s.index); } });
  window.__d = { reader, seen, core };
});

await check('una lectura larga pasa por todas las frases sin detenerse y termina sola', async () => {
  const total = await noteApp.evaluate((SENT) => {
    const r = window.__d.reader;
    r.load(Array.from({ length: 10 }, (_x, i) => ({ text: `${SENT} número ${i + 1}.` })));
    window.__d.seen.length = 0;
    r.setRate(3);
    r.play();
    return r.snapshot.count;
  }, SENT);
  assert.equal(total, 10);
  await noteApp.waitForFunction(() => window.__d.reader.snapshot.state === 'idle', null, { timeout: 120000 });
  const seen = await noteApp.evaluate(() => window.__d.seen);
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await noteApp.evaluate(() => window.__d.reader.setRate(1));
});

await check('cien órdenes seguidas (reproducir, pausa, siguiente, anterior, velocidad, detener) dejan el lector en un estado sano', async () => {
  const r = await noteApp.evaluate(async (SENT) => {
    const rd = window.__d.reader;
    rd.load(Array.from({ length: 30 }, (_x, i) => ({ text: `${SENT} ${i + 1}.` })));
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const ops = [() => rd.play(), () => rd.pause(), () => rd.resume(), () => rd.next(), () => rd.previous(), () => rd.setRate([0.75, 1, 1.5, 2][Math.floor(rnd() * 4)]), () => rd.stop(), () => rd.play(Math.floor(rnd() * 30))];
    const bad = [];
    for (let i = 0; i < 100; i++) {
      try { ops[Math.floor(rnd() * ops.length)](); } catch (e) { bad.push(String(e)); }
      const s = rd.snapshot;
      if (!['idle', 'playing', 'paused'].includes(s.state) || s.index < -1 || s.index >= s.count) bad.push(`estado raro ${JSON.stringify([s.state, s.index])}`);
      await new Promise((res) => setTimeout(res, Math.floor(rnd() * 80)));
    }
    rd.stop();
    await new Promise((res) => setTimeout(res, 700));
    return { bad, state: rd.snapshot.state, speaking: window.speechSynthesis.speaking, pending: window.speechSynthesis.pending };
  }, SENT);
  assert.deepEqual(r.bad, []);
  assert.equal(r.state, 'idle');
  assert.equal(r.speaking, false);
  assert.equal(r.pending, false);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
