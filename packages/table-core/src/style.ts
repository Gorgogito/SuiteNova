import type { Border, CellProps, Grid, HAlign, Side, VAlign } from './grid';

/*
 * Table styles, the way Office has them: a style is a set of parts (the whole table, the header row, the total row, the first and last column, the
 * bands, the corners) and the options say which parts apply. `lookOf` answers how one cell looks with a style and its options; whatever the cell has
 * of its own (`CellProps`) wins over it. Colours are #rrggbb, resolved from a palette, so a product can export them as direct formatting or as a style.
 */

export type StyleFamily = 'plain' | 'basic' | 'light' | 'grid' | 'medium' | 'dark' | 'list';

export type StyleSide = Side | 'insideH' | 'insideV';

export interface StylePart {
  fill?: string;
  /** Text colour. */
  color?: string;
  bold?: boolean;
  borders?: Partial<Record<StyleSide, Border>>;
}

export interface TableStyle {
  id: string;
  name: string;
  family: StyleFamily;
  /** 1–6, or 0 for the styles that have no accent colour. */
  accent: number;
  whole?: StylePart;
  band1H?: StylePart;
  band2H?: StylePart;
  band1V?: StylePart;
  band2V?: StylePart;
  firstRow?: StylePart;
  lastRow?: StylePart;
  firstCol?: StylePart;
  lastCol?: StylePart;
  nw?: StylePart;
  ne?: StylePart;
  sw?: StylePart;
  se?: StylePart;
}

/** What the "Table Style Options" turn on. */
export interface StyleOptions {
  firstRow: boolean;
  lastRow: boolean;
  firstCol: boolean;
  lastCol: boolean;
  bandRows: boolean;
  bandCols: boolean;
}

export const DEFAULT_OPTIONS: StyleOptions = { firstRow: true, lastRow: false, firstCol: false, lastCol: false, bandRows: true, bandCols: false };

export interface Palette {
  /** The six accent colours. */
  accents: string[];
  dark: string;
  light: string;
}

/** The colours of the Office theme. */
export const OFFICE_PALETTE: Palette = { accents: ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'], dark: '#000000', light: '#ffffff' };

// ------------------------------------------------------------------------------------------------ colours

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const parse = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
};
const toHex = (c: [number, number, number]) => `#${c.map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;

/** The colour mixed with white: `pct` is how much of the colour stays (0.2 = a light tint), like `tint` in a theme. */
export function tint(hex: string, pct: number): string {
  const c = parse(hex);
  return toHex(c.map((v) => v * pct + 255 * (1 - pct)) as [number, number, number]);
}

/** The colour mixed with black: `pct` is how much of the colour stays (0.7 = a dark shade). */
export function shade(hex: string, pct: number): string {
  return toHex(parse(hex).map((v) => v * pct) as [number, number, number]);
}

/** Black or white, whichever reads better on the colour. */
export function readableOn(bg: string): string {
  const [r, g, b] = parse(bg).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#000000' : '#ffffff';
}

// ------------------------------------------------------------------------------------------------ the styles

export const STYLE_FAMILIES: { id: StyleFamily; name: string }[] = [
  { id: 'plain', name: 'Sin estilo' },
  { id: 'basic', name: 'Cuadrícula de tabla' },
  { id: 'light', name: 'Claro' },
  { id: 'grid', name: 'Cuadrícula' },
  { id: 'medium', name: 'Medio' },
  { id: 'dark', name: 'Oscuro' },
  { id: 'list', name: 'Lista' },
];

const line = (color: string, width = 1, style: Border['style'] = 'single'): Border => ({ style, width, color });

/** The style of a family in an accent colour (1–6; ignored by the families that have none). */
export function styleFor(family: StyleFamily, accent = 1, palette: Palette = OFFICE_PALETTE): TableStyle {
  const n = Math.max(1, Math.min(6, Math.round(accent)));
  const a = palette.accents[n - 1] ?? palette.accents[0]!;
  const white = palette.light;
  const black = palette.dark;
  const famName = STYLE_FAMILIES.find((f) => f.id === family)!.name;
  const base = { family, accent: n, name: `${famName} – Énfasis ${n}`, id: `${family}-${n}` };
  switch (family) {
    case 'plain':
      return { ...base, accent: 0, id: 'plain', name: famName };
    case 'basic': {
      const l = line(black, 0.5);
      return { ...base, accent: 0, id: 'basic', name: famName, whole: { borders: { t: l, b: l, l, r: l, insideH: l, insideV: l } } };
    }
    case 'light': {
      const thin = line(a, 1);
      return {
        ...base,
        whole: { borders: { t: thin, b: thin, insideH: line(tint(a, 0.4), 0.75) } },
        band1H: { fill: tint(a, 0.2) },
        band1V: { fill: tint(a, 0.2) },
        firstRow: { bold: true, color: a, borders: { b: line(a, 2) } },
        lastRow: { bold: true, borders: { t: line(a, 2) } },
        firstCol: { bold: true },
        lastCol: { bold: true },
      };
    }
    case 'grid': {
      const all = line(a, 1);
      return {
        ...base,
        whole: { borders: { t: all, b: all, l: all, r: all, insideH: all, insideV: all } },
        band1H: { fill: tint(a, 0.2) },
        band1V: { fill: tint(a, 0.2) },
        firstRow: { fill: a, color: white, bold: true },
        lastRow: { fill: a, color: white, bold: true },
        firstCol: { bold: true },
        lastCol: { bold: true },
      };
    }
    case 'medium': {
      const w = line(white, 1);
      return {
        ...base,
        whole: { fill: tint(a, 0.2), borders: { t: w, b: w, l: w, r: w, insideH: w, insideV: w } },
        band1H: { fill: tint(a, 0.4) },
        band1V: { fill: tint(a, 0.4) },
        firstRow: { fill: a, color: white, bold: true, borders: { b: line(white, 3) } },
        lastRow: { fill: a, color: white, bold: true, borders: { t: line(white, 3) } },
        firstCol: { fill: a, color: white, bold: true },
        lastCol: { fill: a, color: white, bold: true },
      };
    }
    case 'dark': {
      const thin = line(white, 0.75);
      return {
        ...base,
        whole: { fill: shade(a, 0.7), color: white, borders: { insideH: thin, insideV: thin } },
        band1H: { fill: shade(a, 0.5) },
        band1V: { fill: shade(a, 0.5) },
        firstRow: { fill: black, color: white, bold: true, borders: { b: line(a, 3) } },
        lastRow: { fill: black, color: white, bold: true, borders: { t: line(a, 3) } },
        firstCol: { fill: shade(a, 0.4), color: white, bold: true },
        lastCol: { fill: shade(a, 0.4), color: white, bold: true },
      };
    }
    case 'list': {
      const edge = line(a, 1.5);
      return {
        ...base,
        whole: { borders: { t: edge, b: edge } },
        band1H: { fill: tint(a, 0.15) },
        band1V: { fill: tint(a, 0.15) },
        firstRow: { fill: a, color: white, bold: true },
        lastRow: { bold: true, borders: { t: edge } },
        firstCol: { bold: true },
        lastCol: { bold: true },
      };
    }
  }
}

/** Every style offered, grouped by family (the ones with an accent in the six colours). */
export function styleCatalog(palette: Palette = OFFICE_PALETTE): { family: StyleFamily; name: string; styles: TableStyle[] }[] {
  return STYLE_FAMILIES.map((f) => ({
    family: f.id,
    name: f.name,
    styles: f.id === 'plain' || f.id === 'basic' ? [styleFor(f.id, 1, palette)] : [1, 2, 3, 4, 5, 6].map((n) => styleFor(f.id, n, palette)),
  }));
}

/** The style with that id (`family-accent`), if it is one of ours. */
export function styleById(id: string | undefined, palette: Palette = OFFICE_PALETTE): TableStyle | undefined {
  if (!id) return undefined;
  const m = /^([a-z]+)(?:-(\d))?$/.exec(id);
  if (!m || !STYLE_FAMILIES.some((f) => f.id === m[1])) return undefined;
  return styleFor(m[1] as StyleFamily, m[2] ? Number(m[2]) : 1, palette);
}

// ------------------------------------------------------------------------------------------------ how a cell looks

/** How a cell looks once the style, its options and the cell's own formatting are put together. */
export interface CellLook {
  /** Background colour, or null when there is none. */
  fill: string | null;
  /** Text colour, or null for the default one. */
  color: string | null;
  bold: boolean;
  /** Borders that are drawn (a side with no border is left out). */
  borders: Partial<Record<Side, Border>>;
  align?: HAlign;
  valign?: VAlign;
  margins?: { t: number; r: number; b: number; l: number };
}

interface Size {
  rows: number;
  cols: number;
}

/** The parts that apply to the grid position (r, c), from the strongest to the weakest. */
function partsAt(style: TableStyle, o: StyleOptions, r: number, c: number, size: Size): StylePart[] {
  const out: StylePart[] = [];
  const first = o.firstRow && r === 0;
  const last = o.lastRow && r === size.rows - 1 && !first;
  const fc = o.firstCol && c === 0;
  const lc = o.lastCol && c === size.cols - 1 && !fc;
  const push = (p?: StylePart) => p && out.push(p);
  if (first && fc) push(style.nw);
  if (first && lc) push(style.ne);
  if (last && fc) push(style.sw);
  if (last && lc) push(style.se);
  if (first) push(style.firstRow);
  if (last) push(style.lastRow);
  if (fc) push(style.firstCol);
  if (lc) push(style.lastCol);
  // bands run over the body: the header and the total row are not counted, the first and last columns neither
  if (o.bandRows && !first && !last) {
    const i = r - (o.firstRow ? 1 : 0);
    push(i % 2 === 0 ? style.band1H : style.band2H);
  }
  if (o.bandCols && !fc && !lc) {
    const i = c - (o.firstCol ? 1 : 0);
    push(i % 2 === 0 ? style.band1V : style.band2V);
  }
  push(style.whole);
  return out;
}

/**
 * The border on one side of a cell that sits at (r, c) and covers `rs` × `cs` cells. A border that a part (the header row, the total row…) asks
 * for on that edge, from either of the two cells that touch it, wins over the border of the whole table.
 */
function borderOf(style: TableStyle, o: StyleOptions, size: Size, side: Side, r: number, c: number, rs: number, cs: number): Border | undefined {
  const horizontal = side === 't' || side === 'b';
  // the two cells that share the edge: `a` is before it (above / to the left), `b` after it
  const edgeRow = side === 't' ? r : side === 'b' ? r + rs : r;
  const edgeCol = side === 'l' ? c : side === 'r' ? c + cs : c;
  const a = horizontal ? { r: edgeRow - 1, c } : { r, c: edgeCol - 1 };
  const b = horizontal ? { r: edgeRow, c } : { r, c: edgeCol };
  const outer = horizontal ? edgeRow === 0 || edgeRow === size.rows : edgeCol === 0 || edgeCol === size.cols;
  const before: Side = horizontal ? 'b' : 'r';
  const after: Side = horizontal ? 't' : 'l';
  const explicit = (pos: { r: number; c: number }, s: Side): Border | undefined => {
    if (pos.r < 0 || pos.c < 0 || pos.r >= size.rows || pos.c >= size.cols) return undefined;
    for (const p of partsAt(style, o, pos.r, pos.c, size)) {
      if (p === style.whole) continue;
      const v = p.borders?.[s];
      if (v) return v;
    }
    return undefined;
  };
  let found = explicit(a, before) ?? explicit(b, after);
  if (!found) {
    const w = style.whole?.borders;
    found = outer ? w?.[side] : horizontal ? w?.insideH : w?.insideV;
  }
  return found && found.style !== 'none' && found.width > 0 ? found : undefined;
}

/**
 * How the cell at (r, c) looks, covering `rs` × `cs` grid cells, in a table of `size`. `props` is what the cell has of its own: it wins.
 * A direct `fill: null` removes the fill of the style; a direct border `null` removes the border of the style.
 */
export function lookOf(style: TableStyle | undefined, o: StyleOptions, pos: { r: number; c: number; rs?: number; cs?: number }, size: Size, props?: CellProps): CellLook {
  const rs = pos.rs ?? 1;
  const cs = pos.cs ?? 1;
  let fill: string | null = null;
  let color: string | null = null;
  let bold = false;
  const borders: Partial<Record<Side, Border>> = {};
  if (style) {
    const parts = partsAt(style, o, pos.r, pos.c, size);
    // the strongest part that says something wins
    fill = parts.find((p) => p.fill)?.fill ?? null;
    color = parts.find((p) => p.color)?.color ?? null;
    bold = parts.some((p) => p.bold);
    for (const s of ['t', 'r', 'b', 'l'] as Side[]) {
      const b = borderOf(style, o, size, s, pos.r, pos.c, rs, cs);
      if (b) borders[s] = b;
    }
  }
  if (props) {
    if (props.fill !== undefined) fill = props.fill;
    for (const s of ['t', 'r', 'b', 'l'] as Side[]) {
      const v = props.borders?.[s];
      if (v === undefined) continue;
      if (v === null || v.style === 'none' || v.width <= 0) delete borders[s];
      else borders[s] = v;
    }
  }
  return { fill, color, bold, borders, ...(props?.align ? { align: props.align } : {}), ...(props?.valign ? { valign: props.valign } : {}), ...(props?.margins ? { margins: props.margins } : {}) };
}

/** The look of every origin cell of a grid (null where a merged cell covers it). */
export function gridLooks<C>(g: Grid<C>, style: TableStyle | undefined, o: StyleOptions): (CellLook | null)[][] {
  const size = { rows: g.rows.length, cols: g.cols.length };
  return g.rows.map((row, r) =>
    row.cells.map((cell, c) => {
      if (cell.cover) return null;
      return lookOf(style, o, { r, c, rs: cell.rs, cs: cell.cs }, size, cell.props);
    }),
  );
}
