import type { Node } from '../ast';
import type { CalcError, Scalar, Value, RangeVal } from '../values';

/** What the evaluator needs from the workbook. */
export interface EvalHost {
  sheetIdByName(name: string): number | undefined;
  sheetNameById(id: number): string | undefined;
  sheetCount(): number;
  /** Ids of the sheets from one named sheet to another, in tab order (either order); undefined if a name is unknown. */
  sheetIdsBetween(first: string, last: string): number[] | undefined;
  cellValue(sheetId: number, row: number, col: number): Scalar;
  /** Is the row hidden (by the user, or only by a filter when `filteredOnly`)? */
  rowHidden(sheetId: number, row: number, filteredOnly?: boolean): boolean;
  /** Raw cell map of a sheet (key = row * MAX_COLS + col) for tight loops. */
  cellsOf(sheetId: number): ReadonlyMap<number, { value: Scalar }> | undefined;
  /** Shrink a (possibly whole-column/row) range to the used area of its sheet. */
  clip(range: RangeVal): RangeVal;
  /** Visit non-empty cells of a range, row-major not guaranteed. */
  forEachCell(range: RangeVal, cb: (row: number, col: number, v: Scalar) => void): void;
  definedName(name: string, sheetId?: number): Node | undefined;
  /** The range a structured table reference stands for (or an error). */
  tableRef?(n: Extract<Node, { t: 'tref' }>, sheetId: number, row: number, col: number): RangeVal | CalcError;
  /** Text of the formula in a cell (canonical syntax, with the leading =), or undefined when it holds none. */
  formulaText?(sheetId: number, row: number, col: number): string | undefined;
  /** Value of a pivot table cell chosen by field and items (GETPIVOTDATA). */
  pivotLookup?(sheetId: number, row: number, col: number, dataField: string, items: Record<string, string>): Scalar | undefined;
  /** A function written by the user in a macro module (called when no built-in function has the name). */
  userFunction?(name: string, args: Value[]): Value | undefined;
  now(): Date;
  random(): number;
}

export interface Ctx {
  host: EvalHost;
  sheetId: number;
  row: number;
  col: number;
  /** LET / LAMBDA bindings. */
  scope: Map<string, Value> | null;
  volatile: boolean;
  /** How deep LAMBDA calls are nested (a runaway recursion stops with #CALC!). */
  depth?: number;
}

export type Thunk = () => Value;

export interface FnDef {
  name: string;
  min: number;
  max: number;
  /** scalar: args are scalars and the result is lifted over arrays; raw: gets evaluated Values; lazy: gets thunks. */
  kind: 'scalar' | 'raw' | 'lazy';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  impl: (args: any[], ctx: Ctx) => Value;
  volatile?: boolean;
  /** scalar functions only: receive error arguments instead of short-circuiting with the first error. */
  handlesErrors?: boolean;
  /**
   * What the function does with a reference made of several areas (a 3D reference or a union):
   * "spread" gives each area as a separate argument, "flatten" joins them into one column, "native" receives the value as it is.
   * Without it such a reference is a #VALUE!.
   */
  multi?: 'spread' | 'flatten' | 'native';
  /** Receives function values (LAMBDA) as arguments. */
  lambdas?: boolean;
}

export const registry = new Map<string, FnDef>();

type Impl<A> = (args: A, ctx: Ctx) => Value;
type Opts = { volatile?: boolean; multi?: FnDef['multi']; lambdas?: boolean };

/** Say how already registered functions treat references with several areas. */
export function setMulti(mode: NonNullable<FnDef['multi']>, ...names: string[]): void {
  for (const n of names) {
    const d = registry.get(n);
    if (d) d.multi = mode;
  }
}

export function scalarFn(name: string, min: number, max: number, impl: Impl<Scalar[]>, opts: { volatile?: boolean; handlesErrors?: boolean } = {}): void {
  registry.set(name, { name, min, max, kind: 'scalar', impl, ...opts });
}
export function rawFn(name: string, min: number, max: number, impl: Impl<Value[]>, opts: Opts = {}): void {
  registry.set(name, { name, min, max, kind: 'raw', impl, ...opts });
}
export function lazyFn(name: string, min: number, max: number, impl: Impl<Thunk[]>, opts: { volatile?: boolean } = {}): void {
  registry.set(name, { name, min, max, kind: 'lazy', impl, ...opts });
}
export function alias(name: string, target: string): void {
  const d = registry.get(target);
  if (!d) throw new Error(`alias target ${target} missing`);
  registry.set(name, { ...d, name });
}
