import { clrCss, resolveClr, toCss, type ChartEl, type ChartSeries, type Fill } from '@suitenova/slides-core';
import type { ReactNode } from 'react';
import { xfOf, type CanvasCtx } from './SlideCanvas';

/*
 * Charts as SVG from the chart model (values cached in the file). 3-D charts are drawn flat.
 */

const ACCENTS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const;

function niceScale(min: number, max: number, ticks = 5): { min: number; max: number; step: number } {
  if (min === max) return { min: Math.min(0, min), max: max + 1, step: Math.max(1, Math.abs(max)) / ticks };
  const span = max - min;
  const raw = span / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
}

const fmtNum = (v: number): string => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1000 ? v.toLocaleString() : String(Math.round(v * 100) / 100));

export function ChartView({ el, ctx }: { el: ChartEl; ctx: CanvasCtx }): ReactNode {
  const x = xfOf(ctx, el);
  const w = x.w;
  const h = x.h;
  const m = el.chart;
  const cc = ctx.env.cc;
  const text = toCss(resolveClr({ scheme: 'tx1', mods: [{ t: 'lumMod', v: 65000 }, { t: 'lumOff', v: 35000 }] }, cc));
  const grid = toCss(resolveClr({ scheme: 'tx1', mods: [{ t: 'lumMod', v: 15000 }, { t: 'lumOff', v: 85000 }] }, cc));
  const colorOf = (s: ChartSeries, i: number, point?: number): string => {
    const pf: Fill | undefined = point !== undefined ? s.points?.find((p) => p.idx === point)?.fill : undefined;
    const f = pf ?? s.fill;
    if (f && f.t === 'solid') return clrCss(f.c, cc);
    return clrCss({ scheme: ACCENTS[i % 6] }, cc);
  };
  const kind = m.kind.replace(/3D$/, '');
  const title = m.title;
  const legendOn = !!m.legend;
  const padT = title ? 34 : 14;
  const padB = legendOn && (m.legend === 'b' || m.legend === 't' || !m.legend) ? 34 : 24;
  const padR = legendOn && m.legend === 'r' ? 110 : 14;
  const padL = 46;
  const px = padL;
  const py = padT;
  const pw = Math.max(10, w - padL - padR);
  const ph = Math.max(10, h - padT - padB);
  const cats = m.categories.length ? m.categories : m.series[0]?.values.map((_, i) => String(i + 1)) ?? [];
  const body: ReactNode[] = [];

  const legendItems = (m.kind === 'pie' || m.kind === 'doughnut' || (m.varyColors && m.series.length === 1) ? cats.map((c, i) => ({ name: c, color: colorOf(m.series[0] ?? ({} as ChartSeries), i, i) })) : m.series.map((s, i) => ({ name: s.name, color: colorOf(s, i) })));

  if (kind === 'pie' || kind === 'doughnut' || kind === 'ofPie') {
    const s = m.series[0];
    const vals = (s?.values ?? []).map((v) => Math.max(0, v ?? 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = px + pw / 2;
    const cy = py + ph / 2;
    const r = Math.min(pw, ph) / 2 - 4;
    const hole = kind === 'doughnut' ? ((m.holeSize ?? 50) / 100) * r : 0;
    let a0 = ((m.firstSliceAng ?? 0) - 90) * (Math.PI / 180);
    vals.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rr: number, a: number) => `${cx + rr * Math.cos(a)} ${cy + rr * Math.sin(a)}`;
      const d = hole
        ? `M${p(r, a0)}A${r} ${r} 0 ${large} 1 ${p(r, a1)}L${p(hole, a1)}A${hole} ${hole} 0 ${large} 0 ${p(hole, a0)}Z`
        : v / total >= 0.9999
          ? `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`
          : `M${cx} ${cy}L${p(r, a0)}A${r} ${r} 0 ${large} 1 ${p(r, a1)}Z`;
      body.push(<path key={i} d={d} fill={colorOf(s!, i, i)} stroke="#fff" strokeWidth={1} />);
      if (s?.labels && (s.labels.value || s.labels.percent || s.labels.category)) {
        const mid = (a0 + a1) / 2;
        const lr = hole ? (r + hole) / 2 : r * 0.65;
        const label = [s.labels.category ? cats[i] : '', s.labels.value ? fmtNum(v) : '', s.labels.percent ? `${Math.round((v / total) * 100)}%` : ''].filter(Boolean).join(' ');
        body.push(
          <text key={`l${i}`} x={cx + lr * Math.cos(mid)} y={cy + lr * Math.sin(mid)} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill="#fff">
            {label}
          </text>,
        );
      }
      a0 = a1;
    });
  } else if (kind === 'scatter' || kind === 'bubble') {
    const xs = m.series.flatMap((s) => (s.xValues ?? []).filter((v): v is number => v !== null));
    const ys = m.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
    const sx = niceScale(Math.min(...xs, 0), Math.max(...xs, 1));
    const sy = niceScale(Math.min(...ys, 0), Math.max(...ys, 1));
    const X = (v: number) => px + ((v - sx.min) / (sx.max - sx.min || 1)) * pw;
    const Y = (v: number) => py + ph - ((v - sy.min) / (sy.max - sy.min || 1)) * ph;
    for (let v = sy.min; v <= sy.max + 1e-9; v += sy.step) body.push(<line key={`g${v}`} x1={px} x2={px + pw} y1={Y(v)} y2={Y(v)} stroke={grid} />, <text key={`t${v}`} x={px - 6} y={Y(v)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={text}>{fmtNum(v)}</text>);
    for (let v = sx.min; v <= sx.max + 1e-9; v += sx.step) body.push(<text key={`x${v}`} x={X(v)} y={py + ph + 14} textAnchor="middle" fontSize={11} fill={text}>{fmtNum(v)}</text>);
    m.series.forEach((s, i) => {
      const col = colorOf(s, i);
      (s.values ?? []).forEach((v, j) => {
        const xv = s.xValues?.[j];
        if (v === null || xv === null || xv === undefined) return;
        const r = kind === 'bubble' ? 4 + Math.sqrt(Math.max(0, s.sizes?.[j] ?? 1)) * 3 : 4;
        body.push(<circle key={`${i}-${j}`} cx={X(xv)} cy={Y(v)} r={r} fill={col} fillOpacity={kind === 'bubble' ? 0.6 : 1} />);
      });
    });
  } else if (kind === 'radar') {
    const n = cats.length || 3;
    const max = niceScale(0, Math.max(1, ...m.series.flatMap((s) => s.values.map((v) => v ?? 0)))).max;
    const cx = px + pw / 2;
    const cy = py + ph / 2;
    const r = Math.min(pw, ph) / 2 - 14;
    for (let k = 1; k <= 5; k++) body.push(<polygon key={`r${k}`} points={Array.from({ length: n }, (_, i) => `${cx + ((r * k) / 5) * Math.sin((i / n) * 2 * Math.PI)},${cy - ((r * k) / 5) * Math.cos((i / n) * 2 * Math.PI)}`).join(' ')} fill="none" stroke={grid} />);
    cats.forEach((c, i) => body.push(<text key={`c${i}`} x={cx + (r + 8) * Math.sin((i / n) * 2 * Math.PI)} y={cy - (r + 8) * Math.cos((i / n) * 2 * Math.PI)} fontSize={11} textAnchor="middle" fill={text}>{c}</text>));
    m.series.forEach((s, i) => {
      const pts = s.values.map((v, j) => `${cx + ((v ?? 0) / max) * r * Math.sin((j / n) * 2 * Math.PI)},${cy - ((v ?? 0) / max) * r * Math.cos((j / n) * 2 * Math.PI)}`).join(' ');
      body.push(<polygon key={`s${i}`} points={pts} fill={colorOf(s, i)} fillOpacity={0.2} stroke={colorOf(s, i)} strokeWidth={2} />);
    });
  } else {
    // bar / column / line / area (and stock drawn as lines)
    const horizontal = m.barDir === 'bar' && kind === 'bar';
    const stacked = m.grouping === 'stacked' || m.grouping === 'percentStacked';
    const percent = m.grouping === 'percentStacked';
    const nCat = Math.max(1, cats.length);
    const totals = Array.from({ length: nCat }, (_, i) => m.series.reduce((a, s) => a + Math.abs(s.values[i] ?? 0), 0));
    const val = (s: ChartSeries, i: number) => (s.values[i] ?? 0);
    let lo = 0;
    let hi = 0;
    if (stacked) {
      for (let i = 0; i < nCat; i++) {
        const pos = m.series.reduce((a, s) => a + Math.max(0, val(s, i)), 0);
        const neg = m.series.reduce((a, s) => a + Math.min(0, val(s, i)), 0);
        hi = Math.max(hi, percent ? 100 : pos);
        lo = Math.min(lo, percent ? 0 : neg);
      }
    } else for (const s of m.series) for (let i = 0; i < nCat; i++) ((hi = Math.max(hi, val(s, i))), (lo = Math.min(lo, val(s, i))));
    const ax = m.axes?.val;
    const sc = niceScale(ax?.min ?? lo, ax?.max ?? (hi || 1));
    const along = horizontal ? ph : pw;
    const across = horizontal ? pw : ph;
    const V = (v: number) => ((v - sc.min) / (sc.max - sc.min || 1)) * across;
    const band = along / nCat;
    const Cx = (i: number) => px + (horizontal ? 0 : band * i);
    // gridlines and value labels
    for (let v = sc.min; v <= sc.max + 1e-9; v += sc.step) {
      if (horizontal) {
        const xx = px + V(v);
        body.push(<line key={`g${v}`} x1={xx} x2={xx} y1={py} y2={py + ph} stroke={grid} />, <text key={`t${v}`} x={xx} y={py + ph + 14} textAnchor="middle" fontSize={11} fill={text}>{fmtNum(v)}</text>);
      } else {
        const yy = py + ph - V(v);
        if (ax?.gridlines !== false) body.push(<line key={`g${v}`} x1={px} x2={px + pw} y1={yy} y2={yy} stroke={grid} />);
        if (!ax?.delete) body.push(<text key={`t${v}`} x={px - 6} y={yy} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={text}>{fmtNum(v)}</text>);
      }
    }
    cats.forEach((c, i) => {
      if (horizontal) body.push(<text key={`c${i}`} x={px - 6} y={py + ph - band * (i + 0.5)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={text}>{c}</text>);
      else body.push(<text key={`c${i}`} x={Cx(i) + band / 2} y={py + ph + 14} textAnchor="middle" fontSize={11} fill={text}>{c}</text>);
    });
    const barSeries = m.series.filter((s) => !s.type || s.type === 'bar' || (kind === 'bar' && !s.type));
    const drawBars = kind === 'bar';
    const gap = (m.gapWidth ?? 150) / 100;
    const nBars = stacked ? 1 : Math.max(1, barSeries.length);
    const barW = band / (nBars + gap);
    const acc = new Array(nCat).fill(0).map(() => ({ pos: 0, neg: 0 }));
    if (drawBars) {
      barSeries.forEach((s, si) => {
        const col = colorOf(s, m.series.indexOf(s));
        for (let i = 0; i < nCat; i++) {
          let v = val(s, i);
          if (percent) v = totals[i]! ? (Math.abs(v) / totals[i]!) * 100 : 0;
          let base = 0;
          if (stacked) {
            if (v >= 0) ((base = acc[i]!.pos), (acc[i]!.pos += v));
            else ((base = acc[i]!.neg), (acc[i]!.neg += v));
          }
          const a = V(Math.min(base, base + v));
          const b = V(Math.max(base, base + v));
          const off = stacked ? (band - barW) / 2 : (band - barW * nBars) / 2 + barW * si;
          const pcol = colorOf(s, m.series.indexOf(s), m.varyColors && m.series.length === 1 ? i : undefined);
          if (horizontal) body.push(<rect key={`${si}-${i}`} x={px + a} y={py + ph - band * (i + 1) + off} width={Math.max(0, b - a)} height={barW} fill={m.varyColors && m.series.length === 1 ? pcol : col} />);
          else body.push(<rect key={`${si}-${i}`} x={Cx(i) + off} y={py + ph - b} width={barW} height={Math.max(0, b - a)} fill={m.varyColors && m.series.length === 1 ? pcol : col} />);
          if (s.labels?.value) body.push(<text key={`v${si}-${i}`} x={horizontal ? px + b + 3 : Cx(i) + off + barW / 2} y={horizontal ? py + ph - band * (i + 1) + off + barW / 2 : py + ph - b - 4} textAnchor={horizontal ? 'start' : 'middle'} dominantBaseline={horizontal ? 'middle' : 'auto'} fontSize={10} fill={text}>{fmtNum(val(s, i))}</text>);
        }
      });
    }
    // lines and areas (also the lines of a combo chart)
    m.series.forEach((s, si) => {
      const isLine = (kind === 'line' || kind === 'stock') && !s.type ? true : s.type === 'line';
      const isArea = kind === 'area' && !s.type ? true : s.type === 'area';
      if (!isLine && !isArea) return;
      const col = colorOf(s, si);
      const pts = s.values.map((v, i) => [Cx(i) + band / 2, py + ph - V(v ?? 0)] as const);
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join('');
      if (isArea) body.push(<path key={`a${si}`} d={`${d}L${pts[pts.length - 1]?.[0] ?? 0} ${py + ph - V(0)}L${pts[0]?.[0] ?? 0} ${py + ph - V(0)}Z`} fill={col} fillOpacity={0.7} />);
      else {
        body.push(<path key={`l${si}`} d={d} fill="none" stroke={col} strokeWidth={s.ln?.w ?? 2.25} strokeLinejoin="round" />);
        if (s.marker?.symbol !== 'none') for (const [i, p] of pts.entries()) body.push(<circle key={`m${si}-${i}`} cx={p[0]} cy={p[1]} r={3.5} fill={col} />);
      }
    });
    body.push(<line key="axis" x1={px} x2={px + pw} y1={py + ph} y2={py + ph} stroke={grid} strokeWidth={1.5} />);
  }
  return (
    <div className="sl-el sl-chart" data-id={el.id} style={{ position: 'absolute', left: x.x, top: x.y, width: w, height: h }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fontFamily="Calibri, 'Segoe UI', sans-serif">
        {title && (
          <text x={w / 2} y={22} textAnchor="middle" fontSize={16} fill={text}>
            {title}
          </text>
        )}
        {body}
        {legendOn &&
          legendItems.map((l, i) => {
            const right = m.legend === 'r' || m.legend === 'tr' || m.legend === 'l';
            const lx = right ? w - padR + 12 : px + (pw / Math.max(1, legendItems.length)) * i + 4;
            const ly = right ? py + 8 + i * 18 : m.legend === 't' ? 30 : h - 12;
            return (
              <g key={i}>
                <rect x={lx} y={ly - 8} width={10} height={10} fill={l.color} />
                <text x={lx + 14} y={ly} dominantBaseline="middle" fontSize={11} fill={text}>
                  {l.name}
                </text>
              </g>
            );
          })}
      </svg>
    </div>
  );
}
