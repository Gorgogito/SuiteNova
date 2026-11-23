// End-to-end checks for the annotations of the screen clip (phase 2): pen, highlighter, arrow, rectangle, eraser, colours, thickness, undo and what is saved.
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-clip-marks.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=notes';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
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
  }
};
const ev = (f, a) => page.evaluate(f, a);
const settle = (ms = 200) => page.waitForTimeout(ms);
const dlg = () => page.getByRole('dialog', { name: 'Recorte de pantalla' });
const canvas = () => page.getByTestId('clip-canvas');
const status = () => dlg().locator('[aria-live=polite]').innerText();
const tool = (name) => dlg().getByRole('radio', { name, exact: true }).click();
const colour = (name) => dlg().getByRole('button', { name, exact: true }).click();

// a flat blue capture of 1600x900
await ev(() => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas');
    c.width = 1600;
    c.height = 900;
    const g = c.getContext('2d');
    const paint = () => {
      g.fillStyle = '#2b6cb0';
      g.fillRect(0, 0, 1600, 900);
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
const dragOn = async (pts) => {
  const b = await canvas().boundingBox();
  await page.mouse.move(b.x + b.width * pts[0][0], b.y + b.height * pts[0][1]);
  await page.mouse.down();
  for (const [fx, fy] of pts.slice(1)) await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy, { steps: 8 });
  await page.mouse.up();
  await settle(120);
};
/** Saves the PNG and returns a reader of its pixels (in pixels of the saved image). */
const saved = async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), dlg().getByRole('button', { name: 'Guardar como PNG', exact: true }).click()]);
  const b64 = fs.readFileSync(await dl.path()).toString('base64');
  return (fn, arg) => ev(async ({ b64, fn, arg }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const px = (x, y) => Array.from(g.getImageData(Math.round(x), Math.round(y), 1, 1).data);
    return new Function('px', 'W', 'H', 'arg', `return (${fn})(px, W, H, arg)`)(px, img.width, img.height, arg);
  }, { b64, fn: fn.toString(), arg });
};
const isRed = (p) => p[0] > 200 && p[1] < 60 && p[2] < 60;
const isBlue = (p) => Math.abs(p[0] - 43) < 6 && Math.abs(p[1] - 108) < 6 && Math.abs(p[2] - 176) < 6;

await check('la barra tiene las seis herramientas, seis colores y tres grosores; la herramienta inicial es Zona', async () => {
  await open();
  for (const n of ['Zona', 'Lápiz', 'Resaltador', 'Flecha', 'Rectángulo', 'Borrador']) assert.equal(await dlg().getByRole('radio', { name: n, exact: true }).count(), 1, n);
  assert.equal(await dlg().getByRole('radio', { name: 'Zona', exact: true }).getAttribute('aria-checked'), 'true');
  for (const n of ['Rojo', 'Amarillo', 'Verde', 'Azul', 'Negro', 'Blanco']) assert.equal(await dlg().getByRole('button', { name: n, exact: true }).count(), 1, n);
  for (const n of ['Fino', 'Medio', 'Grueso']) assert.equal(await dlg().getByRole('radio', { name: n, exact: true }).count(), 1, n);
  assert.ok(await dlg().getByRole('button', { name: 'Deshacer', exact: true }).isDisabled());
  await shot('barra');
});

await check('lápiz: dibuja una línea roja del grosor elegido (en píxeles de la captura) y no toca el resto', async () => {
  await tool('Lápiz');
  await dragOn([[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]);
  assert.match(await status(), /1 anotación/);
  const px = await saved();
  const r = await px((px, W, H) => {
    let run = 0;
    for (let y = 0; y < H; y++) { const p = px(W / 2, y); if (p[0] > 200 && p[1] < 60 && p[2] < 60) run++; }
    return { mid: px(W / 2, H / 2), far: px(W / 2, H / 4), run };
  });
  assert.ok(isRed(r.mid), JSON.stringify(r.mid));
  assert.ok(isBlue(r.far));
  // Medio = 4 px on the screen; the capture is shown smaller than itself, so it is thicker there
  assert.ok(r.run >= 6 && r.run <= 16, `grosor ${r.run}`);
  await shot('lapiz');
});

await check('grosor: Grueso es más ancho que Fino', async () => {
  const width = async (name, y) => {
    await tool(name === 'Fino' ? 'Fino' : 'Grueso');
    await tool('Lápiz');
    await dragOn([[0.2, y], [0.8, y]]);
    const px = await saved();
    return px((px, W, H, yy) => { let run = 0; for (let k = 0; k < H; k++) { const p = px(W / 2, k); if (p[0] > 200 && p[1] < 60 && p[2] < 60 && Math.abs(k - yy * H) < 40) run++; } return run; }, y);
  };
  const thin = await width('Fino', 0.8);
  const thick = await width('Grueso', 0.2);
  assert.ok(thick > thin * 2, `${thin} / ${thick}`);
  assert.match(await status(), /3 anotaciones/);
  await tool('Medio');
});

await check('deshacer y rehacer: botones y Ctrl+Z / Ctrl+Y, un paso cada vez', async () => {
  await dlg().getByRole('button', { name: 'Deshacer', exact: true }).click();
  assert.match(await status(), /2 anotaciones/);
  await canvas().focus();
  await page.keyboard.press('Control+z');
  assert.match(await status(), /1 anotación/);
  await page.keyboard.press('Control+y');
  assert.match(await status(), /2 anotaciones/);
  await dlg().getByRole('button', { name: 'Rehacer', exact: true }).click();
  assert.match(await status(), /3 anotaciones/);
  assert.ok(await dlg().getByRole('button', { name: 'Rehacer', exact: true }).isDisabled());
});

await check('borrador: quita la marca bajo el puntero (todo el arrastre es un solo paso de deshacer)', async () => {
  await tool('Borrador');
  await dragOn([[0.5, 0.15], [0.5, 0.85]]);
  assert.match(await status(), /(^|, )(0 anotaciones|Toda la captura: 1600 × 900 px)$/);
  await dlg().getByRole('button', { name: 'Deshacer', exact: true }).click();
  assert.match(await status(), /3 anotaciones/);
  await shot('borrador');
});

await check('quitar anotaciones las borra todas y se puede deshacer', async () => {
  await dlg().getByRole('button', { name: 'Quitar anotaciones', exact: true }).click();
  assert.doesNotMatch(await status(), /anotaci/);
  assert.ok(await dlg().getByRole('button', { name: 'Quitar anotaciones', exact: true }).isDisabled());
  await page.keyboard.press('Control+z');
  assert.match(await status(), /3 anotaciones/);
  await dlg().getByRole('button', { name: 'Quitar anotaciones', exact: true }).click();
});

await check('rectángulo: solo el contorno, con el color elegido', async () => {
  await tool('Rectángulo');
  await colour('Verde');
  await dragOn([[0.3, 0.3], [0.7, 0.7]]);
  const px = await saved();
  const r = await px((px, W, H) => ({ edge: px(W * 0.5, H * 0.3), inside: px(W * 0.5, H * 0.5), outside: px(W * 0.5, H * 0.15) }));
  assert.ok(r.edge[1] > 150 && r.edge[0] < 80, JSON.stringify(r.edge));
  assert.ok(isBlue(r.inside), 'el interior queda sin pintar');
  assert.ok(isBlue(r.outside));
  await shot('rectangulo');
});

await check('flecha: línea con punta en el extremo final', async () => {
  await dlg().getByRole('button', { name: 'Quitar anotaciones', exact: true }).click();
  await tool('Flecha');
  await colour('Rojo');
  await dragOn([[0.2, 0.5], [0.8, 0.5]]);
  const px = await saved();
  const r = await px((px, W, H) => {
    // red above the shaft near the tip means the barbs are there; near the tail there is nothing above the shaft
    const near = (x) => { for (let d = 12; d < 60; d++) { const p = px(x, H / 2 - d); if (p[0] > 200 && p[1] < 60) return true; } return false; };
    return { tip: px(W * 0.8 - 4, H / 2), headAbove: near(W * 0.8 - 40), tailAbove: near(W * 0.3), shaft: px(W * 0.5, H / 2) };
  });
  assert.ok(isRed(r.shaft));
  assert.ok(r.headAbove, 'hay punta cerca del final');
  assert.ok(!r.tailAbove, 'no hay punta lejos del final');
  await shot('flecha');
});

await check('resaltador: transparente, deja ver lo de debajo', async () => {
  await dlg().getByRole('button', { name: 'Quitar anotaciones', exact: true }).click();
  await tool('Resaltador');
  await colour('Amarillo');
  await dragOn([[0.2, 0.6], [0.8, 0.6]]);
  const px = await saved();
  const m = await px((px, W, H) => px(W / 2, H * 0.6));
  // 40 % of yellow over the blue: (128, 151, 106)
  assert.ok(Math.abs(m[0] - 128) < 12 && Math.abs(m[1] - 151) < 12 && Math.abs(m[2] - 106) < 14, JSON.stringify(m));
});

await check('con una zona elegida, el PNG lleva las marcas que caen dentro y la zona manda sobre el tamaño', async () => {
  await dlg().getByRole('button', { name: 'Quitar anotaciones', exact: true }).click();
  await tool('Lápiz');
  await colour('Rojo');
  await dragOn([[0.2, 0.5], [0.8, 0.5]]);
  await tool('Zona');
  await dragOn([[0.4, 0.4], [0.6, 0.6]]);
  const px = await saved();
  const r = await px((px, W, H) => ({ W, H, mid: px(W / 2, H / 2), corner: px(2, 2) }));
  assert.ok(Math.abs(r.W - 320) <= 4 && Math.abs(r.H - 180) <= 4, `${r.W}x${r.H}`);
  assert.ok(isRed(r.mid));
  assert.ok(isBlue(r.corner));
});

await check('insertar lleva las marcas a la página de Notes', async () => {
  const before = await ev(() => window.__novaNotes.ctl.page.containers.filter((x) => x.kind === 'image').length);
  await dlg().getByRole('button', { name: 'Insertar el recorte', exact: true }).click();
  await dlg().waitFor({ state: 'detached' });
  await settle(800);
  const n = await ev(() => window.__novaNotes.ctl.page.containers.filter((x) => x.kind === 'image').length);
  assert.equal(n, before + 1);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
