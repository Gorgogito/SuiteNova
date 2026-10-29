import { ymdFromSerial } from './dates';
import type { PivotAgg, PivotDef, PivotGroup, PivotValueField } from './objects';
import { CalcError, E, isErr, type Scalar } from './values';

/** Words the output uses; the application passes the ones for the interface language. */
export interface PivotLabels {
  rowLabels: string;
  colLabels: string;
  grandTotal: string;
  total: string;
  blank: string;
  all: string;
  multiple: string;
  /** "Suma de {0}" */
  agg: Record<PivotAgg, string>;
  months: string[];
  quarter: string;
}

export const PIVOT_LABELS_ES: PivotLabels = {
  rowLabels: 'Etiquetas de fila',
  colLabels: 'Etiquetas de columna',
  grandTotal: 'Total general',
  total: 'Total',
  blank: '(en blanco)',
  all: '(Todas)',
  multiple: '(Varios elementos)',
  agg: {
    sum: 'Suma de {0}',
    count: 'Cuenta de {0}',
    countNums: 'Cuenta de números de {0}',
    average: 'Promedio de {0}',
    max: 'Máx de {0}',
    min: 'Mín de {0}',
    product: 'Producto de {0}',
    stdev: 'Desvest de {0}',
    stdevp: 'Desvestp de {0}',
    var: 'Var de {0}',
    varp: 'Varp de {0}',
  },
  months: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  quarter: 'Trim.{0}',
};

export const PIVOT_LABELS_EN: PivotLabels = {
  rowLabels: 'Row Labels',
  colLabels: 'Column Labels',
  grandTotal: 'Grand Total',
  total: 'Total',
  blank: '(blank)',
  all: '(All)',
  multiple: '(Multiple Items)',
  agg: {
    sum: 'Sum of {0}',
    count: 'Count of {0}',
    countNums: 'Count Numbers of {0}',
    average: 'Average of {0}',
    max: 'Max of {0}',
    min: 'Min of {0}',
    product: 'Product of {0}',
    stdev: 'StdDev of {0}',
    stdevp: 'StdDevp of {0}',
    var: 'Var of {0}',
    varp: 'Varp of {0}',
  },
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  quarter: 'Qtr{0}',
};

export interface PivotData {
  headers: string[];
  rows: Scalar[][];
}

export type PivotCellKind = 'filterName' | 'filterValue' | 'caption' | 'colLabel' | 'rowLabel' | 'corner' | 'value' | 'subtotalLabel' | 'subtotalValue' | 'grandLabel' | 'grandValue';

export interface PivotCell {
  /** Relative to the top-left cell of the pivot. */
  row: number;
  col: number;
  value: Scalar;
  kind: PivotCellKind;
  indent?: number;
  numFmt?: string;
}

export interface PivotOutput {
  cells: PivotCell[];
  rows: number;
  cols: number;
  /** The value in a cell for a value field and the items chosen for some fields (fewer fields give a subtotal). */
  lookup(valueIndex: number, items: Record<string, string>): Scalar | undefined;
  /** Distinct items of a field in display order (all of them, before any selection hides some). */
  items(field: string): { key: string; label: string }[];
  /** Caption of each value field as shown. */
  captions: string[];
}

interface Item {
  key: string;
  label: string;
  /** The number an item stands for, so its label can be written as a number. */
  num?: number;
  /** [kind rank, value]: numbers, then text, then booleans, then blanks. */
  sort: [number, number | string];
}

const SEP = '\u0001';

export function valueCaption(v: PivotValueField, labels: PivotLabels): string {
  return v.name && v.name.trim() ? v.name : labels.agg[v.agg].replace('{0}', v.field);
}

function toItem(v: Scalar, group: PivotGroup | undefined, labels: PivotLabels): Item {
  if (v === null || v === '') return { key: '\u0000blank', label: labels.blank, sort: [3, 0] };
  if (isErr(v)) return { key: `#${v.code}`, label: v.code, sort: [3, 1] };
  if (group && typeof v === 'number') {
    if (group.kind === 'number') {
      const step = group.step && group.step > 0 ? group.step : 1;
      const start = group.start ?? 0;
      const end = group.end ?? Infinity;
      if (v < start) return { key: '\u0000lo', label: `<${start}`, sort: [0, -Infinity] };
      if (v > end) return { key: '\u0000hi', label: `>${end}`, sort: [0, Infinity] };
      const i = Math.floor((v - start) / step);
      const lo = start + i * step;
      return { key: `n${i}`, label: `${lo}-${lo + step}`, sort: [0, lo] };
    }
    const { y, m, d } = ymdFromSerial(v);
    if (group.kind === 'year') return { key: `y${y}`, label: String(y), num: y, sort: [0, y] };
    if (group.kind === 'quarter') {
      const q = Math.ceil(m / 3);
      return { key: `q${q}`, label: labels.quarter.replace('{0}', String(q)), sort: [0, q] };
    }
    if (group.kind === 'month') return { key: `m${m}`, label: labels.months[m - 1]!, sort: [0, m] };
    return { key: `d${m}-${d}`, label: `${d}-${labels.months[m - 1]}`, sort: [0, m * 100 + d] };
  }
  if (typeof v === 'number') return { key: `n${v}`, label: String(v), num: v, sort: [0, v] };
  if (typeof v === 'boolean') return { key: `b${v}`, label: v ? 'TRUE' : 'FALSE', sort: [2, v ? 1 : 0] };
  return { key: `s${v.toLowerCase()}`, label: v, sort: [1, v.toLowerCase()] };
}

function compareItems(a: Item, b: Item): number {
  if (a.sort[0] !== b.sort[0]) return a.sort[0] - b.sort[0];
  const x = a.sort[1];
  const y = b.sort[1];
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true });
}

interface Acc {
  n: number;
  nn: number;
  sum: number;
  min: number;
  max: number;
  prod: number;
  mean: number;
  m2: number;
}
const newAcc = (): Acc => ({ n: 0, nn: 0, sum: 0, min: Infinity, max: -Infinity, prod: 1, mean: 0, m2: 0 });

function addTo(a: Acc, v: Scalar): void {
  if (v === null || v === '') return;
  a.n++;
  if (typeof v !== 'number') return;
  a.nn++;
  a.sum += v;
  if (v < a.min) a.min = v;
  if (v > a.max) a.max = v;
  a.prod *= v;
  const d = v - a.mean;
  a.mean += d / a.nn;
  a.m2 += d * (v - a.mean);
}

function aggregate(a: Acc | undefined, agg: PivotAgg): Scalar {
  if (!a) return null;
  switch (agg) {
    case 'sum':
      return a.nn ? a.sum : a.n ? 0 : null;
    case 'count':
      return a.n || null;
    case 'countNums':
      return a.nn || null;
    case 'average':
      return a.nn ? a.sum / a.nn : a.n ? E.DIV0 : null;
    case 'max':
      return a.nn ? a.max : a.n ? 0 : null;
    case 'min':
      return a.nn ? a.min : a.n ? 0 : null;
    case 'product':
      return a.nn ? a.prod : a.n ? 0 : null;
    case 'stdev':
      return a.nn > 1 ? Math.sqrt(a.m2 / (a.nn - 1)) : a.n ? E.DIV0 : null;
    case 'stdevp':
      return a.nn > 0 ? Math.sqrt(a.m2 / a.nn) : a.n ? E.DIV0 : null;
    case 'var':
      return a.nn > 1 ? a.m2 / (a.nn - 1) : a.n ? E.DIV0 : null;
    default:
      return a.nn > 0 ? a.m2 / a.nn : a.n ? E.DIV0 : null;
  }
}

interface Node {
  item: Item;
  /** Key of the path from the root to this node (the accumulator key). */
  path: string;
  children: Node[];
}

function buildTree(tuples: Item[][], depth: number, prefix: string, sortDir: (level: number) => 1 | -1): Node[] {
  const level = prefix === '' ? 0 : prefix.split(SEP).length;
  const byKey = new Map<string, { item: Item; rest: Item[][] }>();
  for (const t of tuples) {
    const it = t[0]!;
    let e = byKey.get(it.key);
    if (!e) byKey.set(it.key, (e = { item: it, rest: [] }));
    if (t.length > 1) e.rest.push(t.slice(1));
  }
  const dir = sortDir(level);
  const nodes = [...byKey.values()].sort((a, b) => dir * compareItems(a.item, b.item));
  return nodes.map((e) => {
    const path = prefix === '' ? e.item.key : prefix + SEP + e.item.key;
    return { item: e.item, path, children: depth > 1 ? buildTree(e.rest, depth - 1, path, sortDir) : [] };
  });
}

interface Line {
  kind: 'item' | 'subtotal' | 'grand' | 'blank';
  path: string;
  /** Labels of the row fields for this line ('' where not shown). */
  labels: string[];
  depth: number;
  hasValues: boolean;
  /** Group header lines (their items have children). */
  isGroup: boolean;
}

interface Leaf {
  kind: 'item' | 'subtotal' | 'grand';
  path: string;
  /** One label per header level; '' where the label of the previous leaf of the group still applies. */
  labels: string[];
  valueIndex: number;
}

/** Compute and lay out a pivot table from its definition and source data. */
export function computePivot(def: PivotDef, data: PivotData, labels: PivotLabels = PIVOT_LABELS_ES): PivotOutput {
  const idx = (name: string) => data.headers.findIndex((h) => h === name);
  const R = def.rows.filter((f) => idx(f) >= 0);
  const C = def.cols.filter((f) => idx(f) >= 0);
  const V = def.values.filter((v) => idx(v.field) >= 0);
  const F = def.filters.filter((f) => idx(f) >= 0);
  const captions = V.map((v) => valueCaption(v, labels));

  // ---- items of every field (before selection), and which records pass the selection
  const itemOf = (name: string, rec: Scalar[]) => toItem(rec[idx(name)] ?? null, def.groups[name], labels);
  const selected = new Map<string, Set<string>>();
  for (const f of [...R, ...C, ...F, ...Object.keys(def.selection)]) {
    const sel = def.selection[f];
    if (sel) selected.set(f, new Set(sel));
  }
  const allItems = new Map<string, Map<string, Item>>();
  // fields only used by a slicer or a filter selection are filtered on as well
  const fieldNames = new Set([...R, ...C, ...F, ...Object.keys(def.selection).filter((k) => idx(k) >= 0)]);
  for (const f of fieldNames) allItems.set(f, new Map());
  const passing: Scalar[][] = [];
  for (const rec of data.rows) {
    let ok = true;
    const its = new Map<string, Item>();
    for (const f of fieldNames) {
      const it = itemOf(f, rec);
      its.set(f, it);
      allItems.get(f)!.set(it.key, it);
      const sel = selected.get(f);
      if (sel && !sel.has(it.key)) ok = false;
    }
    if (ok) passing.push(rec);
  }
  const orderedItems = (f: string): Item[] => {
    const dir = def.sort[f] === 'desc' ? -1 : 1;
    if (!allItems.has(f) && idx(f) >= 0) {
      const m = new Map<string, Item>();
      for (const rec of data.rows) {
        const it = itemOf(f, rec);
        m.set(it.key, it);
      }
      allItems.set(f, m);
    }
    return [...(allItems.get(f)?.values() ?? [])].sort((a, b) => dir * compareItems(a, b));
  };

  // ---- accumulate every prefix of the row and column paths
  const acc = new Map<string, Acc>();
  const rowTuples = new Map<string, Item[]>();
  const colTuples = new Map<string, Item[]>();
  const accKey = (rp: string, cp: string, vi: number) => `${rp}\u0002${cp}\u0002${vi}`;
  for (const rec of passing) {
    const rt = R.map((f) => itemOf(f, rec));
    const ct = C.map((f) => itemOf(f, rec));
    const rowPaths: string[] = [''];
    for (let l = 1; l <= rt.length; l++) rowPaths.push(rt.slice(0, l).map((i) => i.key).join(SEP));
    const colPaths: string[] = [''];
    for (let l = 1; l <= ct.length; l++) colPaths.push(ct.slice(0, l).map((i) => i.key).join(SEP));
    if (R.length) rowTuples.set(rowPaths[R.length]!, rt);
    if (C.length) colTuples.set(colPaths[C.length]!, ct);
    V.forEach((v, vi) => {
      const value = rec[idx(v.field)] ?? null;
      for (const rp of rowPaths) {
        for (const cp of colPaths) {
          const k = accKey(rp, cp, vi);
          let a = acc.get(k);
          if (!a) acc.set(k, (a = newAcc()));
          addTo(a, value);
        }
      }
    });
  }
  const valueAt = (rp: string, cp: string, vi: number): Scalar => {
    const v = V[vi];
    if (!v) return null;
    const raw = aggregate(acc.get(accKey(rp, cp, vi)), v.agg);
    const show = v.showAs ?? 'normal';
    if (show === 'normal' || typeof raw !== 'number') return raw;
    const base =
      show === 'percentOfGrand'
        ? aggregate(acc.get(accKey('', '', vi)), v.agg)
        : show === 'percentOfCol'
          ? aggregate(acc.get(accKey('', cp, vi)), v.agg)
          : aggregate(acc.get(accKey(rp, '', vi)), v.agg);
    if (typeof base !== 'number') return E.DIV0;
    return base === 0 ? E.DIV0 : raw / base;
  };

  // ---- trees
  const rowDir = (l: number): 1 | -1 => (def.sort[R[l]!] === 'desc' ? -1 : 1);
  const colDir = (l: number): 1 | -1 => (def.sort[C[l]!] === 'desc' ? -1 : 1);
  const rowTree = R.length ? buildTree([...rowTuples.values()], R.length, '', rowDir) : [];
  const colTree = C.length ? buildTree([...colTuples.values()], C.length, '', colDir) : [];

  // ---- row lines
  const lines: Line[] = [];
  const labelsFor = (path: Item[], showAll: boolean, prev: Item[] | null): string[] => path.map((it, i) => (showAll || !prev || prev[i]?.key !== it.key || path.slice(0, i).some((p, j) => prev[j]?.key !== p.key) ? it.label : ''));
  const walkRows = (nodes: Node[], trail: Item[], depth: number): void => {
    for (const n of nodes) {
      const path = [...trail, n.item];
      const isLeaf = depth === R.length - 1;
      if (def.layout === 'tabular') {
        if (isLeaf) {
          const prev = lastLeaf;
          lines.push({ kind: 'item', path: n.path, labels: labelsFor(path, def.repeatLabels, prev), depth, hasValues: true, isGroup: false });
          lastLeaf = path;
        } else {
          walkRows(n.children, path, depth + 1);
          lastLeaf = null;
          if (def.subtotals) lines.push({ kind: 'subtotal', path: n.path, labels: [...path.map((_p, i) => (i === depth ? `${n.item.label} ${labels.total}` : '')), ...Array.from({ length: R.length - path.length }, () => '')], depth, hasValues: true, isGroup: false });
          if (depth === 0 && def.blankRowAfterItem) lines.push({ kind: 'blank', path: '', labels: [], depth, hasValues: false, isGroup: false });
        }
      } else {
        const showValues = isLeaf || def.subtotals;
        lines.push({ kind: 'item', path: n.path, labels: def.layout === 'compact' ? [n.item.label] : path.map((p, i) => (i === depth ? p.label : '')), depth, hasValues: showValues, isGroup: !isLeaf });
        if (!isLeaf) walkRows(n.children, path, depth + 1);
        if (depth === 0 && def.blankRowAfterItem) lines.push({ kind: 'blank', path: '', labels: [], depth, hasValues: false, isGroup: false });
      }
    }
  };
  let lastLeaf: Item[] | null = null;
  if (R.length) walkRows(rowTree, [], 0);
  else lines.push({ kind: 'item', path: '', labels: [], depth: 0, hasValues: true, isGroup: false });
  if (R.length && def.grandRows) lines.push({ kind: 'grand', path: '', labels: [], depth: 0, hasValues: true, isGroup: false });

  // ---- column leaves
  const leaves: Leaf[] = [];
  const valueLevel = V.length > 1;
  const pushLeaf = (kind: Leaf['kind'], path: string, labelsAtLevels: string[]) => {
    if (!valueLevel) {
      leaves.push({ kind, path, labels: labelsAtLevels, valueIndex: 0 });
      return;
    }
    V.forEach((_v, vi) => leaves.push({ kind, path, labels: [...labelsAtLevels.map((l) => (vi === 0 ? l : '')), captions[vi]!], valueIndex: vi }));
  };
  const walkCols = (nodes: Node[], trail: Item[], depth: number): void => {
    for (const n of nodes) {
      const path = [...trail, n.item];
      if (depth === C.length - 1) {
        pushLeaf('item', n.path, path.map((p) => p.label));
      } else {
        walkCols(n.children, path, depth + 1);
        if (def.subtotals && C.length > 1) pushLeaf('subtotal', n.path, Array.from({ length: C.length }, (_x, l) => (l === depth ? `${n.item.label} ${labels.total}` : '')));
      }
    }
  };
  if (C.length) {
    walkCols(colTree, [], 0);
    if (def.grandCols) pushLeaf('grand', '', Array.from({ length: C.length }, (_x, l) => (l === 0 ? labels.grandTotal : '')));
    // a group name is printed once, above the first column of the group
    let prev: string[] | null = null;
    for (const lf of leaves) {
      if (lf.kind !== 'item') {
        prev = null;
        continue;
      }
      if (lf.valueIndex !== 0) continue;
      const full = lf.labels.slice(0, C.length);
      if (prev) for (let l = 0; l < C.length; l++) {
        if (full.slice(0, l + 1).every((x, j) => x === prev![j])) lf.labels[l] = '';
        else break;
      }
      prev = full;
    }
  } else if (valueLevel) {
    V.forEach((_v, vi) => leaves.push({ kind: 'item', path: '', labels: [captions[vi]!], valueIndex: vi }));
  } else leaves.push({ kind: 'item', path: '', labels: [captions[0] ?? ''], valueIndex: 0 });
  const headerLevels = C.length + (valueLevel ? 1 : 0) || 1;

  // ---- write cells
  const cells: PivotCell[] = [];
  // labels of numeric items are written as numbers, like the cells they came from
  const numeric = new Map<string, number>();
  for (const m of allItems.values()) for (const it of m.values()) if (it.num !== undefined) numeric.set(it.label, it.num);
  const put = (row: number, col: number, value: Scalar, kind: PivotCellKind, extra: Partial<PivotCell> = {}) => {
    const asNumber = typeof value === 'string' && (kind === 'rowLabel' || kind === 'colLabel') ? numeric.get(value) : undefined;
    cells.push({ row, col, value: asNumber ?? value, kind, ...extra });
  };
  let row0 = 0;
  F.forEach((f, i) => {
    const sel = def.selection[f];
    const all = orderedItems(f);
    const shown = !sel || sel.length === all.length ? labels.all : sel.length === 1 ? (all.find((x) => x.key === sel[0])?.label ?? labels.all) : labels.multiple;
    put(i, 0, f, 'filterName');
    put(i, 1, shown, 'filterValue');
  });
  if (F.length) row0 = F.length + 1;

  const labelCols = def.layout === 'compact' || R.length === 0 ? 1 : R.length;
  const hasColFields = C.length > 0;
  // header rows: a caption row (when there are column fields) and one row per level
  const captionRows = hasColFields ? 1 : 0;
  const headerRows = captionRows + headerLevels;
  const dataRow0 = row0 + headerRows;
  if (hasColFields) {
    put(row0, 0, V.length === 1 ? captions[0]! : null, 'caption');
    put(row0, labelCols, labels.colLabels, 'caption');
  }
  const lastHeader = row0 + headerRows - 1;
  if (def.layout === 'compact' || R.length === 0) {
    put(lastHeader, 0, R.length ? labels.rowLabels : null, 'corner');
  } else {
    R.forEach((f, i) => put(lastHeader, i, f, 'corner'));
  }
  const colStart = labelCols;
  leaves.forEach((lf, ci) => {
    const col = colStart + ci;
    for (let l = 0; l < headerLevels; l++) {
      const label = lf.labels[l] ?? '';
      const r = row0 + captionRows + l;
      // when there is a single level in a layout without column fields the caption is the header
      if (label !== '' || l === headerLevels - 1) put(r, col, label === '' ? null : label, lf.kind === 'grand' && l === 0 ? 'grandLabel' : lf.kind === 'subtotal' ? 'subtotalLabel' : 'colLabel');
    }
  });
  const numFmtOf = (vi: number): string | undefined => {
    const v = V[vi];
    if (!v) return undefined;
    if (v.showAs && v.showAs !== 'normal') return '0.00%';
    return v.numFmt;
  };

  const rowIndex = new Map<string, number>();
  lines.forEach((ln, li) => {
    const r = dataRow0 + li;
    if (ln.kind === 'blank') return;
    if (ln.kind === 'grand') {
      put(r, 0, labels.grandTotal, 'grandLabel');
    } else if (def.layout === 'compact' || R.length === 0) {
      if (R.length) put(r, 0, ln.labels[0] ?? '', ln.kind === 'subtotal' ? 'subtotalLabel' : 'rowLabel', { indent: ln.depth });
      else put(r, 0, labels.grandTotal, 'grandLabel');
    } else {
      ln.labels.forEach((l, i) => {
        if (l !== '') put(r, i, l, ln.kind === 'subtotal' ? 'subtotalLabel' : 'rowLabel');
      });
    }
    if (ln.kind === 'item' || ln.kind === 'grand' || ln.kind === 'subtotal') rowIndex.set(`${ln.kind}\u0003${ln.path}`, r);
    if (!ln.hasValues) return;
    leaves.forEach((lf, ci) => {
      const v = valueAt(ln.path, lf.path, lf.valueIndex);
      if (v === null) return;
      const grandish = ln.kind === 'grand' || lf.kind === 'grand';
      const sub = ln.kind === 'subtotal' || lf.kind === 'subtotal' || ln.isGroup;
      put(r, colStart + ci, v, grandish ? 'grandValue' : sub ? 'subtotalValue' : 'value', { numFmt: numFmtOf(lf.valueIndex) });
    });
  });

  const rows = dataRow0 + lines.length;
  const cols = colStart + leaves.length;

  const items = (f: string) => orderedItems(f).map((i) => ({ key: i.key, label: i.label }));

  const lookup = (vi: number, sel: Record<string, string>): Scalar | undefined => {
    const norm = (s: string) => s.toLowerCase();
    const pathFor = (fields: string[]): string | undefined => {
      const keys: string[] = [];
      for (const f of fields) {
        const want = sel[f];
        if (want === undefined) break;
        const it = orderedItems(f).find((i) => norm(i.label) === norm(want));
        if (!it) return undefined;
        keys.push(it.key);
      }
      return keys.join(SEP);
    };
    for (const f of Object.keys(sel)) if (!R.includes(f) && !C.includes(f)) return undefined;
    const rp = pathFor(R);
    const cp = pathFor(C);
    if (rp === undefined || cp === undefined) return undefined;
    const v = valueAt(rp, cp, vi);
    return v === null ? undefined : v;
  };
  void rowIndex;
  // nothing chosen yet: reserve the area Excel shows its instructions in
  if (!R.length && !C.length && !V.length && !F.length) return { cells: [], rows: 18, cols: 3, lookup, items, captions };
  return { cells, rows, cols, lookup, items, captions };
}

/** Does the pivot lay out its output over this cell? Used to keep other edits out of the pivot. */
export const pivotCovers = (p: PivotDef, row: number, col: number): boolean => !!p.size && row >= p.row && row < p.row + p.size.rows && col >= p.col && col < p.col + p.size.cols;

/** Unique names for the source headers: empty ones are named, repeated ones numbered. */
export function sourceHeaders(raw: Scalar[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = h === null || h === '' ? `Columna${i + 1}` : isErr(h) ? h.code : String(h);
    const k = name.toLowerCase();
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    if (n > 0) name = `${name}${n + 1}`;
    return name;
  });
}

export type { CalcError };
