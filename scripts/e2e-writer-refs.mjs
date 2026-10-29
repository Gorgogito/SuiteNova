// End-to-end checks for footnotes, table of contents, captions, cross references, citations and index. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-refs.mjs [--shots dir]
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
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(500);
const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 700) => page.waitForTimeout(ms);
const tab = (n) => page.getByRole('tab', { name: n, exact: true }).click();
const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';
const setDoc = (blocks) =>
  ev(
    ([b]) => {
      const { ctl } = window.__novaWriter;
      const v = ctl.mainView;
      const S = v.state.schema;
      const mk = (x) => S.node('paragraph', x.attrs ?? null, x.kids ? x.kids.map((k) => (typeof k === 'string' ? S.text(k) : S.nodeFromJSON(k))) : x.text ? [S.text(x.text)] : []);
      v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, S.node('section', v.state.doc.child(0).attrs, b.map(mk))).setMeta('nw-load', true));
    },
    [blocks],
  );
const noteJson = (id, text) => ({ type: 'footnote', attrs: { kind: 'footnote', id, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } } });

await check('footnotes: insert, write the text, shown at the bottom of the page and numbered', async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await settle();
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Texto con una nota');
  await tab('Referencias');
  await page.getByRole('button', { name: 'Insertar nota al pie' }).click();
  await page.locator('.nw-notepop .ProseMirror').waitFor();
  await page.keyboard.type('Esta es la nota al pie');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Listo' }).click();
  await settle();
  assert.equal(await page.locator('.ProseMirror .nw-fnref').count(), 1);
  assert.equal(await page.locator('.nw-fn-area').count(), 1);
  assert.match(await page.locator('.nw-fn-area').innerText(), /Esta es la nota al pie/);
  assert.equal(await page.locator('.nw-fn-area .nw-fn-num').first().innerText(), '1');
  await shot('footnote');
  // a second note, numbered 2; editing in place from the bottom of the page
  await ev(() => window.__novaWriter.ctl.insertNote('footnote'));
  await page.locator('.nw-notepop .ProseMirror').waitFor();
  await page.keyboard.type('Segunda');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Listo' }).click();
  await settle();
  const nums = await page.locator('.nw-fn-area .nw-fn-num').allInnerTexts();
  assert.deepEqual(nums, ['1', '2']);
  await page.locator('.nw-fn-area [data-id]').first().dblclick();
  await page.locator('.nw-notepop .ProseMirror').waitFor();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' (editada)');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Listo' }).click();
  await settle();
  assert.match(await page.locator('.nw-fn-area').innerText(), /\(editada\)/);
});

await check('footnotes reserve room at the bottom of their page and survive long texts', async () => {
  await setDoc([
    { kids: ['Primero ', noteJson('a', 'Nota larga. ' + lorem.repeat(3)), ' fin.'] },
    ...Array.from({ length: 40 }, () => ({ text: lorem.repeat(3) })),
    { kids: ['Segunda ', noteJson('b', 'Otra nota. ' + lorem.repeat(2))] },
  ]);
  await settle(900);
  const info = await ev(() => {
    const { ctl } = window.__novaWriter;
    const sheet = document.querySelector('.nw-sheet');
    const sc = sheet.getBoundingClientRect().width / sheet.offsetWidth;
    const top0 = sheet.getBoundingClientRect().top;
    const areas = [...document.querySelectorAll('.nw-fn-area')].map((a) => ({ top: (a.getBoundingClientRect().top - top0) / sc, bottom: (a.getBoundingClientRect().bottom - top0) / sc }));
    const rects = ctl.pageRects();
    let bad = 0;
    const lines = [];
    for (const p of document.querySelectorAll('.ProseMirror section > p')) {
      const r = document.createRange();
      r.selectNodeContents(p);
      for (const q of r.getClientRects()) if (q.height < 60) lines.push([(q.top - top0) / sc, (q.bottom - top0) / sc]);
    }
    areas.forEach((a) => {
      const pg = rects.findIndex((r) => a.top >= r.top && a.top < r.top + r.height);
      for (const [t, b] of lines) if (t >= rects[pg].top && t < rects[pg].top + rects[pg].height && b > a.top + 1 && t < a.bottom - 1) bad++;
    });
    return { pages: ctl.pages, notes: ctl.pageSpecs.map((p) => p.notes.length), areas: areas.length, bad };
  });
  assert.equal(info.areas, 2, JSON.stringify(info));
  assert.equal(info.bad, 0, `text overlaps the footnote area: ${JSON.stringify(info)}`);
  assert.ok(info.pages >= 2);
  await shot('footnotes-pages');
});

await check('endnotes appear at the end of the document with roman numerals', async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await settle();
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Texto con nota final');
  await ev(() => window.__novaWriter.ctl.insertNote('endnote'));
  await page.locator('.nw-notepop .ProseMirror').waitFor();
  await page.keyboard.type('Contenido de la nota final');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Listo' }).click();
  await settle();
  assert.match(await page.locator('.nw-endnotes').innerText(), /Contenido de la nota final/);
  assert.equal(await page.locator('.nw-endnotes .nw-fn-num').first().innerText(), 'i');
});

await check('table of contents: headings, page numbers, links and update', async () => {
  await setDoc([
    { text: 'Introducción', attrs: { style: 'Heading1' } },
    { text: lorem.repeat(8) },
    ...Array.from({ length: 30 }, () => ({ text: lorem.repeat(3) })),
    { text: 'Desarrollo', attrs: { style: 'Heading1' } },
    { text: 'Subtema', attrs: { style: 'Heading2' } },
    { text: lorem },
  ]);
  await settle();
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+Home');
  await tab('Referencias');
  await page.locator('[data-nv-item="tocMenu"]').click();
  await page.getByRole('menuitem', { name: 'Tabla de contenido automática' }).click();
  await settle(1800);
  const toc = await ev(() => [...document.querySelectorAll('.nw-gen-toc p')].map((p) => p.innerText.replace(/\s+/g, ' ').trim()));
  assert.equal(toc[0], 'Contenido');
  assert.equal(toc.length, 4, JSON.stringify(toc));
  assert.match(toc[1], /^Introducción/);
  const pages = toc.slice(1).map((l) => l.match(/(\d+)$/)?.[1]);
  assert.ok(pages.every(Boolean), JSON.stringify(toc));
  assert.equal(pages[0], '1');
  assert.ok(Number(pages[1]) >= 2, JSON.stringify(pages));
  assert.equal(pages[1], pages[2]);
  const lines = await ev(() => [...document.querySelectorAll('.nw-gen-toc p[data-tabs]')].map((p) => ({ w: p.querySelector('.nw-tab')?.getBoundingClientRect().width ?? 0, bg: p.querySelector('.nw-tab')?.style.backgroundImage ?? '' })));
  assert.ok(lines.length === 3 && lines.every((l) => l.w > 50 && /radial/.test(l.bg)), JSON.stringify(lines));
  await shot('toc');
  assert.equal((await page.locator('.nw-gen-toc a[href^="#_Toc"]').count()) >= 3, true);
  // change a heading and update
  await ev(() => {
    const v = window.__novaWriter.ctl.mainView;
    let target;
    v.state.doc.descendants((n, pos) => {
      if (n.attrs.style === 'Heading1' && n.textContent === 'Desarrollo') target = pos;
      return true;
    });
    v.dispatch(v.state.tr.insertText(' ampliado', target + 2 + 'Desarrollo'.length));
  });
  await page.getByRole('button', { name: 'Actualizar tabla' }).click();
  await settle(1800);
  const after = await ev(() => [...document.querySelectorAll('.nw-gen-toc p')].map((p) => p.innerText));
  assert.ok(after.some((l) => l.includes('Desarrollo ampliado')), JSON.stringify(after));
});

await check('captions number figures, cross references and table of figures follow', async () => {
  await setDoc([{ text: 'Introducción', attrs: { style: 'Heading1' } }, { text: 'Primer párrafo.' }, { text: 'Otro párrafo.' }]);
  await settle();
  await page.locator('.ProseMirror p').first().click();
  await tab('Referencias');
  await page.getByRole('button', { name: 'Insertar título…' }).click();
  await page.locator('#nw-cap-text').fill('Un gráfico');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await settle();
  await page.locator('.ProseMirror p').last().click();
  await page.getByRole('button', { name: 'Insertar título…' }).click();
  await page.locator('#nw-cap-text').fill('Otro gráfico');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await settle();
  const caps = await ev(() => [...document.querySelectorAll('.ProseMirror p.nw-style-Caption')].map((p) => p.innerText));
  assert.deepEqual(caps, ['Figura 1: Un gráfico', 'Figura 2: Otro gráfico']);
  await page.locator('.ProseMirror p').nth(1).click();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Referencia cruzada…' }).click();
  await page.locator('#nw-xr-kind').selectOption('caption');
  await page.locator('#nw-xr-list').selectOption({ index: 1 });
  await page.locator('#nw-xr-what').selectOption('label');
  await page.getByRole('dialog').getByRole('button', { name: 'Insertar', exact: true }).click();
  await settle();
  const ref = await ev(() => [...document.querySelectorAll('.ProseMirror .nw-field-ref')].map((e) => e.textContent));
  assert.deepEqual(ref, ['Figura 2']);
  await page.locator('.ProseMirror p').first().click();
  await page.getByRole('button', { name: 'Insertar título…' }).click();
  await page.locator('#nw-cap-pos').selectOption('above');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await settle();
  await page.getByRole('button', { name: 'Actualizar campos' }).click();
  await settle(900);
  const caps2 = await ev(() => [...document.querySelectorAll('.ProseMirror p.nw-style-Caption')].map((p) => p.innerText.split(':')[0].trim()));
  assert.deepEqual(caps2, ['Figura 1', 'Figura 2', 'Figura 3']);
  const ref2 = await ev(() => [...document.querySelectorAll('.ProseMirror .nw-field-ref')].map((e) => e.textContent));
  assert.deepEqual(ref2, ['Figura 3']);
  await shot('captions');
  await page.locator('.ProseMirror p').last().click();
  await page.getByRole('button', { name: 'Insertar tabla de ilustraciones…' }).click();
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await settle(1500);
  const tof = await ev(() => [...document.querySelectorAll('.nw-gen-tof p')].map((p) => p.innerText.replace(/\s+/g, ' ')));
  assert.equal(tof.length, 4, JSON.stringify(tof));
  assert.match(tof[1], /^Figura 1/);
});

await check('citations and bibliography follow the chosen style', async () => {
  await setDoc([{ text: 'Como dice la teoría' }]);
  await settle();
  await ev(() => {
    const { ctl } = window.__novaWriter;
    ctl.sources = [
      { tag: 'Smith2020', type: 'book', authors: ['Smith, John'], title: 'Un libro importante', year: '2020', publisher: 'Editorial Uno', city: 'Madrid', journal: '', volume: '', issue: '', pages: '', url: '', accessed: '', doi: '', edition: '' },
      { tag: 'Lopez2018', type: 'article', authors: ['López, Ana'], title: 'Un artículo', year: '2018', publisher: '', city: '', journal: 'Revista', volume: '12', issue: '3', pages: '45-67', url: '', accessed: '', doi: '', edition: '' },
    ];
    ctl.touch();
  });
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await tab('Referencias');
  await page.getByRole('button', { name: 'Insertar cita…' }).click();
  await page.getByRole('checkbox', { name: /Smith/ }).check();
  await page.locator('#nw-cite-pages').fill('15');
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await settle();
  assert.equal(await page.locator('.ProseMirror .nw-field-citation').first().innerText(), '(Smith, 2020, p. 15)');
  await page.getByRole('button', { name: 'Insertar bibliografía' }).click();
  await settle(1200);
  let bib = await ev(() => [...document.querySelectorAll('.nw-gen-bibliography p')].map((p) => p.innerText));
  assert.deepEqual(bib, ['Referencias', 'Smith, J. (2020). Un libro importante. Editorial Uno.']);
  await page.locator('[data-nv-item="citeStyleMenu"]').click();
  await page.getByRole('menuitem', { name: 'IEEE (numérico)' }).click();
  await settle(1200);
  assert.equal(await page.locator('.ProseMirror .nw-field-citation').first().innerText(), '[1, p. 15]');
  bib = await ev(() => [...document.querySelectorAll('.nw-gen-bibliography p')].map((p) => p.innerText));
  assert.match(bib[1], /^\[1\] J\. Smith/);
  await shot('bibliography');
});

await check('index: mark entries and build the alphabetical index', async () => {
  await setDoc([{ text: 'Los gatos son animales.' }, { text: lorem.repeat(25) }, { text: 'Otro gato más.' }]);
  await settle();
  await page.locator('.ProseMirror p').first().click();
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
  await tab('Referencias');
  await page.getByRole('button', { name: 'Marcar entrada…' }).click();
  await page.locator('#nw-ix-main').fill('Gatos');
  await page.getByRole('button', { name: 'Marcar', exact: true }).click();
  await settle();
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Marcar entrada…' }).click();
  await page.locator('#nw-ix-main').fill('Gatos');
  await page.getByRole('button', { name: 'Marcar', exact: true }).click();
  await settle();
  await page.locator('.ProseMirror p').last().click();
  await page.getByRole('button', { name: 'Insertar índice' }).click();
  await settle(1500);
  const idx = await ev(() => [...document.querySelectorAll('.nw-gen-index p')].map((p) => p.innerText.replace(/\s+/g, ' ')));
  assert.ok(idx.includes('G') && idx.some((l) => /^Gatos, 1/.test(l)), JSON.stringify(idx));
});

await check('no console errors', async () => {
  assert.deepEqual(errors, []);
});
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
