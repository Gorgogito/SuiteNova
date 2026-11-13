/**
 * Autocorrección al escribir (como la de Word): comillas inteligentes, símbolos y fracciones, rayas, mayúscula inicial,
 * dos mayúsculas iniciales, vínculos automáticos y listas automáticas. La lógica es pura y se prueba sola; el plugin
 * de ProseMirror solo la aplica cuando se completa una palabra.
 */
import { InputRule, inputRules, wrappingInputRule } from 'prosemirror-inputrules';
import { closeHistory } from 'prosemirror-history';
import { Plugin, type EditorState, type Transaction } from 'prosemirror-state';
import { markTypes, nodeTypes } from '@suitenova/writer-core';

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

const KEY = 'nova.writer.autocorrect';

export function loadAutoCorrect(): AutoCorrectOptions {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_AUTOCORRECT, ...(JSON.parse(raw) as Partial<AutoCorrectOptions>) };
  } catch {
    /* sin almacenamiento: valores por omisión */
  }
  return { ...DEFAULT_AUTOCORRECT };
}

export function saveAutoCorrect(o: AutoCorrectOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
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

// ---------------------------------------------------------------------------------------------- plugin
/** Dónde empieza la palabra que acaba en `pos` dentro de su párrafo (sin espacios dentro). */
function wordBefore(state: EditorState, pos: number): { from: number; word: string; before: string } | null {
  const $p = state.doc.resolve(pos);
  if (!$p.parent.isTextblock) return null;
  const text = $p.parent.textBetween(0, $p.parentOffset, undefined, '\u0001');
  let i = text.length;
  while (i > 0 && !/[\s \u0001]/.test(text[i - 1]!)) i--;
  const word = text.slice(i);
  if (!word) return null;
  return { from: pos - word.length, word, before: text.slice(0, i).replace(/\u0001/g, ' ') };
}

/** Completa la palabra anterior al carácter escrito, o pone la comilla tipográfica. */
export function autoCorrectPlugin(getOptions: () => AutoCorrectOptions): Plugin {
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        const o = getOptions();
        const state = view.state;
        if (state.selection.$from.parent.type.spec.code) return false;
        const $from = state.doc.resolve(from);
        if (!$from.parent.isTextblock) return false;
        // comillas tipográficas
        if (o.smartQuotes && (text === '"' || text === "'")) {
          const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\u0001');
          const q = smartQuote(text, before.endsWith('\u0001') ? ' ' : before);
          view.dispatch(closeHistory(state.tr).insertText(q, from, to));
          return true;
        }
        // símbolos que se sustituyen en cuanto se escribe su última tecla: (c) (r) (tm) (e) ... --> <-- ==> <== <=>
        if (o.symbols && text.length === 1 && from === to) {
          const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '') + text;
          for (const key of IMMEDIATE) {
            if (before.endsWith(key)) {
              const start = from - (key.length - 1);
              const tr = closeHistory(state.tr);
              tr.replaceWith(start, from, state.schema.text(SYMBOLS[key]!, state.doc.resolve(from).marks()));
              view.dispatch(tr.scrollIntoView());
              return true;
            }
          }
        }
        // palabra completada por un espacio o un signo de puntuación
        if (text.length !== 1 || !/[\s.,;:!?)\]]/.test(text) || from !== to) return false;
        const w = wordBefore(state, from);
        if (!w) return false;
        // «a.» «i)» «B.» al empezar un párrafo son marcadores de lista, no una palabra que capitalizar
        if ((text === '.' || text === ')') && w.before.trim() === '' && /^([a-zA-Z]|[ivxlcdmIVXLCDM]{1,4}|\d+)$/.test(w.word)) return false;
        // un punto o una coma dentro de «...» / «3.5» no cierran palabra: solo espacios y signos tras letras o símbolos
        if (/[.,;:!?)\]]/.test(text) && /^[.,;:!?)\]\d]+$/.test(w.word)) return false;
        const fix = correctWord(w.word, w.before, o);
        if (!fix || (fix.text === w.word && !fix.href)) return false;
        const tr: Transaction = closeHistory(state.tr);
        const marks = state.doc.resolve(from).marks();
        const mapped = fix.href ? [...marks.filter((m) => m.type !== markTypes.link), markTypes.link!.create({ href: fix.href })] : marks;
        tr.replaceWith(w.from, from, state.schema.text(fix.text, mapped));
        tr.insertText(text, tr.mapping.map(from));
        // lo que se escribe después de un vínculo no hereda el vínculo
        if (fix.href) tr.removeStoredMark(markTypes.link!);
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    },
  });
}

/** Listas automáticas: «1. », «a. », «A. », «i. », «I. » y «- » al empezar un párrafo (con las opciones activadas). */
export function autoListRules(getOptions: () => AutoCorrectOptions): ReturnType<typeof inputRules> {
  type Inner = { match: RegExp; handler: (s: EditorState, m: RegExpMatchArray, a: number, b: number) => Transaction | null };
  const gate = (rule: InputRule) => {
    const r = rule as unknown as Inner;
    return new InputRule(r.match, (state, match, start, end) => (getOptions().autoLists ? r.handler(state, match, start, end) : null));
  };
  const ord = nodeTypes.ordered_list!;
  const letter = (re: RegExp, format: string) => gate(wrappingInputRule(re, ord, () => ({ start: 1, format })));
  return inputRules({
    rules: [
      gate(wrappingInputRule(/^\s*([-+*•])\s$/, nodeTypes.bullet_list!)),
      gate(wrappingInputRule(/^(\d+)[.)]\s$/, ord, (m) => ({ start: Number(m[1]), format: 'decimal' }), (m, node) => node.childCount + (node.attrs.start as number) === Number(m[1]))),
      letter(/^a[.)]\s$/, 'lowerLetter'),
      letter(/^A[.)]\s$/, 'upperLetter'),
      letter(/^i[.)]\s$/, 'lowerRoman'),
      letter(/^I[.)]\s$/, 'upperRoman'),
    ],
  });
}
