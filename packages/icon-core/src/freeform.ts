// An icon as a freeform shape (Office's «Convertir en forma»): the SVG paths turned into the commands of a custom geometry (`a:custGeom`) with whole-number
// coordinates. Arcs become cubic curves, so the shape only needs move, line, curve and close, which every product that draws custom geometry understands.
import { parseIconSvg } from './svg';

export type FreeCmd = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Q', number, number, number, number] | ['Z'];

/** One path of a freeform, in a `w` × `h` space of whole numbers (the `a:path` of a custom geometry). */
export interface FreePath {
  w: number;
  h: number;
  cmds: FreeCmd[];
}

const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;

/** The commands (absolute) of SVG path data. Returns null when the data cannot be read. */
export function svgPathToCmds(d: string): FreeCmd[] | null {
  const out: FreeCmd[] = [];
  let i = 0;
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let lastC: [number, number] | null = null; // last cubic control point (for S)
  let lastQ: [number, number] | null = null; // last quadratic control point (for T)
  const ws = () => { while (i < d.length && /[\s,]/.test(d[i]!)) i++; };
  const num = (): number | null => {
    ws();
    NUM.lastIndex = i;
    const m = NUM.exec(d);
    if (!m) return null;
    i = NUM.lastIndex;
    return Number(m[0]);
  };
  const flag = (): number | null => {
    ws();
    const c = d[i];
    if (c !== '0' && c !== '1') return null;
    i++;
    return Number(c);
  };
  let cmd = '';
  for (;;) {
    ws();
    if (i >= d.length) break;
    const c = d[i]!;
    if (/[A-Za-z]/.test(c)) { cmd = c; i++; if (cmd === 'Z' || cmd === 'z') { out.push(['Z']); cx = sx; cy = sy; lastC = lastQ = null; continue; } } else if (!cmd) return null;
    else if (cmd === 'Z' || cmd === 'z') return null;
    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    const need = (n: number): number[] | null => { const v: number[] = []; for (let k = 0; k < n; k++) { const x = num(); if (x === null) return null; v.push(x); } return v; };
    if (up === 'M') {
      const v = need(2); if (!v) return null;
      cx = ox + v[0]!; cy = oy + v[1]!; sx = cx; sy = cy;
      out.push(['M', cx, cy]);
      cmd = rel ? 'l' : 'L'; // the pairs that follow a moveto are linetos
      lastC = lastQ = null;
    } else if (up === 'L') {
      const v = need(2); if (!v) return null;
      cx = ox + v[0]!; cy = oy + v[1]!; out.push(['L', cx, cy]); lastC = lastQ = null;
    } else if (up === 'H') {
      const v = need(1); if (!v) return null;
      cx = (rel ? cx : 0) + v[0]!; out.push(['L', cx, cy]); lastC = lastQ = null;
    } else if (up === 'V') {
      const v = need(1); if (!v) return null;
      cy = (rel ? cy : 0) + v[0]!; out.push(['L', cx, cy]); lastC = lastQ = null;
    } else if (up === 'C') {
      const v = need(6); if (!v) return null;
      const p: [number, number, number, number, number, number] = [ox + v[0]!, oy + v[1]!, ox + v[2]!, oy + v[3]!, ox + v[4]!, oy + v[5]!];
      out.push(['C', ...p]); lastC = [p[2], p[3]]; lastQ = null; cx = p[4]; cy = p[5];
    } else if (up === 'S') {
      const v = need(4); if (!v) return null;
      const r: [number, number] = lastC ? [2 * cx - lastC[0], 2 * cy - lastC[1]] : [cx, cy];
      const p: [number, number, number, number, number, number] = [r[0], r[1], ox + v[0]!, oy + v[1]!, ox + v[2]!, oy + v[3]!];
      out.push(['C', ...p]); lastC = [p[2], p[3]]; lastQ = null; cx = p[4]; cy = p[5];
    } else if (up === 'Q') {
      const v = need(4); if (!v) return null;
      const p: [number, number, number, number] = [ox + v[0]!, oy + v[1]!, ox + v[2]!, oy + v[3]!];
      out.push(['Q', ...p]); lastQ = [p[0], p[1]]; lastC = null; cx = p[2]; cy = p[3];
    } else if (up === 'T') {
      const v = need(2); if (!v) return null;
      const r: [number, number] = lastQ ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy];
      const p: [number, number, number, number] = [r[0], r[1], ox + v[0]!, oy + v[1]!];
      out.push(['Q', ...p]); lastQ = [p[0], p[1]]; lastC = null; cx = p[2]; cy = p[3];
    } else if (up === 'A') {
      const a = need(3); if (!a) return null;
      const fa = flag(); const fs = flag(); if (fa === null || fs === null) return null;
      const e = need(2); if (!e) return null;
      const x = ox + e[0]!, y = oy + e[1]!;
      for (const seg of arcToCubics(cx, cy, a[0]!, a[1]!, a[2]!, fa, fs, x, y)) out.push(seg);
      cx = x; cy = y; lastC = lastQ = null;
    } else return null;
  }
  return out;
}

/** An SVG elliptical arc as cubic curves (endpoint to center conversion of the SVG specification, split in pieces of at most 90°). */
function arcToCubics(x1: number, y1: number, rx: number, ry: number, rot: number, fa: number, fs: number, x2: number, y2: number): FreeCmd[] {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return [['L', x2, y2]];
  const phi = (rot * Math.PI) / 180;
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dth > 0) dth -= 2 * Math.PI;
  else if (fs && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
  const step = dth / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: FreeCmd[] = [];
  let a0 = th1;
  const pt = (a: number): [number, number] => [cp * rx * Math.cos(a) - sp * ry * Math.sin(a) + cx, sp * rx * Math.cos(a) + cp * ry * Math.sin(a) + cy];
  const dv = (a: number): [number, number] => [-cp * rx * Math.sin(a) - sp * ry * Math.cos(a), -sp * rx * Math.sin(a) + cp * ry * Math.cos(a)];
  for (let s = 0; s < n; s++) {
    const a1 = a0 + step;
    const p0 = pt(a0), p3 = pt(a1);
    const d0 = dv(a0), d1 = dv(a1);
    out.push(['C', p0[0] + k * d0[0], p0[1] + k * d0[1], p3[0] - k * d1[0], p3[1] - k * d1[1], s === n - 1 ? x2 : p3[0], s === n - 1 ? y2 : p3[1]]);
    a0 = a1;
  }
  return out;
}

export interface Freeform {
  /** The paths of the icon (one `a:path` each), in whole numbers of a square `w` × `h`. */
  paths: FreePath[];
  /** Fill color, or null (no fill). */
  fill: string | null;
  opacity: number;
  stroke: { color: string; width: number } | null;
  /** Side of the icon's own square (24 for most), the unit of `stroke.width`. */
  size: number;
}

/** Resolution of the whole-number space of a freeform (the viewBox side times this). */
export const FREEFORM_SCALE = 1000;

/** An icon SVG of this gallery as a freeform (null when it cannot be read). */
export function svgToFreeform(svg: string): Freeform | null {
  const p = parseIconSvg(svg);
  if (!p) return null;
  const side = Math.round(p.size * FREEFORM_SCALE);
  const paths: FreePath[] = [];
  for (const d of p.d) {
    const cmds = svgPathToCmds(d);
    if (!cmds || !cmds.length) return null;
    paths.push({ w: side, h: side, cmds: cmds.map((c) => c.map((v, i) => (i === 0 ? v : Math.round((v as number) * FREEFORM_SCALE))) as unknown as FreeCmd) });
  }
  return { paths, fill: p.fill, opacity: p.opacity, stroke: p.stroke, size: p.size };
}
