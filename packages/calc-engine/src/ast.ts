import type { CellAddr } from './addr';
import type { CalcError } from './values';

export type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'err'; v: CalcError }
  /** `sheetEnd` makes a 3D reference: every sheet from `sheet` to `sheetEnd` in tab order. */
  | { t: 'ref'; sheet?: string; sheetEnd?: string; a: CellAddr }
  | { t: 'range'; sheet?: string; sheetEnd?: string; a: CellAddr; b: CellAddr; whole?: 'col' | 'row' }
  /** (A1:A3,C1:C3): several areas. */
  | { t: 'union'; parts: Node[] }
  /** A1:C3 B2:D4 (a space): the cells both references share. */
  | { t: 'isect'; l: Node; r: Node }
  /** @A1:A10: one value instead of an array. */
  | { t: 'implicit'; e: Node }
  /** expr(args): calls the function value that expr gives. */
  | { t: 'callv'; fn: Node; args: Node[] }
  | { t: 'rangeop'; l: Node; r: Node }
  | { t: 'name'; name: string }
  | { t: 'un'; op: '-' | '+'; e: Node }
  | { t: 'pct'; e: Node }
  | { t: 'bin'; op: BinOp; l: Node; r: Node }
  | { t: 'call'; name: string; args: Node[] }
  | { t: 'arr'; rows: Node[][] }
  /** A structured reference to part of a table: Tabla1[Col], Tabla1[[#Headers],[Col]], [@Col]. */
  | { t: 'tref'; table?: string; area: TableArea; col1?: string; col2?: string }
  | { t: 'missing' };

export type TableArea = 'data' | 'all' | 'headers' | 'totals' | 'thisRow' | 'headersData' | 'dataTotals';

export type BinOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';
