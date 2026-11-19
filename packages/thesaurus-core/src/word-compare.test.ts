// Contraste con Word real: lee scripts/word-compare/word-syn-out.json (generado por word-syn.ps1) y escribe informe-sinonimos.txt. No afirma nada:
// Word es la referencia, no el criterio.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { Thesaurus } from './index';

const dir = fileURLToPath(new URL('../../../scripts/word-compare/', import.meta.url));
const file = dir + 'word-syn-out.json';
const load = (f: string, lang: 'es' | 'en') => new Thesaurus(fs.readFileSync(fileURLToPath(new URL(`../data/${f}`, import.meta.url)), 'utf8'), lang);

describe.skipIf(!fs.existsSync(file))('contraste de sinónimos con Word', () => {
  it('informe', () => {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as { lang: 'es' | 'en'; word: string; found: boolean; synonyms: string[] | Record<string, never> }[];
    const th = { es: load('th-es.txt', 'es'), en: load('th-en.txt', 'en') };
    const out: string[] = [];
    const stat = { es: { n: 0, both: 0, onlyWord: 0, onlyNova: 0, neither: 0, overlap: 0, withOverlap: 0, shared: 0 }, en: { n: 0, both: 0, onlyWord: 0, onlyNova: 0, neither: 0, overlap: 0, withOverlap: 0, shared: 0 } };
    for (const r of rows) {
      const s = stat[r.lang];
      s.n++;
      const wordSyn = (Array.isArray(r.synonyms) ? r.synonyms : []).map((x) => x.toLowerCase());
      const look = th[r.lang].lookup(r.word);
      const nova = look ? look.senses.flatMap((x) => [...x.synonyms, ...x.related]).map((x) => x.toLowerCase()) : [];
      const novaOnly = look ? look.senses.flatMap((x) => x.synonyms).map((x) => x.toLowerCase()) : [];
      const found = r.found && wordSyn.length > 0;
      if (found && look) s.both++;
      else if (found) s.onlyWord++;
      else if (look) s.onlyNova++;
      else s.neither++;
      if (found && look) {
        const w = new Set(wordSyn);
        const shared = [...new Set(novaOnly)].filter((x) => w.has(x));
        s.shared += shared.length > 0 ? 1 : 0;
        const common = [...new Set(nova)].filter((x) => w.has(x)).length;
        s.overlap += common / Math.max(1, Math.min(w.size, new Set(nova).size));
        s.withOverlap += common > 0 ? 1 : 0;
      }
      out.push(`${r.lang} «${r.word}»: Word=${found ? wordSyn.length + ' sinónimos' : 'no encontrada'}; Nova=${look ? `${new Set(novaOnly).size} sinónimos${look.lemma ? ` (de «${look.entry}»)` : ''}` : 'no encontrada'}${found && look ? `; en común: ${[...new Set(nova)].filter((x) => new Set(wordSyn).has(x)).slice(0, 6).join(', ') || '(ninguno)'}` : ''}`);
    }
    const head = (['es', 'en'] as const)
      .map((l) => {
        const s = stat[l];
        return `${l}: ${s.n} palabras. Las dos la encuentran: ${s.both}; solo Word: ${s.onlyWord}; solo Nova: ${s.onlyNova}; ninguna: ${s.neither}. De las que encuentran las dos, comparten algún término (sinónimos o parecidos de Nova): ${s.withOverlap}/${s.both}; comparten algún sinónimo estricto: ${s.shared}/${s.both}; coincidencia media sobre la lista más corta: ${s.both ? Math.round((100 * s.overlap) / s.both) : 0} %.`;
      })
      .join('\n');
    fs.writeFileSync(dir + 'informe-sinonimos.txt', `${head}\n\n${out.join('\n')}\n`);
  });
});
