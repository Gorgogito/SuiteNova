import { foldAccents } from './compile';
import type { Compiled, Match, Unit, UnitMatch } from './types';

/** Never more than this many matches: a pattern like `.` over a long book would not finish. */
export const MAX_MATCHES = 100_000;

/** Every match of the query in a text, in order. A match with no characters is not a match. */
export function findInText(q: Compiled, text: string): Match[] {
  const hay = q.fold ? foldAccents(text) : text;
  const re = new RegExp(q.regex.source, `${q.regex.flags}d`);
  const out: Match[] = [];
  for (let m = re.exec(hay); m && out.length < MAX_MATCHES; m = re.exec(hay)) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    const groups = (m.indices ?? []).slice(1).map((r) => (r ? text.slice(r[0], r[1]) : ''));
    out.push({ start: m.index, end: m.index + m[0].length, text: text.slice(m.index, m.index + m[0].length), groups });
  }
  return out;
}

/** Every match in a list of units, in the order of the units. */
export function findAll<I>(q: Compiled, units: Unit<I>[]): UnitMatch<I>[] {
  const out: UnitMatch<I>[] = [];
  for (let i = 0; i < units.length && out.length < MAX_MATCHES; i++) {
    for (const m of findInText(q, units[i]!.text)) out.push({ ...m, unit: units[i]!.id, index: i });
  }
  return out;
}

export interface Cursor {
  /** Index of the unit where the cursor is. */
  index: number;
  /** Offset in the text of that unit. */
  offset: number;
}

/**
 * The match to go to from the cursor, as an index into `matches` (ordered). Forward: the first one that starts at or after the cursor; backward:
 * the last one that ends before it. With `wrap` it goes round to the other end; without, and with nothing left, it is -1.
 */
export function nextIndex(matches: { index: number; start: number; end: number }[], cursor: Cursor, forward: boolean, wrap = true): number {
  if (!matches.length) return -1;
  if (forward) {
    const i = matches.findIndex((m) => m.index > cursor.index || (m.index === cursor.index && m.start >= cursor.offset));
    return i >= 0 ? i : wrap ? 0 : -1;
  }
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!;
    if (m.index < cursor.index || (m.index === cursor.index && m.end <= cursor.offset)) return i;
  }
  return wrap ? matches.length - 1 : -1;
}

/** The match that is «the current one» for a selection from `start` to `end` in a unit: the one that is exactly selected, or -1. */
export function indexOfSelection(matches: { index: number; start: number; end: number }[], index: number, start: number, end: number): number {
  return matches.findIndex((m) => m.index === index && m.start === start && m.end === end);
}

/** «3 de 12» as numbers: the position of the current match (1-based, 0 when there is none) and the total. */
export const counter = (current: number, total: number): { position: number; total: number } => ({ position: current >= 0 && current < total ? current + 1 : 0, total });
