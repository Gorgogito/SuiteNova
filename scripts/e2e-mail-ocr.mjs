// End-to-end checks for the text of pictures (OCR) in Nova Mail with the real Tesseract engine: the pictures of received messages, searching the
// mailbox, the dialog with where the text is, big messages, and the pictures of a message being written. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-mail-ocr.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=mail';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-mail-ocr-'));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 2400, height: 950 } })).newPage();
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED|Image too small to scale|Line cannot be recognized/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => d.dismiss().catch(() => {}));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__novaMail, null, { timeout: 60000 });
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
const dialog = () => page.getByRole('dialog');

const png = (kind) =>
  ev(async (kind) => {
    const c = document.createElement('canvas');
    c.width = kind === 'big' ? 1400 : 700;
    c.height = kind === 'big' ? 1000 : 220;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    if (kind === 'big') {
      // noise that does not compress: a message with a lot of picture data
      const d = g.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 256; d.data[i + 1] = Math.random() * 256; d.data[i + 2] = Math.random() * 256; d.data[i + 3] = 255; }
      g.putImageData(d, 0, 0);
    } else {
      g.fillStyle = '#000';
      g.textBaseline = 'top';
      g.font = '48px Arial';
      g.fillText(kind === 'b' ? 'Pedido número 77' : 'Factura número 4821', 30, 30);
      g.fillText(kind === 'b' ? 'Entrega en Lima' : 'Total a pagar 350 euros', 30, 120);
    }
    return c.toDataURL('image/png').split(',')[1];
  }, kind);
const rawWith = (subject, b64, name) =>
  ['From: Ana <ana@x.org>', 'To: yo@x.org', `Subject: ${subject}`, 'Date: Fri, 20 Nov 2026 10:00:00 +0000', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="B"', '',
    '--B', 'Content-Type: text/plain; charset=utf-8', '', 'Mira lo adjunto', '--B', `Content-Type: image/png; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`, 'Content-Transfer-Encoding: base64', '',
    b64.replace(/(.{76})/g, '$1\r\n'), '--B--', ''].join('\r\n');
const importMsg = (raw) => ev((raw) => { const c = window.__novaMail.ctl; const r = c.importRaw(raw, 'inbox', { read: true }); return r.id; }, raw);
const rec = (id) => ev((id) => { const r = window.__novaMail.ctl.data.messages.find((m) => m.id === id); return r ? { ocr: r.ocr ? JSON.parse(JSON.stringify(r.ocr)) : null, imageText: r.imageText ?? null } : null; }, id);
const waitRead = (id) => page.waitForFunction((id) => { const c = window.__novaMail.ctl; const r = c.data.messages.find((m) => m.id === id); return r?.ocr && Object.keys(r.ocr).length > 0 && !c.imageOcr.state.running; }, id, { timeout: 120000 });
const search = (q) => ev((q) => { const c = window.__novaMail.ctl; c.query = q; const ids = c.list().map((m) => m.id); c.query = ''; return ids; }, q);

let a, b, big;
await check('al abrir un mensaje con una imagen se lee sola y se guardan las palabras con su caja', async () => {
  a = await importMsg(rawWith('Factura', await png('a'), 'factura.png'));
  b = await importMsg(rawWith('Pedido', await png('b'), 'pedido.png'));
  assert.deepEqual(await search('total a pagar'), [], 'antes de leer no se encuentra');
  await ev((id) => window.__novaMail.ctl.select(id), a);
  await waitRead(a);
  const r = await rec(a);
  const [k] = Object.keys(r.ocr);
  assert.match(r.ocr[k].text, /Factura/);
  assert.match(r.ocr[k].text, /4821/);
  assert.ok(r.ocr[k].lines.length >= 2);
  assert.match(r.imageText, /total a pagar/);
  await shot('leida');
});

await check('la búsqueda del buzón encuentra lo que está escrito en la imagen (sin importar tildes ni mayúsculas)', async () => {
  assert.deepEqual(await search('TOTAL a pagar'), [a]);
  assert.deepEqual(await search('factura numero'), [a]);
  assert.deepEqual(await search('pedido lima'), [], 'el otro mensaje aún no está leído');
});

await check('el cuadro «Texto de las imágenes del mensaje» señala dónde está lo buscado y lee solo una zona', async () => {
  await page.getByRole('tab', { name: 'Vista', exact: true }).click();
  await page.getByRole('button', { name: 'Texto de las imágenes del mensaje…' }).click();
  const dlg = dialog();
  await dlg.getByLabel('Buscar en el texto de la imagen').fill('total');
  await dlg.locator('rect[data-ocr="found"]').waitFor();
  assert.ok(Number(await dlg.locator('rect[data-ocr="found"]').getAttribute('y')) > 100);
  await shot('dialogo');
  const bb = await dlg.locator('svg[aria-label="Arrastra para elegir la zona que se lee"]').boundingBox();
  await page.mouse.move(bb.x + 2, bb.y + bb.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width - 2, bb.y + bb.height - 2, { steps: 5 });
  await page.mouse.up();
  await dlg.getByRole('button', { name: 'Leer solo la zona' }).click();
  const text = () => ev((id) => { const r = window.__novaMail.ctl.data.messages.find((m) => m.id === id); return Object.values(r.ocr)[0].text; }, a);
  await page.waitForFunction((id) => { const r = window.__novaMail.ctl.data.messages.find((m) => m.id === id); const t = Object.values(r.ocr)[0].text; return /Total/.test(t) && !/Factura/.test(t); }, a);
  await dlg.getByRole('button', { name: 'Quitar la zona' }).click();
  await dlg.getByRole('button', { name: 'Leer con estos ajustes' }).click();
  await page.waitForFunction((id) => { const r = window.__novaMail.ctl.data.messages.find((m) => m.id === id); const t = Object.values(r.ocr)[0].text; return /Factura/.test(t) && /Total/.test(t); }, a);
  assert.match(await text(), /Factura/);
  await dlg.getByRole('button', { name: 'Cerrar' }).click();
});

await check('copiar el texto: el cuadro lo muestra y el botón lo deja en el portapapeles', async () => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Texto de las imágenes del mensaje…' }).click();
  const dlg = dialog();
  await dlg.getByRole('button', { name: 'Copiar el texto' }).click();
  assert.match(await ev(() => navigator.clipboard.readText()), /Factura número 4821/);
  await dlg.getByRole('button', { name: 'Cerrar' }).click();
});

await check('un mensaje con muchos datos de imagen no se lee solo; «Leer las imágenes del mensaje» sí lo lee', async () => {
  big = await importMsg(rawWith('Fotos', await png('big'), 'foto.png'));
  await ev((id) => window.__novaMail.ctl.select(id), big);
  await page.waitForTimeout(4000);
  assert.equal((await rec(big)).ocr, null, 'no debe leerse sola');
  await page.getByRole('tab', { name: 'Vista', exact: true }).click();
  await page.getByRole('button', { name: 'Leer las imágenes del mensaje' }).click();
  await waitRead(big);
  assert.ok((await rec(big)).ocr, 'leída a petición');
});

await check('«Leer las imágenes del buzón» lee las de todos los mensajes y la búsqueda las encuentra', async () => {
  await ev((id) => window.__novaMail.ctl.select(id), a);
  await page.getByRole('button', { name: 'Leer las imágenes del buzón' }).click();
  await waitRead(b);
  assert.deepEqual(await search('pedido lima'), [b]);
});

await check('lo leído se guarda con el buzón y vuelve al abrirlo', async () => {
  const r = await ev(async () => {
    const m = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/mail-core/src/index.ts');
    const c = window.__novaMail.ctl;
    const back = m.parseMailData(m.serializeMail(c.data));
    const x = back.messages.find((q) => q.subject === 'Pedido');
    return { text: Object.values(x.ocr)[0].text, found: m.searchMessages(back, 'entrega en lima', null).length };
  });
  assert.match(r.text, /Pedido/);
  assert.equal(r.found, 1);
});

await check('con «Leer las imágenes al abrir un mensaje» desactivado, un mensaje nuevo no se lee', async () => {
  await page.getByRole('button', { name: 'Leer las imágenes al abrir un mensaje' }).click();
  assert.equal(await ev(() => window.__novaMail.ctl.imageOcr.auto), false);
  const c = await importMsg(rawWith('Otro', await png('b'), 'otro.png'));
  await ev((id) => window.__novaMail.ctl.select(id), c);
  await page.waitForTimeout(3000);
  assert.equal((await rec(c)).ocr, null);
  await page.getByRole('button', { name: 'Leer las imágenes al abrir un mensaje' }).click();
});

await check('una imagen que se está escribiendo en un mensaje: «Texto de la imagen…» la lee y la muestra', async () => {
  const file = path.join(tmp, 'factura.png');
  fs.writeFileSync(file, Buffer.from(await png('a'), 'base64'));
  await page.keyboard.press('Control+Shift+M');
  await page.getByLabel('Para', { exact: true }).fill('bea@x.es');
  await page.getByLabel('Cuerpo del mensaje').fill('Mira esto:\n');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Insertar imagen/ }).click()]);
  await chooser.setFiles(file);
  await page.getByRole('button', { name: 'Texto de la imagen…' }).click();
  const dlg = dialog();
  await page.waitForFunction(() => /Factura/.test(document.querySelector('textarea[aria-label="Texto leído en la imagen"]')?.value ?? ''), null, { timeout: 120000 });
  await shot('redactando');
  await dlg.getByRole('button', { name: 'Cerrar' }).click();
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
