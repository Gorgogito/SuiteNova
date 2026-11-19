// Sets the results of Nova Basic (nova-out.json) against real Excel's VBA (excel-out.json) and writes informe.txt.
// Usage: node scripts/vba-compare/compare.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, ''));
const excel = read('excel-out.json');
const nova = read('nova-out.json');
const byId = new Map(nova.results.map((r) => [r.id, r]));
const out = [];
let same = 0;
const diffs = [];
for (const e of excel.results) {
  const n = byId.get(e.id);
  const ev = e.error ? `⚠ ${e.error}` : e.value;
  const nv = n.error ? `⚠ ${n.error}` : n.value;
  // an error is an error: the text of the message depends on the language of Office
  const bothError = (e.error || /^#ERROR/.test(e.value ?? '')) && (n.error || /^#ERROR/.test(n.value ?? ''));
  if (ev === nv || bothError) same++;
  else diffs.push({ id: e.id, excel: ev, nova: nv });
}
out.push(`Comparación de Nova Basic con VBA de Excel ${excel.version} (separador decimal «${excel.decimal}», cultura ${excel.culture})`);
out.push(`${excel.results.length} fragmentos: ${same} idénticos, ${diffs.length} distintos.`);
out.push('');
for (const d of diffs) {
  out.push(`## ${d.id}`);
  out.push(`  Excel: ${JSON.stringify(d.excel)}`);
  out.push(`  Nova : ${JSON.stringify(d.nova)}`);
}
fs.writeFileSync(path.join(dir, 'informe.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
