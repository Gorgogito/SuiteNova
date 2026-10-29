import {
  BUILTIN_FORMATS,
  CalcError,
  E,
  MAX_COLS,
  cellKey,
  isDateFormat,
  formatA1,
  parseA1,
  parseFormula,
  printFormula,
  shiftRefs,
  type Border,
  type Rect,
  type BorderStyle,
  type HAlign,
  type Scalar,
  type Sheet,
  type Style,
  type VAlign,
  Workbook,
} from '@suitenova/calc-engine';
import JSZip from 'jszip';
import { DEFAULT_THEME, resolveColor, type ColorSpec } from './colors';
import { anchorToRect, parseChart } from './charts-io';
import { applySuitePart } from './suite-part';
import { parseAutoFilter, parseConditionalFormatting, parseDxfs } from './filter-cf-io';
import { parseComments, parseHyperlinks, parseSparklines, parseTable, parseThreaded, parseValidations, readPage, parseX14Validations } from './objects-io';
import { asArray, attr, parser, textOf, toggle, type XNode } from './xml';

export interface ReadResult {
  workbook: Workbook;
  /** What the suite itself stored in the file for things Excel has no place for (macros, slicers…); undefined for files from elsewhere. */
  custom?: string;
  /** Things that exist in the file but SuiteNova does not support yet. */
  warnings: string[];
}

const COL_PX = 7;
const colWidthToPx = (chars: number) => Math.round(chars * COL_PX + 5);
const ptToPx = (pt: number) => Math.round((pt * 96) / 72);

/** Remove the _xlfn./_xlws. prefixes Excel adds to newer functions. */
export function stripXlfn(f: string): string {
  return f.replace(/_xlfn\.(_xlws\.)?/g, '').replace(/_xlws\./g, '').replace(/_xlpm\./g, '');
}

function relPath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

const color = (n: XNode, theme: string[]): string | undefined =>
  n ? resolveColor({ rgb: attr(n, 'rgb'), theme: attr(n, 'theme'), indexed: attr(n, 'indexed'), tint: attr(n, 'tint') } satisfies ColorSpec, theme) : undefined;

interface StyleSheet {
  xfs: number[]; // xf index -> engine style id
  dxfs: ReturnType<typeof parseDxfs>;
}

function loadStyles(wb: Workbook, doc: XNode, theme: string[]): StyleSheet {
  const ss = doc?.styleSheet ?? {};
  const numFmts = new Map<number, string>();
  for (const nf of asArray(ss.numFmts?.numFmt)) numFmts.set(Number(attr(nf, 'numFmtId')), attr(nf, 'formatCode') ?? 'General');

  const fonts = asArray(ss.fonts?.font);
  const defFont = fonts[0];
  if (defFont) {
    wb.defaultFont = { name: attr(defFont.name, 'val') ?? 'Calibri', size: Number(attr(defFont.sz, 'val') ?? 11) };
  }
  const fontStyles: Style[] = fonts.map((f: XNode) => {
    const st: Style = {};
    const name = attr(f.name, 'val');
    const sz = attr(f.sz, 'val');
    if (name && name !== wb.defaultFont.name) st.fontName = name;
    if (sz && Number(sz) !== wb.defaultFont.size) st.fontSize = Number(sz);
    if (toggle(f.b)) st.bold = true;
    if (toggle(f.i)) st.italic = true;
    if (f.u !== undefined && attr(f.u, 'val') !== 'none') st.underline = true;
    if (toggle(f.strike)) st.strike = true;
    const c = color(f.color, theme);
    if (c && c !== '#000000') st.color = c;
    return st;
  });

  const fills: (string | undefined)[] = asArray(ss.fills?.fill).map((f: XNode) => {
    const p = f.patternFill;
    if (!p || attr(p, 'patternType') !== 'solid') return undefined;
    return color(p.fgColor, theme);
  });

  const border = (n: XNode): Border | undefined => {
    const style = attr(n, 'style') as BorderStyle | undefined;
    if (!style) return undefined;
    const known: BorderStyle[] = ['thin', 'medium', 'thick', 'dashed', 'dotted', 'double', 'hair'];
    const b: Border = { style: known.includes(style) ? style : 'thin' };
    const c = color(n.color, theme);
    if (c) b.color = c;
    return b;
  };
  const borders = asArray(ss.borders?.border).map((b: XNode) => ({ top: border(b.top), right: border(b.right), bottom: border(b.bottom), left: border(b.left) }));

  const xfs: number[] = asArray(ss.cellXfs?.xf).map((xf: XNode) => {
    const st: Style = { ...(fontStyles[Number(attr(xf, 'fontId') ?? 0)] ?? {}) };
    const id = Number(attr(xf, 'numFmtId') ?? 0);
    const code = numFmts.get(id) ?? BUILTIN_FORMATS[id];
    if (code && code !== 'General') st.numFmt = code;
    const bg = fills[Number(attr(xf, 'fillId') ?? 0)];
    if (bg) st.bg = bg;
    const b = borders[Number(attr(xf, 'borderId') ?? 0)];
    if (b?.top) st.top = b.top;
    if (b?.right) st.right = b.right;
    if (b?.bottom) st.bottom = b.bottom;
    if (b?.left) st.left = b.left;
    const al = xf.alignment;
    if (al) {
      const h = attr(al, 'horizontal');
      if (h && h !== 'general') st.hAlign = (h === 'centerContinuous' ? 'center' : h) as HAlign;
      const v = attr(al, 'vertical');
      if (v === 'top' || v === 'center' || v === 'bottom') st.vAlign = (v === 'center' ? 'middle' : v) as VAlign;
      if (attr(al, 'wrapText') === '1' || attr(al, 'wrapText') === 'true') st.wrap = true;
      const ind = Number(attr(al, 'indent') ?? 0);
      if (ind > 0) st.indent = ind;
    }
    return wb.styles.intern(st);
  });
  return { xfs, dxfs: parseDxfs(ss.dxfs, theme) };
}

function loadSharedStrings(doc: XNode): string[] {
  return asArray(doc?.sst?.si).map((si: XNode) => {
    if (si.t !== undefined) return textOf(si.t);
    return asArray(si.r)
      .map((r: XNode) => textOf(r.t))
      .join('');
  });
}

function parseRef(ref: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const [a, b] = ref.split(':');
  const p1 = parseA1(a ?? '');
  const p2 = parseA1(b ?? a ?? '');
  return p1 && p2 ? { r1: Math.min(p1.row, p2.row), c1: Math.min(p1.col, p2.col), r2: Math.max(p1.row, p2.row), c2: Math.max(p1.col, p2.col) } : null;
}

interface SharedFormula {
  row: number;
  col: number;
  ast: ReturnType<typeof parseFormula>;
}

const extUnknown = new Map<number, string[]>();

function loadSheet(wb: Workbook, sheet: Sheet, doc: XNode, strings: string[], xfs: number[], dxfs: ReturnType<typeof parseDxfs>, theme: string[], date1904: boolean, warnings: string[]): void {
  const ws = doc?.worksheet ?? {};
  if (ws.sheetPr?.tabColor) {
    const c = color(ws.sheetPr.tabColor, DEFAULT_THEME);
    if (c) sheet.tabColor = c;
  }
  const view = asArray(ws.sheetViews?.sheetView)[0];
  if (view) {
    if (attr(view, 'showGridLines') === '0' || attr(view, 'showGridLines') === 'false') sheet.showGrid = false;
    const pane = asArray(view.pane)[0];
    if (pane && (attr(pane, 'state') === 'frozen' || attr(pane, 'state') === 'frozenSplit')) {
      sheet.freeze = { rows: Number(attr(pane, 'ySplit') ?? 0) | 0, cols: Number(attr(pane, 'xSplit') ?? 0) | 0 };
    }
  }
  for (const col of asArray(ws.cols?.col)) {
    const min = Number(attr(col, 'min')) - 1;
    const max = Math.min(Number(attr(col, 'max')) - 1, MAX_COLS - 1, min + 1023);
    const width = attr(col, 'width');
    const hidden = attr(col, 'hidden') === '1' || attr(col, 'hidden') === 'true';
    for (let c = min; c <= max; c++) {
      if (width !== undefined) sheet.colWidths.set(c, colWidthToPx(Number(width)));
      if (hidden) sheet.hiddenCols.add(c);
    }
  }

  const shared = new Map<string, SharedFormula>();
  const arrays: { anchor: number; rect: NonNullable<ReturnType<typeof parseRef>> }[] = [];

  let rowIdx = -1;
  for (const row of asArray(ws.sheetData?.row)) {
    const rAttr = attr(row, 'r');
    rowIdx = rAttr ? Number(rAttr) - 1 : rowIdx + 1;
    const ht = attr(row, 'ht');
    if (ht !== undefined && (attr(row, 'customHeight') === '1' || attr(row, 'customHeight') === 'true')) sheet.rowHeights.set(rowIdx, ptToPx(Number(ht)));
    if (attr(row, 'hidden') === '1' || attr(row, 'hidden') === 'true') sheet.hiddenRows.add(rowIdx);

    let colIdx = -1;
    for (const c of asArray(row.c)) {
      const ref = attr(c, 'r');
      let r = rowIdx;
      let col: number;
      if (ref) {
        const p = parseA1(ref);
        if (!p) continue;
        r = p.row;
        col = p.col;
      } else col = colIdx + 1;
      colIdx = col;

      const style = xfs[Number(attr(c, 's') ?? 0)] ?? 0;
      const t = attr(c, 't') ?? 'n';
      const vText = c.v === undefined ? undefined : textOf(c.v);
      let value: Scalar = null;
      switch (t) {
        case 's':
          value = vText === undefined ? null : (strings[Number(vText)] ?? '');
          break;
        case 'str':
          value = vText ?? '';
          break;
        case 'inlineStr':
          value = c.is ? (c.is.t !== undefined ? textOf(c.is.t) : asArray(c.is.r).map((x: XNode) => textOf(x.t)).join('')) : '';
          break;
        case 'b':
          value = vText === '1' || vText === 'true';
          break;
        case 'e':
          value = CalcError.parse(vText ?? '') ?? E.VALUE;
          break;
        case 'd': {
          const d = vText ? Date.parse(vText) : NaN;
          value = Number.isNaN(d) ? null : d / 86_400_000 + 25_569;
          break;
        }
        default:
          if (vText !== undefined && vText !== '') {
            const n = Number(vText);
            value = Number.isNaN(n) ? null : n;
          }
      }
      if (date1904 && typeof value === 'number' && isDateFormat(wb.styles.get(style).numFmt)) value += 1462;

      let formula: string | undefined;
      const f = asArray(c.f)[0];
      if (f !== undefined) {
        const ftype = attr(f, 't');
        const text = stripXlfn(textOf(f));
        try {
          if (ftype === 'shared') {
            const si = attr(f, 'si') ?? '';
            if (text !== '') {
              shared.set(si, { row: r, col, ast: parseFormula(text) });
              formula = text;
            } else {
              const m = shared.get(si);
              if (m) formula = printFormula(shiftRefs(m.ast, r - m.row, col - m.col));
            }
          } else if (text !== '') {
            formula = text;
            if (ftype === 'array') {
              const rect = parseRef(attr(f, 'ref') ?? '');
              if (rect && (rect.r2 > rect.r1 || rect.c2 > rect.c1)) arrays.push({ anchor: cellKey(r, col), rect });
            }
          }
          if (formula !== undefined) {
            const ast = parseFormula(formula);
            // table references and @ are shown in their short form, not the one stored in files
            if (/\[|SINGLE\(/.test(formula)) formula = printFormula(ast);
          }
        } catch {
          warnings.push(`Fórmula no soportada en ${sheet.name}!${ref ?? ''}: =${text}`);
          formula = undefined;
          value = E.NAME;
        }
      }
      if (value === null && formula === undefined && style === 0) continue;
      wb.loadCell(sheet.id, r, col, { value, formula, style });
    }
  }

  // legacy / dynamic array formulas: the other cells of the range become spill children with cached values
  for (const { anchor, rect } of arrays) {
    const h = rect.r2 - rect.r1 + 1;
    const w = rect.c2 - rect.c1 + 1;
    sheet.spills.set(anchor, { rows: h, cols: w });
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        if (!i && !j) continue;
        const k = cellKey(rect.r1 + i, rect.c1 + j);
        const existing = sheet.cells.get(k);
        if (existing) existing.spillOf = anchor;
        else sheet.cells.set(k, { value: null, style: 0, spillOf: anchor });
      }
    }
  }

  for (const mc of asArray(ws.mergeCells?.mergeCell)) {
    const rect = parseRef(attr(mc, 'ref') ?? '');
    if (rect) sheet.merges.push(rect);
  }

  if (ws.conditionalFormatting !== undefined) {
    const { rules, skipped } = parseConditionalFormatting(asArray(ws.conditionalFormatting), dxfs, theme);
    sheet.condFormats.push(...rules);
    if (skipped.length) warnings.push(`La hoja "${sheet.name}" tiene reglas de formato condicional no soportadas (${[...new Set(skipped)].join(', ')}); se omitieron.`);
  }
  if (ws.autoFilter !== undefined) {
    const { filter, skipped } = parseAutoFilter(ws.autoFilter);
    if (filter) {
      sheet.autoFilter = filter;
      // rows the file marks as hidden inside the filter range were hidden by the filter, not by hand
      for (const r of [...sheet.hiddenRows]) if (r > filter.range.r1 && r <= filter.range.r2) {
        sheet.hiddenRows.delete(r);
        sheet.filterHidden.add(r);
      }
    }
    if (skipped.length) warnings.push(`La hoja "${sheet.name}" tiene filtros no soportados (${[...new Set(skipped)].join(', ')}); se conservan solo los demás.`);
  }

  readPage(ws, sheet);
  if (ws.dataValidations !== undefined) sheet.validations.push(...parseValidations(ws.dataValidations));
  // extensions: sparklines and the data validations Excel keeps there (rules that point at other sheets)
  const known = new Set(['{05C60535-1F16-4fd2-B633-F4F36F0B64E0}', '{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}']);
  const unknown: string[] = [];
  for (const ext of asArray(ws.extLst?.ext)) {
    const uri = attr(ext, 'uri') ?? '';
    if (!known.has(uri)) unknown.push(uri);
  }
  if (ws.extLst !== undefined) {
    sheet.sparklines.push(...parseSparklines(ws.extLst));
    sheet.validations.push(...parseX14Validations(ws.extLst));
  }
  // slicer and pivot parts are read with the sheet's relationships; anything else in extLst is not understood
  extUnknown.set(sheet.id, unknown);
  void wb;
}

type Reader = (path: string) => Promise<XNode | undefined>;

async function relsOf(read: Reader, part: string): Promise<Map<string, string>> {
  const dir = part.split('/').slice(0, -1).join('/');
  const file = part.split('/').pop()!;
  const doc = await read(`${dir}/_rels/${file}.rels`);
  const map = new Map<string, string>();
  for (const rel of asArray(doc?.Relationships?.Relationship)) map.set(attr(rel, 'Id') ?? '', relPath(part, attr(rel, 'Target') ?? ''));
  return map;
}

interface RawRel {
  type: string;
  target: string;
  external: boolean;
  path: string;
}

async function rawRelsOf(read: Reader, part: string): Promise<Map<string, RawRel>> {
  const dir = part.split('/').slice(0, -1).join('/');
  const file = part.split('/').pop()!;
  const doc = await read(`${dir}/_rels/${file}.rels`);
  const map = new Map<string, RawRel>();
  for (const rel of asArray(doc?.Relationships?.Relationship)) {
    const target = attr(rel, 'Target') ?? '';
    map.set(attr(rel, 'Id') ?? '', { type: attr(rel, 'Type') ?? '', target, external: attr(rel, 'TargetMode') === 'External', path: relPath(part, target) });
  }
  return map;
}

const MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };

/** Hyperlinks, comments, tables, pictures: the parts a worksheet refers to. */
async function loadSheetParts(
  wb: Workbook,
  sheet: Sheet,
  ws: XNode,
  sheetPart: string,
  read: Reader,
  zip: JSZip,
  persons: Map<string, string>,
  warnings: string[],
  tableCounter: { n: number },
): Promise<void> {
  const rels = await rawRelsOf(read, sheetPart);
  if (ws.hyperlinks !== undefined) {
    const external = new Map<string, string>();
    for (const [id, r] of rels) if (r.external) external.set(id, r.target);
    sheet.hyperlinks.push(...parseHyperlinks(ws.hyperlinks, external));
  }
  // notes, then conversations (threaded comments) replace the placeholder text Excel writes for them
  let notes: ReturnType<typeof parseComments> = [];
  let threaded = new Map<string, { author: string; text: string }>();
  for (const r of rels.values()) {
    if (r.type.endsWith('/comments')) notes = parseComments(await read(r.path));
    else if (r.type.endsWith('/threadedComment')) threaded = parseThreaded(await read(r.path), persons);
  }
  for (const c of notes) {
    const conv = threaded.get(formatA1(c.row, c.col));
    sheet.comments.push(conv ? { ...c, author: conv.author || c.author, text: conv.text } : c);
  }
  if (threaded.size) warnings.push(`La hoja "${sheet.name}" tiene comentarios encadenados: se importan como notas con las respuestas debajo.`);
  for (const tp of asArray(ws.tableParts?.tablePart)) {
    const r = rels.get(attr(tp, 'id') ?? '');
    if (!r) continue;
    const t = parseTable(await read(r.path), `t${++tableCounter.n}`);
    if (t) sheet.tables.push(t);
  }
  // pictures are read with the drawing (loadDrawing)
  void wb;
  void zip;
}

/** Charts anchored in the sheet's drawing; other drawing objects are reported as unsupported. */
async function loadDrawing(wb: Workbook, sheet: Sheet, drawingRef: XNode, sheetPart: string, read: Reader, zip: JSZip, warnings: string[], theme: string[]): Promise<void> {
  const rels = await relsOf(read, sheetPart);
  const drawingPath = rels.get(attr(drawingRef, 'id') ?? '');
  if (!drawingPath) return;
  const drawing = await read(drawingPath);
  const drawingRels = await relsOf(read, drawingPath);
  const anchors = [...asArray(drawing?.wsDr?.twoCellAnchor), ...asArray(drawing?.wsDr?.oneCellAnchor), ...asArray(drawing?.wsDr?.absoluteAnchor)];
  let skippedPictures = 0;
  let n = 0;
  let p = 0;
  for (const a of anchors) {
    const frame = a.graphicFrame;
    const chartRef = frame?.graphic?.graphicData?.chart;
    if (!chartRef) {
      if (a.pic !== undefined) {
        const embed = attr(a.pic.blipFill?.blip, 'embed');
        const path = embed ? drawingRels.get(embed) : undefined;
        const file = path ? zip.file(path) : null;
        const mime = MIME_BY_EXT[(path ?? '').split('.').pop()!.toLowerCase()];
        const rect = anchorToRect(sheet, a);
        if (file && mime && rect) {
          const data = await file.async('uint8array');
          const cNv = a.pic.nvPicPr?.cNvPr;
          sheet.images.push({ id: `img-imp-${sheet.id}-${++p}`, media: wb.addMedia(mime, data), name: attr(cNv, 'name'), alt: attr(cNv, 'descr'), ...rect });
        } else skippedPictures++;
      }
      continue;
    }
    const chartPath = drawingRels.get(attr(chartRef, 'id') ?? '');
    const rect = anchorToRect(sheet, a);
    if (!chartPath || !rect) continue;
    const parsed = parseChart(await read(chartPath), theme);
    if ('skip' in parsed) {
      warnings.push(`Un gráfico de "${sheet.name}" no se importó: ${parsed.skip}.`);
      continue;
    }
    sheet.charts.push({ ...parsed.def, id: `chart-imp-${sheet.id}-${++n}`, ...rect });
  }
  if (skippedPictures) warnings.push(`La hoja "${sheet.name}" tiene ${skippedPictures} imagen(es) en un formato que no se puede importar (por ejemplo vectorial).`);
}

function rectsOfText(text: string): Rect[] {
  const out: Rect[] = [];
  let node;
  try {
    node = parseFormula(text);
  } catch {
    return out;
  }
  const visit = (n: ReturnType<typeof parseFormula>) => {
    if (n.t === 'ref') out.push({ r1: n.a.row, c1: n.a.col, r2: n.a.row, c2: n.a.col });
    else if (n.t === 'range') out.push({ r1: Math.min(n.a.row, n.b.row), c1: Math.min(n.a.col, n.b.col), r2: Math.max(n.a.row, n.b.row), c2: Math.max(n.a.col, n.b.col) });
    else if (n.t === 'union') n.parts.forEach(visit);
  };
  visit(node);
  return out;
}

function readPrintArea(sheet: Sheet, text: string): void {
  sheet.print.areas = rectsOfText(text.includes(',') ? `(${text})` : text).filter((r) => r.r2 < 1_048_575 || r.c2 < 16_383);
}

function readPrintTitles(sheet: Sheet, text: string): void {
  let node;
  try {
    node = parseFormula(text.includes(',') ? `(${text})` : text);
  } catch {
    return;
  }
  const parts = node.t === 'union' ? node.parts : [node];
  for (const p of parts) {
    if (p.t !== 'range') continue;
    if (p.whole === 'row') sheet.print.titleRows = { r1: p.a.row, r2: p.b.row };
    else if (p.whole === 'col') sheet.print.titleCols = { c1: p.a.col, c2: p.b.col };
  }
}

/** Read an .xlsx workbook. Cached values are kept; call `workbook.recalcAll()` to recompute. */
export async function readXlsx(data: Uint8Array | ArrayBuffer): Promise<ReadResult> {
  const zip = await JSZip.loadAsync(data);
  const read = async (path: string): Promise<XNode | undefined> => {
    const f = zip.file(path);
    if (!f) return undefined;
    return parser.parse(await f.async('string'));
  };

  const warnings: string[] = [];
  const rootRels = await read('_rels/.rels');
  let wbPath = 'xl/workbook.xml';
  for (const rel of asArray(rootRels?.Relationships?.Relationship)) {
    if (String(attr(rel, 'Type')).endsWith('/officeDocument')) wbPath = (attr(rel, 'Target') ?? '').replace(/^\//, '');
  }
  const wbDoc = await read(wbPath);
  if (!wbDoc?.workbook) throw new Error('El archivo no es un libro de Excel válido (falta xl/workbook.xml).');
  const rels = new Map<string, string>();
  const relsDoc = await read(relPath(wbPath, `_rels/${wbPath.split('/').pop()}.rels`));
  for (const rel of asArray(relsDoc?.Relationships?.Relationship)) rels.set(attr(rel, 'Id') ?? '', relPath(wbPath, attr(rel, 'Target') ?? ''));

  // theme colours
  let theme = DEFAULT_THEME;
  const themePath = [...rels.values()].find((p) => /theme\/theme\d*\.xml$/.test(p));
  if (themePath) {
    const th = await read(themePath);
    const scheme = th?.theme?.themeElements?.clrScheme;
    if (scheme) {
      const pick = (k: string): string | undefined => {
        const n = scheme[k];
        return attr(n?.srgbClr, 'val') ?? attr(n?.sysClr, 'lastClr');
      };
      const order = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
      theme = order.map((k, i) => pick(k) ?? DEFAULT_THEME[i]!);
    }
  }

  // people named in threaded comments
  const persons = new Map<string, string>();
  const personPath = [...(await rawRelsOf(read, wbPath)).values()].find((r) => r.type.endsWith('/person'))?.path;
  if (personPath) for (const p of asArray((await read(personPath))?.personList?.person)) persons.set(attr(p, 'id') ?? '', attr(p, 'displayName') ?? '');

  const wb = new Workbook();
  const stylesPath = [...rels.values()].find((p) => p.endsWith('styles.xml')) ?? 'xl/styles.xml';
  const { xfs, dxfs } = loadStyles(wb, await read(stylesPath), theme);
  const ssPath = [...rels.values()].find((p) => p.endsWith('sharedStrings.xml')) ?? 'xl/sharedStrings.xml';
  const strings = loadSharedStrings(await read(ssPath));
  const date1904 = attr(wbDoc.workbook.workbookPr, 'date1904') === '1' || attr(wbDoc.workbook.workbookPr, 'date1904') === 'true';

  const sheetDefs = asArray(wbDoc.workbook.sheets?.sheet);
  const sheetByIndex: Sheet[] = [];
  const tableCounter = { n: 0 };
  let first = true;
  for (const def of sheetDefs) {
    const name = attr(def, 'name') ?? `Hoja${wb.sheets.length + 1}`;
    const target = rels.get(attr(def, 'id') ?? '');
    const sheet = first ? wb.sheets[0]! : wb.addSheet(name);
    if (first) wb.renameSheet(sheet.id, name);
    first = false;
    if (!target) {
      warnings.push(`No se encontró el contenido de la hoja "${name}".`);
      continue;
    }
    const wsDoc = await read(target);
    loadSheet(wb, sheet, wsDoc, strings, xfs, dxfs, theme, date1904, warnings);
    await loadSheetParts(wb, sheet, wsDoc?.worksheet ?? {}, target, read, zip, persons, warnings, tableCounter);
    if (wsDoc?.worksheet?.drawing) await loadDrawing(wb, sheet, wsDoc.worksheet.drawing, target, read, zip, warnings, theme);
    const unknown = extUnknown.get(sheet.id) ?? [];
    const labelOf = (uri: string) =>
      uri === '{A8765BA9-456A-4dab-B4F3-ACF838C121DE}' || uri === '{3A4CF648-6AED-40f4-86FF-DC5316D8AED3}' ? 'segmentaciones' : uri === '{78C0D931-6437-407d-A8EE-F0AAD7539E65}' ? 'formatos condicionales de Excel 2010 (barras de datos con eje, conjuntos de iconos extra)' : 'extensiones de Excel';
    for (const label of new Set(unknown.map(labelOf))) warnings.push(`La hoja "${sheet.name}" contiene ${label}, que no se importan.`);
    sheetByIndex.push(sheet);
  }

  for (const dn of asArray(wbDoc.workbook.definedNames?.definedName)) {
    const name = attr(dn, 'name') ?? '';
    const local = attr(dn, 'localSheetId');
    const scope = local === undefined ? undefined : sheetByIndex[Number(local)];
    const text = stripXlfn(textOf(dn));
    if (name === '_xlnm.Print_Area' && scope) {
      readPrintArea(scope, text);
      continue;
    }
    if (name === '_xlnm.Print_Titles' && scope) {
      readPrintTitles(scope, text);
      continue;
    }
    if (name.startsWith('_xlnm') || attr(dn, 'hidden') === '1') continue;
    if (local !== undefined && !scope) continue;
    try {
      const def = { name, text, ast: parseFormula(text) };
      if (scope) scope.names.set(name.toLowerCase(), def);
      else wb.names.set(name.toLowerCase(), def);
    } catch {
      warnings.push(`Nombre definido no soportado: ${name}`);
    }
  }

  // what the suite itself stored for things a workbook has no place for
  let custom: string | undefined;
  for (const r of (await rawRelsOf(read, wbPath)).values()) {
    if (!r.type.endsWith('/customXml')) continue;
    const doc = await read(r.path);
    const t = doc?.suitenova;
    if (t !== undefined) custom = textOf(t);
  }

  if (custom) applySuitePart(wb, custom, warnings);
  wb.rebuildDependencies();
  return { workbook: wb, warnings, custom };
}
