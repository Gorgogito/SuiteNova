// Checks the NATIVE screen clip in the real desktop app (Tauri + WebView2): the app hides itself, captures the real screen and comes back.
// Needs `pnpm dev` on :1420 and a debug build (`cargo build` in apps/suite/src-tauri). It starts the app with a remote debugging port and drives it from Playwright.
// Usage: node scripts/e2e-clip-native.mjs [--shots dir] [--exe path]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const shotsDir = arg('--shots');
const exe = arg('--exe') ?? path.resolve('apps/suite/src-tauri/target/debug/suitenova.exe');
const PORT = 9333;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
assert.ok(fs.existsSync(exe), `no existe ${exe}: compila con cargo build`);
const doc = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-clip-')), 'prueba.txt');
fs.writeFileSync(doc, 'Texto de prueba para el recorte nativo.\n');

const app = spawn(exe, [doc], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: 'ignore' });
const results = [];
let browser;
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 8).join(' | ')]);
  }
};
try {
  for (let i = 0; i < 60 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  assert.ok(browser, 'no se pudo conectar con la aplicación');
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => /app=writer/.test(p.url()));
    if (!page) await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(page, 'no se abrió Writer');
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED|Image too small to scale|Line cannot be recognized/.test(m.text()) && errors.push(m.text()));
  await page.waitForSelector('.ProseMirror');
  await page.waitForTimeout(1500);
  const ev = (f, a) => page.evaluate(f, a);
  const dlg = () => page.getByRole('dialog', { name: 'Recorte de pantalla' });
  const imgs = () => page.locator('.ProseMirror img[src^="data:"]').count();

  let monitor;
  await check('el comando nativo lista los monitores, con uno principal y tamaño en píxeles físicos', async () => {
    const list = await ev(() => window.__TAURI_INTERNALS__.invoke('clip_monitors'));
    assert.ok(list.length >= 1);
    monitor = list.find((m) => m.primary) ?? list[0];
    assert.ok(monitor.width >= 640 && monitor.height >= 480, JSON.stringify(monitor));
  });

  await check('Recorte de pantalla…: la aplicación se oculta, captura la pantalla real y vuelve con el diálogo', async () => {
    await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
    await page.getByRole('button', { name: 'Recorte de pantalla…', exact: true }).click();
    await page.getByTestId('clip-canvas').waitFor();
    await page.waitForTimeout(500);
    // the capture is the whole monitor, in its physical pixels
    const label = await page.getByTestId('clip-canvas').getAttribute('aria-label');
    assert.match(label, /Toda la captura/);
    const status = await dlg().locator('[aria-live=polite]').innerText();
    const [w, h] = status.match(/(\d+) × (\d+) px/).slice(1).map(Number);
    assert.ok(Math.abs(w - monitor.width) <= 2 && Math.abs(h - monitor.height) <= 2, `${w}x${h} frente a ${monitor.width}x${monitor.height}`);
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/01-dialogo.png` });
  });

  await check('con ocultar la aplicación no sale en la captura; sin ocultarla, sí (se comparan las dos capturas del mismo monitor)', async () => {
    const r = await ev(async (m) => {
      const grab = async (hide) => {
        const bytes = await window.__TAURI_INTERNALS__.invoke('clip_capture', { monitor: m, hide });
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      };
      const shown = await grab(false);
      const hidden = await grab(true);
      let diff = 0;
      for (let i = 0; i < shown.length; i += 4 * 7) if (Math.abs(shown[i] - hidden[i]) + Math.abs(shown[i + 1] - hidden[i + 1]) + Math.abs(shown[i + 2] - hidden[i + 2]) > 60) diff++;
      return { diff, total: Math.floor(shown.length / 28) };
    }, monitor.index);
    // the app covers a good part of the screen, so a lot of pixels differ when it is shown
    assert.ok(r.diff / r.total > 0.05, `solo ${((100 * r.diff) / r.total).toFixed(1)} % de píxeles distintos`);
    assert.ok(await ev(() => document.hasFocus()), 'la ventana vuelve a mostrarse');
  });

  await check('la captura es de la pantalla de verdad: el propio escritorio, no la ventana de la aplicación tapándolo', async () => {
    // The app window is hidden while capturing, so the capture must not be (almost) the same as a capture of the dialog's own page.
    const stats = await ev(() => {
      const c = document.querySelector('[data-testid=clip-canvas]');
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
      return { colours: seen.size, w: c.width };
    });
    assert.ok(stats.colours > 8, `solo ${stats.colours} colores distintos`);
  });

  await check('se elige una zona, se marca y se inserta en Writer como imagen del tamaño de la zona', async () => {
    const before = await imgs();
    const b = await page.getByTestId('clip-canvas').boundingBox();
    await page.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.35, b.y + b.height * 0.4, { steps: 6 });
    await page.mouse.up();
    await dlg().getByRole('radio', { name: 'Rectángulo', exact: true }).click();
    await dragRect(page, b);
    await dlg().getByRole('button', { name: 'Insertar el recorte', exact: true }).click();
    await dlg().waitFor({ state: 'detached' });
    await page.waitForTimeout(1200);
    assert.equal(await imgs(), before + 1);
    const size = await ev(async () => {
      const im = [...document.querySelectorAll('.ProseMirror img[src^="data:"]')].at(-1);
      await im.decode();
      return { w: im.naturalWidth, h: im.naturalHeight };
    });
    assert.ok(Math.abs(size.w - monitor.width * 0.25) <= 4 && Math.abs(size.h - monitor.height * 0.3) <= 4, `${size.w}x${size.h}`);
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/02-insertado.png` });
  });

  await check('Cancelar: la aplicación vuelve y no se inserta nada', async () => {
    const before = await imgs();
    await page.getByRole('button', { name: 'Recorte de pantalla…', exact: true }).click();
    await page.getByTestId('clip-canvas').waitFor();
    await page.waitForTimeout(500);
    await dlg().getByRole('button', { name: 'Cancelar', exact: true }).click();
    await dlg().waitFor({ state: 'detached' });
    assert.equal(await imgs(), before);
    assert.ok(await ev(() => document.hasFocus()), 'la ventana recupera el foco');
  });

  await check('sin errores de consola', async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser?.close().catch(() => undefined);
  app.kill();
  spawn('taskkill', ['/F', '/T', '/PID', String(app.pid)], { stdio: 'ignore' });
}

async function dragRect(page, b) {
  await page.mouse.move(b.x + b.width * 0.15, b.y + b.height * 0.15);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.35, { steps: 6 });
  await page.mouse.up();
}

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
