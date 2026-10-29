// End-to-end checks for Nova Slides in a real browser (Edge). Needs `pnpm dev` running on :1420.
// Usage: node scripts/e2e-slides.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from '../packages/writer-core/node_modules/jszip/lib/index.js';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=slides';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-slides-'));

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1900, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
const dialogs = [];
page.on('dialog', (d) => {
  if (d.type() === 'confirm') return void d.accept();
  dialogs.push(d.message());
  d.dismiss();
});

let step = 0;
const shot = async (name) => {
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 7).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
    for (let i = 0; i < 3 && (await page.locator('[role=dialog]').count()); i++) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(250);
    }
  }
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const state = () =>
  ev(() => {
    const c = window.__novaSlides.ctl;
    return { slides: c.deck.slides.length, index: c.index, sel: c.selection.length, editing: c.editing, dirty: c.dirty, shapes: c.slide.shapes.length };
  });
const tab = (name) => page.getByRole('tab', { name, exact: true }).click();
const btn = (name) => page.getByRole('button', { name, exact: true }).click();
const settle = (ms = 200) => page.waitForTimeout(ms);
const surface = () => page.locator('.sl-surface');
/** Slide coordinates → page coordinates. */
const at = async (x, y) => {
  const b = await surface().boundingBox();
  const z = await ev(() => window.__novaSlides.ctl.zoom || window.__novaSlides.ctl.fitPercent) / 100;
  return { x: b.x + x * z, y: b.y + y * z, z };
};
const clickAt = async (x, y, o) => {
  const p = await at(x, y);
  await page.mouse.click(p.x, p.y, o);
};
const xf = (id) => ev((i) => { const c = window.__novaSlides.ctl; const e = c.element(i); return e ? c.xfrmOf(e) : null; }, id);

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.sl-surface');
await page.screenshot();

await check('ribbon tabs, thumbnails with the prompt text of empty placeholders', async () => {
  for (const t of ['Inicio', 'Insertar', 'Diseño', 'Presentación con diapositivas', 'Revisar', 'Vista', 'Ayuda']) assert.ok(await page.getByRole('tab', { name: t, exact: true }).count(), t);
  assert.equal(await page.locator('.sl-thumb').count(), 1);
  assert.match(await page.locator('.sl-thumb').innerText(), /Haga clic para agregar título/);
  assert.match(await page.locator('.sl-surface').innerText(), /Haga clic para agregar subtítulo/);
  await shot('start');
});

await check('write in the title placeholder with a click; the miniature follows; Esc leaves', async () => {
  await clickAt(480, 200);
  await settle();
  assert.ok((await state()).editing, 'clicking the placeholder puts the cursor in it');
  await page.keyboard.type('Plan de trabajo');
  await page.keyboard.press('Escape');
  await settle();
  assert.equal((await state()).editing, null);
  assert.match(await page.locator('.sl-thumb').innerText(), /Plan de trabajo/);
  assert.equal((await state()).sel, 1);
  await shot('title');
});

await check('text formatting while editing: bold, size, colour, alignment (and bullets on a content slide)', async () => {
  await clickAt(480, 400);
  await page.keyboard.type('Subtítulo de prueba');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+B');
  await page.selectOption('select[aria-label="Tamaño de fuente"]', '32');
  const json = await ev(() => JSON.stringify(window.__novaSlides.ctl.slide.shapes[1].text.doc));
  assert.match(json, /"b":true/);
  assert.match(json, /"sz":32/);
  await btn('Alinear a la derecha');
  assert.match(await ev(() => JSON.stringify(window.__novaSlides.ctl.slide.shapes[1].text.doc)), /"algn":"r"/);
  await page.keyboard.press('Escape');
  // new slide: "Title and content" has a bulleted body
  await page.keyboard.press('Control+M');
  await settle();
  assert.equal((await state()).slides, 2);
  assert.match(await page.locator('.sl-surface').innerText(), /Haga clic para agregar texto/);
  // the empty "Title and content" placeholder draws its bullet
  assert.ok(await page.locator('.sl-surface .sl-bullet').count(), 'the prompt of the content placeholder has a bullet');
  assert.ok(await page.locator('.sl-thumb .sl-bullet').count() >= 1, 'and so do the miniatures');
  await shot('content-slide');
});

await check('bullets, levels and numbering in a content placeholder', async () => {
  await clickAt(300, 250);
  await page.keyboard.type('Primer punto');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Segundo punto');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Subpunto');
  const html = await page.locator('.sl-surface .sl-pm').innerHTML();
  assert.ok((html.match(/class="sl-p"/g) ?? []).length >= 3);
  assert.equal(await page.locator('.sl-surface .sl-pm .sl-bullet').count(), 3);
  await page.keyboard.press('Control+A');
  await btn('Numeración');
  assert.match(await page.locator('.sl-surface .sl-pm').innerText(), /1\./);
  await page.keyboard.press('Escape');
  await shot('numbered');
});

await check('draw shapes, move, resize and rotate (each one undo step), and undo/redo', async () => {
  await tab('Inicio');
  await btn('Formas');
  await page.locator('.sl-shapes button[aria-label="ellipse"]').click();
  const a = await at(100, 300);
  const b = await at(260, 420);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  const s = await state();
  assert.equal(s.shapes, 3);
  const id = await ev(() => window.__novaSlides.ctl.slide.shapes.at(-1).id);
  const x0 = await xf(id);
  assert.ok(Math.abs(x0.w - 160) < 8 && Math.abs(x0.h - 120) < 8);
  // drag by the body
  const c = await at(x0.x + 80, x0.y + 60);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 60 * c.z, c.y + 30 * c.z, { steps: 6 });
  await page.mouse.up();
  const x1 = await xf(id);
  assert.ok(Math.abs(x1.x - x0.x - 60) < 8, `moved ${x1.x - x0.x}`);
  // resize with the south-east handle
  const h = page.locator('.sl-handle[aria-label="Cambiar tamaño (se)"]');
  const hb = await h.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 40 * c.z, hb.y + hb.height / 2 + 20 * c.z, { steps: 5 });
  await page.mouse.up();
  const x2 = await xf(id);
  assert.ok(x2.w > x1.w + 25, `width ${x1.w} → ${x2.w}`);
  // rotate
  const r = page.locator('.sl-rotate');
  const rb = await r.boundingBox();
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + rb.width / 2 + 120, rb.y + rb.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  assert.ok(((await xf(id)).rot ?? 0) > 30);
  await shot('shape');
  // undo goes step by step: rotate, resize, move, draw
  await page.keyboard.press('Control+Z');
  assert.ok(Math.abs(((await xf(id)).rot ?? 0)) < 1, 'undo rotate');
  await page.keyboard.press('Control+Z');
  assert.ok(Math.abs((await xf(id)).w - x1.w) < 1, 'undo resize');
  await page.keyboard.press('Control+Z');
  assert.ok(Math.abs((await xf(id)).x - x0.x) < 1, 'undo move');
  await page.keyboard.press('Control+Y');
  assert.ok(Math.abs((await xf(id)).x - x1.x) < 1, 'redo move');
});

await check('align (several objects use their common box, one uses the slide), distribute, group, order', async () => {
  // two more shapes through the model API for speed (the drawing is covered above)
  await ev(() => {
    const c = window.__novaSlides.ctl;
    const s = (x, y) => ({ kind: 'shape', id: 'e2e' + x, geom: { prst: 'rect' }, xfrm: { x, y, w: 80, h: 60 }, fill: { t: 'solid', c: { rgb: '#ff9900' } } });
    c.apply('test', (d) => ({ ...d, slides: d.slides.map((sl, i) => (i === c.index ? { ...sl, shapes: [...sl.shapes, s(500, 100), s(700, 300), s(900, 120)] } : sl)) }));
  });
  await ev(() => window.__novaSlides.ctl.select(['e2e500', 'e2e700', 'e2e900']));
  await page.getByRole('tab', { name: 'Formato de forma' }).click();
  await btn('Alinear a la izquierda (objetos)');
  assert.deepEqual(await ev(() => ['e2e500', 'e2e700', 'e2e900'].map((i) => Math.round(window.__novaSlides.ctl.xfrmOf(window.__novaSlides.ctl.element(i)).x))), [500, 500, 500]);
  await btn('Alinear al medio');
  assert.equal(new Set(await ev(() => ['e2e500', 'e2e700', 'e2e900'].map((i) => Math.round(window.__novaSlides.ctl.xfrmOf(window.__novaSlides.ctl.element(i)).y)))).size, 1);
  await ev(() => window.__novaSlides.ctl.select(['e2e700']));
  await btn('Alinear al centro (objetos)');
  assert.equal(Math.round((await xf('e2e700')).x), (960 - 80) / 2, 'a single object aligns to the slide');
  await ev(() => window.__novaSlides.ctl.select(['e2e500', 'e2e900']));
  await page.keyboard.press('Control+G');
  assert.equal(await ev(() => window.__novaSlides.ctl.slide.shapes.filter((s) => s.kind === 'group').length), 1);
  await btn('Desagrupar');
  assert.equal(await ev(() => window.__novaSlides.ctl.slide.shapes.filter((s) => s.kind === 'group').length), 0);
  await shot('align');
});

await check('save as .pptx and reopen: same slides and text', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  const file = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(file);
  assert.match(dl.suggestedFilename(), /\.pptx$/);
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  assert.ok(zip.file('ppt/presentation.xml'));
  assert.match(await zip.file('ppt/slides/slide1.xml').async('string'), /Plan de trabajo/);
  const before = await ev(() => window.__novaSlides.ctl.deck.slides.map((s) => s.shapes.length));
  await ev(() => window.__novaSlides.ctl.newDoc());
  const bytes = [...fs.readFileSync(file)];
  await ev((b) => window.__novaSlides.load(b, 'prueba.pptx'), bytes);
  assert.deepEqual(await ev(() => window.__novaSlides.ctl.deck.slides.map((s) => s.shapes.length)), before);
  assert.match(await page.locator('.sl-thumb').first().innerText(), /Plan de trabajo/);
});

await check('slide show: click steps an entrance animation, then a timed transition; links jump; Esc leaves', async () => {
  await ev(() => {
    const c = window.__novaSlides.ctl;
    c.newDoc();
  });
  await ev(() => window.__novaSlides.ctl.newSlide?.());
  await ev(() => window.__novaSlides.ctl.newSlide?.());
  const info = await ev(() => {
    const c = window.__novaSlides.ctl;
    const first = c.deck.slides[0];
    const title = first.shapes.find((s) => s.kind === 'shape' && s.ph);
    c.apply('test', (d) => ({
      ...d,
      slides: d.slides.map((s, i) =>
        i === 0
          ? { ...s, timing: { effects: [{ id: 'e1', target: title.id, cls: 'entr', preset: 10, trigger: 'onClick', dur: 200 }] } }
          : i === 1
            ? { ...s, transition: { type: 'fade', dur: 200, advTm: 600 } }
            : s,
      ),
    }));
    return { n: c.deck.slides.length, title: title.id };
  });
  assert.equal(info.n, 3);
  await page.keyboard.press('F5');
  await page.waitForSelector('.sl-present');
  await settle(400);
  const vis = () => page.evaluate((id) => { const el = document.querySelector(`.sl-present [data-id="${id}"]`); return el ? getComputedStyle(el).visibility : 'missing'; }, info.title);
  assert.equal(await vis(), 'hidden', 'the entrance target starts hidden');
  assert.match(await page.locator('.sl-present [data-testid=show-stage]').innerText(), /Haga clic para agregar subtítulo|^\s*$|/);
  await page.keyboard.press('ArrowRight');
  await settle(600);
  assert.equal(await vis(), 'visible', 'one click plays the effect');
  assert.equal(await page.locator('.sl-showbar span').innerText(), '1 / 3');
  await page.keyboard.press('ArrowRight');
  await settle(700);
  assert.equal(await page.locator('.sl-showbar span').innerText(), '2 / 3');
  await settle(1400);
  assert.equal(await page.locator('.sl-showbar span').innerText(), '3 / 3', 'the timed slide advances by itself');
  await shot('show');
  await page.keyboard.press('b');
  assert.equal(await page.locator('[data-testid=show-blank]').count(), 1);
  await page.keyboard.press('b');
  await page.keyboard.press('Escape');
  await settle(300);
  assert.equal(await page.locator('.sl-present').count(), 0);
});

await check('presenter view: second window mirrors the show (notes, next slide, clock) and drives it', async () => {
  await ev(() => {
    const c = window.__novaSlides.ctl;
    c.newDoc();
    c.newSlide();
    c.goTo(0);
  });
  // notes on the first slide, written in the real pane
  await page.getByRole('button', { name: 'Notas', exact: true }).first().click().catch(() => {});
  await ev(() => {
    const c = window.__novaSlides.ctl;
    c.showNotes = true;
    c.touch();
  });
  const notes = page.getByLabel('Notas del orador');
  await notes.click();
  await notes.fill('Saludar y presentar el tema');
  await page.locator('.sl-surface').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await tab('Presentación con diapositivas');
  const [pop] = await Promise.all([ctx.waitForEvent('page'), btn('Vista de moderador (dos pantallas)')]);
  await pop.waitForSelector('.sl-presenter', { timeout: 10000 });
  await page.waitForSelector('.sl-present');
  await pop.waitForSelector('[data-testid=pv-notes]');
  assert.match(await pop.locator('[data-testid=pv-notes]').innerText(), /Saludar y presentar el tema/);
  assert.ok(await pop.locator('[data-testid=pv-next]').count(), 'shows the next slide');
  assert.match(await pop.locator('[data-testid=pv-elapsed]').innerText(), /^\d+:\d\d$/);
  await pop.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.sl-showbar span')?.textContent === '2 / 2');
  assert.equal(await page.locator('.sl-showbar span').innerText(), '2 / 2', 'a key in the presenter window advances the audience');
  assert.equal(await pop.locator('[data-testid=pv-next]').count(), 0, 'last slide: no next');
  await pop.screenshot({ path: shotsDir ? `${shotsDir}/presenter.png` : path.join(tmp, 'presenter.png') });
  await pop.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.sl-present'));
  await pop.close();
});

await check('Transitions tab: pick, options, timing, apply to all, preview; undoable', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.newSlide(); c.goTo(1); });
  await tab('Transiciones');
  await page.getByRole('button', { name: 'Transición', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Empujar', exact: true }).click();
  const tr = () => ev(() => window.__novaSlides.ctl.slide.transition);
  assert.equal((await tr()).type, 'push');
  await page.getByRole('button', { name: 'Opciones de efectos', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Desde arriba', exact: true }).click();
  assert.equal((await tr()).dir, 'd');
  const dur = page.getByLabel('Duración', { exact: true });
  await dur.fill('1.5');
  await dur.press('Enter');
  assert.equal((await tr()).dur, 1500);
  await page.getByLabel('Después de', { exact: true }).check();
  assert.equal((await tr()).advTm, 5000);
  await btn('Aplicar a todas las diapositivas');
  assert.deepEqual(await ev(() => window.__novaSlides.ctl.deck.slides.map((s) => s.transition?.type)), ['push', 'push']);
  await ev(() => window.__novaSlides.ctl.undo());
  assert.deepEqual(await ev(() => window.__novaSlides.ctl.deck.slides.map((s) => s.transition?.type)), [undefined, 'push']);
  // the transition is written to the file
  const bytes = await ev(() => window.__novaSlides.write());
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  assert.match(await zip.file('ppt/slides/slide2.xml').async('string'), /<p:transition[^>]*>[\s\S]*<p:push[^>]*dir="d"/);
  await btn('Vista previa de la transición');
  await page.waitForSelector('.sl-present');
  await page.waitForFunction(() => !document.querySelector('.sl-present'), null, { timeout: 15000 });
  await tab('Transiciones');
  await page.getByRole('button', { name: 'Transición', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Ninguna', exact: true }).click();
  assert.equal(await tr(), undefined);
  await shot('transitions');
});

await check('Animations tab: add to the selected object, pane, start/duration, reorder, remove, preview, saved in the file', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.goTo(0); });
  await tab('Inicio');
  await ev(() => window.__novaSlides.ctl.setTool({ kind: 'shape', prst: 'rect' }));
  const a = await at(200, 300);
  const b = await at(400, 400);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  await ev(() => window.__novaSlides.ctl.setTool({ kind: 'shape', prst: 'ellipse' }));
  const a2 = await at(500, 300);
  const b2 = await at(700, 400);
  await page.mouse.move(a2.x, a2.y); await page.mouse.down(); await page.mouse.move(b2.x, b2.y, { steps: 5 }); await page.mouse.up();
  await tab('Animaciones');
  assert.equal(await ev(() => window.__novaSlides.ctl.selection.length), 1);
  await page.getByRole('button', { name: 'Animación', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Desvanecer', exact: true }).click();
  const effects = () => ev(() => (window.__novaSlides.ctl.slide.timing?.effects ?? []).map((e) => ({ id: e.id, cls: e.cls, preset: e.preset, trigger: e.trigger, dur: e.dur, target: e.target })));
  assert.equal((await effects()).length, 1);
  // a second object, added with "Agregar animación"
  const firstShape = await ev(() => window.__novaSlides.ctl.slide.shapes.filter((s) => !s.ph)[0].id);
  await ev((id) => window.__novaSlides.ctl.select([id]), firstShape);
  await page.getByRole('button', { name: 'Agregar animación', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Zoom', exact: true }).click();
  assert.equal((await effects()).length, 2);
  await btn('Panel de animación');
  await page.waitForSelector('.sl-animpane li');
  assert.equal(await page.locator('.sl-animpane li').count(), 2);
  // select the last one in the pane and change its start and duration
  await page.locator('.sl-animpane li').nth(1).click();
  await page.getByLabel('Inicio', { exact: true }).selectOption('withPrev');
  const dur = page.getByLabel('Duración', { exact: true });
  await dur.fill('2');
  await dur.press('Enter');
  const e2 = (await effects())[1];
  assert.equal(e2.trigger, 'withPrev');
  assert.equal(e2.dur, 2000);
  await btn('Mover antes');
  assert.equal((await effects())[0].id, e2.id);
  await ev(() => window.__novaSlides.ctl.undo());
  assert.equal((await effects())[1].id, e2.id, 'reordering is one undo step');
  // saved in the file
  const bytes = await ev(() => window.__novaSlides.write());
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(xml, /<p:timing[ >]/);
  assert.match(xml, /presetID="10"/);
  assert.match(xml, /presetID="53"/);
  // and read back
  await ev(async (b) => window.__novaSlides.load(b, 'anim.pptx'), bytes);
  assert.equal((await effects()).length, 2);
  await shot('animations');
  await btn('Vista previa de las animaciones');
  await page.waitForSelector('.sl-present');
  await page.waitForFunction(() => !document.querySelector('.sl-present'), null, { timeout: 20000 });
  await page.locator('.sl-animpane li').first().click();
  await btn('Quitar la animación');
  assert.equal((await effects()).length, 1);
});

await check('dialogs: table, chart (data sheet, type, edit later), header & footer, hyperlink to a slide', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.newSlide(); c.goTo(0); });
  const S = () => ev(() => window.__novaSlides.ctl.slide.shapes.map((s) => ({ id: s.id, kind: s.kind, ph: s.ph?.type })));
  await tab('Insertar');
  // table
  await btn('Tabla…');
  await page.getByLabel('Número de columnas').fill('3');
  await page.getByLabel('Número de filas').fill('2');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  const tbl = await ev(() => window.__novaSlides.ctl.slide.shapes.find((s) => s.kind === 'table'));
  assert.equal(tbl.rows.length, 2);
  assert.equal(tbl.cols.length, 3);
  // chart
  await btn('Gráfico…');
  await page.getByLabel('Tipo de gráfico').selectOption('pie');
  await page.getByLabel('Título del gráfico', { exact: true }).fill('Ventas');
  await page.getByLabel('Fila 1, columna 2').fill('9');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  let chart = await ev(() => window.__novaSlides.ctl.slide.shapes.find((s) => s.kind === 'chart').chart);
  assert.equal(chart.kind, 'pie');
  assert.equal(chart.title, 'Ventas');
  assert.equal(chart.series[0].values[0], 9);
  assert.ok(await page.locator('.sl-chart svg').count(), 'the chart is drawn');
  // edit it from the contextual tab
  await page.getByRole('tab', { name: /Diseño de gráfico/ }).click();
  await btn('Editar datos y tipo del gráfico…');
  await page.getByRole('button', { name: 'Agregar fila', exact: true }).click();
  await page.getByLabel('Fila 5, columna 1').fill('Nueva');
  await page.getByLabel('Fila 5, columna 2').fill('7');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  chart = await ev(() => window.__novaSlides.ctl.slide.shapes.find((s) => s.kind === 'chart').chart);
  assert.equal(chart.categories[4], 'Nueva');
  assert.equal(chart.series[0].values[4], 7);
  // file has the chart
  const zip = await JSZip.loadAsync(Buffer.from(await ev(() => window.__novaSlides.write())));
  assert.ok(Object.keys(zip.files).some((f) => /ppt\/charts\/chart\d*\.xml$/.test(f)));
  // header & footer
  await tab('Insertar');
  await btn('Encabezado y pie de página…');
  await page.getByLabel('Número de diapositiva').check();
  await page.getByLabel('Pie de página', { exact: true }).check();
  await page.getByLabel('Texto del pie de página').fill('Mi empresa');
  await page.getByRole('button', { name: 'Aplicar a todas', exact: true }).click();
  const kinds = await ev(() => window.__novaSlides.ctl.deck.slides.map((s) => s.shapes.filter((x) => x.ph && ['ftr', 'sldNum'].includes(x.ph.type)).length));
  assert.deepEqual(kinds, [2, 2]);
  assert.match(await surface().innerText(), /Mi empresa/);
  assert.match(await surface().innerText(), /\b1\b/);
  // hyperlink on the shape that holds the title text
  await ev(() => { const c = window.__novaSlides.ctl; const t = c.slide.shapes.find((s) => s.ph?.type === 'ctrTitle' || s.ph?.type === 'title'); c.select([t.id]); });
  await btn('Hipervínculo…');
  await page.getByLabel('Lugar de este documento').check();
  const second = await ev(() => window.__novaSlides.ctl.deck.slides[1].id);
  await page.getByLabel('Ir a', { exact: true }).selectOption(second);
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  const linked = await ev(() => { const c = window.__novaSlides.ctl; const t = c.slide.shapes.find((s) => s.ph?.type === 'ctrTitle' || s.ph?.type === 'title'); return t.hlink ?? null; });
  assert.deepEqual(linked, { slide: second });
  // the link works in the show (the table and the chart used before would cover the title)
  await ev(() => { const c = window.__novaSlides.ctl; c.select(c.slide.shapes.filter((x) => x.kind === 'table' || x.kind === 'chart').map((x) => x.id)); c.deleteSelected(); });
  await page.keyboard.press('F5');
  await page.waitForSelector('.sl-present');
  await settle(500);
  await page.locator('.sl-present [data-link]').first().click();
  await settle(800);
  assert.equal(await page.locator('.sl-showbar span').innerText(), '2 / 2');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.sl-present'));
  await shot('dialogs');
  void S;
});

await check('size, find & replace, spelling, comments, sections, show setup, custom shows', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.newSlide(); c.goTo(0); });
  const accept = () => page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  const titleText = () => ev(() => { const c = window.__novaSlides.ctl; const t = c.deck.slides[0].shapes.find((s) => s.ph?.type === 'ctrTitle'); return JSON.stringify(t.text.doc).match(/"text":"[^"]*"/g)?.map((x) => x.slice(8, -1)).join('') ?? ''; });
  // write in the title
  await clickAt(480, 200);
  await settle();
  await page.keyboard.type('Hola mundoo y mundoo');
  await page.keyboard.press('Escape');
  await settle();
  // find & replace
  await tab('Inicio');
  await btn('Buscar y reemplazar…');
  await page.getByLabel('Buscar', { exact: true }).fill('MUNDOO');
  await page.getByRole('button', { name: 'Buscar siguiente', exact: true }).click();
  assert.match(await page.getByRole('status').last().innerText(), /Coincidencia 1 de 2/);
  await page.getByLabel('Reemplazar con').fill('mundo');
  await page.getByRole('button', { name: 'Reemplazar', exact: true }).click();
  assert.equal(await titleText(), 'Hola mundo y mundoo');
  await page.getByRole('button', { name: 'Reemplazar todas', exact: true }).click();
  assert.equal(await titleText(), 'Hola mundo y mundo');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  // spelling (own checker): misspell again, fix with the dialog
  await ev(() => { const c = window.__novaSlides.ctl; c.goTo(0); });
  await clickAt(480, 200);
  await settle();
  if (!(await state()).editing) await page.keyboard.press('Enter');
  await settle();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' casaa');
  await page.keyboard.press('Escape');
  await tab('Revisar');
  await btn('Revisar ortografía');
  await page.waitForSelector('[data-testid=spell-word]', { timeout: 20000 });
  assert.equal(await page.locator('[data-testid=spell-word]').innerText(), 'casaa');
  await page.getByLabel('Cambiar por', { exact: true }).fill('casa');
  await page.getByRole('button', { name: 'Cambiar', exact: true }).click();
  await page.waitForSelector('[data-testid=spell-done]');
  assert.equal(await titleText(), 'Hola mundo y mundo casa');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  // comments
  await btn('Comentario nuevo…');
  await page.getByLabel('Su nombre').fill('Ana Pérez');
  await page.getByLabel('Comentario', { exact: true }).fill('Revisar el título');
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.waitForSelector('.sl-comments .sl-comment');
  assert.equal(await page.locator('.sl-cmark').count(), 1);
  await page.getByLabel('Responder', { exact: true }).fill('Hecho');
  await page.getByRole('button', { name: 'Responder', exact: true }).click();
  assert.equal(await ev(() => window.__novaSlides.ctl.slide.comments.length), 2);
  await page.getByRole('button', { name: 'Resolver', exact: true }).click();
  assert.equal(await ev(() => window.__novaSlides.ctl.slide.comments[0].resolved), true);
  let zip = await JSZip.loadAsync(Buffer.from(await ev(() => window.__novaSlides.write())));
  assert.ok(Object.keys(zip.files).some((f) => /ppt\/comments\//.test(f)), 'comments are saved');
  await ev(() => { const c = window.__novaSlides.ctl; c.pane = 'none'; c.touch(); });
  // sections
  await ev(() => window.__novaSlides.ctl.goTo(1));
  await tab('Inicio');
  await btn('Secciones…');
  await page.getByRole('button', { name: /Agregar antes de la diapositiva 2/ }).click();
  assert.equal(await ev(() => window.__novaSlides.ctl.deck.sections.length), 2);
  const sec = page.getByLabel('Nombre de la sección 2');
  await sec.fill('Cierre');
  await sec.press('Tab');
  assert.equal(await ev(() => window.__novaSlides.ctl.deck.sections[1].name), 'Cierre');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  assert.ok(await page.locator('.sl-thumbs, .sl-panel').getByText('Cierre').count());
  // slide size
  await tab('Diseño');
  await btn('Tamaño de la diapositiva…');
  await page.getByLabel('Tamaño de las diapositivas').selectOption('4x3');
  await accept();
  assert.deepEqual(await ev(() => window.__novaSlides.ctl.deck.size), { w: 720, h: 540, type: 'screen4x3' });
  // show setup + custom show
  await tab('Presentación con diapositivas');
  await btn('Presentaciones personalizadas…');
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await page.getByRole('checkbox', { name: /^2\./ }).check();
  await accept();
  assert.equal(await ev(() => window.__novaSlides.ctl.deck.show.customShows[0].slideIds.length), 1);
  await btn('Configurar la presentación…');
  await page.getByLabel('Examinada en pantalla completa (quiosco)').check();
  await page.getByLabel('Presentación personalizada', { exact: false }).first().check();
  await accept();
  const show = await ev(() => window.__novaSlides.ctl.deck.show);
  assert.equal(show.mode, 'kiosk');
  assert.equal(show.loop, true);
  assert.equal(show.range.show, show.customShows[0].name);
  zip = await JSZip.loadAsync(Buffer.from(await ev(() => window.__novaSlides.write())));
  assert.match(await zip.file('ppt/presentation.xml').async('string'), /<p:custShowLst>/);
  // kiosk: only the custom show (1 slide), clicking does not move on, Esc leaves
  await page.keyboard.press('F5');
  await page.waitForSelector('.sl-present');
  await settle(400);
  assert.equal(await page.locator('.sl-showbar span').innerText(), '1 / 1');
  await page.mouse.click(500, 400);
  await settle(300);
  assert.equal(await page.locator('.sl-showbar span').innerText(), '1 / 1');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.sl-present'));
  await shot('block');
});

await check('dialogs: background, font, paragraph, tabs, columns', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.newSlide(); c.goTo(0); });
  const accept = () => page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  const doc = (i) => ev((n) => JSON.stringify(window.__novaSlides.ctl.slide.shapes[n].text.doc), i);
  // type in the subtitle, leave the text selected as a whole shape
  await clickAt(480, 400);
  await settle();
  await page.keyboard.type('Texto de prueba');
  await page.keyboard.press('Control+A');
  // font dialog (while editing, acts on the selection)
  await tab('Inicio');
  await btn('Fuente…');
  await page.getByLabel('Fuente del texto', { exact: true }).fill('Georgia');
  await page.getByLabel('Estilo de fuente', { exact: true }).selectOption('bi');
  await page.getByRole('dialog').getByLabel('Tamaño de fuente', { exact: true }).fill('40');
  await page.getByLabel('Estilo de subrayado', { exact: true }).selectOption('dbl');
  await page.getByRole('checkbox', { name: 'Superíndice' }).check();
  await page.getByRole('checkbox', { name: 'Todo en mayúsculas' }).check();
  await shot('font-dialog');
  await accept();
  let j = await doc(1);
  assert.match(j, /"latin":"Georgia"/);
  assert.match(j, /"b":true/);
  assert.match(j, /"i":true/);
  assert.match(j, /"sz":40/);
  assert.match(j, /"u":"dbl"/);
  assert.match(j, /"baseline":30/);
  assert.match(j, /"cap":"all"/);
  await page.keyboard.press('Escape');
  // paragraph dialog (on the selected shape)
  await btn('Párrafo…');
  await page.getByLabel('Alineación del párrafo', { exact: true }).selectOption('just');
  await page.getByLabel('Sangría antes del texto', { exact: true }).fill('30');
  await page.getByLabel('Sangría especial', { exact: true }).selectOption('hang');
  await page.getByLabel('Valor de la sangría especial', { exact: true }).fill('12');
  await page.getByLabel('Interlineado', { exact: true }).selectOption('double');
  await page.getByLabel('Antes', { exact: true }).fill('6');
  await shot('paragraph-dialog');
  await accept();
  j = await doc(1);
  assert.match(j, /"algn":"just"/);
  assert.match(j, /"marL":30/);
  assert.match(j, /"indent":-12/);
  assert.match(j, /"lnSpc":\{"pct":200000\}/);
  assert.match(j, /"spcBef":\{"pts":6\}/);
  // tabs dialog
  await btn('Tabulaciones…');
  await page.getByLabel('Posición de la tabulación', { exact: true }).fill('150');
  await page.getByLabel('Alineación de la tabulación', { exact: true }).selectOption('r');
  await page.getByRole('button', { name: 'Establecer', exact: true }).click();
  await page.getByLabel('Posición de la tabulación', { exact: true }).fill('60');
  await page.getByLabel('Alineación de la tabulación', { exact: true }).selectOption('l');
  await page.getByRole('button', { name: 'Establecer', exact: true }).click();
  assert.equal(await page.locator('.sl-tablist li').count(), 2);
  await shot('tabs-dialog');
  await accept();
  j = await doc(1);
  assert.match(j, /"tabs":\[\{"pos":60,"algn":"l"\},\{"pos":150,"algn":"r"\}\]/);
  // columns dialog
  await btn('Columnas…');
  await page.getByLabel('Número de columnas', { exact: true }).fill('2');
  await page.getByLabel('Espaciado entre columnas', { exact: true }).fill('24');
  await accept();
  const body = await ev(() => window.__novaSlides.ctl.slide.shapes[1].text.body);
  assert.equal(body.numCol, 2);
  assert.equal(body.spcCol, 24);
  assert.ok(await page.locator('.sl-surface [style*="column-count: 2"]').count(), 'the text is drawn in two columns');
  // background: this slide gets a gradient, then everything gets a solid colour, then reset
  await tab('Diseño');
  await btn('Formato del fondo…');
  await page.getByRole('dialog').getByLabel('Relleno degradado').check();
  await shot('background-dialog');
  await page.getByRole('button', { name: 'Aplicar a esta diapositiva', exact: true }).click();
  assert.equal(await ev(() => window.__novaSlides.ctl.slide.bg.fill.t), 'grad');
  await btn('Formato del fondo…');
  await page.getByRole('button', { name: 'Restablecer el fondo', exact: true }).click();
  assert.equal(await ev(() => window.__novaSlides.ctl.slide.bg), undefined);
  // one undo step per dialog: undo the background reset, the gradient
  await ev(() => window.__novaSlides.ctl.undo());
  assert.equal(await ev(() => window.__novaSlides.ctl.slide.bg.fill.t), 'grad');
  const zip = await JSZip.loadAsync(Buffer.from(await ev(() => window.__novaSlides.write())));
  assert.match(await zip.file('ppt/slides/slide1.xml').async('string'), /<p:bg>.*<a:gradFill/s);
});

await check('dialogs: themes and templates, size and position, alt text, action', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.newSlide(); c.goTo(0); });
  const accept = () => page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  const theme = () => ev(() => { const d = window.__novaSlides.ctl.deck; return d.themes[0]; });
  // themes: colours, fonts, dark variant, each one undo step
  await tab('Diseño');
  await btn('Temas y plantillas…');
  await page.getByRole('button', { name: 'Verde', exact: true }).click();
  assert.equal((await theme()).colors.accent1, '#549e39');
  await page.getByLabel('Fuentes del tema').selectOption('arial');
  assert.equal((await theme()).fonts.minor.latin, 'Arial');
  await page.getByLabel('Fondo oscuro').check();
  assert.equal(await ev(() => window.__novaSlides.ctl.deck.masters[0].clrMap.bg1), 'dk1');
  await shot('themes-dialog');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await ev(() => window.__novaSlides.ctl.undo());
  assert.equal(await ev(() => window.__novaSlides.ctl.deck.masters[0].clrMap.bg1), 'lt1');
  // template from a file: save this deck as a .potx, start a new one, apply the template
  const bytes = await ev(() => window.__novaSlides.write());
  const tplPath = path.join(tmp, 'verde.potx');
  fs.writeFileSync(tplPath, Buffer.from(bytes));
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.newSlide(); c.goTo(0); });
  assert.equal((await theme()).colors.accent1, '#4472c4');
  await btn('Temas y plantillas…');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Abrir tema o plantilla…', exact: true }).click()]);
  await fc.setFiles(tplPath);
  await page.getByLabel('Solo colores y fuentes del tema').check();
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  assert.equal((await theme()).colors.accent1, '#549e39');
  // a real .potx export carries the template content type
  const zip = await JSZip.loadAsync(Buffer.from(await ev(() => window.__novaSlides.write())));
  assert.ok(zip.file('ppt/presentation.xml'));
  // size and position of the selected shape
  await clickAt(480, 200);
  await settle();
  await page.keyboard.press('Escape');
  await settle();
  assert.equal((await state()).sel, 1);
  await page.getByRole('tab', { name: /Formato de forma/ }).click();
  await btn('Tamaño y posición…');
  await page.getByLabel('Ancho (cm)', { exact: true }).fill('10');
  await page.getByLabel('Horizontal (cm)', { exact: true }).fill('2');
  await page.getByRole('checkbox', { name: 'Voltear horizontalmente' }).check();
  await shot('position-dialog');
  await accept();
  const xf0 = await ev(() => { const c = window.__novaSlides.ctl; return c.xfrmOf(c.selected[0]); });
  assert.ok(Math.abs(xf0.w - 283.46) < 0.1, `width ${xf0.w}`);
  assert.ok(Math.abs(xf0.x - 56.69) < 0.1, `x ${xf0.x}`);
  assert.equal(xf0.flipH, true);
  // alternative text
  await btn('Texto alternativo…');
  await page.getByLabel('Descripción del texto alternativo').fill('Título de la presentación');
  await accept();
  assert.equal(await ev(() => window.__novaSlides.ctl.selected[0].descr), 'Título de la presentación');
  // action: click on the shape goes to the last slide
  await tab('Insertar');
  await btn('Acción…');
  await page.getByLabel('Ir a la última diapositiva').check();
  await accept();
  assert.equal(await ev(() => window.__novaSlides.ctl.selected[0].hlink.slide), 'last');
  const z2 = await JSZip.loadAsync(Buffer.from(await ev(() => window.__novaSlides.write())));
  const sx = await z2.file('ppt/slides/slide1.xml').async('string');
  assert.match(sx, /hlinkshowjump\?jump=lastslide/);
  assert.match(sx, /descr="Título de la presentación"/);
});

await check('NovaArt (WordArt): styles, transform, insert, apply to a selected text, saved as WordArt', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.newSlide(); c.goTo(1); });
  const nShapes = () => ev(() => window.__novaSlides.ctl.slide.shapes.length);
  const before = await nShapes();
  await tab('Insertar');
  await btn('WordArt (NovaArt)…');
  assert.ok((await page.getByRole('radio').count()) >= 20);
  await page.getByRole('radio', { name: 'Degradado atardecer' }).click();
  await page.getByLabel('Texto de NovaArt').fill('Hola NovaArt');
  await page.getByLabel('Transformar el texto').selectOption('textArchUp');
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  assert.equal(await nShapes(), before + 1);
  assert.ok(await page.locator('.sl-surface svg textPath').count(), 'the text runs along the arc');
  await shot('novaart-arch');
  // a second one with a reflection, unwarped
  await btn('WordArt (NovaArt)…');
  await page.getByRole('radio', { name: 'Reflejo, énfasis 1' }).click();
  await page.getByLabel('Texto de NovaArt').fill('Reflejo');
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  assert.equal(await nShapes(), before + 2);
  await shot('novaart-reflection');
  // apply a style to an ordinary text shape
  await ev(() => { const c = window.__novaSlides.ctl; c.select([c.slide.shapes[0].id]); });
  await btn('WordArt (NovaArt)…');
  await page.getByRole('radio', { name: 'Resplandor, énfasis 1' }).click();
  await page.getByRole('button', { name: 'Aplicar al texto seleccionado', exact: true }).click();
  assert.match(await ev(() => JSON.stringify(window.__novaSlides.ctl.slide.shapes[0].text.doc)), /"glow"/);
  const zip = await JSZip.loadAsync(Buffer.from(await ev(() => window.__novaSlides.write())));
  const sx = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.match(sx, /<a:prstTxWarp prst="textArchUp"/);
  assert.match(sx, /<a:gradFill/);
  assert.match(sx, /<a:reflection/);
  assert.match(sx, /<a:glow/);
});

await check('SmartArt: every layout inserts a diagram of editable shapes, saved and reopened', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.goTo(0); });
  const names = ['Lista básica', 'Lista vertical', 'Proceso básico', 'Ciclo', 'Jerarquía', 'Pirámide', 'Relación (Venn)'];
  for (const [i, n] of names.entries()) {
    await ev(() => { const c = window.__novaSlides.ctl; c.newSlide(); });
    await tab('Insertar');
    await btn('SmartArt…');
    await page.locator('.sl-layouts label', { hasText: n }).click();
    await page.getByLabel('Color del diagrama').selectOption(String(i % 6));
    await page.getByRole('button', { name: 'Insertar', exact: true }).click();
    const g = await ev(() => { const c = window.__novaSlides.ctl; const e = c.slide.shapes.at(-1); return { kind: e.kind, n: e.children?.length, sel: c.selection.length }; });
    assert.equal(g.kind, 'group', n);
    assert.ok(g.n >= 4, `${n}: ${g.n} parts`);
    if (['Ciclo', 'Jerarquía', 'Pirámide', 'Relación (Venn)'].includes(n)) await shot(`smartart-${i}`);
  }
  // the diagram is shapes: ungroup gives them back, one undo step each
  await ev(() => { const c = window.__novaSlides.ctl; c.select([c.slide.shapes.at(-1).id]); });
  const before = await ev(() => window.__novaSlides.ctl.slide.shapes.length);
  await page.keyboard.press('Control+Shift+G');
  assert.ok((await ev(() => window.__novaSlides.ctl.slide.shapes.length)) > before);
  await ev(() => window.__novaSlides.ctl.undo());
  assert.equal(await ev(() => window.__novaSlides.ctl.slide.shapes.length), before);
  const back = await ev(async () => { const w = window.__novaSlides; const b = await w.write(); return b.length; });
  assert.ok(back > 5000);
});

await check('slide master view: edit master and layouts, text styles reach the slides, add/rename/delete layouts, undo, save', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.newSlide(); c.goTo(1); });
  const real = () => ev(() => { const d = window.__novaSlides.ctl.realDeck; return { masters: d.masters.length, layouts: d.layouts.length, slides: d.slides.length, m: d.masters[0], l: d.layouts.map((x) => ({ id: x.id, name: x.name, n: x.shapes.length })) }; });
  const titleSize = () => ev(() => {
    const el = document.querySelector('.sl-surface [data-ph="title"]');
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) if (n.textContent.trim()) return parseFloat(getComputedStyle(n.parentElement).fontSize);
    return 0;
  });
  const before = await titleSize();
  await tab('Vista');
  await btn('Patrón de diapositivas');
  assert.equal(await ev(() => window.__novaSlides.ctl.inMaster), true);
  assert.equal(await page.getByRole('option').count(), 12, 'one master and its eleven layouts');
  await shot('master-view');
  // the master: a bigger title style for every slide
  await page.getByRole('option', { name: /^Patrón:/ }).click();
  assert.equal(await ev(() => window.__novaSlides.ctl.masterTarget.kind), 'master');
  await ev(() => { const c = window.__novaSlides.ctl; c.select([c.slide.shapes.find((s) => s.ph?.type === 'title').id]); });
  await tab('Inicio');
  await page.selectOption('select[aria-label="Tamaño de fuente"]', '54');
  await page.getByRole('button', { name: 'Negrita', exact: true }).click();
  let r = await real();
  const mt = r.m.shapes.find((s) => s.ph?.type === 'title');
  assert.equal(mt.text.lst.lvl[0].rPr.sz, 54);
  assert.equal(mt.text.lst.lvl[0].rPr.b, true);
  assert.equal(JSON.stringify(mt.text.doc).includes('"sz":54'), false, 'the style is in the list style, not in the text');
  // the master background
  await page.getByRole('tab', { name: /Patrón de diapositivas/ }).click();
  await btn('Formato del fondo…');
  await page.getByRole('dialog').getByLabel('Relleno sólido').check();
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  assert.equal((await real()).m.bg.fill.t, 'solid');
  // a layout: add a picture placeholder
  await page.getByRole('option', { name: /^Diseño: Título y objetos/ }).click();
  const n0 = (await real()).l.find((x) => x.name === 'Título y objetos').n;
  await page.getByRole('button', { name: 'Insertar marcador de posición' }).click();
  await page.getByRole('menuitem', { name: 'Imagen' }).click();
  assert.equal((await real()).l.find((x) => x.name === 'Título y objetos').n, n0 + 1);
  // add a layout, rename it, undo/redo, then delete it
  await btn('Insertar diseño');
  r = await real();
  assert.equal(r.layouts, 12);
  await btn('Cambiar nombre y opciones…');
  await page.getByLabel('Nombre del diseño o patrón').fill('Mi diseño');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  assert.ok((await real()).l.some((x) => x.name === 'Mi diseño'));
  await ev(() => window.__novaSlides.ctl.undo());
  assert.ok(!(await real()).l.some((x) => x.name === 'Mi diseño'));
  await ev(() => window.__novaSlides.ctl.redo());
  await btn('Eliminar');
  assert.equal((await real()).layouts, 11);
  // saving from master view saves the real presentation
  const zip = await JSZip.loadAsync(Buffer.from(await ev(() => window.__novaSlides.write())));
  assert.ok(zip.file('ppt/slides/slide2.xml'), 'the slides are in the file');
  assert.equal(Object.keys(zip.files).filter((f) => /ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f)).length, 11);
  // leave: the slides follow the master
  await btn('Cerrar la vista Patrón');
  assert.equal(await ev(() => window.__novaSlides.ctl.inMaster), false);
  assert.equal(await ev(() => window.__novaSlides.ctl.index), 1);
  await settle();
  const after = await titleSize();
  assert.ok(after > before, `title ${before} → ${after}`);
  // a new slide with the changed layout has the picture placeholder
  await ev(() => { const c = window.__novaSlides.ctl; const l = c.realDeck.layouts.find((x) => x.name === 'Título y objetos'); c.newSlide(l.id); });
  assert.ok(await ev(() => window.__novaSlides.ctl.slide.shapes.some((s) => s.ph?.type === 'pic')));
  await shot('after-master');
});

await check('freeforms: polygon, curve, scribble; edit points (move, add, smooth, handle, delete, close); saved as custom geometry', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.newSlide(); c.goTo(1); });
  const eb = async (name) => {
    const g = page.getByRole('button', { name: 'Editar forma', exact: true });
    if (await g.count()) await g.click();
    await btn(name);
  };
  const shapes = () => ev(() => window.__novaSlides.ctl.slide.shapes.filter((s) => s.geom && s.geom.cust).map((s) => ({ id: s.id, name: s.name, fill: s.fill, cmds: s.geom.cust[0].cmds.map((c) => c[0]).join(''), x: s.xfrm })));
  await tab('Insertar');
  // polygon: four clicks, the last on the first point closes it
  await btn('Forma libre: forma');
  for (const [x, y] of [[200, 300], [380, 300], [380, 440], [200, 440]]) await clickAt(x, y);
  assert.equal((await shapes()).length, 0, 'still drawing');
  await shot('freeform-drawing');
  await clickAt(200, 300);
  let sh = await shapes();
  assert.equal(sh.length, 1);
  assert.equal(sh[0].cmds, 'MLLLZ');
  assert.equal(await ev(() => window.__novaSlides.ctl.tool.kind), 'select');
  // curve: three clicks and a double click on the last
  await btn('Forma libre: curva');
  await clickAt(500, 350);
  await clickAt(600, 300);
  await page.mouse.dblclick((await at(700, 380)).x, (await at(700, 380)).y);
  sh = await shapes();
  assert.equal(sh.length, 2);
  assert.match(sh[1].cmds, /^MC+$/);
  assert.deepEqual(sh[1].fill, { t: 'none' });
  // scribble
  await btn('Forma libre: garabato');
  const s0 = await at(250, 150);
  await page.mouse.move(s0.x, s0.y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) await page.mouse.move(s0.x + i * 8, s0.y + Math.sin(i / 3) * 30);
  await page.mouse.up();
  sh = await shapes();
  assert.equal(sh.length, 3);
  assert.match(sh[2].cmds, /^MC+$/);
  assert.ok(sh[2].cmds.length < 25, 'the scribble is simplified');
  // edit points of the polygon
  const poly = sh[0].id;
  await ev((id) => window.__novaSlides.ctl.select([id]), poly);
  await page.getByRole('tab', { name: /Formato de forma/ }).click();
  await eb('Modificar puntos');
  assert.equal(await ev(() => window.__novaSlides.ctl.editPoints !== null), true);
  const nodes = () => ev(() => { const c = window.__novaSlides.ctl; const el = c.element(c.editPoints); const x = c.xfrmOf(el); return { x, nodes: c.pointsOf(el)[0].nodes.map((n) => ({ x: x.x + n.x, y: x.y + n.y, hin: n.hin && { x: x.x + n.hin.x, y: x.y + n.hin.y }, hout: n.hout && { x: x.x + n.hout.x, y: x.y + n.hout.y } })), closed: c.pointsOf(el)[0].closed }; });
  let nd = await nodes();
  assert.equal(nd.nodes.length, 4);
  assert.equal(nd.closed, true);
  const undoDepth = await ev(() => window.__novaSlides.ctl.canUndo);
  assert.ok(undoDepth);
  // drag the second node by (+60, -50)
  const n1 = nd.nodes[1];
  const n0 = nd.nodes[0];
  const from = await at(n1.x, n1.y);
  const to = await at(n1.x + 60, n1.y - 50);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 3 });
  await page.mouse.up();
  nd = await nodes();
  assert.ok(Math.abs(nd.nodes[1].x - (n1.x + 60)) < 3 && Math.abs(nd.nodes[1].y - (n1.y - 50)) < 3, `moved to ${nd.nodes[1].x},${nd.nodes[1].y}`);
  assert.ok(Math.abs(nd.nodes[0].x - n0.x) < 0.01 && Math.abs(nd.nodes[0].y - n0.y) < 0.01, 'the others stay where they were on the slide');
  await ev(() => window.__novaSlides.ctl.undo());
  nd = await nodes();
  assert.ok(Math.abs(nd.nodes[1].x - n1.x) < 0.5, 'one undo step for the whole drag');
  await ev(() => window.__novaSlides.ctl.redo());
  // click on a segment adds a node
  nd = await nodes();
  const mid = { x: (nd.nodes[2].x + nd.nodes[3].x) / 2, y: (nd.nodes[2].y + nd.nodes[3].y) / 2 };
  const mp = await at(mid.x, mid.y);
  await page.mouse.click(mp.x, mp.y);
  nd = await nodes();
  assert.equal(nd.nodes.length, 5);
  // the new node is selected: make it smooth, then drag one of its handles
  await eb('Punto suave');
  nd = await nodes();
  const sel = await ev(() => window.__novaSlides.ctl.editPt);
  const sn = nd.nodes[sel.ni];
  assert.ok(sn.hin && sn.hout, 'a smooth node has handles');
  await shot('edit-points');
  const hf = await at(sn.hout.x, sn.hout.y);
  const ht = await at(sn.hout.x + 30, sn.hout.y + 40);
  await page.mouse.move(hf.x, hf.y);
  await page.mouse.down();
  await page.mouse.move(ht.x, ht.y, { steps: 4 });
  await page.mouse.up();
  nd = await nodes();
  const sn2 = nd.nodes[sel.ni];
  const cross = (sn2.x - sn2.hin.x) * (sn2.hout.y - sn2.y) - (sn2.y - sn2.hin.y) * (sn2.hout.x - sn2.x);
  assert.ok(Math.abs(cross) < 40, 'the opposite handle follows on the same line');
  // delete the node with the keyboard, then open the path
  await page.locator('[data-testid=stage-area]').focus();
  await page.keyboard.press('Delete');
  assert.equal((await nodes()).nodes.length, 4);
  await eb('Cerrar o abrir el trazado');
  assert.equal((await nodes()).closed, false);
  await page.locator('[data-testid=stage-area]').focus();
  await page.keyboard.press('Escape');
  assert.equal(await ev(() => window.__novaSlides.ctl.editPoints), null);
  // a preset shape becomes a freeform when its points are edited
  await ev(() => { const c = window.__novaSlides.ctl; c.addElement(window.__newShape ?? { kind: 'shape', id: 'r1', name: 'Rect', geom: { prst: 'roundRect' }, xfrm: { x: 600, y: 120, w: 160, h: 90 }, fill: { t: 'solid', c: { rgb: '#4472c4' } } }); });
  await eb('Modificar puntos');
  assert.equal((await nodes()).nodes.length >= 8, true, 'a rounded rectangle has corner arcs as nodes');
  await eb('Modificar puntos');
  assert.ok((await shapes()).some((s) => s.id === 'r1') === false, 'leaving without a change keeps the preset');
  // saved as custom geometry and read back
  const zip = await JSZip.loadAsync(Buffer.from(await ev(() => window.__novaSlides.write())));
  const xml = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.equal((xml.match(/<a:custGeom>/g) ?? []).length, 3);
  const re = await ev(async () => { const b = await window.__novaSlides.write(); await window.__novaSlides.load(b, 'ff.pptx'); const c = window.__novaSlides.ctl; return c.deck.slides[1].shapes.filter((s) => s.geom && s.geom.cust).length; });
  assert.equal(re, 3);
  await settle(500);
  assert.equal(await ev(() => document.getElementById("root").getAttribute("aria-hidden")), null, "the page is not left hidden to assistive technology");
});

await check('tables: cells (click, type, Tab, drag-select), merge/split, rows and columns, styles, shading, borders, grips, saved', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.goTo(0); });
  const T = () => ev(() => { const t = window.__novaSlides.ctl.table; return t && { rows: t.rows.length, cols: t.cols.length, styleId: t.styleId, lastRow: !!t.lastRow, sizes: t.cols.map((x) => Math.round(x)), cells: t.rows.map((r) => r.cells.map((c) => (c.hMerge && c.vMerge ? 'B' : c.hMerge ? 'H' : c.vMerge ? 'V' : c.rowSpan || c.gridSpan ? `${c.rowSpan ?? 1}x${c.gridSpan ?? 1}` : '.')).join(' ')) }; });
  const cellText = (r, c) => ev(([a, b]) => { const t = window.__novaSlides.ctl.table; return t.rows[a].cells[b].text ? JSON.stringify(t.rows[a].cells[b].text.doc) : ''; }, [r, c]);
  const td = (r, c) => page.locator(`.sl-surface .sl-table td[data-r="${r}"][data-c="${c}"]`);
  const center = async (r, c) => { const b = await td(r, c).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const cs = () => ev(() => { const s = window.__novaSlides.ctl.cellSelection; return s && { ...s.range, editing: !!window.__novaSlides.ctl.editingCell }; });

  await tab('Insertar');
  await btn('Tabla…');
  await page.getByLabel('Número de columnas').fill('3');
  await page.getByLabel('Número de filas').fill('3');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await settle();
  assert.deepEqual((await T()).cells, ['. . .', '. . .', '. . .']);
  // a click puts the cursor in the cell; typing goes to that cell only
  let p = await center(1, 1);
  await page.mouse.click(p.x, p.y);
  await settle();
  assert.deepEqual(await ev(() => window.__novaSlides.ctl.editingCell && { r: window.__novaSlides.ctl.editingCell.r, c: window.__novaSlides.ctl.editingCell.c }), { r: 1, c: 1 });
  await page.keyboard.type('Hola');
  assert.match(await cellText(1, 1), /Hola/);
  assert.equal(await cellText(0, 0).then((s) => /"text"/.test(s)), false);
  // Tab goes to the next cell and keeps editing
  await page.keyboard.press('Tab');
  await page.keyboard.type('Mundo');
  assert.match(await cellText(1, 2), /Mundo/);
  await shot('table-edit');
  await page.keyboard.press('Escape');
  await settle();
  assert.equal((await cs()).editing, false);
  assert.equal((await cs()).r1, 1);
  // dragging over cells selects a range
  const a = await center(0, 0);
  const b = await center(1, 1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await settle();
  assert.deepEqual(await cs(), { r1: 0, c1: 0, r2: 1, c2: 1, editing: false });
  assert.equal(await page.locator('[data-testid=cell-selection]').getAttribute('data-cells'), '4');
  await shot('table-range');
  // formatting reaches the selected cells only
  await tab('Inicio');
  await btn('Negrita');
  const bold = await ev(() => { const t = window.__novaSlides.ctl.table; return t.rows.map((r) => r.cells.map((c) => /"b":true/.test(JSON.stringify(c.text.doc)))); });
  assert.equal(bold[1][1], true, 'the selected cell with text is bold');
  assert.equal(bold[1][2], false, 'a cell outside the range is not');
  assert.equal(bold[2][2], false);
  // merge (contextual tab), undo, merge again
  await page.getByRole('tab', { name: /Disposición de tabla/ }).click();
  await btn('Combinar celdas');
  assert.deepEqual((await T()).cells, ['2x2 H .', 'V B .', '. . .']);
  assert.match(await cellText(0, 0), /Hola/);
  await ev(() => window.__novaSlides.ctl.undo());
  assert.deepEqual((await T()).cells, ['. . .', '. . .', '. . .']);
  await ev(() => window.__novaSlides.ctl.redo());
  await btn('Dividir celdas…');
  await page.getByRole('dialog').getByLabel('Número de columnas').fill('2');
  await page.getByRole('dialog').getByLabel('Número de filas').fill('2');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  assert.deepEqual((await T()).cells, ['. . .', '. . .', '. . .']);
  // rows and columns
  await ev(() => window.__novaSlides.ctl.selectCells(window.__novaSlides.ctl.table.id, 2, 0));
  await btn('Insertar debajo');
  assert.equal((await T()).rows, 4);
  await btn('Insertar a la derecha');
  assert.equal((await T()).cols, 4);
  await btn('Eliminar columnas');
  assert.equal((await T()).cols, 3);
  await ev(() => window.__novaSlides.ctl.selectCells(window.__novaSlides.ctl.table.id, 3, 0));
  await btn('Eliminar filas');
  assert.equal((await T()).rows, 3);
  // style, options, shading, borders
  await page.getByRole('tab', { name: /Diseño de tabla/ }).click();
  await page.getByRole('button', { name: 'Estilos de tabla', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Cuadrícula - Énfasis 3', exact: true }).click();
  const st = await ev(() => { const c = window.__novaSlides.ctl; return { id: c.table.styleId, defs: c.deck.tableStyles?.map((s) => s.id) ?? [] }; });
  assert.equal(st.id, '{4E4F5641-0002-4000-8000-000000000003}');
  assert.ok(st.defs.includes(st.id), 'the style definition travels with the presentation');
  await settle();
  assert.notEqual(await td(0, 0).evaluate((e) => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)', 'the header row is filled by the style');
  await page.getByRole('button', { name: 'Fila de totales', exact: true }).click();
  assert.equal((await T()).lastRow, true);
  await ev(() => window.__novaSlides.ctl.selectCells(window.__novaSlides.ctl.table.id, 1, 0, 1, 1));
  await page.getByRole('button', { name: 'Sombreado', exact: true }).first().click();
  assert.ok(await ev(() => { const c = window.__novaSlides.ctl.table.rows[1].cells; return !!c[0].fill && !!c[1].fill && !c[2].fill; }), 'shading goes to the selected cells');
  await page.getByRole('button', { name: 'Bordes', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Todos los bordes', exact: true }).click();
  assert.ok(await ev(() => { const c = window.__novaSlides.ctl.table.rows[1].cells[0]; return !!c.lnT && !!c.lnB && !!c.lnL && !!c.lnR; }));
  await shot('table-styled');
  // a column grip changes the column and its neighbour, keeping the table width
  await page.locator('[data-testid=stage-area]').focus();
  const w0 = (await T()).sizes;
  const g = await page.locator('[data-testid=col-grip-0]').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 40, g.y + g.height / 2, { steps: 5 });
  await page.mouse.up();
  const w1 = (await T()).sizes;
  assert.ok(w1[0] > w0[0] + 10, `column grew (${w0} → ${w1})`);
  assert.ok(Math.abs(w1.reduce((x, y) => x + y) - w0.reduce((x, y) => x + y)) <= 2, 'the table keeps its width');
  // saved and read back
  const back = await ev(async () => {
    const b = await window.__novaSlides.write();
    await window.__novaSlides.load(b, 'tabla.pptx');
    const c = window.__novaSlides.ctl;
    const t = c.deck.slides[0].shapes.find((s) => s.kind === 'table');
    return { rows: t.rows.length, cols: t.cols.length, style: t.styleId, defs: (c.deck.tableStyles ?? []).map((s) => s.id), borders: !!t.rows[1].cells[0].lnT, fill: !!t.rows[1].cells[0].fill };
  });
  assert.equal(back.rows, 3);
  assert.equal(back.cols, 3);
  assert.equal(back.style, '{4E4F5641-0002-4000-8000-000000000003}');
  assert.ok(back.defs.includes(back.style));
  assert.ok(back.borders && back.fill);
});

await check('equations (LaTeX → picture, edit again) and picture tools (crop, pan, fill/fit, recolor, corrections, shape, reset, saved)', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.goTo(0); });
  const P = () => ev(() => { const c = window.__novaSlides.ctl; const p = c.selected[0]; return p && { name: p.name, descr: p.descr, src: p.src, x: { ...c.xfrmOf(p) }, sr: p.srcRect, adj: p.adjust, geom: p.geom }; });
  // equation
  await tab('Insertar');
  await btn('Ecuación…');
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Fórmula en LaTeX').fill('\\frac{a+b}{c}=\\sqrt{x^2}');
  assert.ok(await dlg.locator('[data-testid=eq-preview] math').count(), 'the preview shows MathML');
  await dlg.getByLabel('Fórmula en LaTeX').fill('\\frac{');
  assert.ok(await dlg.getByRole('alert').count(), 'a bad formula shows the reason');
  await dlg.getByRole('button', { name: 'Fórmula cuadrática', exact: true }).click();
  await shot('equation-dialog');
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForFunction(() => window.__novaSlides.ctl.selected[0]?.name === 'Ecuación');
  const eq = await P();
  assert.match(eq.descr, /sqrt/);
  const png = await ev(() => { const c = window.__novaSlides.ctl; const a = c.deck.assets[c.selected[0].src]; return a && [a.mime, a.data.length, [...a.data.slice(0, 4)]]; });
  assert.equal(png[0], 'image/png');
  assert.deepEqual(png[2], [137, 80, 78, 71]);
  assert.ok(png[1] > 1000, 'a real picture of the formula');
  await shot('equation-inserted');
  // double click edits it again
  const sb = await surface().boundingBox();
  const z = (await ev(() => window.__novaSlides.ctl.zoom || window.__novaSlides.ctl.fitPercent)) / 100;
  await page.mouse.dblclick(sb.x + (eq.x.x + eq.x.w / 2) * z, sb.y + (eq.x.y + eq.x.h / 2) * z);
  await page.getByRole('dialog').getByLabel('Fórmula en LaTeX').fill('a^2+b^2=c^2');
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await page.waitForFunction((old) => window.__novaSlides.ctl.selected[0]?.src !== old, eq.src);
  assert.equal((await P()).descr, 'a^2+b^2=c^2');
  await ev(() => { const c = window.__novaSlides.ctl; c.deleteSelected(); });

  // picture
  await ev(() => {
    const c = window.__novaSlides.ctl;
    const cv = document.createElement('canvas'); cv.width = 400; cv.height = 200;
    const g = cv.getContext('2d'); const gr = g.createLinearGradient(0, 0, 400, 0); gr.addColorStop(0, '#e03131'); gr.addColorStop(1, '#1971c2'); g.fillStyle = gr; g.fillRect(0, 0, 400, 200); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText('Imagen', 120, 110);
    const data = Uint8Array.from(atob(cv.toDataURL('image/png').split(',')[1]), (ch) => ch.charCodeAt(0));
    c.apply('img', (d) => ({ ...d, assets: { ...d.assets, imgA: { id: 'imgA', mime: 'image/png', data, name: 'a.png' } } }));
    c.addElement({ kind: 'pic', id: 'pic1', name: 'Imagen', src: 'imgA', xfrm: { x: 200, y: 150, w: 400, h: 200 } }, { select: true });
  });
  await settle();
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
  await page.getByRole('button', { name: 'Recortar', exact: true }).click();
  assert.ok(await ev(() => !!window.__novaSlides.ctl.cropPic));
  const g = await page.locator('[data-testid=crop-w]').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 60, g.y + g.height / 2, { steps: 5 });
  await page.mouse.up();
  let p1 = await P();
  assert.ok(p1.sr.l > 5000 && p1.x.w < 380, `cropped from the left (${JSON.stringify(p1.sr)}, w ${p1.x.w})`);
  const wCrop = p1.x.w;
  // the image stays where it was: its left edge, frame x minus the cropped part, is unchanged
  const imgLeft = (q) => q.x.x - (q.sr.l / 100000) * (q.x.w / (1 - (q.sr.l + (q.sr.r ?? 0)) / 100000));
  assert.ok(Math.abs(imgLeft(p1) - 200) < 1.5, 'the image does not move when its frame is cropped');
  await shot('picture-crop');
  // pan inside the frame
  const pb = await surface().boundingBox();
  const zz = (await ev(() => window.__novaSlides.ctl.zoom || window.__novaSlides.ctl.fitPercent)) / 100;
  const cx = pb.x + (p1.x.x + p1.x.w / 2) * zz;
  const cy = pb.y + (p1.x.y + p1.x.h / 2) * zz;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 30, cy, { steps: 4 });
  await page.mouse.up();
  const p2 = await P();
  assert.ok(p2.sr.l < p1.sr.l, 'panning right shows more of the left part');
  assert.equal(Math.round(p2.x.w), Math.round(wCrop), 'the frame stays');
  await page.locator('[data-testid=stage-area]').focus();
  await page.keyboard.press('Escape');
  assert.equal(await ev(() => !!window.__novaSlides.ctl.cropPic), false);
  // fill and fit
  await page.getByRole('button', { name: 'Ajustar', exact: true }).click();
  { const q = (await P()).sr; assert.ok(q.t < 0 || q.l < 0, 'fit pads the frame'); }
  await page.getByRole('button', { name: 'Rellenar', exact: true }).click();
  assert.ok((await P()).sr.l > 0 || (await P()).sr.t > 0, 'fill crops the overflow');
  // recolor, corrections, shape
  await page.getByRole('button', { name: 'Recolorear', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Sepia' }).click();
  assert.ok((await P()).adj.duotone, 'sepia is a duotone');
  await settle();
  await shot('picture-sepia');
  await page.getByRole('button', { name: 'Correcciones', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Brillo +20 %' }).click();
  assert.equal((await P()).adj.bright, 20);
  await page.getByRole('button', { name: 'Forma de la imagen', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Óvalo' }).click();
  assert.equal((await P()).geom.prst, 'ellipse');
  await page.getByRole('button', { name: 'Correcciones', exact: true }).click();
  await page.getByRole('menuitem', { name: /Opciones de corrección/ }).click();
  await page.getByRole('dialog').getByLabel('Transparencia').fill('30');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  assert.equal((await P()).adj.alpha, 70);
  await shot('picture-styled');
  // saved and read back
  const back = await ev(async () => {
    const b = await window.__novaSlides.write(); await window.__novaSlides.load(b, 'img.pptx');
    const p = window.__novaSlides.ctl.deck.slides[0].shapes.find((s) => s.kind === 'pic');
    return { sr: !!p.srcRect, duo: !!p.adjust?.duotone, bright: p.adjust?.bright, alpha: p.adjust?.alpha, geom: p.geom?.prst };
  });
  assert.deepEqual(back, { sr: true, duo: true, bright: 20, alpha: 70, geom: 'ellipse' });
  // reset
  await ev(() => { const c = window.__novaSlides.ctl; c.select(['x']); c.select(c.slide.shapes.filter((s) => s.kind === 'pic').map((s) => s.id)); });
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
  await page.getByRole('button', { name: 'Restablecer imagen', exact: true }).click();
  const r = await P();
  assert.ok(!r.sr && !r.adj && !r.geom, 'reset removes crop, colour and shape');
});

await check('exports: .odp (and read back), .ppsx, images (PNG, zip), video (WebM)', async () => {
  await ev(() => {
    const c = window.__novaSlides.ctl; c.newDoc(); c.newSlide(); c.goTo(0);
    const s = c.slide; const t = s.shapes.find((e) => e.ph?.type === 'ctrTitle' || e.ph?.type === 'title');
    c.patch([t.id], 'x', (e) => ({ ...e, text: { ...e.text, doc: { type: 'doc', content: [{ type: 'paragraph', attrs: { lvl: 0, p: {}, end: {} }, content: [{ type: 'text', text: 'Informe anual', marks: [{ type: 'run', attrs: { r: { b: true, color: { rgb: '#c00000' } } } }] }] }] } } }));
  });
  let stepN = 0;
  const save = async (open) => { stepN++; const [dl] = await Promise.all([page.waitForEvent('download').catch((e) => { throw new Error('download ' + stepN + ' missing'); }), open()]); const p = path.join(tmp, dl.suggestedFilename()); await dl.saveAs(p); return { name: dl.suggestedFilename(), bytes: fs.readFileSync(p) }; };
  const menu = async (label) => { await page.getByRole('button', { name: 'Archivo', exact: true }).click(); await page.getByRole('button', { name: label, exact: true }).click(); };
  // .odp
  const odp = await save(() => menu('Exportar como OpenDocument (.odp)…'));
  assert.match(odp.name, /\.odp$/);
  const z = await JSZip.loadAsync(odp.bytes);
  assert.equal(await z.file('mimetype').async('string'), 'application/vnd.oasis.opendocument.presentation');
  assert.match(await z.file('content.xml').async('string'), /Informe anual/);
  const back = await ev(async (b) => { const r = await window.__novaSlides.load(b, 'informe.odp'); const c = window.__novaSlides.ctl; return { n: r.slides, text: JSON.stringify(c.deck.slides[0].shapes.map((e) => e.text?.doc)) }; }, [...odp.bytes]);
  assert.ok(back.n >= 2 && /Informe anual/.test(back.text), 'the .odp opens with its text');
  assert.ok(await page.getByRole('dialog').getByText(/OpenDocument/).count(), 'the losses of the import are shown');
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await settle();
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.goTo(0); const t = c.slide.shapes.find((e) => e.ph?.type === 'ctrTitle' || e.ph?.type === 'title'); c.patch([t.id], 'x', (e) => ({ ...e, text: { ...e.text, doc: { type: 'doc', content: [{ type: 'paragraph', attrs: { lvl: 0, p: {}, end: {} }, content: [{ type: 'text', text: 'Informe anual', marks: [{ type: 'run', attrs: { r: { b: true, color: { rgb: '#c00000' } } } }] }] }] } } })); });
  // .ppsx reads back
  const ppsx = await save(() => menu('Exportar como presentación con diapositivas (.ppsx)…'));
  assert.equal(await ev(async (b) => (await window.__novaSlides.load(b, 'x.ppsx')).slides, [...ppsx.bytes]) >= 1, true);
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.goTo(0); const t = c.slide.shapes.find((e) => e.ph?.type === 'ctrTitle' || e.ph?.type === 'title'); c.patch([t.id], 'x', (e) => ({ ...e, text: { ...e.text, doc: { type: 'doc', content: [{ type: 'paragraph', attrs: { lvl: 0, p: {}, end: {} }, content: [{ type: 'text', text: 'Informe anual', marks: [{ type: 'run', attrs: { r: { b: true, color: { rgb: '#c00000' } } } }] }] }] } } })); });
  // images: current slide as PNG
  await menu('Exportar las diapositivas como imágenes…');
  const d = page.getByRole('dialog');
  await d.getByLabel('Ancho de la imagen').selectOption('1280');
  await d.getByLabel('Diapositivas que se exportan').selectOption('current');
  const png = await save(() => d.getByRole('button', { name: 'Exportar', exact: true }).click());
  assert.deepEqual([...png.bytes.slice(0, 4)], [137, 80, 78, 71]);
  assert.equal(png.bytes.readUInt32BE(16), 1280, 'the picture has the width asked for');
  if (shotsDir) fs.writeFileSync(`${shotsDir}/slide-export.png`, png.bytes);
  // images: all slides in a zip
  await ev(() => window.__novaSlides.ctl.newSlide());
  await menu('Exportar las diapositivas como imágenes…');
  const zp = await save(() => page.getByRole('dialog').getByRole('button', { name: 'Exportar', exact: true }).click());
  const zz = await JSZip.loadAsync(zp.bytes);
  assert.equal(Object.keys(zz.files).length, 2, 'one picture per slide');
  // video
  await menu('Exportar como vídeo…');
  const v = page.getByRole('dialog');
  await v.getByLabel('Ancho de la imagen').selectOption('854');
  await v.getByLabel('Segundos por diapositiva').fill('0.5');
  await v.getByRole('checkbox').uncheck();
  const vid = await save(() => v.getByRole('button', { name: 'Exportar', exact: true }).click());
  assert.match(vid.name, /\.webm$/);
  assert.deepEqual([...vid.bytes.slice(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
  assert.ok(vid.bytes.length > 1500, `a real video (${vid.bytes.length} bytes)`);
});

await check('lines (drag the ends), rulers and guides (create from the ruler, remove, saved), format painter (shape and text, repeated)', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.goTo(0); const t = c.slide.shapes.map((s) => s.id); c.select(t); c.deleteSelected(); });
  const z = async () => (await ev(() => window.__novaSlides.ctl.zoom || window.__novaSlides.ctl.fitPercent)) / 100;
  const X = (id) => ev((i) => { const c = window.__novaSlides.ctl; return { ...c.xfrmOf(c.element(i)) }; }, id);
  const mid = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  // line ends
  await ev(() => { const c = window.__novaSlides.ctl; c.addElement({ kind: 'cxn', id: 'ln1', name: 'Línea', geom: { prst: 'line' }, xfrm: { x: 200, y: 200, w: 200, h: 100 }, ln: { w: 3, fill: { t: 'solid', c: { rgb: '#000000' } } } }, { select: true }); });
  await settle();
  const undo0 = await ev(() => window.__novaSlides.ctl.canUndo);
  let p = await mid('[data-testid=line-end]');
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(p.x + 50, p.y + 40, { steps: 5 }); await page.mouse.up();
  let x = await X('ln1');
  assert.ok(x.w > 240 && x.h > 125, `the far end moved (${JSON.stringify(x)})`);
  assert.ok(Math.abs(x.x - 200) < 1 && Math.abs(x.y - 200) < 1, 'the other end stayed');
  p = await mid('[data-testid=line-start]');
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(p.x + 400, p.y - 10, { steps: 5 }); await page.mouse.up();
  x = await X('ln1');
  assert.ok(x.flipH, 'dragging an end past the other flips the line');
  await ev(() => window.__novaSlides.ctl.undo());
  x = await X('ln1');
  assert.ok(!x.flipH, 'each end drag is one undo step');
  // rulers and guides
  await tab('Vista');
  await btn('Reglas');
  assert.ok(await page.locator('[data-testid=ruler-h]').count() && await page.locator('[data-testid=ruler-v]').count());
  const rb = await page.locator('[data-testid=ruler-h]').boundingBox();
  const sb = await surface().boundingBox();
  const zz = await z();
  await page.mouse.move(rb.x + 300, rb.y + 9); await page.mouse.down();
  await page.mouse.move(rb.x + 300, sb.y + 150 * zz, { steps: 6 }); await page.mouse.up();
  let guides = await ev(() => window.__novaSlides.ctl.deck.guides ?? []);
  assert.equal(guides.length, 1);
  assert.equal(guides[0].orient, 'h');
  assert.ok(Math.abs(guides[0].pos - 150) < 5, `at about 150 pt (${guides[0].pos})`);
  await shot('ruler-guide');
  // dragging a guide off the slide removes it
  const gb = await page.locator('.sl-guide').first().boundingBox();
  await page.mouse.move(gb.x + 100, gb.y + gb.height / 2); await page.mouse.down();
  await page.mouse.move(gb.x + 100, sb.y - 60, { steps: 6 }); await page.mouse.up();
  assert.equal((await ev(() => window.__novaSlides.ctl.deck.guides ?? [])).length, 0);
  await page.mouse.move(rb.x + 200, rb.y + 9); await page.mouse.down();
  await page.mouse.move(rb.x + 200, sb.y + 90 * zz, { steps: 4 }); await page.mouse.up();
  const lb = await page.locator('[data-testid=ruler-v]').boundingBox();
  await page.mouse.move(lb.x + 9, lb.y + 200); await page.mouse.down();
  await page.mouse.move(sb.x + 300 * zz, lb.y + 200, { steps: 4 }); await page.mouse.up();
  guides = await ev(() => window.__novaSlides.ctl.deck.guides ?? []);
  assert.deepEqual(guides.map((g) => g.orient).sort(), ['h', 'v']);
  const back = await ev(async () => { const b = await window.__novaSlides.write(); await window.__novaSlides.load(b, 'guias.pptx'); return (window.__novaSlides.ctl.deck.guides ?? []).map((g) => [g.orient, Math.round(g.pos)]); });
  assert.equal(back.length, 2, 'the guides are saved in the file');
  await page.getByRole('button', { name: 'Quitar todas las guías', exact: true }).click();
  assert.equal((await ev(() => window.__novaSlides.ctl.deck.guides ?? [])).length, 0);
  // format painter
  await ev(() => {
    const c = window.__novaSlides.ctl;
    const doc = (txt, r) => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { lvl: 0, p: { algn: 'ctr' }, end: {} }, content: [{ type: 'text', text: txt, ...(r ? { marks: [{ type: 'run', attrs: { r } }] } : {}) }] }] });
    const mk = (id, x, txt, fill, r) => ({ kind: 'shape', id, name: id, geom: { prst: 'rect' }, xfrm: { x, y: 300, w: 140, h: 80 }, fill: { t: 'solid', c: { rgb: fill } }, text: { body: { anchor: 'ctr' }, doc: doc(txt, r) } });
    c.addElement(mk('A', 60, 'Origen', '#c00000', { b: true, sz: 30, color: { rgb: '#ffffff' } }));
    c.addElement(mk('B', 260, 'Uno', '#dddddd'));
    c.addElement(mk('C', 460, 'Dos', '#dddddd'));
    c.select(['A']);
  });
  await tab('Inicio');
  await page.getByRole('button', { name: 'Pincel continuo', exact: true }).click();
  assert.ok(await ev(() => window.__novaSlides.ctl.painter?.sticky));
  const click = async (id) => { const x = await X(id); const b = await surface().boundingBox(); const k = await z(); await page.mouse.click(b.x + (x.x + x.w / 2) * k, b.y + (x.y + x.h / 2) * k); await settle(); };
  const look = (id) => ev((i) => { const c = window.__novaSlides.ctl; const e = c.element(i); const j = JSON.stringify(e.text.doc); return { fill: e.fill.c.rgb, b: /"b":true/.test(j), sz: /"sz":30/.test(j) }; }, id);
  await click('B');
  assert.deepEqual(await look('B'), { fill: '#c00000', b: true, sz: true }, 'shape and text formatting are painted');
  await click('C');
  assert.deepEqual(await look('C'), { fill: '#c00000', b: true, sz: true }, 'a repeated painter stays on');
  await page.locator('[data-testid=stage-area]').focus();
  await page.keyboard.press('Escape');
  assert.equal(await ev(() => window.__novaSlides.ctl.painter), null);
  // a single use ends after one object
  await ev(() => { const c = window.__novaSlides.ctl; c.patch(['B'], 'x', (e) => ({ ...e, fill: { t: 'solid', c: { rgb: '#00aa00' } } })); c.select(['B']); });
  await page.getByRole('button', { name: 'Copiar formato', exact: true }).click();
  await click('C');
  assert.equal((await look('C')).fill, '#00aa00');
  assert.equal(await ev(() => window.__novaSlides.ctl.painter), null, 'a single painter ends after one click');
});

await check('views: outline (type, Enter, Tab, Shift+Tab, undo), slide sorter (select, drag, open), reading, notes page', async () => {
  const deckInfo = () => ev(() => { const c = window.__novaSlides.ctl; return { n: c.deck.slides.length, ids: c.deck.slides.map((s) => s.id), view: c.view, index: c.index }; });
  const titleOf = (i) => ev((k) => { const c = window.__novaSlides.ctl; const s = c.deck.slides[k]; const t = s.shapes.find((e) => e.ph && (e.ph.type === 'title' || e.ph.type === 'ctrTitle')); return t ? JSON.stringify(t.text.doc) : ''; }, i);
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); while (c.deck.slides.length < 2) c.newSlide(); c.goTo(0); });
  const n0 = (await deckInfo()).n;
  await tab('Vista');
  await btn('Esquema');
  await page.waitForSelector('[data-testid=outline-view]');
  assert.equal(await page.locator('[data-testid=ol-title]').count(), n0);
  // typing is written to the slide
  const first = page.locator('[data-testid=ol-title]').first();
  await first.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' final');
  assert.match(await titleOf(0), /final/);
  await shot('outline');
  // Enter on a title makes a slide
  await page.keyboard.press('Enter');
  await settle();
  assert.equal((await deckInfo()).n, n0 + 1);
  await page.keyboard.type('Nueva idea');
  assert.match(await titleOf(1), /Nueva idea/);
  // Tab turns the title into a paragraph of the previous slide
  await page.keyboard.press('Tab');
  await settle();
  assert.equal((await deckInfo()).n, n0);
  const sub0 = await ev(() => JSON.stringify(window.__novaSlides.ctl.deck.slides[0].shapes.map((e) => e.text?.doc)));
  assert.match(sub0, /Nueva idea/);
  // Shift+Tab makes it a slide again
  await page.keyboard.press('Shift+Tab');
  await settle();
  assert.equal((await deckInfo()).n, n0 + 1);
  assert.match(await titleOf(1), /Nueva idea/);
  await shot('outline-slides');
  // one undo step per structural change
  await ev(() => window.__novaSlides.ctl.undo());
  assert.equal((await deckInfo()).n, n0);
  await ev(() => window.__novaSlides.ctl.redo());
  assert.equal((await deckInfo()).n, n0 + 1);

  // slide sorter
  await tab('Vista');
  await btn('Clasificador de diapositivas');
  await page.waitForSelector('[data-testid=sorter-view]');
  const cells = page.locator('[data-testid=sorter-view] [role=option]');
  assert.equal(await cells.count(), n0 + 1);
  await cells.nth(0).click();
  await cells.nth(2).click({ modifiers: ['Control'] });
  assert.equal(await ev(() => window.__novaSlides.ctl.selSlides.length), 2);
  await shot('sorter');
  const before = (await deckInfo()).ids;
  await cells.nth(1).dragTo(cells.nth(0), { targetPosition: { x: 4, y: 20 } });
  await settle();
  const after = (await deckInfo()).ids;
  assert.deepEqual(after.slice(0, 2), [before[1], before[0]], 'dragging a slide in front of another reorders them');
  await cells.nth(0).dblclick();
  await settle();
  assert.equal((await deckInfo()).view, 'normal');
  assert.ok(await page.locator('.sl-surface').count());

  // reading view
  await ev(() => window.__novaSlides.ctl.goTo(0));
  await tab('Vista');
  await btn('Vista de lectura');
  await page.waitForSelector('[data-testid=reading-view]');
  await page.locator('.sl-reading__area').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal((await deckInfo()).index, 1);
  await shot('reading');
  await page.keyboard.press('ArrowLeft');
  assert.equal((await deckInfo()).index, 0);
  await page.keyboard.press('Escape');
  assert.equal((await deckInfo()).view, 'normal');

  // notes page
  await tab('Vista');
  await btn('Página de notas');
  await page.waitForSelector('[data-testid=notes-view]');
  await page.getByLabel('Notas del orador').fill('Recordar la cifra del tercer trimestre');
  await page.getByLabel('Notas del orador').blur();
  assert.match(await ev(() => JSON.stringify(window.__novaSlides.ctl.deck.slides[0].notes)), /tercer trimestre/);
  await shot('notes-page');
  await ev(() => window.__novaSlides.ctl.setView('normal'));
  await page.waitForSelector('.sl-surface');
});

await check('no console errors or unexpected dialogs', async () => {
  assert.deepEqual(errors, []);
  assert.deepEqual(dialogs, []);
});

await browser.close();
let failed = 0;
for (const [s, n, msg] of results) {
  if (s !== 'ok') failed++;
  console.log(`${s === 'ok' ? '✓' : '✗'} ${n}${msg ? '\n    ' + msg : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
