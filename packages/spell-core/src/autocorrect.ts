/**
 * Autocorrección al escribir, sin formato ni documento: comillas inteligentes, símbolos y fracciones, rayas, mayúscula inicial, dos mayúsculas
 * iniciales y reemplazos propios. Es la lógica común de todos los productos (Writer, Notes, Mail, Calc…); cada uno la aplica a su manera.
 */

import { defaultExceptions, defaultReplacements, type AutoExceptions, type AutoLang } from './autocorrect-data';

export { AUTO_LANGS, autoLangOf, defaultExceptions, defaultReplacements, isAutoLang, type AutoExceptions, type AutoLang } from './autocorrect-data';

/** Lo que se activa o no: es común a todos los idiomas. */
export interface AutoFlags {
  smartQuotes: boolean;
  symbols: boolean;
  fractions: boolean;
  dashes: boolean;
  capitalizeSentences: boolean;
  fixTwoInitialCaps: boolean;
  autoLinks: boolean;
  autoLists: boolean;
  /** Ordinales: `1.o` → `1.º` (español) y `1st` → 1ˢᵗ (inglés, solo donde hay formato). */
  ordinals: boolean;
  /** `*negrita*` y `_cursiva_` (solo donde hay formato). */
  markup: boolean;
}

/** Las opciones de autocorrección ya resueltas para un idioma: lo que usa `correctWord`. */
export interface AutoCorrectOptions extends AutoFlags {
  /** El idioma de la lista y de las excepciones. */
  lang: AutoLang;
  exceptions: AutoExceptions;
  /** Reemplazos: lo que se escribe → lo que queda (los de fábrica del idioma más los propios). */
  custom: Record<string, string>;
}

export const DEFAULT_FLAGS: AutoFlags = {
  smartQuotes: true,
  symbols: true,
  fractions: true,
  dashes: true,
  capitalizeSentences: true,
  fixTwoInitialCaps: true,
  autoLinks: true,
  autoLists: true,
  ordinals: true,
  markup: true,
};

/** Opciones sin lista de reemplazos (la de fábrica llega con `resolveAutoCorrect`). */
export const DEFAULT_AUTOCORRECT: AutoCorrectOptions = { ...DEFAULT_FLAGS, lang: 'es', exceptions: defaultExceptions('es'), custom: {} };

/** La clave de siempre: la lista de reemplazos es una sola para todos los productos (como el archivo .acl de Office). */
export const AUTOCORRECT_KEY = 'nova.writer.autocorrect';

/** Lo que se guarda: las casillas, y por idioma la lista de reemplazos y las excepciones (las que faltan valen las de fábrica). */
export interface AutoCorrectStore {
  version: 2;
  flags: AutoFlags;
  lists: Partial<Record<AutoLang, Record<string, string>>>;
  exceptions: Partial<Record<AutoLang, AutoExceptions>>;
  /** Lista de la autocorrección matemática (`
ombre` → texto); si falta, vale la de fábrica de Ecuaciones. */
  math?: Record<string, string>;
}

export const emptyAutoCorrectStore = (): AutoCorrectStore => ({ version: 2, flags: { ...DEFAULT_FLAGS }, lists: {}, exceptions: {} });

const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
const pairs = (x: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) if (typeof v === 'string' && k) out[k] = v;
  return out;
};

/** Lee lo guardado; entiende también el formato anterior (una sola lista, que pasa a ser la del español). */
export function parseAutoCorrectStore(raw: string | null | undefined): AutoCorrectStore {
  const out = emptyAutoCorrectStore();
  if (!raw) return out;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object') return out;
    const flagSrc = (v.version === 2 ? (v.flags as Record<string, unknown>) : v) ?? {};
    for (const k of Object.keys(DEFAULT_FLAGS) as (keyof AutoFlags)[]) if (typeof flagSrc[k] === 'boolean') out.flags[k] = flagSrc[k] as boolean;
    if (v.math && typeof v.math === 'object') out.math = pairs(v.math);
    if (v.version === 2) {
      for (const l of ['es', 'en'] as const) {
        const list = (v.lists as Record<string, unknown> | undefined)?.[l];
        if (list && typeof list === 'object') out.lists[l] = pairs(list);
        const ex = (v.exceptions as Record<string, Record<string, unknown>> | undefined)?.[l];
        if (ex && typeof ex === 'object') out.exceptions[l] = { firstLetter: strings(ex.firstLetter), twoInitialCaps: strings(ex.twoInitialCaps), other: strings(ex.other) };
      }
    } else {
      out.lists.es = { ...defaultReplacements('es'), ...pairs(v.custom) };
    }
  } catch {
    /* datos dañados: valores de fábrica */
  }
  return out;
}

/** Las opciones de un idioma a partir de lo guardado. */
export function resolveAutoCorrect(s: AutoCorrectStore, lang: AutoLang): AutoCorrectOptions {
  const ex = s.exceptions[lang] ?? defaultExceptions(lang);
  return { ...s.flags, lang, exceptions: { firstLetter: [...ex.firstLetter], twoInitialCaps: [...ex.twoInitialCaps], other: [...ex.other] }, custom: { ...(s.lists[lang] ?? defaultReplacements(lang)) } };
}

export function loadAutoCorrectFrom(store: { getItem(k: string): string | null } | null, lang: AutoLang = 'es'): AutoCorrectOptions {
  let raw: string | null = null;
  try {
    raw = store?.getItem(AUTOCORRECT_KEY) ?? null;
  } catch {
    /* sin almacenamiento */
  }
  return resolveAutoCorrect(parseAutoCorrectStore(raw), lang);
}

/** Guarda las opciones de un idioma sin tocar lo de los demás: las casillas valen para todos, la lista y las excepciones solo para `o.lang`. */
export function saveAutoCorrectTo(store: { getItem?(k: string): string | null; setItem(k: string, v: string): void } | null, o: AutoCorrectOptions): void {
  try {
    const s = parseAutoCorrectStore(store?.getItem?.(AUTOCORRECT_KEY));
    for (const k of Object.keys(DEFAULT_FLAGS) as (keyof AutoFlags)[]) s.flags[k] = o[k];
    s.lists[o.lang] = { ...o.custom };
    s.exceptions[o.lang] = { firstLetter: [...o.exceptions.firstLetter], twoInitialCaps: [...o.exceptions.twoInitialCaps], other: [...o.exceptions.other] };
    store?.setItem(AUTOCORRECT_KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento */
  }
}

/** Símbolos que se escriben con teclas. */
export const SYMBOLS: Record<string, string> = {
  '(c)': '©',
  '(r)': '®',
  '(tm)': '™',
  '(e)': '€',
  '...': '…',
  '-->': '→',
  '<--': '←',
  '==>': '⇒',
  '<==': '⇐',
  '<=>': '⇔',
  ':)': '☺',
  ':(': '☹',
};
/** Símbolos que se cambian al instante (los demás esperan a que se complete la palabra). */
const IMMEDIATE = ['(c)', '(r)', '(tm)', '(e)', '...', '-->', '<--', '==>', '<==', '<=>'];
export const FRACTIONS: Record<string, string> = { '1/2': '½', '1/4': '¼', '3/4': '¾' };

/** Abreviaturas de las dos lenguas, para quien no dice cuáles (`startsSentence` sin excepciones). */
const ABBREVIATIONS = new Set([...defaultExceptions('es').firstLetter, ...defaultExceptions('en').firstLetter]);

const lower = (s: string) => s.toLocaleLowerCase();
const upper = (s: string) => s.toLocaleUpperCase();
const isLetter = (c: string) => lower(c) !== upper(c);

/** Comilla de apertura o de cierre según lo que haya antes. `quote` es `"` o `'`. */
export function smartQuote(quote: '"' | "'", before: string): string {
  const prev = before.slice(-1);
  const opens = prev === '' || /[\s([{¡¿–— ]/.test(prev) || /[“‘«]/.test(prev);
  if (quote === '"') return opens ? '“' : '”';
  // una comilla simple pegada a una letra es apóstrofo o cierre: ’
  return opens ? '‘' : '’';
}

export interface Correction {
  /** El texto que sustituye a la palabra. */
  text: string;
  /** Vínculo que lleva el texto, si es una dirección. */
  href?: string;
  /** Tramo del texto (desplazamientos dentro de `text`) que debe ir en superíndice (los ordinales en inglés); solo donde hay formato. */
  sup?: [number, number];
}

/** ¿Empieza oración una palabra que va tras `before`? `abbreviations` son las abreviaturas (sin el punto) tras las que no empieza; por omisión, las de fábrica. */
export function startsSentence(before: string, abbreviations?: Iterable<string>): boolean {
  const abbr = abbreviations ? new Set([...abbreviations].map((x) => x.toLowerCase())) : ABBREVIATIONS;
  const t = before.replace(/[\s ]+$/, '');
  if (t === '' && before === '') return true;
  if (t === '') return true;
  const last = t.slice(-1);
  if (!/[.!?¡¿:]/.test(last) || last === ':') return false;
  if (last === '.') {
    const word = /([\p{L}.]+)\.$/u.exec(t)?.[1]?.toLowerCase();
    if (word && abbr.has(word)) return false;
    if (word && word.length === 1) return false; // «J. R. R.» y similares
  }
  // exige un espacio tras el signo: «3.5» no es final de oración
  return /[\s ]$/.test(before);
}

/**
 * La corrección de una palabra terminada (al escribir un espacio o un signo). `before` es el texto del párrafo antes de la palabra.
 * Devuelve null si no hay nada que corregir.
 */
export function correctWord(word: string, before: string, o: AutoCorrectOptions): Correction | null {
  if (!word) return null;
  const lc = word.toLocaleLowerCase();
  if (o.exceptions.other.some((x) => x.toLocaleLowerCase() === lc)) return null;
  const custom = replacementFor(o.custom, word);
  if (custom !== undefined) return { text: custom };
  if (o.symbols && SYMBOLS[word]) return { text: SYMBOLS[word]! };
  if (o.fractions && FRACTIONS[word]) return { text: FRACTIONS[word]! };
  if (o.dashes && word === '--') return { text: '–' };
  if (o.dashes && word === '---') return { text: '—' };
  if (o.ordinals) {
    const ord = ordinalOf(word, o.lang);
    if (ord) return ord;
  }
  if (o.autoLinks) {
    if (/^(https?:\/\/)[^\s]+\.[^\s]+$/i.test(word)) return { text: word, href: word };
    if (/^www\.[^\s]+\.[^\s]+$/i.test(word)) return { text: word, href: `http://${word}` };
    if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(word)) return { text: word, href: `mailto:${word}` };
  }
  if (/\d|@|\//.test(word) || /^(https?:|www\.)/i.test(word)) return null;
  const letters = [...word];
  // dos mayúsculas iniciales: «COrrecto» → «Correcto» (no «ID», ni «IDs», ni siglas largas, ni lo que dice la lista de excepciones)
  if (o.fixTwoInitialCaps && letters.length >= 4 && letters[0] === upper(letters[0]!) && isLetter(letters[0]!) && letters[1] === upper(letters[1]!) && isLetter(letters[1]!) && letters.slice(2).every((c) => c === lower(c) && isLetter(c)) && !o.exceptions.twoInitialCaps.includes(word)) {
    const fixed = letters[0]! + lower(letters[1]!) + letters.slice(2).join('');
    return { text: o.capitalizeSentences && startsSentence(before, o.exceptions.firstLetter) ? upper(fixed[0]!) + fixed.slice(1) : fixed };
  }
  if (o.capitalizeSentences && isLetter(letters[0]!) && letters[0] === lower(letters[0]!) && startsSentence(before, o.exceptions.firstLetter)) {
    return { text: upper(letters[0]!) + letters.slice(1).join('') };
  }
  return null;
}

/**
 * El reemplazo de una palabra en la lista. Se busca tal cual y, si no está, sin mayúsculas: lo que se escribe con mayúscula inicial o todo en
 * mayúsculas da el reemplazo con la misma mayúscula (`Teh` → `The`, `TEH` → `THE`), como en Office. Solo para entradas escritas en minúsculas.
 */
export function replacementFor(list: Record<string, string>, word: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(list, word)) return list[word];
  const lc = lower(word);
  if (lc === word || !Object.prototype.hasOwnProperty.call(list, lc)) return undefined;
  const to = list[lc]!;
  const ls = [...word].filter(isLetter);
  if (ls.length > 1 && ls.every((c) => c === upper(c))) return upper(to);
  if (word[0] === upper(word[0]!) && isLetter(word[0]!)) return upper(to[0]!) + to.slice(1);
  return undefined;
}

/**
 * Ordinales. En español `1.o` → `1.º` y `2.a` → `2.ª`. En inglés `1st`, `2nd`, `3rd` y `4th` llevan las letras en superíndice (`sup`), que solo
 * se puede dar donde hay formato; si la terminación no corresponde al número (`2st`) no se toca.
 */
export function ordinalOf(word: string, lang: AutoLang): Correction | null {
  if (lang === 'es') {
    const m = /^(\d+)\.(o|a)$/.exec(word);
    return m ? { text: `${m[1]}.${m[2] === 'o' ? 'º' : 'ª'}` } : null;
  }
  const m = /^(\d+)(st|nd|rd|th)$/.exec(word);
  if (!m) return null;
  const n = Number(m[1]);
  const right = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
  return right === m[2] ? { text: word, sup: [m[1]!.length, word.length] } : null;
}

/** Un trozo `*negrita*` o `_cursiva_` recién cerrado: dónde están los marcadores y el texto de en medio. */
export interface MarkupMatch {
  kind: 'bold' | 'italic';
  /** Posición del marcador de apertura y del de cierre (el último carácter del texto dado). */
  open: number;
  close: number;
  /** El texto entre los marcadores. */
  inner: string;
}

/**
 * ¿Acaba `before` (el texto del párrafo hasta el cursor, con el marcador de cierre ya escrito) en un trozo `*así*` o `_así_`? El marcador de apertura debe
 * ir pegado a la primera letra y precedido de inicio, espacio o signo de apertura; el de cierre, pegado a la última.
 */
export function findMarkup(before: string): MarkupMatch | null {
  const last = before.slice(-1);
  if (last !== '*' && last !== '_') return null;
  const e = last === '*' ? '\\*' : '_';
  const m = new RegExp(`(^|[\\s(¿¡"“'‘«])${e}([^\\s${e}](?:[^${e}]*[^\\s${e}])?)${e}$`).exec(before);
  if (!m) return null;
  const open = m.index + m[1]!.length;
  return { kind: last === '*' ? 'bold' : 'italic', open, close: before.length - 1, inner: m[2]! };
}

/** Líneas que, al pulsar Intro, se convierten en un borde de párrafo (`---` fina, `___` gruesa, `===` doble, `***` punteada, `~~~` ondulada, `###` triple). */
export type RuleKind = 'thin' | 'thick' | 'double' | 'dotted' | 'wavy' | 'triple';
export function ruleLineKind(line: string): RuleKind | null {
  const t = line.trim();
  if (!/^(-{3,}|_{3,}|={3,}|\*{3,}|~{3,}|#{3,})$/.test(t)) return null;
  return ({ '-': 'thin', _: 'thick', '=': 'double', '*': 'dotted', '~': 'wavy', '#': 'triple' } as Record<string, RuleKind>)[t[0]!] ?? null;
}

/** Lo que queda de un texto de una línea o de varias tras escribir: la palabra completada se corrige en el sitio. */
export interface TypedResult {
  text: string;
  /** Dónde queda el cursor. */
  caret: number;
}

/**
 * Autocorrección para campos de texto sin formato (un `<textarea>`, una celda): `prev` es el texto antes de la pulsación, `next` el de
 * después y `caret` la posición del cursor ya movida. Si lo escrito es un carácter que completa una palabra, se corrige la palabra anterior;
 * las comillas rectas se vuelven tipográficas y los símbolos de teclas (`(c)`, `...`, `-->`) se cambian al instante. Devuelve `null` si no hay nada que cambiar.
 * No hace vínculos ni listas (eso necesita formato).
 */
export function autoCorrectTyped(prev: string, next: string, caret: number, o: AutoCorrectOptions): TypedResult | null {
  // solo una inserción de un carácter, justo antes del cursor
  if (next.length !== prev.length + 1 || caret < 1 || next.slice(0, caret - 1) + next.slice(caret) !== prev) return null;
  const ch = next[caret - 1]!;
  const head = next.slice(0, caret - 1);
  const tail = next.slice(caret);
  const out = (text: string, at: number): TypedResult => ({ text, caret: at });
  if (o.smartQuotes && (ch === '"' || ch === "'")) {
    const q = smartQuote(ch, head);
    return out(head + q + tail, head.length + q.length);
  }
  if (o.symbols) {
    for (const key of IMMEDIATE) {
      if ((head + ch).endsWith(key)) {
        const start = head.length + 1 - key.length;
        const text = head.slice(0, start) + SYMBOLS[key]! + tail;
        return out(text, start + SYMBOLS[key]!.length);
      }
    }
  }
  if (!/[\s.,;:!?)\]]/.test(ch)) return null;
  let i = head.length;
  while (i > 0 && !/[\s ]/.test(head[i - 1]!)) i--;
  const word = head.slice(i);
  if (!word) return null;
  const before = head.slice(0, i);
  if ((ch === '.' || ch === ')') && before.trim() === '' && /^([a-zA-Z]|[ivxlcdmIVXLCDM]{1,4}|\d+)$/.test(word)) return null;
  if (/[.,;:!?)\]]/.test(ch) && /^[.,;:!?)\]\d]+$/.test(word)) return null;
  const fix = correctWord(word, before.slice(Math.max(0, before.lastIndexOf('\n') + 1)), { ...o, autoLinks: false });
  if (!fix || fix.text === word || fix.sup) return null;
  const text = before + fix.text + ch + tail;
  return out(text, before.length + fix.text.length + 1);
}

/** La lista de la autocorrección matemática guardada (`null` si no se ha tocado: vale la de fábrica). */
export function loadMathListFrom(store: { getItem(k: string): string | null } | null): Record<string, string> | null {
  try {
    return parseAutoCorrectStore(store?.getItem(AUTOCORRECT_KEY)).math ?? null;
  } catch {
    return null;
  }
}

/** Guarda la lista matemática sin tocar el resto (`null` vuelve a la de fábrica). */
export function saveMathListTo(store: { getItem?(k: string): string | null; setItem(k: string, v: string): void } | null, list: Record<string, string> | null): void {
  try {
    const s = parseAutoCorrectStore(store?.getItem?.(AUTOCORRECT_KEY));
    if (list) s.math = { ...list };
    else delete s.math;
    store?.setItem(AUTOCORRECT_KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento */
  }
}


// ------------------------------------------------------------------------------------------------- importar y exportar

/** Una lista de reemplazos como texto CSV (`reemplazar,con`, entre comillas si hace falta), una entrada por línea y en orden alfabético. */
export function exportReplacements(list: Record<string, string>): string {
  const q = (x: string) => (/[",;\t\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
  return Object.keys(list)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => `${q(k)},${q(list[k]!)}`)
    .join('\r\n');
}

/** Lee un texto de reemplazos: tabulador, coma o punto y coma entre las dos columnas, con comillas CSV; ignora líneas vacías y las que empiezan por `#`. */
export function importReplacements(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const src = text.replace(/^﻿/, '');
  let i = 0;
  const field = (): { v: string; sep: string } => {
    let v = '';
    if (src[i] === '"') {
      i++;
      for (; i < src.length; i++) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            v += '"';
            i++;
          } else {
            i++;
            break;
          }
        } else v += src[i];
      }
    } else {
      while (i < src.length && !'\t,;\r\n'.includes(src[i]!)) v += src[i++];
    }
    return { v, sep: src[i] ?? '\n' };
  };
  while (i < src.length) {
    if (src[i] === '\r' || src[i] === '\n') {
      i++;
      continue;
    }
    if (src[i] === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    const a = field();
    let b = { v: '', sep: '\n' };
    if (a.sep === '\t' || a.sep === ',' || a.sep === ';') {
      i++;
      b = field();
    }
    while (i < src.length && src[i] !== '\n') i++;
    const k = a.v.trim();
    if (k && !/\s/.test(k) && b.v) out[k] = b.v;
  }
  return out;
}
