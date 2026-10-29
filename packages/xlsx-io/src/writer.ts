import {
  BUILTIN_FORMATS,
  CalcError,
  MAX_COLS,
  formatA1,
  formatRect,
  keyCol,
  keyRow,
  type Border,
  type Scalar,
  type Sheet,
  type Style,
  type Workbook,
} from '@suitenova/calc-engine';
import JSZip from 'jszip';
import { chartXml, drawingXml, type DrawingItem } from './charts-io';
import { commentsXml, hyperlinksXml, pageXml, printNames, sparklinesExtXml, tableXml, validationsXml, vmlXml } from './objects-io';
import { toFileFormula } from './fileformula';
import { quoteSheetName } from './sheetname';
import { buildSuitePart } from './suite-part';
import { autoFilterXml, cfRuleXml, dxfXml } from './filter-cf-io';
import { escapeXml } from './xml';

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const hex = (c: string | undefined): string | undefined => (c ? `FF${c.replace('#', '').toUpperCase()}` : undefined);
const colWidthFromPx = (px: number) => Math.max(0, Math.round(((px - 5) / 7) * 100) / 100);
const pxToPt = (px: number) => Math.round(((px * 72) / 96) * 100) / 100;

class StyleBuilder {
  fonts: string[] = [];
  fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  borders: string[] = [];
  numFmts = new Map<string, number>();
  xfs: string[] = [];
  private idx = new Map<string, number>();
  private fontIdx = new Map<string, number>();
  private fillIdx = new Map<string, number>();
  private borderIdx = new Map<string, number>();
  private nextFmt = 164;
  dxfs: string[] = [];
  private dxfIdx = new Map<string, number>();
  private builtin = new Map<string, number>();

  constructor(private wb: Workbook) {
    for (const [id, code] of Object.entries(BUILTIN_FORMATS)) {
      const n = Number(id);
      if (n !== 14 && n < 50 && !this.builtin.has(code)) this.builtin.set(code, n);
    }
    this.fontXml({});
    this.borderXml({});
    this.xfFor(0);
  }

  private fontXml(st: Style): number {
    const df = this.wb.defaultFont;
    const xml =
      '<font>' +
      (st.bold ? '<b/>' : '') +
      (st.italic ? '<i/>' : '') +
      (st.strike ? '<strike/>' : '') +
      (st.underline ? '<u/>' : '') +
      `<sz val="${st.fontSize ?? df.size}"/>` +
      (st.color ? `<color rgb="${hex(st.color)}"/>` : '<color theme="1"/>') +
      `<name val="${escapeXml(st.fontName ?? df.name)}"/><family val="2"/>` +
      '</font>';
    let i = this.fontIdx.get(xml);
    if (i === undefined) {
      i = this.fonts.length;
      this.fonts.push(xml);
      this.fontIdx.set(xml, i);
    }
    return i;
  }

  private fillXml(bg: string | undefined): number {
    if (!bg) return 0;
    const xml = `<fill><patternFill patternType="solid"><fgColor rgb="${hex(bg)}"/><bgColor indexed="64"/></patternFill></fill>`;
    let i = this.fillIdx.get(xml);
    if (i === undefined) {
      i = this.fills.length;
      this.fills.push(xml);
      this.fillIdx.set(xml, i);
    }
    return i;
  }

  private borderXml(st: Style): number {
    const side = (tag: string, b: Border | undefined) => (b ? `<${tag} style="${b.style}"><color ${b.color ? `rgb="${hex(b.color)}"` : 'auto="1"'}/></${tag}>` : `<${tag}/>`);
    const xml = `<border>${side('left', st.left)}${side('right', st.right)}${side('top', st.top)}${side('bottom', st.bottom)}<diagonal/></border>`;
    let i = this.borderIdx.get(xml);
    if (i === undefined) {
      i = this.borders.length;
      this.borders.push(xml);
      this.borderIdx.set(xml, i);
    }
    return i;
  }

  private numFmtId(code: string | undefined): number {
    if (!code || code === 'General') return 0;
    const b = this.builtin.get(code);
    if (b !== undefined) return b;
    let id = this.numFmts.get(code);
    if (id === undefined) {
      id = this.nextFmt++;
      this.numFmts.set(code, id);
    }
    return id;
  }

  /** Index of a differential format (conditional formatting) in styles.xml. */
  dxfFor(f: Parameters<typeof dxfXml>[0]): number {
    const xml = dxfXml(f);
    let i = this.dxfIdx.get(xml);
    if (i === undefined) {
      i = this.dxfs.length;
      this.dxfs.push(xml);
      this.dxfIdx.set(xml, i);
    }
    return i;
  }

  /** xf index for an engine style id. */
  xfFor(styleId: number): number {
    const cached = this.idx.get(String(styleId));
    if (cached !== undefined) return cached;
    const st = this.wb.styles.get(styleId);
    const font = this.fontXml(st);
    const fill = this.fillXml(st.bg);
    const border = this.borderXml(st);
    const fmt = this.numFmtId(st.numFmt);
    const hasAlign = st.hAlign || st.vAlign || st.wrap || st.indent;
    const align = hasAlign
      ? `<alignment${st.hAlign ? ` horizontal="${st.hAlign}"` : ''}${st.vAlign ? ` vertical="${st.vAlign === 'middle' ? 'center' : st.vAlign}"` : ''}${st.wrap ? ' wrapText="1"' : ''}${st.indent ? ` indent="${st.indent}"` : ''}/>`
      : '';
    const xml = `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${hasAlign ? ' applyAlignment="1">' + align + '</xf>' : '/>'}`;
    const i = this.xfs.length;
    this.xfs.push(xml);
    this.idx.set(String(styleId), i);
    return i;
  }

  toXml(): string {
    const fmts = [...this.numFmts].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`).join('');
    return (
      XML_HEAD +
      `<styleSheet xmlns="${NS_MAIN}">` +
      (fmts ? `<numFmts count="${this.numFmts.size}">${fmts}</numFmts>` : '') +
      `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join('')}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      (this.dxfs.length ? `<dxfs count="${this.dxfs.length}">${this.dxfs.join('')}</dxfs>` : '') +
      '</styleSheet>'
    );
  }
}

class StringTable {
  private map = new Map<string, number>();
  list: string[] = [];
  count = 0;
  index(s: string): number {
    this.count++;
    let i = this.map.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(s);
      this.map.set(s, i);
    }
    return i;
  }
  toXml(): string {
    const items = this.list.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('');
    return `${XML_HEAD}<sst xmlns="${NS_MAIN}" count="${this.count}" uniqueCount="${this.list.length}">${items}</sst>`;
  }
}

interface WriteState {
  wb: Workbook;
  styles: StyleBuilder;
  strings: StringTable;
  usesDynamicArrays: boolean;
}

function numText(n: number): string {
  return Number.isFinite(n) ? String(n) : '0';
}

interface SheetParts {
  drawingRId?: string;
  legacyRId?: string;
  tableRIds: string[];
  /** Register an external address; returns the relationship id. */
  externalRel: (url: string) => string;
  /** Extra extension elements (slicer lists…). */
  extra: string;
}

function sheetXml(st: WriteState, sheet: Sheet, parts: SheetParts): string {
  const { styles, strings } = st;
  const keys = [...sheet.cells.keys()].sort((a, b) => a - b);
  const rows: string[] = [];
  // rows that only carry a height or hidden flag still need a <row> element
  const layoutRows = new Set<number>([...sheet.rowHeights.keys(), ...sheet.hiddenRows, ...sheet.filterHidden]);
  const byRow = new Map<number, string[]>();
  let maxR = 0;
  let maxC = 0;
  for (const k of keys) {
    const c = sheet.cells.get(k)!;
    const r = keyRow(k);
    const col = keyCol(k);
    let cells = byRow.get(r);
    if (!cells) byRow.set(r, (cells = []));
    maxR = Math.max(maxR, r);
    maxC = Math.max(maxC, col);
    const ref = formatA1(r, col);
    const s = styles.xfFor(c.style);
    const sAttr = s ? ` s="${s}"` : '';
    const v: Scalar = c.value;
    let t = '';
    let vXml = '';
    if (v instanceof CalcError) {
      t = ' t="e"';
      vXml = `<v>${v.code}</v>`;
    } else if (typeof v === 'string') {
      if (c.formula) {
        t = ' t="str"';
        vXml = `<v>${escapeXml(v)}</v>`;
      } else {
        t = ' t="s"';
        vXml = `<v>${strings.index(v)}</v>`;
      }
    } else if (typeof v === 'boolean') {
      t = ' t="b"';
      vXml = `<v>${v ? 1 : 0}</v>`;
    } else if (typeof v === 'number') {
      vXml = `<v>${numText(v)}</v>`;
    }
    if (c.formula) {
      const ext = sheet.spills.get(k);
      const text = escapeXml(toFileFormula(c.formula.text, st.wb.tableContaining(sheet.id, r, col)?.table.name));
      if (ext && (ext.rows > 1 || ext.cols > 1)) {
        st.usesDynamicArrays = true;
        const ref2 = formatRect({ r1: r, c1: col, r2: r + ext.rows - 1, c2: col + ext.cols - 1 });
        cells.push(`<c r="${ref}"${sAttr}${t} cm="1"><f t="array" ref="${ref2}">${text}</f>${vXml}</c>`);
      } else {
        cells.push(`<c r="${ref}"${sAttr}${t}><f>${text}</f>${vXml}</c>`);
      }
    } else if (vXml || s) {
      cells.push(`<c r="${ref}"${sAttr}${t}>${vXml}</c>`);
    }
  }
  for (const r of layoutRows) if (!byRow.has(r)) byRow.set(r, []);
  for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
    const h = sheet.rowHeights.get(r);
    const hidden = sheet.hiddenRows.has(r) || sheet.filterHidden.has(r);
    rows.push(`<row r="${r + 1}"${h ? ` ht="${pxToPt(h)}" customHeight="1"` : ''}${hidden ? ' hidden="1"' : ''}>${byRow.get(r)!.join('')}</row>`);
  }

  // column widths, grouping equal neighbours
  const cols: string[] = [];
  const colKeys = new Set<number>([...sheet.colWidths.keys(), ...sheet.hiddenCols]);
  const sorted = [...colKeys].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; ) {
    const c0 = sorted[i]!;
    const w = sheet.colWidths.get(c0);
    const hid = sheet.hiddenCols.has(c0);
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1 && sheet.colWidths.get(sorted[j + 1]!) === w && sheet.hiddenCols.has(sorted[j + 1]!) === hid) j++;
    cols.push(`<col min="${c0 + 1}" max="${sorted[j]! + 1}" width="${w !== undefined ? colWidthFromPx(w) : 8.43}"${w !== undefined ? ' customWidth="1"' : ''}${hid ? ' hidden="1"' : ''}/>`);
    i = j + 1;
  }

  const f = sheet.freeze;
  const pane =
    f.rows || f.cols
      ? `<pane${f.cols ? ` xSplit="${f.cols}"` : ''}${f.rows ? ` ySplit="${f.rows}"` : ''} topLeftCell="${formatA1(f.rows, f.cols)}" activePane="${f.rows && f.cols ? 'bottomRight' : f.rows ? 'bottomLeft' : 'topRight'}" state="frozen"/>`
      : '';
  const autoFilter = sheet.autoFilter ? autoFilterXml(sheet.autoFilter) : '';
  const condFormats = [...sheet.condFormats]
    .sort((x, y) => x.priority - y.priority)
    .map((r) => cfRuleXml(r, r.format && Object.keys(r.format).length ? st.styles.dxfFor(r.format) : undefined))
    .join('');
  const merges = sheet.merges.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${formatRect(m)}"/>`).join('')}</mergeCells>` : '';
  const dim = keys.length ? `<dimension ref="A1:${formatA1(maxR, Math.min(maxC, MAX_COLS - 1))}"/>` : '<dimension ref="A1"/>';
  const page = pageXml(sheet);
  const sparkExt = sparklinesExtXml(sheet);
  const ext = sparkExt + parts.extra;

  return (
    XML_HEAD +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    (sheet.tabColor || page.sheetPr ? `<sheetPr>${sheet.tabColor ? `<tabColor rgb="${hex(sheet.tabColor)}"/>` : ''}${page.sheetPr}</sheetPr>` : '') +
    dim +
    `<sheetViews><sheetView${sheet.showGrid ? '' : ' showGridLines="0"'} workbookViewId="0">${pane}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (cols.length ? `<cols>${cols.join('')}</cols>` : '') +
    `<sheetData>${rows.join('')}</sheetData>` +
    autoFilter +
    merges +
    condFormats +
    validationsXml(sheet) +
    hyperlinksXml(sheet, parts.externalRel) +
    page.options +
    page.breaks +
    (parts.drawingRId ? `<drawing r:id="${parts.drawingRId}"/>` : '') +
    (parts.legacyRId ? `<legacyDrawing r:id="${parts.legacyRId}"/>` : '') +
    (parts.tableRIds.length ? `<tableParts count="${parts.tableRIds.length}">${parts.tableRIds.map((r) => `<tablePart r:id="${r}"/>`).join('')}</tableParts>` : '') +
    (ext ? `<extLst>${ext}</extLst>` : '') +
    '</worksheet>'
  );
}

const METADATA_XML =
  XML_HEAD +
  `<metadata xmlns="${NS_MAIN}" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray">` +
  '<metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes>' +
  '<futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata>' +
  '<cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata>' +
  '</metadata>';

/** Serialise a workbook as .xlsx (Office Open XML, 1900 date system). */
export async function writeXlsx(wb: Workbook, extras: { customJson?: string } = {}): Promise<Uint8Array> {
  extras = { customJson: extras.customJson ?? buildSuitePart(wb) };
  const st: WriteState = { wb, styles: new StyleBuilder(wb), strings: new StringTable(), usesDynamicArrays: false };
  const zip = new JSZip();
  // no folder entries in the package: Office does not write them
  const put = (name: string, data: string | Uint8Array) => zip.file(name, data, { createFolders: false });
  
  const sheetFiles = wb.sheets.map((sh, i) => ({ sheet: sh, path: `xl/worksheets/sheet${i + 1}.xml`, n: i + 1 }));
  const types: string[] = [];
  const mediaExts = new Set<string>();
  let drawingCount = 0;
  let chartCount = 0;
  let commentCount = 0;
  let tableCount = 0;
  let mediaCount = 0;
  const mediaFile = new Map<string, string>();
  const REL_BASE = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const relsXml = (list: { id: string; type: string; target: string; external?: boolean }[]) =>
    `${XML_HEAD}<Relationships xmlns="${REL_BASE}">${list.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${escapeXml(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
  const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/webp': 'webp' };

  sheetFiles.forEach(({ sheet, path, n }) => {
    const rels: { id: string; type: string; target: string; external?: boolean }[] = [];
    const nextId = () => `rId${rels.length + 1}`;
    // charts and pictures share one drawing part
    const items: DrawingItem[] = [];
    const drawingRels: { id: string; type: string; target: string }[] = [];
    if (sheet.charts.length || sheet.images.length) {
      const dn = ++drawingCount;
      sheet.charts.forEach((c, i) => {
        const k = ++chartCount;
        const rid = `rId${drawingRels.length + 1}`;
        drawingRels.push({ id: rid, type: `${NS_REL}/chart`, target: `../charts/chart${k}.xml` });
        put(`xl/charts/chart${k}.xml`, chartXml(c, wb, sheet.id));
        types.push(`<Override PartName="/xl/charts/chart${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
        items.push({ kind: 'chart', rId: rid, x: c.x, y: c.y, width: c.width, height: c.height, name: `Gráfico ${i + 1}` });
      });
      sheet.images.forEach((img, i) => {
        const media = wb.media.get(img.media);
        const ext = media ? EXT[media.mime] : undefined;
        if (!media || !ext) return;
        let file = mediaFile.get(img.media);
        if (!file) {
          file = `image${++mediaCount}.${ext}`;
          mediaFile.set(img.media, file);
          put(`xl/media/${file}`, media.data);
          mediaExts.add(ext);
        }
        const rid = `rId${drawingRels.length + 1}`;
        drawingRels.push({ id: rid, type: `${NS_REL}/image`, target: `../media/${file}` });
        items.push({ kind: 'pic', rId: rid, x: img.x, y: img.y, width: img.width, height: img.height, name: img.name ?? `Imagen ${i + 1}`, alt: img.alt });
      });
      put(`xl/drawings/drawing${dn}.xml`, drawingXml(sheet, items));
      put(`xl/drawings/_rels/drawing${dn}.xml.rels`, relsXml(drawingRels));
      types.push(`<Override PartName="/xl/drawings/drawing${dn}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
      rels.push({ id: nextId(), type: `${NS_REL}/drawing`, target: `../drawings/drawing${dn}.xml` });
    }
    const drawingRId = rels.length ? rels[rels.length - 1]!.id : undefined;

    let legacyRId: string | undefined;
    if (sheet.comments.length) {
      const k = ++commentCount;
      put(`xl/comments${k}.xml`, commentsXml(sheet));
      put(`xl/drawings/vmlDrawing${k}.vml`, vmlXml(sheet));
      types.push(`<Override PartName="/xl/comments${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>`);
      rels.push({ id: nextId(), type: `${NS_REL}/vmlDrawing`, target: `../drawings/vmlDrawing${k}.vml` });
      legacyRId = rels[rels.length - 1]!.id;
      rels.push({ id: nextId(), type: `${NS_REL}/comments`, target: `../comments${k}.xml` });
    }

    const tableRIds: string[] = [];
    for (const t of sheet.tables) {
      const k = ++tableCount;
      put(`xl/tables/table${k}.xml`, tableXml(t, k));
      types.push(`<Override PartName="/xl/tables/table${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`);
      rels.push({ id: nextId(), type: `${NS_REL}/table`, target: `../tables/table${k}.xml` });
      tableRIds.push(rels[rels.length - 1]!.id);
    }

    const external = new Map<string, string>();
    const externalRel = (url: string): string => {
      let id = external.get(url);
      if (!id) {
        id = nextId();
        rels.push({ id, type: `${NS_REL}/hyperlink`, target: url, external: true });
        external.set(url, id);
      }
      return id;
    };
    const xml = sheetXml(st, sheet, { drawingRId, legacyRId, tableRIds, externalRel, extra: '' });
    put(path, xml);
    if (rels.length) put(`xl/worksheets/_rels/sheet${n}.xml.rels`, relsXml(rels));
  });

  put('xl/styles.xml', st.styles.toXml());
  put('xl/sharedStrings.xml', st.strings.toXml());
  if (st.usesDynamicArrays) put('xl/metadata.xml', METADATA_XML);

  const fileTexts = (text: string) => escapeXml(toFileFormula(text));
  const names =
    [...wb.names.entries()].map(([, def]) => `<definedName name="${escapeXml(def.name)}">${fileTexts(def.text)}</definedName>`).join('') +
    sheetFiles
      .flatMap(({ sheet }, i) => [...sheet.names.values()].map((def) => `<definedName name="${escapeXml(def.name)}" localSheetId="${i}">${fileTexts(def.text)}</definedName>`))
      .join('') +
    sheetFiles.flatMap(({ sheet }, i) => printNames(sheet, i, quoteSheetName)).join('');
  put(
    'xl/workbook.xml',
    XML_HEAD +
      `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><workbookPr/><bookViews><workbookView/></bookViews><sheets>` +
      sheetFiles.map(({ sheet }, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets>' +
      (names ? `<definedNames>${names}</definedNames>` : '') +
      '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>',
  );

  const n = sheetFiles.length;
  let relId = n;
  const wbRels = sheetFiles.map((_s, i) => ({ id: `rId${i + 1}`, type: `${NS_REL}/worksheet`, target: `worksheets/sheet${i + 1}.xml` }));
  wbRels.push({ id: `rId${++relId}`, type: `${NS_REL}/styles`, target: 'styles.xml' });
  wbRels.push({ id: `rId${++relId}`, type: `${NS_REL}/sharedStrings`, target: 'sharedStrings.xml' });
  if (st.usesDynamicArrays) wbRels.push({ id: `rId${++relId}`, type: `${NS_REL}/sheetMetadata`, target: 'metadata.xml' });
  if (extras.customJson) {
    wbRels.push({ id: `rId${++relId}`, type: `${NS_REL}/customXml`, target: '../customXml/item1.xml' });
    put('customXml/item1.xml', `${XML_HEAD}<suitenova xmlns="urn:suitenova:calc:1"><![CDATA[${extras.customJson.replace(/]]>/g, ']]]]><![CDATA[>')}]]></suitenova>`);
    put('customXml/itemProps1.xml', `${XML_HEAD}<ds:datastoreItem ds:itemID="{5C3E1A7B-0D2F-4B6A-9E41-6A2B7C0D9F11}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="urn:suitenova:calc:1"/></ds:schemaRefs></ds:datastoreItem>`);
    put('customXml/_rels/item1.xml.rels', relsXml([{ id: 'rId1', type: `${NS_REL}/customXmlProps`, target: 'itemProps1.xml' }]));
    types.push('<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>');
  }
  put('xl/_rels/workbook.xml.rels', relsXml(wbRels));

  put(
    '_rels/.rels',
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${NS_REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  );
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  put(
    'docProps/core.xml',
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>SuiteNova</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  );
  put('docProps/app.xml', `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>SuiteNova Nova Calc</Application></Properties>`);

  const MIME: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };
  const ct =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    (commentCount ? '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>' : '') +
    [...mediaExts].map((e) => `<Default Extension="${e}" ContentType="${MIME[e]}"/>`).join('') +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheetFiles.map((_s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    types.join('') +
    (st.usesDynamicArrays ? '<Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/>' : '') +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>';
  put('[Content_Types].xml', ct);

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
