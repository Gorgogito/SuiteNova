// End-to-end checks of review tools of Nova Slides: properties, accessibility, compare, reuse slides and zoom.
// Needs `pnpm dev` on :1420.   Usage: node scripts/e2e-slides-review.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=slides';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1900, height: 950 } })).newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => void d.dismiss());
let step = 0;
const shot = async (n) => shotsDir && page.screenshot({ path: `${shotsDir}/rev-${String(++step).padStart(2, '0')}-${n}.png` });
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
    await shot('FAIL-' + name.replace(/\W+/g, '-'));
    for (let i = 0; i < 3 && (await page.locator('[role=dialog]').count()); i++) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(250);
    }
  }
};
const ev = (f, a) => page.evaluate(f, a);
const settle = (ms = 300) => page.waitForTimeout(ms);
const tab = (n) => page.getByRole('tab', { name: n, exact: true }).click();
/** sets the title of slide i */
const setTitle = (i, text) =>
  ev(([i, text]) => {
    const c = window.__novaSlides.ctl;
    const s = c.deck.slides[i];
    const t = s.shapes.find((e) => e.kind === 'shape' && e.ph && /title/i.test(e.ph.type));
    c.goTo(i);
    c.patch([t.id], 'titulo', (e) => ({ ...e, text: { ...e.text, doc: { type: 'doc', content: [{ type: 'paragraph', attrs: { lvl: 0, p: {}, end: {} }, content: [{ type: 'text', text }] }] } } }));
  }, [i, text]);
/** a pptx of the current presentation, as an array of bytes */
const bytes = () => ev(() => window.__novaSlides.write());
const chooseFile = async (button, data) => {
  const fc = page.waitForEvent('filechooser');
  await button.click();
  await (await fc).setFiles({ name: 'otra.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(data) });
};

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.sl-surface');

await check('properties: saved in the file and read back', async () => {
  await tab('Revisar');
  await page.getByRole('button', { name: 'Propiedades…' }).click();
  await settle(400);
  const d = page.getByRole('dialog');
  await d.getByLabel('Título', { exact: true }).fill('Plan & «2026»');
  await d.getByLabel('Autor', { exact: true }).fill('Ana');
  await d.getByLabel('Asunto', { exact: true }).fill('Presupuesto');
  await d.getByLabel('Palabras clave', { exact: true }).fill('uno, dos');
  await d.getByLabel('Categoría', { exact: true }).fill('Informe');
  await shot('properties');
  await d.getByRole('button', { name: 'Aceptar' }).click();
  await settle();
  const b = await bytes();
  await ev((x) => window.__novaSlides.load(x), b);
  await settle(500);
  const p = await ev(() => window.__novaSlides.ctl.realDeck.props);
  assert.deepEqual([p.title, p.author, p.subject, p.keywords, p.category], ['Plan & «2026»', 'Ana', 'Presupuesto', 'uno, dos', 'Informe']);
});

await check('accessibility: lists problems, Ir selects the object, fixing it clears the problem', async () => {
  await ev(() => {
    const c = window.__novaSlides.ctl;
    c.goTo(0);
    window.__novaSlides.ctl.emit('files', [new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (x) => x.charCodeAt(0))], 'x.png', { type: 'image/png' })]);
  });
  await page.waitForFunction(() => window.__novaSlides.ctl.slide.shapes.some((e) => e.kind === 'pic'));
  await ev(() => { const c = window.__novaSlides.ctl; const p = c.slide.shapes.find((e) => e.kind === 'pic'); c.patch([p.id], 'sin alt', (e) => ({ ...e, descr: '' })); c.select([]); });
  await tab('Revisar');
  await page.getByRole('button', { name: 'Comprobar accesibilidad' }).click();
  await settle(500);
  const d = page.getByRole('dialog');
  await shot('accessibility');
  assert.match(await d.innerText(), /Falta el texto alternativo/);
  assert.match(await d.innerText(), /problemas encontrados/);
  await d.getByRole('button', { name: 'Ir' }).first().click();
  await settle(500);
  assert.equal(await page.getByRole('dialog').count(), 0);
  // give the picture a description and check again
  await ev(() => { const c = window.__novaSlides.ctl; const p = c.slide.shapes.find((e) => e.kind === 'pic'); c.patch([p.id], 'alt', (e) => ({ ...e, descr: 'Un punto' })); });
  await page.getByRole('button', { name: 'Comprobar accesibilidad' }).click();
  await settle(500);
  assert.doesNotMatch(await page.getByRole('dialog').innerText(), /Falta el texto alternativo/);
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
});

await check('compare: changed, added and removed slides, marked as comments', async () => {
  // the file: three slides; this presentation: slide 1 edited, slide 3 removed, a new slide added
  await ev(() => { const c = window.__novaSlides.ctl; while (c.deck.slides.length > 1) c.deleteSlides([c.deck.slides[1].id]); c.newSlide(); c.newSlide(); });
  await setTitle(0, 'Introducción al proyecto');
  await setTitle(1, 'Presupuesto 2025');
  await setTitle(2, 'Cierre y gracias');
  const original = await bytes();
  await setTitle(1, 'Presupuesto 2026 revisado');
  await ev(() => { const c = window.__novaSlides.ctl; c.deleteSlides([c.deck.slides[2].id]); c.newSlide(); });
  await setTitle(2, 'Un anexo distinto');
  await tab('Revisar');
  await page.getByRole('button', { name: 'Comparar…' }).click();
  await settle(400);
  await chooseFile(page.getByRole('dialog').getByRole('button', { name: 'Elegir archivo…' }), original);
  await settle(1200);
  const d = page.getByRole('dialog');
  await shot('compare');
  const txt = await d.innerText();
  assert.match(txt, /Cambiada/);
  assert.match(txt, /diferencias/);
  const before = await ev(() => window.__novaSlides.ctl.realDeck.slides.reduce((n, s) => n + (s.comments?.length ?? 0), 0));
  await d.getByRole('button', { name: 'Marcar con comentarios' }).click();
  await settle(500);
  const after = await ev(() => window.__novaSlides.ctl.realDeck.slides.reduce((n, s) => n + (s.comments?.length ?? 0), 0));
  assert.ok(after > before, `${after} comments`);
});

await check('reuse slides: pick two slides of a file, they take the theme of this presentation', async () => {
  const n0 = await ev(() => window.__novaSlides.ctl.realDeck.slides.length);
  const other = await bytes();
  await tab('Insertar');
  await page.getByRole('button', { name: 'Reutilizar diapositivas…' }).click();
  await settle(400);
  await chooseFile(page.getByRole('dialog').getByRole('button', { name: 'Elegir archivo…' }), other);
  await settle(1500);
  await shot('reuse');
  const boxes = page.getByRole('dialog').getByRole('checkbox');
  assert.ok((await boxes.count()) >= 3);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole('dialog').getByRole('button', { name: /^Insertar/ }).click();
  await settle(600);
  assert.equal(await ev(() => window.__novaSlides.ctl.realDeck.slides.length), n0 + 2);
});

await check('zoom: a summary slide with a clickable picture per slide', async () => {
  const n0 = await ev(() => window.__novaSlides.ctl.realDeck.slides.length);
  await tab('Insertar');
  await page.getByRole('button', { name: 'Zoom' }).click();
  await settle(350);
  await page.getByRole('menuitem', { name: /Zoom de resumen/ }).click();
  await settle(500);
  await page.getByRole('dialog').getByRole('button', { name: 'Insertar' }).click();
  await settle(2500);
  assert.equal(await ev(() => window.__novaSlides.ctl.realDeck.slides.length), n0 + 1);
  const links = await ev(() => { const c = window.__novaSlides.ctl; return c.slide.shapes.filter((e) => e.kind === 'pic' && e.hlink?.slide).length; });
  assert.ok(links >= 3, `${links} linked pictures`);
  await shot('zoom');
});

await check('no console errors', async () => assert.deepEqual(errors, []));
await browser.close();
let failed = 0;
for (const [s, n, m] of results) {
  if (s !== 'ok') failed++;
  console.log(`${s === 'ok' ? '✓' : '✗'} ${n}${m ? '\n    ' + m : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
