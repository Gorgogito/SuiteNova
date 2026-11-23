// End-to-end checks for the shared screen clip dialog (phase 1, wired in Notes): choosing the area with the pointer and the keyboard, copy, save and insert.
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-clip.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=notes';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 950 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
const alerts = [];
page.on('dialog', (d) => {
  alerts.push(d.message());
  d.accept();
});
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__novaNotes);
await page.waitForTimeout(800);
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
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 8).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
    for (let i = 0; i < 3 && (await page.getByRole('dialog').count()); i++) await page.keyboard.press('Escape');
  }
};
const ev = (f, a) => page.evaluate(f, a);
const settle = (ms = 250) => page.waitForTimeout(ms);
const dlg = () => page.getByRole('dialog', { name: 'Recorte de pantalla' });
const canvas = () => page.getByTestId('clip-canvas');
const zone = () => page.getByTestId('clip-zone');
const status = () => dlg().locator('[aria-live=polite]').innerText();

// a 1600x900 capture with a blue background and a yellow square at 800,300 of 200x200
await ev(() => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas');
    c.width = 1600;
    c.height = 900;
    const g = c.getContext('2d');
    const paint = () => {
      g.fillStyle = '#2b6cb0';
      g.fillRect(0, 0, 1600, 900);
      g.fillStyle = '#f6e05e';
      g.fillRect(800, 300, 200, 200);
    };
    paint();
    setInterval(paint, 100);
    return c.captureStream(5);
  };
});
const open = async () => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'Recorte de pantalla…', exact: true }).click();
  await canvas().waitFor();
  await settle(300);
};
const dragOn = async (fx, fy, tx, ty) => {
  const b = await canvas().boundingBox();
  await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * tx, b.y + b.height * ty, { steps: 6 });
  await page.mouse.up();
  await settle(150);
};
const zoneInfo = () => ev(() => { const z = document.querySelector('[data-testid=clip-zone]'); return z ? { l: parseFloat(z.style.left), t: parseFloat(z.style.top), w: parseFloat(z.style.width), h: parseFloat(z.style.height) } : null; });
const pngSize = (b64) => { const buf = Buffer.from(b64, 'base64'); return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; };

await check('abre el diálogo con la captura entera y dice su tamaño', async () => {
  await open();
  assert.match(await status(), /Toda la captura: 1600 × 900 px/);
  assert.equal(await zone().count(), 0);
  assert.equal(await dlg().getByRole('button', { name: 'Insertar todo', exact: true }).count(), 1);
  await shot('captura');
});

await check('arrastrar elige la zona (en píxeles de la captura, aunque la vista sea más pequeña) y cambia el botón', async () => {
  await dragOn(0.25, 0.2, 0.75, 0.8);
  const z = await zoneInfo();
  assert.ok(Math.abs(z.l - 25) < 1.5 && Math.abs(z.t - 20) < 1.5 && Math.abs(z.w - 50) < 1.5 && Math.abs(z.h - 60) < 1.5, JSON.stringify(z));
  assert.match(await status(), /Zona elegida: (79\d|80\d|81\d) × (53\d|54\d|55\d) px/);
  assert.equal(await dlg().getByRole('button', { name: 'Insertar el recorte', exact: true }).count(), 1);
  await shot('zona');
});

await check('arrastrar desde dentro mueve la zona sin cambiar su tamaño y sin salirse de la captura', async () => {
  const before = await zoneInfo();
  await dragOn(0.5, 0.5, 0.6, 0.55);
  const a = await zoneInfo();
  assert.ok(Math.abs(a.w - before.w) < 0.5 && Math.abs(a.h - before.h) < 0.5);
  assert.ok(a.l > before.l + 5, `${before.l} → ${a.l}`);
  await dragOn(0.6, 0.55, 2, 2);
  const c = await zoneInfo();
  assert.ok(c.l + c.w <= 100.01 && c.t + c.h <= 100.01, JSON.stringify(c));
});

await check('teclado: flechas mueven, Ctrl y flechas cambian el tamaño, Mayús de 10 en 10, Supr quita la zona', async () => {
  await canvas().focus();
  await page.keyboard.press('Delete');
  assert.equal(await zone().count(), 0);
  await page.keyboard.press('ArrowRight');
  assert.equal(await zone().count(), 1, 'la primera flecha empieza una zona');
  const a = await zoneInfo();
  await page.keyboard.press('Shift+ArrowRight');
  const b = await zoneInfo();
  assert.ok(Math.abs(b.l - a.l - (10 / 1600) * 100) < 0.05, `${a.l} → ${b.l}`);
  await page.keyboard.press('Control+Shift+ArrowRight');
  const c = await zoneInfo();
  assert.ok(Math.abs(c.w - b.w - (10 / 1600) * 100) < 0.05);
  await page.keyboard.press('Control+ArrowUp');
  const d = await zoneInfo();
  assert.ok(d.h < c.h);
  assert.match(await canvas().getAttribute('aria-label'), /Zona elegida/);
});

await check('guardar como PNG descarga solo la zona, con el nombre con fecha', async () => {
  await canvas().focus();
  await page.keyboard.press('Delete');
  await dragOn(800 / 1600 - 0.05, 300 / 900 - 0.05, 1000 / 1600 + 0.05, 500 / 900 + 0.05);
  const [dl] = await Promise.all([page.waitForEvent('download'), dlg().getByRole('button', { name: 'Guardar como PNG', exact: true }).click()]);
  assert.match(dl.suggestedFilename(), /^Recorte de pantalla \d{4}-\d\d-\d\d \d\d-\d\d-\d\d\.png$/);
  const buf = fs.readFileSync(await dl.path());
  const sz = pngSize(buf.toString('base64'));
  assert.ok(Math.abs(sz.w - 360) <= 3 && Math.abs(sz.h - 290) <= 3, JSON.stringify(sz));
});

await check('copiar pone la zona en el portapapeles como PNG y avisa', async () => {
  await dlg().getByRole('button', { name: 'Copiar', exact: true }).click();
  await settle(400);
  assert.match(await status(), /Copiado al portapapeles/);
  const sz = await ev(async () => {
    const items = await navigator.clipboard.read();
    const blob = await items[0].getType('image/png');
    const bmp = await createImageBitmap(blob);
    return { w: bmp.width, h: bmp.height };
  });
  assert.ok(Math.abs(sz.w - 360) <= 3 && Math.abs(sz.h - 290) <= 3, JSON.stringify(sz));
});

await check('insertar pone la imagen del recorte en la página (proporción de la zona)', async () => {
  const before = await ev(() => window.__novaNotes.ctl.page.containers.filter((x) => x.kind === 'image').length);
  await dlg().getByRole('button', { name: 'Insertar el recorte', exact: true }).click();
  await dlg().waitFor({ state: 'detached' });
  await settle(700);
  const hidden = await ev(() => [...document.querySelectorAll('[aria-hidden=true],[inert]')].map((e) => e.tagName + '.' + e.className).slice(0, 5));
  assert.deepEqual(hidden.filter((h) => !/svg|SVG|^I./.test(h)), [], 'nada queda oculto tras cerrar');
  await page.getByRole('tab', { name: 'Inicio', exact: true }).waitFor({ timeout: 3000 });
  const imgs = await ev(() => window.__novaNotes.ctl.page.containers.filter((x) => x.kind === 'image').map((x) => ({ w: x.w, h: x.h })));
  assert.equal(imgs.length, before + 1);
  const last = imgs.at(-1);
  assert.ok(Math.abs(last.w / last.h - 360 / 290) < 0.05, `${last.w}x${last.h}`);
});

await check('insertar sin zona inserta toda la captura', async () => {
  await open();
  const before = await ev(() => window.__novaNotes.ctl.page.containers.filter((x) => x.kind === 'image').length);
  await dlg().getByRole('button', { name: 'Insertar todo', exact: true }).click();
  await dlg().waitFor({ state: 'detached' });
  await settle(700);
  const imgs = await ev(() => window.__novaNotes.ctl.page.containers.filter((x) => x.kind === 'image').map((x) => ({ w: x.w, h: x.h })));
  assert.equal(imgs.length, before + 1);
  assert.ok(Math.abs(imgs.at(-1).w / imgs.at(-1).h - 16 / 9) < 0.05);
});

await check('Cancelar, Escape y cancelar el selector del sistema no insertan nada ni dan error', async () => {
  await open();
  await dlg().getByRole('button', { name: 'Cancelar', exact: true }).click();
  await dlg().waitFor({ state: 'detached' });
  await open();
  await page.keyboard.press('Escape');
  await dlg().waitFor({ state: 'detached' });
  await ev(() => { navigator.mediaDevices.getDisplayMedia = async () => { throw new DOMException('cancelado', 'NotAllowedError'); }; });
  await page.getByRole('button', { name: 'Recorte de pantalla…', exact: true }).click();
  await settle(500);
  assert.equal(await dlg().count(), 0);
  assert.deepEqual(alerts, []);
});

await check('si el sistema no puede capturar avisa con un mensaje claro', async () => {
  await ev(() => { navigator.mediaDevices.getDisplayMedia = async () => { throw new DOMException('x', 'NotReadableError'); }; });
  await page.getByRole('button', { name: 'Recorte de pantalla…', exact: true }).click();
  await settle(500);
  assert.deepEqual(alerts, ['No se pudo capturar la pantalla.']);
});

await check('en la aplicación de escritorio se pide la captura nativa (ocultando la aplicación) y si falla se usa el selector del navegador', async () => {
  await ev(() => {
    window.__calls = [];
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        window.__calls.push({ cmd, args });
        if (cmd !== 'clip_capture') throw new Error('orden desconocida ' + cmd);
        if (window.__nativeFails) throw new Error('sin permiso');
        const c = document.createElement('canvas');
        c.width = 800;
        c.height = 500;
        c.getContext('2d').fillRect(0, 0, 800, 500);
        const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
        return await blob.arrayBuffer();
      },
    };
  });
  try {
    await open();
    assert.match(await status(), /Toda la captura: 800 × 500 px/);
    const calls = await ev(() => window.__calls);
    assert.deepEqual(calls.map((c) => c.cmd), ['clip_capture']);
    assert.deepEqual(calls[0].args, { monitor: null, hide: true });
    await dlg().getByRole('button', { name: 'Cancelar', exact: true }).click();
    await dlg().waitFor({ state: 'detached' });
    await ev(() => {
      window.__nativeFails = true;
      navigator.mediaDevices.getDisplayMedia = async () => {
        const c = document.createElement('canvas');
        c.width = 1600;
        c.height = 900;
        const g = c.getContext('2d');
        setInterval(() => g.fillRect(0, 0, 1600, 900), 100);
        return c.captureStream(5);
      };
    });
    await open();
    assert.match(await status(), /Toda la captura: 1600 × 900 px/, 'cae al selector del navegador');
    await dlg().getByRole('button', { name: 'Cancelar', exact: true }).click();
    await dlg().waitFor({ state: 'detached' });
  } finally {
    await ev(() => { delete window.__TAURI_INTERNALS__; });
  }
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
