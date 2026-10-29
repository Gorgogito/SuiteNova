import { esc } from '@suitenova/writer-core';
import type { ChartModel, ChartSeries } from '../types';
import { clrXml, fillXml, lnXml, type WriteCtx } from './dmlw';

/*
 * ChartML written from the chart model. Values are cached in the chart (strCache/numCache) and the series refer to cells of a sheet
 * named Sheet1, which is the layout PowerPoint itself uses.
 */

const noImages: WriteCtx = { image: () => undefined, link: () => undefined };

const col = (n: number): string => {
  let s = '';
  let x = n;
  do {
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return s;
};

function strRef(f: string, vals: string[]): string {
  return `<c:strRef><c:f>${f}</c:f><c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef>`;
}
function numRef(f: string, vals: (number | null)[], fmt = 'General'): string {
  return `<c:numRef><c:f>${f}</c:f><c:numCache><c:formatCode>${esc(fmt)}</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => (v === null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('')}</c:numCache></c:numRef>`;
}

function spPr(s: ChartSeries): string {
  const f = s.fill ? fillXml(s.fill, noImages) : '';
  const l = s.ln ? lnXml(s.ln, noImages) : '';
  return f || l ? `<c:spPr>${f}${l}</c:spPr>` : '';
}

function dLbls(s: ChartSeries): string {
  const l = s.labels;
  if (!l) return '';
  const b = (v: boolean | undefined) => (v ? 1 : 0);
  return `<c:dLbls>${l.numFmt ? `<c:numFmt formatCode="${esc(l.numFmt)}" sourceLinked="0"/>` : ''}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${l.pos ? `<c:dLblPos val="${l.pos}"/>` : ''}<c:showLegendKey val="0"/><c:showVal val="${b(l.value)}"/><c:showCatName val="${b(l.category)}"/><c:showSerName val="${b(l.series)}"/><c:showPercent val="${b(l.percent)}"/><c:showBubbleSize val="0"/></c:dLbls>`;
}

function seriesXml(m: ChartModel, s: ChartSeries, i: number, kind: string): string {
  const c = col(i + 1);
  const n = Math.max(m.categories.length, s.values.length);
  const tx = `<c:tx>${strRef(`Sheet1!$${c}$1`, [s.name])}</c:tx>`;
  const pts = (s.points ?? []).map((p) => `<c:dPt><c:idx val="${p.idx}"/>${kind === 'bar' ? '<c:invertIfNegative val="0"/>' : ''}<c:bubble3D val="0"/><c:spPr>${p.fill ? fillXml(p.fill, noImages) : ''}</c:spPr></c:dPt>`).join('');
  if (kind === 'scatter' || kind === 'bubble') {
    const xs = s.xValues ?? s.values.map((_, k) => k + 1);
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}${spPr(s)}${dLbls(s)}<c:xVal>${numRef(`Sheet1!$A$2:$A$${n + 1}`, xs)}</c:xVal><c:yVal>${numRef(`Sheet1!$${c}$2:$${c}$${n + 1}`, s.values)}</c:yVal>${kind === 'bubble' ? `<c:bubbleSize>${numRef(`Sheet1!$${col(i + 2)}$2:$${col(i + 2)}$${n + 1}`, s.sizes ?? s.values.map(() => 1))}</c:bubbleSize>` : '<c:smooth val="0"/>'}</c:ser>`;
  }
  const cat = `<c:cat>${strRef(`Sheet1!$A$2:$A$${n + 1}`, m.categories)}</c:cat>`;
  const val = `<c:val>${numRef(`Sheet1!$${c}$2:$${c}$${n + 1}`, s.values)}</c:val>`;
  const extra = kind === 'bar' ? '<c:invertIfNegative val="0"/>' : kind === 'line' ? `${s.marker ? `<c:marker><c:symbol val="${s.marker.symbol ?? 'circle'}"/>${s.marker.size ? `<c:size val="${s.marker.size}"/>` : ''}</c:marker>` : ''}` : '';
  return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}${spPr(s)}${extra}${pts}${dLbls(s)}${cat}${val}${kind === 'line' ? `<c:smooth val="${s.smooth ? 1 : 0}"/>` : ''}</c:ser>`;
}

const AXES = '<c:axId val="111111111"/><c:axId val="222222222"/>';

export function chartXml(m: ChartModel): string {
  const kind = m.kind.replace(/3D$/, '');
  const sers = (list: ChartSeries[], k: string) => list.map((s) => seriesXml(m, s, m.series.indexOf(s), k)).join('');
  let plot = '';
  const vary = `<c:varyColors val="${m.varyColors ? 1 : 0}"/>`;
  switch (kind) {
    case 'bar':
      plot = `<c:barChart><c:barDir val="${m.barDir ?? 'col'}"/><c:grouping val="${m.grouping ?? 'clustered'}"/>${vary}${sers(m.series, 'bar')}<c:gapWidth val="${m.gapWidth ?? 150}"/>${m.grouping && m.grouping !== 'clustered' ? `<c:overlap val="${m.overlap ?? 100}"/>` : ''}${AXES}</c:barChart>`;
      break;
    case 'line':
    case 'stock':
      plot = `<c:lineChart><c:grouping val="${m.grouping ?? 'standard'}"/>${vary}${sers(m.series, 'line')}<c:marker val="1"/>${AXES}</c:lineChart>`;
      break;
    case 'area':
      plot = `<c:areaChart><c:grouping val="${m.grouping ?? 'standard'}"/>${vary}${sers(m.series, 'area')}${AXES}</c:areaChart>`;
      break;
    case 'pie':
      plot = `<c:pieChart>${vary.replace('val="0"', 'val="1"')}${sers(m.series, 'pie')}<c:firstSliceAng val="${m.firstSliceAng ?? 0}"/></c:pieChart>`;
      break;
    case 'doughnut':
      plot = `<c:doughnutChart>${vary.replace('val="0"', 'val="1"')}${sers(m.series, 'pie')}<c:firstSliceAng val="${m.firstSliceAng ?? 0}"/><c:holeSize val="${m.holeSize ?? 50}"/></c:doughnutChart>`;
      break;
    case 'scatter':
      plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/>${vary}${sers(m.series, 'scatter')}${AXES}</c:scatterChart>`;
      break;
    case 'bubble':
      plot = `<c:bubbleChart>${vary}${sers(m.series, 'bubble')}${AXES}</c:bubbleChart>`;
      break;
    case 'radar':
      plot = `<c:radarChart><c:radarStyle val="marker"/>${vary}${sers(m.series, 'line')}${AXES}</c:radarChart>`;
      break;
    default:
      plot = `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${vary}${sers(m.series, 'bar')}${AXES}</c:barChart>`;
  }
  const noAxes = kind === 'pie' || kind === 'doughnut';
  const axTitle = (t: string | undefined) => (t ? `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` : '');
  const val = m.axes?.val;
  const cat = m.axes?.cat;
  const horizontal = m.barDir === 'bar' && kind === 'bar';
  const axes = noAxes
    ? ''
    : `<c:${kind === 'scatter' || kind === 'bubble' ? 'valAx' : 'catAx'}><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${cat?.delete ? 1 : 0}"/><c:axPos val="${horizontal ? 'l' : 'b'}"/>${axTitle(cat?.title)}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="222222222"/><c:crosses val="autoZero"/>${kind === 'scatter' || kind === 'bubble' ? '<c:crossBetween val="midCat"/>' : '<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/>'}</c:${kind === 'scatter' || kind === 'bubble' ? 'valAx' : 'catAx'}><c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/>${val?.max !== undefined ? `<c:max val="${val.max}"/>` : ''}${val?.min !== undefined ? `<c:min val="${val.min}"/>` : ''}</c:scaling><c:delete val="${val?.delete ? 1 : 0}"/><c:axPos val="${horizontal ? 'b' : 'l'}"/>${val?.gridlines !== false ? '<c:majorGridlines/>' : ''}${axTitle(val?.title)}<c:numFmt formatCode="${esc(val?.numFmt ?? 'General')}" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="111111111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  const title = m.title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:rPr lang="es-ES" sz="1800"/><a:t>${esc(m.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>';
  const legend = m.legend ? `<c:legend><c:legendPos val="${m.legend}"/><c:overlay val="0"/></c:legend>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart>${title}<c:plotArea><c:layout/>${plot}${axes}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:endParaRPr lang="es-ES"/></a:p></c:txPr></c:chartSpace>`;
}

export { clrXml };
