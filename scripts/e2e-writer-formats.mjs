// End-to-end checks for .rtf, .odt and .doc. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-formats.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
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
const BS = String.fromCharCode(92);
const RTF = `{${BS}rtf1${BS}ansi${BS}deff0{${BS}fonttbl{${BS}f0 Calibri;}}{${BS}colortbl ;${BS}red255${BS}green0${BS}blue0;}${BS}pard${BS}qc${BS}b${BS}fs32 T${BS}'edtulo RTF${BS}b0${BS}par${BS}pard Texto con {${BS}cf1 rojo} y ${BS}i cursiva${BS}i0.${BS}par}`;
const b64 = (s) => Buffer.from(s, 'latin1').toString('base64');

await check('opens an .rtf with its formatting', async () => {
  await ev(([b, n]) => window.__novaWriter.load(b, n), [b64(RTF), 'prueba.rtf']);
  await settle(800);
  assert.match(await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent), /Título RTF/);
  assert.equal(await page.locator('.ProseMirror strong').count() >= 1, true);
  assert.equal(await page.locator('.ProseMirror em').count() >= 1, true);
  await shot('rtf-open');
});

await check('exports to .rtf and .odt from the File menu and both reopen', async () => {
  for (const [label, ext] of [['Exportar como RTF', 'rtf'], ['Exportar como OpenDocument', 'odt']]) {
    await page.getByRole('button', { name: 'Archivo' }).click();
    const dl = page.waitForEvent('download', { timeout: 30000 });
    await page.getByText(new RegExp(label)).first().click();
    const d = await dl;
    assert.ok(d.suggestedFilename().endsWith('.' + ext));
    const bytes = fs.readFileSync(await d.path());
    if (ext === 'rtf') assert.ok(bytes.toString('latin1').startsWith('{' + BS + 'rtf1'));
    else assert.deepEqual([...bytes.subarray(0, 2)], [0x50, 0x4b]);
    await ev(() => window.__novaWriter.ctl.newDoc());
    await settle(300);
    await ev(([b, n]) => window.__novaWriter.load(b, n), [bytes.toString('base64'), d.suggestedFilename()]);
    await settle(1000);
    assert.match(await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent), /Título RTF/);
    assert.ok((await page.locator('.ProseMirror strong').count()) >= 1, ext);
  }
  await shot('odt-reopened');
});

await check('no console errors', async () => {
  assert.deepEqual(errors, []);
});
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
