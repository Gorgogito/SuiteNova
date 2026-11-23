// Compares what PowerPoint shows for each table of estilos.pptx (celdas-pptx.json) with what table-core says it should look like (esperado-pptx.json).
// Usage: node scripts/office-tables/compare-pptx-styles.mjs <folder> [--verbose]
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const verbose = process.argv.includes('--verbose');
const exp = JSON.parse(fs.readFileSync(path.join(dir, 'esperado-pptx.json'), 'utf8'));
let word = JSON.parse(fs.readFileSync(path.join(dir, 'celdas-pptx.json'), 'utf8').replace(/^﻿/, ''));
if (!Array.isArray(word)) word = [word];
const hexOf = (bgr) => '#' + [bgr & 255, (bgr >> 8) & 255, (bgr >> 16) & 255].map((v) => v.toString(16).padStart(2, '0')).join('');
const bad = { fill: [], bold: [], color: [], border: [] };
let cells = 0;
let tables = 0;
for (let i = 0; i < exp.length; i++) {
  const e = exp[i];
  const w = word[i];
  if (!w) continue;
  tables++;
  w.cells.forEach((wc, k) => {
    const l = e.looks[k];
    cells++;
    const at = `${e.style}/${e.opts} (${wc.row},${wc.col})`;
    const wf = wc.fillVisible && wc.fillTransparency < 1 ? hexOf(wc.fill) : null;
    if ((wf ?? null) !== (l.fill ?? null)) bad.fill.push(`${at}: PowerPoint ${wf}, esperado ${l.fill}`);
    if (Boolean(wc.bold) !== Boolean(l.bold)) bad.bold.push(`${at}: PowerPoint ${wc.bold}, esperado ${l.bold}`);
    if (l.color && hexOf(wc.color) !== l.color) bad.color.push(`${at}: PowerPoint ${hexOf(wc.color)}, esperado ${l.color}`);
    for (const [pk, ek] of [['t', 't'], ['l', 'l'], ['b', 'b'], ['r', 'r']]) {
      const wb = wc.borders[pk];
      const eb = l.borders[ek];
      const drawn = wb.visible !== 0 && wb.weight > 0 && wb.transparency < 1;
      if (!!eb !== drawn) bad.border.push(`${at} ${ek}: PowerPoint ${drawn ? `${wb.weight} pt ${hexOf(wb.color)}` : 'sin borde'}, esperado ${eb ? `${eb.width} pt ${eb.color}` : 'sin borde'}`);
      else if (eb && (Math.abs(wb.weight - eb.width) > 0.13 || hexOf(wb.color) !== eb.color)) bad.border.push(`${at} ${ek}: PowerPoint ${wb.weight} pt ${hexOf(wb.color)}, esperado ${eb.width} pt ${eb.color}`);
    }
  });
}
console.log(`tablas comparadas: ${tables} de ${exp.length}, celdas: ${cells}`);
for (const [k, v] of Object.entries(bad)) {
  console.log(`  ${k}: ${v.length} diferencias`);
  v.slice(0, verbose ? 400 : 6).forEach((x) => console.log('     ', x));
}
if (process.argv.includes('--summary')) {
  const groups = new Map();
  for (const x of bad.border) {
    const fam = x.split('/')[0].replace(/-\d$/, '');
    const m = / ([tlbr]): PowerPoint (.*), esperado (.*)$/.exec(x);
    const key = `${fam} ${m[1]}: PowerPoint ${m[2].replace(/#\w+/, '#')} | esperado ${m[3].replace(/#\w+/, '#')}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  [...groups].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, n]) => console.log(String(n).padStart(5), k));
}
process.exit(Object.values(bad).some((v) => v.length) ? 1 : 0);
