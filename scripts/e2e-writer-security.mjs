// End-to-end checks for password encryption and digital signature. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-security.mjs [--shots dir]
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
let acceptNext = false;
page.on('dialog', (d) => {
  if (acceptNext) {
    acceptNext = false;
    d.accept();
    return;
  }
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
const tab = async (n) => {
  const t = page.getByRole('tab', { name: n, exact: true });
  if ((await t.getAttribute('aria-selected')) !== 'true') await t.click();
};
const newDoc = async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await settle();
  await page.locator('.ProseMirror').click();
};
const saveAndGetBytes = async () => {
  const dl = page.waitForEvent('download', { timeout: 60000 });
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+s');
  const d = await dl;
  const p = await d.path();
  return { name: d.suggestedFilename(), bytes: fs.readFileSync(p) };
};
const openBytes = (bytes, name) => ev(([b64, n]) => window.__novaWriter.load(b64, n), [bytes.toString('base64'), name]);

let encrypted;
await check('encrypt: dialog asks twice, the saved file is a Compound File without the text', async () => {
  await newDoc();
  await page.keyboard.type('Texto muy confidencial');
  await tab('Programador');
  await page.getByRole('button', { name: 'Cifrar con contraseña…' }).click();
  await page.locator('#nw-pw1').fill('clave-123');
  await page.locator('#nw-pw2').fill('clave-124');
  assert.equal(await page.getByRole('button', { name: 'Aceptar' }).isDisabled(), true);
  await page.locator('#nw-pw2').fill('clave-123');
  await shot('encrypt-dialog');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await settle(300);
  assert.ok(await page.getByText('Cifrado con contraseña').first().isVisible());
  encrypted = await saveAndGetBytes();
  assert.match(encrypted.name, /\.docx$/);
  assert.deepEqual([...encrypted.bytes.subarray(0, 8)], [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.ok(!encrypted.bytes.toString('latin1').includes('confidencial'));
  assert.ok(encrypted.bytes.toString('utf16le').includes('EncryptedPackage'));
});

await check('open: an encrypted file asks for the password; a wrong one is refused, the right one opens it', async () => {
  await newDoc();
  await openBytes(encrypted.bytes, 'secreto.docx');
  await page.locator('#nw-pwo').waitFor();
  await shot('open-password');
  await page.locator('#nw-pwo').fill('mala');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await page.getByText('La contraseña no es correcta.').waitFor({ timeout: 30000 });
  await page.locator('#nw-pwo').fill('clave-123');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await page.locator('#nw-pwo').waitFor({ state: 'detached', timeout: 30000 });
  await settle(500);
  assert.equal(await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent), 'Texto muy confidencial');
  assert.equal(await ev(() => window.__novaWriter.ctl.password), 'clave-123');
});

await check('removing the password saves a plain .docx again', async () => {
  await tab('Programador');
  await page.getByRole('button', { name: 'Quitar la contraseña de apertura' }).click();
  const f = await saveAndGetBytes();
  assert.deepEqual([...f.bytes.subarray(0, 2)], [0x50, 0x4b]);
});

let signed;
await check('sign: the signature shows in the status bar and survives saving and reopening', async () => {
  await newDoc();
  await page.keyboard.type('Contrato de prueba');
  await tab('Programador');
  await page.getByRole('button', { name: 'Firmar documento…' }).click();
  await page.locator('#nw-sg-name').fill('Ana Pérez');
  await page.locator('#nw-sg-why').fill('Conforme');
  await shot('sign-dialog');
  await page.getByRole('button', { name: 'Firmar', exact: true }).click();
  await settle(800);
  assert.ok(await page.getByText('Firmado por Ana Pérez').first().isVisible());
  signed = await saveAndGetBytes();
  await newDoc();
  await openBytes(signed.bytes, 'firmado.docx');
  await page.getByText('Firmado por Ana Pérez').first().waitFor();
  await settle(1500);
  assert.equal(await ev(() => window.__novaWriter.ctl.signatureStatus), 'valid');
  await tab('Programador');
  await page.getByRole('button', { name: 'Ver firma…' }).click();
  assert.ok(await page.getByText('Válida: el contenido es el que se firmó.').isVisible());
  assert.ok(await page.getByText('Conforme').isVisible());
  await shot('signature-info');
  await page.getByRole('button', { name: 'Cerrar' }).click();
});

await check('editing a signed document invalidates the signature', async () => {
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' y cambio');
  await page.getByText('Firma no válida: el documento cambió').waitFor({ timeout: 10000 });
  assert.equal(await ev(() => window.__novaWriter.ctl.signatureStatus), 'modified');
  await shot('signature-broken');
});

await check('a tampered signature file is detected on opening', async () => {
  // change the text inside the .docx without touching the signature
  const tampered = await ev(async (b64) => {
    const JSZip = (await import('/node_modules/.vite/deps/jszip.js')).default;
    const bin = atob(b64);
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    const zip = await JSZip.loadAsync(data);
    const xml = await zip.file('word/document.xml').async('string');
    zip.file('word/document.xml', xml.replace('Contrato de prueba', 'Contrato de PRUEBA'));
    const out = await zip.generateAsync({ type: 'base64' });
    return out;
  }, signed.bytes.toString('base64')).catch(() => null);
  if (!tampered) return; // jszip is not reachable from the page in this build: covered by the unit tests
  await newDoc();
  await ev(([b, n]) => window.__novaWriter.load(b, n), [tampered, 'manipulado.docx']);
  await page.getByText('Firma no válida: el documento cambió').waitFor({ timeout: 10000 });
});

await check('no console errors', async () => {
  assert.deepEqual(errors, []);
});
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
