import { findWords } from '../words';
import { capitalize, looksTechnical, tokenAt, type GrammarIssue, type Rule } from './types';

/** Abreviaturas tras las que un punto no termina la frase (en minúsculas, sin el punto). */
const ABBREVIATIONS = new Set(
  [
    // español
    'sr', 'sra', 'srta', 'sres', 'dr', 'dra', 'ud', 'uds', 'vd', 'vds', 'pág', 'págs', 'pag', 'art', 'arts', 'cap', 'núm', 'num', 'tel', 'av', 'avda', 'etc', 'ej', 'aprox', 'dpto', 'depto', 'vol', 'fig', 'figs', 'ed', 'eds', 'cía', 'cia', 'admón', 'gral', 'lic', 'ing', 'prof', 'profa', 'atte', 'cf', 'cfr', 'ibíd', 'op', 'cit', 'máx', 'mín', 'esq', 'pza', 'ud', 'pdte', 'apdo', 'pte', 'sta', 'sto', 'san',
    // inglés
    'mr', 'mrs', 'ms', 'vs', 'inc', 'ltd', 'co', 'st', 'no', 'jr', 'sr', 'mt', 'ft', 'approx', 'dept', 'est', 'ave', 'blvd', 'e.g', 'i.e',
  ],
);

/** La palabra (con o sin puntos intermedios, como «p.ej») que termina justo antes de `idx`. */
function wordBefore(text: string, idx: number): string {
  let a = idx;
  while (a > 0 && /[\p{L}\p{M}.]/u.test(text[a - 1]!)) a--;
  return text.slice(a, idx);
}

/** Si el punto de la posición `idx` es de una abreviatura, una inicial o un número y no termina una frase. */
export function isAbbreviationDot(text: string, idx: number): boolean {
  const before = wordBefore(text, idx);
  if (!before) return /\d/.test(text[idx - 1] ?? '');
  const lower = before.toLowerCase().replace(/^\.+/, '');
  if (ABBREVIATIONS.has(lower)) return true;
  if (lower.length <= 1) return true; // inicial: «J. Pérez»
  if (lower.includes('.')) return true; // «p.ej.», «S.A.»
  return /\d/.test(text[idx - 1] ?? '');
}

const push = (out: GrammarIssue[], i: GrammarIssue) => void out.push(i);

// ---------------------------------------------------------------------------------------------------- palabras repetidas

const REPEAT_OK: Record<'es' | 'en', Set<string>> = {
  es: new Set(['ja', 'je', 'ji', 'jo', 'ju', 'ha', 'bla', 'no', 'sí', 'muy', 'tan', 'tic', 'tac', 'ñam', 'cuac', 'chas', 'pum', 'pa', 'ay', 'oh', 'ah', 'uh', 'eh', 'ni', 'bye', 'yo']),
  en: new Set(['had', 'that', 'ha', 'bye', 'no', 'very', 'so', 'knock', 'bla', 'yeah', 'oh', 'ah', 'is', 'do', 'can', 'tick', 'tock']),
};

export const repeatedWord: Rule = ({ text, family }, out) => {
  const words = findWords(text);
  let last: GrammarIssue | null = null;
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1]!;
    const b = words[i]!;
    if (!/^[ \t ]+$/.test(text.slice(a.end, b.start))) continue;
    if (a.word.length < 2 || a.word.toLowerCase() !== b.word.toLowerCase()) continue;
    if (REPEAT_OK[family].has(a.word.toLowerCase())) continue;
    if (last && last.end === a.end) {
      last.end = b.end;
      continue;
    }
    last = { rule: 'repeated-word', category: 'grammar', start: a.start, end: b.end, message: `Palabra repetida: «${a.word}».`, fixes: [{ start: a.start, end: b.end, text: a.word, label: a.word }] };
    push(out, last);
  }
};

// ---------------------------------------------------------------------------------------------------- mayúscula inicial

const OPENERS = '¿¡"\'“‘«(\\[—–-';
const SENTENCE_END = new RegExp(`([.!?…]+)(["'”’»)\\]]*)(\\s+)([${OPENERS}]*)(\\p{Ll})`, 'gu');
const START = new RegExp(`^(\\s*[${OPENERS}]*)(\\p{Ll})`, 'u');

/** Si la palabra que empieza en `i` se escribe a propósito en minúscula (marcas, direcciones, identificadores). */
function lowerOnPurpose(text: string, i: number): boolean {
  const run = /^\S+/.exec(text.slice(i))?.[0] ?? '';
  if (/[@/\\]|\d|^www\.|^https?:/i.test(run)) return true;
  if (/\p{Ll}\p{Lu}/u.test(run.replace(/[^\p{L}]+.*$/u, ''))) return true; // eBay, iPhone
  return false;
}

export const capitalAfterPeriod: Rule = ({ text, startOfText }, out) => {
  const flag = (idx: number, message: string) => {
    const ch = text[idx]!;
    push(out, { rule: 'capital-after-period', category: 'grammar', start: idx, end: idx + 1, message, fixes: [{ start: idx, end: idx + 1, text: ch.toUpperCase(), label: capitalize(/^\p{L}+/u.exec(text.slice(idx))?.[0] ?? ch) }] });
  };
  if (startOfText) {
    const m = START.exec(text);
    if (m) {
      const idx = m[1]!.length;
      const after = text[idx + 1] ?? '';
      const marker = /^[\p{L}\p{N}]$/u.test(text[idx]!) && /^[).]/.test(after) && !/\p{L}/u.test(after);
      if (!marker && !lowerOnPurpose(text, idx)) flag(idx, 'Se escribe con mayúscula al comenzar el texto.');
    }
  }
  for (const m of text.matchAll(SENTENCE_END)) {
    const term = m[1]!;
    if (/^(\.\.+|…+)$/.test(term)) continue; // los puntos suspensivos admiten minúscula
    const dot = m.index! + term.length - 1;
    if (term === '.' && isAbbreviationDot(text, dot)) continue;
    const idx = m.index! + m[0].length - 1;
    if (lowerOnPurpose(text, idx)) continue;
    flag(idx, 'Se escribe con mayúscula al comenzar una frase.');
  }
};

// ---------------------------------------------------------------------------------------------------- espacios

export const doubleSpace: Rule = ({ text }, out) => {
  for (const m of text.matchAll(/(?<=\S) {2,}(?=\S)/g)) {
    push(out, { rule: 'double-space', category: 'punctuation', start: m.index!, end: m.index! + m[0].length, message: 'Hay más de un espacio seguido.', fixes: [{ start: m.index!, end: m.index! + m[0].length, text: ' ', label: 'Un solo espacio' }] });
  }
};

export const spaceBeforePunctuation: Rule = ({ text }, out) => {
  for (const m of text.matchAll(/(?<=[\p{L}\p{N})\]"”»]) +(?=[,;:.!?](?:\s|$))/gu)) {
    const p = text[m.index! + m[0].length]!;
    if (looksTechnical(tokenAt(text, m.index! + m[0].length))) continue;
    push(out, { rule: 'space-before-punctuation', category: 'punctuation', start: m.index!, end: m.index! + m[0].length, message: `Sobra un espacio antes de «${p}».`, fixes: [{ start: m.index!, end: m.index! + m[0].length, text: '', label: 'Quitar el espacio' }] });
  }
};

export const spaceInsideBrackets: Rule = ({ text }, out) => {
  const re = /(?<=[(¿¡\[]) +(?=\S)|(?<=\S) +(?=[)\]])/gu;
  for (const m of text.matchAll(re)) {
    const before = text[m.index! - 1] ?? '';
    // « :)» y « ;)» son caritas, no un paréntesis con espacio
    if (/^[:;]$/.test(before)) continue;
    push(out, { rule: 'space-inside-brackets', category: 'punctuation', start: m.index!, end: m.index! + m[0].length, message: 'Sobra un espacio junto al signo.', fixes: [{ start: m.index!, end: m.index! + m[0].length, text: '', label: 'Quitar el espacio' }] });
  }
};

export const missingSpaceAfter: Rule = ({ text }, out) => {
  const add = (idx: number, p: string) =>
    push(out, { rule: 'missing-space-after', category: 'punctuation', start: idx, end: idx + 1, message: `Falta un espacio después de «${p}».`, fixes: [{ start: idx, end: idx + 1, text: `${p} `, label: `${p} ` }] });
  for (const t of text.matchAll(/\S+/g)) {
    if (looksTechnical(t[0])) continue;
    const base = t.index!;
    for (const m of t[0].matchAll(/(?<=\p{L})([,;:?!])(?=\p{L})/gu)) add(base + m.index!, m[1]!);
    // «casa.Luego»: una palabra en minúscula, el punto y otra con mayúscula
    for (const m of t[0].matchAll(/(?<![\p{L}\p{N}.])\p{Ll}{2,}(\.)(?=\p{Lu}\p{Ll})/gu)) add(base + m.index! + m[0].length - 1, '.');
  }
};

// ---------------------------------------------------------------------------------------------------- signos con pareja

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '«': '»', '“': '”' };
const CLOSERS = new Set(Object.values(PAIRS));

export const unmatchedPair: Rule = ({ text, family }, out) => {
  const stack: { ch: string; idx: number }[] = [];
  const flag = (idx: number, message: string, fixes: GrammarIssue['fixes'] = []) => push(out, { rule: 'unmatched-pair', category: 'punctuation', start: idx, end: idx + 1, message, fixes });
  const sentenceStart = (idx: number): number => {
    let i = idx;
    while (i > 0 && !/[.!?¡¿\n]/.test(text[i - 1]!)) i--;
    while (i < idx && /\s/.test(text[i]!)) i++;
    return i;
  };
  const open: { ch: '¿' | '¡'; idx: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (PAIRS[c]) stack.push({ ch: c, idx: i });
    else if (CLOSERS.has(c)) {
      const top = stack[stack.length - 1];
      if (top && PAIRS[top.ch] === c) stack.pop();
      else {
        // «a)», «1)» y las caritas no son paréntesis sin pareja
        const before = text.slice(Math.max(0, i - 4), i);
        if (c === ')' && (/(^|\s)(\p{L}|\d{1,2})$/u.test(before) || /[:;8]$/.test(before))) continue;
        if (looksTechnical(tokenAt(text, i))) continue;
        flag(i, `Falta el signo de apertura de «${c}».`);
      }
    } else if (family === 'es') {
      if (c === '¿' || c === '¡') open.push({ ch: c, idx: i });
      else if ((c === '?' || c === '!') && !looksTechnical(tokenAt(text, i))) {
        const want = c === '?' ? '¿' : '¡';
        const k = open.map((o) => o.ch).lastIndexOf(want);
        if (k >= 0) open.splice(k, 1);
        else {
          const s = sentenceStart(i);
          flag(i, `Falta el signo de apertura ${want}.`, [{ start: s, end: s, text: want, label: `Poner ${want} al principio` }]);
        }
      } else if (c === '\n') {
        for (const o of open.splice(0)) flag(o.idx, `Falta el signo de cierre ${o.ch === '¿' ? '?' : '!'}.`);
      }
    }
  }
  for (const o of open) {
    const end = text.replace(/\s+$/, '').length;
    flag(o.idx, `Falta el signo de cierre ${o.ch === '¿' ? '?' : '!'}.`, [{ start: end, end, text: o.ch === '¿' ? '?' : '!', label: `Poner ${o.ch === '¿' ? '?' : '!'} al final` }]);
  }
  for (const s of stack) flag(s.idx, `Falta cerrar «${s.ch}» con «${PAIRS[s.ch]}».`);
};

// ---------------------------------------------------------------------------------------------------- estilo

export const longSentence: Rule = ({ text, longSentenceWords }, out) => {
  let from = 0;
  const re = /[.!?…]+(?:\s+|$)|\n+/g;
  const check = (to: number) => {
    const part = text.slice(from, to);
    const n = findWords(part).length;
    if (n > longSentenceWords) {
      const lead = part.length - part.trimStart().length;
      push(out, { rule: 'long-sentence', category: 'style', start: from + lead, end: to, message: `Frase muy larga (${n} palabras): conviene dividirla.`, fixes: [] });
    }
  };
  for (const m of text.matchAll(re)) {
    if (m[0].startsWith('.') && m[0].length > 0 && isAbbreviationDot(text, m.index!)) continue;
    check(m.index!);
    from = m.index! + m[0].length;
  }
  check(text.length);
};

export const allCaps: Rule = ({ text }, out) => {
  const words = findWords(text);
  let run: typeof words = [];
  const done = () => {
    if (run.length >= 4) push(out, { rule: 'all-caps', category: 'style', start: run[0]!.start, end: run[run.length - 1]!.end, message: 'Varias palabras seguidas en mayúsculas: dificultan la lectura.', fixes: [] });
    run = [];
  };
  for (const w of words) {
    const prev = run[run.length - 1];
    const upper = w.word.length >= 2 && w.word === w.word.toUpperCase() && w.word !== w.word.toLowerCase();
    if (upper && (!prev || /^[ \t]+$/.test(text.slice(prev.end, w.start)))) run.push(w);
    else {
      done();
      if (upper) run.push(w);
    }
  }
  done();
};
