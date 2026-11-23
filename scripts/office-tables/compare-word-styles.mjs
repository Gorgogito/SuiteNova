// Compares what Word shows for each table of estilos.docx (celdas.json) with what table-core says it should look like (esperado.json).
// Usage: node scripts/office-tables/compare-word-styles.mjs <folder> [--verbose]
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const verbose = process.argv.includes('--verbose');
const exp = JSON.parse(fs.readFileSync(path.join(dir, 'esperado.json'), 'utf8'));
let word = JSON.parse(fs.readFileSync(path.join(dir, 'celdas.json'), 'utf8').replace(/^﻿/, ''));
if (!Array.isArray(word)) word = [word];
const AUTO = -16777216;
const hexOf = (bgr) => (bgr === AUTO || bgr < 0 ? null : '#' + [bgr & 255, (bgr >> 8) & 255, (bgr >> 16) & 255].map((v) => v.toString(16).padStart(2, '0')).join(''));
const WIDTH = { 2: 0.25, 4: 0.5, 6: 0.75, 8: 1, 12: 1.5, 18: 2.25, 24: 3, 36: 4.5, 48: 6 };
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;
const bad = { fill: [], bold: [], color: [], border: [] };
let cells = 0;
let tables = 0;
for (let i = 0; i < exp.length; i++) {
  const e = exp[i];
  const w = word[i];
  if (!w) continue;
  tables++;
  const label = `${e.style}/${e.opts}`;
  w.cells.forEach((wc, k) => {
    const l = e.looks[k];
    cells++;
    const at = `${label} (${wc.row},${wc.col})`;
    const wf = hexOf(wc.fill);
    if ((wf ?? null) !== (l.fill ?? null)) bad.fill.push(`${at}: Word ${wf}, esperado ${l.fill}`);
    if (Boolean(wc.bold) !== Boolean(l.bold)) bad.bold.push(`${at}: Word ${wc.bold}, esperado ${l.bold}`);
    const wcol = hexOf(wc.color);
    // Word reports automatic text as black or auto: only a colour that the style sets has to match
    if (l.color && wcol !== l.color) bad.color.push(`${at}: Word ${wcol}, esperado ${l.color}`);
    for (const s of ['t', 'l', 'b', 'r']) {
      const wb = wc.borders[s];
      const eb = l.borders[s];
      // Word answers 9999999 (undefined) for a side the style does not define
      const wDrawn = wb.style > 0 && wb.style !== 9999999;
      if (!!eb !== wDrawn) bad.border.push(`${at} ${s}: Word ${wDrawn ? `${WIDTH[wb.width] ?? wb.width} pt ${hexOf(wb.color)}` : 'sin borde'}, esperado ${eb ? `${eb.width} pt ${eb.color}` : 'sin borde'}`);
      else if (eb && (!near(WIDTH[wb.width] ?? wb.width, eb.width, 0.3) || (hexOf(wb.color) ?? '#000000') !== eb.color)) bad.border.push(`${at} ${s}: Word ${WIDTH[wb.width] ?? wb.width} pt ${hexOf(wb.color)}, esperado ${eb.width} pt ${eb.color}`);
    }
  });
}
console.log(`tablas comparadas: ${tables} de ${exp.length}, celdas: ${cells}`);
for (const [k, v] of Object.entries(bad)) {
  console.log(`  ${k}: ${v.length} diferencias`);
  if (verbose || v.length <= 6) v.slice(0, verbose ? 400 : 6).forEach((x) => console.log('     ', x));
  else v.slice(0, 6).forEach((x) => console.log('     ', x));
}
process.exit(Object.values(bad).some((v) => v.length) ? 1 : 0);
