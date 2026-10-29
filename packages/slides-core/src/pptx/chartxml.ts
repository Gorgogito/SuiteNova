import { attrOf, findKid, findKids, kidsOf, parseXml, rootOf, tagOf, textOfNode, type XNode } from '@suitenova/writer-core';
import type { ChartModel, ChartSeries, Fill, Ln } from '../types';
import { numAttr, readFill, readLn, type DmlCtx } from './dml';

const noCtx: DmlCtx = { blip: () => undefined, link: () => undefined, warn: () => undefined };

function richText(n: XNode | undefined): string | undefined {
  if (!n) return undefined;
  const tx = findKid(n, 'tx');
  const rich = findKid(tx, 'rich');
  if (!rich) return undefined;
  const lines: string[] = [];
  for (const p of findKids(rich, 'p')) {
    lines.push(
      kidsOf(p)
        .filter((k) => tagOf(k) === 'r')
        .map((r) => textOfNode(findKid(r, 't') ?? { '#text': '' }))
        .join(''),
    );
  }
  return lines.join('\n') || undefined;
}

function cacheOf(cc: XNode | undefined): { strs: string[]; nums: (number | null)[] } {
  const strs: string[] = [];
  const nums: (number | null)[] = [];
  if (!cc) return { strs, nums };
  const count = numAttr(cc, 'ptCount') ?? 0;
  for (let i = 0; i < count; i++) {
    strs.push('');
    nums.push(null);
  }
  for (const pt of findKids(cc, 'pt')) {
    const i = numAttr(pt, 'idx') ?? 0;
    const v = textOfNode(findKid(pt, 'v') ?? { '#text': '' });
    strs[i] = v;
    const x = Number(v);
    nums[i] = v !== '' && Number.isFinite(x) ? x : null;
  }
  return { strs, nums };
}
/** Values of a / (its cache) or of a literal (/). */
function cache(ref: XNode | undefined): { strs: string[]; nums: (number | null)[] } {
  if (!ref) return cacheOf(undefined);
  const t = tagOf(ref);
  if (t === 'numLit' || t === 'strLit') return cacheOf(ref);
  return cacheOf(findKid(ref, 'strCache') ?? findKid(ref, 'numCache'));
}

function multiLevelCats(ref: XNode | undefined): string[] {
  const m = findKid(ref, 'multiLvlStrRef');
  const c = findKid(m, 'multiLvlStrCache');
  const lvls = findKids(c, 'lvl');
  if (!lvls.length) return [];
  const count = numAttr(c, 'ptCount') ?? 0;
  const out: string[] = Array.from({ length: count }, () => '');
  // innermost level first; join the levels with a space
  for (const l of lvls) for (const pt of findKids(l, 'pt')) out[numAttr(pt, 'idx') ?? 0] = (out[numAttr(pt, 'idx') ?? 0] ? out[numAttr(pt, 'idx') ?? 0] + ' ' : '') + textOfNode(findKid(pt, 'v') ?? { '#text': '' });
  return out;
}

function numRefOrLit(n: XNode | undefined) {
  return findKid(n, 'numRef') ?? findKid(n, 'numLit') ?? findKid(n, 'strRef') ?? findKid(n, 'strLit');
}

const TYPE_TAGS = ['barChart', 'bar3DChart', 'lineChart', 'line3DChart', 'areaChart', 'area3DChart', 'pieChart', 'pie3DChart', 'ofPieChart', 'doughnutChart', 'scatterChart', 'bubbleChart', 'radarChart', 'stockChart', 'surfaceChart', 'surface3DChart'];

export function readChartXml(xml: string): { chart: ChartModel } {
  const root = rootOf(parseXml(xml), 'chartSpace');
  const ch = findKid(root, 'chart');
  const plot = findKid(ch, 'plotArea');
  const model: ChartModel = { kind: 'bar', categories: [], series: [] };
  const title = findKid(ch, 'autoTitleDeleted') && attrOf(findKid(ch, 'autoTitleDeleted')!, 'val') === '1' ? undefined : richText(findKid(ch, 'title'));
  if (title) model.title = title;
  const lg = findKid(ch, 'legend');
  model.legend = lg ? ((attrOf(findKid(lg, 'legendPos') ?? {}, 'val') ?? 'r') as ChartModel['legend']) : null;
  const style = findKid(root, 'style');
  if (style) model.style = numAttr(style, 'val');
  let first = true;
  for (const t of kidsOf(plot ?? {})) {
    const tag = tagOf(t);
    if (!TYPE_TAGS.includes(tag)) continue;
    const kind = tag.replace(/Chart$/, '');
    if (first) {
      model.kind = kind;
      model.grouping = attrOf(findKid(t, 'grouping') ?? {}, 'val');
      const bd = findKid(t, 'barDir');
      if (bd) model.barDir = (attrOf(bd, 'val') ?? 'col') as 'col' | 'bar';
      model.varyColors = attrOf(findKid(t, 'varyColors') ?? {}, 'val') === '1';
      const hs = findKid(t, 'holeSize');
      if (hs) model.holeSize = numAttr(hs, 'val');
      const fa = findKid(t, 'firstSliceAng');
      if (fa) model.firstSliceAng = numAttr(fa, 'val');
      const gw = findKid(t, 'gapWidth');
      if (gw) model.gapWidth = numAttr(gw, 'val');
      const ov = findKid(t, 'overlap');
      if (ov) model.overlap = numAttr(ov, 'val');
    }
    for (const ser of findKids(t, 'ser')) {
      const name = ((): string => {
        const tx = findKid(ser, 'tx');
        const c = cache(findKid(tx, 'strRef'));
        return c.strs[0] || textOfNode(findKid(tx, 'v') ?? { '#text': '' });
      })();
      const catRef = findKid(ser, 'cat') ?? findKid(ser, 'xVal');
      let cats: string[] = [];
      if (catRef) {
        cats = multiLevelCats(catRef);
        if (!cats.length) cats = cache(numRefOrLit(catRef)).strs;
      }
      const valRef = findKid(ser, 'val') ?? findKid(ser, 'yVal');
      const vals = cache(numRefOrLit(valRef)).nums;
      const s: ChartSeries = { name, values: vals };
      if (kind === 'scatter' || kind === 'bubble') {
        s.xValues = cache(numRefOrLit(findKid(ser, 'xVal'))).nums;
        const bs = findKid(ser, 'bubbleSize');
        if (bs) s.sizes = cache(numRefOrLit(bs)).nums;
      } else if (first || !model.categories.length) model.categories = cats.length ? cats : model.categories;
      if (!first) s.type = kind;
      const spPr = findKid(ser, 'spPr');
      const fill: Fill | undefined = readFill(spPr, noCtx);
      if (fill) s.fill = fill;
      const ln: Ln | undefined = readLn(findKid(spPr, 'ln'), noCtx);
      if (ln) s.ln = ln;
      const pts = findKids(ser, 'dPt').map((d) => ({ idx: numAttr(findKid(d, 'idx'), 'val') ?? 0, fill: readFill(findKid(d, 'spPr'), noCtx) }));
      if (pts.length) s.points = pts;
      const dl = findKid(ser, 'dLbls');
      if (dl) {
        const flag = (k: string) => attrOf(findKid(dl, k) ?? {}, 'val') === '1';
        s.labels = { value: flag('showVal'), percent: flag('showPercent'), category: flag('showCatName'), series: flag('showSerName'), pos: attrOf(findKid(dl, 'dLblPos') ?? {}, 'val'), numFmt: attrOf(findKid(dl, 'numFmt') ?? {}, 'formatCode') };
      }
      if (attrOf(findKid(ser, 'smooth') ?? {}, 'val') === '1') s.smooth = true;
      const mk = findKid(ser, 'marker');
      if (mk) s.marker = { symbol: attrOf(findKid(mk, 'symbol') ?? {}, 'val'), size: numAttr(findKid(mk, 'size'), 'val') };
      model.series.push(s);
    }
    first = false;
  }
  // secondary axes: a series of a second group of axes is flagged by its axis ids
  const valAxes = findKids(plot, 'valAx');
  const catAx = findKid(plot, 'catAx') ?? findKid(plot, 'dateAx') ?? findKid(plot, 'serAx');
  const va = valAxes[0];
  const axisTitle = (a: XNode | undefined) => richText(a ? findKid(a, 'title') : undefined) ?? undefined;
  const sc = (a: XNode | undefined, k: string) => numAttr(findKid(findKid(a, 'scaling'), k), 'val');
  model.axes = {
    ...(catAx ? { cat: { title: axisTitle(catAx), delete: attrOf(findKid(catAx, 'delete') ?? {}, 'val') === '1' } } : {}),
    ...(va ? { val: { title: axisTitle(va), min: sc(va, 'min'), max: sc(va, 'max'), delete: attrOf(findKid(va, 'delete') ?? {}, 'val') === '1', numFmt: attrOf(findKid(va, 'numFmt') ?? {}, 'formatCode'), gridlines: !!findKid(va, 'majorGridlines') } } : {}),
  };
  if (findKid(root, 'externalData')) model.hasWorkbook = true;
  return { chart: model };
}
