import type { BinOp, Node } from './ast';
import { compareScalars, toNum, toText } from './coerce';
import { registry, type Ctx } from './functions/registry';
import { scalarOf, toMatrix } from './functions/util';
import { arr, E, isArray, isErr, isLambda, isRange, isRefs, type LambdaVal, type RangeVal, type Scalar, type Value } from './values';

function sheetIdFor(name: string | undefined, ctx: Ctx): number | undefined {
  return name === undefined ? ctx.sheetId : ctx.host.sheetIdByName(name);
}

/** The rectangles a reference value stands for (undefined when the value is not a reference). */
export function areasOf(v: Value): RangeVal[] | undefined {
  if (isRange(v)) return [v];
  if (isRefs(v)) return v.areas;
  return undefined;
}

const fromAreas = (areas: RangeVal[]): Value => (areas.length === 1 ? areas[0]! : { kind: 'refs', areas });

const intersect = (a: RangeVal, b: RangeVal): RangeVal | null => {
  if (a.sheetId !== b.sheetId) return null;
  const r1 = Math.max(a.r1, b.r1);
  const r2 = Math.min(a.r2, b.r2);
  const c1 = Math.max(a.c1, b.c1);
  const c2 = Math.min(a.c2, b.c2);
  return r1 > r2 || c1 > c2 ? null : { kind: 'range', sheetId: a.sheetId, r1, c1, r2, c2 };
};

/** The one value @ takes from a reference or an array: the cell on the formula's own row or column. */
function implicitIntersection(v: Value, ctx: Ctx): Value {
  if (isRange(v)) {
    if (v.r1 === v.r2 && v.c1 === v.c2) return v;
    const oneCol = v.c1 === v.c2;
    const oneRow = v.r1 === v.r2;
    if (oneCol && ctx.row >= v.r1 && ctx.row <= v.r2) return { ...v, r1: ctx.row, r2: ctx.row };
    if (oneRow && ctx.col >= v.c1 && ctx.col <= v.c2) return { ...v, c1: ctx.col, c2: ctx.col };
    if (!oneCol && !oneRow && ctx.row >= v.r1 && ctx.row <= v.r2 && ctx.col >= v.c1 && ctx.col <= v.c2) return { ...v, r1: ctx.row, r2: ctx.row, c1: ctx.col, c2: ctx.col };
    return E.VALUE;
  }
  if (isArray(v)) return v.rows[0]?.[0] ?? null;
  if (isRefs(v)) return E.VALUE;
  return v;
}

const isScalarish = (v: Value): boolean => {
  if (isRefs(v) || isLambda(v)) return true;
  if (isRange(v)) return v.r1 === v.r2 && v.c1 === v.c2;
  if (isArray(v)) return v.rows.length === 1 && v.rows[0]!.length === 1;
  return true;
};

/** Apply f over scalars/arrays/ranges with spreadsheet broadcasting (size-1 axes stretch, mismatches give #N/A). */
export function broadcast(vals: Value[], ctx: Ctx, f: (s: Scalar[]) => Scalar): Value {
  if (vals.every(isScalarish)) return f(vals.map((v) => scalarOf(v, ctx)));
  const mats = vals.map((v) => toMatrix(v, ctx));
  const rows = Math.max(...mats.map((m) => m.length));
  const cols = Math.max(...mats.map((m) => m[0]?.length ?? 0));
  const out: Scalar[][] = [];
  for (let i = 0; i < rows; i++) {
    const row: Scalar[] = [];
    for (let j = 0; j < cols; j++) {
      let bad = false;
      const args = mats.map((m) => {
        const h = m.length;
        const w = m[0]?.length ?? 0;
        const ri = h === 1 ? 0 : i;
        const ci = w === 1 ? 0 : j;
        if (ri >= h || ci >= w) {
          bad = true;
          return null;
        }
        return m[ri]![ci]!;
      });
      row.push(bad ? E.NA : f(args));
    }
    out.push(row);
  }
  return arr(out);
}

function arith(op: BinOp, x: Scalar, y: Scalar): Scalar {
  if (isErr(x)) return x;
  if (isErr(y)) return y;
  const a = toNum(x);
  if (isErr(a)) return a;
  const b = toNum(y);
  if (isErr(b)) return b;
  let r: number;
  switch (op) {
    case '+':
      r = a + b;
      break;
    case '-':
      r = a - b;
      break;
    case '*':
      r = a * b;
      break;
    case '/':
      if (b === 0) return E.DIV0;
      r = a / b;
      break;
    case '^':
      if (a === 0 && b === 0) return E.NUM;
      r = Math.pow(a, b);
      break;
    default:
      return E.VALUE;
  }
  return Number.isFinite(r) ? r : E.NUM;
}

function compare(op: BinOp, x: Scalar, y: Scalar): Scalar {
  if (isErr(x)) return x;
  if (isErr(y)) return y;
  const c = compareScalars(x, y);
  switch (op) {
    case '=':
      return c === 0;
    case '<>':
      return c !== 0;
    case '<':
      return c < 0;
    case '>':
      return c > 0;
    case '<=':
      return c <= 0;
    default:
      return c >= 0;
  }
}

function binary(op: BinOp, l: Value, r: Value, ctx: Ctx): Value {
  if (op === '&') {
    return broadcast([l, r], ctx, ([x, y]) => {
      const a = toText(x!);
      if (isErr(a)) return a;
      const b = toText(y!);
      return isErr(b) ? b : a + b;
    });
  }
  if (op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=') {
    return broadcast([l, r], ctx, ([x, y]) => compare(op, x!, y!));
  }
  return broadcast([l, r], ctx, ([x, y]) => arith(op, x!, y!));
}

function mapUnary(v: Value, ctx: Ctx, f: (s: Scalar) => Scalar): Value {
  return broadcast([v], ctx, ([x]) => f(x!));
}

/** A name that is not defined may still be a table: if the reference did not resolve it is #NAME?. */
const tableOrName = (r: Value): Value => (isErr(r) ? E.NAME : r);

/** Evaluate an AST node in a cell context. */
export function evaluate(n: Node, ctx: Ctx): Value {
  switch (n.t) {
    case 'num':
    case 'str':
    case 'bool':
      return n.v;
    case 'err':
      return n.v;
    case 'missing':
      return null;
    case 'ref':
    case 'range': {
      const b = n.t === 'range' ? n.b : n.a;
      const rect = { r1: Math.min(n.a.row, b.row), c1: Math.min(n.a.col, b.col), r2: Math.max(n.a.row, b.row), c2: Math.max(n.a.col, b.col) };
      if (n.sheetEnd !== undefined) {
        const ids = ctx.host.sheetIdsBetween(n.sheet!, n.sheetEnd);
        if (!ids || ids.length === 0) return E.REF;
        return fromAreas(ids.map((sheetId) => ({ kind: 'range' as const, sheetId, ...rect })));
      }
      const id = sheetIdFor(n.sheet, ctx);
      if (id === undefined) return E.REF;
      return { kind: 'range', sheetId: id, ...rect };
    }
    case 'union': {
      const areas: RangeVal[] = [];
      for (const part of n.parts) {
        const v = evaluate(part, ctx);
        if (isErr(v)) return v;
        const a = areasOf(v);
        if (!a) return E.VALUE;
        areas.push(...a);
      }
      return fromAreas(areas);
    }
    case 'isect': {
      const l = evaluate(n.l, ctx);
      const r = evaluate(n.r, ctx);
      if (isErr(l)) return l;
      if (isErr(r)) return r;
      const la = areasOf(l);
      const ra = areasOf(r);
      if (!la || !ra) return E.VALUE;
      const out: RangeVal[] = [];
      for (const x of la) {
        for (const y of ra) {
          const i = intersect(x, y);
          if (i) out.push(i);
        }
      }
      return out.length ? fromAreas(out) : E.NULL;
    }
    case 'implicit':
      return implicitIntersection(evaluate(n.e, ctx), ctx);
    case 'tref':
      return ctx.host.tableRef ? ctx.host.tableRef(n, ctx.sheetId, ctx.row, ctx.col) : E.REF;
    case 'callv': {
      const fn = evaluate(n.fn, ctx);
      if (isErr(fn)) return fn;
      if (!isLambda(fn)) return E.VALUE;
      return applyLambda(fn, n.args.map((a) => evaluate(a, ctx)), ctx);
    }
    case 'rangeop': {
      const l = evaluate(n.l, ctx);
      const r = evaluate(n.r, ctx);
      if (isErr(l)) return l;
      if (isErr(r)) return r;
      if (!isRange(l) || !isRange(r) || l.sheetId !== r.sheetId) return E.VALUE;
      return { kind: 'range', sheetId: l.sheetId, r1: Math.min(l.r1, r.r1), c1: Math.min(l.c1, r.c1), r2: Math.max(l.r2, r.r2), c2: Math.max(l.c2, r.c2) };
    }
    case 'name': {
      const key = n.name.toLowerCase();
      if (ctx.scope) {
        for (const [k, v] of ctx.scope) if (k.toLowerCase() === key) return v;
      }
      const def = ctx.host.definedName(n.name, ctx.sheetId);
      if (def) return evaluate(def, ctx);
      // a table's name alone stands for its data
      return ctx.host.tableRef ? tableOrName(ctx.host.tableRef({ t: 'tref', table: n.name, area: 'data' }, ctx.sheetId, ctx.row, ctx.col)) : E.NAME;
    }
    case 'un': {
      const v = evaluate(n.e, ctx);
      if (n.op === '+') return v;
      return mapUnary(v, ctx, (x) => {
        const num = toNum(x);
        return isErr(num) ? num : -num;
      });
    }
    case 'pct':
      return mapUnary(evaluate(n.e, ctx), ctx, (x) => {
        const num = toNum(x);
        return isErr(num) ? num : num / 100;
      });
    case 'bin':
      return binary(n.op, evaluate(n.l, ctx), evaluate(n.r, ctx), ctx);
    case 'arr':
      return arr(n.rows.map((row) => row.map((c) => scalarOf(evaluate(c, ctx), ctx))));
    case 'call':
      return callFunction(n, ctx);
  }
}

const MAX_LAMBDA_DEPTH = 400;

/** Call a function value with already evaluated arguments. */
export function applyLambda(fn: LambdaVal, args: Value[], ctx: Ctx): Value {
  if (args.length !== fn.params.length) return E.VALUE;
  const depth = (ctx.depth ?? 0) + 1;
  if (depth > MAX_LAMBDA_DEPTH) return E.CALC;
  const scope = new Map(fn.scope ?? []);
  fn.params.forEach((p, i) => scope.set(p, args[i]!));
  const savedScope = ctx.scope;
  const savedDepth = ctx.depth;
  ctx.scope = scope;
  ctx.depth = depth;
  try {
    return evaluate(fn.body as Node, ctx);
  } finally {
    ctx.scope = savedScope;
    ctx.depth = savedDepth;
  }
}

/** A name used as a function: a LAMBDA bound by LET or as a parameter, or a defined name that holds one. */
function lambdaNamed(name: string, ctx: Ctx): LambdaVal | null {
  const key = name.toLowerCase();
  if (ctx.scope) {
    for (const [k, v] of ctx.scope) if (k.toLowerCase() === key) return isLambda(v) ? v : null;
  }
  const def = ctx.host.definedName(name, ctx.sheetId);
  if (!def) return null;
  const v = evaluate(def, ctx);
  return isLambda(v) ? v : null;
}

function evalLambda(n: Extract<Node, { t: 'call' }>, ctx: Ctx): Value {
  if (n.args.length === 0) return E.VALUE;
  const params: string[] = [];
  for (const a of n.args.slice(0, -1)) {
    if (a.t !== 'name') return E.VALUE;
    params.push(a.name);
  }
  return { kind: 'lambda', params, body: n.args[n.args.length - 1], scope: ctx.scope };
}

function callFunction(n: Extract<Node, { t: 'call' }>, ctx: Ctx): Value {
  const name = n.name.replace(/^_XLFN\.(_XLWS\.)?/, '');
  if (name === 'LET') return evalLet(n, ctx);
  if (name === 'LAMBDA') return evalLambda(n, ctx);
  const def = registry.get(name);
  if (!def) {
    const fn = lambdaNamed(n.name, ctx);
    if (fn) return applyLambda(fn, n.args.map((a) => evaluate(a, ctx)), ctx);
    // a function of a macro module
    if (ctx.host.userFunction) {
      const r = ctx.host.userFunction(n.name, n.args.map((a) => evaluate(a, ctx)));
      if (r !== undefined) return r;
    }
    return E.NAME;
  }
  if (n.args.length < def.min || n.args.length > def.max) return E.VALUE;
  if (def.volatile) ctx.volatile = true;

  if (def.kind === 'lazy') return def.impl(n.args.map((a) => () => evaluate(a, ctx)), ctx);

  let args = n.args.map((a) => evaluate(a, ctx));
  if (args.some((a) => isRefs(a) || isLambda(a))) {
    const fixed = fixSpecialArgs(args, def, ctx);
    if (!Array.isArray(fixed)) return fixed;
    args = fixed;
  }
  if (def.kind === 'raw') return def.impl(args, ctx);

  // scalar: propagate the first error, then lift over arrays
  if (!def.handlesErrors) {
    for (const a of args) if (isErr(a)) return a;
  }
  return broadcast(args, ctx, (s) => {
    if (!def.handlesErrors) {
      for (const x of s) if (isErr(x)) return x;
    }
    const r = def.impl(s, ctx);
    return scalarOf(r, ctx);
  });
}

/** References with several areas and function values are only meaningful to some functions. */
function fixSpecialArgs(args: Value[], def: NonNullable<ReturnType<typeof registry.get>>, ctx: Ctx): Value[] | typeof E.VALUE {
  const out: Value[] = [];
  for (const a of args) {
    if (isLambda(a)) {
      if (!def.lambdas) return E.CALC;
      out.push(a);
    } else if (isRefs(a)) {
      if (def.multi === 'spread') out.push(...a.areas);
      else if (def.multi === 'flatten') out.push(arr(a.areas.flatMap((r) => toMatrix(r, ctx).flat().map((v) => [v]))));
      else if (def.multi === 'native') out.push(a);
      else return E.VALUE;
    } else out.push(a);
  }
  return out;
}

/** LET(name1, value1, …, calculation): names are bound in order and visible to later values. */
function evalLet(n: Extract<Node, { t: 'call' }>, ctx: Ctx): Value {
  const a = n.args;
  if (a.length < 3 || a.length % 2 === 0) return E.VALUE;
  const saved = ctx.scope;
  const scope = new Map(saved ?? []);
  ctx.scope = scope;
  try {
    for (let i = 0; i < a.length - 1; i += 2) {
      const nm = a[i]!;
      if (nm.t !== 'name') return E.VALUE;
      scope.set(nm.name, evaluate(a[i + 1]!, ctx));
    }
    return evaluate(a[a.length - 1]!, ctx);
  } finally {
    ctx.scope = saved;
  }
}
