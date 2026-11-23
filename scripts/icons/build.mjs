// Builds the catalog of icon-core from the raw table (scripts/icons/extract.mjs) and the Spanish dictionary.
// Usage: node scripts/icons/build.mjs <raw.json>
import fs from 'node:fs';
import { DICT as D0, CATEGORIES, OTHER } from './dict.mjs';
import { MORE, EXTRA_WORDS } from './dict-more.mjs';
const DICT = { ...D0, ...MORE };
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cats = [...CATEGORIES.map((c) => ({ id: c[0], name: c[1], words: new Set((c[2] + ' ' + (EXTRA_WORDS[c[0]] ?? '')).split(' ')) })), { id: OTHER[0], name: OTHER[1], words: new Set() }];
const catalog = [];
const paths = {};
const dropped = {};
for (const [slug, e] of Object.entries(raw)) {
  const tokens = slug.split('-');
  const unknown = tokens.filter((t) => !DICT[t] && !/^\d+$/.test(t));
  if (unknown.length) { for (const u of unknown) dropped[u] = (dropped[u] ?? 0) + 1; continue; }
  const es = tokens.map((t) => DICT[t] ?? t).join(' ');
  const en = tokens.join(' ');
  // the head word of the name decides (Fluent names start with the thing: «Cloud arrow up» is a cloud)
  let ci = -1;
  for (const t of tokens) { ci = cats.findIndex((c) => c.words.has(t)); if (ci >= 0) break; }
  if (ci < 0) ci = cats.length - 1;
  const flags = (e.r ? 1 : 0) | (e.f ? 2 : 0);
  catalog.push([slug, es[0].toUpperCase() + es.slice(1), en, ci, e.s, flags]);
  paths[slug] = [e.r ?? 0, e.f ?? 0];
}
catalog.sort((a, b) => a[2].localeCompare(b[2]));
const dir = 'packages/icon-core/src/data/';
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(dir + 'catalog.json', JSON.stringify({ categories: cats.map((c) => [c.id, c.name]), icons: catalog }));
fs.writeFileSync(dir + 'paths.json', JSON.stringify(paths));
console.log(catalog.length, 'de', Object.keys(raw).length, 'iconos;', fs.statSync(dir + 'paths.json').size, 'bytes de trazos;', fs.statSync(dir + 'catalog.json').size, 'de catálogo');
const per = cats.map((c, i) => `${c.name}: ${catalog.filter((x) => x[3] === i).length}`);
console.log(per.join(' | '));
console.log('palabras que faltan:', Object.entries(dropped).sort((a, b) => b[1] - a[1]).slice(0, 700).map((x) => x.join(':')).join(' '));
