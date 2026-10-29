import type { CustPath, Geometry } from '../types';
import { arcSegments, presetGeometry, type PresetGeometry, type PresetPath } from './preset';

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

/** SVG path data of a custom geometry (`a:custGeom`) scaled to a shape of w × h points. */
export function customPaths(paths: CustPath[], w: number, h: number): PresetPath[] {
  return paths.map((p) => {
    const sx = p.w ? w / p.w : 1;
    const sy = p.h ? h / p.h : 1;
    let d = '';
    let cx = 0;
    let cy = 0;
    for (const c of p.cmds) {
      if (c[0] === 'M' || c[0] === 'L') {
        cx = c[1] * sx;
        cy = c[2] * sy;
        d += `${c[0]}${f(cx)} ${f(cy)}`;
      } else if (c[0] === 'Q') {
        cx = c[3] * sx;
        cy = c[4] * sy;
        d += `Q${f(c[1] * sx)} ${f(c[2] * sy)} ${f(cx)} ${f(cy)}`;
      } else if (c[0] === 'C') {
        cx = c[5] * sx;
        cy = c[6] * sy;
        d += `C${f(c[1] * sx)} ${f(c[2] * sy)} ${f(c[3] * sx)} ${f(c[4] * sy)} ${f(cx)} ${f(cy)}`;
      } else if (c[0] === 'A') {
        const a = arcSegments(cx, cy, c[1] * sx, c[2] * sy, c[3] * 60000, c[4] * 60000);
        d += a.d;
        cx = a.x;
        cy = a.y;
      } else d += 'Z';
    }
    return { d, fill: p.fill ?? 'norm', stroke: p.stroke !== false };
  });
}

/** Geometry of any shape: preset or custom. Unknown presets fall back to a rectangle. */
export function geometryOf(g: Geometry | undefined, w: number, h: number): PresetGeometry {
  if (g && 'cust' in g) {
    const r = g.rect;
    const tok = (s: string, full: number): number => {
      const n = Number(s);
      if (!Number.isNaN(n)) return n / 12700;
      return s === 'r' || s === 'b' ? full : s === 'hc' || s === 'vc' ? full / 2 : 0;
    };
    return { paths: customPaths(g.cust, w, h), textRect: r ? { l: tok(r.l, w), t: tok(r.t, h), r: tok(r.r, w), b: tok(r.b, h) } : { l: 0, t: 0, r: w, b: h }, sites: [], handles: [] };
  }
  const prst = g?.prst ?? 'rect';
  return presetGeometry(prst, w, h, g?.adj) ?? presetGeometry('rect', w, h)!;
}
