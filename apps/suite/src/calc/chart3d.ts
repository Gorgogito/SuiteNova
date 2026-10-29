import type { Chart3D, ChartType } from '@suitenova/calc-engine';

export interface Series3D {
  name: string;
  values: (number | null)[];
  color: string;
}

export interface Chart3DInput {
  type: ChartType;
  threeD: Chart3D;
  categories: string[];
  series: Series3D[];
  title?: string;
  legend: boolean;
  stacked?: boolean;
  percent?: boolean;
  surface?: { wireframe?: boolean; contour?: boolean };
  width: number;
  height: number;
  text: string;
  grid: string;
  bg: string;
  /** Number format for the value labels (default: compact general). */
  fmt?: (n: number) => string;
}

type V3 = [number, number, number];

interface Poly {
  pts: V3[];
  fill: string;
  stroke?: string;
  opacity?: number;
  /** For ordering: explicit depth bias added to the mean depth. */
  bias?: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

// ---- colour helpers
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (c: number) => Math.round(Math.max(0, Math.min(255, t >= 0 ? c + (255 - c) * t : c * (1 + t))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** 1-2-5 ticks from 0 (or the minimum) up to a rounded maximum. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min)) max = min + 1;
  const raw = (max - min) / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 1e6; v += step) out.push(Math.round(v / step) * step);
  return out;
}

const defaultFmt = (n: number): string => {
  if (Math.abs(n) >= 1e9) return `${+(n / 1e9).toFixed(2)}G`;
  if (Math.abs(n) >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e4) return `${+(n / 1e3).toFixed(1)}k`;
  return String(+n.toFixed(4));
};

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));

/** Colour for a value band of a surface chart (blue to red through green and yellow). */
export function bandColor(i: number, n: number): string {
  const stops: [number, number, number][] = [[59, 76, 192], [70, 160, 220], [90, 190, 130], [240, 220, 80], [240, 150, 60], [200, 50, 50]];
  const t = n <= 1 ? 0 : i / (n - 1);
  const x = t * (stops.length - 1);
  const k = Math.min(stops.length - 2, Math.floor(x));
  const f = x - k;
  const a = stops[k]!;
  const b = stops[k + 1]!;
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

class Scene {
  polys: Poly[] = [];
  labels: { p: V3; text: string; anchor: 'start' | 'middle' | 'end'; dy?: number; size?: number }[] = [];
  lines: { a: V3; b: V3; color: string; width?: number; dash?: string }[] = [];

  constructor(
    private rotX: number,
    private rotY: number,
    private perspective: number,
    private rightAngle: boolean,
  ) {}

  /** World -> view space. World: x right, y up, z away from the viewer (depth), all roughly in [0, size]. */
  private view(p: V3): { x: number; y: number; z: number } {
    const [x, y, z] = p;
    if (this.rightAngle) {
      // oblique: the front plane is not rotated; depth runs up and to the right
      const ox = Math.sin(rad(Math.min(44, Math.max(0, this.rotY)))) * 0.9;
      const oy = Math.sin(rad(Math.min(60, Math.max(0, this.rotX)))) * 0.9;
      return { x: x + z * ox, y: y + z * oy, z: -z };
    }
    const th = rad(this.rotY);
    const ph = rad(this.rotX);
    const x1 = x * Math.cos(th) + z * Math.sin(th);
    const z1 = -x * Math.sin(th) + z * Math.cos(th);
    const y2 = y * Math.cos(ph) - z1 * Math.sin(ph);
    const z2 = y * Math.sin(ph) + z1 * Math.cos(ph);
    const k = (this.perspective / 100) * 0.6;
    const s = k > 0 ? 1 / Math.max(0.3, 1 - k * z2) : 1;
    return { x: x1 * s, y: y2 * s, z: z2 };
  }

  project(p: V3): { x: number; y: number; z: number } {
    return this.view(p);
  }

  box(x1: number, x2: number, y1: number, y2: number, z1: number, z2: number, color: string, stroke = true): void {
    const c = (x: number, y: number, z: number): V3 => [x, y, z];
    const st = stroke ? shade(color, -0.4) : undefined;
    const face = (pts: V3[], t: number) => this.polys.push({ pts, fill: shade(color, t), stroke: st });
    face([c(x1, y1, z1), c(x2, y1, z1), c(x2, y2, z1), c(x1, y2, z1)], 0); // front
    face([c(x1, y1, z2), c(x2, y1, z2), c(x2, y2, z2), c(x1, y2, z2)], -0.3); // back
    face([c(x1, y2, z1), c(x2, y2, z1), c(x2, y2, z2), c(x1, y2, z2)], 0.22); // top
    face([c(x1, y1, z1), c(x1, y2, z1), c(x1, y2, z2), c(x1, y1, z2)], -0.15); // left
    face([c(x2, y1, z1), c(x2, y2, z1), c(x2, y2, z2), c(x2, y1, z2)], -0.18); // right
  }

  /** Painted back to front; `fit` scales the drawing into a rectangle. */
  svg(w: number, h: number, area: { x: number; y: number; w: number; h: number }, text: string): string {
    const all: { x: number; y: number }[] = [];
    const proj = (p: V3) => this.project(p);
    const polyPts = this.polys.map((p) => p.pts.map(proj));
    for (const pts of polyPts) all.push(...pts);
    for (const l of this.lines) all.push(proj(l.a), proj(l.b));
    for (const l of this.labels) all.push(proj(l.p));
    if (!all.length) return '';
    const minX = Math.min(...all.map((p) => p.x));
    const maxX = Math.max(...all.map((p) => p.x));
    const minY = Math.min(...all.map((p) => p.y));
    const maxY = Math.max(...all.map((p) => p.y));
    const sc = Math.min(area.w / Math.max(1e-6, maxX - minX), area.h / Math.max(1e-6, maxY - minY));
    const ox = area.x + (area.w - (maxX - minX) * sc) / 2 - minX * sc;
    const oy = area.y + (area.h - (maxY - minY) * sc) / 2 + maxY * sc;
    const sx = (p: { x: number }) => (p.x * sc + ox).toFixed(1);
    const sy = (p: { y: number }) => (oy - p.y * sc).toFixed(1);
    const parts: string[] = [];
    const order = this.polys
      .map((p, i) => ({ p, pts: polyPts[i]!, depth: polyPts[i]!.reduce((a, q) => a + q.z, 0) / p.pts.length + (p.bias ?? 0) }))
      .sort((a, b) => a.depth - b.depth);
    // lines (grid) belong to the walls: drawn after the walls and before the data, i.e. in order of bias; simple approach: first
    for (const l of this.lines) {
      const a = proj(l.a);
      const b = proj(l.b);
      parts.push(`<line x1="${sx(a)}" y1="${sy(a)}" x2="${sx(b)}" y2="${sy(b)}" stroke="${l.color}" stroke-width="${l.width ?? 1}"${l.dash ? ` stroke-dasharray="${l.dash}"` : ''}/>`);
    }
    for (const o of order) {
      const pts = o.pts.map((q) => `${sx(q)},${sy(q)}`).join(' ');
      parts.push(`<polygon points="${pts}" fill="${o.p.fill}"${o.p.stroke ? ` stroke="${o.p.stroke}" stroke-width="0.8" stroke-linejoin="round"` : ' stroke="none"'}${o.p.opacity !== undefined ? ` fill-opacity="${o.p.opacity}"` : ''}/>`);
    }
    for (const l of this.labels) {
      const q = proj(l.p);
      parts.push(`<text x="${sx(q)}" y="${(Number(sy(q)) + (l.dy ?? 0)).toFixed(1)}" text-anchor="${l.anchor}" font-size="${l.size ?? 11}" fill="${text}">${esc(l.text)}</text>`);
    }
    void w;
    void h;
    return parts.join('');
  }
}

const FONT = "font-family=\"Calibri, Carlito, 'Segoe UI', sans-serif\"";

function frame(inp: Chart3DInput, body: string, legendItems: { name: string; color: string }[]): string {
  const { width, height, text, bg } = inp;
  const title = inp.title ? `<text x="${width / 2}" y="22" text-anchor="middle" font-size="15" font-weight="600" fill="${text}">${esc(inp.title)}</text>` : '';
  let legend = '';
  if (inp.legend && legendItems.length) {
    let x = 12;
    const y = height - 12;
    const items: string[] = [];
    for (const it of legendItems) {
      const w = 22 + it.name.length * 6.2;
      if (x + w > width - 8) break;
      items.push(`<rect x="${x}" y="${y - 9}" width="10" height="10" fill="${it.color}"/><text x="${x + 14}" y="${y}" font-size="11" fill="${text}">${esc(it.name)}</text>`);
      x += w;
    }
    // centre the legend row
    const total = x - 12;
    legend = `<g transform="translate(${Math.max(0, (width - total) / 2 - 12)},0)">${items.join('')}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ${FONT} role="img"${inp.title ? ` aria-label="${esc(inp.title)}"` : ''}><rect width="${width}" height="${height}" fill="${bg}"/>${title}${body}${legend}</svg>`;
}

/** The 3-D version of a chart (and surface charts) as an SVG picture. */
export function chart3dSvg(inp: Chart3DInput): string {
  if (inp.type === 'pie') return pie3d(inp);
  if (inp.type === 'surface') return surface(inp);
  return cartesian3d(inp);
}

// ------------------------------------------------------------------------------------------------ column, bar, line, area
function cartesian3d(inp: Chart3DInput): string {
  const { threeD: v, series, categories } = inp;
  const horizontal = inp.type === 'bar';
  const n = Math.max(1, ...series.map((s) => s.values.length));
  const m = series.length;
  const fmt = inp.fmt ?? defaultFmt;
  const stacked = !!inp.stacked;
  const depthSeries = !!v.seriesDepth && !stacked && m > 1;
  // value range
  let lo = 0;
  let hi = 0;
  if (stacked) {
    for (let i = 0; i < n; i++) {
      let pos = 0;
      let neg = 0;
      for (const s of series) {
        const x = s.values[i] ?? 0;
        if (x >= 0) pos += x;
        else neg += x;
      }
      if (inp.percent) {
        const tot = series.reduce((a, s) => a + Math.abs(s.values[i] ?? 0), 0) || 1;
        pos = pos / tot;
        neg = neg / tot;
      }
      hi = Math.max(hi, pos);
      lo = Math.min(lo, neg);
    }
  } else {
    for (const s of series) for (const x of s.values) if (x !== null) {
      hi = Math.max(hi, x);
      lo = Math.min(lo, x);
    }
  }
  if (inp.percent) hi = Math.max(hi, 1);
  const ticks = niceTicks(lo, hi === lo ? lo + 1 : hi);
  const vmin = ticks[0]!;
  const vmax = ticks[ticks.length - 1]!;
  const range = vmax - vmin || 1;

  // scene size: width 1, height 0.55, depth from the "depth" setting
  const W = 1;
  const H = 0.55;
  const D = Math.max(0.15, Math.min(1.2, (v.depth / 100) * 0.35 * (depthSeries ? Math.max(1, Math.min(m, 4)) / 2 : 1)));
  const sc = new Scene(v.rotX, v.rotY, v.perspective, v.rightAngle);
  // column mode: x = categories, y = values. Bar mode swaps them: x = values, y = categories (first at the top).
  const X = (cat: number) => (cat / n) * W;
  const Yv = (val: number) => ((val - vmin) / range) * H;
  const wallColor = inp.bg === '#ffffff' ? '#f1f1f1' : '#2d2d2d';
  const gridColor = inp.grid;

  // floor and walls
  const floor: V3[] = [[0, 0, 0], [W, 0, 0], [W, 0, D], [0, 0, D]];
  const back: V3[] = [[0, 0, D], [W, 0, D], [W, H, D], [0, H, D]];
  const side: V3[] = [[0, 0, 0], [0, 0, D], [0, H, D], [0, H, 0]];
  if (!horizontal) {
    sc.polys.push({ pts: floor, fill: wallColor, stroke: gridColor, bias: -10 }, { pts: back, fill: shade(wallColor, 0.35), stroke: gridColor, bias: -10 }, { pts: side, fill: shade(wallColor, 0.15), stroke: gridColor, bias: -10 });
    for (const tk of ticks) {
      const y = Yv(tk);
      sc.lines.push({ a: [0, y, D], b: [W, y, D], color: gridColor }, { a: [0, y, 0], b: [0, y, D], color: gridColor });
      sc.labels.push({ p: [0, y, 0], text: fmt(tk), anchor: 'end', dy: 4 });
    }
    categories.slice(0, n).forEach((c, i) => sc.labels.push({ p: [X(i + 0.5), 0, 0], text: c, anchor: 'middle', dy: 16 }));
    if (depthSeries) series.forEach((s, j) => sc.labels.push({ p: [W, 0, ((j + 0.5) / m) * D], text: s.name, anchor: 'start', dy: 12 }));
  } else {
    sc.polys.push({ pts: floor, fill: wallColor, stroke: gridColor, bias: -10 }, { pts: back, fill: shade(wallColor, 0.35), stroke: gridColor, bias: -10 }, { pts: side, fill: shade(wallColor, 0.15), stroke: gridColor, bias: -10 });
    for (const tk of ticks) {
      const x = ((tk - vmin) / range) * W;
      sc.lines.push({ a: [x, 0, D], b: [x, H, D], color: gridColor }, { a: [x, 0, 0], b: [x, 0, D], color: gridColor });
      sc.labels.push({ p: [x, 0, 0], text: fmt(tk), anchor: 'middle', dy: 16 });
    }
    categories.slice(0, n).forEach((c, i) => sc.labels.push({ p: [0, H - ((i + 0.5) / n) * H, 0], text: c, anchor: 'end', dy: 4 }));
  }

  const catPos = (i: number) => (horizontal ? H - ((i + 1) / n) * H : X(i));
  const catSize = horizontal ? H / n : W / n;
  const box = (cat: number, a: number, b: number, z1: number, z2: number, c: string, off = 0, size = 0.7) => {
    const u1 = catPos(cat) + (catSize * (1 - size)) / 2 + off;
    const u2 = u1 + catSize * size - off * 0 - (off ? 0 : 0);
    const lo2 = Math.min(a, b);
    const hi2 = Math.max(a, b);
    if (!horizontal) sc.box(u1, u1 + (u2 - u1), Yv(lo2), Yv(hi2), z1, z2, c);
    else sc.box(((lo2 - vmin) / range) * W, ((hi2 - vmin) / range) * W, u1, u1 + (u2 - u1), z1, z2, c);
  };

  if (inp.type === 'column' || inp.type === 'bar') {
    if (stacked) {
      for (let i = 0; i < n; i++) {
        const tot = inp.percent ? series.reduce((a, s) => a + Math.abs(s.values[i] ?? 0), 0) || 1 : 1;
        let pos = 0;
        let neg = 0;
        series.forEach((s) => {
          const raw = s.values[i];
          if (raw === null || raw === undefined) return;
          const x = inp.percent ? raw / tot : raw;
          const from = x >= 0 ? pos : neg;
          const to = from + x;
          if (x >= 0) pos = to;
          else neg = to;
          box(i, from, to, D * 0.15, D * 0.85, s.color);
        });
      }
    } else if (depthSeries) {
      series.forEach((s, j) => {
        const z1 = (j / m) * D + (D / m) * 0.15;
        const z2 = ((j + 1) / m) * D - (D / m) * 0.15;
        s.values.slice(0, n).forEach((x, i) => {
          if (x !== null) box(i, Math.max(vmin, 0), x, z1, z2, s.color);
        });
      });
    } else {
      const slot = (catSize * 0.8) / m;
      series.forEach((s, j) => {
        s.values.slice(0, n).forEach((x, i) => {
          if (x === null) return;
          const u1 = catPos(i) + catSize * 0.1 + slot * j;
          const lo2 = Math.min(Math.max(vmin, 0), x);
          const hi2 = Math.max(Math.max(vmin, 0), x);
          if (!horizontal) sc.box(u1, u1 + slot * 0.92, Yv(lo2), Yv(hi2), D * 0.2, D * 0.8, s.color);
          else sc.box(((lo2 - vmin) / range) * W, ((hi2 - vmin) / range) * W, u1, u1 + slot * 0.92, D * 0.2, D * 0.8, s.color);
        });
      });
    }
  } else if (inp.type === 'line') {
    series.forEach((s, j) => {
      const z1 = depthSeries || m > 1 ? (j / m) * D + (D / m) * 0.25 : D * 0.35;
      const z2 = depthSeries || m > 1 ? ((j + 1) / m) * D - (D / m) * 0.25 : D * 0.65;
      const run: { x: number; y: number }[] = [];
      s.values.slice(0, n).forEach((x, i) => run.push({ x: X(i + 0.5), y: Yv(x ?? 0) }));
      const thick = 0.025;
      for (let i = 0; i + 1 < run.length; i++) {
        const a = run[i]!;
        const b = run[i + 1]!;
        sc.polys.push({ pts: [[a.x, a.y, z1], [b.x, b.y, z1], [b.x, b.y, z2], [a.x, a.y, z2]], fill: shade(s.color, 0.2), stroke: shade(s.color, -0.35) });
        sc.polys.push({ pts: [[a.x, a.y - thick, z1], [b.x, b.y - thick, z1], [b.x, b.y, z1], [a.x, a.y, z1]], fill: s.color, stroke: shade(s.color, -0.35) });
      }
    });
  } else {
    // area
    const cum = new Array<number>(n).fill(0);
    series.forEach((s, j) => {
      const z1 = stacked ? D * 0.15 : (j / m) * D + (D / m) * 0.1;
      const z2 = stacked ? D * 0.85 : ((j + 1) / m) * D - (D / m) * 0.1;
      const top: { x: number; y: number }[] = [];
      const bottom: { x: number; y: number }[] = [];
      for (let i = 0; i < n; i++) {
        const x = s.values[i] ?? 0;
        const base = stacked ? cum[i]! : Math.max(0, vmin);
        const val = stacked ? base + (inp.percent ? x / (series.reduce((a, q) => a + Math.abs(q.values[i] ?? 0), 0) || 1) : x) : x;
        top.push({ x: X(i + 0.5), y: Yv(val) });
        bottom.push({ x: X(i + 0.5), y: Yv(base) });
        if (stacked) cum[i] = val;
      }
      for (let i = 0; i + 1 < top.length; i++) {
        const a = top[i]!;
        const b = top[i + 1]!;
        const a0 = bottom[i]!;
        const b0 = bottom[i + 1]!;
        sc.polys.push({ pts: [[a0.x, a0.y, z1], [b0.x, b0.y, z1], [b.x, b.y, z1], [a.x, a.y, z1]], fill: s.color, stroke: shade(s.color, -0.3) });
        sc.polys.push({ pts: [[a.x, a.y, z1], [b.x, b.y, z1], [b.x, b.y, z2], [a.x, a.y, z2]], fill: shade(s.color, 0.2), stroke: shade(s.color, -0.3) });
      }
      // side caps
      const f = top[0]!;
      const l = top[top.length - 1]!;
      sc.polys.push({ pts: [[f.x, bottom[0]!.y, z1], [f.x, f.y, z1], [f.x, f.y, z2], [f.x, bottom[0]!.y, z2]], fill: shade(s.color, -0.2), stroke: shade(s.color, -0.3) });
      sc.polys.push({ pts: [[l.x, bottom[bottom.length - 1]!.y, z1], [l.x, l.y, z1], [l.x, l.y, z2], [l.x, bottom[bottom.length - 1]!.y, z2]], fill: shade(s.color, -0.25), stroke: shade(s.color, -0.3) });
    });
  }

  const top = inp.title ? 34 : 12;
  const bottom = inp.legend ? 28 : 10;
  const body = sc.svg(inp.width, inp.height, { x: 56, y: top, w: inp.width - 86, h: inp.height - top - bottom - 18 }, inp.text);
  return frame(inp, body, series.map((s) => ({ name: s.name, color: s.color })));
}

// ------------------------------------------------------------------------------------------------ pie
function pie3d(inp: Chart3DInput): string {
  const s = inp.series[0];
  const data = (s?.values ?? []).map((x, i) => ({ v: Math.max(0, x ?? 0), name: inp.categories[i] ?? String(i + 1), color: inp.series[0]?.color ?? '#888' })).filter((d) => d.v > 0);
  const total = data.reduce((a, d) => a + d.v, 0);
  const { width, height, text } = inp;
  if (!total) return frame(inp, '', []);
  const top = inp.title ? 36 : 12;
  const bottom = inp.legend ? 34 : 12;
  const cx = width / 2;
  const availH = height - top - bottom;
  const rx = Math.min(width * 0.36, availH * 0.8);
  const tilt = Math.min(0.95, Math.max(0.2, Math.sin(rad(Math.max(10, Math.min(80, inp.threeD.rotX))))));
  const ry = rx * tilt;
  const thick = Math.min(rx * 0.25, 28) * (inp.threeD.depth / 100);
  const cy = top + (availH - thick) / 2;
  const palette = ['#3b82c4', '#e8833a', '#7a8b99', '#e0b030', '#4aa3a2', '#6aa84f', '#a463a0', '#d65a5a'];
  const rot = rad(((inp.threeD.rotY % 360) + 360) % 360);
  const parts: string[] = [];
  let angle = -Math.PI / 2 + rot;
  const slices = data.map((d, i) => {
    const a0 = angle;
    const a1 = angle + (d.v / total) * Math.PI * 2;
    angle = a1;
    return { ...d, a0, a1, color: palette[i % palette.length]! };
  });
  const pt = (a: number, dy = 0) => `${(cx + Math.cos(a) * rx).toFixed(1)},${(cy + Math.sin(a) * ry + dy).toFixed(1)}`;
  const arc = (a0: number, a1: number, dy = 0): string[] => {
    const steps = Math.max(2, Math.ceil((a1 - a0) / 0.08));
    return Array.from({ length: steps + 1 }, (_x, k) => pt(a0 + ((a1 - a0) * k) / steps, dy));
  };
  // outer walls: the visible half is the lower one (y grows downward)
  const walls = slices.flatMap((sl) => {
    const out: { a0: number; a1: number; color: string; mid: number }[] = [];
    // clip to the lower half-plane (sin > 0)
    const segs: [number, number][] = [];
    let a = sl.a0;
    while (a < sl.a1) {
      const k = Math.floor(a / Math.PI);
      const edge = Math.min(sl.a1, (k + 1) * Math.PI);
      if (k % 2 === 0) segs.push([a, edge]);
      a = edge;
    }
    for (const [x0, x1] of segs) out.push({ a0: x0, a1: x1, color: sl.color, mid: (x0 + x1) / 2 });
    return out;
  });
  walls.sort((p, q) => Math.abs(Math.cos(q.mid)) - Math.abs(Math.cos(p.mid)));
  for (const w of walls) {
    const upper = arc(w.a0, w.a1);
    const lower = arc(w.a0, w.a1, thick).reverse();
    parts.push(`<polygon points="${[...upper, ...lower].join(' ')}" fill="${shade(w.color, -0.3)}" stroke="${shade(w.color, -0.5)}" stroke-width="0.8"/>`);
  }
  for (const sl of slices) {
    const pts = [`${cx.toFixed(1)},${cy.toFixed(1)}`, ...arc(sl.a0, sl.a1)].join(' ');
    parts.push(`<polygon points="${pts}" fill="${sl.color}" stroke="${inp.bg}" stroke-width="1"/>`);
    const mid = (sl.a0 + sl.a1) / 2;
    const pct = `${Math.round((sl.v / total) * 100)}%`;
    parts.push(`<text x="${(cx + Math.cos(mid) * rx * 0.62).toFixed(1)}" y="${(cy + Math.sin(mid) * ry * 0.62 + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="#ffffff" stroke="rgba(0,0,0,0.35)" stroke-width="0.4">${pct}</text>`);
  }
  void text;
  return frame(inp, parts.join(''), slices.map((s2) => ({ name: s2.name, color: s2.color })));
}

// ------------------------------------------------------------------------------------------------ surface
function surface(inp: Chart3DInput): string {
  const { series, categories, threeD: v } = inp;
  const rows = Math.max(1, ...series.map((s) => s.values.length)); // categories (x)
  const cols = series.length; // series (z)
  const fmt = inp.fmt ?? defaultFmt;
  const all = series.flatMap((s) => s.values).filter((x): x is number => x !== null);
  if (!all.length || cols < 2 || rows < 2) return frame(inp, '', []);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(...all), 6);
  const vmin = ticks[0]!;
  const vmax = ticks[ticks.length - 1]!;
  const range = vmax - vmin || 1;
  const bands = ticks.length - 1;
  const bandOf = (val: number) => Math.min(bands - 1, Math.max(0, Math.floor(((val - vmin) / range) * bands)));
  const contour = !!inp.surface?.contour;
  const wire = !!inp.surface?.wireframe;
  const W = 1;
  const H = 0.55;
  const D = Math.max(0.25, Math.min(1.2, (v.depth / 100) * 0.7));
  const sc = new Scene(contour ? 90 : v.rotX, contour ? 0 : v.rotY, contour ? 0 : v.perspective, v.rightAngle && !contour);
  const X = (i: number) => (i / (rows - 1)) * W;
  const Z = (j: number) => (j / (cols - 1)) * D;
  const Y = (val: number) => ((val - vmin) / range) * H;
  const at = (i: number, j: number) => series[j]?.values[i] ?? vmin;
  const wallColor = inp.bg === '#ffffff' ? '#f1f1f1' : '#2d2d2d';
  if (!contour) {
    sc.polys.push({ pts: [[0, 0, 0], [W, 0, 0], [W, 0, D], [0, 0, D]], fill: wallColor, stroke: inp.grid, bias: -10 });
    sc.polys.push({ pts: [[0, 0, D], [W, 0, D], [W, H, D], [0, H, D]], fill: shade(wallColor, 0.35), stroke: inp.grid, bias: -10 });
    sc.polys.push({ pts: [[0, 0, 0], [0, 0, D], [0, H, D], [0, H, 0]], fill: shade(wallColor, 0.15), stroke: inp.grid, bias: -10 });
    for (const tk of ticks) {
      sc.lines.push({ a: [0, Y(tk), D], b: [W, Y(tk), D], color: inp.grid });
      sc.labels.push({ p: [0, Y(tk), 0], text: fmt(tk), anchor: 'end', dy: 4 });
    }
  }
  for (let i = 0; i + 1 < rows; i++) {
    for (let j = 0; j + 1 < cols; j++) {
      const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      const mean = q.reduce((a, b) => a + b, 0) / 4;
      const col = bandColor(bandOf(mean), bands);
      const pts: V3[] = contour
        ? [[X(i), 0, Z(j)], [X(i + 1), 0, Z(j)], [X(i + 1), 0, Z(j + 1)], [X(i), 0, Z(j + 1)]]
        : [[X(i), Y(q[0]!), Z(j)], [X(i + 1), Y(q[1]!), Z(j)], [X(i + 1), Y(q[2]!), Z(j + 1)], [X(i), Y(q[3]!), Z(j + 1)]];
      sc.polys.push({ pts, fill: wire ? inp.bg : col, stroke: wire ? shade(col, -0.2) : 'rgba(0,0,0,0.25)', opacity: wire ? 0.15 : 1 });
    }
  }
  categories.slice(0, rows).forEach((c, i) => sc.labels.push({ p: [X(i), 0, 0], text: c, anchor: 'middle', dy: 16 }));
  series.forEach((s, j) => sc.labels.push({ p: [W, 0, Z(j)], text: s.name, anchor: 'start', dy: 12 }));
  const top = inp.title ? 34 : 12;
  const bottom = inp.legend ? 28 : 10;
  const body = sc.svg(inp.width, inp.height, { x: 56, y: top, w: inp.width - 86, h: inp.height - top - bottom - 18 }, inp.text);
  const legend = ticks.slice(0, -1).map((tk, i) => ({ name: `${fmt(tk)}–${fmt(ticks[i + 1]!)}`, color: bandColor(i, bands) }));
  return frame(inp, body, legend);
}
