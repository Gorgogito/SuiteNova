import { DEFAULT_FIND, type CompileResult, type FindOptions } from './types';

/** Takes the accents off, letter by letter, so that the text keeps its length (and so the offsets of a match are the same in the original). */
export function foldAccents(s: string): string {
  let out = '';
  for (const ch of s) {
    const d = ch.normalize('NFD');
    out += d.length > 1 && /^\P{M}\p{M}+$/u.test(d) ? d[0] : ch;
  }
  return out;
}

const WORD = '\\p{L}\\p{N}\\p{M}_';
const WORD_START = `(?<![${WORD}])(?=[${WORD}])`;
const WORD_END = `(?<=[${WORD}])(?![${WORD}])`;
const escapeRe = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/** What `^x` stands for in the text typed in the dialog (Word's special characters). Returns the pattern, or null when `x` is not one. */
function special(code: string, wildcards: boolean): string | null {
  switch (code) {
    case 'p':
      return '\\n';
    case 't':
      return '\\t';
    case 'l':
      return '\\v';
    case 'm':
      return '\\f';
    case 's':
      return '\\u00a0';
    case '~':
      return '\\u2011';
    case '+':
      return '\\u2014';
    case '=':
      return '\\u2013';
    case '^':
      return '\\^';
    case '#':
      return '\\d';
    case '$':
      return '\\p{L}';
    case 'w':
      return '[ \\t\\u00a0]+';
    case '?':
      return wildcards ? null : '[^\\n]';
    default:
      return null;
  }
}

/** Word: `^` and a number is the character with that code. Returns the pattern and how many characters were read. */
function charCode(src: string, at: number): { re: string; len: number } | null {
  const m = /^\^(\d{1,5})/.exec(src.slice(at));
  if (!m) return null;
  const n = Number(m[1]);
  if (!n || n > 0x10ffff) return null;
  return { re: `\\u{${n.toString(16)}}`, len: m[0].length };
}

function plainPattern(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '^' && i + 1 < src.length) {
      const c = charCode(src, i);
      if (c) {
        out += c.re;
        i += c.len - 1;
        continue;
      }
      const sp = special(src[i + 1]!, false);
      if (sp) {
        out += sp;
        i++;
        continue;
      }
    }
    out += escapeRe(ch);
  }
  return out;
}

/** Word's wildcards. The quantifier or group syntax that Word does not have is escaped, so it is read as plain text. */
function wildcardPattern(src: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '\\' && i + 1 < src.length) {
      out += escapeRe(src[++i]!);
    } else if (ch === '^' && i + 1 < src.length) {
      const c = charCode(src, i);
      if (c) {
        out += c.re;
        i += c.len - 1;
        continue;
      }
      const sp = special(src[i + 1]!, true);
      if (sp) {
        out += sp;
        i++;
      } else out += '\\^';
    } else if (ch === '?') out += '[^\\n]';
    else if (ch === '*') out += '[^\\n]*?';
    else if (ch === '<') out += WORD_START;
    else if (ch === '>') out += WORD_END;
    // Word's «@» takes the fewest it can after a character or a set, and all it can after a group (found with the real Word)
    else if (ch === '@') out += out.endsWith(')') ? '+' : '+?';
    else if (ch === '(') {
      depth++;
      out += '(';
    } else if (ch === ')') {
      if (depth === 0) throw new Error('unbalanced parenthesis');
      depth--;
      out += ')';
    } else if (ch === '{') {
      // the separator is the list separator of the system in Word (a semicolon in Spanish): both are read
      const m = /^\{(\d+)([,;](\d*))?\}/.exec(src.slice(i));
      if (!m) throw new Error('bad repetition');
      out += m[0].replace(';', ',');
      i += m[0].length - 1;
    } else if (ch === '[') {
      const end = src.indexOf(']', i + 2);
      if (end < 0) throw new Error('unclosed bracket');
      let set = src.slice(i + 1, end);
      const neg = set.startsWith('!');
      if (neg) set = set.slice(1);
      out += `[${neg ? '^' : ''}${set.replace(/[\\^\]]/g, '\\$&')}]`;
      i = end;
    } else out += escapeRe(ch);
  }
  if (depth !== 0) throw new Error('unbalanced parenthesis');
  return out;
}

function excelPattern(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '~' && i + 1 < src.length) out += escapeRe(src[++i]!);
    else if (ch === '?') out += '[\\s\\S]';
    else if (ch === '*') out += '[\\s\\S]*';
    else out += escapeRe(ch);
  }
  return out;
}

/** Turns what the person typed and the options into a regular expression. */
export function compileQuery(text: string, options: Partial<FindOptions> = {}): CompileResult {
  const o: FindOptions = { ...DEFAULT_FIND, ...options };
  if (text === '') return { ok: false, error: 'empty', message: 'Nothing to find' };
  const src = o.ignoreAccents ? foldAccents(text) : text;
  try {
    let body: string;
    switch (o.mode) {
      case 'wildcards':
        body = wildcardPattern(src);
        break;
      case 'excel':
        body = excelPattern(src);
        break;
      case 'regex':
        body = src;
        break;
      default:
        body = plainPattern(src);
    }
    if (o.wholeUnit) body = `^(?:${body})$`;
    else if (o.wholeWord && o.mode !== 'wildcards' && o.mode !== 'excel') body = `(?<![${WORD}])(?:${body})(?![${WORD}])`;
    const flags = `gu${o.matchCase ? '' : 'i'}${o.wholeUnit ? 's' : ''}`;
    return { ok: true, query: { regex: new RegExp(body, flags), options: o, fold: o.ignoreAccents } };
  } catch (e) {
    return { ok: false, error: 'invalid', message: e instanceof Error ? e.message : String(e) };
  }
}
