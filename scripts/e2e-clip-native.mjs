// Checks the NATIVE screen clip in the real desktop app (Tauri + WebView2): the app hides itself, freezes the screen, the area is dragged on the real screen
// (a borderless window over each monitor), and the dialog opens on it. Needs `pnpm dev` on :1420 and a debug build (`cargo build` in apps/suite/src-tauri).
// It starts the app with a remote debugging port and drives it from Playwright. Usage: node scripts/e2e-clip-native.mjs [--shots dir] [--exe path]
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (let i = 0; i < 60 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    } catch {
      await sleep(1000);
    }
  }
  assert.ok(browser, 'no se pudo conectar con la aplicación');
  const pages = () => browser.contexts().flatMap((c) => c.pages());
  const find = (re) => pages().find((p) => re.test(p.url()));
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    page = find(/app=writer/);
    if (!page) await sleep(500);
  }
  assert.ok(page, 'no se abrió Writer');
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED|Image too small to scale|Line cannot be recognized/.test(m.text()) && errors.push(m.text()));
  await page.waitForSelector('.ProseMirror');
  await sleep(1500);
  const ev = (f, a) => page.evaluate(f, a);
  const dlg = () => page.getByRole('dialog', { name: 'Recorte de pantalla' });
  const imgs = () => page.locator('.ProseMirror img[src^="data:"]').count();
  const status = () => dlg().locator('[aria-live=polite]').innerText();
  /** Presses the ribbon button and waits for the selection window of the monitor to be on screen (returns its page). */
  const start = async () => {
    await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
    await page.getByRole('button', { name: 'Recorte de pantalla…', exact: true }).click();
    let ov;
    for (let i = 0; i < 60 && !ov; i++) {
      ov = find(/clip-overlay/);
      if (!ov) await sleep(300);
    }
    assert.ok(ov, 'no apareció la ventana de selección');
    await ov.waitForFunction(() => document.querySelector('canvas')?.width > 0);
    await sleep(700);
    return ov;
  };
  const dragIn = async (ov, a, b) => {
    const [w, h] = await ov.evaluate(() => [innerWidth, innerHeight]);
    await ov.mouse.move(w * a[0], h * a[1]);
    await ov.mouse.down();
    await ov.mouse.move(w * b[0], h * b[1], { steps: 8 });
    await ov.mouse.up();
  };

  let monitor;
  await check('el comando nativo lista los monitores, con uno principal y tamaño en píxeles físicos', async () => {
    const list = await ev(() => window.__TAURI_INTERNALS__.invoke('clip_monitors'));
    assert.ok(list.length >= 1);
    monitor = list.find((m) => m.primary) ?? list[0];
    assert.ok(monitor.width >= 640 && monitor.height >= 480, JSON.stringify(monitor));
  });

  const timings = (globalThis.__timings = {});
  await check('tiempos: capturar el monitor (sin y con ocultar la aplicación) y tener la selección sobre la pantalla lista', async () => {
    const cap = (hide) => ev(async ({ m, hide }) => { const t0 = performance.now(); const bytes = await window.__TAURI_INTERNALS__.invoke('clip_capture', { monitor: m, hide }); return { ms: Math.round(performance.now() - t0), kb: Math.round(bytes.byteLength / 1024) }; }, { m: monitor.index, hide });
    const shown = await cap(false);
    const hidden = await cap(true);
    timings.captureMs = shown.ms;
    timings.captureHiddenMs = hidden.ms;
    timings.pngKB = shown.kb;
    const t0 = Date.now();
    const ov = await start();
    timings.overlayReadyMs = Date.now() - t0 - 700;
    await ov.keyboard.press('Escape');
    await sleep(800);
    assert.ok(shown.ms < 2000, `captura ${shown.ms} ms`);
    assert.ok(hidden.ms < 3000, `captura oculta ${hidden.ms} ms`);
    assert.ok(timings.overlayReadyMs < 8000, `selección ${timings.overlayReadyMs} ms`);
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
    assert.ok(r.diff / r.total > 0.05, `solo ${((100 * r.diff) / r.total).toFixed(1)} % de píxeles distintos`);
  });

  await check('la ventana de selección cubre el monitor entero (en píxeles físicos), sin bordes, con la captura congelada', async () => {
    const ov = await start();
    const info = await ov.evaluate(() => ({ w: Math.round(innerWidth * devicePixelRatio), h: Math.round(innerHeight * devicePixelRatio), x: Math.round(screenX * devicePixelRatio), y: Math.round(screenY * devicePixelRatio), cw: document.querySelector('canvas').width, text: document.querySelector('[role=status]').textContent }));
    assert.ok(Math.abs(info.w - monitor.width) <= 2 && Math.abs(info.h - monitor.height) <= 2, `${info.w}x${info.h} frente a ${monitor.width}x${monitor.height}`);
    assert.ok(Math.abs(info.x - monitor.x) <= 2 && Math.abs(info.y - monitor.y) <= 2, `posición ${info.x},${info.y}`);
    assert.match(info.text, /Arrastra para elegir la zona/);
    // the frozen capture is drawn over the whole window (it was once drawn at the size the window had before going full screen)
    const drawn = await ov.evaluate(() => { const c = document.querySelector('canvas'); return { css: c.style.width + 'x' + c.style.height, iw: innerWidth + 'px', ih: innerHeight + 'px', cw: c.width, ch: c.height }; });
    assert.equal(drawn.css, `${drawn.iw}x${drawn.ih}`, JSON.stringify(drawn));
    assert.ok(Math.abs(drawn.cw - monitor.width) <= 2 && Math.abs(drawn.ch - monitor.height) <= 2, JSON.stringify(drawn));
    // the frozen capture has real content (the desktop), not a flat colour
    const colours = await ov.evaluate(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const s = new Set(); for (let i = 0; i < d.length; i += 4 * 211) s.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4)); return s.size; });
    assert.ok(colours > 8, `solo ${colours} colores`);
    if (shotsDir) await ov.screenshot({ path: `${shotsDir}/01-seleccion.png` });
    await ov.keyboard.press('Escape');
    await sleep(800);
  });

  await check('Esc cancela: no hay diálogo, la ventana de selección se cierra, la aplicación vuelve y no se inserta nada', async () => {
    const before = await imgs();
    const ov = await start();
    await ov.keyboard.press('Escape');
    for (let i = 0; i < 30 && find(/clip-overlay/); i++) await sleep(200);
    assert.equal(find(/clip-overlay/), undefined, 'la ventana de selección sigue abierta');
    await sleep(800);
    assert.equal(await dlg().count(), 0);
    assert.equal(await imgs(), before);
    assert.ok(await ev(() => document.hasFocus()), 'la aplicación recupera el foco');
  });

  await check('arrastrar elige la zona en la pantalla real y el diálogo se abre con esa zona ya elegida (tamaño en píxeles físicos)', async () => {
    const ov = await start();
    await dragIn(ov, [0.1, 0.1], [0.35, 0.4]);
    await dlg().waitFor();
    await sleep(500);
    assert.equal(find(/clip-overlay/), undefined, 'la ventana de selección se cierra al elegir');
    const st = await status();
    const [w, h] = st.match(/Zona elegida: (\d+) × (\d+) px/).slice(1).map(Number);
    assert.ok(Math.abs(w - monitor.width * 0.25) <= 4 && Math.abs(h - monitor.height * 0.3) <= 4, `${w}x${h}: ${st}`);
    assert.equal(await dlg().getByRole('button', { name: 'Insertar el recorte', exact: true }).count(), 1);
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/02-dialogo.png` });
  });

  await check('se anota la zona y se inserta en Writer como imagen del tamaño de la zona', async () => {
    const before = await imgs();
    await dlg().getByRole('radio', { name: 'Rectángulo', exact: true }).click();
    const b = await page.getByTestId('clip-canvas').boundingBox();
    await page.mouse.move(b.x + b.width * 0.15, b.y + b.height * 0.15);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.35, { steps: 6 });
    await page.mouse.up();
    await dlg().getByRole('button', { name: 'Insertar el recorte', exact: true }).click();
    await dlg().waitFor({ state: 'detached' });
    await sleep(1200);
    assert.equal(await imgs(), before + 1);
    const size = await ev(async () => {
      const im = [...document.querySelectorAll('.ProseMirror img[src^="data:"]')].at(-1);
      await im.decode();
      return { w: im.naturalWidth, h: im.naturalHeight };
    });
    assert.ok(Math.abs(size.w - monitor.width * 0.25) <= 4 && Math.abs(size.h - monitor.height * 0.3) <= 4, `${size.w}x${size.h}`);
  });

  await check('Intro usa toda la pantalla: el diálogo se abre sin zona, con la captura entera', async () => {
    const ov = await start();
    await ov.keyboard.press('Enter');
    await dlg().waitFor();
    await sleep(400);
    const [w, h] = (await status()).match(/Toda la captura: (\d+) × (\d+) px/).slice(1).map(Number);
    assert.ok(Math.abs(w - monitor.width) <= 2 && Math.abs(h - monitor.height) <= 2, `${w}x${h}`);
    await dlg().getByRole('button', { name: 'Cancelar', exact: true }).click();
    await dlg().waitFor({ state: 'detached' });
  });

  await check('el botón derecho también cancela, y un clic sin arrastrar no elige nada', async () => {
    const ov = await start();
    const [w, h] = await ov.evaluate(() => [innerWidth, innerHeight]);
    await ov.mouse.click(w / 2, h / 2);
    await sleep(500);
    assert.ok(find(/clip-overlay/), 'un clic suelto no debe cerrar la selección');
    await ov.mouse.click(w / 2, h / 2, { button: 'right' });
    for (let i = 0; i < 30 && find(/clip-overlay/); i++) await sleep(200);
    assert.equal(find(/clip-overlay/), undefined);
    await sleep(600);
    assert.equal(await dlg().count(), 0);
  });

  await check('sin errores de consola', async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser?.close().catch(() => undefined);
  app.kill();
  spawn('taskkill', ['/F', '/T', '/PID', String(app.pid)], { stdio: 'ignore' });
}

console.log('tiempos (ms):', JSON.stringify(globalThis.__timings ?? {}));
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
