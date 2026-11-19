// Convierte los tesauros MyThes de LibreOffice (es: OpenThesaurus, LGPL 2.1; en: WordNet) al formato compacto de thesaurus-core.
// Uso: node scripts/build-thesaurus.mjs   (descarga los .dat originales a packages/thesaurus-core/data/src si faltan)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../packages/thesaurus-core/data');
const src = path.join(root, 'src');
fs.mkdirSync(src, { recursive: true });
const BASE = 'https://raw.githubusercontent.com/LibreOffice/dictionaries/master';
const JOBS = [
  { id: 'es', url: `${BASE}/es/th_es_v2.dat`, file: 'th_es_v2.dat', out: 'th-es.txt' },
  { id: 'en', url: `${BASE}/en/th_en_US_v2.dat`, file: 'th_en_US_v2.dat', out: 'th-en.txt' },
];
const POS = { noun: 'n', verb: 'v', adj: 'a', adv: 'r' };

for (const j of JOBS) {
  const f = path.join(src, j.file);
  if (!fs.existsSync(f)) fs.writeFileSync(f, Buffer.from(await (await fetch(j.url)).arrayBuffer()));
  const raw = fs.readFileSync(f);
  const enc = raw.subarray(0, raw.indexOf(10)).toString('latin1').trim();
  const text = new TextDecoder(enc.toUpperCase().startsWith('UTF') ? 'utf-8' : 'iso-8859-1').decode(raw.subarray(raw.indexOf(10) + 1));
  const lines = text.split(/\r?\n/);
  const map = new Map();
  for (let i = 0; i < lines.length; ) {
    const m = /^(.+)\|(\d+)$/.exec(lines[i]);
    if (!m) { i++; continue; }
    const head = m[1].normalize('NFC').toLowerCase();
    const senses = map.get(head) ?? [];
    for (let k = 1; k <= Number(m[2]); k++) {
      const parts = (lines[i + k] ?? '').split('|');
      const tag = /^\((\w+)\)$/.exec(parts[0]);
      const pos = tag ? (POS[tag[1]] ?? '') : '';
      const words = [];
      const seen = new Set([head]);
      for (const p of parts.slice(1)) {
        const w = /^(.*?)(?: \((generic term|similar term|related term|antonym)\))?$/.exec(p.trim());
        if (!w || !w[1]) continue;
        const kind = w[2];
        if (kind === 'generic term') continue;
        const word = w[1].normalize('NFC').replace(/[;\t]/g, ' ');
        const key = word.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        words.push((kind === 'antonym' ? '!' : kind ? '~' : '') + word);
      }
      // sinónimos primero, luego parecidos y, al final, antónimos
      const rank = (w) => (w[0] === '!' ? 2 : w[0] === '~' ? 1 : 0);
      words.sort((a, b) => rank(a) - rank(b));
      if (words.length) senses.push(`${pos}|${words.join(';')}`);
    }
    if (senses.length) map.set(head, senses);
    i += Number(m[2]) + 1;
  }
  const keys = [...map.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  fs.writeFileSync(path.join(root, j.out), keys.map((k) => `${k}\t${map.get(k).join('\t')}`).join('\n') + '\n');
  console.log(j.id, keys.length, 'entradas', (fs.statSync(path.join(root, j.out)).size / 1e6).toFixed(2), 'MB');
}
