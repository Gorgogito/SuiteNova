import { basic } from '@suitenova/base-core';
import {
  E,
  MAX_COLS,
  MAX_ROWS,
  formatA1,
  isDateFormat,
  isErr,
  normRect,
  parseA1,
  type ArrayLikeValue,
  type Rect,
  type Scalar,
  type Style,
  type Value,
} from '@suitenova/calc-engine';
import type { CalcDoc } from './doc';
import { msgBox } from '../base/runtime';

type BVal = basic.BVal;
type BObject = basic.BObject;
const { BasicError, VArray, toStr, toNum, toBool, fromSerial, toSerial, NOTHING } = basic;

export interface MacroRun {
  ok: boolean;
  error?: string;
  at?: { module: string; line: number };
  value?: BVal;
}

const noMember = (m: string): never => {
  throw new BasicError(438, `El objeto no admite la propiedad o el método: ${m}`);
};

// ---------------------------------------------------------------------------------------------------- conversions
const bgrToHex = (n: number): string => {
  const v = Math.max(0, Math.trunc(n)) & 0xffffff;
  const r = v & 255;
  const g = (v >> 8) & 255;
  const b = (v >> 16) & 255;
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
};
const hexToBgr = (hex: string | undefined, dflt: number): number => {
  const m = hex ? /^#?([0-9a-f]{6})$/i.exec(hex) : null;
  if (!m) return dflt;
  const n = parseInt(m[1]!, 16);
  return ((n >> 16) & 255) | (n & 0xff00) | ((n & 255) << 16);
};

const HALIGN: Record<number, 'left' | 'center' | 'right' | undefined> = { [-4131]: 'left', [-4108]: 'center', [-4152]: 'right', 1: undefined };

export const EXCEL_CONSTANTS: Record<string, number> = {
  xlup: -4162, xldown: -4121, xltoleft: -4159, xltoright: -4161,
  xlleft: -4131, xlright: -4152, xlcenter: -4108, xlgeneral: 1, xltop: -4160, xlbottom: -4107,
  xlcalculationautomatic: -4105, xlcalculationmanual: -4135, xlcalculationsemiautomatic: 2,
  xlyes: 1, xlno: 2, xlascending: 1, xldescending: 2, xlpastevalues: -4163, xlpasteall: -4104, xlpasteformats: -4122, xlpasteformulas: -4123,
  xlvalues: -4163, xlformulas: -4123, xlwhole: 1, xlpart: 2, xlsheetvisible: -1, xlsheethidden: 0, xlsheetveryhidden: 2,
  xlcontinuous: 1, xlthin: 2, xlmedium: -4138, xlthick: 4, xlsolid: 1, xlnone: -4142, xlautomatic: -4105,
  vbblack: 0, vbred: 255, vbgreen: 65280, vbblue: 16711680, vbyellow: 65535, vbwhite: 16777215, vbmagenta: 16711935, vbcyan: 16776960,
};

/** A cell's value the way a macro sees it: dates are Dates, an empty cell is Empty, an error is its text. */
function cellToB(doc: CalcDoc, sheetId: number, row: number, col: number): BVal {
  const c = doc.wb.getCell(sheetId, row, col);
  const v = c?.value ?? null;
  if (v === null) return undefined;
  if (isErr(v)) return v.code;
  if (typeof v === 'number' && isDateFormat(doc.wb.styles.get(c?.style ?? 0).numFmt)) return fromSerial(v);
  return v;
}

function bToInput(v: BVal): string | null {
  if (v === undefined || v === null) return '';
  if (v instanceof Date) return null;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  return null;
}

class Fail extends BasicError {
  constructor(message: string) {
    super(1004, message);
  }
}

// ---------------------------------------------------------------------------------------------------- runtime
/** Runs the macros of a workbook: Nova Basic with the objects of a spreadsheet (Range, Cells, Worksheets…). */
export class CalcRuntime {
  console: string[] = [];
  limits: Partial<basic.Limits> = {};
  private interp: basic.Interpreter | null = null;
  private key = '';
  private errors: { module: string; line: number; message: string }[] = [];
  /** While a worksheet function runs, cells cannot be changed. */
  private readOnly = 0;
  private depth = 0;
  /** Patches of the run in progress (one undo step for the whole macro). */
  private patches: ReturnType<CalcDoc['wb']['setInput']>[] | null = null;
  lastAt: { module: string; line: number } | undefined;

  constructor(readonly doc: CalcDoc) {}

  print = (text: string): void => {
    this.console.push(text);
    if (this.console.length > 2000) this.console.splice(0, this.console.length - 2000);
    this.doc.touch();
  };
  clearConsole(): void {
    this.console = [];
    this.doc.touch();
  }

  get modules(): { name: string; code: string }[] {
    return this.doc.wb.macros;
  }

  static check(name: string, code: string): { line: number; message: string }[] {
    try {
      basic.parseModule(name, code);
      return [];
    } catch (e) {
      if (e instanceof basic.BasicSyntaxError) return [{ line: e.line, message: e.message }];
      throw e;
    }
  }

  private hooks(): basic.HostHooks {
    return {
      print: this.print,
      msgBox: (p, b, t) => msgBox(p, b, t),
      inputBox: (p, t, d) => (typeof window.prompt === 'function' ? window.prompt(`${t}\n\n${p}`, d) : null),
      objects: { ...EXCEL_CONSTANTS, ...this.objects() },
      functions: {
        rgb: (a) => (Math.trunc(toNum(a[0])) & 255) | ((Math.trunc(toNum(a[1])) & 255) << 8) | ((Math.trunc(toNum(a[2])) & 255) << 16),
      },
    };
  }

  load(force = false): { module: string; line: number; message: string }[] {
    const key = JSON.stringify(this.modules);
    if (!force && this.interp && key === this.key) return this.errors;
    this.interp = new basic.Interpreter(this.hooks(), this.limits);
    this.errors = this.interp.load(this.modules.map((m) => ({ name: m.name, source: m.code }))).map((e) => ({ module: e.module, line: e.line, message: e.message }));
    this.key = key;
    return this.errors;
  }

  procedures(): basic.ProcInfo[] {
    this.load();
    return this.interp?.procedures() ?? [];
  }

  hasProcedure(name: string): boolean {
    this.load();
    return !this.errors.length && !!this.interp?.hasProcedure(name);
  }

  private report(e: unknown): MacroRun {
    if (e instanceof basic.BasicError) return { ok: false, error: e.full, at: e.module && e.line ? { module: e.module, line: e.line } : undefined };
    if (e instanceof basic.AbortRun) return { ok: false, error: e.message };
    if (e instanceof basic.BasicSyntaxError) return { ok: false, error: `Error de sintaxis, línea ${e.line}: ${e.message}`, at: { module: 'Inmediato', line: e.line } };
    return { ok: false, error: (e as Error).message };
  }

  /** Run a procedure; everything it writes to the sheets is one undoable step. */
  run(name: string, args: BVal[] = []): MacroRun {
    this.lastAt = undefined;
    if (!this.doc.contentEnabled) return { ok: false, error: 'El contenido activo está deshabilitado en este archivo.' };
    const errors = this.load();
    if (errors.length) {
      this.lastAt = { module: errors[0]!.module, line: errors[0]!.line };
      return { ok: false, error: `Hay errores de sintaxis: ${errors.map((e) => `${e.module}, línea ${e.line}: ${e.message}`).join(' · ')}`, at: this.lastAt };
    }
    if (!this.interp!.hasProcedure(name)) return { ok: false, error: `No existe el procedimiento "${name}".` };
    return this.guarded(() => ({ ok: true, value: this.interp!.call(name, args) }));
  }

  immediate(src: string): MacroRun {
    if (!this.doc.contentEnabled) return { ok: false, error: 'El contenido activo está deshabilitado en este archivo.' };
    this.load();
    return this.guarded(() => {
      this.interp!.immediate(src);
      return { ok: true };
    });
  }

  private guarded(fn: () => MacroRun): MacroRun {
    if (++this.depth > 20) {
      this.depth--;
      return { ok: false, error: 'Demasiadas llamadas anidadas.' };
    }
    const outer = this.patches === null;
    if (outer) this.patches = [];
    let result: MacroRun;
    try {
      result = fn();
    } catch (e) {
      result = this.report(e);
      this.lastAt = result.at;
    } finally {
      this.depth--;
    }
    if (outer) {
      const done = this.patches!;
      this.patches = null;
      // whatever the macro changed is one step in the history, even if it stopped with an error
      if (done.some((p) => p.length)) this.doc.run('Ejecutar macro', () => done);
      this.doc.touch();
    }
    return result;
  }

  /** The workbook; while a worksheet function runs, anything that would change it throws before touching it. */
  workbook(): CalcDoc['wb'] {
    const wb = this.doc.wb;
    if (!this.readOnly) return wb;
    return new Proxy(wb, {
      get: (t, p, rcv) => {
        const v = Reflect.get(t, p, rcv);
        if (typeof v !== 'function' || typeof p !== 'string') return v;
        if (/^(set|format|clear|shift|edit|insert|delete|remove|add|merge|sort|fill|rename|move|copy|paste|transact|apply)/.test(p)) {
          return () => {
            throw new Fail('Una función de hoja de cálculo no puede cambiar celdas.');
          };
        }
        return v.bind(t);
      },
    });
  }

  /** The patches of a write, kept for the undo step of the macro. */
  record(patch: ReturnType<CalcDoc['wb']['setInput']>): void {
    if (this.readOnly) throw new Fail('Una función de hoja de cálculo no puede cambiar celdas.');
    this.patches?.push(patch);
  }

  /** Worksheet_Change(Target): runs after the user types in a cell. */
  onChange(sheetId: number, row: number, col: number): void {
    if (!this.doc.contentEnabled || !this.modules.length || this.depth > 0) return;
    if (!this.hasProcedure('Worksheet_Change')) return;
    const r = this.run('Worksheet_Change', [new RangeObj(this, sheetId, { r1: row, c1: col, r2: row, c2: col })]);
    if (!r.ok) this.doc.setNotice(r.error ?? null);
  }

  // ---- user-defined functions: =MiFuncion(A1)
  userFunction = (name: string, args: Value[]): Value | undefined => {
    if (!this.doc.contentEnabled || !this.modules.length) return undefined;
    const errors = this.load();
    if (errors.length || !this.interp!.hasProcedure(name)) return undefined;
    const proc = this.interp!.procedures().find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!proc || proc.kind !== 'function' || !proc.isPublic) return undefined;
    const toArg = (v: Value): BVal => {
      if (typeof v === 'object' && v !== null && !(v instanceof Date) && 'kind' in v) {
        if (v.kind === 'range') {
          const sh = v.sheetId;
          const rect = this.doc.wb.clip(v);
          return rect.r1 === rect.r2 && rect.c1 === rect.c2 ? new RangeObj(this, sh, { r1: v.r1, c1: v.c1, r2: v.r2, c2: v.c2 }) : new RangeObj(this, sh, { r1: v.r1, c1: v.c1, r2: v.r2, c2: v.c2 });
        }
        if (v.kind === 'array') return matrixToVArray(v.rows);
        return undefined;
      }
      if (isErr(v as Scalar)) return (v as { code: string }).code;
      return v === null ? undefined : (v as BVal);
    };
    this.readOnly++;
    try {
      const out = this.interp!.call(name, args.map(toArg));
      return fromB(out);
    } catch (e) {
      const r = this.report(e);
      this.print(`#VALOR! en ${name}: ${r.error}`);
      return E.VALUE;
    } finally {
      this.readOnly--;
    }
  };

  // ---- the objects
  private objects(): Record<string, BVal> {
    const rt = this;
    const app = new AppObj(rt);
    const active = (): RangeObj => new RangeObj(rt, rt.doc.activeSheetId, { ...normRect(rt.doc.sel.active ? { r1: rt.doc.sel.active.row, c1: rt.doc.sel.active.col, r2: rt.doc.sel.active.row, c2: rt.doc.sel.active.col } : { r1: 0, c1: 0, r2: 0, c2: 0 }) });
    void active;
    const wsObj = (): SheetObj => new SheetObj(rt, rt.doc.activeSheetId);
    const proxy = (make: () => BObject, typeName: string): BObject => ({
      typeName,
      get: (m, a) => make().get(m, a),
      set: (m, a, v) => make().set(m, a, v),
      index: (a) => (make().index ? make().index!(a) : undefined),
      setIndex: (a, v) => make().setIndex?.(a, v),
      items: () => make().items?.() ?? [],
    });
    return {
      application: app,
      activesheet: proxy(wsObj, 'Worksheet'),
      activecell: proxy(() => new RangeObj(rt, rt.doc.activeSheetId, { r1: rt.doc.sel.active.row, c1: rt.doc.sel.active.col, r2: rt.doc.sel.active.row, c2: rt.doc.sel.active.col }), 'Range'),
      selection: proxy(() => new RangeObj(rt, rt.doc.activeSheetId, normRect(rt.doc.activeRange)), 'Range'),
      range: proxy(() => new RangeFactory(rt, 'range'), 'Range'),
      cells: proxy(() => new RangeFactory(rt, 'cells'), 'Range'),
      rows: proxy(() => new RangeFactory(rt, 'rows'), 'Range'),
      columns: proxy(() => new RangeFactory(rt, 'columns'), 'Range'),
      worksheets: new SheetsObj(rt),
      sheets: new SheetsObj(rt),
      thisworkbook: new WorkbookObj(rt),
      activeworkbook: new WorkbookObj(rt),
      worksheetfunction: new WorksheetFunctionObj(rt),
    };
  }
}

// ---------------------------------------------------------------------------------------------------- arrays
function matrixToVArray(rows: Scalar[][]): basic.VArray {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const a = new VArray([{ lo: 1, hi: h }, { lo: 1, hi: w }]);
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      const v = rows[i]![j]!;
      a.set([i + 1, j + 1], isErr(v) ? v.code : (v ?? undefined));
    }
  }
  return a;
}

function fromB(v: BVal): Value {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return toSerial(v);
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (v instanceof VArray) {
    if (v.dims.length === 2) {
      const rows: Scalar[][] = [];
      for (let i = v.dims[0]!.lo; i <= v.dims[0]!.hi; i++) {
        const r: Scalar[] = [];
        for (let j = v.dims[1]!.lo; j <= v.dims[1]!.hi; j++) r.push(fromB(v.get([i, j])) as Scalar);
        rows.push(r);
      }
      return { kind: 'array', rows };
    }
    return { kind: 'array', rows: [v.data.map((x) => fromB(x) as Scalar)] };
  }
  if (typeof v === 'object' && v !== NOTHING && 'typeName' in v && v.typeName === 'Range') {
    const r = v as unknown as RangeObj;
    return { kind: 'range', sheetId: r.sheetId, ...r.rect };
  }
  return E.VALUE;
}

// ---------------------------------------------------------------------------------------------------- Range
class RangeObj implements BObject {
  readonly typeName = 'Range';
  constructor(
    readonly rt: CalcRuntime,
    readonly sheetId: number,
    readonly rect: Rect,
  ) {}

  private get doc() {
    return this.rt.doc;
  }
  private get wb() {
    return this.rt.workbook();
  }
  private get single(): boolean {
    return this.rect.r1 === this.rect.r2 && this.rect.c1 === this.rect.c2;
  }
  private sub(r: Rect): RangeObj {
    if (r.r1 < 0 || r.c1 < 0 || r.r2 >= MAX_ROWS || r.c2 >= MAX_COLS) throw new Fail('La referencia queda fuera de la hoja.');
    return new RangeObj(this.rt, this.sheetId, r);
  }
  private cellsOf(): { row: number; col: number }[] {
    const out: { row: number; col: number }[] = [];
    const sheet = this.wb.sheet(this.sheetId);
    const r2 = Math.min(this.rect.r2, Math.max(this.rect.r1, sheet.maxRow));
    const c2 = Math.min(this.rect.c2, Math.max(this.rect.c1, sheet.maxCol));
    for (let r = this.rect.r1; r <= r2; r++) for (let c = this.rect.c1; c <= c2; c++) out.push({ row: r, col: c });
    return out;
  }
  private readValue(): BVal {
    if (this.single) return cellToB(this.doc, this.sheetId, this.rect.r1, this.rect.c1);
    const rows = this.rect.r2 - this.rect.r1 + 1;
    const cols = this.rect.c2 - this.rect.c1 + 1;
    if (rows * cols > 1_000_000) throw new Fail('El rango es demasiado grande para leerlo de una vez.');
    const a = new VArray([{ lo: 1, hi: rows }, { lo: 1, hi: cols }]);
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) a.set([i + 1, j + 1], cellToB(this.doc, this.sheetId, this.rect.r1 + i, this.rect.c1 + j));
    return a;
  }
  private writeCell(row: number, col: number, v: BVal, asFormula = false): void {
    if (v instanceof VArray || (typeof v === 'object' && v !== null && !(v instanceof Date))) throw new Fail('Tipo de valor no válido para una celda.');
    const sheetId = this.sheetId;
    if (this.doc.blockedByPivot([{ r1: row, c1: col, r2: row, c2: col }], sheetId)) throw new Fail('No se puede cambiar esta parte de una tabla dinámica.');
    if (v instanceof Date) {
      const style = this.wb.getCell(sheetId, row, col)?.style ?? 0;
      const withFmt = isDateFormat(this.wb.styles.get(style).numFmt) ? style : this.wb.styles.derive(style, { numFmt: 'dd/mm/yyyy' });
      this.rt.record(this.wb.setCell(sheetId, row, col, { value: toSerial(v), style: withFmt }));
      return;
    }
    const text = bToInput(v) ?? '';
    // text that starts with "=" is a formula; the rest is read as typed
    this.rt.record(this.wb.setInput(sheetId, row, col, asFormula && !text.startsWith('=') && text !== '' ? `=${text}` : text));
  }
  private writeValue(v: BVal, asFormula = false): void {
    if (v instanceof VArray) {
      if (v.dims.length === 1) {
        const lo = v.dims[0]!.lo;
        const n = v.dims[0]!.hi - lo + 1;
        for (let k = 0; k < n; k++) this.writeCell(this.rect.r1, this.rect.c1 + k, v.get([lo + k]), asFormula);
        return;
      }
      const d0 = v.dims[0]!;
      const d1 = v.dims[1]!;
      for (let i = 0; i <= d0.hi - d0.lo; i++) for (let j = 0; j <= d1.hi - d1.lo; j++) this.writeCell(this.rect.r1 + i, this.rect.c1 + j, v.get([d0.lo + i, d1.lo + j]), asFormula);
      return;
    }
    for (let r = this.rect.r1; r <= this.rect.r2; r++) for (let c = this.rect.c1; c <= this.rect.c2; c++) this.writeCell(r, c, v, asFormula);
  }
  private style(patch: Partial<Record<keyof Style, unknown>>): void {
    this.rt.record(this.wb.formatRange(this.sheetId, this.rect, patch));
  }
  private firstStyle(): Style {
    return this.wb.getStyle(this.sheetId, this.rect.r1, this.rect.c1);
  }
  private address(rowAbs = true, colAbs = true, external = false): string {
    const a = formatA1(this.rect.r1, this.rect.c1, rowAbs, colAbs);
    const text = this.single ? a : `${a}:${formatA1(this.rect.r2, this.rect.c2, rowAbs, colAbs)}`;
    return external ? `[${this.doc.fileName ?? 'Libro1'}]${this.wb.sheet(this.sheetId).name}!${text}` : text;
  }
  private target(v: BVal): RangeObj {
    if (v instanceof RangeObj) return v;
    throw new Fail('Se esperaba un rango.');
  }

  get(member: string, args: BVal[]): BVal {
    const m = member.toLowerCase();
    const n = (i: number, d = 0) => (args[i] === undefined || args[i] === null ? d : Math.trunc(toNum(args[i])));
    switch (m) {
      case 'value':
      case 'value2':
        return this.readValue();
      case 'formula':
      case 'formulalocal': {
        if (!this.single) return undefined;
        const t = this.wb.getInputText(this.sheetId, this.rect.r1, this.rect.c1);
        return t;
      }
      case 'text':
        return this.doc.display(this.sheetId, this.rect.r1, this.rect.c1).text;
      case 'address':
        return this.address(args[0] === undefined ? true : toBool(args[0]), args[1] === undefined ? true : toBool(args[1]), args[3] !== undefined && toBool(args[3]));
      case 'row':
        return this.rect.r1 + 1;
      case 'column':
        return this.rect.c1 + 1;
      case 'count':
        return (this.rect.r2 - this.rect.r1 + 1) * (this.rect.c2 - this.rect.c1 + 1);
      case 'rows':
        return new RangeSlices(this, 'rows');
      case 'columns':
        return new RangeSlices(this, 'columns');
      case 'cells':
        return args.length ? this.index(args) : new RangeSlices(this, 'cells');
      case 'range':
        return this.index(args);
      case 'item':
        return this.index(args);
      case 'offset':
        return this.sub({ r1: this.rect.r1 + n(0), c1: this.rect.c1 + n(1), r2: this.rect.r2 + n(0), c2: this.rect.c2 + n(1) });
      case 'resize': {
        const rows = args[0] === undefined ? this.rect.r2 - this.rect.r1 + 1 : n(0);
        const cols = args[1] === undefined ? this.rect.c2 - this.rect.c1 + 1 : n(1);
        if (rows < 1 || cols < 1) throw new Fail('El tamaño no es válido.');
        return this.sub({ r1: this.rect.r1, c1: this.rect.c1, r2: this.rect.r1 + rows - 1, c2: this.rect.c1 + cols - 1 });
      }
      case 'end': {
        const dir = n(0);
        const sheet = this.wb.sheet(this.sheetId);
        const filled = (r: number, c: number) => {
          const cell = sheet.cells.get(r * MAX_COLS + c);
          return !!cell && (cell.value !== null || !!cell.formula);
        };
        let r = this.rect.r1;
        let c = this.rect.c1;
        const [dr, dc] = dir === -4162 ? [-1, 0] : dir === -4121 ? [1, 0] : dir === -4159 ? [0, -1] : [0, 1];
        const inside = (rr: number, cc: number) => rr >= 0 && cc >= 0 && rr < MAX_ROWS && cc < MAX_COLS;
        if (filled(r, c) && inside(r + dr, c + dc) && filled(r + dr, c + dc)) {
          while (inside(r + dr, c + dc) && filled(r + dr, c + dc)) {
            r += dr;
            c += dc;
          }
        } else {
          r += dr;
          c += dc;
          while (inside(r, c) && !filled(r, c) && r <= sheet.maxRow + 1 && c <= sheet.maxCol + 1 && r >= 0 && c >= 0) {
            r += dr;
            c += dc;
          }
          if (!inside(r, c) || r > sheet.maxRow || c > sheet.maxCol) {
            r = dr > 0 ? MAX_ROWS - 1 : dr < 0 ? 0 : r;
            c = dc > 0 ? MAX_COLS - 1 : dc < 0 ? 0 : c;
            if (dr > 0 && sheet.maxRow >= 0 && !filled(sheet.maxRow, this.rect.c1)) r = Math.min(MAX_ROWS - 1, MAX_ROWS - 1);
          }
        }
        return this.sub({ r1: r, c1: c, r2: r, c2: c });
      }
      case 'currentregion': {
        this.doc.selectCell(this.rect.r1, this.rect.c1);
        const b = this.doc.usedBlock();
        return this.sub(b ?? this.rect);
      }
      case 'entirerow':
        return this.sub({ r1: this.rect.r1, r2: this.rect.r2, c1: 0, c2: MAX_COLS - 1 });
      case 'entirecolumn':
        return this.sub({ c1: this.rect.c1, c2: this.rect.c2, r1: 0, r2: MAX_ROWS - 1 });
      case 'parent':
        return new SheetObj(this.rt, this.sheetId);
      case 'worksheet':
        return new SheetObj(this.rt, this.sheetId);
      case 'font':
        return new FontObj(this);
      case 'interior':
        return new InteriorObj(this);
      case 'numberformat':
      case 'numberformatlocal':
        return this.firstStyle().numFmt ?? 'General';
      case 'horizontalalignment': {
        const h = this.firstStyle().hAlign;
        return h === 'left' ? -4131 : h === 'center' ? -4108 : h === 'right' ? -4152 : 1;
      }
      case 'wraptext':
        return !!this.firstStyle().wrap;
      case 'columnwidth':
        return (this.wb.colWidth(this.sheetId, this.rect.c1) - 5) / 7;
      case 'rowheight':
        return (this.wb.rowHeight(this.sheetId, this.rect.r1) * 72) / 96;
      case 'hidden':
        return this.wb.sheet(this.sheetId).hiddenRows.has(this.rect.r1) || this.wb.sheet(this.sheetId).hiddenCols.has(this.rect.c1);
      case 'mergecells':
        return this.wb.sheet(this.sheetId).merges.some((x) => x.r1 === this.rect.r1 && x.c1 === this.rect.c1);
      case 'hasformula':
        return !!this.wb.getCell(this.sheetId, this.rect.r1, this.rect.c1)?.formula;
      case 'name':
        return undefined;
      case 'select':
      case 'activate':
        this.doc.activateSheet(this.sheetId);
        this.doc.selectRange(this.rect);
        return undefined;
      case 'clear':
      case 'clearcontents':
      case 'clearformats': {
        if (this.doc.blockedByPivot([this.rect], this.sheetId)) throw new Fail('No se puede cambiar esta parte de una tabla dinámica.');
        this.rt.record(this.wb.clear(this.sheetId, this.rect, m === 'clear' ? 'all' : m === 'clearcontents' ? 'contents' : 'formats'));
        return undefined;
      }
      case 'delete': {
        const whole = this.rect.c1 === 0 && this.rect.c2 === MAX_COLS - 1 ? 'row' : this.rect.r1 === 0 && this.rect.r2 === MAX_ROWS - 1 ? 'col' : null;
        if (whole === 'row') this.rt.record(this.wb.shiftStructure(this.sheetId, 'row', this.rect.r1, -(this.rect.r2 - this.rect.r1 + 1)));
        else if (whole === 'col') this.rt.record(this.wb.shiftStructure(this.sheetId, 'col', this.rect.c1, -(this.rect.c2 - this.rect.c1 + 1)));
        else this.rt.record(this.wb.clear(this.sheetId, this.rect, 'all'));
        return undefined;
      }
      case 'insert': {
        const whole = this.rect.c1 === 0 && this.rect.c2 === MAX_COLS - 1 ? 'row' : this.rect.r1 === 0 && this.rect.r2 === MAX_ROWS - 1 ? 'col' : 'row';
        if (whole === 'row') this.rt.record(this.wb.shiftStructure(this.sheetId, 'row', this.rect.r1, this.rect.r2 - this.rect.r1 + 1));
        else this.rt.record(this.wb.shiftStructure(this.sheetId, 'col', this.rect.c1, this.rect.c2 - this.rect.c1 + 1));
        return undefined;
      }
      case 'merge':
        this.doc.activateSheet(this.sheetId);
        this.doc.selectRange(this.rect);
        this.doc.merge(false);
        return undefined;
      case 'unmerge':
        this.doc.activateSheet(this.sheetId);
        this.doc.selectRange(this.rect);
        this.doc.unmerge();
        return undefined;
      case 'autofit':
        this.doc.activateSheet(this.sheetId);
        this.doc.selectRange(this.rect);
        this.doc.autoFitColumns();
        return undefined;
      case 'copy':
      case 'cut': {
        this.doc.activateSheet(this.sheetId);
        this.doc.selectRange(this.rect);
        this.doc.copy(m === 'cut');
        const dest = args[0];
        if (dest instanceof RangeObj) {
          this.doc.activateSheet(dest.sheetId);
          this.doc.selectCell(dest.rect.r1, dest.rect.c1);
          const err = this.doc.paste(null, 'all');
          if (err) throw new Fail(err);
        }
        return undefined;
      }
      case 'pastespecial': {
        const kind = args[0] === undefined ? -4104 : n(0);
        const mode = kind === -4163 ? 'values' : kind === -4123 ? 'formulas' : kind === -4122 ? 'formats' : 'all';
        this.doc.activateSheet(this.sheetId);
        this.doc.selectCell(this.rect.r1, this.rect.c1);
        const err = this.doc.paste(null, mode);
        if (err) throw new Fail(err);
        return undefined;
      }
      case 'addcomment':
        this.doc.x.saveComment(this.rect.r1, this.rect.c1, toStr(args[0]), 'Macro');
        return undefined;
      case 'clearcomments':
        this.doc.x.deleteComments(this.rect);
        return undefined;
      case 'calculate':
        this.wb.recalcAll();
        return undefined;
      case 'find':
      case 'sort':
        throw new BasicError(438, `El método ${member} no está disponible todavía en las macros de Nova Calc.`);
      default:
        return noMember(member);
    }
  }

  set(member: string, _args: BVal[], v: BVal): void {
    const m = member.toLowerCase();
    switch (m) {
      case 'value':
      case 'value2':
        return this.writeValue(v);
      case 'formula':
      case 'formulalocal':
        return this.writeValue(v, true);
      case 'numberformat':
      case 'numberformatlocal':
        return this.style({ numFmt: toStr(v) === 'General' ? undefined : toStr(v) });
      case 'horizontalalignment':
        return this.style({ hAlign: HALIGN[Math.trunc(toNum(v))] });
      case 'wraptext':
        return this.style({ wrap: toBool(v) || undefined });
      case 'columnwidth':
        this.rt.record(this.wb.editLayout(this.sheetId, (s) => {
          for (let c = this.rect.c1; c <= this.rect.c2; c++) s.colWidths.set(c, toNum(v) * 7 + 5);
        }));
        return;
      case 'rowheight':
        this.rt.record(this.wb.editLayout(this.sheetId, (s) => {
          for (let r = this.rect.r1; r <= this.rect.r2; r++) s.rowHeights.set(r, (toNum(v) * 96) / 72);
        }));
        return;
      case 'hidden':
        this.rt.record(this.wb.editLayout(this.sheetId, (s) => {
          if (this.rect.c1 === 0 && this.rect.c2 === MAX_COLS - 1) for (let r = this.rect.r1; r <= this.rect.r2; r++) (toBool(v) ? s.hiddenRows.add(r) : s.hiddenRows.delete(r));
          else for (let c = this.rect.c1; c <= this.rect.c2; c++) (toBool(v) ? s.hiddenCols.add(c) : s.hiddenCols.delete(c));
        }));
        return;
      default:
        noMember(member);
    }
  }

  /** Range(Cells(1,1), Cells(3,3)) and Range("A1:B2") on an existing range: cells relative to this range. */
  index(args: BVal[]): BVal {
    if (args.length === 0) return this.readValue();
    if (args.length === 1 && typeof args[0] === 'string') {
      const r = parseRef(args[0]);
      if (!r) throw new Fail(`La referencia "${args[0]}" no es válida.`);
      return this.sub({ r1: this.rect.r1 + r.r1, c1: this.rect.c1 + r.c1, r2: this.rect.r1 + r.r2, c2: this.rect.c1 + r.c2 });
    }
    if (args.length === 1) {
      // Item(i): the i-th cell of the range, counting along rows
      const i = Math.trunc(toNum(args[0])) - 1;
      const w = this.rect.c2 - this.rect.c1 + 1;
      return this.sub({ r1: this.rect.r1 + Math.floor(i / w), c1: this.rect.c1 + (i % w), r2: this.rect.r1 + Math.floor(i / w), c2: this.rect.c1 + (i % w) });
    }
    const r = Math.trunc(toNum(args[0])) - 1;
    const c = Math.trunc(toNum(args[1])) - 1;
    return this.sub({ r1: this.rect.r1 + r, c1: this.rect.c1 + c, r2: this.rect.r1 + r, c2: this.rect.c1 + c });
  }
  setIndex(args: BVal[], v: BVal): void {
    (this.index(args) as RangeObj).writeValue(v);
  }
  items(): BVal[] {
    return this.cellsOf().map((c) => new RangeObj(this.rt, this.sheetId, { r1: c.row, c1: c.col, r2: c.row, c2: c.col }));
  }
  // exposed for sibling classes
  styleOf(): Style {
    return this.firstStyle();
  }
  applyStyle(patch: Partial<Record<keyof Style, unknown>>): void {
    this.style(patch);
  }
  targetOf(v: BVal): RangeObj {
    return this.target(v);
  }
}

function parseRef(text: string): Rect | null {
  const t = text.replace(/\$/g, '');
  const [a, b] = t.split(':');
  const p = parseA1((a ?? '').toUpperCase());
  const q = parseA1((b ?? a ?? '').toUpperCase());
  if (!p || !q) return null;
  return normRect({ r1: p.row, c1: p.col, r2: q.row, c2: q.col });
}

/** Rows, Columns and Cells of a range: they count, can be indexed, and iterate. */
class RangeSlices implements BObject {
  readonly typeName = 'Range';
  constructor(
    private r: RangeObj,
    private kind: 'rows' | 'columns' | 'cells',
  ) {}
  get(member: string, args: BVal[]): BVal {
    const m = member.toLowerCase();
    const rect = this.r.rect;
    if (m === 'count') return this.kind === 'rows' ? rect.r2 - rect.r1 + 1 : this.kind === 'columns' ? rect.c2 - rect.c1 + 1 : (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);
    if (m === 'item') return this.index(args);
    // anything else is a property of the whole range (Rows.Hidden, Columns.AutoFit, Cells.Clear…)
    return this.r.get(member, args);
  }
  set(member: string, args: BVal[], v: BVal): void {
    this.r.set(member, args, v);
  }
  index(args: BVal[]): BVal {
    const rect = this.r.rect;
    const i = Math.trunc(toNum(args[0])) - 1;
    if (this.kind === 'cells') return this.r.index(args);
    if (this.kind === 'rows') return new RangeObj(this.r.rt, this.r.sheetId, { r1: rect.r1 + i, r2: rect.r1 + i, c1: rect.c1, c2: rect.c2 });
    return new RangeObj(this.r.rt, this.r.sheetId, { c1: rect.c1 + i, c2: rect.c1 + i, r1: rect.r1, r2: rect.r2 });
  }
  items(): BVal[] {
    const rect = this.r.rect;
    if (this.kind === 'cells') return this.r.items();
    const n = this.kind === 'rows' ? rect.r2 - rect.r1 + 1 : rect.c2 - rect.c1 + 1;
    return Array.from({ length: n }, (_x, i) => this.index([i + 1]));
  }
}

/** Range("A1"), Cells(2, 3), Rows(5) and Columns("B") on the active sheet (or the sheet they are called on). */
class RangeFactory implements BObject {
  readonly typeName = 'Range';
  constructor(
    private rt: CalcRuntime,
    private kind: 'range' | 'cells' | 'rows' | 'columns',
    private sheetId = rt.doc.activeSheetId,
  ) {}
  private make(r: Rect): RangeObj {
    if (r.r1 < 0 || r.c1 < 0 || r.r2 >= MAX_ROWS || r.c2 >= MAX_COLS) throw new Fail('La referencia queda fuera de la hoja.');
    return new RangeObj(this.rt, this.sheetId, r);
  }
  private whole(): RangeObj {
    return this.make({ r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: MAX_COLS - 1 });
  }
  get(member: string, args: BVal[]): BVal {
    // Cells.Count, Rows.Count, Cells.Clear…: the whole sheet
    if (member.toLowerCase() === 'count') return this.kind === 'rows' ? MAX_ROWS : this.kind === 'columns' ? MAX_COLS : MAX_ROWS * MAX_COLS;
    if (member.toLowerCase() === 'item') return this.index(args);
    return this.whole().get(member, args);
  }
  set(member: string, args: BVal[], v: BVal): void {
    this.whole().set(member, args, v);
  }
  index(args: BVal[]): BVal {
    if (this.kind === 'range') {
      const a = args[0];
      if (a instanceof RangeObj) {
        const b = args[1];
        if (b instanceof RangeObj) return this.make({ r1: Math.min(a.rect.r1, b.rect.r1), c1: Math.min(a.rect.c1, b.rect.c1), r2: Math.max(a.rect.r2, b.rect.r2), c2: Math.max(a.rect.c2, b.rect.c2) });
        return a;
      }
      const text = toStr(a);
      const sheet = /^(?:'([^']+)'|([^!]+))!(.+)$/.exec(text);
      const target = sheet ? this.rt.doc.wb.sheetByName(sheet[1] ?? sheet[2]!) : null;
      const ref = parseRef(sheet ? sheet[3]! : text);
      if (!ref) {
        const name = this.rt.doc.wb.definedName(text, this.sheetId);
        if (name && (name.t === 'ref' || name.t === 'range')) {
          const nb = name.t === 'range' ? name.b : name.a;
          return new RangeObj(this.rt, name.sheet ? (this.rt.doc.wb.sheetByName(name.sheet)?.id ?? this.sheetId) : this.sheetId, normRect({ r1: name.a.row, c1: name.a.col, r2: nb.row, c2: nb.col }));
        }
        throw new Fail(`La referencia "${text}" no es válida.`);
      }
      return new RangeObj(this.rt, target?.id ?? this.sheetId, ref);
    }
    if (this.kind === 'cells') {
      if (args.length === 0) return this.whole();
      const r = Math.trunc(toNum(args[0])) - 1;
      const c = args[1] === undefined ? 0 : typeof args[1] === 'string' ? Math.max(0, (parseA1(`${args[1]}1`.toUpperCase())?.col ?? 0)) : Math.trunc(toNum(args[1])) - 1;
      if (args.length === 1) {
        const i = r;
        return this.make({ r1: Math.floor(i / MAX_COLS), c1: i % MAX_COLS, r2: Math.floor(i / MAX_COLS), c2: i % MAX_COLS });
      }
      return this.make({ r1: r, c1: c, r2: r, c2: c });
    }
    if (this.kind === 'rows') {
      const a = args[0];
      if (typeof a === 'string' && a.includes(':')) {
        const [x, y] = a.split(':');
        return this.make({ r1: Number(x) - 1, r2: Number(y) - 1, c1: 0, c2: MAX_COLS - 1 });
      }
      const r = Math.trunc(toNum(a)) - 1;
      return this.make({ r1: r, r2: r, c1: 0, c2: MAX_COLS - 1 });
    }
    const a = args[0];
    const colOf = (v: BVal) => (typeof v === 'string' ? (parseA1(`${v.toUpperCase()}1`)?.col ?? 0) : Math.trunc(toNum(v)) - 1);
    if (typeof a === 'string' && a.includes(':')) {
      const [x, y] = a.split(':');
      return this.make({ c1: colOf(x), c2: colOf(y), r1: 0, r2: MAX_ROWS - 1 });
    }
    return this.make({ c1: colOf(a), c2: colOf(a), r1: 0, r2: MAX_ROWS - 1 });
  }
  setIndex(args: BVal[], v: BVal): void {
    (this.index(args) as RangeObj).set('value', [], v);
  }
}

class FontObj implements BObject {
  readonly typeName = 'Font';
  constructor(private r: RangeObj) {}
  get(member: string): BVal {
    const s = this.r.styleOf();
    switch (member.toLowerCase()) {
      case 'bold':
        return !!s.bold;
      case 'italic':
        return !!s.italic;
      case 'underline':
        return s.underline ? 2 : -4142;
      case 'strikethrough':
        return !!s.strike;
      case 'size':
        return s.fontSize ?? this.r.rt.doc.wb.defaultFont.size;
      case 'name':
        return s.fontName ?? this.r.rt.doc.wb.defaultFont.name;
      case 'color':
        return hexToBgr(s.color, 0);
    }
    return noMember(member);
  }
  set(member: string, _a: BVal[], v: BVal): void {
    switch (member.toLowerCase()) {
      case 'bold':
        return this.r.applyStyle({ bold: toBool(v) || undefined });
      case 'italic':
        return this.r.applyStyle({ italic: toBool(v) || undefined });
      case 'underline':
        return this.r.applyStyle({ underline: (typeof v === 'boolean' ? v : toNum(v) !== -4142) || undefined });
      case 'strikethrough':
        return this.r.applyStyle({ strike: toBool(v) || undefined });
      case 'size':
        return this.r.applyStyle({ fontSize: toNum(v) });
      case 'name':
        return this.r.applyStyle({ fontName: toStr(v) });
      case 'color':
        return this.r.applyStyle({ color: bgrToHex(toNum(v)) });
    }
    noMember(member);
  }
}

class InteriorObj implements BObject {
  readonly typeName = 'Interior';
  constructor(private r: RangeObj) {}
  get(member: string): BVal {
    if (member.toLowerCase() === 'color') return hexToBgr(this.r.styleOf().bg, 16777215);
    return noMember(member);
  }
  set(member: string, _a: BVal[], v: BVal): void {
    if (member.toLowerCase() === 'color') return this.r.applyStyle({ bg: bgrToHex(toNum(v)) });
    if (member.toLowerCase() === 'pattern' || member.toLowerCase() === 'colorindex') {
      if (member.toLowerCase() === 'colorindex' && toNum(v) === -4142) this.r.applyStyle({ bg: undefined });
      return;
    }
    noMember(member);
  }
}

// ---------------------------------------------------------------------------------------------------- sheets and workbook
class SheetObj implements BObject {
  readonly typeName = 'Worksheet';
  constructor(
    private rt: CalcRuntime,
    readonly sheetId: number,
  ) {}
  private get wb() {
    return this.rt.workbook();
  }
  get(member: string, args: BVal[]): BVal {
    const m = member.toLowerCase();
    const factory = (kind: 'range' | 'cells' | 'rows' | 'columns') => new RangeFactory(this.rt, kind, this.sheetId);
    switch (m) {
      case 'name':
        return this.wb.sheet(this.sheetId).name;
      case 'index':
        return this.wb.sheets.findIndex((s) => s.id === this.sheetId) + 1;
      case 'range':
        return args.length ? factory('range').index(args) : factory('range');
      case 'cells':
        return args.length ? factory('cells').index(args) : factory('cells');
      case 'rows':
        return args.length ? factory('rows').index(args) : factory('rows');
      case 'columns':
        return args.length ? factory('columns').index(args) : factory('columns');
      case 'usedrange': {
        const u = this.wb.usedRange(this.sheetId) ?? { r1: 0, c1: 0, r2: 0, c2: 0 };
        return new RangeObj(this.rt, this.sheetId, u);
      }
      case 'activate':
      case 'select':
        this.rt.doc.activateSheet(this.sheetId);
        return undefined;
      case 'delete':
        if (this.wb.sheets.length <= 1) throw new Fail('El libro necesita al menos una hoja.');
        this.rt.doc.deleteSheet(this.sheetId);
        return undefined;
      case 'visible':
        return -1;
      case 'parent':
        return new WorkbookObj(this.rt);
      case 'calculate':
        this.wb.recalcAll();
        return undefined;
    }
    return noMember(member);
  }
  set(member: string, _a: BVal[], v: BVal): void {
    if (member.toLowerCase() === 'name') {
      const err = this.rt.doc.renameSheet(this.sheetId, toStr(v));
      if (err) throw new Fail(err);
      return;
    }
    if (member.toLowerCase() === 'visible') return;
    noMember(member);
  }
}

class SheetsObj implements BObject {
  readonly typeName = 'Sheets';
  constructor(private rt: CalcRuntime) {}
  get(member: string, args: BVal[]): BVal {
    switch (member.toLowerCase()) {
      case 'count':
        return this.rt.doc.wb.sheets.length;
      case 'item':
        return this.index(args);
      case 'add': {
        this.rt.doc.addSheet();
        const s = this.rt.doc.sheet;
        return new SheetObj(this.rt, s.id);
      }
    }
    return noMember(member);
  }
  set(member: string): void {
    noMember(member);
  }
  index(args: BVal[]): BVal {
    const k = args[0];
    const sheets = this.rt.doc.wb.sheets;
    const s = typeof k === 'string' ? sheets.find((x) => x.name.toLowerCase() === k.toLowerCase()) : sheets[Math.trunc(toNum(k)) - 1];
    if (!s) throw new BasicError(9, `El subíndice está fuera del intervalo: ${toStr(k)}`);
    return new SheetObj(this.rt, s.id);
  }
  items(): BVal[] {
    return this.rt.doc.wb.sheets.map((s) => new SheetObj(this.rt, s.id));
  }
}

class WorkbookObj implements BObject {
  readonly typeName = 'Workbook';
  constructor(private rt: CalcRuntime) {}
  get(member: string): BVal {
    switch (member.toLowerCase()) {
      case 'name':
        return this.rt.doc.fileName ?? 'Libro1';
      case 'path':
      case 'fullname':
        return this.rt.doc.filePath ?? '';
      case 'sheets':
      case 'worksheets':
        return new SheetsObj(this.rt);
      case 'activesheet':
        return new SheetObj(this.rt, this.rt.doc.activeSheetId);
      case 'saved':
        return !this.rt.doc.dirty;
    }
    return noMember(member);
  }
  set(member: string): void {
    noMember(member);
  }
}

class AppObj implements BObject {
  readonly typeName = 'Application';
  private screenUpdating = true;
  private alerts = true;
  constructor(private rt: CalcRuntime) {}
  get(member: string, args: BVal[]): BVal {
    switch (member.toLowerCase()) {
      case 'screenupdating':
        return this.screenUpdating;
      case 'displayalerts':
        return this.alerts;
      case 'calculation':
        return -4105;
      case 'worksheetfunction':
        return new WorksheetFunctionObj(this.rt);
      case 'activesheet':
        return new SheetObj(this.rt, this.rt.doc.activeSheetId);
      case 'activecell':
        return new RangeObj(this.rt, this.rt.doc.activeSheetId, { r1: this.rt.doc.sel.active.row, c1: this.rt.doc.sel.active.col, r2: this.rt.doc.sel.active.row, c2: this.rt.doc.sel.active.col });
      case 'selection':
        return new RangeObj(this.rt, this.rt.doc.activeSheetId, normRect(this.rt.doc.activeRange));
      case 'activeworkbook':
      case 'thisworkbook':
        return new WorkbookObj(this.rt);
      case 'name':
        return 'Nova Calc';
      case 'version':
        return '0.1';
      case 'evaluate': {
        const v = this.rt.doc.wb.evalFormula(this.rt.doc.activeSheetId, toStr(args[0]));
        return fromB2(v);
      }
      case 'volatile':
      case 'calculate':
        return undefined;
      case 'statusbar':
        return false;
    }
    return noMember(member);
  }
  set(member: string, _a: BVal[], v: BVal): void {
    switch (member.toLowerCase()) {
      case 'screenupdating':
        this.screenUpdating = toBool(v);
        return;
      case 'displayalerts':
        this.alerts = toBool(v);
        return;
      case 'calculation':
      case 'enableevents':
        return;
      case 'statusbar':
        this.rt.doc.setNotice(typeof v === 'string' ? v : null);
        return;
    }
    noMember(member);
  }
}

function fromB2(v: Value): BVal {
  if (v === null) return undefined;
  if (isErr(v as Scalar)) return (v as { code: string }).code;
  if (typeof v === 'object' && v !== null && 'kind' in v) {
    if (v.kind === 'array') return matrixToVArray(v.rows);
    return undefined;
  }
  return v as BVal;
}

/** Application.WorksheetFunction.Sum(Range("A1:A9")): any function of the sheet, by its English name. */
class WorksheetFunctionObj implements BObject {
  readonly typeName = 'WorksheetFunction';
  constructor(private rt: CalcRuntime) {}
  get(member: string, args: BVal[]): BVal {
    const args2: ArrayLikeValue[] = args.map((a) => {
      if (a instanceof RangeObj) return { sheetId: a.sheetId, rect: a.rect };
      if (a instanceof VArray) return fromB(a) as ArrayLikeValue;
      return fromB(a) as ArrayLikeValue;
    });
    const out = this.rt.doc.wb.evalFunction(this.rt.doc.activeSheetId, member.toUpperCase(), args2);
    if (out === undefined) throw new BasicError(438, `La función de hoja de cálculo ${member} no existe.`);
    return fromB2(out);
  }
  set(member: string): void {
    noMember(member);
  }
  index(args: BVal[]): BVal {
    return this.get('Sum', args);
  }
}
