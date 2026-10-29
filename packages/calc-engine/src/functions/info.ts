import { toText } from '../coerce';
import { E, isErr, isRange, isRefs, type Value } from '../values';
import { rawFn, scalarFn, setMulti } from './registry';
import { scalarOf } from './util';

// HYPERLINK shows its friendly text (or the address); the link itself is made by the cell's hyperlink, not by the formula.
scalarFn('HYPERLINK', 1, 2, ([link, text]) => (text === undefined || text === null ? (link ?? '') : text), { handlesErrors: false });

rawFn('AREAS', 1, 1, (args) => {
  const a = args[0]!;
  if (isRefs(a)) return a.areas.length;
  return isRange(a) ? 1 : isErr(a) ? a : E.VALUE;
});

const singleCell = (v: Value) => (isRange(v) && v.r1 === v.r2 && v.c1 === v.c2 ? v : null);

rawFn('FORMULATEXT', 1, 1, (args, ctx) => {
  const c = singleCell(args[0]!);
  if (!c) return isErr(args[0]!) ? (args[0] as typeof E.NA) : E.NA;
  const t = ctx.host.formulaText?.(c.sheetId, c.r1, c.c1);
  return t === undefined ? E.NA : t;
});

rawFn('ISFORMULA', 1, 1, (args, ctx) => {
  const a = args[0]!;
  if (isErr(a)) return a;
  const c = singleCell(a);
  if (!c) return E.VALUE;
  return ctx.host.formulaText?.(c.sheetId, c.r1, c.c1) !== undefined;
});

rawFn('GETPIVOTDATA', 2, 255, (args, ctx) => {
  if (args.length % 2 !== 0) return E.REF;
  const field = toText(scalarOf(args[0]!, ctx));
  if (isErr(field)) return field;
  const ref = args[1]!;
  if (!isRange(ref)) return E.REF;
  const items: Record<string, string> = {};
  for (let i = 2; i < args.length; i += 2) {
    const name = toText(scalarOf(args[i]!, ctx));
    const item = toText(scalarOf(args[i + 1]!, ctx));
    if (isErr(name)) return name;
    if (isErr(item)) return item;
    items[name] = item;
  }
  const v = ctx.host.pivotLookup?.(ref.sheetId, ref.r1, ref.c1, field, items);
  return v === undefined ? E.REF : v;
});

// what several-area references (3D references, unions) mean to the functions that accept them
setMulti(
  'spread',
  'SUM', 'PRODUCT', 'MIN', 'MAX', 'AVERAGE', 'COUNT', 'COUNTA', 'SUMSQ', 'STDEV', 'STDEV.S', 'STDEV.P', 'STDEVP', 'VAR', 'VAR.S', 'VAR.P', 'VARP',
  'MEDIAN', 'MODE', 'MODE.SNGL', 'MODE.MULT', 'GCD', 'LCM', 'AND', 'OR', 'XOR', 'SUBTOTAL', 'AVERAGEA', 'MAXA', 'MINA', 'STDEVA', 'STDEVPA', 'VARA', 'VARPA',
  'GEOMEAN', 'HARMEAN', 'DEVSQ', 'AVEDEV', 'SKEW', 'SKEW.P', 'KURT', 'MULTINOMIAL', 'IMSUM', 'IMPRODUCT',
);
setMulti('flatten', 'LARGE', 'SMALL', 'RANK', 'RANK.EQ', 'PERCENTILE', 'PERCENTILE.INC', 'PERCENTILE.EXC', 'QUARTILE', 'QUARTILE.INC', 'PERCENTRANK', 'PERCENTRANK.INC', 'PERCENTRANK.EXC', 'TRIMMEAN');
setMulti('native', 'INDEX', 'AREAS', 'ISREF');
