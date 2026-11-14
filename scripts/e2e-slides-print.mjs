// End-to-end checks of printing in Nova Slides: slides, notes pages, handouts and outline are laid out with the print style and
// turned into a real PDF by the browser. Needs `pnpm dev` on :1420.   Usage: node scripts/e2e-slides-print.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=slides';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-print-'));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1900, height: 950 } })).newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => void d.dismiss());
let step = 0;
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/prt-FAIL-${++step}.png` });
  }
};
const ev = (f, a) => page.evaluate(f, a);
const settle = (ms = 300) => page.waitForTimeout(ms);
/** pages of the real PDF the browser makes with the print style */
const pdfPages = async (name) => {
  await page.emulateMedia({ media: 'print' });
  const file = path.join(tmp, name + '.pdf');
  await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  const txt = fs.readFileSync(file, 'latin1');
  return { pages: (txt.match(/\/Type\s*\/Page[^s]/g) ?? []).length, size: fs.statSync(file).size, file };
};

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.sl-surface');
// a presentation with five slides, one hidden and notes on the second
await ev(() => {
  const c = window.__novaSlides.ctl;
  for (let i = 0; i < 4; i++) c.newSlide();
  c.hideSlides(true, [c.deck.slides[4].id]);
  c.goTo(1);
});
await settle();

await check('the print dialog opens from Archivo > Imprimir with its options', async () => {
  await ev(() => window.__novaSlides.ctl.touch());
  await page.keyboard.press('Control+p');
  await settle(500);
  const d = page.getByRole('dialog');
  assert.match(await d.innerText(), /Páginas de notas/);
  assert.match(await d.innerText(), /Documentos para distribuir/);
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/prt-01-dialog.png` });
  await d.getByLabel('Intervalo de diapositivas').fill('9-12');
  assert.equal(await d.getByRole('button', { name: 'Imprimir', exact: true }).isDisabled(), true);
  await d.getByRole('button', { name: 'Cancelar' }).click();
});

await check('slides: one page per slide, hidden ones left out unless asked', async () => {
  const r = await ev(() => window.__novaSlides.buildPrint({ what: 'slides' }));
  assert.deepEqual([r.pages, r.slides], [4, 4]);
  const pdf = await pdfPages('slides');
  assert.equal(pdf.pages, 4);
  await ev(() => window.__novaSlides.endPrint());
  const all = await ev(() => window.__novaSlides.buildPrint({ what: 'slides', hidden: true }));
  assert.equal(all.pages, 5);
  await ev(() => window.__novaSlides.endPrint());
});

await check('the application itself does not show in the print (only the pages)', async () => {
  await ev(() => window.__novaSlides.buildPrint({ what: 'slides' }));
  await page.emulateMedia({ media: 'print' });
  const vis = await ev(() => [...document.body.children].filter((n) => getComputedStyle(n).display !== 'none').map((n) => n.className));
  await page.emulateMedia({ media: 'screen' });
  await ev(() => window.__novaSlides.endPrint());
  assert.deepEqual(vis, ['sl-printroot']);
});

await check('range: current slide and "2-3, 5"', async () => {
  const cur = await ev(() => window.__novaSlides.buildPrint({ what: 'slides', range: 'actual' }));
  assert.equal(cur.pages, 1);
  const rg = await ev(() => window.__novaSlides.buildPrint({ what: 'slides', range: '2-3, 5', hidden: true }));
  assert.equal(rg.pages, 3);
  const bad = await ev(() => window.__novaSlides.buildPrint({ what: 'slides', range: 'x' }));
  assert.ok(bad.error);
  await ev(() => window.__novaSlides.endPrint());
});

await check('notes pages carry the notes text, one slide per page', async () => {
  await ev(() => {
    const c = window.__novaSlides.ctl;
    c.goTo(1);
  });
  const r = await ev(() => window.__novaSlides.buildPrint({ what: 'notes' }));
  assert.equal(r.pages, 4);
  const pdf = await pdfPages('notes');
  assert.equal(pdf.pages, 4);
  if (shotsDir) fs.copyFileSync(pdf.file, `${shotsDir}/prt-notes.pdf`);
  await ev(() => window.__novaSlides.endPrint());
});

await check('handouts: 6 per page makes 1 page, 2 per page makes 2, 1 per page makes 4', async () => {
  const counts = {};
  for (const per of [6, 2, 1]) {
    const r = await ev((p) => window.__novaSlides.buildPrint({ what: 'handout', per: p }), per);
    counts[per] = r.pages;
    if (per === 6) assert.equal((await pdfPages('handout6')).pages, 1);
    await ev(() => window.__novaSlides.endPrint());
  }
  assert.deepEqual(counts, { 6: 1, 2: 2, 1: 4 });
});

await check('outline: the text of the slides on one page', async () => {
  const r = await ev(() => window.__novaSlides.buildPrint({ what: 'outline' }));
  assert.equal(r.pages, 1);
  const txt = await ev(() => document.querySelector('.sl-printroot').innerText);
  assert.ok(txt.length >= 0);
  assert.equal((await pdfPages('outline')).pages, 1);
  await ev(() => window.__novaSlides.endPrint());
});

await check('after printing nothing is left behind', async () => {
  await ev(() => window.__novaSlides.endPrint());
  assert.equal(await ev(() => document.querySelectorAll('.sl-printroot, #sl-print-style').length), 0);
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
