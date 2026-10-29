import { docNode, emptyDocJson, makeDoc } from './text';
import type { Clr, Fill, Ln, TableCell, TableEl, TableStyleDef, TableStylePart } from './types';

/*
 * Tables. A table is a grid of cells; a merged cell is one "origin" cell with `gridSpan`/`rowSpan` and the cells it covers marked
 * `hMerge`/`vMerge`. Every structural edit reads the table as a list of regions (origin cell + its extent), changes the regions and
 * writes the grid back, so merges stay consistent whatever is inserted, deleted, merged or split.
 */

export interface CellRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

interface Region {
  r: number;
  c: number;
  rs: number;
  cs: number;
  cell: TableCell;
}

const MIN = 12;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export const tableSize = (el: TableEl): { w: number; h: number } => ({ w: sum(el.cols), h: sum(el.rows.map((r) => r.h)) });

function withGeometry(el: TableEl): TableEl {
  const { w, h } = tableSize(el);
  return { ...el, xfrm: { ...(el.xfrm ?? { x: 0, y: 0, w, h }), w, h } };
}

/** An empty cell that looks like another: same fill, borders, margins and paragraph/run formatting. */
export function blankLike(src?: TableCell | null): TableCell {
  const { text, gridSpan, rowSpan, hMerge, vMerge, ...fmt } = (src ?? {}) as TableCell;
  void gridSpan;
  void rowSpan;
  void hMerge;
  void vMerge;
  let doc: unknown = emptyDocJson();
  if (text) {
    const p = docNode(text.doc).firstChild;
    if (p) {
      let r: Record<string, unknown> | undefined;
      p.forEach((c) => {
        if (!r) r = c.marks.find((m) => m.type.name === 'run')?.attrs.r as Record<string, unknown> | undefined;
      });
      const end = Object.keys(p.attrs.end as object).length ? (p.attrs.end as never) : (r as never);
      doc = makeDoc([{ lvl: p.attrs.lvl as number, p: p.attrs.p as never, end }]).toJSON();
    }
  }
  return { ...fmt, text: { body: text?.body ?? {}, ...(text?.lst ? { lst: text.lst } : {}), doc } };
}

// ------------------------------------------------------------------------------------------------ regions

function regionsOf(el: TableEl): Region[] {
  const out: Region[] = [];
  el.rows.forEach((row, r) =>
    row.cells.forEach((cell, c) => {
      if (cell.hMerge || cell.vMerge) return;
      out.push({ r, c, rs: Math.min(cell.rowSpan ?? 1, el.rows.length - r), cs: Math.min(cell.gridSpan ?? 1, el.cols.length - c), cell });
    }),
  );
  return out;
}

function rebuild(el: TableEl, cols: number[], heights: number[], regions: Region[], tpl: (r: number, c: number) => TableCell): TableEl {
  const R = heights.length;
  const C = cols.length;
  const grid: (TableCell | null)[][] = Array.from({ length: R }, () => Array<TableCell | null>(C).fill(null));
  for (const g of regions) {
    for (let r = g.r; r < g.r + g.rs && r < R; r++) {
      for (let c = g.c; c < g.c + g.cs && c < C; c++) {
        if (r === g.r && c === g.c) {
          const { rowSpan, gridSpan, hMerge, vMerge, ...rest } = g.cell;
          void rowSpan;
          void gridSpan;
          void hMerge;
          void vMerge;
          grid[r]![c] = { ...rest, ...(g.rs > 1 ? { rowSpan: g.rs } : {}), ...(g.cs > 1 ? { gridSpan: g.cs } : {}) };
        } else grid[r]![c] = { text: null, ...(c > g.c ? { hMerge: true } : {}), ...(r > g.r ? { vMerge: true } : {}) };
      }
    }
  }
  const rows = heights.map((h, r) => ({ h, cells: grid[r]!.map((cell, c) => cell ?? tpl(r, c)) }));
  return withGeometry({ ...el, cols, rows });
}

/** The cell that holds the text of grid position (r, c): the origin of the merged cell covering it. */
export function originOf(el: TableEl, r: number, c: number): { r: number; c: number } {
  let r0 = Math.max(0, Math.min(el.rows.length - 1, r));
  let c0 = Math.max(0, Math.min(el.cols.length - 1, c));
  while (r0 > 0 && el.rows[r0]!.cells[c0]?.vMerge) r0--;
  while (c0 > 0 && el.rows[r0]!.cells[c0]?.hMerge) c0--;
  return { r: r0, c: c0 };
}

/** The extent of the cell at (r, c): its origin and span. */
export function spanOf(el: TableEl, r: number, c: number): CellRange {
  const o = originOf(el, r, c);
  const cell = el.rows[o.r]!.cells[o.c]!;
  return { r1: o.r, c1: o.c, r2: Math.min(el.rows.length - 1, o.r + (cell.rowSpan ?? 1) - 1), c2: Math.min(el.cols.length - 1, o.c + (cell.gridSpan ?? 1) - 1) };
}

/** A range grown until it does not cut any merged cell. */
export function expandRange(el: TableEl, rg: CellRange): CellRange {
  let cur: CellRange = { r1: Math.min(rg.r1, rg.r2), c1: Math.min(rg.c1, rg.c2), r2: Math.max(rg.r1, rg.r2), c2: Math.max(rg.c1, rg.c2) };
  cur = { r1: Math.max(0, cur.r1), c1: Math.max(0, cur.c1), r2: Math.min(el.rows.length - 1, cur.r2), c2: Math.min(el.cols.length - 1, cur.c2) };
  for (let guard = 0; guard < 20; guard++) {
    let next = cur;
    for (let r = cur.r1; r <= cur.r2; r++) {
      for (let c = cur.c1; c <= cur.c2; c++) {
        const s = spanOf(el, r, c);
        next = { r1: Math.min(next.r1, s.r1), c1: Math.min(next.c1, s.c1), r2: Math.max(next.r2, s.r2), c2: Math.max(next.c2, s.c2) };
      }
    }
    if (next.r1 === cur.r1 && next.c1 === cur.c1 && next.r2 === cur.r2 && next.c2 === cur.c2) break;
    cur = next;
  }
  return cur;
}

const formatSource = (el: TableEl, r: number, c: number): TableCell => {
  const o = originOf(el, r, c);
  return el.rows[o.r]!.cells[o.c]!;
};

// ------------------------------------------------------------------------------------------------ rows and columns

/** Inserts `count` rows before row `at` (`at` = number of rows appends); they look like row `src`. */
export function insertRows(el: TableEl, at: number, count = 1, src = Math.max(0, Math.min(el.rows.length - 1, at - 1))): TableEl {
  const regions = regionsOf(el).map((g) => (g.r >= at ? { ...g, r: g.r + count } : g.r + g.rs > at ? { ...g, rs: g.rs + count } : g));
  const heights = el.rows.map((r) => r.h);
  heights.splice(at, 0, ...Array<number>(count).fill(el.rows[src]!.h));
  return rebuild(el, [...el.cols], heights, regions, (_r, c) => blankLike(formatSource(el, src, c)));
}

/** Inserts `count` columns before column `at`; they look like column `src`. */
export function insertCols(el: TableEl, at: number, count = 1, src = Math.max(0, Math.min(el.cols.length - 1, at - 1))): TableEl {
  const regions = regionsOf(el).map((g) => (g.c >= at ? { ...g, c: g.c + count } : g.c + g.cs > at ? { ...g, cs: g.cs + count } : g));
  const cols = [...el.cols];
  cols.splice(at, 0, ...Array<number>(count).fill(el.cols[src]!));
  return rebuild(el, cols, el.rows.map((r) => r.h), regions, (r) => blankLike(formatSource(el, r, src)));
}

/** Deletes rows r1..r2; null when that would leave no rows (the table goes). */
export function deleteRows(el: TableEl, r1: number, r2: number): TableEl | null {
  const a = Math.max(0, Math.min(r1, r2));
  const b = Math.min(el.rows.length - 1, Math.max(r1, r2));
  const n = b - a + 1;
  if (n >= el.rows.length) return null;
  const regions = regionsOf(el).flatMap((g): Region[] => {
    const end = g.r + g.rs - 1;
    const overlap = Math.max(0, Math.min(end, b) - Math.max(g.r, a) + 1);
    if (overlap === g.rs) return [];
    const r = g.r > b ? g.r - n : g.r >= a ? a : g.r;
    return [{ ...g, r, rs: g.rs - overlap }];
  });
  const heights = el.rows.map((r) => r.h);
  heights.splice(a, n);
  return rebuild(el, [...el.cols], heights, regions, (r, c) => blankLike(formatSource(el, Math.min(r, el.rows.length - 1), c)));
}

export function deleteCols(el: TableEl, c1: number, c2: number): TableEl | null {
  const a = Math.max(0, Math.min(c1, c2));
  const b = Math.min(el.cols.length - 1, Math.max(c1, c2));
  const n = b - a + 1;
  if (n >= el.cols.length) return null;
  const regions = regionsOf(el).flatMap((g): Region[] => {
    const end = g.c + g.cs - 1;
    const overlap = Math.max(0, Math.min(end, b) - Math.max(g.c, a) + 1);
    if (overlap === g.cs) return [];
    const c = g.c > b ? g.c - n : g.c >= a ? a : g.c;
    return [{ ...g, c, cs: g.cs - overlap }];
  });
  const cols = [...el.cols];
  cols.splice(a, n);
  return rebuild(el, cols, el.rows.map((r) => r.h), regions, (r, c) => blankLike(formatSource(el, r, Math.min(c, el.cols.length - 1))));
}

// ------------------------------------------------------------------------------------------------ merge and split

const isEmptyText = (c: TableCell): boolean => !c.text || JSON.stringify(c.text.doc).indexOf('"text"') < 0;

/** Merges the cells of a range into one; the text of the others is added after the first one's, paragraph by paragraph. */
export function mergeCells(el: TableEl, range: CellRange): TableEl {
  const rg = expandRange(el, range);
  const inside = regionsOf(el).filter((g) => g.r >= rg.r1 && g.r + g.rs - 1 <= rg.r2 && g.c >= rg.c1 && g.c + g.cs - 1 <= rg.c2);
  if (inside.length < 2) return el;
  inside.sort((a, b) => a.r - b.r || a.c - b.c);
  const first = inside[0]!;
  const firstParas = ((first.cell.text?.doc ?? emptyDocJson()) as { content?: unknown[] }).content ?? [];
  const others = inside.slice(1).filter((g) => !isEmptyText(g.cell)).flatMap((g) => (g.cell.text!.doc as { content?: unknown[] }).content ?? []);
  const paras = isEmptyText(first.cell) && others.length ? others : [...firstParas, ...others];
  const doc = { type: 'doc', content: paras.length ? paras : firstParas };
  const merged: Region = { r: rg.r1, c: rg.c1, rs: rg.r2 - rg.r1 + 1, cs: rg.c2 - rg.c1 + 1, cell: { ...first.cell, text: { body: first.cell.text?.body ?? {}, ...(first.cell.text?.lst ? { lst: first.cell.text.lst } : {}), doc } } };
  const rest = regionsOf(el).filter((g) => !inside.includes(g));
  return rebuild(el, [...el.cols], el.rows.map((r) => r.h), [...rest, merged], (r, c) => blankLike(formatSource(el, r, c)));
}

const partition = (total: number, n: number): number[] => {
  const k = Math.max(1, Math.min(n, total));
  const base = Math.floor(total / k);
  return Array.from({ length: k }, (_v, i) => (i === k - 1 ? total - base * (k - 1) : base));
};

/** Splits a cell into `nr` rows × `nc` columns; an unmerged cell makes the grid bigger (the cells beside it span the new lines). */
export function splitCell(el: TableEl, r: number, c: number, nr: number, nc: number): TableEl {
  const o = originOf(el, r, c);
  const all = regionsOf(el);
  const reg = all.find((g) => g.r === o.r && g.c === o.c);
  if (!reg || (nr <= 1 && nc <= 1)) return el;
  let out = all.map((g) => ({ ...g }));
  const cols = [...el.cols];
  const heights = el.rows.map((x) => x.h);
  const target = () => out.find((g) => g.cell === reg.cell)!;
  if (nc > reg.cs) {
    const k = nc - reg.cs;
    const j = reg.c + reg.cs - 1;
    const W = sum(cols.slice(reg.c, reg.c + reg.cs));
    out = out.map((g) => (g.c > j ? { ...g, c: g.c + k } : g.c <= j && g.c + g.cs > j ? { ...g, cs: g.cs + k } : g));
    cols.splice(j + 1, 0, ...Array<number>(k).fill(0));
    for (let i = 0; i < nc; i++) cols[reg.c + i] = W / nc;
  }
  if (nr > reg.rs) {
    const k = nr - reg.rs;
    const j = reg.r + reg.rs - 1;
    const H = sum(heights.slice(reg.r, reg.r + reg.rs));
    out = out.map((g) => (g.r > j ? { ...g, r: g.r + k } : g.r <= j && g.r + g.rs > j ? { ...g, rs: g.rs + k } : g));
    heights.splice(j + 1, 0, ...Array<number>(k).fill(0));
    for (let i = 0; i < nr; i++) heights[reg.r + i] = Math.max(MIN, H / nr);
  }
  const t = target();
  const rest = out.filter((g) => g !== t);
  const pr = partition(t.rs, nr);
  const pc = partition(t.cs, nc);
  let rr = t.r;
  pr.forEach((hs, i) => {
    let cc = t.c;
    pc.forEach((ws, j) => {
      rest.push({ r: rr, c: cc, rs: hs, cs: ws, cell: i === 0 && j === 0 ? t.cell : blankLike(t.cell) });
      cc += ws;
    });
    rr += hs;
  });
  return rebuild(el, cols, heights, rest, () => blankLike(reg.cell));
}

export const isMerged = (el: TableEl, r: number, c: number): boolean => {
  const s = spanOf(el, r, c);
  return s.r2 > s.r1 || s.c2 > s.c1;
};

// ------------------------------------------------------------------------------------------------ cell properties

/** The cells (origins) of a range, in reading order. */
export function cellsOf(el: TableEl, range: CellRange): { r: number; c: number; cell: TableCell }[] {
  const rg = expandRange(el, range);
  return regionsOf(el)
    .filter((g) => g.r >= rg.r1 && g.r <= rg.r2 && g.c >= rg.c1 && g.c <= rg.c2)
    .map((g) => ({ r: g.r, c: g.c, cell: g.cell }));
}

/** Changes the cells of a range (`fn` returns the changed cell). */
export function mapCells(el: TableEl, range: CellRange, fn: (c: TableCell, r: number, col: number) => TableCell): TableEl {
  const keep = new Set(cellsOf(el, range).map((x) => `${x.r},${x.c}`));
  return {
    ...el,
    rows: el.rows.map((row, r) => ({ ...row, cells: row.cells.map((cell, c) => (keep.has(`${r},${c}`) ? fn(cell, r, c) : cell)) })),
  };
}

export const setCellFill = (el: TableEl, range: CellRange, fill: Fill | undefined): TableEl => mapCells(el, range, (c) => ({ ...c, fill }));

export function clearCells(el: TableEl, range: CellRange): TableEl {
  return mapCells(el, range, (c) => ({ ...c, text: blankLike(c).text }));
}

export type BorderMode = 'all' | 'none' | 'outer' | 'inner' | 'insideH' | 'insideV' | 'top' | 'bottom' | 'left' | 'right';
export const NO_LINE: Ln = { w: 0, fill: { t: 'none' } };

/** Draws (or, with `ln` null, removes) borders around and inside a range. A shared edge is set on both cells that touch it. */
export function setBorders(el: TableEl, range: CellRange, mode: BorderMode, ln: Ln | null): TableEl {
  const rg = expandRange(el, range);
  const line = ln ?? NO_LINE;
  const rows = el.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c })) }));
  const at = (r: number, c: number): TableCell | undefined => {
    if (r < 0 || c < 0 || r >= rows.length || c >= el.cols.length) return undefined;
    const o = originOf(el, r, c);
    return rows[o.r]!.cells[o.c];
  };
  for (const g of regionsOf(el)) {
    if (g.r < rg.r1 || g.r + g.rs - 1 > rg.r2 || g.c < rg.c1 || g.c + g.cs - 1 > rg.c2) continue;
    const top = g.r === rg.r1;
    const bottom = g.r + g.rs - 1 === rg.r2;
    const left = g.c === rg.c1;
    const right = g.c + g.cs - 1 === rg.c2;
    const want = {
      t: mode === 'all' || mode === 'none' || (top && (mode === 'outer' || mode === 'top')) || (!top && (mode === 'inner' || mode === 'insideH')),
      b: mode === 'all' || mode === 'none' || (bottom && (mode === 'outer' || mode === 'bottom')) || (!bottom && (mode === 'inner' || mode === 'insideH')),
      l: mode === 'all' || mode === 'none' || (left && (mode === 'outer' || mode === 'left')) || (!left && (mode === 'inner' || mode === 'insideV')),
      r: mode === 'all' || mode === 'none' || (right && (mode === 'outer' || mode === 'right')) || (!right && (mode === 'inner' || mode === 'insideV')),
    };
    const me = rows[g.r]!.cells[g.c]!;
    if (want.t) {
      me.lnT = line;
      for (let c = g.c; c < g.c + g.cs; c++) {
        const n = at(g.r - 1, c);
        if (n) n.lnB = line;
      }
    }
    if (want.b) {
      me.lnB = line;
      for (let c = g.c; c < g.c + g.cs; c++) {
        const n = at(g.r + g.rs, c);
        if (n) n.lnT = line;
      }
    }
    if (want.l) {
      me.lnL = line;
      for (let r = g.r; r < g.r + g.rs; r++) {
        const n = at(r, g.c - 1);
        if (n) n.lnR = line;
      }
    }
    if (want.r) {
      me.lnR = line;
      for (let r = g.r; r < g.r + g.rs; r++) {
        const n = at(r, g.c + g.cs);
        if (n) n.lnL = line;
      }
    }
  }
  return { ...el, rows };
}

// ------------------------------------------------------------------------------------------------ sizes

export function setColWidth(el: TableEl, i: number, w: number, pair = true): TableEl {
  const cols = [...el.cols];
  const next = Math.max(MIN, w);
  if (pair && i < cols.length - 1) {
    const room = cols[i]! + cols[i + 1]! - MIN;
    const wi = Math.min(next, room);
    cols[i + 1] = cols[i]! + cols[i + 1]! - wi;
    cols[i] = wi;
  } else cols[i] = next;
  return withGeometry({ ...el, cols });
}

export function setRowHeight(el: TableEl, i: number, h: number): TableEl {
  return withGeometry({ ...el, rows: el.rows.map((r, k) => (k === i ? { ...r, h: Math.max(MIN, h) } : r)) });
}

export function distributeRows(el: TableEl, r1: number, r2: number): TableEl {
  const a = Math.min(r1, r2);
  const b = Math.max(r1, r2);
  const each = sum(el.rows.slice(a, b + 1).map((r) => r.h)) / (b - a + 1);
  return withGeometry({ ...el, rows: el.rows.map((r, k) => (k >= a && k <= b ? { ...r, h: each } : r)) });
}

export function distributeCols(el: TableEl, c1: number, c2: number): TableEl {
  const a = Math.min(c1, c2);
  const b = Math.max(c1, c2);
  const each = sum(el.cols.slice(a, b + 1)) / (b - a + 1);
  return withGeometry({ ...el, cols: el.cols.map((w, k) => (k >= a && k <= b ? each : w)) });
}

/** The table with the given width and height: columns and rows keep their proportions. */
export function scaleTable(el: TableEl, w: number, h: number): TableEl {
  const cur = tableSize(el);
  const kx = cur.w ? w / cur.w : 1;
  const ky = cur.h ? h / cur.h : 1;
  return withGeometry({ ...el, cols: el.cols.map((c) => Math.max(MIN, c * kx)), rows: el.rows.map((r) => ({ ...r, h: Math.max(MIN, r.h * ky) })) });
}

// ------------------------------------------------------------------------------------------------ styles

export const BUILTIN_STYLE = {
  grid: '{5940675A-B579-460E-94D1-54222C63F5DA}',
  none: '{2D5ABB26-0587-4C30-8999-92F81FD0307C}',
  medium2: ['{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}', '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE0}', '{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}', '{00A15C55-8517-42AA-B614-E9B94910E393}', '{7DF18680-E054-41AD-8BC1-D1AEF772440D}', '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}'],
} as const;

const solid = (c: Clr): Fill => ({ t: 'solid', c });
const acc = (n: number, mods?: Clr['mods']): Clr => ({ scheme: `accent${n}` as Clr['scheme'], ...(mods ? { mods } : {}) });
const line = (c: Clr, w = 1): Ln => ({ w, fill: solid(c) });

export type StyleFamily = 'medium2' | 'light' | 'grid' | 'dark';
export const STYLE_FAMILIES: { id: StyleFamily; name: string }[] = [
  { id: 'medium2', name: 'Medio' },
  { id: 'light', name: 'Claro' },
  { id: 'grid', name: 'Cuadrícula' },
  { id: 'dark', name: 'Oscuro' },
];

/** The definition of a style of a family in an accent colour (1–6). */
export function tableStyleFor(family: StyleFamily, accent: number): TableStyleDef {
  const a = acc(accent);
  const white = line({ scheme: 'lt1' });
  const name = (n: string) => `${n} - Énfasis ${accent}`;
  if (family === 'medium2') {
    return {
      id: BUILTIN_STYLE.medium2[accent - 1]!,
      name: name('Estilo medio 2'),
      wholeTbl: { fill: solid(acc(accent, [{ t: 'tint', v: 20000 }])), ln: { l: white, r: white, t: white, b: white, insideH: white, insideV: white }, rPr: { color: { scheme: 'dk1' } } },
      band1H: { fill: solid(acc(accent, [{ t: 'tint', v: 40000 }])) },
      band1V: { fill: solid(acc(accent, [{ t: 'tint', v: 40000 }])) },
      firstRow: { fill: solid(a), rPr: { b: true, color: { scheme: 'lt1' } }, ln: { b: line({ scheme: 'lt1' }, 3) } },
      lastRow: { fill: solid(a), rPr: { b: true, color: { scheme: 'lt1' } }, ln: { t: line({ scheme: 'lt1' }, 3) } },
      firstCol: { fill: solid(a), rPr: { b: true, color: { scheme: 'lt1' } } },
      lastCol: { fill: solid(a), rPr: { b: true, color: { scheme: 'lt1' } } },
    };
  }
  const guid = (f: number) => `{4E4F5641-000${f}-4000-8000-00000000000${accent}}`;
  if (family === 'light') {
    const thin = line(a, 1);
    return {
      id: guid(1),
      name: name('Claro con líneas'),
      wholeTbl: { ln: { t: thin, b: thin, insideH: line(acc(accent, [{ t: 'tint', v: 40000 }]), 0.75) }, rPr: { color: { scheme: 'dk1' } } },
      band1H: { fill: solid(acc(accent, [{ t: 'tint', v: 20000 }])) },
      band1V: { fill: solid(acc(accent, [{ t: 'tint', v: 20000 }])) },
      firstRow: { rPr: { b: true, color: a }, ln: { b: line(a, 2) } },
      lastRow: { rPr: { b: true }, ln: { t: line(a, 2) } },
      firstCol: { rPr: { b: true } },
      lastCol: { rPr: { b: true } },
    };
  }
  if (family === 'grid') {
    const all = line(a, 1);
    return {
      id: guid(2),
      name: name('Cuadrícula'),
      wholeTbl: { ln: { l: all, r: all, t: all, b: all, insideH: all, insideV: all }, rPr: { color: { scheme: 'dk1' } } },
      band1H: { fill: solid(acc(accent, [{ t: 'tint', v: 20000 }])) },
      band1V: { fill: solid(acc(accent, [{ t: 'tint', v: 20000 }])) },
      firstRow: { fill: solid(a), rPr: { b: true, color: { scheme: 'lt1' } } },
      lastRow: { fill: solid(a), rPr: { b: true, color: { scheme: 'lt1' } } },
      firstCol: { rPr: { b: true } },
      lastCol: { rPr: { b: true } },
    };
  }
  const thin = line({ scheme: 'lt1' }, 0.75);
  return {
    id: guid(3),
    name: name('Oscuro'),
    wholeTbl: { fill: solid(acc(accent, [{ t: 'shade', v: 70000 }])), ln: { insideH: thin, insideV: thin }, rPr: { color: { scheme: 'lt1' } } },
    band1H: { fill: solid(acc(accent, [{ t: 'shade', v: 50000 }])) },
    band1V: { fill: solid(acc(accent, [{ t: 'shade', v: 50000 }])) },
    firstRow: { fill: solid({ scheme: 'dk1' }), rPr: { b: true, color: { scheme: 'lt1' } }, ln: { b: line(a, 3) } },
    lastRow: { fill: solid({ scheme: 'dk1' }), rPr: { b: true, color: { scheme: 'lt1' } }, ln: { t: line(a, 3) } },
    firstCol: { fill: solid(acc(accent, [{ t: 'shade', v: 40000 }])), rPr: { b: true, color: { scheme: 'lt1' } } },
    lastCol: { fill: solid(acc(accent, [{ t: 'shade', v: 40000 }])), rPr: { b: true, color: { scheme: 'lt1' } } },
  };
}

/** The style named by an id, when it is one of ours (or one PowerPoint calls Medium Style 2). */
export function knownTableStyle(id: string | undefined): TableStyleDef | undefined {
  if (!id) return undefined;
  for (const f of STYLE_FAMILIES) for (let a = 1; a <= 6; a++) if (tableStyleFor(f.id, a).id === id) return tableStyleFor(f.id, a);
  return undefined;
}

export type { TableStylePart };

/** Gives a table a style; its definition goes into the presentation's styles when it is not already there. */
export function applyTableStyle<D extends { tableStyles?: TableStyleDef[] }>(deck: D, styleDef: TableStyleDef | null, noneKind?: 'grid' | 'none'): { deck: D; id: string } {
  if (!styleDef) return { deck, id: noneKind === 'grid' ? BUILTIN_STYLE.grid : BUILTIN_STYLE.none };
  const has = deck.tableStyles?.some((s) => s.id === styleDef.id);
  return { deck: has ? deck : { ...deck, tableStyles: [...(deck.tableStyles ?? []), styleDef] }, id: styleDef.id };
}

/** The text of one cell (its origin) replaced by a new document. */
export function setCellDoc(el: TableEl, r: number, c: number, doc: unknown): TableEl {
  return {
    ...el,
    rows: el.rows.map((row, i) => (i !== r ? row : { ...row, cells: row.cells.map((cell, j) => (j !== c ? cell : { ...cell, text: { body: cell.text?.body ?? {}, ...(cell.text?.lst ? { lst: cell.text.lst } : {}), doc } })) })),
  };
}

/** Origin cells in reading order (merged-away cells left out). */
export function originCells(el: TableEl): [number, number][] {
  const out: [number, number][] = [];
  el.rows.forEach((row, r) => row.cells.forEach((cell, c) => (cell.hMerge || cell.vMerge ? undefined : out.push([r, c]))));
  return out;
}
