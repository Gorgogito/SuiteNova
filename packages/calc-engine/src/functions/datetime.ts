import { toNum, toText } from '../coerce';
import { daysInMonth, serialFromDate, serialFromYMD, timeFromFraction, weekdayFromSerial, ymdFromSerial } from '../dates';
import { parseInput } from '../input';
import { E, isErr, isRange, type CalcError, type Scalar, type Value } from '../values';
import { rawFn, scalarFn } from './registry';
import { collectNumbers, flatten } from './util';

function ints(args: Scalar[]): number[] | CalcError {
  const out: number[] = [];
  for (const a of args) {
    const n = toNum(a);
    if (isErr(n)) return n;
    out.push(Math.trunc(n));
  }
  return out;
}

const validSerial = (n: number) => n >= 0 && n < 2_958_466;

scalarFn('TODAY', 0, 0, (_a, ctx) => Math.floor(serialFromDate(ctx.host.now())), { volatile: true });
scalarFn('NOW', 0, 0, (_a, ctx) => serialFromDate(ctx.host.now()), { volatile: true });

scalarFn('DATE', 3, 3, (args) => {
  const v = ints(args);
  if (isErr(v)) return v;
  let [y, m, d] = v as [number, number, number];
  if (y >= 0 && y < 1900) y += 1900;
  if (y < 0 || y > 9999) return E.NUM;
  const s = serialFromYMD(y, m, d);
  return validSerial(s) ? s : E.NUM;
});

function part(name: string, f: (serial: number) => number): void {
  scalarFn(name, 1, 1, ([a]) => {
    const n = typeof a === 'string' ? (parseInput(a).kind === 'number' ? (parseInput(a).value as number) : NaN) : toNum(a!);
    if (typeof n !== 'number') return n;
    if (Number.isNaN(n)) return E.VALUE;
    if (!validSerial(n)) return E.NUM;
    return f(n);
  });
}
part('YEAR', (s) => ymdFromSerial(s).y);
part('MONTH', (s) => ymdFromSerial(s).m);
part('DAY', (s) => ymdFromSerial(s).d);
part('HOUR', (s) => timeFromFraction(s).h);
part('MINUTE', (s) => timeFromFraction(s).mi);
part('SECOND', (s) => timeFromFraction(s).s);

scalarFn('TIME', 3, 3, (args) => {
  const v = ints(args);
  if (isErr(v)) return v;
  const [h, m, s] = v as [number, number, number];
  const total = h * 3600 + m * 60 + s;
  return total < 0 ? E.NUM : (total % 86400) / 86400;
});

scalarFn('WEEKDAY', 1, 2, ([a, t]) => {
  const n = toNum(a!);
  if (isErr(n)) return n;
  const type = t === undefined || t === null ? 1 : toNum(t);
  if (isErr(type)) return type;
  const wd = weekdayFromSerial(n); // 0 = Sunday
  switch (type) {
    case 1:
      return wd + 1;
    case 2:
      return ((wd + 6) % 7) + 1;
    case 3:
      return (wd + 6) % 7;
    default:
      return type >= 11 && type <= 17 ? ((wd - (type - 11) - 1 + 14) % 7) + 1 : E.NUM;
  }
});

scalarFn('WEEKNUM', 1, 2, ([a, t]) => {
  const n = toNum(a!);
  if (isErr(n)) return n;
  const type = t === undefined || t === null ? 1 : toNum(t);
  if (isErr(type)) return type;
  const startsMonday = type === 2 || type === 21 || type === 11;
  const { y } = ymdFromSerial(n);
  const jan1 = serialFromYMD(y, 1, 1);
  const wd1 = weekdayFromSerial(jan1);
  const offset = startsMonday ? (wd1 + 6) % 7 : wd1;
  return Math.floor((Math.floor(n) - jan1 + offset) / 7) + 1;
});

scalarFn('ISOWEEKNUM', 1, 1, ([a]) => {
  const n = toNum(a!);
  if (isErr(n)) return n;
  const wd = (weekdayFromSerial(n) + 6) % 7; // Monday = 0
  const thursday = Math.floor(n) - wd + 3;
  const { y } = ymdFromSerial(thursday);
  return Math.floor((thursday - serialFromYMD(y, 1, 1)) / 7) + 1;
});

function addMonths(serial: number, months: number): number {
  const { y, m, d } = ymdFromSerial(serial);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return serialFromYMD(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}
scalarFn('EDATE', 2, 2, ([a, m]) => {
  const v = ints([a!, m!]);
  if (isErr(v)) return v;
  const r = addMonths(v[0]!, v[1]!);
  return validSerial(r) ? r : E.NUM;
});
scalarFn('EOMONTH', 2, 2, ([a, m]) => {
  const v = ints([a!, m!]);
  if (isErr(v)) return v;
  const base = addMonths(v[0]!, v[1]!);
  const { y, m: mo } = ymdFromSerial(base);
  return serialFromYMD(y, mo, daysInMonth(y, mo));
});
scalarFn('DAYS', 2, 2, ([e, s]) => {
  const v = [toNum(e!), toNum(s!)];
  for (const x of v) if (isErr(x)) return x;
  return Math.trunc(v[0] as number) - Math.trunc(v[1] as number);
});
scalarFn('DATEDIF', 3, 3, ([a, b, u]) => {
  const s = toNum(a!);
  const e = toNum(b!);
  const unit = toText(u!);
  if (isErr(s)) return s;
  if (isErr(e)) return e;
  if (isErr(unit)) return unit;
  if (s > e) return E.NUM;
  const sy = ymdFromSerial(s);
  const ey = ymdFromSerial(e);
  let months = (ey.y - sy.y) * 12 + (ey.m - sy.m);
  if (ey.d < sy.d) months--;
  switch (unit.toUpperCase()) {
    case 'Y':
      return Math.floor(months / 12);
    case 'M':
      return months;
    case 'D':
      return Math.trunc(e) - Math.trunc(s);
    case 'MD': {
      let d = ey.d - sy.d;
      if (d < 0) d += daysInMonth(ey.m === 1 ? ey.y - 1 : ey.y, ey.m === 1 ? 12 : ey.m - 1);
      return d;
    }
    case 'YM':
      return ((months % 12) + 12) % 12;
    case 'YD': {
      const adj = serialFromYMD(ey.y - (ey.m < sy.m || (ey.m === sy.m && ey.d < sy.d) ? 1 : 0), sy.m, sy.d);
      return Math.trunc(e) - adj;
    }
    default:
      return E.NUM;
  }
});

scalarFn('DATEVALUE', 1, 1, ([a]) => {
  const s = toText(a!);
  if (isErr(s)) return s;
  const p = parseInput(s.trim());
  return p.kind === 'number' && typeof p.value === 'number' ? Math.floor(p.value) : E.VALUE;
});
scalarFn('TIMEVALUE', 1, 1, ([a]) => {
  const s = toText(a!);
  if (isErr(s)) return s;
  const p = parseInput(s.trim());
  return p.kind === 'number' && typeof p.value === 'number' ? p.value - Math.floor(p.value) : E.VALUE;
});

function holidaySet(v: Value | undefined, ctx: Parameters<typeof flatten>[1]): Set<number> | CalcError {
  const set = new Set<number>();
  if (v === undefined) return set;
  for (const x of flatten(v, ctx)) {
    if (isErr(x)) return x;
    if (typeof x === 'number') set.add(Math.floor(x));
  }
  return set;
}
const isWorkday = (d: number, hol: Set<number>) => {
  const wd = weekdayFromSerial(d);
  return wd !== 0 && wd !== 6 && !hol.has(d);
};
rawFn('NETWORKDAYS', 2, 3, (args, ctx) => {
  const c = collectNumbers([args[0]!, args[1]!], ctx);
  if (c.error) return c.error;
  if (c.nums.length !== 2) return E.VALUE;
  const hol = holidaySet(args[2], ctx);
  if (!(hol instanceof Set)) return hol;
  const [a, b] = [Math.floor(c.nums[0]!), Math.floor(c.nums[1]!)];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  let n = 0;
  for (let d = lo; d <= hi; d++) if (isWorkday(d, hol)) n++;
  return a <= b ? n : -n;
});
rawFn('WORKDAY', 2, 3, (args, ctx) => {
  const c = collectNumbers([args[0]!, args[1]!], ctx);
  if (c.error) return c.error;
  if (c.nums.length !== 2) return E.VALUE;
  const hol = holidaySet(args[2], ctx);
  if (!(hol instanceof Set)) return hol;
  let d = Math.floor(c.nums[0]!);
  let left = Math.trunc(c.nums[1]!);
  const step = left < 0 ? -1 : 1;
  left = Math.abs(left);
  while (left > 0) {
    d += step;
    if (isWorkday(d, hol)) left--;
  }
  return d;
});

scalarFn('YEARFRAC', 2, 3, ([a, b, basis]) => {
  const s = toNum(a!);
  const e = toNum(b!);
  const bs = basis === undefined || basis === null ? 0 : toNum(basis);
  if (isErr(s)) return s;
  if (isErr(e)) return e;
  if (isErr(bs)) return bs;
  const [lo, hi] = s <= e ? [Math.floor(s), Math.floor(e)] : [Math.floor(e), Math.floor(s)];
  const l = ymdFromSerial(lo);
  const h = ymdFromSerial(hi);
  switch (bs) {
    case 0: {
      const d1 = Math.min(l.d, 30);
      const d2 = h.d === 31 && d1 >= 30 ? 30 : h.d;
      return ((h.y - l.y) * 360 + (h.m - l.m) * 30 + (d2 - d1)) / 360;
    }
    case 2:
      return (hi - lo) / 360;
    case 3:
      return (hi - lo) / 365;
    case 4:
      return ((h.y - l.y) * 360 + (h.m - l.m) * 30 + (Math.min(h.d, 30) - Math.min(l.d, 30))) / 360;
    case 1: {
      const years = h.y - l.y + 1;
      const days = serialFromYMD(h.y + 1, 1, 1) - serialFromYMD(l.y, 1, 1);
      return (hi - lo) / (days / years);
    }
    default:
      return E.NUM;
  }
});

void isRange;
