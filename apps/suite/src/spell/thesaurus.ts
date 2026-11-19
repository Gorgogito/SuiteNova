import { thesaurusLangFor, Thesaurus, THESAURUS_LANGS, type Lookup, type ThesaurusLang } from '@suitenova/thesaurus-core';
import { langForTag, type SpellLang } from '@suitenova/spell-core';
import { useEffect, useState } from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { writerMarkInfo, type MarkInfo } from './engine';
import { loadedEngine } from './load';

// Los tesauros son archivos aparte (6 MB el inglés): se piden al usarlos, no entran en el paquete de la aplicación
const FILES: Record<ThesaurusLang, URL> = {
  es: new URL('../../../../packages/thesaurus-core/data/th-es.txt', import.meta.url),
  en: new URL('../../../../packages/thesaurus-core/data/th-en.txt', import.meta.url),
};
const loading = new Map<ThesaurusLang, Promise<Thesaurus>>();
const ready = new Map<ThesaurusLang, Thesaurus>();

/** Carga (una vez) el tesauro de un idioma. */
export function loadThesaurus(lang: ThesaurusLang): Promise<Thesaurus> {
  let p = loading.get(lang);
  if (!p) {
    p = fetch(FILES[lang])
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        const t = new Thesaurus(text, lang);
        ready.set(lang, t);
        return t;
      });
    loading.set(lang, p);
    p.catch(() => loading.delete(lang));
  }
  return p;
}

/** El tesauro de un idioma si ya está cargado (sin esperar). */
export const loadedThesaurus = (lang: ThesaurusLang): Thesaurus | null => ready.get(lang) ?? null;

export const thesaurusLangOf = (lang: SpellLang | 'off'): ThesaurusLang | null => (lang === 'off' ? null : thesaurusLangFor(lang));

export interface SynonymResult {
  lookup: Lookup | null;
  /** Si la palabra no está: palabras parecidas (del corrector) que sí tienen entrada. */
  similar: string[];
}

/** Busca una palabra: la entrada, o, si no hay, palabras parecidas que sí la tengan. */
export function findSynonyms(th: Thesaurus, word: string, lang: SpellLang): SynonymResult {
  const lookup = th.lookup(word);
  if (lookup) return { lookup, similar: [] };
  const engine = loadedEngine(lang);
  const similar = (engine ? engine.suggest(word) : []).filter((s) => th.has(s)).slice(0, 5);
  return { lookup: null, similar };
}

/** Carga el tesauro del idioma y devuelve el resultado de buscar la palabra; `loading` mientras llega el archivo. */
export function useSynonyms(word: string, lang: SpellLang | 'off'): { result: SynonymResult | null; loading: boolean; error: string } {
  const tl = thesaurusLangOf(lang);
  const [th, setTh] = useState<Thesaurus | null>(tl ? loadedThesaurus(tl) : null);
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    if (!tl) {
      setTh(null);
      return;
    }
    let alive = true;
    const have = loadedThesaurus(tl);
    if (have) setTh(have);
    else {
      setTh(null);
      loadThesaurus(tl).then(
        (t) => alive && setTh(t),
        (e: Error) => alive && setError(e.message),
      );
    }
    return () => {
      alive = false;
    };
  }, [tl]);
  const result = th && lang !== 'off' && word.trim() ? findSynonyms(th, word, lang) : null;
  return { result, loading: !!tl && !th && !error, error };
}

/** La palabra sobre la que está el cursor o el texto seleccionado (si cabe en un solo bloque), con el tramo que ocupa. */
export function wordAtSelection(view: EditorView): { word: string; from: number; to: number } | null {
  const { selection, doc } = view.state;
  if (!selection.empty) {
    if (!doc.resolve(selection.from).sameParent(doc.resolve(selection.to))) return null;
    const raw = doc.textBetween(selection.from, selection.to, ' ');
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!word || word.length > 60) return null;
    const lead = raw.indexOf(word);
    return { word, from: selection.from + lead, to: selection.from + lead + word.length };
  }
  return wordAround(doc, selection.from);
}

/** La palabra que contiene una posición del documento (o que termina justo ahí), con el tramo que ocupa. */
export function wordAround(doc: PMNode, pos: number): { word: string; from: number; to: number } | null {
  const $pos = doc.resolve(pos);
  if (!$pos.parent.isTextblock) return null;
  const text = $pos.parent.textBetween(0, $pos.parent.content.size, undefined, '￼');
  const w = wordInText(text, $pos.parentOffset);
  if (!w) return null;
  const base = $pos.start();
  return { word: w.word, from: base + w.from, to: base + w.to };
}

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{M}\p{N}'’-]/u.test(ch);

/** La palabra que contiene un desplazamiento de un texto (o que termina justo ahí), con el tramo que ocupa; sin apóstrofos ni guiones en los extremos. */
export function wordInText(text: string, off: number): { word: string; from: number; to: number } | null {
  let a = off;
  let b = off;
  while (a > 0 && isWordChar(text[a - 1])) a--;
  while (b < text.length && isWordChar(text[b])) b++;
  const raw = text.slice(a, b);
  const word = raw.replace(/^['’-]+|['’-]+$/g, '');
  if (!word) return null;
  const from = a + raw.indexOf(word);
  return { word, from, to: from + word.length };
}

export { THESAURUS_LANGS };

/** El idioma propio del texto que hay en una posición (por su marca de idioma), o `null` si usa el del documento. */
export function langAtPos(view: EditorView, pos: number, markInfo: MarkInfo = writerMarkInfo): SpellLang | null {
  // writing over a «select all» asks for the character before position 0
  if (pos < 0 || pos >= view.state.doc.content.size) return null;
  const node = view.state.doc.nodeAt(pos);
  return node?.isText ? langForTag(markInfo(node).lang) : null;
}
