import { evalSafe, fieldsOf, parseExpr, type Row, type Value } from './expr';
import { snap, type Box } from './form';
import { escapeHtml, type ReportDef } from './report';

// ------------------------------------------------------------------------------------------------ model

export type PaperSize = 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal';
export const PAPERS: PaperSize[] = ['A4', 'A3', 'A5', 'Letter', 'Legal'];
/** Page sizes in CSS pixels (96 per inch). */
export const PAPER_PX: Record<PaperSize, { w: number; h: number }> = {
  A3: { w: 1123, h: 1587 },
  A4: { w: 794, h: 1123 },
  A5: { w: 559, h: 794 },
  Letter: { w: 816, h: 1056 },
  Legal: { w: 816, h: 1344 },
};
export const mm = (v: number): number => (v * 96) / 25.4;

export type BandKind = 'reportHeader' | 'pageHeader' | 'groupHeader' | 'detail' | 'groupFooter' | 'pageFooter' | 'reportFooter';
export interface Band {
  id: string;
  kind: BandKind;
  height: number;
  /** For group headers and footers: which group (0 is the outermost). */
  level?: number;
  /** The section is only as tall as its controls (empty growing text takes no room). */
  canShrink?: boolean;
}
export interface GroupDef {
  field: string;
  desc?: boolean;
  /** Start a new page when the whole group would not fit in the rest of the current one (if it fits on a page). */
  keepTogether?: boolean;
  /** Group by the first N characters of the value (a date: 4 = year, 7 = month, 10 = day). */
  prefix?: number;
}

export type Format = '' | 'int' | 'dec1' | 'dec2' | 'dec3' | 'percent' | 'date' | 'datetime';
export const FORMATS: Format[] = ['', 'int', 'dec1', 'dec2', 'dec3', 'percent', 'date', 'datetime'];

/** Conditional format: the first rule whose expression is true applies. */
export interface ReportCondRule {
  expr: string;
  color?: string;
  background?: string;
  bold?: boolean;
  italic?: boolean;
  hide?: boolean;
}
export type RunningSum = '' | 'group' | 'all';

interface RCommon extends Box {
  id: string;
  name: string;
  /** Id of the band the control lives in. Its position is relative to the band. */
  band: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  italic?: boolean;
  /** Font size in px. */
  size?: number;
  /** `#rgb` or `#rrggbb`. */
  color?: string;
  format?: Format;
  border?: boolean;
  /** Let the text use several lines instead of being cut at the right edge. */
  wrap?: boolean;
  /** Text controls: the control gets as tall as its text needs. */
  canGrow?: boolean;
  /** Fields: the value is not repeated when it equals the one of the previous record (within the group and page). */
  hideDup?: boolean;
  /** Fields and calculated controls: accumulate the value over the group or over the whole report. */
  running?: RunningSum;
  cond?: ReportCondRule[];
}

export type ImageFit = 'clip' | 'zoom' | 'stretch';
export type ChartKind = 'bar' | 'line' | 'pie';
export type ChartFn = 'sum' | 'count' | 'avg';

export type ReportControl = RCommon &
  (
    | { type: 'label'; text: string }
    | { type: 'field'; field: string }
    | { type: 'calc'; expr: string }
    | { type: 'line' }
    | { type: 'rect' }
    /** A picture stored in the report (`data:image/…;base64,…`), or taken from a field that holds one. */
    | { type: 'image'; src: string; field?: string; fit?: ImageFit; alt?: string }
    /** `[Page]` and `[Pages]` are replaced. */
    | { type: 'pageNumber'; text: string }
    | { type: 'chart'; kind: ChartKind; category: string; value: string; fn: ChartFn; title?: string }
    /** The records of another table whose `childField` equals this record's `parentField`, as a small table. */
    | { type: 'subreport'; table: string; childField: string; parentField: string; columns?: string[]; rowHeight?: number }
  );
export type ReportControlType = ReportControl['type'];
export const REPORT_CONTROL_TYPES: ReportControlType[] = ['label', 'field', 'calc', 'line', 'rect', 'pageNumber', 'chart', 'subreport', 'image'];

/** Geometry of a sheet of labels, in px. */
export interface LabelSpec {
  cols: number;
  labelW: number;
  labelH: number;
  marginLeft: number;
  marginTop: number;
  gapX: number;
  gapY: number;
}

export interface ReportLayout {
  paper: PaperSize;
  landscape: boolean;
  margins: { top: number; right: number; bottom: number; left: number };
  bands: Band[];
  groups: GroupDef[];
  controls: ReportControl[];
  /** Order of the detail records inside the groups. */
  sort?: { field: string; desc?: boolean }[];
  /** A sheet of labels: the detail band is the label, repeated across the page. */
  labels?: LabelSpec;
  /** Several columns of records on the page (the detail band is one column wide). */
  columns?: { n: number; gap: number; direction: 'down' | 'across' };
  /** Which pages show the page header and footer. */
  pageHeaderOn?: PageBandMode;
  pageFooterOn?: PageBandMode;
  /** Only the records for which this expression is true. */
  filter?: string;
  /** Text shown when there are no records. */
  noData?: string;
}
/** `notFirst`: not on the page of the report header; `notLast`: not on the page of the report footer. */
export type PageBandMode = 'all' | 'notFirst' | 'notLast' | 'notFirstLast';
export function pageBandShown(mode: PageBandMode | undefined, page: number, pages: number): boolean {
  if (!mode || mode === 'all') return true;
  if ((mode === 'notFirst' || mode === 'notFirstLast') && page === 1) return false;
  if ((mode === 'notLast' || mode === 'notFirstLast') && page === pages) return false;
  return true;
}

export interface LabelPreset {
  id: string;
  name: string;
  paper: PaperSize;
  spec: LabelSpec;
}
const lab = (cols: number, w: number, h: number, left: number, top: number, gx: number, gy: number): LabelSpec => ({ cols, labelW: mm(w), labelH: mm(h), marginLeft: mm(left), marginTop: mm(top), gapX: mm(gx), gapY: mm(gy) });
export const LABEL_PRESETS: LabelPreset[] = [
  { id: 'a4-3x7', name: 'A4, 3 × 7 (63,5 × 38,1 mm)', paper: 'A4', spec: lab(3, 63.5, 38.1, 7.2, 15.1, 2.5, 0) },
  { id: 'a4-2x7', name: 'A4, 2 × 7 (99,1 × 38,1 mm)', paper: 'A4', spec: lab(2, 99.1, 38.1, 4.7, 15.1, 2.5, 0) },
  { id: 'a4-3x8', name: 'A4, 3 × 8 (70 × 36 mm)', paper: 'A4', spec: lab(3, 70, 36, 0, 4.5, 0, 0) },
  { id: 'letter-3x10', name: 'Carta, 3 × 10 (66,7 × 25,4 mm)', paper: 'Letter', spec: lab(3, 66.7, 25.4, 4.8, 12.7, 3.2, 0) },
  { id: 'letter-2x5', name: 'Carta, 2 × 5 (101,6 × 50,8 mm)', paper: 'Letter', spec: lab(2, 101.6, 50.8, 4.8, 12.7, 3.2, 0) },
];

export function pageSize(l: ReportLayout): { w: number; h: number } {
  const p = PAPER_PX[l.paper];
  return l.landscape ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}
export const contentWidth = (l: ReportLayout): number => pageSize(l).w - l.margins.left - l.margins.right;

/** Width of one column of records (the whole printable width when there is one column). */
export function columnWidth(l: ReportLayout): number {
  const n = l.columns && l.columns.n > 1 ? Math.min(8, Math.floor(l.columns.n)) : 1;
  return n > 1 ? (contentWidth(l) - (l.columns?.gap ?? 0) * (n - 1)) / n : contentWidth(l);
}
/** Change the columns of the page; the controls of the detail are rescaled to the new column width. */
export function setColumns(l: ReportLayout, columns: ReportLayout['columns']): ReportLayout {
  const from = columnWidth(l);
  const next: ReportLayout = { ...l, columns: columns && columns.n > 1 ? columns : undefined };
  const to = columnWidth(next);
  const det = l.bands.find((x) => x.kind === 'detail');
  if (!det || !from || Math.abs(to - from) < 1) return next;
  const k = to / from;
  return { ...next, controls: next.controls.map((c) => (c.band === det.id ? { ...c, x: Math.round(c.x * k), w: Math.max(8, Math.round(c.w * k)) } : c)) };
}

export function labelRows(l: ReportLayout): number {
  if (!l.labels) return 0;
  const s = l.labels;
  return Math.max(1, Math.floor((pageSize(l).h - s.marginTop + s.gapY) / (s.labelH + s.gapY)));
}

// ------------------------------------------------------------------------------------------------ building a layout

let counter = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;

const BAND_ORDER: BandKind[] = ['reportHeader', 'pageHeader', 'groupHeader', 'detail', 'groupFooter', 'pageFooter', 'reportFooter'];
/** The bands in the order they are drawn: group headers outermost first, group footers innermost first. */
export function orderedBands(l: ReportLayout): Band[] {
  const rank = (b: Band): number => BAND_ORDER.indexOf(b.kind) * 1000 + (b.kind === 'groupHeader' ? (b.level ?? 0) : b.kind === 'groupFooter' ? 100 - (b.level ?? 0) : 0);
  return [...l.bands].sort((a, b) => rank(a) - rank(b));
}
export const bandOf = (l: ReportLayout, kind: BandKind, level?: number): Band | undefined => l.bands.find((b) => b.kind === kind && (level === undefined || b.level === level));
export const BAND_NAMES: Record<BandKind, string> = {
  reportHeader: 'Encabezado del informe',
  pageHeader: 'Encabezado de página',
  groupHeader: 'Encabezado de grupo',
  detail: 'Detalle',
  groupFooter: 'Pie de grupo',
  pageFooter: 'Pie de página',
  reportFooter: 'Pie del informe',
};

const base = (band: Band, name: string, x: number, y: number, w: number, h: number): RCommon => ({ id: newId('r'), name, band: band.id, x, y, w, h });

/** A new report: title, column headings, the records, page footer with number, and totals when asked for. */
export function defaultReportLayout(fields: string[], opts: { title?: string; groupBy?: string | null; sums?: string[]; landscape?: boolean; numeric?: string[]; decimal?: string[] } = {}): ReportLayout {
  const l: ReportLayout = { paper: 'A4', landscape: !!opts.landscape, margins: { top: 40, right: 40, bottom: 40, left: 40 }, bands: [], groups: [], controls: [] };
  const W = contentWidth(l);
  const sums = (opts.sums ?? []).filter((f) => fields.includes(f));
  const numeric = new Set([...(opts.numeric ?? []), ...(opts.decimal ?? []), ...sums]);
  const decimal = new Set(opts.decimal ?? []);
  const mk = (kind: BandKind, height: number, level?: number): Band => {
    const b: Band = { id: newId('b'), kind, height, ...(level !== undefined ? { level } : {}) };
    l.bands.push(b);
    return b;
  };
  const rh = mk('reportHeader', 48);
  const ph = mk('pageHeader', 28);
  const gb = opts.groupBy && fields.includes(opts.groupBy) ? opts.groupBy : null;
  const gh = gb ? mk('groupHeader', 28, 0) : null;
  const det = mk('detail', 22);
  const gf = gb ? mk('groupFooter', sums.length ? 26 : 0, 0) : null;
  const pf = mk('pageFooter', 28);
  // the report footer always exists (height 0 hides it) so that it can be switched on in the designer
  const rf = mk('reportFooter', sums.length ? 32 : 0);
  if (gb) l.groups.push({ field: gb });

  const colW = Math.max(60, Math.floor(W / Math.max(1, fields.length)));
  const x = (i: number) => i * colW;
  const text = { type: 'label' as const };
  l.controls.push({ ...base(rh, 'Titulo', 0, 8, W, 32), type: 'label', text: opts.title ?? 'Informe', bold: true, size: 20 });
  fields.forEach((f, i) => {
    l.controls.push({ ...base(ph, `Encabezado${i + 1}`, x(i), 4, colW - 8, 20), ...text, text: f, bold: true, align: numeric.has(f) ? 'right' : 'left' });
    l.controls.push({ ...base(det, `Campo${i + 1}`, x(i), 1, colW - 8, 20), type: 'field', field: f, align: numeric.has(f) ? 'right' : 'left', format: decimal.has(f) ? 'dec2' : '' });
  });
  l.controls.push({ ...base(ph, 'LineaEncabezado', 0, 26, W, 0), type: 'line' });
  if (gh && gb) l.controls.push({ ...base(gh, 'GrupoTitulo', 0, 4, W, 22), type: 'field', field: gb, bold: true, size: 14 });
  if (gf && sums.length) {
    l.controls.push({ ...base(gf, 'SubtotalEtiqueta', 0, 3, colW - 8, 20), type: 'label', text: 'Subtotal', bold: true });
    fields.forEach((f, i) => sums.includes(f) && l.controls.push({ ...base(gf, `Subtotal${i + 1}`, x(i), 3, colW - 8, 20), type: 'calc', expr: `=Sum([${f}])`, bold: true, align: 'right', format: 'dec2' }));
  }
  l.controls.push({ ...base(pf, 'Fecha', 0, 6, 200, 18), type: 'calc', expr: '=Date()', size: 11, format: 'date' });
  l.controls.push({ ...base(pf, 'Pagina', W - 200, 6, 200, 18), type: 'pageNumber', text: 'Página [Page] de [Pages]', align: 'right', size: 11 });
  if (sums.length) {
    l.controls.push({ ...base(rf, 'TotalEtiqueta', 0, 6, colW - 8, 20), type: 'label', text: 'Total', bold: true });
    fields.forEach((f, i) => sums.includes(f) && l.controls.push({ ...base(rf, `Total${i + 1}`, x(i), 6, colW - 8, 20), type: 'calc', expr: `=Sum([${f}])`, bold: true, align: 'right', format: 'dec2' }));
  }
  return l;
}

/** A quick report (columns, one grouping, totals) as a free design. */
export function layoutFromLegacy(def: ReportDef, numeric: string[] = [], decimal: string[] = []): ReportLayout {
  return defaultReportLayout(def.columns, { title: def.title, groupBy: def.groupBy, sums: def.sums, landscape: def.landscape, numeric, decimal });
}

/** A sheet of labels: the fields as lines of text, the first one in bold. */
export function defaultLabelLayout(fields: string[], preset: LabelPreset = LABEL_PRESETS[0]!): ReportLayout {
  const l: ReportLayout = { paper: preset.paper, landscape: false, margins: { top: 0, right: 0, bottom: 0, left: 0 }, bands: [], groups: [], controls: [], labels: { ...preset.spec } };
  const det: Band = { id: newId('b'), kind: 'detail', height: Math.round(preset.spec.labelH) };
  l.bands.push(det);
  const lines = Math.max(1, Math.min(fields.length, Math.floor((preset.spec.labelH - 8) / 18)));
  fields.slice(0, lines).forEach((f, i) => l.controls.push({ ...base(det, `Linea${i + 1}`, 6, 4 + i * 18, Math.round(preset.spec.labelW) - 12, 18), type: 'field', field: f, bold: i === 0 }));
  return l;
}

// ------------------------------------------------------------------------------------------------ editing

/** The default content of each kind of control. */
export function newReportControl(l: ReportLayout, band: Band, type: ReportControlType, init: Record<string, unknown> = {}, at?: { x: number; y: number }): ReportControl {
  const taken = new Set(l.controls.map((c) => c.name.toLowerCase()));
  const prefix: Record<ReportControlType, string> = { label: 'Etiqueta', field: 'Campo', calc: 'Calculado', line: 'Linea', rect: 'Rectangulo', pageNumber: 'Pagina', chart: 'Grafico', subreport: 'Subinforme', image: 'Imagen' };
  let n = 1;
  while (taken.has(`${prefix[type]}${n}`.toLowerCase())) n++;
  const size: Record<ReportControlType, [number, number]> = { label: [140, 20], field: [140, 20], calc: [140, 20], line: [200, 0], rect: [120, 60], pageNumber: [200, 18], chart: [320, 180], subreport: [360, 80], image: [120, 80] };
  const extra: Record<ReportControlType, Record<string, unknown>> = {
    label: { text: 'Etiqueta' },
    field: { field: '' },
    calc: { expr: '=' },
    line: {},
    rect: {},
    pageNumber: { text: 'Página [Page] de [Pages]' },
    chart: { kind: 'bar', category: '', value: '', fn: 'sum', title: '' },
    subreport: { table: '', childField: '', parentField: '', columns: undefined, rowHeight: 18 },
    image: { src: '', fit: 'zoom' },
  };
  const [w, h] = size[type];
  return { ...base(band, `${prefix[type]}${n}`, snap(at?.x ?? 0), snap(at?.y ?? 2), w, h), type, ...extra[type], ...init } as ReportControl;
}

/** Keep a band tall enough for its controls (a subreport counts for one row: it pushes the band down when printed). */
function fitBands(l: ReportLayout): ReportLayout {
  const need = new Map<string, number>();
  for (const c of l.controls) need.set(c.band, Math.max(need.get(c.band) ?? 0, c.y + c.h));
  let changed = false;
  const bands = l.bands.map((b) => {
    const h = need.get(b.id) ?? 0;
    if (h > b.height) {
      changed = true;
      return { ...b, height: h };
    }
    return b;
  });
  return changed ? { ...l, bands } : l;
}

export function addReportControl(l: ReportLayout, c: ReportControl): ReportLayout {
  return fitBands({ ...l, controls: [...l.controls, c] });
}
export function updateReportControl(l: ReportLayout, id: string, patch: object): ReportLayout {
  return fitBands({ ...l, controls: l.controls.map((c) => (c.id === id ? ({ ...c, ...patch } as ReportControl) : c)) });
}
export function removeReportControl(l: ReportLayout, id: string): ReportLayout {
  return { ...l, controls: l.controls.filter((c) => c.id !== id) };
}
export function setBandHeight(l: ReportLayout, id: string, height: number): ReportLayout {
  return { ...l, bands: l.bands.map((b) => (b.id === id ? { ...b, height: Math.max(0, Math.min(1200, Math.round(height))) } : b)) };
}

/** Group by a field: adds its header and footer bands (innermost last). */
export function addGroup(l: ReportLayout, field: string): ReportLayout {
  if (l.groups.some((g) => g.field === field)) return l;
  const level = l.groups.length;
  const header: Band = { id: newId('b'), kind: 'groupHeader', height: 26, level };
  const title = { ...newReportControl(l, header, 'field', { field, bold: true, size: 14, w: Math.min(400, contentWidth(l)), h: 22 }, { x: 0, y: 2 }) };
  return {
    ...l,
    groups: [...l.groups, { field }],
    bands: [...l.bands, header, { id: newId('b'), kind: 'groupFooter', height: 0, level }],
    controls: [...l.controls, title],
  };
}
export function removeGroup(l: ReportLayout, level: number): ReportLayout {
  const gone = new Set(l.bands.filter((b) => (b.kind === 'groupHeader' || b.kind === 'groupFooter') && b.level === level).map((b) => b.id));
  return {
    ...l,
    groups: l.groups.filter((_, i) => i !== level),
    bands: l.bands.filter((b) => !gone.has(b.id)).map((b) => ((b.kind === 'groupHeader' || b.kind === 'groupFooter') && (b.level ?? 0) > level ? { ...b, level: (b.level ?? 0) - 1 } : b)),
    controls: l.controls.filter((c) => !gone.has(c.band)),
  };
}

// ------------------------------------------------------------------------------------------------ checks

export function validateReportLayout(l: ReportLayout, fields: string[]): string[] {
  const out: string[] = [];
  const have = new Set(fields.map((f) => f.toLowerCase()));
  const bands = new Set(l.bands.map((b) => b.id));
  const names = new Set<string>();
  const checkField = (c: ReportControl, f: string) => {
    if (!f) out.push(`${c.name}: no tiene campo asignado.`);
    else if (!have.has(f.toLowerCase())) out.push(`${c.name}: el campo "${f}" no existe en el origen de datos.`);
  };
  const checkExpr = (who: string, expr: string) => {
    try {
      for (const f of fieldsOf(parseExpr(expr))) if (!have.has(f.toLowerCase())) out.push(`${who}: el campo [${f}] no existe en el origen de datos.`);
    } catch (e) {
      out.push(`${who}: ${(e as Error).message}`);
    }
  };
  for (const g of l.groups) {
    if (g.field.startsWith('=')) checkExpr('Agrupación', g.field);
    else if (!have.has(g.field.toLowerCase())) out.push(`Agrupación: el campo "${g.field}" no existe en el origen de datos.`);
  }
  for (const s of l.sort ?? []) if (s.field.startsWith('=')) checkExpr('Orden', s.field);
  if (l.filter?.trim()) checkExpr('Filtro', l.filter);
  if (l.columns && l.columns.n > 1 && l.controls.some((c) => c.type === 'subreport')) out.push('Con varias columnas, el subinforme no hace crecer la sección.');
  for (const c of l.controls) {
    if (!bands.has(c.band)) out.push(`${c.name}: su sección ya no existe.`);
    if (names.has(c.name.toLowerCase())) out.push(`El nombre "${c.name}" está repetido.`);
    names.add(c.name.toLowerCase());
    for (const r of c.cond ?? []) checkExpr(`${c.name} (formato condicional)`, r.expr);
    if (c.type === 'field') {
      if (c.field.startsWith('=')) checkExpr(c.name, c.field);
      else checkField(c, c.field);
    } else if (c.type === 'image') {
      if (!c.src && !c.field) out.push(`${c.name}: elija una imagen o un campo.`);
      if (c.field) checkField(c, c.field);
    } else if (c.type === 'calc') {
      try {
        for (const f of fieldsOf(parseExpr(c.expr))) if (!have.has(f.toLowerCase())) out.push(`${c.name}: el campo [${f}] no existe en el origen de datos.`);
      } catch (e) {
        out.push(`${c.name}: ${(e as Error).message}`);
      }
    } else if (c.type === 'chart') {
      checkField(c, c.category);
      if (c.fn !== 'count') checkField(c, c.value);
    } else if (c.type === 'subreport' && (!c.table || !c.childField || !c.parentField)) out.push(`${c.name}: indique la tabla y los campos de enlace.`);
  }
  return [...new Set(out)];
}

// ------------------------------------------------------------------------------------------------ formatting

const nf = (d: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });

export function formatValue(v: Value, fmt: Format = ''): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (!fmt) {
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : new Intl.NumberFormat('es-ES', { maximumFractionDigits: 6 }).format(v);
    return String(v);
  }
  if (fmt === 'date' || fmt === 'datetime') {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(v));
    if (!m) return String(v);
    return fmt === 'date' || !m[4] ? `${m[3]}/${m[2]}/${m[1]}` : `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
  }
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return String(v);
  if (fmt === 'int') return nf(0).format(n);
  if (fmt === 'dec1') return nf(1).format(n);
  if (fmt === 'dec2') return nf(2).format(n);
  if (fmt === 'dec3') return nf(3).format(n);
  return `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(n * 100)} %`;
}

// ------------------------------------------------------------------------------------------------ pagination

export interface DataSet {
  columns: string[];
  rows: Row[];
}
export interface SubData {
  columns: string[];
  rows: unknown[][];
}
export interface RenderOptions {
  /** Replaces today's date (tests and reproducible output). */
  now?: Date;
  /** Records for a subreport control: the rows linked to `parent`. The first column of each row is not shown (a row id). */
  fetchSub?: (c: Extract<ReportControl, { type: 'subreport' }>, parent: Row) => SubData;
  title?: string;
}

export interface Block {
  band: Band;
  /** Top of the block inside the body of the page. */
  y: number;
  h: number;
  /** The record (detail) or the first record of the group or report. */
  row: Row | null;
  /** The records that aggregates run over. */
  scope: Row[];
  /** Data of the subreports of the block, by control id. */
  subs?: Record<string, SubData>;
  /** Labels: position of the label on the sheet (0 is the top left one). */
  cell?: number;
  /** Detail blocks: the sorted records, the index of this one and where its innermost group starts (running sums, repeated values). */
  run?: { rows: Row[]; ri: number; gs: number };
  /** Several columns: the column of the block. */
  col?: number;
}
export interface Page {
  blocks: Block[];
  /** The records shown in the detail of the page. */
  rows: Row[];
}

const cmp = (a: Value, b: Value): number => {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });
};
const keyOf = (v: Value) => (v === null || v === undefined ? '\u0000' : String(v));
const get = (r: Row, f: string): Value => {
  if (f in r) return r[f]!;
  const k = Object.keys(r).find((x) => x.toLowerCase() === f.toLowerCase());
  return k === undefined ? null : r[k]!;
};
/** A field name, or an expression (`=Left([Nombre], 1)`) evaluated on the record. */
const val = (r: Row, f: string, now?: Date): Value => (f.startsWith('=') ? evalSafe(f, { row: r, now }) : get(r, f));
const gval = (g: GroupDef, r: Row): Value => {
  const v = val(r, g.field);
  return g.prefix && g.prefix > 0 && v !== null && v !== undefined ? String(v).slice(0, g.prefix) : v;
};
export const isTrue = (v: Value): boolean => v === true || (typeof v === 'number' && v !== 0) || (typeof v === 'string' && /^(true|verdadero|s[ií])$/i.test(v));
/** The records that pass the report filter. */
export function filterRows(l: ReportLayout, rows: Row[], now?: Date): Row[] {
  const f = l.filter?.trim();
  return f ? rows.filter((r) => isTrue(evalSafe(f, { row: r, now }))) : rows;
}

/** The records in the order of the report: by each group, then by the detail sort. */
export function sortRows(l: ReportLayout, rows: Row[]): Row[] {
  const keys: { get: (r: Row) => Value; desc: boolean }[] = [
    ...l.groups.map((g) => ({ get: (r: Row) => gval(g, r), desc: !!g.desc })),
    ...(l.sort ?? []).map((s) => ({ get: (r: Row) => val(r, s.field), desc: !!s.desc })),
  ];
  if (!keys.length) return [...rows];
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      for (const k of keys) {
        const c = cmp(k.get(a.r), k.get(b.r));
        if (c) return k.desc ? -c : c;
      }
      return a.i - b.i;
    })
    .map((x) => x.r);
}

const SUB_HEAD = 18;
const subHeight = (c: Extract<ReportControl, { type: 'subreport' }>, n: number): number => c.y + SUB_HEAD + n * (c.rowHeight ?? 18) + 4;

/** Lay the records out on pages. Band heights are fixed, except where a subreport has more rows than its control can hold. */
export function paginate(l: ReportLayout, data: DataSet, opts: RenderOptions = {}): Page[] {
  const rows = sortRows(l, filterRows(l, data.rows, opts.now));
  if (l.labels) return paginateLabels(l, rows);
  const ps = pageSize(l);
  const contentH = ps.h - l.margins.top - l.margins.bottom;
  const ph = bandOf(l, 'pageHeader')?.height ?? 0;
  const pf = bandOf(l, 'pageFooter')?.height ?? 0;
  // the first page gets back the room of a header or footer that is not shown with the report header
  const bodyOf = (idx: number) => Math.max(40, contentH - (pageBandShown(l.pageHeaderOn, idx + 1, Infinity) ? ph : 0) - (pageBandShown(l.pageFooterOn, idx + 1, Infinity) ? pf : 0));
  const cols = l.columns && l.columns.n > 1 ? Math.min(8, Math.floor(l.columns.n)) : 1;

  interface Item {
    block: Omit<Block, 'y'>;
    keepNext?: boolean;
    keepGroup?: number;
  }
  const items: Item[] = [];
  const subsOf = (band: Band, row: Row | null, scope: Row[]): { subs?: Record<string, SubData>; h: number } => {
    let h = band.height;
    let subs: Record<string, SubData> | undefined;
    let low = 0;
    for (const c of l.controls) {
      if (c.band !== band.id) continue;
      if (c.type === 'subreport') {
        if (!row || !opts.fetchSub) continue;
        const d = opts.fetchSub(c, row);
        (subs ??= {})[c.id] = d;
        h = Math.max(h, subHeight(c, d.rows.length));
        low = Math.max(low, subHeight(c, d.rows.length));
      } else if ((c.type === 'label' || c.type === 'field' || c.type === 'calc') && (c.canGrow || band.canShrink)) {
        const text = evalControl(c, { band, y: 0, h: band.height, row, scope }, { page: 1, pages: 1 }, opts, scope);
        const eh = c.canGrow ? grownHeight(c, text) : c.h;
        if (c.canGrow) h = Math.max(h, c.y + eh);
        low = Math.max(low, text === '' && c.type !== 'label' ? 0 : c.y + eh);
      } else low = Math.max(low, c.y + c.h);
    }
    if (band.canShrink) h = low;
    return { subs, h };
  };
  const push = (band: Band | undefined, row: Row | null, scope: Row[], extra: Partial<Item> = {}, run?: Block['run']): Item | undefined => {
    if (!band || (band.height <= 0 && !band.canShrink)) return undefined;
    const { subs, h } = subsOf(band, row, scope);
    if (h <= 0) return undefined;
    const it: Item = { block: { band, h, row, scope, ...(subs ? { subs } : {}), ...(run ? { run } : {}) }, ...extra };
    items.push(it);
    return it;
  };

  push(bandOf(l, 'reportHeader'), rows[0] ?? null, rows);
  const nG = l.groups.length;
  const sameGroup = (a: Row, b: Row, upto: number) => l.groups.slice(0, upto + 1).every((g) => keyOf(gval(g, a)) === keyOf(gval(g, b)));
  const rangeEnd = (i: number, level: number): number => {
    let j = i + 1;
    while (j < rows.length && sameGroup(rows[i]!, rows[j]!, level)) j++;
    return j;
  };
  let gs = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    let changed = 0;
    if (i > 0) {
      changed = nG;
      for (let g = 0; g < nG; g++) {
        if (!sameGroup(rows[i - 1]!, row, g)) {
          changed = g;
          break;
        }
      }
      // the groups that ended with the previous record, innermost first
      for (let g = nG - 1; g >= changed && g >= 0; g--) {
        let start = i - 1;
        while (start > 0 && sameGroup(rows[start - 1]!, rows[i - 1]!, g)) start--;
        push(bandOf(l, 'groupFooter', g), rows[start]!, rows.slice(start, i));
      }
    }
    for (let g = i === 0 ? 0 : changed; g < nG; g++) {
      const end = rangeEnd(i, g);
      const scope = rows.slice(i, end);
      const group = l.groups[g]!;
      const hb = bandOf(l, 'groupHeader', g);
      let total = 0;
      if (group.keepTogether) {
        const fb = bandOf(l, 'groupFooter', g);
        total = (hb?.height ?? 0) + scope.length * (bandOf(l, 'detail')?.height ?? 0) + (fb?.height ?? 0);
      }
      push(hb, row, scope, { keepNext: true, ...(total ? { keepGroup: total } : {}) });
    }
    if (nG && (i === 0 || changed < nG)) gs = i;
    push(bandOf(l, 'detail'), row, [row], {}, { rows, ri: i, gs });
  }
  if (rows.length) {
    for (let g = nG - 1; g >= 0; g--) {
      let start = rows.length - 1;
      while (start > 0 && sameGroup(rows[start - 1]!, rows[rows.length - 1]!, g)) start--;
      push(bandOf(l, 'groupFooter', g), rows[start]!, rows.slice(start));
    }
  }
  push(bandOf(l, 'reportFooter'), rows[rows.length - 1] ?? null, rows);

  const pages: Page[] = [{ blocks: [], rows: [] }];
  let y = 0;
  const lastPage = () => pages[pages.length - 1]!;
  const bodyH = () => bodyOf(pages.length - 1);
  const newPage = () => {
    pages.push({ blocks: [], rows: [] });
    y = 0;
  };
  const placeRun = (run: Item[]) => {
    const dh = Math.max(...run.map((r) => r.block.h));
    const down = l.columns?.direction !== 'across';
    let k = 0;
    while (k < run.length) {
      let L = Math.floor((bodyH() - y) / dh);
      if (L < 1) {
        if (y > 0) newPage();
        L = Math.max(1, Math.floor(bodyH() / dh));
      }
      const take = Math.min(run.length - k, L * cols);
      const colH = down ? (take === L * cols ? L : Math.ceil(take / cols)) : Math.ceil(take / cols);
      for (let q = 0; q < take; q++) {
        const col = down ? Math.floor(q / colH) : q % cols;
        const line = down ? q % colH : Math.floor(q / cols);
        const bl = run[k + q]!.block;
        lastPage().blocks.push({ ...bl, y: y + line * dh, h: dh, col });
        if (bl.row) lastPage().rows.push(bl.row);
      }
      y += colH * dh;
      k += take;
      if (k < run.length) newPage();
    }
  };
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (cols > 1 && it.block.band.kind === 'detail') {
      let j = i;
      while (j < items.length && items[j]!.block.band.kind === 'detail') j++;
      placeRun(items.slice(i, j));
      i = j - 1;
      continue;
    }
    let need = it.block.h;
    if (it.keepNext) {
      // a header never ends a page: it travels with what follows (other headers, then the first record)
      let j = i;
      while (items[j]?.keepNext) {
        j++;
        need += items[j]?.block.h ?? 0;
      }
    }
    if (it.keepGroup && it.keepGroup <= bodyH() && y + it.keepGroup > bodyH() && y > 0) newPage();
    else if (y + need > bodyH() && y > 0) newPage();
    lastPage().blocks.push({ ...it.block, y });
    if (it.block.band.kind === 'detail' && it.block.row) lastPage().rows.push(it.block.row);
    y += it.block.h;
  }
  return pages;
}

function paginateLabels(l: ReportLayout, rows: Row[]): Page[] {
  const s = l.labels!;
  const per = Math.max(1, s.cols * labelRows(l));
  const det = bandOf(l, 'detail');
  const pages: Page[] = [];
  if (!det) return [{ blocks: [], rows: [] }];
  for (let i = 0; i < Math.max(1, rows.length); i += per) {
    const chunk = rows.slice(i, i + per);
    pages.push({
      rows: chunk,
      blocks: chunk.map((row, k): Block => ({ band: det, y: 0, h: s.labelH, row, scope: [row], cell: k })),
    });
  }
  return pages;
}

// ------------------------------------------------------------------------------------------------ rendering

const COLORS = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#9e480e', '#636363', '#997300', '#264478'];
const num = (v: Value): number => (typeof v === 'number' ? v : Number(v)) || 0;
const safeColor = (c?: string) => (c && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c) ? c : undefined);
const nfShort = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });

/** What a chart control plots: the records of its scope grouped by the category field. */
export function chartData(c: Extract<ReportControl, { type: 'chart' }>, scope: Row[]): { label: string; value: number }[] {
  const groups = new Map<string, { sum: number; n: number }>();
  for (const r of scope) {
    const raw = get(r, c.category);
    const k = raw === null || raw === undefined || raw === '' ? '(vacío)' : String(raw);
    const g = groups.get(k) ?? { sum: 0, n: 0 };
    if (c.fn === 'count') g.n++;
    else if (get(r, c.value) !== null) {
      g.sum += num(get(r, c.value));
      g.n++;
    }
    groups.set(k, g);
  }
  return [...groups].map(([label, g]) => ({ label, value: c.fn === 'count' ? g.n : c.fn === 'avg' ? (g.n ? g.sum / g.n : 0) : g.sum }));
}

/** A chart as a standalone SVG string (every text is escaped). */
export function chartSvg(kind: ChartKind, data: { label: string; value: number }[], w: number, h: number, title = ''): string {
  const W = Math.max(40, w);
  const H = Math.max(40, h);
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Calibri, Arial, sans-serif" font-size="10">`];
  const top = title ? 18 : 6;
  if (title) out.push(`<text x="${W / 2}" y="12" text-anchor="middle" font-weight="600" font-size="11">${escapeHtml(title)}</text>`);
  if (!data.length) {
    out.push(`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#777">Sin datos</text></svg>`);
    return out.join('');
  }
  if (kind === 'pie') {
    const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
    const cx = Math.min(W / 2, 60 + (H - top) / 2);
    const r = Math.max(10, (H - top - 8) / 2);
    const cy = top + r + 2;
    let a0 = -Math.PI / 2;
    data.forEach((d, i) => {
      const frac = total > 0 ? Math.max(0, d.value) / total : 0;
      if (frac <= 0) return;
      const a1 = a0 + frac * Math.PI * 2;
      const color = COLORS[i % COLORS.length]!;
      if (frac >= 0.9999) out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`);
      else {
        const x0 = cx + r * Math.cos(a0);
        const y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1);
        const y1 = cy + r * Math.sin(a1);
        out.push(`<path d="M${cx} ${cy} L${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z" fill="${color}" stroke="#fff"/>`);
      }
      a0 = a1;
    });
    const lx = cx + r + 14;
    data.slice(0, Math.floor((H - top) / 14)).forEach((d, i) => {
      out.push(`<rect x="${lx}" y="${top + i * 14}" width="9" height="9" fill="${COLORS[i % COLORS.length]}"/><text x="${lx + 13}" y="${top + i * 14 + 8}">${escapeHtml(d.label.slice(0, 22))} (${escapeHtml(nfShort.format(d.value))})</text>`);
    });
    out.push('</svg>');
    return out.join('');
  }
  const left = 44;
  const bottom = 22;
  const pw = W - left - 8;
  const ph = H - top - bottom;
  const max = Math.max(0, ...data.map((d) => d.value));
  const min = Math.min(0, ...data.map((d) => d.value));
  const span = max - min || 1;
  const yOf = (v: number) => top + ph - ((v - min) / span) * ph;
  for (let i = 0; i <= 4; i++) {
    const v = min + (span * i) / 4;
    const yy = yOf(v);
    out.push(`<line x1="${left}" x2="${W - 8}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="#ddd"/><text x="${left - 4}" y="${(yy + 3).toFixed(1)}" text-anchor="end" fill="#555">${escapeHtml(nfShort.format(v))}</text>`);
  }
  const step = pw / data.length;
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(pw / 48))));
  if (kind === 'bar') {
    const bw = Math.max(2, step * 0.7);
    data.forEach((d, i) => {
      const x = left + i * step + (step - bw) / 2;
      const y0 = yOf(0);
      const y1 = yOf(d.value);
      out.push(`<rect x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, Math.abs(y0 - y1)).toFixed(1)}" fill="${COLORS[0]}"/>`);
    });
  } else {
    const pts = data.map((d, i) => `${(left + i * step + step / 2).toFixed(1)},${yOf(d.value).toFixed(1)}`);
    out.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${COLORS[0]}" stroke-width="2"/>`);
    pts.forEach((p) => out.push(`<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="2.5" fill="${COLORS[0]}"/>`));
  }
  data.forEach((d, i) => {
    if (i % every) return;
    out.push(`<text x="${(left + i * step + step / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#333">${escapeHtml(d.label.slice(0, Math.max(4, Math.floor(step / 5))))}</text>`);
  });
  out.push(`<line x1="${left}" x2="${left}" y1="${top}" y2="${top + ph}" stroke="#888"/></svg>`);
  return out.join('');
}

function style(c: ReportControl, extra = ''): string {
  const col = safeColor(c.color);
  const size = c.size ? Math.max(6, Math.min(96, Math.round(c.size))) : 12;
  return `left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;font-size:${size}px;${c.align ? `text-align:${c.align};` : ''}${c.bold ? 'font-weight:700;' : ''}${c.italic ? 'font-style:italic;' : ''}${col ? `color:${col};` : ''}${c.border ? 'border:1px solid #000;' : ''}${c.wrap ? 'white-space:normal;' : ''}${extra}`;
}

interface Where {
  page: number;
  pages: number;
}

/** Height a growing text control needs for its text (an estimate: the width of a character is taken as 0.55 of the font size). */
export function grownHeight(c: { w: number; h: number; size?: number; bold?: boolean }, text: string): number {
  const size = c.size ? Math.max(6, Math.min(96, c.size)) : 12;
  const perLine = Math.max(1, Math.floor(Math.max(10, c.w - 4) / (size * (c.bold ? 0.6 : 0.55))));
  const lines = text.split('\n').reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
  return Math.max(c.h, Math.ceil(lines * size * 1.25) + 2);
}

/** The first conditional format rule that is true for the block's record. */
function matchRule(c: ReportControl, b: Block, opts: RenderOptions): ReportCondRule | undefined {
  if (!c.cond?.length || !b.row) return undefined;
  return c.cond.find((r) => r.expr.trim() && isTrue(evalSafe(r.expr, { row: b.row, scope: b.scope, now: opts.now })));
}

const IMG_RE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
/** The picture of an image control: its own, or the one a field holds (only safe `data:` raster images are used). */
export function imageSource(c: Extract<ReportControl, { type: 'image' }>, row: Row | null): string {
  const v = c.field && row ? get(row, c.field) : null;
  if (typeof v === 'string' && IMG_RE.test(v)) return v;
  return IMG_RE.test(c.src) ? c.src : '';
}

function evalControl(c: ReportControl, b: Block, where: Where, opts: RenderOptions, pageRows: Row[]): string {
  const ctx = { row: b.row, scope: b.scope, now: opts.now };
  if (b.run && (c.type === 'field' || c.type === 'calc') && c.running) {
    const run = b.run;
    // running sum: the value of the record added up from the start of the group (or report) to this record
    const from = c.running === 'all' ? 0 : run.gs;
    let sum = 0;
    for (let i = from; i <= run.ri; i++) {
      const r = run.rows[i]!;
      const v = c.type === 'field' ? val(r, c.field, opts.now) : evalSafe(c.expr, { row: r, scope: [r], now: opts.now });
      sum += num(v);
    }
    return formatValue(sum, c.format);
  }
  switch (c.type) {
    case 'label':
      return c.text;
    case 'field': {
      if (!b.row) return formatValue(null, c.format);
      const v = val(b.row, c.field, opts.now);
      if (c.hideDup && b.run && b.run.ri > b.run.gs && pageRows[0] !== b.row) {
        const prev = val(b.run.rows[b.run.ri - 1]!, c.field, opts.now);
        if (keyOf(prev) === keyOf(v)) return '';
      }
      return formatValue(v, c.format);
    }
    case 'calc': {
      const v = evalSafe(c.expr, { ...ctx, scope: b.band.kind === 'pageHeader' || b.band.kind === 'pageFooter' ? pageRows : b.scope });
      return v === '#Error' ? '#Error' : formatValue(v, c.format);
    }
    case 'pageNumber':
      return c.text.replace(/\[Page\]/gi, String(where.page)).replace(/\[Pages\]/gi, String(where.pages));
    default:
      return '';
  }
}

function controlHtml(c: ReportControl, b: Block, where: Where, opts: RenderOptions, pageRows: Row[], originY = 0): string {
  const y = c.y + originY;
  const moved = { ...c, y };
  if (c.type === 'line') return `<div class="ln" style="left:${c.x}px;top:${y}px;width:${c.w}px;height:${Math.max(0, c.h)}px;border-top:1px solid ${safeColor(c.color) ?? '#000'}"></div>`;
  if (c.type === 'rect') {
    const rule = matchRule(c, b, opts);
    return `<div class="rc" style="${style(moved, rule?.background && safeColor(rule.background) ? `background:${safeColor(rule.background)};` : '')}${rule?.hide ? 'visibility:hidden;' : ''}"></div>`;
  }
  if (c.type === 'image') {
    const src = imageSource(c, b.row);
    if (!src) return '';
    const fit = c.fit === 'clip' ? 'none' : c.fit === 'stretch' ? 'fill' : 'contain';
    return `<div class="im" style="${style(moved)}"><img src="${src}" alt="${escapeHtml(c.alt ?? '')}" style="width:100%;height:100%;object-fit:${fit}"></div>`;
  }
  if (c.type === 'chart') {
    const svg = chartSvg(c.kind, chartData(c, b.scope), c.w, c.h, c.title);
    return `<div class="ch" style="${style(moved)}">${svg}</div>`;
  }
  if (c.type === 'subreport') {
    const d = b.subs?.[c.id];
    if (!d) return '';
    const cols = d.columns;
    const rh = c.rowHeight ?? 18;
    const head = `<tr style="height:${SUB_HEAD}px">${cols.map((n) => `<th>${escapeHtml(n)}</th>`).join('')}</tr>`;
    const body = d.rows.map((r) => `<tr style="height:${rh}px">${cols.map((_, i) => `<td>${escapeHtml(formatValue((r[i + 1] ?? null) as Value))}</td>`).join('')}</tr>`).join('');
    return `<div class="sr" style="left:${c.x}px;top:${y}px;width:${c.w}px"><table>${head}${body}</table></div>`;
  }
  const text = evalControl(c, b, where, opts, pageRows);
  const rule = matchRule(c, b, opts);
  const grows = (c.type === 'label' || c.type === 'field' || c.type === 'calc') && c.canGrow;
  const h = grows ? grownHeight(c, text) : c.h;
  const bg = rule?.background ? safeColor(rule.background) : undefined;
  const col = rule?.color ? safeColor(rule.color) : undefined;
  const extra = `${col ? `color:${col};` : ''}${bg ? `background:${bg};` : ''}${rule?.bold ? 'font-weight:700;' : ''}${rule?.italic ? 'font-style:italic;' : ''}${rule?.hide ? 'visibility:hidden;' : ''}${grows ? 'white-space:pre-wrap;overflow:visible;' : ''}`;
  return `<div class="c" style="${style({ ...moved, h }, extra)}">${escapeHtml(text)}</div>`;
}

const CSS = `*{box-sizing:border-box}body{margin:0;font-family:'Segoe UI',Calibri,Arial,sans-serif;color:#000;background:#fff}
.pg{position:relative;overflow:hidden;background:#fff;break-after:page;page-break-after:always}.pg:last-child{break-after:auto;page-break-after:auto}
.bd{position:absolute;left:0}.c,.ch,.rc{position:absolute;line-height:1.25;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.ch{overflow:visible}.rc{border:1px solid #000}.ln{position:absolute;height:0}
.im{position:absolute;overflow:hidden}.nd{position:absolute;left:0;right:0;text-align:center;color:#555;font-size:14px}.sr{position:absolute}.sr table{border-collapse:collapse;width:100%;font-size:10px}.sr th,.sr td{border:1px solid #bbb;padding:0 4px;text-align:left;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.sr th{background:#f2f2f2}
@media screen{body{background:#e6e6e6;padding:12px}.pg{margin:0 auto 12px;box-shadow:0 1px 6px rgba(0,0,0,.35)}}`;

/** The report as a standalone HTML document: one `section.pg` per page, ready to be shown or printed. */
export function renderReportLayout(l: ReportLayout, data: DataSet, opts: RenderOptions = {}): string {
  const pages = paginate(l, data, opts);
  const ps = pageSize(l);
  const total = pages.length;
  const m = l.margins;
  const contentH = ps.h - m.top - m.bottom;
  const ph = bandOf(l, 'pageHeader');
  const pf = bandOf(l, 'pageFooter');
  const bandControls = (id: string) => l.controls.filter((c) => c.band === id);
  const html: string[] = [];
  pages.forEach((p, i) => {
    const where = { page: i + 1, pages: total };
    const parts: string[] = [];
    if (l.labels) {
      const s = l.labels;
      p.blocks.forEach((b, k) => {
        const cell = b.cell ?? k;
        const cx = s.marginLeft + (cell % s.cols) * (s.labelW + s.gapX);
        const cy = s.marginTop + Math.floor(cell / s.cols) * (s.labelH + s.gapY);
        parts.push(`<div class="bd" style="left:${cx.toFixed(1)}px;top:${cy.toFixed(1)}px;width:${s.labelW.toFixed(1)}px;height:${s.labelH.toFixed(1)}px;overflow:hidden">${bandControls(b.band.id).map((c) => controlHtml(c, b, where, opts, p.rows)).join('')}</div>`);
      });
    } else {
      const first = p.blocks.find((b) => b.band.kind === 'detail')?.row ?? p.blocks[0]?.row ?? null;
      const pseudo = (band: Band): Block => ({ band, y: 0, h: band.height, row: first, scope: p.rows });
      const nCols = l.columns && l.columns.n > 1 ? Math.min(8, Math.floor(l.columns.n)) : 1;
      const gap = l.columns?.gap ?? 0;
      const fullW = ps.w - m.left - m.right;
      const colW = (fullW - gap * (nCols - 1)) / nCols;
      const place = (b: Block, top: number) => {
        const left = b.col !== undefined && nCols > 1 ? m.left + b.col * (colW + gap) : m.left;
        const width = b.col !== undefined && nCols > 1 ? colW : fullW;
        parts.push(`<div class="bd" style="top:${top}px;left:${left}px;width:${width}px;height:${b.h}px">${bandControls(b.band.id).map((c) => controlHtml(c, b, where, opts, p.rows)).join('')}</div>`);
      };
      const showH = !!ph && ph.height > 0 && pageBandShown(l.pageHeaderOn, where.page, where.pages);
      const showF = !!pf && pf.height > 0 && pageBandShown(l.pageFooterOn, where.page, where.pages);
      // a header that is not shown on the first page gives its room to the body (the footer on the last page keeps it)
      const bodyTop = m.top + (pageBandShown(l.pageHeaderOn, where.page, Infinity) ? (ph?.height ?? 0) : 0);
      if (showH) place(pseudo(ph!), m.top);
      for (const b of p.blocks) place(b, bodyTop + b.y);
      if (l.noData && pages.every((pg) => !pg.rows.length)) {
        const used = p.blocks.reduce((mx, b) => Math.max(mx, b.y + b.h), 0);
        parts.push(`<div class="nd" style="top:${bodyTop + used + 24}px;left:${m.left}px;right:${m.right}px">${escapeHtml(l.noData)}</div>`);
      }
      if (showF) place(pseudo(pf!), m.top + contentH - pf!.height);
    }
    html.push(`<section class="pg" style="width:${ps.w}px;height:${ps.h}px">${parts.join('')}</section>`);
  });
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(opts.title ?? 'Informe')}</title><style>${CSS}@page{size:${ps.w}px ${ps.h}px;margin:0}</style></head><body>${html.join('')}</body></html>`;
}
