import { compareScalars, toNum } from '../coerce';
import { E, isArray, isErr, isRange, type CalcError, type Value } from '../values';
import { makeCriteria, type Predicate } from './criteria';
import { alias, rawFn } from './registry';
import { collectNumbers, dimsOf, flatten, scalarOf, toGrid, toMatrixExact, type Grid } from './util';

const finite = (n: number): number | CalcError => (Number.isFinite(n) ? n : E.NUM);

rawFn('AVERAGE', 1, 255, (args, ctx) => {
  const c = collectNumbers(args, ctx);
  if (c.error) return c.error;
  if (c.nums.length === 0) return E.DIV0;
  return finite(c.nums.reduce((a, n) => a + n, 0) / c.nums.length);
});

rawFn('COUNT', 1, 255, (args, ctx) => {
  let n = 0;
  for (const a of args) {
    if (isRange(a) || (typeof a === 'object' && a !== null && 'kind' in a)) {
      for (const v of flatten(a, ctx)) if (typeof v === 'number') n++;
    } else if (typeof a === 'number') n++;
    else if (typeof a === 'string' && !isErr(toNum(a))) n++;
    else if (typeof a === 'boolean') n++;
  }
  return n;
});

rawFn('COUNTA', 1, 255, (args, ctx) => {
  let n = 0;
  for (const a of args) {
    if (typeof a === 'object' && a !== null && 'kind' in a) {
      if (isRange(a)) ctx.host.forEachCell(a, () => n++);
      else for (const v of flatten(a, ctx)) if (v !== null) n++;
    } else n++;
  }
  return n;
});

rawFn('COUNTBLANK', 1, 1, (args, ctx) => {
  const a = args[0]!;
  if (isRange(a)) {
    const { rows, cols } = dimsOf(a, ctx);
    let filled = 0;
    ctx.host.forEachCell(a, (_r, _c, v) => {
      if (v !== '') filled++;
    });
    return rows * cols - filled;
  }
  return flatten(a, ctx).filter((v) => v === null || v === '').length;
});

function numbersSorted(args: Value[], ctx: Parameters<typeof collectNumbers>[1]): { nums: number[]; error: CalcError | null } {
  const c = collectNumbers(args, ctx);
  return { nums: c.nums.slice().sort((a, b) => a - b), error: c.error };
}

rawFn('MEDIAN', 1, 255, (args, ctx) => {
  const { nums, error } = numbersSorted(args, ctx);
  if (error) return error;
  if (!nums.length) return E.NUM;
  const m = nums.length >> 1;
  return nums.length % 2 ? nums[m]! : (nums[m - 1]! + nums[m]!) / 2;
});

rawFn('MODE.SNGL', 1, 255, (args, ctx) => {
  const c = collectNumbers(args, ctx);
  if (c.error) return c.error;
  const counts = new Map<number, number>();
  let best: number | null = null;
  let bestN = 1;
  for (const n of c.nums) {
    const k = (counts.get(n) ?? 0) + 1;
    counts.set(n, k);
    if (k > bestN) {
      best = n;
      bestN = k;
    }
  }
  return best ?? E.NA;
});
alias('MODE', 'MODE.SNGL');

function kth(name: string, largest: boolean): void {
  rawFn(name, 2, 2, (args, ctx) => {
    const { nums, error } = numbersSorted([args[0]!], ctx);
    if (error) return error;
    const kv = toNum(scalarOf(args[1]!, ctx));
    if (isErr(kv)) return kv;
    const k = Math.ceil(kv);
    if (k < 1 || k > nums.length) return E.NUM;
    return largest ? nums[nums.length - k]! : nums[k - 1]!;
  });
}
kth('LARGE', true);
kth('SMALL', false);

function variance(nums: number[], sample: boolean): number | CalcError {
  const n = nums.length;
  if (n < (sample ? 2 : 1)) return E.DIV0;
  const mean = nums.reduce((a, x) => a + x, 0) / n;
  return nums.reduce((a, x) => a + (x - mean) ** 2, 0) / (sample ? n - 1 : n);
}
function varLike(name: string, sample: boolean, sqrt: boolean): void {
  rawFn(name, 1, 255, (args, ctx) => {
    const c = collectNumbers(args, ctx);
    if (c.error) return c.error;
    const v = variance(c.nums, sample);
    return typeof v === 'number' ? (sqrt ? Math.sqrt(v) : v) : v;
  });
}
varLike('VAR.S', true, false);
varLike('VAR.P', false, false);
varLike('STDEV.S', true, true);
varLike('STDEV.P', false, true);
alias('VAR', 'VAR.S');
alias('VARP', 'VAR.P');
alias('STDEV', 'STDEV.S');
alias('STDEVP', 'STDEV.P');

function percentile(sorted: number[], p: number, exclusive = false): number | CalcError {
  const n = sorted.length;
  if (!n) return E.NUM;
  if (exclusive) {
    if (p <= 0 || p >= 1) return E.NUM;
    const rank = p * (n + 1);
    if (rank < 1 || rank > n) return E.NUM;
    const lo = Math.floor(rank);
    return sorted[lo - 1]! + (rank - lo) * ((sorted[lo] ?? sorted[lo - 1]!) - sorted[lo - 1]!);
  }
  if (p < 0 || p > 1) return E.NUM;
  const rank = p * (n - 1);
  const lo = Math.floor(rank);
  return sorted[lo]! + (rank - lo) * ((sorted[lo + 1] ?? sorted[lo]!) - sorted[lo]!);
}
rawFn('PERCENTILE.INC', 2, 2, (args, ctx) => {
  const { nums, error } = numbersSorted([args[0]!], ctx);
  if (error) return error;
  const p = toNum(scalarOf(args[1]!, ctx));
  return isErr(p) ? p : percentile(nums, p);
});
rawFn('PERCENTILE.EXC', 2, 2, (args, ctx) => {
  const { nums, error } = numbersSorted([args[0]!], ctx);
  if (error) return error;
  const p = toNum(scalarOf(args[1]!, ctx));
  return isErr(p) ? p : percentile(nums, p, true);
});
alias('PERCENTILE', 'PERCENTILE.INC');
rawFn('QUARTILE.INC', 2, 2, (args, ctx) => {
  const { nums, error } = numbersSorted([args[0]!], ctx);
  if (error) return error;
  const q = toNum(scalarOf(args[1]!, ctx));
  if (isErr(q)) return q;
  if (q < 0 || q > 4) return E.NUM;
  return percentile(nums, Math.trunc(q) / 4);
});
alias('QUARTILE', 'QUARTILE.INC');

rawFn('RANK.EQ', 2, 3, (args, ctx) => {
  const x = toNum(scalarOf(args[0]!, ctx));
  if (isErr(x)) return x;
  const { nums, error } = numbersSorted([args[1]!], ctx);
  if (error) return error;
  const orderV = args[2] === undefined ? 0 : toNum(scalarOf(args[2], ctx));
  if (isErr(orderV)) return orderV;
  if (!nums.includes(x)) return E.NA;
  return orderV === 0 ? nums.filter((n) => n > x).length + 1 : nums.filter((n) => n < x).length + 1;
});
alias('RANK', 'RANK.EQ');

function pairs(a: Value, b: Value, ctx: Parameters<typeof collectNumbers>[1]): { xs: number[]; ys: number[] } | CalcError {
  const A = flatten(a, ctx);
  const B = flatten(b, ctx);
  if (A.length !== B.length) return E.NA;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < A.length; i++) {
    const x = A[i]!;
    const y = B[i]!;
    if (isErr(x)) return x;
    if (isErr(y)) return y;
    if (typeof x === 'number' && typeof y === 'number') {
      xs.push(x);
      ys.push(y);
    }
  }
  return xs.length < 2 ? E.DIV0 : { xs, ys };
}
const mean = (v: number[]) => v.reduce((a, x) => a + x, 0) / v.length;

rawFn('CORREL', 2, 2, (args, ctx) => {
  const p = pairs(args[0]!, args[1]!, ctx);
  if (!('xs' in p)) return p;
  const mx = mean(p.xs);
  const my = mean(p.ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  p.xs.forEach((x, i) => {
    sxy += (x - mx) * (p.ys[i]! - my);
    sxx += (x - mx) ** 2;
    syy += (p.ys[i]! - my) ** 2;
  });
  return sxx === 0 || syy === 0 ? E.DIV0 : sxy / Math.sqrt(sxx * syy);
});
// SLOPE/INTERCEPT take (known_y's, known_x's)
function regression(args: Value[], ctx: Parameters<typeof collectNumbers>[1]): { slope: number; intercept: number } | CalcError {
  const p = pairs(args[1]!, args[0]!, ctx);
  if (!('xs' in p)) return p;
  const mx = mean(p.xs);
  const my = mean(p.ys);
  let sxy = 0;
  let sxx = 0;
  p.xs.forEach((x, i) => {
    sxy += (x - mx) * (p.ys[i]! - my);
    sxx += (x - mx) ** 2;
  });
  if (sxx === 0) return E.DIV0;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}
rawFn('SLOPE', 2, 2, (args, ctx) => {
  const r = regression(args, ctx);
  return 'slope' in r ? r.slope : r;
});
rawFn('INTERCEPT', 2, 2, (args, ctx) => {
  const r = regression(args, ctx);
  return 'intercept' in r ? r.intercept : r;
});
rawFn('FORECAST', 3, 3, (args, ctx) => {
  const x = toNum(scalarOf(args[0]!, ctx));
  if (isErr(x)) return x;
  const r = regression([args[1]!, args[2]!], ctx);
  return 'slope' in r ? r.intercept + r.slope * x : r;
});
alias('FORECAST.LINEAR', 'FORECAST');

// ---- conditional aggregates ------------------------------------------------------------------
interface CritPair {
  grid: Grid;
  pred: Predicate;
}

function critPairs(args: Value[], ctx: Parameters<typeof collectNumbers>[1]): CritPair[] | CalcError {
  const out: CritPair[] = [];
  for (let i = 0; i < args.length; i += 2) {
    const crit = scalarOf(args[i + 1]!, ctx);
    if (isErr(crit)) return crit;
    out.push({ grid: toGrid(args[i]!, ctx, 'rows'), pred: makeCriteria(crit) });
  }
  // criteria ranges must agree in shape; trailing empty rows of clipped whole-column ranges are tolerated
  const h = Math.max(...out.map((p) => p.grid.rows));
  const w = out[0]!.grid.cols;
  if (out.some((p) => p.grid.cols !== w)) return E.VALUE;
  for (const p of out) {
    if (p.grid.rows !== h) {
      const g = p.grid;
      p.grid = { rows: h, cols: g.cols, get: (i, j) => (i < g.rows ? g.get(i, j) : null) };
    }
  }
  return out;
}

function matching(pairsList: CritPair[], cb: (i: number, j: number) => void): void {
  const { rows, cols } = pairsList[0]!.grid;
  if (pairsList.length === 1) {
    const { grid, pred } = pairsList[0]!;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) if (pred(grid.get(i, j))) cb(i, j);
    return;
  }
  for (let i = 0; i < rows; i++) {
    cell: for (let j = 0; j < cols; j++) {
      for (const p of pairsList) if (!p.pred(p.grid.get(i, j))) continue cell;
      cb(i, j);
    }
  }
}

function summary(name: string, kind: 'sum' | 'avg' | 'max' | 'min', ifs: boolean): void {
  rawFn(name, ifs ? 3 : 2, ifs ? 255 : 3, (args, ctx) => {
    let valueArg: Value;
    let rest: Value[];
    if (ifs) {
      valueArg = args[0]!;
      rest = args.slice(1);
      if (rest.length % 2) return E.VALUE;
    } else {
      rest = [args[0]!, args[1]!];
      valueArg = args[2] ?? args[0]!;
    }
    const cp = critPairs(rest, ctx);
    if (!Array.isArray(cp)) return cp;
    const { rows: h, cols: w } = cp[0]!.grid;
    if (!ifs && isRange(valueArg)) {
      // SUMIF/AVERAGEIF: the value range is anchored at its top-left and sized like the criteria range.
      valueArg = { ...valueArg, r2: valueArg.r1 + h - 1, c2: valueArg.c1 + w - 1 };
    }
    const vals = toGrid(valueArg, ctx, 'none');
    if (ifs && (isRange(valueArg) || isArray(valueArg)) && (vals.cols !== w || vals.rows < h)) {
      // allow a whole-column value range paired with a clipped criteria range, but not mismatched shapes
      if (vals.cols !== w) return E.VALUE;
    }
    let count = 0;
    let sum = 0;
    let max = -Infinity;
    let min = Infinity;
    let err: CalcError | null = null;
    matching(cp, (i, j) => {
      const v = i < vals.rows && j < vals.cols ? vals.get(i, j) : null;
      if (typeof v === 'number') {
        count++;
        sum += v;
        if (v > max) max = v;
        if (v < min) min = v;
      } else if (isErr(v)) err ??= v;
    });
    if (err) return err;
    switch (kind) {
      case 'sum':
        return sum;
      case 'avg':
        return count ? sum / count : E.DIV0;
      case 'max':
        return count ? max : 0;
      case 'min':
        return count ? min : 0;
    }
  });
}
summary('SUMIF', 'sum', false);
summary('SUMIFS', 'sum', true);
summary('AVERAGEIF', 'avg', false);
summary('AVERAGEIFS', 'avg', true);
summary('MAXIFS', 'max', true);
summary('MINIFS', 'min', true);

rawFn('COUNTIF', 2, 2, (args, ctx) => {
  const cp = critPairs(args, ctx);
  if (!Array.isArray(cp)) return cp;
  let n = 0;
  matching(cp, () => n++);
  return n;
});
rawFn('COUNTIFS', 2, 254, (args, ctx) => {
  if (args.length % 2) return E.VALUE;
  const cp = critPairs(args, ctx);
  if (!Array.isArray(cp)) return cp;
  let n = 0;
  matching(cp, () => n++);
  return n;
});

void compareScalars;
void toMatrixExact;
