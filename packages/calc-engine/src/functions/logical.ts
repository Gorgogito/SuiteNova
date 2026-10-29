import { toBool, toNum, textToNumber } from '../coerce';
import { arr, E, isArray, isErr, isRange, isRefs, type CalcError, type Scalar, type Value } from '../values';
import { lazyFn, rawFn, scalarFn } from './registry';
import { flatten, scalarOf, toMatrix } from './util';
import { broadcast } from '../evaluator';

const isMulti = (v: Value): boolean => (isRange(v) ? v.r1 !== v.r2 || v.c1 !== v.c2 : isArray(v) ? v.rows.length > 1 || v.rows[0]!.length > 1 : false);

/** Choose elementwise between branch values when the condition is an array. */
function select(cond: Value, branches: (() => Value)[], pick: (c: Scalar) => number | CalcError, ctx: Parameters<typeof scalarOf>[1]): Value {
  if (!isMulti(cond)) {
    const c = scalarOf(cond, ctx);
    const i = pick(c);
    if (isErr(i)) return i;
    return i < 0 ? false : branches[i]!();
  }
  const vals = branches.map((b) => b());
  return broadcast([cond, ...vals], ctx, ([c, ...rest]) => {
    const i = pick(c!);
    if (isErr(i)) return i;
    return i < 0 ? false : (rest[i] ?? null);
  });
}

lazyFn('IF', 2, 3, ([c, t, f], ctx) => {
  const cond = c!();
  const branches: (() => Value)[] = [t!, f ?? (() => false)];
  return select(
    cond,
    branches,
    (s) => {
      const b = toBool(s);
      return isErr(b) ? b : b ? 0 : 1;
    },
    ctx,
  );
});

lazyFn('IFS', 2, 254, (th, ctx) => {
  if (th.length % 2) return E.NA;
  for (let i = 0; i < th.length; i += 2) {
    const b = toBool(scalarOf(th[i]!(), ctx));
    if (isErr(b)) return b;
    if (b) return th[i + 1]!();
  }
  return E.NA;
});

lazyFn('SWITCH', 3, 254, (th, ctx) => {
  const target = scalarOf(th[0]!(), ctx);
  if (isErr(target)) return target;
  const hasDefault = th.length % 2 === 0;
  const pairsEnd = hasDefault ? th.length - 1 : th.length;
  for (let i = 1; i < pairsEnd; i += 2) {
    const cand = scalarOf(th[i]!(), ctx);
    if (isErr(cand)) return cand;
    if (eq(target, cand)) return th[i + 1]!();
  }
  return hasDefault ? th[th.length - 1]!() : E.NA;
});

function eq(a: Scalar, b: Scalar): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return a === b || (a === null && (b === 0 || b === '')) || (b === null && (a === 0 || a === ''));
}

lazyFn('CHOOSE', 2, 255, (th, ctx) => {
  const idx = th[0]!();
  return select(
    idx,
    th.slice(1),
    (s) => {
      const n = toNum(s);
      if (isErr(n)) return n;
      const i = Math.trunc(n);
      return i < 1 || i > th.length - 1 ? E.VALUE : i - 1;
    },
    ctx,
  );
});

lazyFn('IFERROR', 2, 2, ([v, alt], ctx) => {
  const r = v!();
  if (isMulti(r)) {
    const m = toMatrix(r, ctx);
    if (!m.flat().some(isErr)) return r;
    const altVal = alt!();
    return broadcast([r, altVal], ctx, ([x, y]) => (isErr(x!) ? y! : x!));
  }
  return isErr(scalarOf(r, ctx)) ? alt!() : r;
});

lazyFn('IFNA', 2, 2, ([v, alt], ctx) => {
  const r = v!();
  if (isMulti(r)) {
    if (!toMatrix(r, ctx).flat().some((x) => x === E.NA)) return r;
    return broadcast([r, alt!()], ctx, ([x, y]) => (x === E.NA ? y! : x!));
  }
  return scalarOf(r, ctx) === E.NA ? alt!() : r;
});

function collectBools(args: Value[], ctx: Parameters<typeof scalarOf>[1]): { vals: boolean[]; error: CalcError | null } {
  const vals: boolean[] = [];
  let error: CalcError | null = null;
  for (const a of args) {
    if (isRange(a) || isArray(a)) {
      for (const v of flatten(a, ctx)) {
        if (isErr(v)) error ??= v;
        else if (typeof v === 'boolean') vals.push(v);
        else if (typeof v === 'number') vals.push(v !== 0);
      }
    } else {
      const b = toBool(scalarOf(a, ctx));
      if (isErr(b)) error ??= b;
      else vals.push(b);
    }
  }
  return { vals, error };
}
rawFn('AND', 1, 255, (args, ctx) => {
  const { vals, error } = collectBools(args, ctx);
  if (error) return error;
  return vals.length ? vals.every(Boolean) : E.VALUE;
});
rawFn('OR', 1, 255, (args, ctx) => {
  const { vals, error } = collectBools(args, ctx);
  if (error) return error;
  return vals.length ? vals.some(Boolean) : E.VALUE;
});
rawFn('XOR', 1, 255, (args, ctx) => {
  const { vals, error } = collectBools(args, ctx);
  if (error) return error;
  return vals.length ? vals.filter(Boolean).length % 2 === 1 : E.VALUE;
});
scalarFn('NOT', 1, 1, ([a]) => {
  const b = toBool(a!);
  return isErr(b) ? b : !b;
});
scalarFn('TRUE', 0, 0, () => true);
scalarFn('FALSE', 0, 0, () => false);

// ---- information ---------------------------------------------------------------------------
const info = (name: string, f: (v: Scalar) => boolean) => scalarFn(name, 1, 1, ([a]) => f(a!), { handlesErrors: true });
info('ISBLANK', (v) => v === null);
info('ISERROR', (v) => isErr(v));
info('ISERR', (v) => isErr(v) && v !== E.NA);
info('ISNA', (v) => v === E.NA);
info('ISNUMBER', (v) => typeof v === 'number');
info('ISTEXT', (v) => typeof v === 'string');
info('ISNONTEXT', (v) => typeof v !== 'string');
info('ISLOGICAL', (v) => typeof v === 'boolean');
scalarFn('ISEVEN', 1, 1, ([a]) => {
  const n = toNum(a!);
  return isErr(n) ? n : Math.floor(Math.abs(n)) % 2 === 0;
});
scalarFn('ISODD', 1, 1, ([a]) => {
  const n = toNum(a!);
  return isErr(n) ? n : Math.floor(Math.abs(n)) % 2 === 1;
});
scalarFn('N', 1, 1, ([a]) => (typeof a === 'number' ? a : typeof a === 'boolean' ? (a ? 1 : 0) : 0));
scalarFn('T', 1, 1, ([a]) => (typeof a === 'string' ? a : ''));
scalarFn('NA', 0, 0, () => E.NA);
scalarFn(
  'TYPE',
  1,
  1,
  ([a]) => (isErr(a!) ? 16 : typeof a === 'number' || a === null ? 1 : typeof a === 'string' ? 2 : 4),
  { handlesErrors: true },
);
scalarFn(
  'ERROR.TYPE',
  1,
  1,
  ([a]) => {
    if (!isErr(a!)) return E.NA;
    const order = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'];
    const i = order.indexOf(a.code);
    return i < 0 ? E.NA : i + 1;
  },
  { handlesErrors: true },
);
rawFn('ISREF', 1, 1, (args) => isRange(args[0]!) || isRefs(args[0]!));
rawFn('SHEET', 0, 1, (args, ctx) => {
  const a = args[0];
  const id = a && isRange(a) ? a.sheetId : ctx.sheetId;
  return ctx.host.sheetNameById(id) === undefined ? E.NA : id;
});
rawFn('SHEETS', 0, 1, (_a, ctx) => ctx.host.sheetCount());

void arr;
void textToNumber;
