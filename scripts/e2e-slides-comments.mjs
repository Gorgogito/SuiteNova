// End-to-end checks for the comments of Nova Slides on the shared comments pane and the modern .pptx comments. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-slides-comments.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from '../packages/writer-core/node_modules/jszip/lib/index.js';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=slides';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
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
await page.waitForSelector('.sl-surface');
await page.evaluate(() => localStorage.setItem('nova.user', JSON.stringify({ name: 'Ana María', initials: 'AM' })));
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.sl-surface');
await page.waitForTimeout(500);
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms = 250) => page.waitForTimeout(ms);
const comments = () => ev(() => window.__novaSlides.ctl.slide.comments?.map((c) => ({ ...c })) ?? []);
const total = () => ev(() => window.__novaSlides.ctl.deck.slides.reduce((k, s) => k + (s.comments?.length ?? 0), 0));
const pane = () => page.getByRole('complementary', { name: 'Comentarios' });
const thread = (i) => pane().locator('li.nv-cm-thread').nth(i);
const newComment = async () => {
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: 'Comentario nuevo…', exact: true }).click();
};

await check('«Comentario nuevo» abre el panel con la caja para escribir; cancelar sin texto no deja nada', async () => {
  await newComment();
  await pane().getByLabel('Texto del comentario').waitFor();
  assert.equal((await comments()).length, 1, 'el borrador existe mientras se escribe');
  await pane().getByRole('button', { name: 'Cancelar' }).click();
  await wait();
  assert.equal((await comments()).length, 0);
});

await check('publicar: queda con el nombre guardado y una marca en la diapositiva', async () => {
  await newComment();
  await pane().getByLabel('Texto del comentario').fill('Revisar el título');
  await pane().getByRole('button', { name: 'Publicar' }).click();
  await wait();
  const c = await comments();
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].author, c[0].initials, c[0].text, !!c[0].resolved], ['Ana María', 'AM', 'Revisar el título', false]);
  assert.equal(await page.locator('.sl-cmark').count(), 1);
  await shot('publicado');
});

await check('una respuesta con @mención: la lista ofrece a la persona y el texto la marca', async () => {
  await ev(() => {
    const c = window.__novaSlides.ctl;
    c.apply('x', (d) => ({ ...d, slides: d.slides.map((s) => (s.id === c.slide.id ? { ...s, comments: [...s.comments, { id: 'otro', author: 'Luis Torres', initials: 'LT', text: 'Estoy de acuerdo', at: Date.now() + 1000, x: 24, y: 24, replyTo: s.comments[0].id }] } : s)) }));
  });
  await wait();
  await thread(0).click();
  const box = pane().getByLabel('Responder', { exact: true });
  await box.fill('Gracias @lu');
  await pane().getByRole('listbox', { name: 'Personas' }).getByRole('option', { name: /Luis Torres/ }).waitFor();
  await box.press('Enter');
  await box.type('mira el título');
  await box.press('Enter');
  await wait();
  const c = await comments();
  assert.equal(c.at(-1).text, 'Gracias @Luis Torres mira el título');
  assert.equal(c.at(-1).replyTo, c[0].id);
  assert.equal(await pane().locator('mark.nv-cm-mention-mark').count(), 1);
});

await check('resolver: queda resuelto, el filtro lo separa y responder lo reabre', async () => {
  await thread(0).click();
  await pane().getByRole('button', { name: 'Resolver', exact: true }).click();
  await wait();
  assert.equal((await comments())[0].resolved, true);
  await pane().getByLabel('Estado').selectOption('open');
  assert.match(await pane().textContent(), /Ningún comentario coincide/);
  await pane().getByLabel('Estado').selectOption('all');
  await thread(0).click();
  await pane().getByLabel('Responder', { exact: true }).fill('Una duda más');
  await pane().getByLabel('Responder', { exact: true }).press('Enter');
  await wait();
  assert.ok(!(await comments())[0].resolved, 'responder reabre');
});

await check('un comentario en otra diapositiva: «Todas las diapositivas» los junta y elegir uno lleva a su diapositiva', async () => {
  await ev(() => window.__novaSlides.ctl.newSlide());
  await wait();
  await ev(() => window.__novaSlides.ctl.goTo(1));
  await wait();
  await newComment();
  await pane().getByLabel('Texto del comentario').fill('Comentario de la segunda');
  await pane().getByRole('button', { name: 'Publicar' }).click();
  await wait();
  assert.equal(await pane().locator('li.nv-cm-thread').count(), 1, 'solo la de esta diapositiva');
  await pane().getByLabel('Todas las diapositivas').check();
  assert.equal(await pane().locator('li.nv-cm-thread').count(), 2);
  assert.match(await thread(0).textContent(), /Diapositiva 1/);
  await thread(0).click();
  await wait();
  assert.equal(await ev(() => window.__novaSlides.ctl.index), 0);
});

await check('guardar como .pptx escribe comentarios modernos y al abrirlo vuelven con respuestas y «resuelto»', async () => {
  await ev(() => {
    const c = window.__novaSlides.ctl;
    c.goTo(0);
    c.apply('r', (d) => ({ ...d, slides: d.slides.map((s) => (s.id === c.slide.id ? { ...s, comments: s.comments.map((x, i) => (i === 0 ? { ...x, resolved: true } : x)) } : s)) }));
  });
  const bytes = await ev(async () => [...(await window.__novaSlides.write())]);
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const names = Object.keys(zip.files);
  assert.ok(names.includes('ppt/authors.xml'));
  assert.equal(names.filter((n) => /^ppt\/comments\/modernComment_/.test(n)).length, 2, 'una parte por diapositiva con comentarios');
  assert.ok(!names.some((n) => /commentAuthors/.test(n)));
  const back = await ev(async (b) => {
    const m = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/slides-core/src/index.ts');
    const d = (await m.readPptx(Uint8Array.from(b))).deck;
    return d.slides.map((s) => (s.comments ?? []).map((c) => ({ a: c.author, t: c.text, r: !!c.resolved, re: !!c.replyTo })));
  }, bytes);
  assert.equal(back[0].length, 4);
  assert.deepEqual(back[0].map((c) => [c.a, c.re]), [['Ana María', false], ['Ana María', true], ['Luis Torres', true], ['Ana María', true]], 'el comentario y sus tres respuestas, con quién escribió cada una')
  assert.equal(back[0][0].r, true);
  assert.equal(back[1][0].t, 'Comentario de la segunda');
});

await check('deshacer quita lo publicado', async () => {
  const n = await total();
  await ev(() => window.__novaSlides.ctl.goTo(1));
  await pane().getByLabel('Todas las diapositivas').uncheck();
  await newComment();
  await pane().getByLabel('Texto del comentario').fill('Efímero');
  await pane().getByRole('button', { name: 'Publicar' }).click();
  await wait();
  assert.equal(await total(), n + 1);
  await ev(() => window.__novaSlides.ctl.undo());
  assert.equal(await total(), n, 'deshacer quita el comentario entero, no solo el texto');
});

await check('eliminar los resueltos y eliminar todos', async () => {
  await ev(() => window.__novaSlides.ctl.goTo(0));
  await wait();
  await pane().getByLabel('Todas las diapositivas').check();
  await pane().getByRole('button', { name: 'Eliminar los resueltos' }).click();
  await wait();
  assert.deepEqual(await ev(() => window.__novaSlides.ctl.deck.slides.map((s) => (s.comments ?? []).length)), [0, 1]);
  await pane().getByRole('button', { name: 'Eliminar todos' }).click();
  await wait();
  assert.deepEqual(await ev(() => window.__novaSlides.ctl.deck.slides.map((s) => (s.comments ?? []).length)), [0, 0]);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
