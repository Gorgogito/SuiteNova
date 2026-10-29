/** Nova Basic: a subset of VBA. This file turns source text into tokens. */

export class BasicSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly col = 0,
  ) {
    super(message);
    this.name = 'BasicSyntaxError';
  }
}

export type TokKind = 'num' | 'str' | 'date' | 'id' | 'kw' | 'op' | 'eol' | 'eof';

export interface Token {
  kind: TokKind;
  /** The text; for keywords, lower case. */
  text: string;
  line: number;
  col: number;
  /** Numbers: the value. */
  num?: number;
  /** Dates: the value. */
  date?: Date;
}

/** Reserved words (lower case). A name that is not reserved is an identifier. */
export const KEYWORDS = new Set([
  'and', 'as', 'byref', 'byval', 'call', 'case', 'const', 'dim', 'do', 'each', 'else', 'elseif', 'empty', 'end', 'eqv', 'erase', 'exit', 'false', 'for', 'function',
  'goto', 'if', 'imp', 'in', 'is', 'let', 'like', 'loop', 'mod', 'new', 'next', 'nothing', 'not', 'null', 'on', 'option', 'optional', 'or', 'paramarray',
  'preserve', 'private', 'public', 'redim', 'resume', 'select', 'set', 'static', 'step', 'sub', 'then', 'to', 'true', 'until', 'wend', 'while', 'with', 'xor', 'error',
]);

const isLetter = (c: string) => /[\p{L}_]/u.test(c);
const isIdent = (c: string) => /[\p{L}\p{N}_]/u.test(c);

/** `#1/31/2024#` (month first) and `#2024-01-31#` / `#2024-01-31 10:30#`. */
function parseDateLiteral(s: string): Date | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  let d: Date;
  if (iso) d = new Date(+iso[1]!, +iso[2]! - 1, +iso[3]!, +(iso[4] ?? 0), +(iso[5] ?? 0), +(iso[6] ?? 0));
  else if (us) d = new Date(+us[3]!, +us[1]! - 1, +us[2]!, +(us[4] ?? 0), +(us[5] ?? 0), +(us[6] ?? 0));
  else if (time) d = new Date(1899, 11, 30, +time[1]!, +time[2]!, +(time[3] ?? 0));
  else return null;
  if (Number.isNaN(d.getTime())) return null;
  // 31/31/2024 or 2024-02-30 are not dates: the parts must survive the round trip
  const m = iso ? [+iso[2]!, +iso[3]!] : us ? [+us[1]!, +us[2]!] : null;
  if (m && (d.getMonth() + 1 !== m[0] || d.getDate() !== m[1])) return null;
  return d;
}

/** Split source text into tokens. A statement ends at an `eol` token (a line end or a `:`). Lines ending in ` _` continue. */
export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const text = src.replace(/\r\n?/g, '\n');
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const push = (t: Omit<Token, 'line' | 'col'>, at: number) => out.push({ ...t, line, col: at - lineStart + 1 });
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\n') {
      push({ kind: 'eol', text: '\n' }, i);
      i++;
      line++;
      lineStart = i;
    } else if (ch === ' ' || ch === '\t' || ch === ' ') {
      // a line continuation: space, underscore, end of line
      if (ch === ' ' && text[i + 1] === '_' && /^[ \t]*(\n|$)/.test(text.slice(i + 2))) {
        const nl = text.indexOf('\n', i + 2);
        if (nl < 0) break;
        i = nl + 1;
        line++;
        lineStart = i;
      } else i++;
    } else if (ch === "'") {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '"') {
      let j = i + 1;
      let s = '';
      for (;;) {
        if (j >= text.length || text[j] === '\n') throw new BasicSyntaxError('Falta cerrar las comillas del texto.', line, i - lineStart + 1);
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += text[j++];
      }
      push({ kind: 'str', text: s }, i);
      i = j + 1;
    } else if (ch === '#') {
      const end = text.indexOf('#', i + 1);
      const nl = text.indexOf('\n', i);
      if (end < 0 || (nl >= 0 && nl < end)) throw new BasicSyntaxError('Fecha sin cerrar: falta el segundo #.', line, i - lineStart + 1);
      const d = parseDateLiteral(text.slice(i + 1, end).trim());
      if (!d) throw new BasicSyntaxError(`Fecha no válida: ${text.slice(i, end + 1)}`, line, i - lineStart + 1);
      push({ kind: 'date', text: text.slice(i, end + 1), date: d }, i);
      i = end + 1;
    } else if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
      let j = i;
      while (j < text.length && /[0-9]/.test(text[j]!)) j++;
      if (text[j] === '.' && /[0-9]/.test(text[j + 1] ?? '')) {
        j++;
        while (j < text.length && /[0-9]/.test(text[j]!)) j++;
      } else if (text[j] === '.' && !isLetter(text[j + 1] ?? '')) j++;
      if (/[eE]/.test(text[j] ?? '') && /[-+0-9]/.test(text[j + 1] ?? '')) {
        j += 2;
        while (j < text.length && /[0-9]/.test(text[j]!)) j++;
      }
      const num = Number(text.slice(i, j));
      // type suffixes (10#, 5!, 3%) are accepted and ignored
      let end = j;
      if (/[#!%]/.test(text[end] ?? '')) end++;
      push({ kind: 'num', text: text.slice(i, j), num }, i);
      i = end;
    } else if (ch === '&' && /[hH]/.test(text[i + 1] ?? '') && /[0-9a-fA-F]/.test(text[i + 2] ?? '')) {
      let j = i + 2;
      while (j < text.length && /[0-9a-fA-F]/.test(text[j]!)) j++;
      push({ kind: 'num', text: text.slice(i, j), num: parseInt(text.slice(i + 2, j), 16) }, i);
      i = j;
      if (text[i] === '&') i++;
    } else if (isLetter(ch)) {
      let j = i;
      while (j < text.length && isIdent(text[j]!)) j++;
      if (text[j] === '$') j++; // Left$, Mid$…
      const word = text.slice(i, j);
      const low = word.toLowerCase();
      if (low === 'rem' && /^[ \t]*$/.test(text.slice(lineStart, i))) {
        while (i < text.length && text[i] !== '\n') i++;
        continue;
      }
      push(KEYWORDS.has(low) ? { kind: 'kw', text: low } : { kind: 'id', text: word }, i);
      i = j;
    } else {
      const two = text.slice(i, i + 2);
      if (two === '<>' || two === '<=' || two === '>=' || two === ':=') {
        push({ kind: 'op', text: two }, i);
        i += 2;
      } else if (ch === ':') {
        push({ kind: 'eol', text: ':' }, i);
        i++;
      } else if ('+-*/\\^&=<>(),.!;?'.includes(ch)) {
        push({ kind: 'op', text: ch }, i);
        i++;
      } else throw new BasicSyntaxError(`Carácter no válido: "${ch}".`, line, i - lineStart + 1);
    }
  }
  push({ kind: 'eol', text: '\n' }, i);
  push({ kind: 'eof', text: '' }, i);
  return out;
}
