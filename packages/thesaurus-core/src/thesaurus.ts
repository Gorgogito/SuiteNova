import { lemmaCandidates, matchCase } from './forms';
import type { ThesaurusLang } from './languages';

export type Pos = 'noun' | 'verb' | 'adj' | 'adv';
const POS: Record<string, Pos> = { n: 'noun', v: 'verb', a: 'adj', r: 'adv' };

/** Un significado de la palabra: sus sinónimos, términos parecidos y antónimos. */
export interface Sense {
  pos?: Pos;
  synonyms: string[];
  /** Términos cercanos o parecidos (no sinónimos estrictos). */
  related: string[];
  antonyms: string[];
}

export interface Lookup {
  /** La palabra tal como se buscó. */
  word: string;
  /** La entrada del tesauro que se encontró (la propia palabra o su forma de base). */
  entry: string;
  /** `true` si la entrada no es la palabra tal cual, sino su forma de base (singular, masculino, infinitivo…). */
  lemma: boolean;
  senses: Sense[];
}

const parseSense = (raw: string): Sense => {
  const bar = raw.indexOf('|');
  const sense: Sense = { synonyms: [], related: [], antonyms: [] };
  const pos = POS[raw.slice(0, bar)];
  if (pos) sense.pos = pos;
  for (const w of raw.slice(bar + 1).split(';')) {
    if (w.startsWith('!')) sense.antonyms.push(w.slice(1));
    else if (w.startsWith('~')) sense.related.push(w.slice(1));
    else if (w) sense.synonyms.push(w);
  }
  return sense;
};

/**
 * Un tesauro cargado en memoria. El archivo es texto ordenado, una entrada por línea (`palabra<TAB>significado<TAB>significado…`, cada
 * significado `categoría|sinónimo;~parecido;!antónimo`), así que se busca con una búsqueda binaria sobre los inicios de línea sin
 * construir un objeto por entrada: cargar 6 MB cuesta una pasada por el texto.
 */
export class Thesaurus {
  private readonly starts: Uint32Array;
  constructor(
    private readonly text: string,
    readonly lang: ThesaurusLang,
  ) {
    const n: number[] = [0];
    for (let i = text.indexOf('\n'); i !== -1 && i + 1 < text.length; i = text.indexOf('\n', i + 1)) n.push(i + 1);
    this.starts = Uint32Array.from(n);
  }

  /** Cuántas entradas tiene. */
  get size(): number {
    return this.starts.length;
  }

  private line(i: number): string {
    const a = this.starts[i]!;
    const b = i + 1 < this.starts.length ? this.starts[i + 1]! - 1 : this.text.length;
    return this.text.slice(a, b);
  }

  private find(head: string): Sense[] | null {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const l = this.line(mid);
      const t = l.indexOf('\t');
      const h = l.slice(0, t);
      if (h === head) {
        return l
          .slice(t + 1)
          .split('\t')
          .map(parseSense);
      }
      if (h < head) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  has(word: string): boolean {
    return this.lookup(word) !== null;
  }

  /** Busca una palabra o expresión; si no está tal cual, prueba sus formas de base. `null` si no hay entrada. */
  lookup(word: string): Lookup | null {
    const w = word.normalize('NFC').trim().replace(/\s+/g, ' ');
    if (!w) return null;
    const key = w.toLowerCase();
    const direct = this.find(key);
    if (direct) return { word: w, entry: key, lemma: false, senses: direct };
    if (key.includes(' ')) return null;
    for (const c of lemmaCandidates(key, this.lang)) {
      const s = this.find(c);
      if (s) return { word: w, entry: c, lemma: true, senses: s };
    }
    return null;
  }

  /** Los significados ya con la mayúscula de la palabra escrita (Casa → Vivienda, CASA → VIVIENDA). */
  synonymsFor(word: string): { entry: string; lemma: boolean; senses: Sense[] } | null {
    const r = this.lookup(word);
    if (!r) return null;
    const map = (xs: string[]): string[] => xs.map((x) => matchCase(word, x));
    return { entry: r.entry, lemma: r.lemma, senses: r.senses.map((s) => ({ ...s, synonyms: map(s.synonyms), related: map(s.related), antonyms: map(s.antonyms) })) };
  }
}
