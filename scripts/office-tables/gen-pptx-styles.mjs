// Builds a .pptx with one table per (style × options) written by Nova Slides, and the look that table-core expects for every cell (with the colours of the
// deck's theme), to compare with PowerPoint. Needs `pnpm dev` on :1420. Usage: node scripts/office-tables/gen-pptx-styles.mjs <out dir>
import { chromium } from '../../apps/suite/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('uso: node scripts/office-tables/gen-pptx-styles.mjs <carpeta>');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:1420/?app=slides', { waitUntil: 'load' });
await page.waitForSelector('.sl-surface');
const res = await page.evaluate(async () => {
  const S = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/slides-core/src/index.ts');
  const T = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/table-core/src/index.ts');
  const deck = S.newDeck();
  const colors = deck.themes[0].colors;
  const hexOf = (v) => '#' + String(v).replace('#', '').toLowerCase();
  const palette = { accents: [1, 2, 3, 4, 5, 6].map((n) => hexOf(colors['accent' + n])), dark: hexOf(colors.dk1), light: hexOf(colors.lt1) };
  const OPTS = {
    defecto: { firstRow: true, lastRow: false, firstCol: false, lastCol: false, bandRows: true, bandCols: false },
    todo: { firstRow: true, lastRow: true, firstCol: true, lastCol: true, bandRows: true, bandCols: true },
    nada: { firstRow: false, lastRow: false, firstCol: false, lastCol: false, bandRows: false, bandCols: false },
  };
  const R = 5;
  const C = 4;
  const FAMILY = { medium: 'medium2', light: 'light', grid: 'grid', dark: 'dark', list: 'list' };
  deck.slides = [];
  const expected = [];
  const styles = T.styleCatalog(palette).flatMap((c) => c.styles).filter((s) => FAMILY[s.family] || s.family === 'plain' || s.family === 'basic');
  const layout = deck.layouts.find((l) => /vac|blank/i.test(l.name)) ?? deck.layouts[deck.layouts.length - 1];
  let n = 0;
  let nextDeck = deck;
  for (const s of styles) {
    for (const [on, o] of Object.entries(OPTS)) {
      const el = S.newTable(R, C, 60, 60, 480);
      el.firstRow = o.firstRow;
      el.lastRow = o.lastRow;
      el.firstCol = o.firstCol;
      el.lastCol = o.lastCol;
      el.bandRow = o.bandRows;
      el.bandCol = o.bandCols;
      el.rows.forEach((row, r) => row.cells.forEach((cell, c) => (cell.text = { body: {}, doc: S.docFromText(`${r},${c}`) })));
      if (FAMILY[s.family]) {
        const def = S.tableStyleFor(FAMILY[s.family], s.accent);
        const r = S.applyTableStyle(nextDeck, def);
        nextDeck = r.deck;
        el.styleId = r.id;
      } else {
        const r = S.applyTableStyle(nextDeck, null, s.family === 'basic' ? 'grid' : 'none');
        nextDeck = r.deck;
        el.styleId = r.id;
      }
      nextDeck = { ...nextDeck, slides: [...nextDeck.slides, { id: 's' + ++n, layoutId: layout.id, shapes: [el] }] };
      const looks = [];
      // PowerPoint's own «Table Grid» draws 1 pt lines (Word's draws 0.5 pt): each program keeps the one its Office has
      const ref = s.family === 'basic' ? { ...s, whole: { borders: Object.fromEntries(Object.entries(s.whole.borders).map(([k, b]) => [k, { ...b, width: 1 }])) } } : s;
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) looks.push(T.lookOf(ref, o, { r, c }, { rows: R, cols: C }));
      expected.push({ style: s.id, opts: on, looks });
    }
  }
  const w = await S.writePptx(nextDeck);
  let bin = '';
  for (const b of w.data) bin += String.fromCharCode(b);
  return { b64: btoa(bin), expected, palette };
});
fs.writeFileSync(path.join(out, 'estilos.pptx'), Buffer.from(res.b64, 'base64'));
fs.writeFileSync(path.join(out, 'esperado-pptx.json'), JSON.stringify(res.expected));
console.log('tablas:', res.expected.length, 'paleta:', res.palette.accents.join(' '));
await browser.close();
