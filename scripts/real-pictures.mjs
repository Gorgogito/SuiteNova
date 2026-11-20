// Genera con Nova un .docx, un .pptx, un .xlsx y un .vsdx con la misma imagen (azul | rojo con "AB") editada, para abrirlos con Word, PowerPoint, Excel y Visio reales (COM).
// Necesita `pnpm dev` en :1420. Uso: node scripts/real-pictures.mjs outdir
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const save = (name, b64) => fs.writeFileSync(path.join(out, name), Buffer.from(b64, 'base64'));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const open = async (app, sel) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('ERROR', app, e.message));
  await p.goto(`http://localhost:1420/?app=${app}`, { waitUntil: 'load' });
  await p.waitForSelector(sel);
  await p.waitForTimeout(600);
  return p;
};
const PNG = `(() => {
  const c = document.createElement('canvas');
  c.width = 300;
  c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = '#1971c2';
  g.fillRect(0, 0, 150, 200);
  g.fillStyle = '#e03131';
  g.fillRect(150, 0, 150, 200);
  g.fillStyle = '#fff';
  g.font = 'bold 60px sans-serif';
  g.fillText('AB', 105, 120);
  return c.toDataURL('image/png');
})()`;
const toB64 = `(data) => { let s = ''; for (const b of data) s += String.fromCharCode(b); return btoa(s); }`;

// ---- Writer: recorte 25 % a cada lado, borde, texto alternativo
const w = await open('writer', '.ProseMirror');
await w.evaluate(() => window.__novaWriter.ctl.newDoc());
await w.waitForTimeout(600);
await w.locator('.ProseMirror').click();
save(
  'imagen.docx',
  await w.evaluate(async ([png, toB64]) => {
    const c = window.__novaWriter.ctl;
    const v = c.mainView;
    v.dispatch(v.state.tr.insertText('Imagen recortada: ').replaceSelectionWith(v.state.schema.nodes.image.create({ src: eval(png), alt: 'Texto alternativo de Writer', width: 150, height: 200 * 0.5 * 1.0, crop: { l: 0.25, t: 0, r: 0.25, b: 0 }, wrap: 'left', border: { color: '#ff0000', width: 2 } })).insertText(' fin.'));
    const { data } = await window.__novaWriter.docx.writeDocx(c.toWriterDoc());
    return eval(toB64)(data);
  }, [PNG, toB64]),
);

// ---- Slides: recorte, forma, borde, brillo y contraste, giro y texto alternativo
const s = await open('slides', '.sl-surface');
await s.evaluate((png) => {
  const c = window.__novaSlides.ctl;
  c.select(c.slide.shapes.map((e) => e.id));
  c.deleteSelected();
  const b64 = eval(png).split(',')[1];
  c.emit('files', [new File([Uint8Array.from(atob(b64), (x) => x.charCodeAt(0))], 'prueba.png', { type: 'image/png' })]);
}, PNG);
await s.waitForFunction(() => window.__novaSlides.ctl.slide.shapes.some((e) => e.kind === 'pic'));
await s.waitForTimeout(500);
await s.evaluate(() => {
  const c = window.__novaSlides.ctl;
  const p = c.slide.shapes.find((e) => e.kind === 'pic');
  c.patch([p.id], 'prueba', (e) => ({ ...e, descr: 'Texto alternativo de Slides', srcRect: { l: 25000, t: 0, r: 25000, b: 0 }, geom: { prst: 'roundRect' }, ln: { w: 3, fill: { t: 'solid', c: { rgb: 'FF0000' } } }, adjust: { bright: 30, contrast: -20 }, xfrm: { ...e.xfrm, x: 100, y: 100, w: 150, h: 200, rot: 30 } }));
});
const pb = await s.evaluate(async () => await window.__novaSlides.write());
fs.writeFileSync(path.join(out, 'imagen.pptx'), Buffer.from(pb));

// ---- Calc: recorte, forma, borde, giro, texto alternativo (y una sin girar para comparar el ancla)
const x = await open('calc', '.calc-grid__scroller');
save(
  'imagen.xlsx',
  await x.evaluate(async ([png, toB64]) => {
    const d = window.__novaCalc.doc;
    const bytes = Uint8Array.from(atob(eval(png).split(',')[1]), (ch) => ch.charCodeAt(0));
    const mk = (name, patch) => {
      const id = d.x.insertImage('image/png', bytes, 300, 200, name);
      d.x.updateImage(id, { alt: `Texto alternativo ${name}`, x: 40, ...patch });
      return id;
    };
    mk('recortada', { y: 20, crop: { l: 25000, t: 0, r: 25000, b: 0 }, width: 150, height: 200, shape: 'ellipse', border: { color: '#ff0000', width: 3 }, anchor: 'twoCell' });
    mk('girada', { x: 300, y: 60, width: 200, height: 100, rotation: 90, anchor: 'oneCell' });
    mk('plana', { x: 600, y: 60, width: 200, height: 100 });
    const { writeXlsx } = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/xlsx-io/src/index.ts');
    return eval(toB64)(await writeXlsx(d.wb));
  }, [PNG, toB64]),
);

// ---- Diagram: imagen en forma de imagen de Visio (contener, rellenar y estirar)
const dg = await open('diagram', '[data-stencil]');
save(
  'imagen.vsdx',
  await dg.evaluate(async ([png, toB64]) => {
    const c = window.__novaDiagram.ctl;
    const m = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/diagram-core/src/index.ts');
    const src = eval(png);
    for (const [i, fit] of ['contain', 'cover', 'stretch'].entries()) {
      c.insertImage(src, 300, 200, { x: 100 + i * 340, y: 120 });
      const s = c.selectedShapes()[0];
      c.edit((p) => m.setShapeImage(p, [s.id], { src, fit, alt: `Texto alternativo ${fit}` }));
      c.edit((p) => m.updateShapes(p, [s.id], { w: 200, h: 200 }));
    }
    // girada y volteada, para comprobar la forma de imagen con Angle y FlipX
    c.insertImage(src, 300, 200, { x: 300, y: 420 });
    const r = c.selectedShapes()[0];
    c.edit((p) => m.setShapeImage(p, [r.id], { src, fit: 'contain', alt: 'girada' }));
    c.edit((p) => m.updateShapes(p, [r.id], { rot: 30, flipH: true, w: 240, h: 160 }));
    const bytes = await m.exportVsdx(c.diagram);
    return eval(toB64)(bytes);
  }, [PNG, toB64]),
);
await browser.close();
console.log('listo:', fs.readdirSync(out).join(', '));
