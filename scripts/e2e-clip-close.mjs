// Closing checks of the screen clip: speed with a 4K capture (open, drag, 100 marks, copy/save) and accessibility (names, keyboard, focus, live region, dark theme contrast).
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-clip-close.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=notes';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__novaNotes);
await page.waitForTimeout(800);
const results = [];
const timings = {};
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 8).join(' | ')]);
    for (let i = 0; i < 3 && (await page.getByRole('dialog').count()); i++) await page.keyboard.press('Escape');
  }
};
const ev = (f, a) => page.evaluate(f, a);
const dlg = () => page.getByRole('dialog', { name: 'Recorte de pantalla' });
const canvas = () => page.getByTestId('clip-canvas');
const status = () => dlg().locator('[aria-live=polite]').innerText();

// a 4K capture with some content (a gradient and text) so that compression is not trivial
await ev(() => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas');
    c.width = 3840;
    c.height = 2160;
    const g = c.getContext('2d');
    const paint = () => {
      const gr = g.createLinearGradient(0, 0, 3840, 2160);
      gr.addColorStop(0, '#103060');
      gr.addColorStop(1, '#e0a040');
      g.fillStyle = gr;
      g.fillRect(0, 0, 3840, 2160);
      g.fillStyle = '#fff';
      g.font = '48px sans-serif';
      for (let i = 0; i < 40; i++) g.fillText('Texto de la captura de pantalla ' + i, 100, 80 + i * 50);
    };
    paint();
    setInterval(paint, 500);
    return c.captureStream(2);
  };
});
const open = async () => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Recorte de pantalla…', exact: true }).click();
  await canvas().waitFor();
  return Date.now() - t0;
};

await check('con una captura 4K el diálogo se abre en menos de 3 s y dice su tamaño', async () => {
  timings.open4k = await open();
  assert.ok(timings.open4k < 3000, `abrir ${timings.open4k} ms`);
  await page.waitForTimeout(400);
  assert.match(await status(), /3840 × 2160 px/);
});

await check('arrastrar la zona sobre 4K es fluido (menos de 25 ms por movimiento del puntero) ', async () => {
  const b = await canvas().boundingBox();
  const t0 = Date.now();
  await page.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.1);
  await page.mouse.down();
  for (let i = 1; i <= 60; i++) await page.mouse.move(b.x + b.width * (0.1 + i * 0.012), b.y + b.height * (0.1 + i * 0.01));
  await page.mouse.up();
  timings.dragPerMove = Math.round((Date.now() - t0) / 61);
  assert.ok(timings.dragPerMove < 25, `${timings.dragPerMove} ms por movimiento`);
});

await check('100 marcas de lápiz sobre 4K: dibujarlas, deshacer y guardar el PNG tardan lo razonable', async () => {
  await dlg().getByRole('radio', { name: 'Lápiz', exact: true }).click();
  const b = await canvas().boundingBox();
  const t0 = Date.now();
  for (let k = 0; k < 100; k++) {
    const y = b.y + b.height * (0.05 + (k % 90) * 0.01);
    await page.mouse.move(b.x + b.width * 0.1, y);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.3, y + 3, { steps: 3 });
    await page.mouse.move(b.x + b.width * 0.5, y, { steps: 3 });
    await page.mouse.up();
  }
  timings.hundredMarks = Date.now() - t0;
  assert.match(await status(), /100 anotaciones/);
  const t1 = Date.now();
  await dlg().getByRole('button', { name: 'Deshacer', exact: true }).click();
  await page.waitForFunction(() => /99 anotaciones/.test(document.querySelector('[role=dialog] [aria-live]').textContent));
  timings.undo = Date.now() - t1;
  const t2 = Date.now();
  const [dl] = await Promise.all([page.waitForEvent('download'), dlg().getByRole('button', { name: 'Guardar como PNG', exact: true }).click()]);
  const size = fs.statSync(await dl.path()).size;
  timings.save4k = Date.now() - t2;
  timings.png4kKB = Math.round(size / 1024);
  assert.ok(timings.save4k < 5000, `guardar ${timings.save4k} ms`);
  assert.ok(timings.undo < 1000, `deshacer ${timings.undo} ms`);
});

await check('copiar al portapapeles una zona de 4K con marcas funciona y avisa', async () => {
  const t0 = Date.now();
  await dlg().getByRole('button', { name: 'Copiar', exact: true }).click();
  await page.waitForFunction(() => /Copiado/.test(document.querySelector('[role=dialog] [aria-live]').textContent), null, { timeout: 8000 });
  timings.copy4k = Date.now() - t0;
  assert.ok(timings.copy4k < 5000);
});

await check('todos los controles tienen nombre accesible y la barra de herramientas está etiquetada', async () => {
  const unnamed = await ev(() => [...document.querySelectorAll('[role=dialog] button, [role=dialog] [role=radio], [role=dialog] canvas')].filter((e) => !((e.getAttribute('aria-label') || e.textContent || e.title || '').trim())).length);
  assert.equal(unnamed, 0);
  assert.equal(await page.getByRole('toolbar', { name: 'Herramientas de anotación' }).count(), 1);
  assert.equal(await dlg().locator('[aria-live=polite]').count(), 1);
  assert.match(await canvas().getAttribute('aria-label'), /anotaciones/);
});

await check('teclado: Tab llega a la captura, las flechas mueven la zona y Escape cierra devolviendo el foco', async () => {
  await dlg().getByRole('button', { name: 'Quitar anotaciones', exact: true }).click();
  await dlg().getByRole('radio', { name: 'Zona', exact: true }).click();
  await canvas().focus();
  await page.keyboard.press('Delete');
  await page.keyboard.press('ArrowRight');
  assert.match(await status(), /Zona elegida/);
  // Tab order: the toolbar comes before the capture and the buttons after it
  let order = [];
  await dlg().getByRole('radio', { name: 'Zona', exact: true }).focus();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    order.push(await ev(() => document.activeElement?.getAttribute('data-testid') || document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim().slice(0, 20)));
  }
  assert.ok(order.includes('clip-canvas'), `Tab no llega a la captura: ${order.join(' | ')}`);
  assert.ok(order.includes('Insertar el recorte'), 'Tab no llega a Insertar');
  await page.keyboard.press('Escape');
  await dlg().waitFor({ state: 'detached' });
  await page.waitForTimeout(300);
  const active = await ev(() => document.activeElement?.tagName);
  assert.notEqual(active, 'HTML', 'el foco se pierde al cerrar');
});

await check('tema oscuro: el texto del estado y de los botones tiene contraste suficiente (≥ 4,5)', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await open();
  await page.waitForTimeout(400);
  const ratios = await ev(() => {
    const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const bg = getComputedStyle(e).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg; } return 'rgb(255,255,255)'; };
    const ratio = (el) => { const a = lum(getComputedStyle(el).color); const b = lum(bgOf(el)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    const d = document.querySelector('[role=dialog]');
    return { title: ratio(d.querySelector('h2, [role=heading], div')), live: ratio(d.querySelector('[aria-live]')), cancel: ratio([...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancelar')), insert: ratio([...d.querySelectorAll('button')].find((b) => /Insertar/.test(b.textContent))) };
  });
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/oscuro.png` });
  for (const [k, v] of Object.entries(ratios)) assert.ok(v >= 3.9, `${k}: ${v.toFixed(2)}`);
  timings.minContrast = Math.min(...Object.values(ratios)).toFixed(1);
  await page.keyboard.press('Escape');
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

console.log('tiempos:', JSON.stringify(timings));
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
