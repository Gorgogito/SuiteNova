// End-to-end checks for the shared OCR with the real Tesseract engine: words and boxes, searching, turned and inverted pictures, a zone, a table and the
// queue. Needs `pnpm dev` on :1420.  Usage: node scripts/e2e-ocr-core.mjs
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
await page.goto('http://localhost:1420/?app=notes', { waitUntil: 'load' });
await page.waitForSelector('.nn-canvas');

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 8).join(' | ')]);
  }
};

// helpers that live in the page: draw an image, read it
await page.evaluate(() => {
  window.__ocr = {
    draw(w, h, items, { dark = false, turn = 0 } = {}) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = dark ? '#111' : '#fff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = dark ? '#f2f2f2' : '#000';
      g.textBaseline = 'top';
      for (const [text, x, y, size = 40] of items) {
        g.font = `${size}px Arial`;
        g.fillText(text, x, y);
      }
      if (!turn) return g.getImageData(0, 0, w, h);
      const t = document.createElement('canvas');
      t.width = turn === 2 ? w : h;
      t.height = turn === 2 ? h : w;
      const tg = t.getContext('2d');
      tg.translate(t.width / 2, t.height / 2);
      tg.rotate((turn * Math.PI) / 2);
      tg.drawImage(c, -w / 2, -h / 2);
      return tg.getImageData(0, 0, t.width, t.height);
    },
  };
});
const read = (spec, opts = {}) =>
  page.evaluate(
    async ([spec, opts]) => {
      const core = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/ocr-core/src/index.ts');
      const { tesseractEngine } = await import('/src/ocr/tesseract.ts');
      const img = window.__ocr.draw(spec.w, spec.h, spec.items, spec.opts);
      const r = await core.recognize(tesseractEngine, { data: img.data, w: img.width, h: img.height }, { lang: 'spa+eng', ...opts });
      return JSON.parse(JSON.stringify(r));
    },
    [spec, opts],
  );

const PAGE = { w: 900, h: 420, items: [['Factura número 1234', 60, 60], ['Total a pagar: 99', 60, 260]] };

await check('lee el texto de una imagen con sus palabras, sus cajas y su confianza', async () => {
  const r = await read(PAGE);
  assert.match(r.text, /Factura/);
  assert.match(r.text, /Total a pagar/);
  const w = r.lines.flatMap((l) => l.words).find((x) => /Factura/.test(x.text));
  assert.ok(w, 'la palabra Factura');
  // drawn at x=60, y=60 with a 40 px font
  assert.ok(Math.abs(w.box.x - 60) < 12, `x ${w.box.x}`);
  assert.ok(w.box.y > 50 && w.box.y < 85, `y ${w.box.y}`);
  assert.ok(w.box.w > 100 && w.box.w < 220, `w ${w.box.w}`);
  assert.ok(r.confidence > 70, `confianza ${r.confidence}`);
  assert.deepEqual([r.width, r.height, r.rotation], [900, 420, 0]);
  assert.ok(r.lines.length >= 2);
});

await check('con acentos: «número» se lee con su tilde y la búsqueda lo encuentra sin ella, con la caja de la palabra', async () => {
  const hit = await page.evaluate(async (spec) => {
    const core = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/ocr-core/src/index.ts');
    const { tesseractEngine } = await import('/src/ocr/tesseract.ts');
    const img = window.__ocr.draw(spec.w, spec.h, spec.items);
    const r = await core.recognize(tesseractEngine, { data: img.data, w: img.width, h: img.height }, { lang: 'spa+eng' });
    return core.searchResult(r, 'NUMERO').map((m) => ({ text: m.text, boxes: m.boxes }));
  }, PAGE);
  assert.equal(hit.length, 1);
  assert.equal(hit[0].text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''), 'numero');
  assert.ok(hit[0].boxes[0].x > 200 && hit[0].boxes[0].x < 330, `x ${hit[0].boxes[0].x}`);
});

await check('luz sobre fondo oscuro se lee igual', async () => {
  const r = await read({ ...PAGE, opts: { dark: true } });
  assert.match(r.text, /Factura/);
  assert.match(r.text, /pagar/);
});

await check('una imagen girada un cuarto de vuelta se lee con «giro automático» y se anota el giro', async () => {
  const r = await read({ ...PAGE, opts: { turn: 1 } }, { turns: 'auto' });
  assert.match(r.text, /Factura/);
  assert.ok([90, 180, 270].includes(r.rotation), `giro ${r.rotation}`);
  // the boxes are in the pixels of the picture as it came (420 wide, 900 tall)
  assert.deepEqual([r.width, r.height], [420, 900]);
  const w = r.lines.flatMap((l) => l.words).find((x) => /Factura/.test(x.text));
  assert.ok(w.box.x >= 0 && w.box.x + w.box.w <= 420 && w.box.y + w.box.h <= 900, JSON.stringify(w.box));
  // an upside-down picture too
  const r2 = await read({ ...PAGE, opts: { turn: 2 } }, { turns: 'auto' });
  assert.match(r2.text, /Total a pagar/);
});

await check('solo una zona: lee lo que hay dentro y las cajas siguen siendo las de la imagen entera', async () => {
  const r = await read(PAGE, { zone: { x: 0, y: 200, w: 900, h: 220 } });
  assert.match(r.text, /Total/);
  assert.doesNotMatch(r.text, /Factura/);
  assert.deepEqual(r.zone, { x: 0, y: 200, w: 900, h: 220 });
  const w = r.lines.flatMap((l) => l.words).find((x) => /Total/.test(x.text));
  assert.ok(w.box.y > 250 && w.box.y < 290, `y ${w.box.y} (dibujado en 260)`);
});

await check('una tabla dibujada con columnas se reconstruye en filas y columnas', async () => {
  const items = [
    ['Producto', 40, 30], ['Unidades', 340, 30], ['Precio', 640, 30],
    ['Café', 40, 110], ['12', 340, 110], ['3,50', 640, 110],
    ['Té', 40, 190], ['30', 340, 190], ['1.200,00', 640, 190],
  ];
  const t = await page.evaluate(async (spec) => {
    const core = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/ocr-core/src/index.ts');
    const { tesseractEngine } = await import('/src/ocr/tesseract.ts');
    const img = window.__ocr.draw(spec.w, spec.h, spec.items);
    const r = await core.recognize(tesseractEngine, { data: img.data, w: img.width, h: img.height }, { lang: 'spa+eng' });
    const table = core.tableFromWords(r);
    return { table, values: table.rows.map((row) => row.map((c) => core.cellValue(c))) };
  }, { w: 900, h: 280, items });
  assert.equal(t.table.columns, 3, JSON.stringify(t.table));
  assert.equal(t.table.rows.length, 3);
  assert.deepEqual(t.table.rows[0].map((c) => c.toLowerCase()), ['producto', 'unidades', 'precio']);
  assert.deepEqual(t.values[1].slice(1), [12, 3.5]);
  assert.equal(t.values[2][2], 1200);
});

await check('la cola lee varias imágenes una a una, no repite la misma y se puede cancelar', async () => {
  const out = await page.evaluate(async (spec) => {
    const core = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/ocr-core/src/index.ts');
    const { tesseractEngine } = await import('/src/ocr/tesseract.ts');
    let calls = 0;
    const counting = { recognize: (i, o) => (calls++, tesseractEngine.recognize(i, o)) };
    const q = new core.OcrQueue(counting);
    const load = () => { const img = window.__ocr.draw(spec.w, spec.h, spec.items); return Promise.resolve({ data: img.data, w: img.width, h: img.height }); };
    const job = (id, key) => ({ id, key, lang: 'spa+eng', load });
    const [a, b] = await Promise.all([q.add(job('a', 'K1')), q.add(job('b', 'K1'))]);
    const c = q.add(job('c', 'K2'));
    const d = q.add(job('d', 'K3'));
    const cancelled = d.then(() => 'leída', (e) => e.name);
    q.cancel('d');
    await c;
    return { same: a === b, calls, cancelled: await cancelled, text: a.text };
  }, PAGE);
  assert.equal(out.same, true);
  assert.equal(out.calls, 2, 'K1 una vez y K2 una vez; la cancelada no se leyó');
  assert.equal(out.cancelled, 'AbortError');
  assert.match(out.text, /Factura/);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
