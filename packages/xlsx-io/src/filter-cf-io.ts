import {
  CF_PERIODS,
  ICON_COUNTS,
  defaultIconThresholds,
  formatRect,
  normRect,
  parseA1,
  type AutoFilter,
  type CFFormat,
  type CFOperator,
  type CFRule,
  type CFValue,
  type ColumnFilter,
  type DynamicFilter,
  type RelPeriod,
  type FilterCondition,
  type FilterOp,
  type IconSetName,
  type Rect,
} from '@suitenova/calc-engine';
import { resolveColor } from './colors';
import { toFileFormula } from './fileformula';
import { asArray, attr, escapeXml, textOf, toggle, type XNode } from './xml';

const argb = (c: string) => `FF${c.replace('#', '').toUpperCase()}`;

// ------------------------------------------------------------------------------------------------ dxf (differential formats)
const SIDES = ['left', 'right', 'top', 'bottom'] as const;

export function dxfXml(f: CFFormat, numFmtId?: number): string {
  const font =
    f.bold || f.italic || f.underline || f.strike || f.color
      ? `<font>${f.bold ? '<b/>' : ''}${f.italic ? '<i/>' : ''}${f.strike ? '<strike/>' : ''}${f.underline ? '<u/>' : ''}${f.color ? `<color rgb="${argb(f.color)}"/>` : ''}</font>`
      : '';
  const numFmt = f.numFmt && numFmtId !== undefined ? `<numFmt numFmtId="${numFmtId}" formatCode="${escapeXml(f.numFmt)}"/>` : '';
  const fill = f.bg ? `<fill><patternFill><bgColor rgb="${argb(f.bg)}"/></patternFill></fill>` : '';
  const border = SIDES.some((s) => f[s])
    ? `<border>${SIDES.map((s) => (f[s] ? `<${s} style="${f[s]!.style}">${f[s]!.color ? `<color rgb="${argb(f[s]!.color!)}"/>` : '<color auto="1"/>'}</${s}>` : `<${s}/>`)).join('')}</border>`
    : '';
  return `<dxf>${font}${numFmt}${fill}${border}</dxf>`;
}

export function parseDxfs(dxfs: XNode, theme: string[]): CFFormat[] {
  return asArray(dxfs?.dxf).map((d: XNode) => {
    const f: CFFormat = {};
    // font/fill are array-typed tags in the parser configuration
    const font = asArray(d.font)[0];
    if (font) {
      if (toggle(font.b)) f.bold = true;
      if (toggle(font.i)) f.italic = true;
      if (toggle(font.strike)) f.strike = true;
      if (font.u !== undefined && attr(font.u, 'val') !== 'none') f.underline = true;
      const c = asArray(font.color)[0];
      const col = c && resolveColor({ rgb: attr(c, 'rgb'), theme: attr(c, 'theme'), indexed: attr(c, 'indexed'), tint: attr(c, 'tint') }, theme);
      if (col) f.color = col;
    }
    const nf = asArray(d.numFmt)[0];
    const code = nf && attr(nf, 'formatCode');
    if (code) f.numFmt = code;
    const p = asArray(d.fill)[0]?.patternFill;
    if (p) {
      const n = p.bgColor ?? p.fgColor;
      const col = n && resolveColor({ rgb: attr(n, 'rgb'), theme: attr(n, 'theme'), indexed: attr(n, 'indexed'), tint: attr(n, 'tint') }, theme);
      if (col) f.bg = col;
    }
    const bd = asArray(d.border)[0];
    if (bd) {
      const known = ['thin', 'medium', 'thick', 'dashed', 'dotted', 'double', 'hair'];
      for (const s of SIDES) {
        const side = bd[s];
        const style = side && attr(side, 'style');
        if (!style) continue;
        const c = side.color;
        const col = c && resolveColor({ rgb: attr(c, 'rgb'), theme: attr(c, 'theme'), indexed: attr(c, 'indexed'), tint: attr(c, 'tint') }, theme);
        f[s] = { style: (known.includes(style) ? style : 'thin') as 'thin', ...(col ? { color: col } : {}) };
      }
    }
    return f;
  });
}

// ------------------------------------------------------------------------------------------------ conditional formatting
const ICON_FILE: Record<IconSetName, string> = {
  '3Arrows': '3Arrows',
  '3ArrowsGray': '3ArrowsGray',
  '3Flags': '3Flags',
  '3TrafficLights': '3TrafficLights1',
  '3TrafficLights2': '3TrafficLights2',
  '3Signs': '3Signs',
  '3Symbols': '3Symbols',
  '3Symbols2': '3Symbols2',
  '3Stars': '3Stars',
  '3Triangles': '3Triangles',
  '4Arrows': '4Arrows',
  '4ArrowsGray': '4ArrowsGray',
  '4RedToBlack': '4RedToBlack',
  '4Rating': '4Rating',
  '4TrafficLights': '4TrafficLights',
  '5Arrows': '5Arrows',
  '5ArrowsGray': '5ArrowsGray',
  '5Rating': '5Rating',
  '5Quarters': '5Quarters',
  '5Boxes': '5Boxes',
};
const ICON_FROM_FILE = new Map<string, IconSetName>([...Object.entries(ICON_FILE).map(([k, v]) => [v, k as IconSetName] as [string, IconSetName]), ['3TrafficLights', '3TrafficLights']]);

const NS_X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const NS_XM = 'http://schemas.microsoft.com/office/excel/2006/main';

/** ¿Necesita la barra de datos la extensión de Excel 2010 (negativos, eje, relleno sólido)? */
const needsX14 = (r: CFRule): boolean => r.type === 'dataBar' && (r.negativeColor !== undefined || (r.axis !== undefined && r.axis !== 'auto') || r.solid === true);

/** Identificador estable que une la regla con su extensión. */
const barGuid = (id: string): string => {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const hex = h.toString(16).padStart(8, '0');
  return `{${hex.toUpperCase()}-0000-4000-8000-${hex.toUpperCase()}0000}`.slice(0, 38);
};

/** Fórmulas con las que Excel escribe cada periodo de «Fechas» (`a1` es la celda superior izquierda). */
function periodFormula(p: RelPeriod, a1: string): string | null {
  const m = (offset: string) => `AND(MONTH(${a1})=MONTH(EDATE(TODAY(),${offset})),YEAR(${a1})=YEAR(EDATE(TODAY(),${offset})))`;
  switch (p) {
    case 'yesterday':
      return `FLOOR(${a1},1)=TODAY()-1`;
    case 'today':
      return `FLOOR(${a1},1)=TODAY()`;
    case 'tomorrow':
      return `FLOOR(${a1},1)=TODAY()+1`;
    case 'last7Days':
      return `AND(TODAY()-FLOOR(${a1},1)<=6,FLOOR(${a1},1)<=TODAY())`;
    case 'thisMonth':
      return `AND(MONTH(${a1})=MONTH(TODAY()),YEAR(${a1})=YEAR(TODAY()))`;
    case 'lastMonth':
      return m('0-1');
    case 'nextMonth':
      return m('0+1');
    case 'thisWeek':
      return `AND(TODAY()-ROUNDDOWN(${a1},0)<=WEEKDAY(TODAY())-1,ROUNDDOWN(${a1},0)-TODAY()<=7-WEEKDAY(TODAY()))`;
    case 'lastWeek':
      return `AND(TODAY()-ROUNDDOWN(${a1},0)>=(WEEKDAY(TODAY())),TODAY()-ROUNDDOWN(${a1},0)<(WEEKDAY(TODAY())+7))`;
    case 'nextWeek':
      return `AND(ROUNDDOWN(${a1},0)-TODAY()>(7-WEEKDAY(TODAY())),ROUNDDOWN(${a1},0)-TODAY()<(15-WEEKDAY(TODAY())))`;
    default:
      return null;
  }
}

/** Extensión de Excel 2010 con los datos de las barras que la necesitan, para el `extLst` de la hoja. */
export function cfExtXml(rules: CFRule[]): string {
  const bars = rules.filter(needsX14);
  if (!bars.length) return '';
  const cfvoX = (v: CFValue, auto: 'autoMin' | 'autoMax') => (v.type === 'min' || v.type === 'max' ? `<x14:cfvo type="${auto}"/>` : `<x14:cfvo type="${v.type}"><xm:f>${escapeXml(String(v.value ?? 0))}</xm:f></x14:cfvo>`);
  const items = bars
    .map((r) => {
      if (r.type !== 'dataBar') return '';
      const axis = r.axis === 'middle' ? ' axisPosition="middle"' : r.axis === 'none' ? ' axisPosition="none"' : '';
      const sq = r.ranges.map((x) => formatRect(normRect(x))).join(' ');
      return (
        `<x14:conditionalFormatting xmlns:xm="${NS_XM}"><x14:cfRule type="dataBar" id="${barGuid(r.id)}">` +
        `<x14:dataBar minLength="0" maxLength="100"${r.solid ? ' gradient="0"' : ''}${axis}>` +
        `${cfvoX(r.min, 'autoMin')}${cfvoX(r.max, 'autoMax')}${r.negativeColor ? `<x14:negativeFillColor rgb="${argb(r.negativeColor)}"/>` : ''}<x14:axisColor rgb="FF000000"/>` +
        `</x14:dataBar></x14:cfRule><xm:sqref>${sq}</xm:sqref></x14:conditionalFormatting>`
      );
    })
    .join('');
  return `<ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}" xmlns:x14="${NS_X14}"><x14:conditionalFormattings>${items}</x14:conditionalFormattings></ext>`;
}

const f = (text: string) => `<formula>${escapeXml(toFileFormula(text.replace(/^=/, '')))}</formula>`;
const cfvoXml = (v: CFValue) => `<cfvo type="${v.type}"${v.value !== undefined ? ` val="${escapeXml(String(v.value))}"` : ''}/>`;

/** One `<conditionalFormatting>` element for a rule. `dxfId` is the index of the rule's format in styles.xml. */
export function cfRuleXml(rule: CFRule, dxfId: number | undefined): string {
  const first = normRect(rule.ranges[0]!);
  const tl = formatRect({ r1: first.r1, c1: first.c1, r2: first.r1, c2: first.c1 });
  const base = `priority="${rule.priority}"${rule.stopIfTrue ? ' stopIfTrue="1"' : ''}${dxfId !== undefined ? ` dxfId="${dxfId}"` : ''}`;
  let body: string;
  switch (rule.type) {
    case 'cellIs':
      body = `<cfRule type="cellIs" ${base} operator="${rule.operator}">${f(rule.formula1)}${rule.formula2 ? f(rule.formula2) : ''}</cfRule>`;
      break;
    case 'expression':
      body = `<cfRule type="expression" ${base}>${f(rule.formula)}</cfRule>`;
      break;
    case 'text': {
      const t = escapeXml(rule.text);
      const lit = `"${rule.text.replace(/"/g, '""')}"`;
      const map = {
        contains: ['containsText', 'containsText', `NOT(ISERROR(SEARCH(${lit},${tl})))`],
        notContains: ['notContainsText', 'notContains', `ISERROR(SEARCH(${lit},${tl}))`],
        beginsWith: ['beginsWith', 'beginsWith', `LEFT(${tl},LEN(${lit}))=${lit}`],
        endsWith: ['endsWith', 'endsWith', `RIGHT(${tl},LEN(${lit}))=${lit}`],
      }[rule.mode];
      body = `<cfRule type="${map[0]}" ${base} operator="${map[1]}" text="${t}">${f(map[2]!)}</cfRule>`;
      break;
    }
    case 'duplicates':
      body = `<cfRule type="${rule.unique ? 'uniqueValues' : 'duplicateValues'}" ${base}/>`;
      break;
    case 'top':
      body = `<cfRule type="top10" ${base} rank="${rule.rank}"${rule.percent ? ' percent="1"' : ''}${rule.bottom ? ' bottom="1"' : ''}/>`;
      break;
    case 'average':
      body = `<cfRule type="aboveAverage" ${base}${rule.above ? '' : ' aboveAverage="0"'}${rule.equal ? ' equalAverage="1"' : ''}${rule.stdDev ? ` stdDev="${rule.stdDev}"` : ''}/>`;
      break;
    case 'timePeriod': {
      const fm = periodFormula(rule.period, tl);
      if (!CF_PERIODS.includes(rule.period) || !fm) return '';
      body = `<cfRule type="timePeriod" ${base} timePeriod="${rule.period}">${f(fm)}</cfRule>`;
      break;
    }
    case 'blanks':
      body = `<cfRule type="${rule.not ? 'notContainsBlanks' : 'containsBlanks'}" ${base}>${f(rule.not ? `LEN(TRIM(${tl}))>0` : `LEN(TRIM(${tl}))=0`)}</cfRule>`;
      break;
    case 'errors':
      body = `<cfRule type="${rule.not ? 'notContainsErrors' : 'containsErrors'}" ${base}>${f(rule.not ? `NOT(ISERROR(${tl}))` : `ISERROR(${tl})`)}</cfRule>`;
      break;
    case 'colorScale':
      body = `<cfRule type="colorScale" ${base}><colorScale>${rule.stops.map((s) => cfvoXml(s.cfvo)).join('')}${rule.stops.map((s) => `<color rgb="${argb(s.color)}"/>`).join('')}</colorScale></cfRule>`;
      break;
    case 'dataBar':
      body = `<cfRule type="dataBar" ${base}><dataBar${rule.showValue === false ? ' showValue="0"' : ''}>${cfvoXml(rule.min)}${cfvoXml(rule.max)}<color rgb="${argb(rule.color)}"/></dataBar>${needsX14(rule) ? `<extLst><ext uri="{B025F937-C7B1-47D3-B67F-A62EFF666E3E}" xmlns:x14="${NS_X14}"><x14:id>${barGuid(rule.id)}</x14:id></ext></extLst>` : ''}</cfRule>`;
      break;
    case 'iconSet':
      body = `<cfRule type="iconSet" ${base}><iconSet iconSet="${ICON_FILE[rule.set]}"${rule.reverse ? ' reverse="1"' : ''}${rule.showValue === false ? ' showValue="0"' : ''}>${rule.thresholds.map(cfvoXml).join('')}</iconSet></cfRule>`;
      break;
  }
  const sqref = rule.ranges.map((r) => formatRect(normRect(r))).join(' ');
  return `<conditionalFormatting sqref="${sqref}">${body}</conditionalFormatting>`;
}

function parseSqref(sqref: string | undefined): Rect[] {
  const out: Rect[] = [];
  for (const part of (sqref ?? '').split(/\s+/).filter(Boolean)) {
    const [a, b] = part.split(':');
    const p = parseA1(a ?? '');
    const q = parseA1(b ?? a ?? '');
    if (p && q) out.push(normRect({ r1: p.row, c1: p.col, r2: q.row, c2: q.col }));
  }
  return out;
}

const cfvo = (n: XNode): CFValue => {
  const type = attr(n, 'type') ?? 'num';
  const val = attr(n, 'val');
  const t = (['min', 'max', 'num', 'percent', 'percentile', 'formula'].includes(type) ? type : type === 'autoMin' ? 'min' : type === 'autoMax' ? 'max' : 'num') as CFValue['type'];
  if (val === undefined) return { type: t };
  return { type: t, value: t === 'formula' ? val : Number(val) };
};

let counter = 0;

/** Parse the `<conditionalFormatting>` elements of a sheet. Rules that cannot be represented are reported in `skipped`. */
export function parseConditionalFormatting(blocks: XNode[], dxfs: CFFormat[], theme: string[], extLst?: XNode): { rules: CFRule[]; skipped: string[] } {
  const rules: CFRule[] = [];
  const skipped: string[] = [];
  // datos de Excel 2010 de las barras: por identificador
  const bars = new Map<string, { negativeColor?: string; axis?: 'middle' | 'none'; solid?: boolean }>();
  for (const ext of asArray(extLst?.ext)) {
    for (const cf of asArray(ext?.conditionalFormattings?.conditionalFormatting)) {
      for (const cr of asArray(cf?.cfRule)) {
        const db = cr?.dataBar;
        const id = attr(cr, 'id');
        if (!db || !id) continue;
        const neg = db.negativeFillColor;
        const ap = attr(db, 'axisPosition');
        bars.set(id, {
          ...(neg ? { negativeColor: resolveColor({ rgb: attr(neg, 'rgb'), theme: attr(neg, 'theme'), indexed: attr(neg, 'indexed'), tint: attr(neg, 'tint') }, theme) ?? undefined } : {}),
          ...(ap === 'middle' || ap === 'none' ? { axis: ap } : {}),
          ...(attr(db, 'gradient') === '0' ? { solid: true } : {}),
        });
      }
    }
  }
  for (const block of blocks) {
    const ranges = parseSqref(attr(block, 'sqref'));
    if (!ranges.length) continue;
    for (const r of asArray(block.cfRule)) {
      const type = attr(r, 'type') ?? '';
      const dxfId = attr(r, 'dxfId');
      const common = {
        id: `cf-imp-${++counter}`,
        ranges,
        priority: Number(attr(r, 'priority') ?? counter),
        ...(attr(r, 'stopIfTrue') === '1' ? { stopIfTrue: true } : {}),
        ...(dxfId !== undefined && dxfs[Number(dxfId)] ? { format: dxfs[Number(dxfId)] } : {}),
      };
      const formulas = asArray(r.formula).map((x: XNode) => textOf(x));
      const text = attr(r, 'text') ?? '';
      switch (type) {
        case 'cellIs': {
          const op = attr(r, 'operator') as CFOperator | undefined;
          if (!op || !formulas[0]) skipped.push(type);
          else rules.push({ ...common, type: 'cellIs', operator: op, formula1: formulas[0], ...(formulas[1] ? { formula2: formulas[1] } : {}) });
          break;
        }
        case 'expression':
          if (formulas[0]) rules.push({ ...common, type: 'expression', formula: formulas[0] });
          else skipped.push(type);
          break;
        case 'containsText':
        case 'notContainsText':
        case 'beginsWith':
        case 'endsWith':
          rules.push({ ...common, type: 'text', mode: type === 'containsText' ? 'contains' : type === 'notContainsText' ? 'notContains' : type, text });
          break;
        case 'duplicateValues':
        case 'uniqueValues':
          rules.push({ ...common, type: 'duplicates', ...(type === 'uniqueValues' ? { unique: true } : {}) });
          break;
        case 'top10':
          rules.push({ ...common, type: 'top', rank: Number(attr(r, 'rank') ?? 10), ...(attr(r, 'percent') === '1' ? { percent: true } : {}), ...(attr(r, 'bottom') === '1' ? { bottom: true } : {}) });
          break;
        case 'aboveAverage':
          rules.push({ ...common, type: 'average', above: attr(r, 'aboveAverage') !== '0', ...(attr(r, 'equalAverage') === '1' ? { equal: true } : {}), ...(Number(attr(r, 'stdDev')) > 0 ? { stdDev: Math.min(3, Number(attr(r, 'stdDev'))) } : {}) });
          break;
        case 'timePeriod': {
          const period = attr(r, 'timePeriod') as RelPeriod | undefined;
          if (period && CF_PERIODS.includes(period)) rules.push({ ...common, type: 'timePeriod', period });
          else skipped.push(`fechas ${period ?? ''}`.trim());
          break;
        }
        case 'containsBlanks':
        case 'notContainsBlanks':
          rules.push({ ...common, type: 'blanks', ...(type === 'notContainsBlanks' ? { not: true } : {}) });
          break;
        case 'containsErrors':
        case 'notContainsErrors':
          rules.push({ ...common, type: 'errors', ...(type === 'notContainsErrors' ? { not: true } : {}) });
          break;
        case 'colorScale': {
          const cs = r.colorScale;
          const stops = asArray(cs?.cfvo).map((v: XNode, i: number) => {
            const c = asArray(cs?.color)[i];
            return { cfvo: cfvo(v), color: resolveColor({ rgb: attr(c, 'rgb'), theme: attr(c, 'theme'), indexed: attr(c, 'indexed'), tint: attr(c, 'tint') }, theme) ?? '#ffffff' };
          });
          if (stops.length >= 2) rules.push({ ...common, type: 'colorScale', stops });
          else skipped.push(type);
          break;
        }
        case 'dataBar': {
          const db = r.dataBar;
          const vs = asArray(db?.cfvo);
          const c = asArray(db?.color)[0];
          rules.push({
            ...common,
            type: 'dataBar',
            color: resolveColor({ rgb: attr(c, 'rgb'), theme: attr(c, 'theme'), indexed: attr(c, 'indexed'), tint: attr(c, 'tint') }, theme) ?? '#638ec6',
            min: vs[0] ? cfvo(vs[0]) : { type: 'min' },
            max: vs[1] ? cfvo(vs[1]) : { type: 'max' },
            ...(attr(db, 'showValue') === '0' ? { showValue: false } : {}),
            ...bars.get(textOf(asArray(r.extLst?.ext).map((e: XNode) => e?.id).find(Boolean))),
          });
          break;
        }
        case 'iconSet': {
          const is = r.iconSet;
          const name = ICON_FROM_FILE.get(attr(is, 'iconSet') ?? '3TrafficLights1');
          if (!name) {
            skipped.push(`conjunto de iconos ${attr(is, 'iconSet')}`);
            break;
          }
          const th = asArray(is?.cfvo).map(cfvo);
          rules.push({
            ...common,
            type: 'iconSet',
            set: name,
            thresholds: th.length === ICON_COUNTS[name] ? th : defaultIconThresholds(name),
            ...(attr(is, 'reverse') === '1' ? { reverse: true } : {}),
            ...(attr(is, 'showValue') === '0' ? { showValue: false } : {}),
          });
          break;
        }
        default:
          skipped.push(type || 'desconocido');
      }
    }
  }
  return { rules, skipped };
}

// ------------------------------------------------------------------------------------------------ autofilter
const OP_TO_FILE: Record<FilterOp, [string, (v: string) => string]> = {
  eq: ['equal', (v) => v],
  ne: ['notEqual', (v) => v],
  gt: ['greaterThan', (v) => v],
  ge: ['greaterThanOrEqual', (v) => v],
  lt: ['lessThan', (v) => v],
  le: ['lessThanOrEqual', (v) => v],
  contains: ['equal', (v) => `*${v}*`],
  notContains: ['notEqual', (v) => `*${v}*`],
  beginsWith: ['equal', (v) => `${v}*`],
  endsWith: ['equal', (v) => `*${v}`],
};

/** Nombre del filtro dinámico en el archivo. */
function dynamicToFile(d: DynamicFilter): string {
  if (typeof d === 'string') return d;
  return 'quarter' in d ? `Q${d.quarter}` : `M${d.month}`;
}

/** Crea (o reutiliza) el formato diferencial de un filtro por color; `null` = sin relleno / color automático. */
export type ColorDxf = (kind: 'cell' | 'font', color: string | null) => number;

export function autoFilterXml(af: AutoFilter, colorDxf?: ColorDxf): string {
  const r = normRect(af.range);
  const cols = Object.entries(af.columns)
    .map(([c, flt]) => {
      const colId = Number(c) - r.c1;
      if (colId < 0) return '';
      if (flt.top) {
        return `<filterColumn colId="${colId}"><top10${flt.top.bottom ? ' top="0"' : ''}${flt.top.percent ? ' percent="1"' : ''} val="${Math.max(1, Math.trunc(flt.top.n))}"/></filterColumn>`;
      }
      if (flt.dynamic) {
        return `<filterColumn colId="${colId}"><dynamicFilter type="${dynamicToFile(flt.dynamic)}"/></filterColumn>`;
      }
      if (flt.color) {
        if (!colorDxf) return '';
        return `<filterColumn colId="${colId}"><colorFilter dxfId="${colorDxf(flt.color.kind, flt.color.color)}"${flt.color.kind === 'font' ? ' cellColor="0"' : ''}/></filterColumn>`;
      }
      if (flt.dates?.length) {
        const items = flt.dates
          .map((g) => `<dateGroupItem year="${g.year}"${g.month !== undefined ? ` month="${g.month}"` : ''}${g.day !== undefined ? ` day="${g.day}"` : ''} dateTimeGrouping="${g.day !== undefined ? 'day' : g.month !== undefined ? 'month' : 'year'}"/>`)
          .join('');
        return `<filterColumn colId="${colId}"><filters>${items}</filters></filterColumn>`;
      }
      if (flt.values) {
        const blank = flt.values.includes('');
        const items = flt.values
          .filter((v) => v !== '')
          .map((v) => `<filter val="${escapeXml(v)}"/>`)
          .join('');
        return `<filterColumn colId="${colId}"><filters${blank ? ' blank="1"' : ''}>${items}</filters></filterColumn>`;
      }
      if (flt.conditions?.list.length) {
        const items = flt.conditions.list.map((cond) => `<customFilter operator="${OP_TO_FILE[cond.op][0]}" val="${escapeXml(OP_TO_FILE[cond.op][1](cond.value))}"/>`).join('');
        return `<filterColumn colId="${colId}"><customFilters${flt.conditions.and ? ' and="1"' : ''}>${items}</customFilters></filterColumn>`;
      }
      return '';
    })
    .join('');
  return `<autoFilter ref="${formatRect(r)}">${cols}</autoFilter>`;
}

const FILE_TO_OP: Record<string, FilterOp> = { equal: 'eq', notEqual: 'ne', greaterThan: 'gt', greaterThanOrEqual: 'ge', lessThan: 'lt', lessThanOrEqual: 'le' };

function fromFileCondition(operator: string, val: string): FilterCondition | null {
  const op = FILE_TO_OP[operator ?? 'equal'];
  if (!op) return null;
  if (op === 'eq' || op === 'ne') {
    const starts = val.startsWith('*');
    const ends = val.endsWith('*');
    const inner = val.replace(/^\*/, '').replace(/\*$/, '');
    if (!inner.includes('*') && !inner.includes('?')) {
      if (starts && ends && val.length > 1) return { op: op === 'eq' ? 'contains' : 'notContains', value: inner };
      if (op === 'eq' && ends && !starts && val.length > 1) return { op: 'beginsWith', value: inner };
      if (op === 'eq' && starts && !ends && val.length > 1) return { op: 'endsWith', value: inner };
    }
  }
  return { op, value: val };
}

/** Parse an `<autoFilter>` element. Unsupported column filters are reported and ignored. */
const DYNAMIC_FROM_FILE = new Set(['aboveAverage', 'belowAverage', 'today', 'yesterday', 'tomorrow', 'thisWeek', 'lastWeek', 'nextWeek', 'thisMonth', 'lastMonth', 'nextMonth', 'thisQuarter', 'lastQuarter', 'nextQuarter', 'thisYear', 'lastYear', 'nextYear', 'yearToDate']);

function dynamicFromFile(type: string | undefined): DynamicFilter | null {
  if (!type) return null;
  if (DYNAMIC_FROM_FILE.has(type)) return type as DynamicFilter;
  const q = /^Q([1-4])$/.exec(type);
  if (q) return { quarter: Number(q[1]) as 1 | 2 | 3 | 4 };
  const m = /^M(1[0-2]|[1-9])$/.exec(type);
  return m ? { month: Number(m[1]) } : null;
}

export function parseAutoFilter(node: XNode, dxfs: CFFormat[] = []): { filter: AutoFilter | null; skipped: string[] } {
  const ref = attr(node, 'ref');
  if (!ref) return { filter: null, skipped: [] };
  const [a, b] = ref.split(':');
  const p = parseA1(a ?? '');
  const q = parseA1(b ?? a ?? '');
  if (!p || !q) return { filter: null, skipped: [] };
  const range = normRect({ r1: p.row, c1: p.col, r2: q.row, c2: q.col });
  const columns: Record<number, ColumnFilter> = {};
  const skipped: string[] = [];
  for (const fc of asArray(node.filterColumn)) {
    const col = range.c1 + Number(attr(fc, 'colId') ?? 0);
    if (fc.filters) {
      if (fc.filters.dateGroupItem !== undefined) {
        const dates = asArray(fc.filters.dateGroupItem)
          .map((x: XNode) => {
            const year = Number(attr(x, 'year'));
            const month = attr(x, 'month');
            const day = attr(x, 'day');
            const grouping = attr(x, 'dateTimeGrouping');
            if (!Number.isFinite(year) || !['year', 'month', 'day'].includes(grouping ?? '')) return null;
            return { year, ...(month !== undefined && grouping !== 'year' ? { month: Number(month) } : {}), ...(day !== undefined && grouping === 'day' ? { day: Number(day) } : {}) };
          })
          .filter((x): x is { year: number; month?: number; day?: number } => x !== null);
        if (dates.length) columns[col] = { dates };
        else skipped.push('filtro por fechas con horas');
        continue;
      }
      const values = asArray(fc.filters.filter).map((x: XNode) => attr(x, 'val') ?? '');
      if (attr(fc.filters, 'blank') === '1') values.push('');
      columns[col] = { values };
    } else if (fc.customFilters) {
      const list = asArray(fc.customFilters.customFilter)
        .map((x: XNode) => fromFileCondition(attr(x, 'operator') ?? 'equal', attr(x, 'val') ?? ''))
        .filter((x): x is FilterCondition => x !== null);
      if (list.length) columns[col] = { conditions: { list, and: attr(fc.customFilters, 'and') === '1' } };
      else skipped.push('filtro personalizado');
    } else if (fc.top10 !== undefined) {
      const n = Number(attr(fc.top10, 'val'));
      if (Number.isFinite(n) && n >= 1) {
        columns[col] = { top: { n, ...(attr(fc.top10, 'percent') === '1' ? { percent: true } : {}), ...(attr(fc.top10, 'top') === '0' ? { bottom: true } : {}) } };
      } else skipped.push('filtro de diez mejores');
    } else if (fc.dynamicFilter !== undefined) {
      const d = dynamicFromFile(attr(fc.dynamicFilter, 'type'));
      if (d) columns[col] = { dynamic: d };
      else skipped.push(`filtro dinámico ${attr(fc.dynamicFilter, 'type') ?? ''}`.trim());
    } else if (fc.colorFilter !== undefined) {
      const dxf = dxfs[Number(attr(fc.colorFilter, 'dxfId'))];
      const kind = attr(fc.colorFilter, 'cellColor') === '0' || attr(fc.colorFilter, 'cellColor') === 'false' ? 'font' : 'cell';
      if (dxf) columns[col] = { color: { kind, color: (kind === 'cell' ? dxf.bg : dxf.color) ?? null } };
      else skipped.push('filtro por color');
    }
  }
  return { filter: { range, columns }, skipped };
}
