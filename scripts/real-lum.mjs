// Compara el brillo y el contraste de image-core con los de PowerPoint real (la misma imagen con `a:lum`).
//   fase 1: node scripts/real-lum.mjs make outdir   → crea imagen.pptx y expected.json
//   (PowerPoint exporta la diapositiva: scripts/real-lum.ps1)
//   fase 2: node scripts/real-lum.mjs compare outdir → compara outdir/slide.png con expected.json
// Necesita `pnpm dev` en :1420.
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
const [mode, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const CASES = [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30], [20, 40], [-40, -20], [50, 60]];
const STRIPS = ['#000000', '#404040', '#808080', '#c0c0c0', '#ffffff', '#ff0000', '#00a000', '#2060ff', '#ffd000', '#a04080'];
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://localhost:1420/?app=slides', { waitUntil: 'load' });
await page.waitForSelector('.sl-surface');
await page.waitForTimeout(600);
if (mode === 'make') {
  const r = await page.evaluate(async ([cases, strips]) => {
    const ic = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/image-core/src/index.ts');
    const cv = document.createElement('canvas');
    cv.width = strips.length * 10; cv.height = 40;
    const g = cv.getContext('2d');
    strips.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 10, 0, 10, 40); });
    const src = cv.toDataURL('image/png');
    const px = g.getImageData(0, 0, cv.width, cv.height);
    const expected = cases.map(([b, c]) => {
      const o = ic.brightnessContrast({ w: cv.width, h: cv.height, data: new Uint8ClampedArray(px.data) }, b, c);
      return strips.map((_, i) => [...o.data.slice((20 * cv.width + i * 10 + 5) * 4, (20 * cv.width + i * 10 + 5) * 4 + 3)]);
    });
    const c = window.__novaSlides.ctl;
    c.select(c.slide.shapes.map((e) => e.id));
    c.deleteSelected();
    const b64 = src.split(',')[1];
    for (let i = 0; i < cases.length; i++) {
      c.emit('files', [new File([Uint8Array.from(atob(b64), (x) => x.charCodeAt(0))], `p${i}.png`, { type: 'image/png' })]);
      await new Promise((ok) => setTimeout(ok, 350));
    }
    const pics = c.slide.shapes.filter((e) => e.kind === 'pic');
    pics.forEach((p, i) => c.patch([p.id], 'lum', (e) => ({ ...e, adjust: cases[i][0] || cases[i][1] ? { bright: cases[i][0], contrast: cases[i][1] } : undefined, xfrm: { x: 20 + (i % 2) * 460, y: 20 + Math.floor(i / 2) * 120, w: 400, h: 100 } })));
    return { expected, pptx: await window.__novaSlides.write(), size: c.deck.size };
  }, [CASES, STRIPS]);
  fs.writeFileSync(path.join(out, 'lum.pptx'), Buffer.from(r.pptx));
  fs.writeFileSync(path.join(out, 'expected.json'), JSON.stringify({ expected: r.expected, size: r.size }));
  console.log('ok', JSON.stringify(r.size));
} else {
  const { expected, size } = JSON.parse(fs.readFileSync(path.join(out, 'expected.json'), 'utf8'));
  const png = fs.readFileSync(path.join(out, 'slide.png')).toString('base64');
  const got = await page.evaluate(async ([png, n, strips, size]) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const k = bmp.width / size.w;
    return { w: bmp.width, rows: Array.from({ length: n }, (_, i) => strips.map((_, s) => { const x = Math.round((20 + (i % 2) * 460 + (s + 0.5) * 40) * k); const y = Math.round((20 + Math.floor(i / 2) * 120 + 50) * k); return [...g.getImageData(x, y, 1, 1).data.slice(0, 3)]; })) };
  }, [png, CASES.length, STRIPS, size]);
  let worst = 0;
  const lines = [];
  CASES.forEach(([b, c], i) => {
    let m = 0, sum = 0, n = 0;
    STRIPS.forEach((_, s) => expected[i][s].forEach((v, ch) => { const d = Math.abs(v - got.rows[i][s][ch]); m = Math.max(m, d); sum += d; n++; }));
    worst = Math.max(worst, m);
    lines.push(`brillo ${String(b).padStart(3)} contraste ${String(c).padStart(3)}: diferencia máxima ${m}, media ${(sum / n).toFixed(1)}  ejemplo gris 50 %: Nova ${expected[i][2]} / PowerPoint ${got.rows[i][2]}`);
  });
  console.log(lines.join('\n'));
  for (const i of [5, 6, 7]) console.log('caso', CASES[i].join('/'), 'grises 0,64,128,192,255: Nova', [0, 1, 2, 3, 4].map((s) => expected[i][s][0]).join(','), '/ PowerPoint', [0, 1, 2, 3, 4].map((s) => got.rows[i][s][0]).join(','));
  console.log('peor diferencia:', worst);
}
await browser.close();
