import { MAX_COLS } from '../addr';
import { toNum } from '../coerce';
import { arr, arrDims, E, isArray, isErr, isLambda, isRange, isRefs, type ArrayVal, type CalcError, type Scalar, type Value } from '../values';
import type { Ctx } from './registry';

/** Reduce any value to one scalar (top-left cell for multi-cell values). */
export function scalarOf(v: Value, ctx: Ctx): Scalar {
  if (isRange(v)) return ctx.host.cellValue(v.sheetId, v.r1, v.c1);
  if (isArray(v)) return v.rows[0]?.[0] ?? null;
  if (isRefs(v)) return E.VALUE;
  if (isLambda(v)) return E.CALC;
  return v;
}

/** Dense 2D matrix of a value; ranges are clipped to the used area. */
export function toMatrix(v: Value, ctx: Ctx): Scalar[][] {
  if (isArray(v)) return v.rows;
  if (isRange(v)) {
    const c = ctx.host.clip(v);
    const rows: Scalar[][] = [];
    for (let r = c.r1; r <= c.r2; r++) {
      const row: Scalar[] = [];
      for (let col = c.c1; col <= c.c2; col++) row.push(ctx.host.cellValue(c.sheetId, r, col));
      rows.push(row);
    }
    // An empty clipped area still has the shape of the original small range.
    return rows;
  }
  if (isRefs(v)) return [[E.VALUE]];
  if (isLambda(v)) return [[E.CALC]];
  return [[v]];
}

/** Matrix preserving the original (unclipped) shape — for lookups/INDEX where position matters. */
export function toMatrixExact(v: Value, ctx: Ctx): Scalar[][] {
  if (isRange(v)) {
    const rows: Scalar[][] = [];
    const c = ctx.host.clip(v);
    for (let r = v.r1; r <= v.r2; r++) {
      const row: Scalar[] = [];
      for (let col = v.c1; col <= v.c2; col++) {
        row.push(r > c.r2 || col > c.c2 || r < c.r1 || col < c.c1 ? null : ctx.host.cellValue(v.sheetId, r, col));
      }
      rows.push(row);
    }
    return rows;
  }
  return toMatrix(v, ctx);
}

export function flatten(v: Value, ctx: Ctx): Scalar[] {
  return toMatrix(v, ctx).flat();
}

export function dimsOf(v: Value, ctx: Ctx): { rows: number; cols: number } {
  if (isRange(v)) return { rows: v.r2 - v.r1 + 1, cols: v.c2 - v.c1 + 1 };
  if (isArray(v)) return arrDims(v);
  void ctx;
  return { rows: 1, cols: 1 };
}

export interface NumCollector {
  nums: number[];
  error: CalcError | null;
  /** Count of every non-empty item seen (for COUNTA-like needs). */
  seen: number;
}

/**
 * Collect numbers the way SUM/AVERAGE/MIN/MAX do: in ranges and arrays only numeric cells count
 * (text/bools/empties ignored); direct scalar arguments are coerced (TRUE=1, "3"=3, bad text = #VALUE!).
 */
export function collectNumbers(args: Value[], ctx: Ctx): NumCollector {
  const out: NumCollector = { nums: [], error: null, seen: 0 };
  for (const a of args) {
    if (isRange(a)) {
      ctx.host.forEachCell(a, (_r, _c, v) => {
        if (isErr(v)) out.error ??= v;
        else if (typeof v === 'number') out.nums.push(v);
        if (v !== null) out.seen++;
      });
    } else if (isArray(a)) {
      for (const row of a.rows)
        for (const v of row) {
          if (isErr(v)) out.error ??= v;
          else if (typeof v === 'number') out.nums.push(v);
          if (v !== null) out.seen++;
        }
    } else if (isErr(a)) {
      out.error ??= a;
    } else if (isRefs(a) || isLambda(a)) {
      out.error ??= scalarOf(a, ctx) as CalcError;
    } else if (a !== null) {
      const n = toNum(a);
      if (isErr(n)) out.error ??= n;
      else out.nums.push(n);
      out.seen++;
    }
  }
  return out;
}

export const numOrErr = (v: Scalar): number | CalcError => toNum(v);

export function matrixToValue(rows: Scalar[][]): Value {
  if (rows.length === 1 && rows[0]!.length === 1) return rows[0]![0]!;
  return arr(rows);
}

export function errorOf(...vals: Scalar[]): CalcError | null {
  for (const v of vals) if (isErr(v)) return v;
  return null;
}

export function ensureArray(v: Value, ctx: Ctx): ArrayVal {
  return isArray(v) ? v : arr(toMatrix(v, ctx));
}

export { E };

// ---- lazy grids (no materialisation) -------------------------------------------------------------
export interface Grid {
  rows: number;
  cols: number;
  get(i: number, j: number): Scalar;
}

export interface Seq {
  length: number;
  at(i: number): Scalar;
}

/** Read-only view over a range/array/scalar. `clip` shrinks ranges to the sheet's used area. */
export function toGrid(v: Value, ctx: Ctx, clip: 'none' | 'rows' | 'all' = 'none'): Grid {
  if (isRange(v)) {
    let r = v;
    if (clip !== 'none') {
      const c = ctx.host.clip(v);
      r = clip === 'rows' ? { ...v, r2: c.r2 } : c;
    }
    const cells = ctx.host.cellsOf(r.sheetId);
    const { r1, c1 } = r;
    return { rows: r.r2 - r.r1 + 1, cols: r.c2 - r.c1 + 1, get: (i, j) => cells?.get((r1 + i) * MAX_COLS + c1 + j)?.value ?? null };
  }
  const m = isArray(v) ? v.rows : [[scalarOf(v, ctx)]];
  return { rows: m.length, cols: m[0]?.length ?? 0, get: (i, j) => m[i]![j]! };
}

/** A grid that is a single row or column as a sequence; null for 2-D grids. */
export function gridVector(g: Grid): Seq | null {
  if (g.rows === 1) return { length: g.cols, at: (i) => g.get(0, i) };
  if (g.cols === 1) return { length: g.rows, at: (i) => g.get(i, 0) };
  return null;
}

export function gridToMatrix(g: Grid): Scalar[][] {
  const out: Scalar[][] = [];
  for (let i = 0; i < g.rows; i++) {
    const row: Scalar[] = [];
    for (let j = 0; j < g.cols; j++) row.push(g.get(i, j));
    out.push(row);
  }
  return out;
}
