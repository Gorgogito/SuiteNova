import type { ChartCell } from '../source';
import { asArray, attr, textOf, type XNode } from './xml';

/*
 * Los valores en caché de un gráfico de Office: cada referencia de rango («Hoja1!$B$2:$B$5») lleva al lado, en el propio archivo, los
 * valores que tenía. Slides y Writer no tienen el libro del gráfico a mano, así que su rejilla se reconstruye con ellos.
 */

const cellOf = (pt: XNode, numeric: boolean): ChartCell => {
  const t = textOf(pt?.v ?? pt);
  if (numeric) {
    const n = Number(t);
    return t === '' || !Number.isFinite(n) ? null : n;
  }
  return t;
};

function points(cache: XNode, numeric: boolean): ChartCell[] {
  const count = Number(attr(cache?.ptCount, 'val') ?? 0);
  const out: ChartCell[] = Array.from({ length: count }, () => null);
  for (const pt of asArray(cache?.pt)) {
    const i = Number(attr(pt, 'idx'));
    if (Number.isInteger(i) && i >= 0) {
      while (out.length <= i) out.push(null);
      out[i] = cellOf(pt, numeric);
    }
  }
  return out;
}

/** Todas las referencias con su caché de un `c:chartSpace` o un `cx:chartSpace` ya leído: referencia → valores. */
export function readChartCaches(doc: XNode): Map<string, ChartCell[]> {
  const out = new Map<string, ChartCell[]>();
  const put = (f: XNode, values: ChartCell[]) => {
    const ref = textOf(f).trim();
    if (ref && !out.has(ref)) out.set(ref, values);
  };
  const walk = (n: XNode) => {
    if (n === null || typeof n !== 'object') return;
    if (Array.isArray(n)) return void n.forEach(walk);
    // gráfico clásico: <c:numRef><c:f/><c:numCache/></c:numRef> y <c:strRef>…<c:strCache/>
    if (n.f !== undefined && n.numCache !== undefined) put(n.f, points(n.numCache, true));
    else if (n.f !== undefined && n.strCache !== undefined) put(n.f, points(n.strCache, false));
    // gráfico de Office 2016: <cx:numDim><cx:f/><cx:lvl><cx:pt/></cx:lvl>
    else if (n.f !== undefined && n.lvl !== undefined) {
      const numeric = n['@_type'] === 'val' || n['@_type'] === undefined ? n.lvl && attr(asArray(n.lvl)[0], 'formatCode') !== undefined : false;
      const lvl = asArray(n.lvl)[0];
      const pts = asArray(lvl?.pt);
      const count = Number(attr(lvl, 'ptCount') ?? pts.length);
      const arr: ChartCell[] = Array.from({ length: count }, () => null);
      for (const pt of pts) {
        const i = Number(attr(pt, 'idx'));
        if (Number.isInteger(i) && i >= 0) arr[i] = cellOf(pt, !!numeric);
      }
      put(n.f, arr);
    }
    for (const k of Object.keys(n)) if (!k.startsWith('@_')) walk(n[k]);
  };
  walk(doc);
  return out;
}
