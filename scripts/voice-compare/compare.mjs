// Compares how Word and the shared reader cut each paragraph of the corpus into sentences. Usage: node scripts/voice-compare/compare.mjs ours.json word.json [report.txt]
import fs from 'node:fs';

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const corpus = read(new URL('./corpus.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ours = read(process.argv[2]);
const word = read(process.argv[3]).map((x) => (Array.isArray(x) ? x : Array.isArray(x?.value) ? x.value : [x?.value ?? x]));
const norm = (s) => s.replace(/\s+/g, ' ').trim();
let same = 0;
const lines = [];
corpus.forEach((t, i) => {
  const a = ours[i].map(norm);
  const b = (word[i] ?? []).map(norm);
  const ok = a.length === b.length && a.every((x, k) => x === b[k]);
  if (ok) same++;
  else lines.push(`#${i + 1}  ${JSON.stringify(t)}\n    Nova: ${JSON.stringify(a)}\n    Word: ${JSON.stringify(b)}`);
});
const head = `Párrafos iguales: ${same} de ${corpus.length} (${Math.round((100 * same) / corpus.length)} %)\n`;
const report = head + (lines.length ? `\nDiferencias:\n${lines.join('\n')}\n` : '');
console.log(report);
if (process.argv[4]) fs.writeFileSync(process.argv[4], report);
