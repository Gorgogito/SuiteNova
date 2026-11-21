// Measures how well the shared OCR reads pictures that are hard in the ways real ones are (a screenshot of small text, a scanned page with noise,
// a page photographed a few degrees crooked, low contrast, a table with ruled lines, a small crop). The text of each picture is known, so the
// measure is the share of its words the reading found (recall) and the share of the reading's words that are real (precision).
// Needs `pnpm dev` on :1420.  Usage: node scripts/ocr-quality.mjs [--json out.json]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const outJson = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
page.setDefaultTimeout(240000);
await page.goto('http://localhost:1420/?app=notes', { waitUntil: 'load' });
await page.waitForSelector('.nn-canvas');

const LINES = [
  'La factura número 4821 vence el viernes',
  'Total a pagar trescientos cincuenta euros',
  'Enviar el pedido a la oficina de Lima',
  'Gracias por su compra y hasta pronto',
  'Reunión del equipo mañana a las diez',
];
const TABLE = [['Producto', 'Unidades', 'Precio'], ['Lápiz', '12', '3,5'], ['Cuaderno', '4', '1200'], ['Regla', '30', '0,8']];

const cases = [
  { id: 'captura-pantalla-14px', desc: 'texto pequeño de interfaz, fondo blanco', draw: { kind: 'text', size: 14, w: 520, h: 150 } },
  { id: 'captura-oscura', desc: 'tema oscuro, 16 px', draw: { kind: 'text', size: 16, w: 560, h: 170, dark: true } },
  { id: 'pagina-limpia', desc: 'texto de 28 px, sin defectos', draw: { kind: 'text', size: 28, w: 900, h: 300 } },
  { id: 'escaneo-ruido', desc: 'ruido, fondo sucio y desenfoque ligero', draw: { kind: 'text', size: 28, w: 900, h: 300, noise: 28, blur: 1.2, tint: true } },
  { id: 'torcida-2', desc: 'página torcida 2°', draw: { kind: 'text', size: 28, w: 900, h: 300, skew: 2 } },
  { id: 'torcida-5', desc: 'página torcida 5°', draw: { kind: 'text', size: 28, w: 900, h: 300, skew: 5 } },
  { id: 'torcida-8', desc: 'página torcida 8°', draw: { kind: 'text', size: 28, w: 900, h: 300, skew: 8 } },
  { id: 'bajo-contraste', desc: 'gris #8a8a8a sobre #b4b4b4', draw: { kind: 'text', size: 28, w: 900, h: 300, fg: '#8a8a8a', bg: '#b4b4b4' } },
  { id: 'texto-diminuto', desc: 'texto de 10 px', draw: { kind: 'text', size: 10, w: 400, h: 110 } },
  { id: 'tabla-con-lineas', desc: 'tabla con líneas dibujadas', draw: { kind: 'table', lines: true } },
  { id: 'tabla-sin-lineas', desc: 'tabla sin líneas', draw: { kind: 'table', lines: false } },
  { id: 'tabla-torcida-3', desc: 'tabla con líneas torcida 3°', draw: { kind: 'table', lines: true, skew: 3 } },
];

await page.evaluate(([LINES, TABLE]) => {
  window.__q = {
    draw(spec) {
      const d = spec.draw;
      const W = d.kind === 'table' ? 700 : d.w;
      const H = (d.kind === 'table' ? 330 : d.h) + (d.skew ? 120 : 0);
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      g.fillStyle = d.dark ? '#14161a' : (d.bg ?? '#ffffff');
      g.fillRect(0, 0, W, H);
      if (d.tint) {
        const gr = g.createLinearGradient(0, 0, W, H);
        gr.addColorStop(0, '#e8e2d0');
        gr.addColorStop(1, '#cfc8b4');
        g.fillStyle = gr;
        g.fillRect(0, 0, W, H);
      }
      g.save();
      if (d.skew) {
        g.translate(W / 2, H / 2);
        g.rotate((d.skew * Math.PI) / 180);
        g.translate(-W / 2, -H / 2);
      }
      g.fillStyle = d.dark ? '#e6e8ec' : (d.fg ?? '#101010');
      g.textBaseline = 'top';
      if (d.kind === 'text') {
        g.font = `${d.size}px Arial`;
        LINES.forEach((l, i) => g.fillText(l, 24, 14 + (d.skew ? 60 : 0) + i * (d.size * 1.6)));
      } else {
        g.font = '28px Arial';
        const colX = [30, 270, 480];
        TABLE.forEach((r, i) => r.forEach((t, j) => g.fillText(t, colX[j] + 12, 24 + i * 72)));
        if (d.lines) {
          g.strokeStyle = '#303030';
          g.lineWidth = 2;
          for (let i = 0; i <= TABLE.length; i++) { g.beginPath(); g.moveTo(20, 14 + i * 72); g.lineTo(680, 14 + i * 72); g.stroke(); }
          for (const x of [20, 260, 470, 680]) { g.beginPath(); g.moveTo(x, 14); g.lineTo(x, 14 + TABLE.length * 72); g.stroke(); }
        }
      }
      g.restore();
      if (d.blur) {
        const t = document.createElement('canvas');
        t.width = W; t.height = H;
        const tg = t.getContext('2d');
        tg.filter = `blur(${d.blur}px)`;
        tg.drawImage(c, 0, 0);
        g.clearRect(0, 0, W, H);
        g.drawImage(t, 0, 0);
      }
      const img = g.getImageData(0, 0, W, H);
      if (d.noise) {
        let s = 12345;
        const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
        for (let i = 0; i < img.data.length; i += 4) { const n = rnd() * d.noise * 2; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
      }
      return img;
    },
  };
}, [LINES, TABLE]);

const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const words = (s) => fold(s).match(/[\p{L}\p{N}]{3,}/gu) ?? [];

const results = [];
for (const c of cases) {
  const expected = c.draw.kind === 'table' ? TABLE.flat() : LINES;
  const r = await page.evaluate(async (c) => {
    const core = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/ocr-core/src/index.ts');
    const { tesseractEngine } = await import('/src/ocr/tesseract.ts');
    const img = window.__q.draw(c);
    const t0 = performance.now();
    const r = await core.recognize(tesseractEngine, { data: img.data, w: img.width, h: img.height }, { lang: 'spa+eng', turns: 'auto' });
    const table = c.draw.kind === 'table' ? core.tableFromWords(r).rows : null;
    return { text: r.text, rotation: r.rotation, conf: Math.round(r.confidence), ms: Math.round(performance.now() - t0), table };
  }, c);
  const want = words(expected.join(' '));
  const got = words(r.text);
  const gotSet = new Set(got);
  const wantSet = new Set(want);
  const recall = want.filter((w) => gotSet.has(w)).length / want.length;
  const precision = got.length ? got.filter((w) => wantSet.has(w)).length / got.length : 0;
  let tableOk = null;
  if (r.table) {
    const flat = r.table.flat().map((x) => fold(x.trim()));
    tableOk = TABLE.flat().filter((x) => flat.includes(fold(x))).length / TABLE.flat().length;
    tableOk = { cells: tableOk, shape: `${r.table.length}x${Math.max(0, ...r.table.map((x) => x.length))}` };
  }
  results.push({ id: c.id, desc: c.desc, recall: +recall.toFixed(2), precision: +precision.toFixed(2), rotation: r.rotation, conf: r.conf, ms: r.ms, table: tableOk });
  console.log(`${c.id.padEnd(24)} recall ${recall.toFixed(2)}  precisión ${precision.toFixed(2)}  giro ${r.rotation}  conf ${r.conf}  ${r.ms} ms${tableOk ? `  tabla ${tableOk.shape} celdas ${tableOk.cells.toFixed(2)}` : ''}`);
}
const mean = (k) => (results.reduce((n, x) => n + x[k], 0) / results.length).toFixed(3);
console.log(`\nmedia: recall ${mean('recall')}  precisión ${mean('precision')}`);
if (outJson) fs.writeFileSync(outJson, JSON.stringify(results, null, 1));
await browser.close();
