// End-to-end check of narration recording in Nova Slides, with a fake microphone. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-slides-narration.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=slides';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1900, height: 950 }, permissions: ['microphone'] });
const page = await ctx.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => void d.dismiss());
let step = 0;
const shot = async (n) => shotsDir && page.screenshot({ path: `${shotsDir}/nar-${String(++step).padStart(2, '0')}-${n}.png` });
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
    await shot('FAIL-' + name.replace(/\W+/g, '-'));
  }
};
const ev = (f, a) => page.evaluate(f, a);
const settle = (ms = 300) => page.waitForTimeout(ms);
const media = () => ev(() => { const c = window.__novaSlides.ctl; const m = c.slide.shapes.find((e) => e.kind === 'media' && e.name === 'Narración'); return m ? { autoplay: m.autoplay, mime: m.mime, size: c.deck.assets[m.src]?.data.length, head: String.fromCharCode(...c.deck.assets[m.src].data.subarray(0, 4)), adv: c.slide.transition?.advTm } : null; });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.sl-surface');
await page.getByRole('tab', { name: 'Presentación con diapositivas', exact: true }).click();

await check('record, listen and save: a WAV that plays by itself, with advance on the duration', async () => {
  await page.getByRole('button', { name: 'Grabar narración…' }).click();
  await settle(400);
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Grabar', exact: true }).click();
  await page.waitForTimeout(2300);
  await shot('recording');
  assert.match(await d.getByRole('timer').innerText(), /●/);
  await d.getByRole('button', { name: 'Detener' }).click();
  await settle(400);
  assert.ok(await d.locator('audio').count(), 'can listen to it');
  await shot('recorded');
  await d.getByRole('button', { name: 'Guardar', exact: true }).click();
  await settle(500);
  const m = await media();
  assert.ok(m, 'the narration is on the slide');
  assert.equal(m.head, 'RIFF');
  assert.equal(m.autoplay, true);
  assert.ok(m.size > 30000, `${m.size} bytes`);
  assert.ok(m.adv >= 2000 && m.adv < 6000, `advance after ${m.adv} ms`);
});

await check('recording again replaces the narration instead of adding another', async () => {
  await page.getByRole('button', { name: 'Grabar narración…' }).click();
  await settle(400);
  const d = page.getByRole('dialog');
  assert.match(await d.innerText(), /se reemplazará/);
  await d.getByRole('button', { name: 'Grabar', exact: true }).click();
  await page.waitForTimeout(1200);
  await d.getByRole('button', { name: 'Detener' }).click();
  await d.getByRole('button', { name: 'Guardar', exact: true }).click();
  await settle(500);
  assert.equal(await ev(() => window.__novaSlides.ctl.slide.shapes.filter((e) => e.kind === 'media').length), 1);
});

await check('saved in the .pptx and read back with its audio', async () => {
  const bytes = await ev(() => window.__novaSlides.write());
  await ev((b) => window.__novaSlides.load(b), bytes);
  await settle(600);
  const m = await media();
  assert.ok(m, 'the narration survived');
  assert.equal(m.head, 'RIFF');
});

await check('remove the narration', async () => {
  await page.getByRole('button', { name: 'Grabar narración…' }).click();
  await settle(400);
  await page.getByRole('dialog').getByRole('button', { name: 'Quitar la narración' }).click();
  await settle(400);
  assert.equal(await media(), null);
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
