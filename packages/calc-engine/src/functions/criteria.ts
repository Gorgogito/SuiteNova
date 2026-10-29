import { textToNumber } from '../coerce';
import { isErr, type Scalar } from '../values';

export type Predicate = (v: Scalar) => boolean;

function wildcardRegex(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '~' && i + 1 < pattern.length && '*?~'.includes(pattern[i + 1]!)) {
      re += '\\' + pattern[++i];
    } else if (ch === '*') re += '[\\s\\S]*';
    else if (ch === '?') re += '[\\s\\S]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

const hasWildcard = (s: string) => /(?<!~)[*?]/.test(s);

/** Build a predicate for COUNTIF/SUMIF-style criteria ("&gt;5", "a*", 3, "<>x" …). */
export function makeCriteria(criteria: Scalar): Predicate {
  if (typeof criteria === 'number') return (v) => (typeof v === 'number' ? v === criteria : typeof v === 'string' && textToNumber(v) === criteria);
  if (typeof criteria === 'boolean') return (v) => v === criteria;
  if (criteria === null) return (v) => v === 0; // an empty criteria cell behaves like 0
  if (isErr(criteria)) return (v) => isErr(v) && v === criteria;

  const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(criteria)!;
  const op = m[1] ?? '=';
  const operand = m[2]!;
  const numeric = operand.trim() === '' ? null : textToNumber(operand);

  if (operand === '') {
    if (op === '=') return (v) => v === null || v === '';
    if (op === '<>') return (v) => v !== null && v !== '';
  }

  const cmp = (c: number): boolean => {
    switch (op) {
      case '<':
        return c < 0;
      case '>':
        return c > 0;
      case '<=':
        return c <= 0;
      case '>=':
        return c >= 0;
      case '<>':
        return c !== 0;
      default:
        return c === 0;
    }
  };

  if (numeric !== null) {
    const n = numeric;
    switch (op) {
      case '>':
        return (v) => typeof v === 'number' && v > n;
      case '<':
        return (v) => typeof v === 'number' && v < n;
      case '>=':
        return (v) => typeof v === 'number' && v >= n;
      case '<=':
        return (v) => typeof v === 'number' && v <= n;
      case '<>':
        return (v) => !(typeof v === 'number' ? v === n : typeof v === 'string' && textToNumber(v) === n) && !isErr(v);
      default:
        return (v) => (typeof v === 'number' ? v === n : typeof v === 'string' && textToNumber(v) === n);
    }
  }

  const upper = operand.toUpperCase();
  const matchText = hasWildcard(operand) && (op === '=' || op === '<>') ? wildcardRegex(operand) : null;
  return (v) => {
    if (isErr(v)) return false;
    if (v === null) return op === '<>';
    const s = typeof v === 'string' ? v : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
    if (matchText) {
      const hit = matchText.test(s);
      return op === '=' ? hit : !hit;
    }
    if (typeof v !== 'string' && op !== '<>') return false;
    const a = s.toUpperCase();
    return cmp(a < upper ? -1 : a > upper ? 1 : 0);
  };
}
