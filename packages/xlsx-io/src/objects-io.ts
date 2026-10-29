import {
  defaultPrintSettings,
  formatA1,
  formatRect,
  keyCol,
  keyRow,
  newSparklineGroup,
  normRect,
  parseA1,
  type CellComment,
  type DataValidation,
  type Hyperlink,
  type PageSetup,
  type Rect,
  type Sheet,
  type SparklineGroup,
  type TableDef,
  type ValidationOp,
  type ValidationType,
} from '@suitenova/calc-engine';
import { autoFilterXml, parseAutoFilter } from './filter-cf-io';
import { toFileFormula } from './fileformula';
import { asArray, attr, escapeXml, textOf, type XNode } from './xml';

export const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const NS_XM = 'http://schemas.microsoft.com/office/excel/2006/main';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const hex = (c: string): string => `FF${c.replace('#', '').toUpperCase()}`;
const unhex = (c: string | undefined): string | undefined => (c ? `#${c.slice(-6).toLowerCase()}` : undefined);
const bool = (v: string | undefined): boolean => v === '1' || v === 'true';

function parseRefs(sqref: string | undefined): Rect[] {
  const out: Rect[] = [];
  for (const part of (sqref ?? '').split(/\s+/)) {
    if (!part) continue;
    const [a, b] = part.split(':');
    const p = parseA1(a ?? '');
    const q = parseA1(b ?? a ?? '');
    if (p && q) out.push(normRect({ r1: p.row, c1: p.col, r2: q.row, c2: q.col }));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ data validation
const VALIDATION_TYPES: ValidationType[] = ['any', 'whole', 'decimal', 'list', 'date', 'time', 'textLength', 'custom'];

export function validationsXml(sheet: Sheet): string {
  const rules = sheet.validations.filter((v) => v.ranges.length);
  if (!rules.length) return '';
  const items = rules.map((v) => {
    const a: string[] = [];
    a.push(`type="${v.type === 'any' ? 'none' : v.type}"`);
    if (v.errorStyle !== 'stop') a.push(`errorStyle="${v.errorStyle}"`);
    if (v.op !== 'between' && v.type !== 'list' && v.type !== 'custom' && v.type !== 'any') a.push(`operator="${v.op}"`);
    if (v.allowBlank) a.push('allowBlank="1"');
    if (v.type === 'list' && !v.showDropdown) a.push('showDropDown="1"');
    if (v.showInput) a.push('showInputMessage="1"');
    if (v.showError) a.push('showErrorMessage="1"');
    if (v.errorTitle) a.push(`errorTitle="${escapeXml(v.errorTitle.slice(0, 32))}"`);
    if (v.errorMessage) a.push(`error="${escapeXml(v.errorMessage.slice(0, 255))}"`);
    if (v.inputTitle) a.push(`promptTitle="${escapeXml(v.inputTitle.slice(0, 32))}"`);
    if (v.inputMessage) a.push(`prompt="${escapeXml(v.inputMessage.slice(0, 255))}"`);
    a.push(`sqref="${v.ranges.map((r) => formatRect(normRect(r))).join(' ')}"`);
    const f1 = v.type !== 'any' && v.formula1 !== '' ? `<formula1>${escapeXml(toFileFormula(v.formula1))}</formula1>` : '';
    const f2 = v.formula2 !== undefined && v.formula2 !== '' && (v.op === 'between' || v.op === 'notBetween') && v.type !== 'list' && v.type !== 'custom' ? `<formula2>${escapeXml(toFileFormula(v.formula2))}</formula2>` : '';
    return `<dataValidation ${a.join(' ')}>${f1}${f2}</dataValidation>`;
  });
  return `<dataValidations count="${items.length}">${items.join('')}</dataValidations>`;
}

export function parseValidations(node: XNode): DataValidation[] {
  const out: DataValidation[] = [];
  let n = 0;
  for (const dv of asArray(node?.dataValidation)) {
    const ranges = parseRefs(attr(dv, 'sqref'));
    if (!ranges.length) continue;
    const t = attr(dv, 'type') ?? 'none';
    const type: ValidationType = t === 'none' ? 'any' : VALIDATION_TYPES.includes(t as ValidationType) ? (t as ValidationType) : 'any';
    const f = (x: XNode): string | undefined => {
      const first = asArray(x)[0];
      const text = first === undefined ? undefined : textOf(first);
      return text === undefined || text === '' ? undefined : text.replace(/_xlfn\.(_xlws\.)?/g, '');
    };
    const op = (attr(dv, 'operator') ?? 'between') as ValidationOp;
    out.push({
      id: `v${++n}`,
      ranges,
      type,
      op,
      formula1: f(dv.formula1) ?? '',
      formula2: f(dv.formula2),
      allowBlank: bool(attr(dv, 'allowBlank')),
      // in the file, showDropDown="1" means the arrow is hidden
      showDropdown: !bool(attr(dv, 'showDropDown')),
      showInput: bool(attr(dv, 'showInputMessage')),
      inputTitle: attr(dv, 'promptTitle'),
      inputMessage: attr(dv, 'prompt'),
      showError: bool(attr(dv, 'showErrorMessage')),
      errorStyle: (attr(dv, 'errorStyle') as DataValidation['errorStyle'] | undefined) ?? 'stop',
      errorTitle: attr(dv, 'errorTitle'),
      errorMessage: attr(dv, 'error'),
    });
  }
  return out;
}

/** The data validations Excel 2010+ stores in the worksheet extension (the ones that point at other sheets). */
export function parseX14Validations(extLst: XNode): DataValidation[] {
  const out: DataValidation[] = [];
  let n = 100;
  for (const ext of asArray(extLst?.ext)) {
    for (const dv of asArray(ext.dataValidations?.dataValidation)) {
      const ranges = parseRefs(textOf(dv.sqref));
      if (!ranges.length) continue;
      const t = attr(dv, 'type') ?? 'none';
      const f = (x: XNode): string | undefined => {
        const one = asArray(x)[0];
        const text = one?.f !== undefined ? textOf(one.f) : undefined;
        return text ? text.replace(/_xlfn\.(_xlws\.)?/g, '') : undefined;
      };
      out.push({
        id: `v${++n}`,
        ranges,
        type: t === 'none' ? 'any' : VALIDATION_TYPES.includes(t as ValidationType) ? (t as ValidationType) : 'any',
        op: (attr(dv, 'operator') ?? 'between') as ValidationOp,
        formula1: f(dv.formula1) ?? '',
        formula2: f(dv.formula2),
        allowBlank: bool(attr(dv, 'allowBlank')),
        showDropdown: !bool(attr(dv, 'showDropDown')),
        showInput: bool(attr(dv, 'showInputMessage')),
        inputTitle: attr(dv, 'promptTitle'),
        inputMessage: attr(dv, 'prompt'),
        showError: bool(attr(dv, 'showErrorMessage')),
        errorStyle: (attr(dv, 'errorStyle') as DataValidation['errorStyle'] | undefined) ?? 'stop',
        errorTitle: attr(dv, 'errorTitle'),
        errorMessage: attr(dv, 'error'),
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ hyperlinks
/** `addRel` registers an external address and returns the relationship id. */
export function hyperlinksXml(sheet: Sheet, addRel: (url: string) => string): string {
  if (!sheet.hyperlinks.length) return '';
  const items = sheet.hyperlinks.map((h) => {
    const a = [`ref="${formatRect(normRect(h.rect))}"`];
    if (h.url) a.push(`r:id="${addRel(h.url)}"`);
    if (h.location) a.push(`location="${escapeXml(h.location)}"`);
    if (h.tooltip) a.push(`tooltip="${escapeXml(h.tooltip)}"`);
    return `<hyperlink ${a.join(' ')}/>`;
  });
  return `<hyperlinks>${items.join('')}</hyperlinks>`;
}

export function parseHyperlinks(node: XNode, rels: Map<string, string>): Hyperlink[] {
  const out: Hyperlink[] = [];
  for (const h of asArray(node?.hyperlink)) {
    const rect = parseRefs(attr(h, 'ref'))[0];
    if (!rect) continue;
    const link: Hyperlink = { rect };
    const id = attr(h, 'id');
    if (id && rels.has(id)) link.url = rels.get(id)!;
    const loc = attr(h, 'location');
    if (loc) link.location = loc;
    const tip = attr(h, 'tooltip');
    if (tip) link.tooltip = tip;
    if (link.url || link.location) out.push(link);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ comments (notes)
export function commentsXml(sheet: Sheet): string {
  const authors: string[] = [];
  const idx = (a: string) => {
    let i = authors.indexOf(a);
    if (i < 0) i = authors.push(a) - 1;
    return i;
  };
  const list = [...sheet.comments]
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((c) => `<comment ref="${formatA1(c.row, c.col)}" authorId="${idx(c.author || 'Autor')}"><text><r><rPr><sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/></rPr><t xml:space="preserve">${escapeXml(c.text)}</t></r></text></comment>`)
    .join('');
  return `${HEAD}<comments xmlns="${NS_MAIN}"><authors>${authors.map((a) => `<author>${escapeXml(a)}</author>`).join('')}</authors><commentList>${list}</commentList></comments>`;
}

/** The legacy VML drawing Excel needs to show notes. */
export function vmlXml(sheet: Sheet): string {
  const shapes = [...sheet.comments]
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((c, i) => {
      const w = Math.max(60, c.width ?? 160);
      const h = Math.max(30, c.height ?? 80);
      const anchor = `${c.col + 1}, 15, ${Math.max(0, c.row - 1)}, 10, ${c.col + 3}, 15, ${c.row + 4}, 4`;
      return (
        `<v:shape id="_x0000_s${1025 + i}" type="#_x0000_t202" style="position:absolute;margin-left:80pt;margin-top:2pt;width:${Math.round(w * 0.75)}pt;height:${Math.round(h * 0.75)}pt;z-index:${i + 1};visibility:${c.visible ? 'visible' : 'hidden'}" fillcolor="#ffffe1" o:insetmode="auto">` +
        '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>' +
        `<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${anchor}</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${c.row}</x:Row><x:Column>${c.col}</x:Column>${c.visible ? '<x:Visible/>' : ''}</x:ClientData></v:shape>`
      );
    })
    .join('');
  return (
    '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>' +
    '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>' +
    shapes +
    '</xml>'
  );
}

function runsText(t: XNode): string {
  if (t === undefined || t === null) return '';
  if (t.t !== undefined) return textOf(t.t);
  return asArray(t.r)
    .map((r: XNode) => textOf(r.t))
    .join('');
}

export function parseComments(doc: XNode): CellComment[] {
  const authors = asArray(doc?.comments?.authors?.author).map((a: XNode) => textOf(a));
  const out: CellComment[] = [];
  for (const c of asArray(doc?.comments?.commentList?.comment)) {
    const p = parseA1(attr(c, 'ref') ?? '');
    if (!p) continue;
    out.push({ row: p.row, col: p.col, author: authors[Number(attr(c, 'authorId') ?? 0)] ?? '', text: runsText(c.text) });
  }
  return out;
}

/** Threaded comments: one conversation per cell, shown as a note with the replies below. */
export function parseThreaded(doc: XNode, persons: Map<string, string>): Map<string, { author: string; text: string }> {
  const byRef = new Map<string, { author: string; text: string }[]>();
  for (const t of asArray(doc?.ThreadedComments?.threadedComment)) {
    const ref = attr(t, 'ref');
    if (!ref) continue;
    const list = byRef.get(ref) ?? [];
    list.push({ author: persons.get(attr(t, 'personId') ?? '') ?? '', text: textOf(t.text) });
    byRef.set(ref, list);
  }
  const out = new Map<string, { author: string; text: string }>();
  for (const [ref, list] of byRef) {
    out.set(ref, { author: list[0]!.author, text: list.length === 1 ? list[0]!.text : list.map((x, i) => (i === 0 ? x.text : `↳ ${x.author}: ${x.text}`)).join('\n') });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ tables
const TOTAL_FILE: Record<string, string> = { sum: 'sum', average: 'average', count: 'count', countNums: 'countNums', max: 'max', min: 'min', stdDev: 'stdDev', var: 'var', custom: 'custom', none: 'none' };

export function tableXml(t: TableDef, id: number): string {
  const r = normRect(t.ref);
  const cols = t.columns
    .map((c, i) => {
      const a = [`id="${i + 1}"`, `name="${escapeXml(c.name)}"`];
      if (t.totals) {
        if (c.total && c.total !== 'none' && c.total !== 'custom') a.push(`totalsRowFunction="${TOTAL_FILE[c.total]}"`);
        else if (c.totalLabel) a.push(`totalsRowLabel="${escapeXml(c.totalLabel)}"`);
      }
      const calc = c.calc ? `<calculatedColumnFormula>${escapeXml(toFileFormula(c.calc, t.name))}</calculatedColumnFormula>` : '';
      return `<tableColumn ${a.join(' ')}>${calc}</tableColumn>`;
    })
    .join('');
  const af = t.header && t.filterButtons ? (t.filter ? autoFilterXml({ ...t.filter, range: { ...r, r2: t.totals ? r.r2 - 1 : r.r2 } }) : `<autoFilter ref="${formatRect({ ...r, r2: t.totals ? r.r2 - 1 : r.r2 })}"/>`) : '';
  return (
    `${HEAD}<table xmlns="${NS_MAIN}" id="${id}" name="${escapeXml(t.name)}" displayName="${escapeXml(t.name)}" ref="${formatRect(r)}"` +
    `${t.header ? '' : ' headerRowCount="0"'}${t.totals ? ' totalsRowCount="1"' : ' totalsRowShown="0"'}>` +
    `${af}<tableColumns count="${t.columns.length}">${cols}</tableColumns>` +
    `<tableStyleInfo name="${escapeXml(t.style)}" showFirstColumn="${t.firstCol ? 1 : 0}" showLastColumn="${t.lastCol ? 1 : 0}" showRowStripes="${t.rowStripes ? 1 : 0}" showColumnStripes="${t.colStripes ? 1 : 0}"/></table>`
  );
}

export function parseTable(doc: XNode, id: string): TableDef | null {
  const t = doc?.table;
  const ref = parseRefs(attr(t, 'ref'))[0];
  if (!t || !ref) return null;
  const header = attr(t, 'headerRowCount') !== '0';
  const totals = Number(attr(t, 'totalsRowCount') ?? 0) > 0;
  const columns = asArray(t.tableColumns?.tableColumn).map((c: XNode) => {
    const col: TableDef['columns'][number] = { name: attr(c, 'name') ?? '' };
    const fn = attr(c, 'totalsRowFunction');
    if (fn && fn in TOTAL_FILE && fn !== 'none') col.total = fn as NonNullable<TableDef['columns'][number]['total']>;
    const label = attr(c, 'totalsRowLabel');
    if (label) col.totalLabel = label;
    const calc = c.calculatedColumnFormula;
    if (calc !== undefined) {
      const text = textOf(Array.isArray(calc) ? calc[0] : calc);
      if (text) col.calc = text.replace(/_xlfn\.(_xlws\.)?/g, '');
    }
    return col;
  });
  if (!columns.length) return null;
  const style = t.tableStyleInfo;
  const parsed = t.autoFilter !== undefined ? parseAutoFilter(t.autoFilter) : null;
  return {
    id,
    name: attr(t, 'displayName') ?? attr(t, 'name') ?? id,
    ref,
    header,
    totals,
    columns,
    style: attr(style, 'name') ?? 'TableStyleMedium2',
    rowStripes: bool(attr(style, 'showRowStripes')),
    colStripes: bool(attr(style, 'showColumnStripes')),
    firstCol: bool(attr(style, 'showFirstColumn')),
    lastCol: bool(attr(style, 'showLastColumn')),
    filterButtons: t.autoFilter !== undefined,
    filter: parsed?.filter ?? (header ? { range: { ...ref, r2: totals ? ref.r2 - 1 : ref.r2 }, columns: {} } : undefined),
  };
}

// ------------------------------------------------------------------------------------------------ sparklines
export function sparklinesExtXml(sheet: Sheet): string {
  const groups = sheet.sparklines.filter((g) => g.items.length);
  if (!groups.length) return '';
  const xml = groups
    .map((g) => {
      const a: string[] = [];
      if (g.type !== 'line') a.push(`type="${g.type === 'winloss' ? 'stacked' : 'column'}"`);
      a.push(`displayEmptyCellsAs="${g.emptyAs}"`);
      if (g.showMarkers) a.push('markers="1"');
      if (g.showHigh) a.push('high="1"');
      if (g.showLow) a.push('low="1"');
      if (g.showFirst) a.push('first="1"');
      if (g.showLast) a.push('last="1"');
      if (g.showNegative) a.push('negative="1"');
      if (g.showAxis) a.push('displayXAxis="1"');
      if (g.showHidden) a.push('displayHidden="1"');
      if (g.rightToLeft) a.push('rightToLeft="1"');
      a.push(`lineWeight="${g.lineWeight}"`);
      if (g.minType !== 'auto') a.push(`minAxisType="${g.minType === 'group' ? 'group' : 'custom'}"`);
      if (g.maxType !== 'auto') a.push(`maxAxisType="${g.maxType === 'group' ? 'group' : 'custom'}"`);
      if (g.minType === 'custom' && g.min !== undefined) a.push(`manualMin="${g.min}"`);
      if (g.maxType === 'custom' && g.max !== undefined) a.push(`manualMax="${g.max}"`);
      const items = g.items.map((i) => `<x14:sparkline><xm:f>${escapeXml(i.source)}</xm:f><xm:sqref>${formatA1(i.row, i.col)}</xm:sqref></x14:sparkline>`).join('');
      return (
        `<x14:sparklineGroup ${a.join(' ')}>` +
        `<x14:colorSeries rgb="${hex(g.color)}"/><x14:colorNegative rgb="${hex(g.negativeColor)}"/><x14:colorAxis rgb="FF000000"/><x14:colorMarkers rgb="${hex(g.markerColor)}"/>` +
        `<x14:colorFirst rgb="${hex(g.firstColor)}"/><x14:colorLast rgb="${hex(g.lastColor)}"/><x14:colorHigh rgb="${hex(g.highColor)}"/><x14:colorLow rgb="${hex(g.lowColor)}"/>` +
        `<x14:sparklines>${items}</x14:sparklines></x14:sparklineGroup>`
      );
    })
    .join('');
  return `<ext uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}" xmlns:x14="${NS_X14}"><x14:sparklineGroups xmlns:xm="${NS_XM}">${xml}</x14:sparklineGroups></ext>`;
}

export function parseSparklines(extLst: XNode): SparklineGroup[] {
  const out: SparklineGroup[] = [];
  let n = 0;
  for (const ext of asArray(extLst?.ext)) {
    for (const g of asArray(ext.sparklineGroups?.sparklineGroup)) {
      const t = attr(g, 'type');
      const sg = newSparklineGroup(`sg${++n}`, t === 'column' ? 'column' : t === 'stacked' ? 'winloss' : 'line');
      const color = (k: string) => unhex(attr(g[k], 'rgb'));
      sg.color = color('colorSeries') ?? sg.color;
      sg.negativeColor = color('colorNegative') ?? sg.negativeColor;
      sg.markerColor = color('colorMarkers') ?? sg.markerColor;
      sg.firstColor = color('colorFirst') ?? sg.firstColor;
      sg.lastColor = color('colorLast') ?? sg.lastColor;
      sg.highColor = color('colorHigh') ?? sg.highColor;
      sg.lowColor = color('colorLow') ?? sg.lowColor;
      sg.showMarkers = bool(attr(g, 'markers'));
      sg.showHigh = bool(attr(g, 'high'));
      sg.showLow = bool(attr(g, 'low'));
      sg.showFirst = bool(attr(g, 'first'));
      sg.showLast = bool(attr(g, 'last'));
      sg.showNegative = bool(attr(g, 'negative'));
      sg.showAxis = bool(attr(g, 'displayXAxis'));
      sg.showHidden = bool(attr(g, 'displayHidden'));
      sg.rightToLeft = bool(attr(g, 'rightToLeft'));
      const lw = Number(attr(g, 'lineWeight'));
      if (lw > 0) sg.lineWeight = lw;
      const e = attr(g, 'displayEmptyCellsAs');
      if (e === 'zero' || e === 'span' || e === 'gap') sg.emptyAs = e;
      const axisType = (v: string | undefined): 'auto' | 'group' | 'custom' => (v === 'group' ? 'group' : v === 'custom' ? 'custom' : 'auto');
      sg.minType = axisType(attr(g, 'minAxisType'));
      sg.maxType = axisType(attr(g, 'maxAxisType'));
      const mn = attr(g, 'manualMin');
      const mx = attr(g, 'manualMax');
      if (mn !== undefined) sg.min = Number(mn);
      if (mx !== undefined) sg.max = Number(mx);
      for (const sp of asArray(g.sparklines?.sparkline)) {
        const cell = parseA1(textOf(sp.sqref).trim());
        const src = textOf(sp.f).trim();
        if (cell && src) sg.items.push({ row: cell.row, col: cell.col, source: src });
      }
      if (sg.items.length) out.push(sg);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ page setup, print areas
const PAPER_ID: Record<PageSetup['paper'], number> = { Letter: 1, Legal: 5, A3: 8, A4: 9, A5: 11 };
const PAPER_FROM_ID: Record<number, PageSetup['paper']> = { 1: 'Letter', 5: 'Legal', 8: 'A3', 9: 'A4', 11: 'A5' };
const CM_PER_INCH = 2.54;

/** Elements for the part of a worksheet between mergeCells/dataValidations and drawing, in schema order. */
export function pageXml(sheet: Sheet): { sheetPr: string; options: string; breaks: string } {
  const p = sheet.print;
  const g = p.page;
  const fit = g.fitWidth > 0 || g.fitHeight > 0;
  const inch = (cm: number) => Math.round((cm / CM_PER_INCH) * 1000) / 1000;
  const defaults = defaultPrintSettings();
  const changed = JSON.stringify(g) !== JSON.stringify(defaults.page) || p.areas.length > 0 || p.rowBreaks.length > 0 || p.colBreaks.length > 0 || !!p.titleRows || !!p.titleCols;
  const printOptions = g.gridlines || g.headings || g.centerH || g.centerV ? `<printOptions${g.centerH ? ' horizontalCentered="1"' : ''}${g.centerV ? ' verticalCentered="1"' : ''}${g.headings ? ' headings="1"' : ''}${g.gridlines ? ' gridLines="1"' : ''}/>` : '';
  const margins = `<pageMargins left="${inch(g.margins.left)}" right="${inch(g.margins.right)}" top="${inch(g.margins.top)}" bottom="${inch(g.margins.bottom)}" header="0.3" footer="0.3"/>`;
  const setup = changed
    ? `<pageSetup paperSize="${PAPER_ID[g.paper]}" orientation="${g.orientation}"${fit ? ` fitToWidth="${g.fitWidth}" fitToHeight="${g.fitHeight}"` : g.scale !== 100 ? ` scale="${Math.round(g.scale)}"` : ''}/>`
    : '';
  const hf = g.header || g.footer ? `<headerFooter>${g.header ? `<oddHeader>${escapeXml(g.header)}</oddHeader>` : ''}${g.footer ? `<oddFooter>${escapeXml(g.footer)}</oddFooter>` : ''}</headerFooter>` : '';
  const rb = p.rowBreaks.length ? `<rowBreaks count="${p.rowBreaks.length}" manualBreakCount="${p.rowBreaks.length}">${[...p.rowBreaks].sort((a, b) => a - b).map((r) => `<brk id="${r + 1}" max="16383" man="1"/>`).join('')}</rowBreaks>` : '';
  const cb = p.colBreaks.length ? `<colBreaks count="${p.colBreaks.length}" manualBreakCount="${p.colBreaks.length}">${[...p.colBreaks].sort((a, b) => a - b).map((c) => `<brk id="${c + 1}" max="1048575" man="1"/>`).join('')}</colBreaks>` : '';
  return {
    sheetPr: fit ? '<pageSetUpPr fitToPage="1"/>' : '',
    options: printOptions + margins + setup + hf,
    breaks: rb + cb,
  };
}

/** The workbook-level defined names that carry a sheet's print area and titles. */
export function printNames(sheet: Sheet, index: number, quote: (n: string) => string): string[] {
  const out: string[] = [];
  const p = sheet.print;
  const q = quote(sheet.name);
  const abs = (r: Rect) => (r.r1 === r.r2 && r.c1 === r.c2 ? `${q}!$${colName(r.c1)}$${r.r1 + 1}` : `${q}!$${colName(r.c1)}$${r.r1 + 1}:$${colName(r.c2)}$${r.r2 + 1}`);
  if (p.areas.length) out.push(`<definedName name="_xlnm.Print_Area" localSheetId="${index}">${escapeXml(p.areas.map((a) => abs(normRect(a))).join(','))}</definedName>`);
  const titles: string[] = [];
  if (p.titleCols) titles.push(`${q}!$${colName(p.titleCols.c1)}:$${colName(p.titleCols.c2)}`);
  if (p.titleRows) titles.push(`${q}!$${p.titleRows.r1 + 1}:$${p.titleRows.r2 + 1}`);
  if (titles.length) out.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${index}">${escapeXml(titles.join(','))}</definedName>`);
  return out;
}

function colName(c: number): string {
  return formatA1(0, c).replace(/\d+/, '');
}

export function readPage(ws: XNode, sheet: Sheet): void {
  const p = sheet.print;
  const g = p.page;
  const m = ws.pageMargins;
  if (m) {
    const cm = (k: string, d: number) => {
      const v = attr(m, k);
      return v === undefined || Number.isNaN(Number(v)) ? d : Math.round(Number(v) * CM_PER_INCH * 100) / 100;
    };
    g.margins = { left: cm('left', g.margins.left), right: cm('right', g.margins.right), top: cm('top', g.margins.top), bottom: cm('bottom', g.margins.bottom) };
  }
  const ps = ws.pageSetup;
  if (ps) {
    const paper = PAPER_FROM_ID[Number(attr(ps, 'paperSize'))];
    if (paper) g.paper = paper;
    if (attr(ps, 'orientation') === 'landscape') g.orientation = 'landscape';
    const sc = Number(attr(ps, 'scale'));
    if (sc >= 10 && sc <= 400) g.scale = sc;
    if (ws.sheetPr?.pageSetUpPr && bool(attr(ws.sheetPr.pageSetUpPr, 'fitToPage'))) {
      g.fitWidth = Number(attr(ps, 'fitToWidth') ?? 1);
      g.fitHeight = Number(attr(ps, 'fitToHeight') ?? 1);
    }
  }
  const po = ws.printOptions;
  if (po) {
    g.gridlines = bool(attr(po, 'gridLines'));
    g.headings = bool(attr(po, 'headings'));
    g.centerH = bool(attr(po, 'horizontalCentered'));
    g.centerV = bool(attr(po, 'verticalCentered'));
  }
  const hf = ws.headerFooter;
  if (hf) {
    g.header = hf.oddHeader !== undefined ? textOf(hf.oddHeader) : '';
    g.footer = hf.oddFooter !== undefined ? textOf(hf.oddFooter) : '';
  }
  for (const b of asArray(ws.rowBreaks?.brk)) if (bool(attr(b, 'man'))) p.rowBreaks.push(Number(attr(b, 'id')) - 1);
  for (const b of asArray(ws.colBreaks?.brk)) if (bool(attr(b, 'man'))) p.colBreaks.push(Number(attr(b, 'id')) - 1);
}

export { keyCol, keyRow };
