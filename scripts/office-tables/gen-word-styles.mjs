// Builds a .docx with one table per (style × options) written by Nova Writer, and the look that table-core expects for every cell, to compare with Word.
// Needs `pnpm dev` on :1420. Usage: node scripts/office-tables/gen-word-styles.mjs <out dir>
import { chromium } from '../../apps/suite/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('uso: node scripts/office-tables/gen-word-styles.mjs <carpeta>');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:1420/?app=writer', { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
const res = await page.evaluate(async () => {
  const W = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/writer-core/src/index.ts');
  const T = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/table-core/src/index.ts');
  const { nodeTypes, writerSchema } = W;
  const para = (t) => nodeTypes.paragraph.create(null, t ? writerSchema.text(t) : undefined);
  const OPTS = {
    defecto: { firstRow: true, lastRow: false, firstCol: false, lastCol: false, bandRows: true, bandCols: false },
    todo: { firstRow: true, lastRow: true, firstCol: true, lastCol: true, bandRows: true, bandCols: true },
    nada: { firstRow: false, lastRow: false, firstCol: false, lastCol: false, bandRows: false, bandCols: false },
  };
  const R = 5;
  const C = 4;
  const blocks = [];
  const expected = [];
  const styles = T.styleCatalog().flatMap((c) => c.styles);
  for (const s of styles) {
    for (const [on, o] of Object.entries(OPTS)) {
      const rows = [];
      for (let r = 0; r < R; r++) rows.push(nodeTypes.table_row.create(null, Array.from({ length: C }, (_v, c) => nodeTypes.table_cell.create({ colwidth: [100] }, para(`${r},${c}`)))));
      blocks.push(para(`${s.id}/${on}`));
      blocks.push(nodeTypes.table.create({ borders: false, tstyle: s.id, topts: o }, rows));
      const looks = [];
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) looks.push(T.lookOf(s, o, { r, c }, { rows: R, cols: C }));
      expected.push({ style: s.id, opts: on, looks });
    }
  }
  const props = W.defaultSection(W.defaultPage());
  const doc = { ...W.emptyWriterDoc({ ...W.DEFAULT_DOC_DEFAULTS }), body: nodeTypes.doc.create(null, [W.makeSection(blocks, props)]) };
  const w = await W.writeDocx(doc);
  let bin = '';
  for (const b of w.data) bin += String.fromCharCode(b);
  return { b64: btoa(bin), expected };
});
fs.writeFileSync(path.join(out, 'estilos.docx'), Buffer.from(res.b64, 'base64'));
fs.writeFileSync(path.join(out, 'esperado.json'), JSON.stringify(res.expected));
console.log('tablas:', res.expected.length);
await browser.close();
