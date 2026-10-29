import {
  DEFAULT_3D,
  STOCK_SERIES,
  colAtPx,
  colOffsetPx,
  formatValue,
  readRangeValues,
  resolveRangeText,
  rowAtPx,
  rowOffsetPx,
  type Chart3D,
  type ChartAxis,
  type ChartDef,
  type ChartSeries,
  type ChartType,
  type Scalar,
  type SeriesType,
  type Sheet,
  type StockKind,
  type Workbook,
} from '@suitenova/calc-engine';
import { DEFAULT_THEME, resolveColor } from './colors';
import { escapeXml, asArray, attr, textOf, type XNode } from './xml';

const EMU = 9525;
export const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
export const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
export const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// ------------------------------------------------------------------------------------------------ writing
function strCache(values: Scalar[]): string {
  const pts = values.map((v, i) => `<c:pt idx="${i}"><c:v>${escapeXml(formatValue(v, undefined, 'en').text)}</c:v></c:pt>`).join('');
  return `<c:strCache><c:ptCount val="${values.length}"/>${pts}</c:strCache>`;
}

function numCache(values: Scalar[]): string {
  const pts = values.map((v, i) => (typeof v === 'number' ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : '')).join('');
  return `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numCache>`;
}

type GroupKind = 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter' | 'radar' | 'stock' | 'surface';

interface Group {
  kind: GroupKind;
  horizontal?: boolean;
  series: { s: ChartSeries; index: number }[];
  secondary: boolean;
}

const solid = (hex: string) => `<a:solidFill><a:srgbClr val="${hex.replace('#', '').toUpperCase()}"/></a:solidFill>`;

function serXml(item: { s: ChartSeries; index: number }, g: Group, def: ChartDef, wb: Workbook, sheetId: number): string {
  const { s, index } = item;
  const tx = s.nameRef
    ? `<c:tx><c:strRef><c:f>${escapeXml(s.nameRef)}</c:f>${strCache(readRangeValues(wb, s.nameRef, sheetId).slice(0, 1))}</c:strRef></c:tx>`
    : s.name
      ? `<c:tx><c:v>${escapeXml(s.name)}</c:v></c:tx>`
      : '';
  const vals = readRangeValues(wb, s.values, sheetId);
  const catVals = s.categories ? readRangeValues(wb, s.categories, sheetId) : [];
  const numericCats = catVals.length > 0 && catVals.every((v) => typeof v === 'number');
  const cat = s.categories
    ? `<c:cat>${numericCats ? `<c:numRef><c:f>${escapeXml(s.categories)}</c:f>${numCache(catVals)}</c:numRef>` : `<c:strRef><c:f>${escapeXml(s.categories)}</c:f>${strCache(catVals)}</c:strRef>`}</c:cat>`
    : '';
  const val = `<c:val><c:numRef><c:f>${escapeXml(s.values)}</c:f>${numCache(vals)}</c:numRef></c:val>`;
  const head = `<c:idx val="${index}"/><c:order val="${index}"/>${tx}`;
  const color = s.color;
  switch (g.kind) {
    case 'scatter': {
      const x = s.categories ? `<c:xVal><c:numRef><c:f>${escapeXml(s.categories)}</c:f>${numCache(catVals)}</c:numRef></c:xVal>` : '';
      const sp = `<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr>`;
      const marker = color ? `<c:marker><c:symbol val="circle"/><c:size val="7"/><c:spPr>${solid(color)}</c:spPr></c:marker>` : '';
      return `<c:ser>${head}${sp}${marker}${x}<c:yVal><c:numRef><c:f>${escapeXml(s.values)}</c:f>${numCache(vals)}</c:numRef></c:yVal><c:smooth val="0"/></c:ser>`;
    }
    case 'bar': {
      const sp = color ? `<c:spPr>${solid(color)}</c:spPr>` : '';
      return `<c:ser>${head}${sp}<c:invertIfNegative val="0"/>${cat}${val}</c:ser>`;
    }
    case 'line': {
      const sp = `<c:spPr><a:ln w="28575" cap="rnd">${color ? solid(color) : ''}<a:round/></a:ln></c:spPr>`;
      return `<c:ser>${head}${sp}<c:marker><c:symbol val="${def.type === 'line' || s.type === 'line' ? 'circle' : 'none'}"/></c:marker>${cat}${val}<c:smooth val="${def.smooth ? 1 : 0}"/></c:ser>`;
    }
    case 'area': {
      const sp = color ? `<c:spPr>${solid(color)}</c:spPr>` : '';
      return `<c:ser>${head}${sp}${cat}${val}</c:ser>`;
    }
    case 'radar': {
      const filled = !!def.radar?.filled;
      const sp = filled ? (color ? `<c:spPr>${solid(color)}</c:spPr>` : '') : `<c:spPr><a:ln w="28575">${color ? solid(color) : ''}</a:ln></c:spPr>`;
      const marker = filled ? '' : `<c:marker><c:symbol val="${def.radar?.markers ? 'circle' : 'none'}"/></c:marker>`;
      return `<c:ser>${head}${sp}${marker}${cat}${val}</c:ser>`;
    }
    case 'stock': {
      return `<c:ser>${head}<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>${cat}${val}<c:smooth val="0"/></c:ser>`;
    }
    case 'surface':
      return `<c:ser>${head}${cat}${val}</c:ser>`;
    default: {
      const sp = color ? `<c:spPr>${solid(color)}</c:spPr>` : '';
      return `<c:ser>${head}${sp}${cat}${val}</c:ser>`;
    }
  }
}

function axisTitle(a: ChartAxis | undefined, rotate = false): string {
  if (!a?.title) return '';
  return `<c:title><c:tx><c:rich><a:bodyPr${rotate ? ' rot="-5400000" vert="horz"' : ''}/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:rPr lang="es-ES"/><a:t>${escapeXml(a.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
}

function scaling(a: ChartAxis | undefined, reverse: boolean): string {
  const orient = !!a?.reverse !== reverse ? 'maxMin' : 'minMax';
  return `<c:scaling>${a?.log ? '<c:logBase val="10"/>' : ''}<c:orientation val="${orient}"/>${a?.max !== undefined ? `<c:max val="${a.max}"/>` : ''}${a?.min !== undefined ? `<c:min val="${a.min}"/>` : ''}</c:scaling>`;
}

const numFmtXml = (a: ChartAxis | undefined) => `<c:numFmt formatCode="${escapeXml(a?.format ?? 'General')}" sourceLinked="${a?.format ? 0 : 1}"/>`;

function catAxXml(id: number, cross: number, o: { pos: 'b' | 'l' | 'r' | 't'; deleted?: boolean; axis?: ChartAxis; reverse?: boolean; grid?: boolean; rotate?: boolean }): string {
  return (
    `<c:catAx><c:axId val="${id}"/>${scaling(o.axis, !!o.reverse)}<c:delete val="${o.deleted ? 1 : 0}"/><c:axPos val="${o.pos}"/>${o.axis?.gridlines || o.grid ? '<c:majorGridlines/>' : ''}` +
    `${axisTitle(o.axis, o.rotate)}${numFmtXml(o.axis)}<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
  );
}

function valAxXml(id: number, cross: number, o: { pos: 'b' | 'l' | 'r' | 't'; deleted?: boolean; axis?: ChartAxis; crosses?: 'autoZero' | 'max'; between?: 'between' | 'midCat'; grid?: boolean; reverse?: boolean; rotate?: boolean }): string {
  const grid = o.axis?.gridlines ?? o.grid ?? false;
  return (
    `<c:valAx><c:axId val="${id}"/>${scaling(o.axis, !!o.reverse)}<c:delete val="${o.deleted ? 1 : 0}"/><c:axPos val="${o.pos}"/>${grid ? '<c:majorGridlines/>' : ''}` +
    `${axisTitle(o.axis, o.rotate)}${numFmtXml(o.axis)}<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:crossAx val="${cross}"/><c:crosses val="${o.crosses ?? 'autoZero'}"/><c:crossBetween val="${o.between ?? 'between'}"/></c:valAx>`
  );
}

const serAxXml = (id: number, cross: number) =>
  `<c:serAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/></c:serAx>`;

/** How the series of a chart are split into the chart groups of a plot area. */
function groupsOf(def: ChartDef): Group[] {
  const all = def.series.map((s, index) => ({ s, index }));
  const typeOf = (s: ChartSeries): GroupKind => {
    const t: ChartType | SeriesType = s.type ?? def.type;
    switch (t) {
      case 'column':
      case 'bar':
        return 'bar';
      case 'line':
        return 'line';
      case 'area':
        return 'area';
      case 'scatter':
        return 'scatter';
      default:
        return t as GroupKind;
    }
  };
  if (def.type === 'stock') {
    const kind = def.stock?.kind ?? 'hlc';
    const volume = kind === 'vhlc' || kind === 'vohlc';
    const groups: Group[] = [];
    if (volume) groups.push({ kind: 'bar', series: all.slice(0, 1), secondary: false });
    groups.push({ kind: 'stock', series: volume ? all.slice(1) : all, secondary: volume });
    return groups;
  }
  const out: Group[] = [];
  const order: GroupKind[] = ['area', 'bar', 'line', 'scatter', 'pie', 'doughnut', 'radar', 'surface'];
  for (const secondary of [false, true]) {
    for (const kind of order) {
      const series = all.filter((x) => typeOf(x.s) === kind && !!x.s.secondary === secondary);
      if (series.length) out.push({ kind, horizontal: def.type === 'bar', series, secondary });
    }
  }
  return out;
}

const BASE_AX: [number, number, number] = [111, 222, 555];
const SEC_AX: [number, number] = [333, 444];

function groupXml(g: Group, def: ChartDef, wb: Workbook, sheetId: number): string {
  const sers = g.series.map((x) => serXml(x, g, def, wb, sheetId)).join('');
  const [a, b, c] = g.secondary ? [SEC_AX[0], SEC_AX[1], 0] : BASE_AX;
  const threeD = !!def.threeD && def.type !== 'surface';
  const seriesDepth = threeD && !!def.threeD?.seriesDepth && !def.stacked;
  const ids = threeD && seriesDepth ? `<c:axId val="${a}"/><c:axId val="${b}"/><c:axId val="${c}"/>` : threeD ? `<c:axId val="${a}"/><c:axId val="${b}"/><c:axId val="0"/>` : `<c:axId val="${a}"/><c:axId val="${b}"/>`;
  const grouping = def.stacked ? (def.percent ? 'percentStacked' : 'stacked') : 'standard';
  switch (g.kind) {
    case 'bar': {
      const dir = g.horizontal ? 'bar' : 'col';
      const grp = def.stacked ? (def.percent ? 'percentStacked' : 'stacked') : seriesDepth ? 'standard' : 'clustered';
      if (threeD) return `<c:bar3DChart><c:barDir val="${dir}"/><c:grouping val="${grp}"/><c:varyColors val="0"/>${sers}<c:gapWidth val="150"/><c:shape val="box"/>${ids}</c:bar3DChart>`;
      return `<c:barChart><c:barDir val="${dir}"/><c:grouping val="${grp}"/><c:varyColors val="0"/>${sers}<c:gapWidth val="150"/>${def.stacked ? '<c:overlap val="100"/>' : ''}${ids}</c:barChart>`;
    }
    case 'line':
      if (threeD) return `<c:line3DChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${sers}${ids}</c:line3DChart>`;
      return `<c:lineChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${sers}<c:marker val="1"/>${ids}</c:lineChart>`;
    case 'area':
      if (threeD) return `<c:area3DChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${sers}${ids}</c:area3DChart>`;
      return `<c:areaChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${sers}${ids}</c:areaChart>`;
    case 'pie':
      return threeD ? `<c:pie3DChart><c:varyColors val="1"/>${sers}</c:pie3DChart>` : `<c:pieChart><c:varyColors val="1"/>${sers}<c:firstSliceAng val="0"/></c:pieChart>`;
    case 'doughnut':
      return `<c:doughnutChart><c:varyColors val="1"/>${sers}<c:firstSliceAng val="0"/><c:holeSize val="50"/></c:doughnutChart>`;
    case 'scatter':
      return `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${sers}<c:axId val="${a}"/><c:axId val="${b}"/></c:scatterChart>`;
    case 'radar':
      return `<c:radarChart><c:radarStyle val="${def.radar?.filled ? 'filled' : def.radar?.markers ? 'marker' : 'standard'}"/><c:varyColors val="0"/>${sers}<c:axId val="${a}"/><c:axId val="${b}"/></c:radarChart>`;
    case 'stock': {
      const ohlc = def.stock?.kind === 'ohlc' || def.stock?.kind === 'vohlc';
      return `<c:stockChart>${sers}<c:hiLowLines/>${ohlc ? '<c:upDownBars><c:gapWidth val="150"/><c:upBars/><c:downBars/></c:upDownBars>' : ''}<c:axId val="${a}"/><c:axId val="${b}"/></c:stockChart>`;
    }
    case 'surface': {
      const contour = !!def.surface?.contour;
      const wire = def.surface?.wireframe ? 1 : 0;
      const tag = contour ? 'surfaceChart' : 'surface3DChart';
      return `<c:${tag}><c:wireframe val="${wire}"/>${sers}<c:axId val="${a}"/><c:axId val="${b}"/><c:axId val="${c}"/></c:${tag}>`;
    }
  }
}

export function chartXml(def: ChartDef, wb: Workbook, sheetId: number): string {
  const groups = groupsOf(def);
  const plotGroups = groups.map((g) => groupXml(g, def, wb, sheetId)).join('');
  const hasSecondary = groups.some((g) => g.secondary);
  const horizontal = def.type === 'bar';
  const kinds = new Set(groups.map((g) => g.kind));
  const noAxes = [...kinds].every((k) => k === 'pie' || k === 'doughnut');
  const scatterOnly = [...kinds].every((k) => k === 'scatter');
  const surface = def.type === 'surface';
  const threeD = !!def.threeD || surface;

  let axes = '';
  if (!noAxes) {
    if (scatterOnly) {
      axes += valAxXml(111, 222, { pos: 'b', axis: def.axisX, between: 'midCat', grid: false });
      axes += valAxXml(222, 111, { pos: 'l', axis: def.axisY, between: 'midCat', grid: true, rotate: true });
      if (hasSecondary) {
        axes += valAxXml(333, 444, { pos: 'b', deleted: true, between: 'midCat' });
        axes += valAxXml(444, 333, { pos: 'r', axis: def.axisY2, crosses: 'max', between: 'midCat', rotate: true });
      }
    } else {
      const radar = kinds.has('radar');
      axes += catAxXml(111, 222, { pos: horizontal ? 'l' : 'b', axis: def.axisX, reverse: horizontal });
      axes += valAxXml(222, 111, { pos: horizontal ? 'b' : 'l', axis: def.axisY, grid: def.axisY?.gridlines ?? true, crosses: horizontal ? 'max' : 'autoZero', between: radar ? 'between' : 'between', rotate: !horizontal });
      if (hasSecondary) {
        axes += catAxXml(333, 444, { pos: horizontal ? 'l' : 'b', deleted: true });
        axes += valAxXml(444, 333, { pos: horizontal ? 't' : 'r', axis: def.axisY2, crosses: 'max', rotate: !horizontal });
      }
      if (surface || (def.threeD?.seriesDepth && !def.stacked)) axes += serAxXml(555, 222);
    }
  }

  const title = def.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr b="1"/></a:pPr><a:r><a:rPr lang="es-ES" b="1"/><a:t>${escapeXml(def.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : '<c:autoTitleDeleted val="1"/>';
  const v = def.threeD ?? (surface ? { ...DEFAULT_3D, rightAngle: false } : undefined);
  const contour = surface && def.surface?.contour;
  const view3D = threeD && v
    ? `<c:view3D><c:rotX val="${contour ? 90 : Math.round(v.rotX)}"/><c:rotY val="${contour ? 0 : Math.round(v.rotY)}"/><c:depthPercent val="${Math.round(v.depth)}"/><c:rAngAx val="${v.rightAngle && !contour ? 1 : 0}"/>${v.rightAngle ? '' : `<c:perspective val="${Math.round(v.perspective * 2)}"/>`}</c:view3D>`
    : '';
  const legend = def.legend ? '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>' : '';
  return (
    HEAD +
    `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/>` +
    `<c:chart>${title}${view3D}<c:plotArea><c:layout/>${plotGroups}${axes}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    '</c:chartSpace>'
  );
}

// ------------------------------------------------------------------------------------------------ drawings
export interface DrawingItem {
  kind: 'chart' | 'pic';
  /** Relationship id of the chart or image part. */
  rId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  alt?: string;
}

/** Drawing part with one two-cell anchor per object. */
export function drawingXml(sheet: Sheet, items: DrawingItem[]): string {
  const anchors = items
    .map((c, i) => {
      const from = { col: colAtPx(sheet, c.x), row: rowAtPx(sheet, c.y) };
      const to = { col: colAtPx(sheet, c.x + c.width), row: rowAtPx(sheet, c.y + c.height) };
      const pt = (p: { col: { col: number; offset: number }; row: { row: number; offset: number } }) =>
        `<xdr:col>${p.col.col}</xdr:col><xdr:colOff>${Math.round(p.col.offset * EMU)}</xdr:colOff><xdr:row>${p.row.row}</xdr:row><xdr:rowOff>${Math.round(p.row.offset * EMU)}</xdr:rowOff>`;
      const id = i + 2;
      const body =
        c.kind === 'chart'
          ? `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${escapeXml(c.name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
            `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" r:id="${c.rId}"/></a:graphicData></a:graphic></xdr:graphicFrame>`
          : `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${escapeXml(c.name)}"${c.alt ? ` descr="${escapeXml(c.alt)}"` : ''}/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
            `<xdr:blipFill><a:blip xmlns:r="${NS_R}" r:embed="${c.rId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
            `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(c.width * EMU)}" cy="${Math.round(c.height * EMU)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`;
      return `<xdr:twoCellAnchor${c.kind === 'pic' ? ' editAs="oneCell"' : ''}><xdr:from>${pt(from)}</xdr:from><xdr:to>${pt(to)}</xdr:to>${body}<xdr:clientData/></xdr:twoCellAnchor>`;
    })
    .join('');
  void colOffsetPx;
  void rowOffsetPx;
  return `${HEAD}<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}" xmlns:r="${NS_R}">${anchors}</xdr:wsDr>`;
}

// ------------------------------------------------------------------------------------------------ reading
function fText(n: XNode): string | undefined {
  const f = n?.numRef?.f ?? n?.strRef?.f ?? n?.multiLvlStrRef?.f;
  if (f === undefined) return undefined;
  return typeof f === 'string' ? f : (f['#text'] as string | undefined);
}

function richText(title: XNode): string | undefined {
  const paras = asArray(title?.tx?.rich?.p);
  const text = paras
    .flatMap((p: XNode) => asArray(p.r))
    .map((r: XNode) => textOf(r.t))
    .join('');
  return text || undefined;
}

const GROUP_TAGS: Record<string, { kind: GroupKind; threeD?: boolean }> = {
  barChart: { kind: 'bar' },
  bar3DChart: { kind: 'bar', threeD: true },
  lineChart: { kind: 'line' },
  line3DChart: { kind: 'line', threeD: true },
  areaChart: { kind: 'area' },
  area3DChart: { kind: 'area', threeD: true },
  pieChart: { kind: 'pie' },
  pie3DChart: { kind: 'pie', threeD: true },
  doughnutChart: { kind: 'doughnut' },
  scatterChart: { kind: 'scatter' },
  radarChart: { kind: 'radar' },
  stockChart: { kind: 'stock' },
  surfaceChart: { kind: 'surface' },
  surface3DChart: { kind: 'surface', threeD: true },
};

const SCHEME_INDEX: Record<string, number> = { lt1: 0, bg1: 0, dk1: 1, tx1: 1, lt2: 2, bg2: 2, dk2: 3, tx2: 3, accent1: 4, accent2: 5, accent3: 6, accent4: 7, accent5: 8, accent6: 9, hlink: 10, folHlink: 11 };

function fillColor(spPr: XNode, theme: string[]): string | undefined {
  const sf = spPr?.solidFill ?? spPr?.ln?.solidFill;
  if (!sf) return undefined;
  if (sf.srgbClr) return resolveColor({ rgb: attr(sf.srgbClr, 'val') }, theme);
  if (sf.schemeClr) {
    const i = SCHEME_INDEX[attr(sf.schemeClr, 'val') ?? ''];
    const tint = sf.schemeClr.lumMod || sf.schemeClr.lumOff ? undefined : undefined;
    void tint;
    return i === undefined ? undefined : resolveColor({ theme: String(i) }, theme);
  }
  return undefined;
}

function readAxis(ax: XNode): ChartAxis | undefined {
  if (!ax) return undefined;
  const out: ChartAxis = {};
  const t = richText(ax.title);
  if (t) out.title = t;
  const sc = ax.scaling;
  const min = attr(sc?.min, 'val');
  const max = attr(sc?.max, 'val');
  if (min !== undefined && !Number.isNaN(Number(min))) out.min = Number(min);
  if (max !== undefined && !Number.isNaN(Number(max))) out.max = Number(max);
  if (sc?.logBase !== undefined) out.log = true;
  const nf = asArray(ax.numFmt)[0];
  const fmt = attr(nf, 'formatCode');
  if (fmt && attr(nf, 'sourceLinked') !== '1' && fmt !== 'General') out.format = fmt;
  if (ax.majorGridlines !== undefined) out.gridlines = true;
  if (attr(sc?.orientation, 'val') === 'maxMin') out.reverse = true;
  return Object.keys(out).length ? out : undefined;
}

/** Interpret a chart part. Returns null (with a reason) when it cannot be represented. */
export function parseChart(doc: XNode, theme: string[] = DEFAULT_THEME): { def: Omit<ChartDef, 'id' | 'x' | 'y' | 'width' | 'height'> } | { skip: string } {
  const chart = doc?.chartSpace?.chart;
  const plot = chart?.plotArea;
  if (!plot) return { skip: 'estructura de gráfico desconocida' };

  // axes by id
  const axes = new Map<string, { tag: string; node: XNode }>();
  for (const tag of ['catAx', 'valAx', 'dateAx', 'serAx']) for (const n of asArray(plot[tag])) axes.set(attr(n.axId, 'val') ?? '', { tag, node: n });

  interface Parsed {
    kind: GroupKind;
    node: XNode;
    threeD: boolean;
    ids: string[];
  }
  const groups: Parsed[] = [];
  for (const [tag, info] of Object.entries(GROUP_TAGS)) {
    for (const node of asArray(plot[tag])) {
      const kind = tag === 'surfaceChart' ? 'surface' : info.kind;
      groups.push({ kind, node, threeD: !!info.threeD, ids: asArray(node.axId).map((a: XNode) => attr(a, 'val') ?? '') });
    }
  }
  if (!groups.length) return { skip: 'tipo de gráfico no compatible' };
  // keep the order of the file (Excel draws areas first, then columns, lines, points)
  const keys = Object.keys(plot);
  groups.sort((a, b) => {
    const ta = Object.keys(GROUP_TAGS).find((t) => plot[t] !== undefined && asArray(plot[t]).includes(a.node))!;
    const tb = Object.keys(GROUP_TAGS).find((t) => plot[t] !== undefined && asArray(plot[t]).includes(b.node))!;
    return keys.indexOf(ta) - keys.indexOf(tb);
  });

  const primaryIds = new Set(groups.find((g) => g.kind !== 'pie' && g.kind !== 'doughnut')?.ids.slice(0, 2) ?? []);
  const isSecondary = (g: Parsed) => g.ids.length >= 2 && !primaryIds.has(g.ids[0]!) && primaryIds.size > 0 && g.kind !== 'pie' && g.kind !== 'doughnut';

  const series: ChartSeries[] = [];
  let anyHorizontal = false;
  const kindsSeen = new Set<string>();
  const groupType = (g: Parsed): SeriesType | undefined => {
    if (g.kind === 'bar') return 'column';
    if (g.kind === 'line') return 'line';
    if (g.kind === 'area') return 'area';
    if (g.kind === 'scatter') return 'scatter';
    return undefined;
  };
  for (const g of groups) {
    kindsSeen.add(g.kind);
    if (g.kind === 'bar' && attr(g.node.barDir, 'val') === 'bar') anyHorizontal = true;
    for (const s of asArray(g.node.ser)) {
      const values = fText(g.kind === 'scatter' ? s.yVal : s.val);
      if (!values) continue;
      const ser: ChartSeries = { values: values.replace(/^=/, '') };
      const nameRef = s.tx?.strRef?.f;
      if (nameRef) ser.nameRef = typeof nameRef === 'string' ? nameRef : nameRef['#text'];
      else if (typeof s.tx?.v === 'string') ser.name = s.tx.v;
      const cats = fText(g.kind === 'scatter' ? s.xVal : s.cat);
      if (cats) ser.categories = cats.replace(/^=/, '');
      const color = fillColor(s.spPr, theme);
      if (color && g.kind !== 'stock') ser.color = color;
      if (isSecondary(g)) ser.secondary = true;
      const t = groupType(g);
      if (t) ser.type = t;
      series.push(ser);
    }
  }
  if (!series.length) return { skip: 'los datos del gráfico no son referencias a cálculo (celdas)' };

  const first = groups[0]!;
  let type: ChartType;
  switch (first.kind) {
    case 'bar':
      type = anyHorizontal ? 'bar' : 'column';
      break;
    case 'stock':
      type = 'stock';
      break;
    default:
      type = first.kind;
  }
  // a volume + stock chart is one chart for the user
  const hasBar = groups.some((g) => g.kind === 'bar');
  const hasStock = groups.some((g) => g.kind === 'stock');
  if (hasStock) type = 'stock';
  if (type !== 'stock' && kindsSeen.size > 1 && (kindsSeen.has('pie') || kindsSeen.has('doughnut') || kindsSeen.has('radar') || kindsSeen.has('surface'))) {
    return { skip: 'combinación de tipos de gráfico no compatible' };
  }
  if (anyHorizontal && kindsSeen.size > 1) return { skip: 'las barras horizontales no se pueden combinar con otros tipos' };

  const def: Omit<ChartDef, 'id' | 'x' | 'y' | 'width' | 'height'> = { type, legend: chart.legend !== undefined, series };
  const t = richText(chart.title);
  if (t) def.title = t;
  const grouping = attr(first.node.grouping, 'val');
  if (grouping === 'stacked' || grouping === 'percentStacked') {
    def.stacked = true;
    if (grouping === 'percentStacked') def.percent = true;
  }
  if (type === 'line' && groups.some((g) => g.kind === 'line' && asArray(g.node.ser).some((s: XNode) => attr(s.smooth, 'val') === '1'))) def.smooth = true;
  // single-type charts do not need a type on each series
  if (kindsSeen.size === 1 && !hasStock) for (const s of series) delete s.type;
  else if (type === 'column' || type === 'line' || type === 'area' || type === 'scatter') {
    for (const s of series) if (s.type === type && !series.some((o) => o.type !== type)) delete s.type;
  }
  if (type === 'stock') {
    const n = series.length;
    const kind: StockKind | null = hasBar ? (n === 4 ? 'vhlc' : n === 5 ? 'vohlc' : null) : n === 3 ? 'hlc' : n === 4 ? 'ohlc' : null;
    if (!kind) return { skip: 'gráfico de cotizaciones con un número de series no compatible' };
    def.stock = { kind };
    for (const s of series) {
      delete s.type;
      delete s.secondary;
    }
    def.legend = chart.legend !== undefined;
    void STOCK_SERIES;
  }
  if (type === 'radar') {
    const style = attr(first.node.radarStyle, 'val');
    def.radar = { filled: style === 'filled' || undefined, markers: style === 'marker' || undefined };
  }
  if (type === 'surface') {
    const wire = attr(first.node.wireframe, 'val');
    def.surface = { wireframe: wire === '1' || wire === 'true' || undefined, contour: first.node === asArray(plot.surfaceChart)[0] || undefined };
  }
  const view = chart.view3D;
  if (view && (first.threeD || type === 'surface')) {
    const n = (k: string, d: number) => {
      const v = attr(view[k], 'val');
      return v === undefined || Number.isNaN(Number(v)) ? d : Number(v);
    };
    const d3: Chart3D = {
      rotX: n('rotX', DEFAULT_3D.rotX),
      rotY: n('rotY', DEFAULT_3D.rotY),
      perspective: Math.round(n('perspective', 60) / 2),
      depth: n('depthPercent', 100),
      rightAngle: attr(view.rAngAx, 'val') === '1' || attr(view.rAngAx, 'val') === 'true',
    };
    if (first.threeD && first.kind !== 'pie' && grouping === 'standard') d3.seriesDepth = true;
    def.threeD = d3;
  } else if (first.threeD) def.threeD = { ...DEFAULT_3D };

  // axes: X from the category (or first value) axis of the first group, Y from the value axis, Y2 from the secondary group's
  const firstIds = first.ids;
  const xAx = axes.get(firstIds[0] ?? '');
  const yAx = axes.get(firstIds[1] ?? '');
  const ax = readAxis(first.kind === 'scatter' ? xAx?.node : xAx?.node);
  if (ax) def.axisX = ax;
  const ay = readAxis(yAx?.node);
  if (ay) def.axisY = ay;
  const sec = groups.find((g) => isSecondary(g));
  if (sec) {
    const y2 = readAxis(axes.get(sec.ids[1] ?? '')?.node);
    if (y2) def.axisY2 = y2;
  }
  return { def };
}

/** Anchor of a drawing object in sheet pixels. */
export function anchorToRect(sheet: Sheet, anchor: XNode): { x: number; y: number; width: number; height: number } | null {
  // row/col are array-typed tags elsewhere in the parser configuration, so unwrap single-item arrays
  const num = (n: XNode): number => {
    const v = Array.isArray(n) ? n[0] : n;
    return Number(typeof v === 'object' && v !== null ? (v['#text'] ?? 0) : (v ?? 0));
  };
  const from = anchor.from;
  if (from) {
    const x = colOffsetPx(sheet, num(from.col)) + num(from.colOff) / EMU;
    const y = rowOffsetPx(sheet, num(from.row)) + num(from.rowOff) / EMU;
    if (anchor.to) {
      const x2 = colOffsetPx(sheet, num(anchor.to.col)) + num(anchor.to.colOff) / EMU;
      const y2 = rowOffsetPx(sheet, num(anchor.to.row)) + num(anchor.to.rowOff) / EMU;
      return { x, y, width: Math.max(10, x2 - x), height: Math.max(10, y2 - y) };
    }
    const ext = anchor.ext;
    return { x, y, width: Math.max(10, num(attr(ext, 'cx')) / EMU), height: Math.max(10, num(attr(ext, 'cy')) / EMU) };
  }
  const pos = anchor.pos;
  const ext = anchor.ext;
  if (pos && ext) return { x: Number(attr(pos, 'x') ?? 0) / EMU, y: Number(attr(pos, 'y') ?? 0) / EMU, width: Number(attr(ext, 'cx') ?? 0) / EMU, height: Number(attr(ext, 'cy') ?? 0) / EMU };
  return null;
}

export { resolveRangeText };
