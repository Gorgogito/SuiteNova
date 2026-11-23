import { findInText } from './search';
import type { Compiled, Match } from './types';

/**
 * What a match is replaced with, from the text typed in «Replace with».
 * - plain text and Word's wildcards: `^&` is what was found, `^p` `^t` `^l` `^m` `^s` are those characters, `^^` is a caret, `^` and a number the
 *   character with that code; with wildcards `\1`…`\9` are the groups and `\` takes the next character literally;
 * - Excel: the text as it is;
 * - regular expression: `$1`…`$9`, `$&` and `$$`, and `\n` and `\t`.
 */
export function expandReplacement(q: Compiled, m: Match, template: string): string {
  const mode = q.options.mode;
  if (mode === 'excel') return template;
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const ch = template[i]!;
    if (mode === 'regex') {
      if (ch === '$' && i + 1 < template.length) {
        const n = template[i + 1]!;
        if (n === '$') (out += '$'), i++;
        else if (n === '&') (out += m.text), i++;
        else if (/[1-9]/.test(n)) (out += m.groups[Number(n) - 1] ?? ''), i++;
        else out += ch;
      } else if (ch === '\\' && (template[i + 1] === 'n' || template[i + 1] === 't')) {
        out += template[++i] === 'n' ? '\n' : '\t';
      } else out += ch;
      continue;
    }
    if (ch === '^' && i + 1 < template.length) {
      const code = /^\^(\d{1,5})/.exec(template.slice(i));
      if (code) {
        out += String.fromCodePoint(Math.min(Number(code[1]), 0x10ffff));
        i += code[0].length - 1;
        continue;
      }
      const n = template[i + 1]!;
      const map: Record<string, string> = { '&': m.text, p: '\n', t: '\t', l: '\v', m: '\f', s: ' ', '~': '‑', '+': '—', '=': '–', '^': '^' };
      if (n in map) {
        out += map[n];
        i++;
        continue;
      }
    }
    if (mode === 'wildcards' && ch === '\\' && i + 1 < template.length) {
      const n = template[++i]!;
      out += /[1-9]/.test(n) ? (m.groups[Number(n) - 1] ?? '') : n;
      continue;
    }
    out += ch;
  }
  return out;
}

/** The replacement of every match in a text: the new text and how many were replaced. */
export function replaceAllInText(q: Compiled, text: string, template: string): { text: string; count: number } {
  const ms = findInText(q, text);
  if (!ms.length) return { text, count: 0 };
  let out = '';
  let at = 0;
  for (const m of ms) {
    out += text.slice(at, m.start) + expandReplacement(q, m, template);
    at = m.end;
  }
  return { text: out + text.slice(at), count: ms.length };
}
