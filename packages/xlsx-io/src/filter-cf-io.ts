import {
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
export function dxfXml(f: CFFormat): string {
  const font =
    f.bold || f.italic || f.underline || f.strike || f.color
      ? `<font>${f.bold ? '<b/>' : ''}${f.italic ? '<i/>' : ''}${f.strike ? '<strike/>' : ''}${f.underline ? '<u/>' : ''}${f.color ? `<color rgb="${argb(f.color)}"/>` : ''}</font>`
      : '';
  const fill = f.bg ? `<fill><patternFill><bgColor rgb="${argb(f.bg)}"/></patternFill></fill>` : '';
  return `<dxf>${font}${fill}</dxf>`;
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
    const p = asArray(d.fill)[0]?.patternFill;
    if (p) {
      const n = p.bgColor ?? p.fgColor;
      const col = n && resolveColor({ rgb: attr(n, 'rgb'), theme: attr(n, 'theme'), indexed: attr(n, 'indexed'), tint: attr(n, 'tint') }, theme);
      if (col) f.bg = col;
    }
    return f;
  });
}

// ------------------------------------------------------------------------------------------------ conditional formatting
const ICON_FILE: Record<IconSetName, string> = { '3Arrows': '3Arrows', '3TrafficLights': '3TrafficLights1', '3Symbols': '3Symbols', '3Flags': '3Flags', '4Arrows': '4Arrows', '5Arrows': '5Arrows' };
const ICON_FROM_FILE = new Map<string, IconSetName>([
  ['3Arrows', '3Arrows'],
  ['3TrafficLights1', '3TrafficLights'],
  ['3TrafficLights2', '3TrafficLights'],
  ['3Symbols', '3Symbols'],
  ['3Symbols2', '3Symbols'],
  ['3Flags', '3Flags'],
  ['4Arrows', '4Arrows'],
  ['5Arrows', '5Arrows'],
  ['3ArrowsGray', '3Arrows'],
]);

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
      body = `<cfRule type="aboveAverage" ${base}${rule.above ? '' : ' aboveAverage="0"'}${rule.equal ? ' equalAverage="1"' : ''}/>`;
      break;
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
      body = `<cfRule type="dataBar" ${base}><dataBar${rule.showValue === false ? ' showValue="0"' : ''}>${cfvoXml(rule.min)}${cfvoXml(rule.max)}<color rgb="${argb(rule.color)}"/></dataBar></cfRule>`;
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
export function parseConditionalFormatting(blocks: XNode[], dxfs: CFFormat[], theme: string[]): { rules: CFRule[]; skipped: string[] } {
  const rules: CFRule[] = [];
  const skipped: string[] = [];
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
          if (attr(r, 'stdDev')) skipped.push('aboveAverage con desviación estándar');
          else rules.push({ ...common, type: 'average', above: attr(r, 'aboveAverage') !== '0', ...(attr(r, 'equalAverage') === '1' ? { equal: true } : {}) });
          break;
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

export function autoFilterXml(af: AutoFilter): string {
  const r = normRect(af.range);
  const cols = Object.entries(af.columns)
    .map(([c, flt]) => {
      const colId = Number(c) - r.c1;
      if (colId < 0) return '';
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
export function parseAutoFilter(node: XNode): { filter: AutoFilter | null; skipped: string[] } {
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
        skipped.push('filtro por fechas');
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
    } else if (fc.top10 !== undefined || fc.dynamicFilter !== undefined || fc.colorFilter !== undefined) {
      skipped.push('filtro de diez mejores/dinámico/por color');
    }
  }
  return { filter: { range, columns }, skipped };
}
