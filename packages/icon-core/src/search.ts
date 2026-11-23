// Searching the catalog: by the Spanish or the English name, without caring about accents or capitals, every typed word must start a word of the name.
import type { Catalog, IconInfo, IconStyle } from './catalog';

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export interface SearchOptions {
  category?: string | null;
  style?: IconStyle | null;
  limit?: number;
}

const words = new WeakMap<IconInfo, string[]>();
function wordsOf(i: IconInfo): string[] {
  let w = words.get(i);
  if (!w) words.set(i, (w = [...normalize(i.name).split(/\s+/), ...i.en.split(/\s+/)]));
  return w;
}

/** The icons that match, the best first (names that start with what was typed, then shorter names, then alphabetical). An empty text gives the category (or all). */
export function searchIcons(cat: Catalog, text: string, opts: SearchOptions = {}): IconInfo[] {
  const q = normalize(text).split(/\s+/).filter(Boolean);
  const scored: [number, IconInfo][] = [];
  for (const i of cat.icons) {
    if (opts.category && i.category !== opts.category) continue;
    if (opts.style && !i.styles.includes(opts.style)) continue;
    if (!q.length) { scored.push([0, i]); continue; }
    const w = wordsOf(i);
    let score = 0;
    let ok = true;
    for (const t of q) {
      let best = -1;
      for (let k = 0; k < w.length; k++) {
        const x = w[k]!;
        const s = x === t ? 100 : x.startsWith(t) ? 60 : -1;
        if (s > best) best = s - (k === 0 ? 0 : 5);
      }
      if (best < 0) { ok = false; break; }
      score += best;
    }
    if (ok) scored.push([score - wordsOf(i).length, i]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name, 'es'));
  const out = scored.map((s) => s[1]);
  return opts.limit ? out.slice(0, opts.limit) : out;
}
