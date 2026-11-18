/**
 * Autocorrección al escribir, sin formato ni documento: comillas inteligentes, símbolos y fracciones, rayas, mayúscula inicial, dos mayúsculas
 * iniciales y reemplazos propios. Es la lógica común de todos los productos (Writer, Notes, Mail, Calc…); cada uno la aplica a su manera.
 */

export interface AutoCorrectOptions {
  smartQuotes: boolean;
  symbols: boolean;
  fractions: boolean;
  dashes: boolean;
  capitalizeSentences: boolean;
  fixTwoInitialCaps: boolean;
  autoLinks: boolean;
  autoLists: boolean;
  /** Reemplazos propios: lo que se escribe → lo que queda. */
  custom: Record<string, string>;
}

export const DEFAULT_AUTOCORRECT: AutoCorrectOptions = {
  smartQuotes: true,
  symbols: true,
  fractions: true,
  dashes: true,
  capitalizeSentences: true,
  fixTwoInitialCaps: true,
  autoLinks: true,
  autoLists: true,
  custom: {},
};

/** La clave de siempre: la lista de reemplazos es una sola para todos los productos (como el archivo .acl de Office). */
export const AUTOCORRECT_KEY = 'nova.writer.autocorrect';

export function loadAutoCorrectFrom(store: { getItem(k: string): string | null } | null): AutoCorrectOptions {
  try {
    const raw = store?.getItem(AUTOCORRECT_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<AutoCorrectOptions>;
      return { ...DEFAULT_AUTOCORRECT, ...v, custom: { ...(v.custom ?? {}) } };
    }
  } catch {
    /* sin almacenamiento o datos dañados: valores por omisión */
  }
  return { ...DEFAULT_AUTOCORRECT, custom: {} };
}

export function saveAutoCorrectTo(store: { setItem(k: string, v: string): void } | null, o: AutoCorrectOptions): void {
  try {
    store?.setItem(AUTOCORRECT_KEY, JSON.stringify(o));
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

/** Abreviaturas tras las que una palabra en minúscula no empieza oración. */
const ABBREVIATIONS = new Set(['etc', 'sr', 'sra', 'srta', 'dr', 'dra', 'pág', 'págs', 'ud', 'uds', 'aprox', 'núm', 'tel', 'av', 'pp', 'vol', 'cap', 'fig', 'ej', 'p.ej', 'ee', 'uu', 'vs', 'cf', 'ibid', 'mr', 'mrs', 'ms', 'no', 'e.g', 'i.e']);

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
}

/** ¿Empieza oración una palabra que va tras `before`? */
export function startsSentence(before: string): boolean {
  const t = before.replace(/[\s ]+$/, '');
  if (t === '' && before === '') return true;
  if (t === '') return true;
  const last = t.slice(-1);
  if (!/[.!?¡¿:]/.test(last) || last === ':') return false;
  if (last === '.') {
    const word = /([\p{L}.]+)\.$/u.exec(t)?.[1]?.toLowerCase();
    if (word && ABBREVIATIONS.has(word)) return false;
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
  const custom = o.custom[word];
  if (custom !== undefined) return { text: custom };
  if (o.symbols && SYMBOLS[word]) return { text: SYMBOLS[word]! };
  if (o.fractions && FRACTIONS[word]) return { text: FRACTIONS[word]! };
  if (o.dashes && word === '--') return { text: '–' };
  if (o.dashes && word === '---') return { text: '—' };
  if (o.autoLinks) {
    if (/^(https?:\/\/)[^\s]+\.[^\s]+$/i.test(word)) return { text: word, href: word };
    if (/^www\.[^\s]+\.[^\s]+$/i.test(word)) return { text: word, href: `http://${word}` };
    if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(word)) return { text: word, href: `mailto:${word}` };
  }
  if (/\d|@|\//.test(word) || /^(https?:|www\.)/i.test(word)) return null;
  const letters = [...word];
  // dos mayúsculas iniciales: «COrrecto» → «Correcto» (no «ID», ni «IDs», ni siglas largas)
  if (o.fixTwoInitialCaps && letters.length >= 4 && letters[0] === upper(letters[0]!) && isLetter(letters[0]!) && letters[1] === upper(letters[1]!) && isLetter(letters[1]!) && letters.slice(2).every((c) => c === lower(c) && isLetter(c))) {
    const fixed = letters[0]! + lower(letters[1]!) + letters.slice(2).join('');
    return { text: o.capitalizeSentences && startsSentence(before) ? upper(fixed[0]!) + fixed.slice(1) : fixed };
  }
  if (o.capitalizeSentences && isLetter(letters[0]!) && letters[0] === lower(letters[0]!) && startsSentence(before)) {
    return { text: upper(letters[0]!) + letters.slice(1).join('') };
  }
  return null;
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
  if (!fix || fix.text === word) return null;
  const text = before + fix.text + ch + tail;
  return out(text, before.length + fix.text.length + 1);
}
