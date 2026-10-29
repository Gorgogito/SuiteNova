export type ErrorCode = '#NULL!' | '#DIV/0!' | '#VALUE!' | '#REF!' | '#NAME?' | '#NUM!' | '#N/A' | '#SPILL!' | '#CALC!' | '#CIRC!';

export class CalcError {
  private constructor(readonly code: ErrorCode) {}
  private static cache = new Map<ErrorCode, CalcError>();
  static of(code: ErrorCode): CalcError {
    let e = CalcError.cache.get(code);
    if (!e) {
      e = new CalcError(code);
      CalcError.cache.set(code, e);
    }
    return e;
  }
  static parse(text: string): CalcError | null {
    const up = text.toUpperCase();
    return CalcError.cache.has(up as ErrorCode) || ERROR_CODES.includes(up as ErrorCode) ? CalcError.of(up as ErrorCode) : null;
  }
  toString(): string {
    return this.code;
  }
}

const ERROR_CODES: ErrorCode[] = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#SPILL!', '#CALC!', '#CIRC!'];

export const E = {
  NULL: CalcError.of('#NULL!'),
  DIV0: CalcError.of('#DIV/0!'),
  VALUE: CalcError.of('#VALUE!'),
  REF: CalcError.of('#REF!'),
  NAME: CalcError.of('#NAME?'),
  NUM: CalcError.of('#NUM!'),
  NA: CalcError.of('#N/A'),
  SPILL: CalcError.of('#SPILL!'),
  CALC: CalcError.of('#CALC!'),
  CIRC: CalcError.of('#CIRC!'),
} as const;

/** A single cell value. `null` is an empty cell. */
export type Scalar = number | string | boolean | null | CalcError;

export interface ArrayVal {
  kind: 'array';
  rows: Scalar[][];
}

export interface RangeVal {
  kind: 'range';
  sheetId: number;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** Several rectangles, possibly on different sheets: the result of a 3D reference or of the union operator. */
export interface RefsVal {
  kind: 'refs';
  areas: RangeVal[];
}

/** A function value made by LAMBDA. `scope` holds the variables visible where it was created. */
export interface LambdaVal {
  kind: 'lambda';
  params: string[];
  body: unknown;
  scope: Map<string, Value> | null;
}

export type Value = Scalar | ArrayVal | RangeVal | RefsVal | LambdaVal;

export const isErr = (v: unknown): v is CalcError => v instanceof CalcError;
export const isArray = (v: Value): v is ArrayVal => typeof v === 'object' && v !== null && !(v instanceof CalcError) && (v as ArrayVal).kind === 'array';
export const isRange = (v: Value): v is RangeVal => typeof v === 'object' && v !== null && !(v instanceof CalcError) && (v as RangeVal).kind === 'range';

export const isRefs = (v: Value): v is RefsVal => typeof v === 'object' && v !== null && !(v instanceof CalcError) && (v as RefsVal).kind === 'refs';
export const isLambda = (v: Value): v is LambdaVal => typeof v === 'object' && v !== null && !(v instanceof CalcError) && (v as LambdaVal).kind === 'lambda';

export const arr = (rows: Scalar[][]): ArrayVal => ({ kind: 'array', rows });

export function arrDims(a: ArrayVal): { rows: number; cols: number } {
  return { rows: a.rows.length, cols: a.rows[0]?.length ?? 0 };
}
