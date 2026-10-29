import { applyLambda } from '../evaluator';
import { toNum } from '../coerce';
import { arr, E, isErr, isLambda, isRange, type LambdaVal, type Scalar, type Value } from '../values';
import { rawFn, type Ctx } from './registry';
import { scalarOf, toMatrixExact } from './util';

const MAX_CELLS = 1_000_000;

/** One value out of a lambda's result: a single cell, or #CALC! when it came back as an array. */
function single(v: Value, ctx: Ctx): Scalar {
  if (isRange(v) && v.r1 === v.r2 && v.c1 === v.c2) return scalarOf(v, ctx);
  if (typeof v === 'object' && v !== null && 'kind' in v) {
    if (v.kind === 'array' && v.rows.length === 1 && v.rows[0]!.length === 1) return v.rows[0]![0]!;
    return E.CALC;
  }
  return v;
}

const lastLambda = (args: Value[]): LambdaVal | null => {
  const f = args[args.length - 1]!;
  return isLambda(f) ? f : null;
};

rawFn(
  'MAP',
  2,
  254,
  (args, ctx) => {
    const fn = lastLambda(args);
    if (!fn) return E.VALUE;
    const mats = args.slice(0, -1).map((a) => toMatrixExact(a, ctx));
    const rows = mats[0]!.length;
    const cols = mats[0]![0]?.length ?? 0;
    if (mats.some((m) => m.length !== rows || (m[0]?.length ?? 0) !== cols)) return E.VALUE;
    if (rows * cols > MAX_CELLS) return E.NUM;
    const out: Scalar[][] = [];
    for (let i = 0; i < rows; i++) {
      const row: Scalar[] = [];
      for (let j = 0; j < cols; j++) row.push(single(applyLambda(fn, mats.map((m) => m[i]![j]!), ctx), ctx));
      out.push(row);
    }
    return arr(out);
  },
  { lambdas: true },
);

rawFn(
  'REDUCE',
  2,
  3,
  (args, ctx) => {
    const fn = lastLambda(args);
    if (!fn) return E.VALUE;
    const cells = toMatrixExact(args[args.length === 3 ? 1 : 0]!, ctx).flat();
    let acc: Value;
    let start = 0;
    if (args.length === 3) acc = args[0]!;
    else {
      if (!cells.length) return E.CALC;
      acc = cells[0]!;
      start = 1;
    }
    for (let i = start; i < cells.length; i++) {
      acc = applyLambda(fn, [acc, cells[i]!], ctx);
      if (isErr(acc)) return acc;
    }
    return acc;
  },
  { lambdas: true },
);

rawFn(
  'SCAN',
  2,
  3,
  (args, ctx) => {
    const fn = lastLambda(args);
    if (!fn) return E.VALUE;
    const m = toMatrixExact(args[args.length === 3 ? 1 : 0]!, ctx);
    let acc: Value | undefined = args.length === 3 ? args[0]! : undefined;
    const out: Scalar[][] = [];
    for (const row of m) {
      const r: Scalar[] = [];
      for (const cell of row) {
        acc = acc === undefined ? cell : applyLambda(fn, [acc, cell], ctx);
        const s = single(acc, ctx);
        r.push(s);
        acc = s;
      }
      out.push(r);
    }
    return arr(out);
  },
  { lambdas: true },
);

function byLine(name: string, byRow: boolean): void {
  rawFn(
    name,
    2,
    2,
    (args, ctx) => {
      const fn = lastLambda(args);
      if (!fn) return E.VALUE;
      const m = toMatrixExact(args[0]!, ctx);
      const results: Scalar[] = [];
      if (byRow) for (const row of m) results.push(single(applyLambda(fn, [arr([row])], ctx), ctx));
      else for (let j = 0; j < (m[0]?.length ?? 0); j++) results.push(single(applyLambda(fn, [arr(m.map((r) => [r[j]!]))], ctx), ctx));
      return byRow ? arr(results.map((r) => [r])) : arr([results]);
    },
    { lambdas: true },
  );
}
byLine('BYROW', true);
byLine('BYCOL', false);

rawFn(
  'MAKEARRAY',
  3,
  3,
  (args, ctx) => {
    const fn = lastLambda(args);
    if (!fn) return E.VALUE;
    const r = toNum(scalarOf(args[0]!, ctx));
    const c = toNum(scalarOf(args[1]!, ctx));
    if (isErr(r)) return r;
    if (isErr(c)) return c;
    const rows = Math.trunc(r);
    const cols = Math.trunc(c);
    if (rows < 1 || cols < 1) return E.VALUE;
    if (rows * cols > MAX_CELLS) return E.NUM;
    const out: Scalar[][] = [];
    for (let i = 1; i <= rows; i++) {
      const row: Scalar[] = [];
      for (let j = 1; j <= cols; j++) row.push(single(applyLambda(fn, [i, j], ctx), ctx));
      out.push(row);
    }
    return arr(out);
  },
  { lambdas: true },
);
