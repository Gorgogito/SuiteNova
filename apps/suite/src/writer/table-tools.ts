import { nodeTypes } from '@suitenova/writer-core';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { type Command, type EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { TableMap } from 'prosemirror-tables';

/** Tabla que contiene la posición de la selección. */
export function findTable(state: EditorState): { node: PMNode; pos: number; depth: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'table') return { node: n, pos: $from.before(d), depth: d };
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ propiedades
export interface TableProps {
  borders?: boolean;
  align?: 'left' | 'center' | 'right';
  borderColor?: string | null;
  borderWidth?: number | null;
  padding?: { x: number; y: number } | null;
  headerRow?: boolean;
}

/** Cambia las propiedades de la tabla en la que está el cursor. */
export const setTableProps = (p: TableProps): Command => (state, dispatch) => {
  const t = findTable(state);
  if (!t) return false;
  if (dispatch) {
    const attrs: Record<string, unknown> = { ...t.node.attrs, ...p };
    if (p.align !== undefined) attrs.align = p.align === 'left' ? null : p.align;
    dispatch(state.tr.setNodeMarkup(t.pos, undefined, attrs));
  }
  return true;
};

// ------------------------------------------------------------------------------------------------ anchos de columna
/** Anchos actuales de cada columna (px); las que no tienen ancho propio reciben `fallback`. */
export function columnWidths(table: PMNode, fallback = 100): number[] {
  const map = TableMap.get(table);
  const w: (number | undefined)[] = new Array(map.width).fill(undefined);
  const seen = new Set<number>();
  for (let i = 0; i < map.map.length; i++) {
    const off = map.map[i]!;
    if (seen.has(off)) continue;
    seen.add(off);
    const cell = table.nodeAt(off)!;
    const cw = cell.attrs.colwidth as number[] | null;
    const col = i % map.width;
    for (let k = 0; k < (cell.attrs.colspan ?? 1); k++) if (cw?.[k]) w[col + k] = cw[k];
  }
  return w.map((v) => v ?? fallback);
}

function setColumnWidths(state: EditorState, widths: number[], dispatch?: (tr: Transaction) => void): boolean {
  const t = findTable(state);
  if (!t) return false;
  if (!dispatch) return true;
  const map = TableMap.get(t.node);
  const tr = state.tr;
  const seen = new Set<number>();
  for (let i = 0; i < map.map.length; i++) {
    const off = map.map[i]!;
    if (seen.has(off)) continue;
    seen.add(off);
    const cell = t.node.nodeAt(off)!;
    const col = i % map.width;
    const span = cell.attrs.colspan ?? 1;
    tr.setNodeMarkup(t.pos + 1 + off, undefined, { ...cell.attrs, colwidth: widths.slice(col, col + span).map((x) => Math.max(30, Math.round(x))) });
  }
  dispatch(tr);
  return true;
}

/** Reparte el ancho actual de la tabla a partes iguales entre sus columnas. */
export const distributeColumns: Command = (state, dispatch) => {
  const t = findTable(state);
  if (!t) return false;
  const widths = columnWidths(t.node);
  const total = widths.reduce((a, b) => a + b, 0);
  return setColumnWidths(state, widths.map(() => total / widths.length), dispatch);
};

/** Escala las columnas para que la tabla ocupe exactamente `width` px (el ancho útil de la página). */
export const fitColumns = (width: number): Command => (state, dispatch) => {
  const t = findTable(state);
  if (!t) return false;
  const widths = columnWidths(t.node);
  const total = widths.reduce((a, b) => a + b, 0);
  return setColumnWidths(state, widths.map((x) => (x * width) / total), dispatch);
};

// ------------------------------------------------------------------------------------------------ ordenar
/** Texto de una celda para ordenar. */
export const cellText = (cell: PMNode): string => cell.textContent.trim();

/** Compara dos textos: números como números (con coma o punto decimal), el resto con la configuración regional. */
export function compareCells(a: string, b: string, mode: 'text' | 'number'): number {
  if (mode === 'number') {
    const na = parseNumber(a);
    const nb = parseNumber(b);
    if (na === null && nb === null) return 0;
    if (na === null) return 1;
    if (nb === null) return -1;
    return na - nb;
  }
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}
export function parseNumber(s: string): number | null {
  const m = /^[^\d\-+.,]*([-+]?\d[\d.,\s]*)/.exec(s.trim());
  if (!m) return null;
  let x = m[1]!.replace(/\s/g, '');
  const lastDot = x.lastIndexOf('.');
  const lastComma = x.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) x = lastComma > lastDot ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
  else if (lastComma >= 0) x = /,\d{3}$/.test(x) && x.split(',').length > 2 ? x.replace(/,/g, '') : x.replace(',', '.');
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/** Ordena las filas por una columna (la fila de encabezado se queda arriba). No funciona con celdas combinadas verticalmente. */
export const sortTable = (col: number, ascending: boolean, mode: 'text' | 'number'): Command => (state, dispatch) => {
  const t = findTable(state);
  if (!t) return false;
  const map = TableMap.get(t.node);
  if (col < 0 || col >= map.width) return false;
  const rows: PMNode[] = [];
  t.node.forEach((r) => rows.push(r));
  if (rows.some((r) => { let bad = false; r.forEach((c) => { if ((c.attrs.rowspan ?? 1) > 1) bad = true; }); return bad; })) return false;
  if (!dispatch) return true;
  const head = t.node.attrs.headerRow ? rows.shift() : undefined;
  const key = (r: PMNode): string => {
    let x = 0;
    let out = '';
    r.forEach((c) => {
      if (col >= x && col < x + (c.attrs.colspan ?? 1)) out = cellText(c);
      x += c.attrs.colspan ?? 1;
    });
    return out;
  };
  const sorted = rows
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort((a, b) => (ascending ? 1 : -1) * compareCells(a.k, b.k, mode) || a.i - b.i)
    .map((x) => x.r);
  const all = head ? [head, ...sorted] : sorted;
  const tr = state.tr.replaceWith(t.pos + 1, t.pos + t.node.nodeSize - 1, Fragment.from(all));
  tr.setSelection(TextSelection.near(tr.doc.resolve(t.pos + 3)));
  dispatch(tr);
  return true;
};

// ------------------------------------------------------------------------------------------------ texto ↔ tabla
export type Separator = 'tab' | 'semicolon' | 'comma' | 'paragraph';
const SEP: Record<Exclude<Separator, 'paragraph'>, string> = { tab: '\t', semicolon: ';', comma: ',' };

/** Divide el texto de un párrafo en celdas. */
export function splitLine(text: string, sep: Separator): string[] {
  return sep === 'paragraph' ? [text] : text.split(SEP[sep]);
}

/** Párrafos seleccionados que están juntos fuera de una tabla (o null si la selección no es convertible). */
function selectedParagraphs(state: EditorState): { paras: { node: PMNode; pos: number }[]; from: number; to: number } | null {
  const { from, to } = state.selection;
  const paras: { node: PMNode; pos: number }[] = [];
  let inTable = false;
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (n.type.name === 'table') {
      inTable = true;
      return false;
    }
    if (n.type.name === 'paragraph') {
      if (state.doc.resolve(pos).parent.type.name !== 'section') inTable = true;
      paras.push({ node: n, pos });
      return false;
    }
    return true;
  });
  if (inTable || !paras.length) return null;
  while (paras.length > 1 && !paras[paras.length - 1]!.node.textContent) paras.pop();
  const last = paras[paras.length - 1]!;
  const ok = paras.every((p, i) => i === 0 || p.pos === paras[i - 1]!.pos + paras[i - 1]!.node.nodeSize);
  return ok ? { paras, from: paras[0]!.pos, to: last.pos + last.node.nodeSize } : null;
}

/** Puede convertirse la selección en tabla (varios párrafos seguidos, o uno, fuera de una tabla). */
export const textToTable = (sep: Separator, widthPx: number): Command => (state, dispatch) => {
  const sel = selectedParagraphs(state);
  if (!sel) return false;
  if (!dispatch) return true;
  const lines = sep === 'paragraph' ? sel.paras.map((p) => [p.node.textContent]) : sel.paras.map((p) => splitLine(p.node.textContent, sep));
  const cols = sep === 'paragraph' ? 1 : Math.max(...lines.map((l) => l.length), 1);
  const w = Math.max(30, Math.floor(widthPx / cols));
  const mkCell = (text: string) => nodeTypes.table_cell!.create({ colwidth: [w] }, nodeTypes.paragraph!.create({ spaceAfter: 0 }, text ? state.schema.text(text) : undefined));
  const rows = lines.map((l) => nodeTypes.table_row!.create(null, Array.from({ length: cols }, (_x, i) => mkCell((l[i] ?? '').trim()))));
  const table = nodeTypes.table!.create({ borders: true }, rows);
  const tr = state.tr.replaceWith(sel.from, sel.to, table);
  tr.setSelection(TextSelection.near(tr.doc.resolve(sel.from + 3)));
  dispatch(tr);
  return true;
};

/** Convierte la tabla actual en párrafos, uniendo las celdas de cada fila con el separador. */
export const tableToText = (sep: Exclude<Separator, 'paragraph'>): Command => (state, dispatch) => {
  const t = findTable(state);
  if (!t) return false;
  if (!dispatch) return true;
  const paras: PMNode[] = [];
  t.node.forEach((row) => {
    const parts: string[] = [];
    row.forEach((c) => parts.push(c.textContent));
    const text = parts.join(SEP[sep]);
    paras.push(nodeTypes.paragraph!.create(null, text ? state.schema.text(text) : undefined));
  });
  const tr = state.tr.replaceWith(t.pos, t.pos + t.node.nodeSize, paras);
  tr.setSelection(TextSelection.near(tr.doc.resolve(t.pos + 1)));
  dispatch(tr);
  return true;
};
