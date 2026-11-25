import {
  DEFAULT_OPTIONS,
  lookOf,
  setBorders as gridSetBorders,
  styleById,
  styleFor,
  OFFICE_PALETTE,
  type Border,
  type BorderMode,
  type Cell,
  type CellLook,
  type CellProps,
  type Grid,
  type Palette,
  type StyleOptions,
  type TableStyle,
} from '@suitenova/table-core';
import { paletteOf, type DocTheme } from '@suitenova/theme-core';
import type { Node as PMNode } from 'prosemirror-model';
import { type Command, type EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { CellSelection, TableMap } from 'prosemirror-tables';
import { Decoration, DecorationSet } from 'prosemirror-view';

/*
 * Table styles in the editor. A table has a style (`tstyle`, an id of `@suitenova/table-core`) and options (`topts`); what each cell looks like is
 * decided by the style, the options and what the cell has of its own (its shading and borders), and drawn with decorations, so changing the
 * style or an option changes the table at once and nothing is written into the cells. Writer and Notes share this.
 */

/** The cell shading that means "no colour on purpose" (it takes away the colour of the style; null means "the style decides"). */
export const NO_SHADING = 'transparent';

export type CellBorders = Partial<Record<'t' | 'r' | 'b' | 'l', Border | null>>;

/** The table style of a table node: its style, or the one its borders flag stands for. */
/** The colours the table styles use in a document: the accents of its theme (Office's when it has none, as in Notes). */
export function paletteOfDoc(doc: PMNode): Palette {
  const th = doc.attrs.theme as DocTheme | null | undefined;
  return th ? paletteOf(th) : OFFICE_PALETTE;
}

export function styleOfTable(table: PMNode, palette: Palette = OFFICE_PALETTE): TableStyle {
  const id = table.attrs.tstyle as string | null;
  const known = id ? styleById(id, palette) : undefined;
  if (known) return known;
  if (!table.attrs.borders) return styleFor('plain', 1, palette);
  // a table with the old "visible borders" flag is the table grid, in the colour and width it was given
  const grid = styleFor('basic', 1, palette);
  const color = (table.attrs.borderColor as string | null) ?? '#000000';
  const width = (table.attrs.borderWidth as number | null) ?? 0.75;
  const line: Border = { style: 'single', width, color };
  return { ...grid, whole: { borders: { t: line, b: line, l: line, r: line, insideH: line, insideV: line } } };
}

export function optionsOfTable(table: PMNode): StyleOptions {
  const o = table.attrs.topts as Partial<StyleOptions> | null;
  return { ...DEFAULT_OPTIONS, ...(table.attrs.tstyle ? {} : { firstRow: false, bandRows: false }), ...(o ?? {}) };
}

/** What a cell has of its own, as the properties `table-core` understands. */
export function propsOfCell(cell: PMNode): CellProps | undefined {
  const p: CellProps = {};
  const bg = cell.attrs.background as string | null;
  if (bg === NO_SHADING) p.fill = null;
  else if (bg) p.fill = bg;
  const b = cell.attrs.borders as CellBorders | null;
  if (b) p.borders = b;
  return Object.keys(p).length ? p : undefined;
}

/** True when the table needs the style engine to draw it (it has a style, or a cell with borders of its own). */
export function isStyledTable(table: PMNode): boolean {
  if (table.attrs.tstyle) return true;
  let direct = false;
  table.descendants((n) => {
    if (n.type.name === 'table_cell' || n.type.name === 'table_header') direct ||= !!n.attrs.borders;
    return !direct && n.type.name !== 'paragraph';
  });
  return direct;
}

/** The look of every cell of a table, by the offset of the cell in the table. */
export function tableLooks(table: PMNode, palette: Palette = OFFICE_PALETTE): Map<number, CellLook> {
  const map = TableMap.get(table);
  const style = styleOfTable(table, palette);
  const opts = optionsOfTable(table);
  const size = { rows: map.height, cols: map.width };
  const out = new Map<number, CellLook>();
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const off = map.map[r * map.width + c]!;
      if (out.has(off)) continue;
      const cell = table.nodeAt(off)!;
      out.set(off, lookOf(style, opts, { r, c, rs: cell.attrs.rowspan ?? 1, cs: cell.attrs.colspan ?? 1 }, size, propsOfCell(cell)));
    }
  }
  return out;
}

const CSS_LINE: Record<Border['style'], string> = { single: 'solid', dashed: 'dashed', dotted: 'dotted', double: 'double', none: 'none' };

/** The inline style that draws a look on a cell. */
export function cssOfLook(l: CellLook): string {
  const parts: string[] = [];
  if (l.fill) parts.push(`background-color:${l.fill}`);
  if (l.color) parts.push(`color:${l.color}`);
  if (l.bold) parts.push('font-weight:700');
  const names = { t: 'top', r: 'right', b: 'bottom', l: 'left' } as const;
  for (const k of ['t', 'r', 'b', 'l'] as const) {
    const b = l.borders[k];
    if (b) parts.push(`border-${names[k]}:${Math.max(0.5, b.width)}pt ${CSS_LINE[b.style]} ${b.color}`);
  }
  return parts.join(';');
}

function build(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  const palette = paletteOfDoc(doc);
  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true;
    if (!isStyledTable(node)) return true;
    for (const [off, look] of tableLooks(node, palette)) {
      const cell = node.nodeAt(off)!;
      const css = cssOfLook(look);
      if (css) decos.push(Decoration.node(pos + 1 + off, pos + 1 + off + cell.nodeSize, { style: css }));
    }
    return true;
  });
  return DecorationSet.create(doc, decos);
}

const key = new PluginKey<DecorationSet>('nwTableStyle');

/** Draws the tables that have a style (or borders of their own cells) with the look the style decides. */
export function tableStylePlugin(): Plugin {
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_c, state) => build(state.doc),
      apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
    },
    props: { decorations: (state) => key.getState(state) },
  });
}

// ------------------------------------------------------------------------------------------------ commands

/** The table that holds the selection. */
function tableAt(state: EditorState): { node: PMNode; pos: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'table') return { node: n, pos: $from.before(d) };
  }
  return null;
}

/** What the interface shows about the table of the selection: its style id and options, or null outside a table. */
export function tableStyleInfo(state: EditorState): { styleId: string | null; options: StyleOptions; headerRepeat: boolean } | null {
  const t = tableAt(state);
  if (!t) return null;
  return { styleId: (t.node.attrs.tstyle as string | null) ?? null, options: optionsOfTable(t.node), headerRepeat: !!t.node.attrs.headerRow };
}

/** Gives the table of the selection a style (null takes the style off and leaves the plain table). */
export const setTableStyle = (id: string | null): Command => (state, dispatch) => {
  const t = tableAt(state);
  if (!t) return false;
  if (id && !styleById(id)) return false;
  if (dispatch) {
    // the old "visible borders" flag would draw its own lines under the style
    dispatch(state.tr.setNodeMarkup(t.pos, undefined, { ...t.node.attrs, tstyle: id, borders: false, topts: id ? (t.node.attrs.topts ?? { ...DEFAULT_OPTIONS }) : null }));
  }
  return true;
};

/** Turns one of the style options on or off (header row, total row, first or last column, banded rows or columns). */
export const setTableOption = (name: keyof StyleOptions, value: boolean): Command => (state, dispatch) => {
  const t = tableAt(state);
  if (!t) return false;
  if (dispatch) {
    const now = optionsOfTable(t.node);
    // the options only mean something with a style: the first time it is the plain table with a style of no look
    const tstyle = (t.node.attrs.tstyle as string | null) ?? 'plain';
    dispatch(state.tr.setNodeMarkup(t.pos, undefined, { ...t.node.attrs, tstyle, borders: false, topts: { ...now, [name]: value } }));
  }
  return true;
};

// ---- the selected cells as a grid of table-core

/** The range of cells (in grid positions) the selection covers: the cells of a cell selection, or the cell of the cursor. */
function selectedRect(state: EditorState, table: { node: PMNode; pos: number }): { left: number; right: number; top: number; bottom: number } | null {
  const map = TableMap.get(table.node);
  const sel = state.selection;
  if (sel instanceof CellSelection) {
    return map.rectBetween(sel.$anchorCell.pos - table.pos - 1, sel.$headCell.pos - table.pos - 1);
  }
  const { $from } = sel;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'table_cell' || n.type.name === 'table_header') return map.findCell($from.before(d) - table.pos - 1);
  }
  return null;
}

/** The table as a `table-core` grid: each cell holds its offset in the table. */
export function gridOfTable(table: PMNode): Grid<number> {
  const map = TableMap.get(table);
  const seen = new Map<number, { r: number; c: number }>();
  const rows: Grid<number>['rows'] = [];
  for (let r = 0; r < map.height; r++) {
    const cells: Cell<number>[] = [];
    for (let c = 0; c < map.width; c++) {
      const off = map.map[r * map.width + c]!;
      const origin = seen.get(off);
      if (!origin) {
        seen.set(off, { r, c });
        const node = table.nodeAt(off)!;
        const props = propsOfCell(node);
        const rs = node.attrs.rowspan ?? 1;
        const cs = node.attrs.colspan ?? 1;
        cells.push({ content: off, ...(props ? { props } : {}), ...(rs > 1 ? { rs } : {}), ...(cs > 1 ? { cs } : {}) });
      } else cells.push({ content: off, cover: true, ...(c > origin.c ? { hm: true } : {}), ...(r > origin.r ? { vm: true } : {}) });
    }
    rows.push({ h: 24, cells });
  }
  return { cols: Array<number>(map.width).fill(100), rows };
}

/**
 * Draws borders on the selected cells in one of the modes of Word's «Borders» menu (all, outside, inside, top, bottom, left, right, none).
 * `border` null removes them. A border shared by two cells is written on both.
 */
export const setCellBorders = (mode: BorderMode, border: Border | null): Command => (state, dispatch) => {
  const t = tableAt(state);
  if (!t) return false;
  const rect = selectedRect(state, t);
  if (!rect) return false;
  if (!dispatch) return true;
  const before = gridOfTable(t.node);
  // "none" is a border that is there on purpose and says "no line": it takes away the lines of the style too
  const edit = mode === 'none' ? null : border;
  const after = gridSetBorders(before, { r1: rect.top, c1: rect.left, r2: rect.bottom - 1, c2: rect.right - 1 }, mode, edit);
  const tr = state.tr;
  after.rows.forEach((row, r) =>
    row.cells.forEach((cell, c) => {
      if (cell.cover) return;
      const was = before.rows[r]!.cells[c]!.props?.borders;
      const now = cell.props?.borders;
      if (JSON.stringify(was ?? null) === JSON.stringify(now ?? null)) return;
      const off = cell.content;
      const node = t.node.nodeAt(off)!;
      tr.setNodeMarkup(t.pos + 1 + off, undefined, { ...node.attrs, borders: now && Object.keys(now).length ? now : null });
    }),
  );
  dispatch(tr);
  return true;
};

/** Shades the selected cells; `null` lets the style decide again and `NO_SHADING` takes the colour away on purpose. */
export const setCellShading = (color: string | null): Command => (state, dispatch) => {
  const t = tableAt(state);
  if (!t) return false;
  const rect = selectedRect(state, t);
  if (!rect) return false;
  if (!dispatch) return true;
  const map = TableMap.get(t.node);
  const tr = state.tr;
  const done = new Set<number>();
  for (let r = rect.top; r < rect.bottom; r++) {
    for (let c = rect.left; c < rect.right; c++) {
      const off = map.map[r * map.width + c]!;
      if (done.has(off)) continue;
      done.add(off);
      tr.setNodeMarkup(t.pos + 1 + off, undefined, { ...t.node.nodeAt(off)!.attrs, background: color });
    }
  }
  dispatch(tr);
  return true;
};
