import { formatA1, colToName, MAX_COLS, MAX_ROWS, type CellAddr } from './addr';
import type { Node } from './ast';
import { E } from './values';
import { printTref } from './tables';

const PREC = { cmp: 1, concat: 2, add: 3, mul: 4, pow: 5, unary: 6, pct: 7, atom: 9 } as const;

function binPrec(op: string): number {
  switch (op) {
    case '&':
      return PREC.concat;
    case '+':
    case '-':
      return PREC.add;
    case '*':
    case '/':
      return PREC.mul;
    case '^':
      return PREC.pow;
    default:
      return PREC.cmp;
  }
}

function nodePrec(n: Node): number {
  switch (n.t) {
    case 'bin':
      return binPrec(n.op);
    case 'un':
      return PREC.unary;
    case 'pct':
      return PREC.pct;
    default:
      return PREC.atom;
  }
}

export function quoteSheet(name: string): string {
  return /^[A-Za-z_À-￿][\w.À-￿]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

const simpleName = (name: string) => /^[A-Za-z_À-￿][\w.À-￿]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name);
/** "Hoja1!", "'Mi hoja'!" or, for a 3D reference, "Hoja1:Hoja3!" / "'Mi hoja:Otra'!". */
const prefix = (sheet?: string, sheetEnd?: string) => {
  if (sheet === undefined) return '';
  if (sheetEnd === undefined) return `${quoteSheet(sheet)}!`;
  if (simpleName(sheet) && simpleName(sheetEnd)) return `${sheet}:${sheetEnd}!`;
  return `'${sheet.replace(/'/g, "''")}:${sheetEnd.replace(/'/g, "''")}'!`;
};

function printAddr(a: CellAddr): string {
  return formatA1(a.row, a.col, a.absRow, a.absCol);
}

export interface PrintOptions {
  /** Argument separator (default ","). */
  sep?: string;
  /** Decimal separator (default "."). */
  dec?: string;
  /** Rename functions (for localised display). */
  fn?: (name: string) => string;
  /** Write [[#This Row],[Col]] for table references (the form stored in files) instead of [@Col]. */
  fileTables?: boolean;
  /** Localised TRUE/FALSE. */
  bool?: [string, string];
}

/** Canonical (en-US) formula text, without the leading "=". Options produce localised text. */
export function printFormula(n: Node, o: PrintOptions = {}): string {
  const sep = o.sep ?? ',';
  const p = (x: Node) => printFormula(x, o);
  switch (n.t) {
    case 'num':
      return o.dec && o.dec !== '.' ? String(n.v).replace('.', o.dec) : String(n.v);
    case 'str':
      return `"${n.v.replace(/"/g, '""')}"`;
    case 'bool':
      return o.bool ? (n.v ? o.bool[0] : o.bool[1]) : n.v ? 'TRUE' : 'FALSE';
    case 'err':
      return n.v.code;
    case 'ref':
      return prefix(n.sheet, n.sheetEnd) + printAddr(n.a);
    case 'range':
      if (n.whole === 'col') return `${prefix(n.sheet, n.sheetEnd)}${n.a.absCol ? '$' : ''}${colToName(n.a.col)}:${n.b.absCol ? '$' : ''}${colToName(n.b.col)}`;
      if (n.whole === 'row') return `${prefix(n.sheet, n.sheetEnd)}${n.a.absRow ? '$' : ''}${n.a.row + 1}:${n.b.absRow ? '$' : ''}${n.b.row + 1}`;
      return `${prefix(n.sheet, n.sheetEnd)}${printAddr(n.a)}:${printAddr(n.b)}`;
    case 'rangeop':
      return `${p(n.l)}:${p(n.r)}`;
    case 'union':
      return `(${n.parts.map(p).join(sep)})`;
    case 'isect':
      return `${p(n.l)} ${p(n.r)}`;
    case 'implicit':
      return `@${p(n.e)}`;
    case 'callv':
      return `${p(n.fn)}(${n.args.map(p).join(sep)})`;
    case 'name':
      return n.name;
    case 'un': {
      const inner = p(n.e);
      return n.op + (nodePrec(n.e) < PREC.unary ? `(${inner})` : inner);
    }
    case 'pct': {
      const inner = p(n.e);
      return (nodePrec(n.e) < PREC.pct ? `(${inner})` : inner) + '%';
    }
    case 'bin': {
      const prec = binPrec(n.op);
      const l = p(n.l);
      const r = p(n.r);
      const lw = nodePrec(n.l) < prec;
      const rw = nodePrec(n.r) <= prec;
      return `${lw ? `(${l})` : l}${n.op}${rw ? `(${r})` : r}`;
    }
    case 'call':
      return `${o.fn ? o.fn(n.name) : n.name}(${n.args.map(p).join(sep)})`;
    case 'arr':
      return `{${n.rows.map((r) => r.map(p).join(sep === ';' ? '\\' : ',')).join(';')}}`;
    case 'tref':
      return printTref(n, { file: o.fileTables });
    case 'missing':
      return '';
  }
}

/** Visit every node (pre-order). */
export function walk(n: Node, fn: (n: Node) => void): void {
  fn(n);
  switch (n.t) {
    case 'un':
    case 'pct':
      walk(n.e, fn);
      break;
    case 'bin':
    case 'rangeop':
    case 'isect':
      walk(n.l, fn);
      walk(n.r, fn);
      break;
    case 'implicit':
      walk(n.e, fn);
      break;
    case 'union':
      n.parts.forEach((a) => walk(a, fn));
      break;
    case 'callv':
      walk(n.fn, fn);
      n.args.forEach((a) => walk(a, fn));
      break;
    case 'call':
      n.args.forEach((a) => walk(a, fn));
      break;
    case 'arr':
      n.rows.forEach((r) => r.forEach((c) => walk(c, fn)));
      break;
  }
}

/** Rebuild a tree, letting `fn` replace any node (return undefined to keep and recurse). */
export function mapNode(n: Node, fn: (n: Node) => Node | undefined): Node {
  const r = fn(n);
  if (r) return r;
  switch (n.t) {
    case 'un':
      return { ...n, e: mapNode(n.e, fn) };
    case 'pct':
      return { ...n, e: mapNode(n.e, fn) };
    case 'bin':
      return { ...n, l: mapNode(n.l, fn), r: mapNode(n.r, fn) };
    case 'rangeop':
    case 'isect':
      return { ...n, l: mapNode(n.l, fn), r: mapNode(n.r, fn) };
    case 'implicit':
      return { ...n, e: mapNode(n.e, fn) };
    case 'union':
      return { ...n, parts: n.parts.map((a) => mapNode(a, fn)) };
    case 'callv':
      return { ...n, fn: mapNode(n.fn, fn), args: n.args.map((a) => mapNode(a, fn)) };
    case 'call':
      return { ...n, args: n.args.map((a) => mapNode(a, fn)) };
    case 'arr':
      return { ...n, rows: n.rows.map((row) => row.map((c) => mapNode(c, fn))) };
    default:
      return n;
  }
}

const ERR_REF: Node = { t: 'err', v: E.REF };

function shiftAddr(a: CellAddr, dRow: number, dCol: number): CellAddr | null {
  const row = a.absRow ? a.row : a.row + dRow;
  const col = a.absCol ? a.col : a.col + dCol;
  if (row < 0 || row >= MAX_ROWS || col < 0 || col >= MAX_COLS) return null;
  return { ...a, row, col };
}

/** Relative-reference shift used by copy/paste and fill. Out-of-grid results become #REF!. */
export function shiftRefs(n: Node, dRow: number, dCol: number): Node {
  return mapNode(n, (x) => {
    if (x.t === 'ref') {
      const a = shiftAddr(x.a, dRow, dCol);
      return a ? { ...x, a } : ERR_REF;
    }
    if (x.t === 'range') {
      // Whole-column/row ranges only move along their free axis.
      const a = shiftAddr(x.a, x.whole === 'col' ? 0 : dRow, x.whole === 'row' ? 0 : dCol);
      const b = shiftAddr(x.b, x.whole === 'col' ? 0 : dRow, x.whole === 'row' ? 0 : dCol);
      return a && b ? { ...x, a, b } : ERR_REF;
    }
    return undefined;
  });
}

export function renameSheetRefs(n: Node, oldName: string, newName: string): Node {
  const same = (s?: string) => s !== undefined && s.toLowerCase() === oldName.toLowerCase();
  return mapNode(n, (x) => {
    if ((x.t === 'ref' || x.t === 'range') && (same(x.sheet) || same(x.sheetEnd))) return { ...x, sheet: same(x.sheet) ? newName : x.sheet, sheetEnd: same(x.sheetEnd) ? newName : x.sheetEnd };
    return undefined;
  });
}

export interface StructureChange {
  /** Sheet whose rows/columns change. */
  sheet: string;
  axis: 'row' | 'col';
  /** First affected index. */
  index: number;
  /** > 0 inserts that many; < 0 deletes that many. */
  count: number;
}

function adjustIndex(v: number, ch: StructureChange): number | null {
  if (ch.count > 0) return v >= ch.index ? v + ch.count : v;
  const n = -ch.count;
  if (v < ch.index) return v;
  if (v >= ch.index + n) return v - n;
  return null; // inside the deleted band
}

/**
 * Update references after rows/columns are inserted or deleted.
 * `formulaSheet` is the sheet that owns the formula (to resolve unqualified refs).
 */
export function adjustForStructure(n: Node, formulaSheet: string, ch: StructureChange): Node {
  const targets = (s?: string, end?: string) => (s ?? formulaSheet).toLowerCase() === ch.sheet.toLowerCase() || end?.toLowerCase() === ch.sheet.toLowerCase();
  const key = ch.axis === 'row' ? 'row' : 'col';
  return mapNode(n, (x) => {
    if (x.t === 'ref' && targets(x.sheet, x.sheetEnd)) {
      const v = adjustIndex(x.a[key], ch);
      return v === null ? ERR_REF : { ...x, a: { ...x.a, [key]: v } };
    }
    if (x.t === 'range' && targets(x.sheet, x.sheetEnd)) {
      const lo = x.a[key];
      const hi = x.b[key];
      const whole = ch.axis === 'row' ? x.whole === 'col' : x.whole === 'row';
      if (whole) return undefined; // spans the whole axis
      if (ch.count > 0) {
        const nlo = lo >= ch.index ? lo + ch.count : lo;
        const nhi = hi >= ch.index ? hi + ch.count : hi;
        return { ...x, a: { ...x.a, [key]: nlo }, b: { ...x.b, [key]: nhi } };
      }
      const delLo = ch.index;
      const delHi = ch.index - ch.count - 1;
      if (lo >= delLo && hi <= delHi) return ERR_REF;
      const nlo = lo > delHi ? lo + ch.count : lo >= delLo ? delLo : lo;
      const nhi = hi > delHi ? hi + ch.count : hi >= delLo ? delLo - 1 : hi;
      return { ...x, a: { ...x.a, [key]: nlo }, b: { ...x.b, [key]: nhi } };
    }
    return undefined;
  });
}
