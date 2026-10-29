import { toNum } from '../coerce';
import { E, isErr, type CalcError, type Scalar, type Value } from '../values';
import { makeCriteria, type Predicate } from './criteria';
import { rawFn } from './registry';
import { scalarOf, toMatrix } from './util';

interface Selection {
  /** Values of the chosen field in the records that satisfy the criteria. */
  values: Scalar[];
}

const hasOperator = (s: string): boolean => /^(<=|>=|<>|=|<|>)/.test(s);

/** A database criterion: text without an operator matches anything that starts with it. */
function criterion(c: Scalar): Predicate | null {
  if (c === null || c === '') return null;
  if (typeof c === 'string' && !hasOperator(c) && Number.isNaN(Number(c))) {
    return makeCriteria(`${c.replace(/~/g, '~~')}*`);
  }
  return makeCriteria(c);
}

function select(args: Value[], ctx: Parameters<typeof scalarOf>[1]): Selection | CalcError {
  const db = toMatrix(args[0]!, ctx);
  const crit = toMatrix(args[2]!, ctx);
  if (db.length < 1 || crit.length < 1) return E.VALUE;
  const headers = db[0]!.map((h) => (typeof h === 'string' ? h.trim().toLowerCase() : h === null ? '' : String(h).toLowerCase()));
  const fieldArg = scalarOf(args[1]!, ctx);
  if (isErr(fieldArg)) return fieldArg;
  let col: number;
  if (typeof fieldArg === 'string') {
    col = headers.indexOf(fieldArg.trim().toLowerCase());
    if (col < 0) return E.VALUE;
  } else {
    const n = toNum(fieldArg);
    if (isErr(n)) return n;
    col = Math.trunc(n) - 1;
    if (col < 0 || col >= headers.length) return E.VALUE;
  }
  // each criteria row is a set of conditions that must all hold; the rows are alternatives
  const critHeaders = crit[0]!.map((h) => (typeof h === 'string' ? h.trim().toLowerCase() : h === null ? '' : String(h).toLowerCase()));
  const rowTests: { col: number; test: Predicate }[][] = [];
  for (const row of crit.slice(1)) {
    const conds: { col: number; test: Predicate }[] = [];
    let impossible = false;
    row.forEach((cell, j) => {
      const test = criterion(cell);
      if (!test) return;
      const dc = headers.indexOf(critHeaders[j]!);
      if (dc < 0) impossible = true;
      else conds.push({ col: dc, test });
    });
    if (!impossible) rowTests.push(conds);
  }
  const values: Scalar[] = [];
  for (const rec of db.slice(1)) {
    if (rec.every((c) => c === null)) continue;
    const ok = crit.length === 1 || rowTests.some((conds) => conds.every((c) => c.test(rec[c.col] ?? null)));
    if (ok) values.push(rec[col] ?? null);
  }
  return { values };
}

const numbers = (s: Selection): number[] => s.values.filter((v): v is number => typeof v === 'number');
const errorIn = (s: Selection): CalcError | null => s.values.find(isErr) ?? null;

function dfn(name: string, f: (s: Selection) => Value): void {
  rawFn(name, 3, 3, (args, ctx) => {
    const s = select(args, ctx);
    if (isErr(s)) return s;
    const e = errorIn(s);
    return e ?? f(s);
  });
}

const variance = (x: number[], sample: boolean): number | CalcError => {
  const n = x.length;
  if (n < (sample ? 2 : 1)) return E.DIV0;
  const m = x.reduce((a, b) => a + b, 0) / n;
  return x.reduce((a, b) => a + (b - m) ** 2, 0) / (sample ? n - 1 : n);
};

dfn('DSUM', (s) => numbers(s).reduce((a, b) => a + b, 0));
dfn('DAVERAGE', (s) => {
  const n = numbers(s);
  return n.length ? n.reduce((a, b) => a + b, 0) / n.length : E.DIV0;
});
dfn('DCOUNT', (s) => numbers(s).length);
dfn('DCOUNTA', (s) => s.values.filter((v) => v !== null && v !== '').length);
dfn('DMAX', (s) => {
  const n = numbers(s);
  return n.length ? Math.max(...n) : 0;
});
dfn('DMIN', (s) => {
  const n = numbers(s);
  return n.length ? Math.min(...n) : 0;
});
dfn('DPRODUCT', (s) => {
  const n = numbers(s);
  return n.length ? n.reduce((a, b) => a * b, 1) : 0;
});
dfn('DGET', (s) => {
  if (s.values.length === 0) return E.VALUE;
  if (s.values.length > 1) return E.NUM;
  return s.values[0] ?? null;
});
dfn('DVAR', (s) => variance(numbers(s), true));
dfn('DVARP', (s) => variance(numbers(s), false));
dfn('DSTDEV', (s) => {
  const v = variance(numbers(s), true);
  return typeof v === 'number' ? Math.sqrt(v) : v;
});
dfn('DSTDEVP', (s) => {
  const v = variance(numbers(s), false);
  return typeof v === 'number' ? Math.sqrt(v) : v;
});
