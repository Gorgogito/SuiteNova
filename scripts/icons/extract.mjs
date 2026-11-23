// Reads the Fluent System Icons (MIT) from the installed package and writes the raw table: slug -> { s, r, f } (viewBox size, regular paths, filled paths).
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const out = process.argv[3];
const dir = path.join(root, 'lib/atoms/svg');
const table = {};
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.js')) continue;
  const slug = f.slice(0, -3);
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const found = {};
  for (const m of src.matchAll(/createFluentIcon\('(\w+)', "(\w+)", (\[(?:"[^"]*"(?:, )?)+\])\)/g)) {
    const name = m[1];
    const mm = /^(.*?)(\d+)?(Regular|Filled)$/.exec(name);
    if (!mm) continue;
    const size = mm[2] ? +mm[2] : 0;
    if (!size) continue; // only the numbered sizes
    const style = mm[3] === 'Regular' ? 'r' : 'f';
    (found[style] ??= {})[size] = JSON.parse(m[3]);
  }
  const pick = (o) => {
    if (!o) return null;
    for (const s of [24, 20, 28, 16, 32, 48, 12]) if (o[s]) return [s, o[s]];
    return null;
  };
  const r = pick(found.r);
  const fi = pick(found.f);
  if (!r && !fi) continue;
  const s = (r ?? fi)[0];
  const entry = { s };
  if (r) entry.r = r[0] === s ? r[1] : null;
  if (fi) entry.f = fi[0] === s ? fi[1] : null;
  if (!entry.r && !entry.f) continue;
  table[slug] = entry;
}
fs.writeFileSync(out, JSON.stringify(table));
const keys = Object.keys(table);
console.log(keys.length, 'iconos', fs.statSync(out).size, 'bytes');
const freq = {};
for (const k of keys) for (const t of k.split('-')) freq[t] = (freq[t] ?? 0) + 1;
fs.writeFileSync(out.replace(/\.json$/, '-tokens.json'), JSON.stringify(Object.entries(freq).sort((a, b) => b[1] - a[1])));
console.log(Object.keys(freq).length, 'palabras');
