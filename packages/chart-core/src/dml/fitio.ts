/** Líneas de tendencia (`c:trendline`) y barras de error (`c:errBars`) de una serie de gráfico, en XLSX. */
import type { ChartSeries } from '../model';
import type { ErrorBars, ErrorKind, TrendType, Trendline } from '../fit';
import type { ChartSource } from '../source';
import { asArray, attr, escapeXml, type XNode } from './xml';

const hex = (c: string) => c.replace('#', '').toUpperCase();

const TREND_TO_FILE: Record<TrendType, string> = { linear: 'linear', exp: 'exp', log: 'log', poly: 'poly', power: 'power', movingAvg: 'movingAvg' };
const KIND_TO_FILE: Record<ErrorKind, string> = { fixed: 'fixedVal', percent: 'percentage', stdev: 'stdDev', stderr: 'stdErr', custom: 'cust' };

function lineXml(color: string | undefined, dash: boolean, width = 19050): string {
  return `<c:spPr><a:ln w="${width}" cap="rnd">${color ? `<a:solidFill><a:srgbClr val="${hex(color)}"/></a:solidFill>` : ''}${dash ? '<a:prstDash val="sysDash"/>' : ''}</a:ln></c:spPr>`;
}

export function trendlinesXml(s: ChartSeries): string {
  return (s.trendlines ?? [])
    .map((tl) => {
      const parts = [
        tl.name ? `<c:name>${escapeXml(tl.name)}</c:name>` : '',
        lineXml(tl.color, true),
        `<c:trendlineType val="${TREND_TO_FILE[tl.type]}"/>`,
        tl.type === 'poly' ? `<c:order val="${Math.min(6, Math.max(2, Math.trunc(tl.order ?? 2)))}"/>` : '',
        tl.type === 'movingAvg' ? `<c:period val="${Math.max(2, Math.trunc(tl.period ?? 2))}"/>` : '',
        tl.forward ? `<c:forward val="${tl.forward}"/>` : '',
        tl.backward ? `<c:backward val="${tl.backward}"/>` : '',
        tl.intercept !== undefined ? `<c:intercept val="${tl.intercept}"/>` : '',
        `<c:dispRSqr val="${tl.dispR2 ? 1 : 0}"/>`,
        `<c:dispEq val="${tl.dispEq ? 1 : 0}"/>`,
      ];
      return `<c:trendline>${parts.join('')}</c:trendline>`;
    })
    .join('');
}

/** `plus`/`minus` personalizados: un rango se escribe con su caché; una lista o un número, como literal. */
function customXml(tag: 'plus' | 'minus', text: string | undefined, src: ChartSource): string {
  if (!text) return '';
  const t = text.trim().replace(/^=/, '');
  if (t.includes('!') || /^[A-Za-z$]+\$?\d/.test(t)) {
    const vals = src.range(t).values;
    const pts = vals.map((v, i) => (typeof v === 'number' ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : '')).join('');
    return `<c:${tag}><c:numRef><c:f>${escapeXml(t)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${pts}</c:numCache></c:numRef></c:${tag}>`;
  }
  const nums = t.replace(/^\{|\}$/g, '').split(/[;,]/).map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
  return `<c:${tag}><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${nums.length}"/>${nums.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numLit></c:${tag}>`;
}

function errBarXml(eb: ErrorBars, dir: 'x' | 'y', kind: 'scatter' | 'line' | 'other', src: ChartSource): string {
  const val = eb.kind === 'custom' ? '' : `<c:val val="${eb.value ?? (eb.kind === 'percent' ? 5 : 1)}"/>`;
  const cust = eb.kind === 'custom' ? customXml('plus', eb.direction === 'minus' ? undefined : eb.plus, src) + customXml('minus', eb.direction === 'plus' ? undefined : (eb.minus ?? eb.plus), src) : '';
  return (
    '<c:errBars>' +
    (kind === 'scatter' ? `<c:errDir val="${dir}"/>` : kind === 'line' ? '<c:errDir val="y"/>' : '') +
    `<c:errBarType val="${eb.direction}"/><c:errValType val="${KIND_TO_FILE[eb.kind]}"/><c:noEndCap val="${eb.noCap ? 1 : 0}"/>${cust}${val}` +
    '</c:errBars>'
  );
}

export function errBarsXml(s: ChartSeries, kind: 'scatter' | 'line' | 'other', src: ChartSource): string {
  return (s.errX && kind === 'scatter' ? errBarXml(s.errX, 'x', kind, src) : '') + (s.errY ? errBarXml(s.errY, 'y', kind, src) : '');
}

// ------------------------------------------------------------------------------------------ reading
const TREND_FROM_FILE: Record<string, TrendType> = { linear: 'linear', exp: 'exp', log: 'log', poly: 'poly', power: 'power', movingAvg: 'movingAvg' };
const KIND_FROM_FILE: Record<string, ErrorKind> = { fixedVal: 'fixed', percentage: 'percent', stdDev: 'stdev', stdErr: 'stderr', cust: 'custom' };

const flag = (n: XNode): boolean => {
  const v = attr(n, 'val');
  return v === undefined ? true : v === '1' || v === 'true';
};
const numAttr = (n: XNode): number | undefined => {
  const v = attr(n, 'val');
  return v === undefined || Number.isNaN(Number(v)) ? undefined : Number(v);
};

function lineColor(spPr: XNode): string | undefined {
  const v = spPr?.ln?.solidFill?.srgbClr;
  const c = v === undefined ? undefined : attr(v, 'val');
  return c ? `#${c.toLowerCase()}` : undefined;
}

export function parseTrendlines(ser: XNode): Trendline[] {
  const out: Trendline[] = [];
  for (const n of asArray<XNode>(ser.trendline)) {
    const type = TREND_FROM_FILE[attr(n.trendlineType, 'val') ?? 'linear'];
    if (!type) continue;
    const tl: Trendline = { type };
    const name = typeof n.name === 'string' ? n.name : undefined;
    if (name) tl.name = name;
    const color = lineColor(n.spPr);
    if (color) tl.color = color;
    if (type === 'poly') tl.order = Math.min(6, Math.max(2, numAttr(n.order) ?? 2));
    if (type === 'movingAvg') tl.period = Math.max(2, numAttr(n.period) ?? 2);
    const fw = numAttr(n.forward);
    const bw = numAttr(n.backward);
    const ic = numAttr(n.intercept);
    if (fw) tl.forward = fw;
    if (bw) tl.backward = bw;
    if (ic !== undefined && (type === 'linear' || type === 'exp')) tl.intercept = ic;
    if (n.dispEq !== undefined && flag(n.dispEq)) tl.dispEq = true;
    if (n.dispRSqr !== undefined && flag(n.dispRSqr)) tl.dispR2 = true;
    out.push(tl);
  }
  return out;
}

function customText(n: XNode): string | undefined {
  if (n === undefined) return undefined;
  const f = n.numRef?.f;
  if (f !== undefined) return String(typeof f === 'object' ? f['#text'] : f).replace(/^=/, '');
  const pts = asArray<XNode>(n.numLit?.pt).map((p) => String(p.v));
  return pts.length ? pts.join(',') : undefined;
}

/** Las barras de error de una serie: [barras Y, barras X]. */
export function parseErrBars(ser: XNode, scatter: boolean): { errY?: ErrorBars; errX?: ErrorBars } {
  const out: { errY?: ErrorBars; errX?: ErrorBars } = {};
  for (const n of asArray<XNode>(ser.errBars)) {
    const kind = KIND_FROM_FILE[attr(n.errValType, 'val') ?? 'fixedVal'];
    if (!kind) continue;
    const dir = attr(n.errDir, 'val') === 'x' && scatter ? 'x' : 'y';
    const dirType = attr(n.errBarType, 'val');
    const eb: ErrorBars = { kind, direction: dirType === 'plus' || dirType === 'minus' ? dirType : 'both' };
    const v = numAttr(n.val);
    if (v !== undefined && kind !== 'custom') eb.value = v;
    if (kind === 'custom') {
      const plus = customText(n.plus);
      const minus = customText(n.minus);
      if (plus) eb.plus = plus;
      if (minus) eb.minus = minus;
    }
    if (n.noEndCap !== undefined && flag(n.noEndCap)) eb.noCap = true;
    if (dir === 'x') out.errX = eb;
    else out.errY = eb;
  }
  return out;
}
