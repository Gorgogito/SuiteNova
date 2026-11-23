/*
 * The grid of a table, whatever its cells hold. A merged cell is one "origin" cell with `rs`/`cs` and the cells it covers marked `cover`.
 * Every structural edit reads the table as a list of regions (origin cell + its extent), changes the regions and writes the grid back, so merges
 * stay consistent whatever is inserted, deleted, merged or split. Pure functions: they return a new grid.
 */

export type Side = 't' | 'r' | 'b' | 'l';
export type BorderStyle = 'single' | 'dashed' | 'dotted' | 'double' | 'none';

/** A border line: style, thickness in points and colour (#rrggbb). */
export interface Border {
  style: BorderStyle;
  width: number;
  color: string;
}

export type HAlign = 'left' | 'center' | 'right' | 'justify';
export type VAlign = 'top' | 'middle' | 'bottom';

/** Formatting of one cell that belongs to the cell itself (it wins over the style of the table). */
export interface CellProps {
  /** Background colour; null is "no fill" and is not the same as not saying (which lets the style decide). */
  fill?: string | null;
  align?: HAlign;
  valign?: VAlign;
  /** Inner margins in points. */
  margins?: { t: number; r: number; b: number; l: number };
  /** Borders set on the cell; null is "no border". */
  borders?: Partial<Record<Side, Border | null>>;
}

export interface Cell<C> {
  content: C;
  props?: CellProps;
  /** Rows and columns the cell spans (only on the origin cell, only when more than 1). */
  rs?: number;
  cs?: number;
  /** True when a merged cell covers this one; its content is not shown. `hm`: the origin is in a column to the left; `vm`: in a row above. */
  cover?: boolean;
  hm?: boolean;
  vm?: boolean;
}

export interface Row<C> {
  /** Height in the unit of the product (points, pixels…). */
  h: number;
  cells: Cell<C>[];
}

export interface Grid<C> {
  /** Column widths. */
  cols: number[];
  rows: Row<C>[];
}

export interface Range {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** How a product makes an empty cell like another (same formatting, no content). */
export type Blank<C> = (like?: C) => C;

interface Region<C> {
  r: number;
  c: number;
  rs: number;
  cs: number;
  cell: Cell<C>;
}

const MIN = 12;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export const gridSize = <C>(g: Grid<C>): { w: number; h: number } => ({ w: sum(g.cols), h: sum(g.rows.map((r) => r.h)) });

/** A grid of empty cells. */
export function makeGrid<C>(nRows: number, nCols: number, blank: Blank<C>, colW = 100, rowH = 24): Grid<C> {
  return { cols: Array<number>(nCols).fill(colW), rows: Array.from({ length: nRows }, () => ({ h: rowH, cells: Array.from({ length: nCols }, () => ({ content: blank() })) })) };
}

/** A grid from the text of its cells (rows of strings). */
export function gridFromRows<C>(rows: string[][], make: (text: string) => C, colW = 100, rowH = 24): Grid<C> {
  const nCols = Math.max(1, ...rows.map((r) => r.length));
  return { cols: Array<number>(nCols).fill(colW), rows: rows.map((r) => ({ h: rowH, cells: Array.from({ length: nCols }, (_v, c) => ({ content: make(r[c] ?? '') })) })) };
}

// ------------------------------------------------------------------------------------------------ regions

function regionsOf<C>(g: Grid<C>): Region<C>[] {
  const out: Region<C>[] = [];
  g.rows.forEach((row, r) =>
    row.cells.forEach((cell, c) => {
      if (cell.cover) return;
      out.push({ r, c, rs: Math.min(cell.rs ?? 1, g.rows.length - r), cs: Math.min(cell.cs ?? 1, g.cols.length - c), cell });
    }),
  );
  return out;
}

function rebuild<C>(cols: number[], heights: number[], regions: Region<C>[], tpl: (r: number, c: number) => Cell<C>): Grid<C> {
  const R = heights.length;
  const C = cols.length;
  const cells: (Cell<C> | null)[][] = Array.from({ length: R }, () => Array<Cell<C> | null>(C).fill(null));
  for (const g of regions) {
    for (let r = g.r; r < g.r + g.rs && r < R; r++) {
      for (let c = g.c; c < g.c + g.cs && c < C; c++) {
        if (r === g.r && c === g.c) {
          const { rs, cs, cover, hm, vm, ...rest } = g.cell;
          void rs;
          void cs;
          void cover;
          void hm;
          void vm;
          cells[r]![c] = { ...rest, ...(g.rs > 1 ? { rs: g.rs } : {}), ...(g.cs > 1 ? { cs: g.cs } : {}) };
        } else cells[r]![c] = { content: g.cell.content, cover: true, ...(c > g.c ? { hm: true } : {}), ...(r > g.r ? { vm: true } : {}) };
      }
    }
  }
  return { cols, rows: heights.map((h, r) => ({ h, cells: cells[r]!.map((cell, c) => cell ?? tpl(r, c)) })) };
}

/** The cell that holds what is shown at grid position (r, c): the origin of the merged cell covering it. */
export function originOf<C>(g: Grid<C>, r: number, c: number): { r: number; c: number } {
  let r0 = Math.max(0, Math.min(g.rows.length - 1, r));
  let c0 = Math.max(0, Math.min(g.cols.length - 1, c));
  while (r0 > 0 && g.rows[r0]!.cells[c0]?.vm) r0--;
  while (c0 > 0 && g.rows[r0]!.cells[c0]?.hm) c0--;
  return { r: r0, c: c0 };
}

/** The extent of the cell at (r, c): its origin and span. */
export function spanOf<C>(g: Grid<C>, r: number, c: number): Range {
  const o = originOf(g, r, c);
  const cell = g.rows[o.r]!.cells[o.c]!;
  return { r1: o.r, c1: o.c, r2: Math.min(g.rows.length - 1, o.r + (cell.rs ?? 1) - 1), c2: Math.min(g.cols.length - 1, o.c + (cell.cs ?? 1) - 1) };
}

export const isMerged = <C>(g: Grid<C>, r: number, c: number): boolean => {
  const s = spanOf(g, r, c);
  return s.r2 > s.r1 || s.c2 > s.c1;
};

/** A range grown until it does not cut any merged cell. */
export function expandRange<C>(g: Grid<C>, rg: Range): Range {
  let cur: Range = { r1: Math.max(0, Math.min(rg.r1, rg.r2)), c1: Math.max(0, Math.min(rg.c1, rg.c2)), r2: Math.min(g.rows.length - 1, Math.max(rg.r1, rg.r2)), c2: Math.min(g.cols.length - 1, Math.max(rg.c1, rg.c2)) };
  for (let guard = 0; guard < 30; guard++) {
    let next = cur;
    for (let r = cur.r1; r <= cur.r2; r++) {
      for (let c = cur.c1; c <= cur.c2; c++) {
        const s = spanOf(g, r, c);
        next = { r1: Math.min(next.r1, s.r1), c1: Math.min(next.c1, s.c1), r2: Math.max(next.r2, s.r2), c2: Math.max(next.c2, s.c2) };
      }
    }
    if (next.r1 === cur.r1 && next.c1 === cur.c1 && next.r2 === cur.r2 && next.c2 === cur.c2) break;
    cur = next;
  }
  return cur;
}

/** An empty cell like the one at (r, c) (its formatting, not its content or spans). */
function blankCellLike<C>(g: Grid<C>, r: number, c: number, blank: Blank<C>): Cell<C> {
  const o = originOf(g, r, c);
  const src = g.rows[o.r]!.cells[o.c]!;
  return { content: blank(src.content), ...(src.props ? { props: structuredCloneProps(src.props) } : {}) };
}

const structuredCloneProps = (p: CellProps): CellProps => ({ ...p, ...(p.margins ? { margins: { ...p.margins } } : {}), ...(p.borders ? { borders: { ...p.borders } } : {}) });

// ------------------------------------------------------------------------------------------------ rows and columns

/** Inserts `count` rows before row `at` (`at` = number of rows appends); they look like row `src`. */
export function insertRows<C>(g: Grid<C>, at: number, count: number, blank: Blank<C>, src = Math.max(0, Math.min(g.rows.length - 1, at - 1))): Grid<C> {
  const regions = regionsOf(g).map((x) => (x.r >= at ? { ...x, r: x.r + count } : x.r + x.rs > at ? { ...x, rs: x.rs + count } : x));
  const heights = g.rows.map((r) => r.h);
  heights.splice(at, 0, ...Array<number>(count).fill(g.rows[src]!.h));
  return rebuild([...g.cols], heights, regions, (_r, c) => blankCellLike(g, src, c, blank));
}

/** Inserts `count` columns before column `at`; they look like column `src`. */
export function insertCols<C>(g: Grid<C>, at: number, count: number, blank: Blank<C>, src = Math.max(0, Math.min(g.cols.length - 1, at - 1))): Grid<C> {
  const regions = regionsOf(g).map((x) => (x.c >= at ? { ...x, c: x.c + count } : x.c + x.cs > at ? { ...x, cs: x.cs + count } : x));
  const cols = [...g.cols];
  cols.splice(at, 0, ...Array<number>(count).fill(g.cols[src]!));
  return rebuild(cols, g.rows.map((r) => r.h), regions, (r) => blankCellLike(g, r, src, blank));
}

/** Deletes rows r1..r2; null when that would leave no rows (the table goes). */
export function deleteRows<C>(g: Grid<C>, r1: number, r2: number, blank: Blank<C>): Grid<C> | null {
  const a = Math.max(0, Math.min(r1, r2));
  const b = Math.min(g.rows.length - 1, Math.max(r1, r2));
  const n = b - a + 1;
  if (n >= g.rows.length) return null;
  const regions = regionsOf(g).flatMap((x): Region<C>[] => {
    const end = x.r + x.rs - 1;
    const overlap = Math.max(0, Math.min(end, b) - Math.max(x.r, a) + 1);
    if (overlap === x.rs) return [];
    const r = x.r > b ? x.r - n : x.r >= a ? a : x.r;
    return [{ ...x, r, rs: x.rs - overlap }];
  });
  const heights = g.rows.map((r) => r.h);
  heights.splice(a, n);
  return rebuild([...g.cols], heights, regions, (r, c) => blankCellLike(g, Math.min(r, g.rows.length - 1), c, blank));
}

export function deleteCols<C>(g: Grid<C>, c1: number, c2: number, blank: Blank<C>): Grid<C> | null {
  const a = Math.max(0, Math.min(c1, c2));
  const b = Math.min(g.cols.length - 1, Math.max(c1, c2));
  const n = b - a + 1;
  if (n >= g.cols.length) return null;
  const regions = regionsOf(g).flatMap((x): Region<C>[] => {
    const end = x.c + x.cs - 1;
    const overlap = Math.max(0, Math.min(end, b) - Math.max(x.c, a) + 1);
    if (overlap === x.cs) return [];
    const c = x.c > b ? x.c - n : x.c >= a ? a : x.c;
    return [{ ...x, c, cs: x.cs - overlap }];
  });
  const cols = [...g.cols];
  cols.splice(a, n);
  return rebuild(cols, g.rows.map((r) => r.h), regions, (r, c) => blankCellLike(g, r, Math.min(c, g.cols.length - 1), blank));
}

// ------------------------------------------------------------------------------------------------ merge and split

/**
 * Merges the cells of a range into one. `join` makes the content of the merged cell from the contents of the cells it replaces, in reading
 * order (by default the first one's stays).
 */
export function mergeCells<C>(g: Grid<C>, range: Range, blank: Blank<C>, join?: (contents: C[]) => C): Grid<C> {
  const rg = expandRange(g, range);
  const all = regionsOf(g);
  const inside = all.filter((x) => x.r >= rg.r1 && x.r + x.rs - 1 <= rg.r2 && x.c >= rg.c1 && x.c + x.cs - 1 <= rg.c2);
  if (inside.length < 2) return g;
  inside.sort((a, b) => a.r - b.r || a.c - b.c);
  const first = inside[0]!;
  const content = join ? join(inside.map((x) => x.cell.content)) : first.cell.content;
  const merged: Region<C> = { r: rg.r1, c: rg.c1, rs: rg.r2 - rg.r1 + 1, cs: rg.c2 - rg.c1 + 1, cell: { ...first.cell, content } };
  const rest = all.filter((x) => !inside.includes(x));
  return rebuild([...g.cols], g.rows.map((r) => r.h), [...rest, merged], (r, c) => blankCellLike(g, r, c, blank));
}

const partition = (total: number, n: number): number[] => {
  const k = Math.max(1, Math.min(n, total));
  const base = Math.floor(total / k);
  return Array.from({ length: k }, (_v, i) => (i === k - 1 ? total - base * (k - 1) : base));
};

/** Splits a cell into `nr` rows × `nc` columns; an unmerged cell makes the grid bigger (the cells beside it span the new lines). */
export function splitCell<C>(g: Grid<C>, r: number, c: number, nr: number, nc: number, blank: Blank<C>): Grid<C> {
  const o = originOf(g, r, c);
  const all = regionsOf(g);
  const reg = all.find((x) => x.r === o.r && x.c === o.c);
  if (!reg || (nr <= 1 && nc <= 1)) return g;
  let out = all.map((x) => ({ ...x }));
  const cols = [...g.cols];
  const heights = g.rows.map((x) => x.h);
  if (nc > reg.cs) {
    const k = nc - reg.cs;
    const j = reg.c + reg.cs - 1;
    const W = sum(cols.slice(reg.c, reg.c + reg.cs));
    out = out.map((x) => (x.c > j ? { ...x, c: x.c + k } : x.c <= j && x.c + x.cs > j ? { ...x, cs: x.cs + k } : x));
    cols.splice(j + 1, 0, ...Array<number>(k).fill(0));
    for (let i = 0; i < nc; i++) cols[reg.c + i] = W / nc;
  }
  if (nr > reg.rs) {
    const k = nr - reg.rs;
    const j = reg.r + reg.rs - 1;
    const H = sum(heights.slice(reg.r, reg.r + reg.rs));
    out = out.map((x) => (x.r > j ? { ...x, r: x.r + k } : x.r <= j && x.r + x.rs > j ? { ...x, rs: x.rs + k } : x));
    heights.splice(j + 1, 0, ...Array<number>(k).fill(0));
    for (let i = 0; i < nr; i++) heights[reg.r + i] = Math.max(MIN, H / nr);
  }
  const t = out.find((x) => x.cell === reg.cell)!;
  const rest = out.filter((x) => x !== t);
  const pr = partition(t.rs, nr);
  const pc = partition(t.cs, nc);
  const like = (): Cell<C> => ({ content: blank(t.cell.content), ...(t.cell.props ? { props: structuredCloneProps(t.cell.props) } : {}) });
  let rr = t.r;
  pr.forEach((hs, i) => {
    let cc = t.c;
    pc.forEach((ws, j) => {
      rest.push({ r: rr, c: cc, rs: hs, cs: ws, cell: i === 0 && j === 0 ? t.cell : like() });
      cc += ws;
    });
    rr += hs;
  });
  return rebuild(cols, heights, rest, () => like());
}

// ------------------------------------------------------------------------------------------------ cells

/** The origin cells of a range (merged cells once), in reading order. */
export function cellsOf<C>(g: Grid<C>, range: Range): { r: number; c: number; cell: Cell<C> }[] {
  const rg = expandRange(g, range);
  return regionsOf(g)
    .filter((x) => x.r >= rg.r1 && x.r <= rg.r2 && x.c >= rg.c1 && x.c <= rg.c2)
    .map((x) => ({ r: x.r, c: x.c, cell: x.cell }));
}

/** Changes the cells of a range (`fn` returns the changed cell). */
export function mapCells<C>(g: Grid<C>, range: Range, fn: (cell: Cell<C>, r: number, c: number) => Cell<C>): Grid<C> {
  const keep = new Set(cellsOf(g, range).map((x) => `${x.r},${x.c}`));
  return { ...g, rows: g.rows.map((row, r) => ({ ...row, cells: row.cells.map((cell, c) => (keep.has(`${r},${c}`) ? fn(cell, r, c) : cell)) })) };
}

/** Sets properties on the cells of a range; a property given as `undefined` is taken off (so the style decides again). */
export function setProps<C>(g: Grid<C>, range: Range, patch: Partial<CellProps>): Grid<C> {
  return mapCells(g, range, (cell) => {
    const props: CellProps = { ...cell.props };
    for (const [k, v] of Object.entries(patch) as [keyof CellProps, unknown][]) {
      if (v === undefined) delete props[k];
      else (props as Record<string, unknown>)[k] = v;
    }
    return { ...cell, props: Object.keys(props).length ? props : undefined } as Cell<C>;
  });
}

export type BorderMode = 'all' | 'none' | 'outer' | 'inner' | 'insideH' | 'insideV' | 'top' | 'bottom' | 'left' | 'right';

/** Draws (or, with `border` null, removes) borders around and inside a range. A shared edge is set on both cells that touch it. */
export function setBorders<C>(g: Grid<C>, range: Range, mode: BorderMode, border: Border | null): Grid<C> {
  const rg = expandRange(g, range);
  const rows = g.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c, props: c.props ? structuredCloneProps(c.props) : undefined })) }));
  const set = (cell: Cell<C> | undefined, side: Side) => {
    if (!cell) return;
    cell.props = { ...cell.props, borders: { ...cell.props?.borders, [side]: border } };
  };
  const at = (r: number, c: number): Cell<C> | undefined => {
    if (r < 0 || c < 0 || r >= rows.length || c >= g.cols.length) return undefined;
    const o = originOf(g, r, c);
    return rows[o.r]!.cells[o.c];
  };
  for (const x of regionsOf(g)) {
    if (x.r < rg.r1 || x.r + x.rs - 1 > rg.r2 || x.c < rg.c1 || x.c + x.cs - 1 > rg.c2) continue;
    const top = x.r === rg.r1;
    const bottom = x.r + x.rs - 1 === rg.r2;
    const left = x.c === rg.c1;
    const right = x.c + x.cs - 1 === rg.c2;
    const all = mode === 'all' || mode === 'none';
    const want = {
      t: all || (top && (mode === 'outer' || mode === 'top')) || (!top && (mode === 'inner' || mode === 'insideH')),
      b: all || (bottom && (mode === 'outer' || mode === 'bottom')) || (!bottom && (mode === 'inner' || mode === 'insideH')),
      l: all || (left && (mode === 'outer' || mode === 'left')) || (!left && (mode === 'inner' || mode === 'insideV')),
      r: all || (right && (mode === 'outer' || mode === 'right')) || (!right && (mode === 'inner' || mode === 'insideV')),
    };
    const me = rows[x.r]!.cells[x.c]!;
    if (want.t) {
      set(me, 't');
      for (let c = x.c; c < x.c + x.cs; c++) set(at(x.r - 1, c), 'b');
    }
    if (want.b) {
      set(me, 'b');
      for (let c = x.c; c < x.c + x.cs; c++) set(at(x.r + x.rs, c), 't');
    }
    if (want.l) {
      set(me, 'l');
      for (let r = x.r; r < x.r + x.rs; r++) set(at(r, x.c - 1), 'r');
    }
    if (want.r) {
      set(me, 'r');
      for (let r = x.r; r < x.r + x.rs; r++) set(at(r, x.c + x.cs), 'l');
    }
  }
  return { ...g, rows };
}

// ------------------------------------------------------------------------------------------------ sizes

export function setColWidth<C>(g: Grid<C>, i: number, w: number, pair = true): Grid<C> {
  const cols = [...g.cols];
  const next = Math.max(MIN, w);
  if (pair && i < cols.length - 1) {
    const room = cols[i]! + cols[i + 1]! - MIN;
    const wi = Math.min(next, room);
    cols[i + 1] = cols[i]! + cols[i + 1]! - wi;
    cols[i] = wi;
  } else cols[i] = next;
  return { ...g, cols };
}

export function setRowHeight<C>(g: Grid<C>, i: number, h: number): Grid<C> {
  return { ...g, rows: g.rows.map((r, k) => (k === i ? { ...r, h: Math.max(MIN, h) } : r)) };
}

export function distributeRows<C>(g: Grid<C>, r1: number, r2: number): Grid<C> {
  const a = Math.min(r1, r2);
  const b = Math.max(r1, r2);
  const each = sum(g.rows.slice(a, b + 1).map((r) => r.h)) / (b - a + 1);
  return { ...g, rows: g.rows.map((r, k) => (k >= a && k <= b ? { ...r, h: each } : r)) };
}

export function distributeCols<C>(g: Grid<C>, c1: number, c2: number): Grid<C> {
  const a = Math.min(c1, c2);
  const b = Math.max(c1, c2);
  const each = sum(g.cols.slice(a, b + 1)) / (b - a + 1);
  return { ...g, cols: g.cols.map((w, k) => (k >= a && k <= b ? each : w)) };
}

/** The grid with the given width and height: columns and rows keep their proportions. */
export function scaleGrid<C>(g: Grid<C>, w: number, h: number): Grid<C> {
  const cur = gridSize(g);
  const kx = cur.w ? w / cur.w : 1;
  const ky = cur.h ? h / cur.h : 1;
  return { cols: g.cols.map((c) => Math.max(MIN, c * kx)), rows: g.rows.map((r) => ({ ...r, h: Math.max(MIN, r.h * ky) })) };
}

/** Columns resized to fit the width of their content: `measure(c)` is the width that column wants; the result adds up to `total`. */
export function autoFitCols<C>(g: Grid<C>, measure: (c: number) => number, total: number): Grid<C> {
  const want = g.cols.map((_w, c) => Math.max(MIN, measure(c)));
  const s = sum(want);
  return { ...g, cols: want.map((w) => Math.max(MIN, (w / (s || 1)) * total)) };
}

// ------------------------------------------------------------------------------------------------ checks

/** What is wrong with a grid (empty when it is consistent): used by the tests and by the products to check what they read from a file. */
export function validate<C>(g: Grid<C>): string[] {
  const bad: string[] = [];
  if (!g.rows.length || !g.cols.length) bad.push('sin filas o sin columnas');
  g.rows.forEach((row, r) => {
    if (row.cells.length !== g.cols.length) bad.push(`la fila ${r} tiene ${row.cells.length} celdas y hay ${g.cols.length} columnas`);
  });
  if (bad.length) return bad;
  const owner: (string | null)[][] = g.rows.map((row) => row.cells.map(() => null));
  for (const x of regionsOf(g)) {
    if ((x.cell.rs ?? 1) > g.rows.length - x.r || (x.cell.cs ?? 1) > g.cols.length - x.c) bad.push(`la celda ${x.r},${x.c} se sale de la tabla`);
    for (let r = x.r; r < x.r + x.rs; r++) {
      for (let c = x.c; c < x.c + x.cs; c++) {
        if (owner[r]![c]) bad.push(`la celda ${r},${c} está cubierta dos veces`);
        owner[r]![c] = `${x.r},${x.c}`;
        const cell = g.rows[r]!.cells[c]!;
        const isOrigin = r === x.r && c === x.c;
        if (!isOrigin && !cell.cover) bad.push(`la celda ${r},${c} está bajo una combinada y no está marcada`);
        if (isOrigin && cell.cover) bad.push(`el origen ${r},${c} está marcado como cubierto`);
      }
    }
  }
  g.rows.forEach((row, r) => row.cells.forEach((cell, c) => cell.cover && !owner[r]![c] && bad.push(`la celda ${r},${c} está marcada como cubierta y nadie la cubre`)));
  return bad;
}
