import { newId, type Stroke } from './model';
import { segments, strokeBounds, type Rect } from './ink';

/*
 * Más herramientas de tinta: lazo, borrador de puntos, cambiar el aspecto de varios trazos, escalar, regla y reproducción.
 * Funciones puras sobre listas de trazos.
 */

export type Pt = [number, number];

const r1 = (n: number) => Math.round(n * 10) / 10;

/** ¿Está el punto dentro del polígono (regla par-impar)? */
export function pointInPolygon(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2]!;
    const yi = poly[i * 2 + 1]!;
    const xj = poly[j * 2]!;
    const yj = poly[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Los puntos que representan un trazo para el lazo: los puntos del trazo o, en una forma, sus segmentos muestreados. */
function samplePoints(s: Stroke): Pt[] {
  const out: Pt[] = [];
  for (const [ax, ay, bx, by] of segments(s)) {
    out.push([ax, ay]);
    out.push([(ax + bx) / 2, (ay + by) / 2]);
  }
  if (!out.length && s.pts.length >= 2) out.push([s.pts[0]!, s.pts[1]!]);
  return out;
}

/** Los trazos que el lazo rodea: los que tienen al menos la mitad de sus puntos dentro del dibujo libre del lazo. */
export function strokesInLasso(ink: Stroke[], poly: number[]): Stroke[] {
  if (poly.length < 6) return [];
  const lb = polyBounds(poly);
  return ink.filter((s) => {
    const b = strokeBounds(s);
    if (b.x2 < lb.x1 || b.x1 > lb.x2 || b.y2 < lb.y1 || b.y1 > lb.y2) return false;
    const pts = samplePoints(s);
    const inside = pts.filter(([x, y]) => pointInPolygon(x, y, poly)).length;
    return inside * 2 >= pts.length;
  });
}

function polyBounds(poly: number[]): Rect {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    x1 = Math.min(x1, poly[i]!);
    x2 = Math.max(x2, poly[i]!);
    y1 = Math.min(y1, poly[i + 1]!);
    y2 = Math.max(y2, poly[i + 1]!);
  }
  return { x1, y1, x2, y2 };
}

/**
 * Borrador de puntos: quita solo el trozo del trazo que toca la goma y deja el resto (un trazo de lápiz o de marcador puede
 * partirse en dos). Las formas (línea, rectángulo, elipse, flecha) se quitan enteras: no tienen «trozos».
 */
export function erasePoint(ink: Stroke[], x: number, y: number, r: number): Stroke[] {
  let changed = false;
  const out: Stroke[] = [];
  for (const s of ink) {
    const b = strokeBounds(s);
    const reach = r + s.width / 2;
    if (x < b.x1 - reach || x > b.x2 + reach || y < b.y1 - reach || y > b.y2 + reach) {
      out.push(s);
      continue;
    }
    if (s.tool !== 'pen' && s.tool !== 'highlighter') {
      if (segments(s).some(([ax, ay, bx, by]) => segDist(x, y, ax, ay, bx, by) <= reach)) changed = true;
      else out.push(s);
      continue;
    }
    // la goma cubre una lista de puntos; los trozos que quedan entre ellos son trazos nuevos
    const pts = s.pts;
    const n = pts.length / 2;
    // un punto está «borrado» si la goma lo toca, o si toca el segmento que lo une con el siguiente
    const hit: boolean[] = [];
    for (let i = 0; i < n; i++) {
      const px = pts[i * 2]!;
      const py = pts[i * 2 + 1]!;
      hit.push(Math.hypot(px - x, py - y) <= reach);
    }
    for (let i = 0; i + 1 < n; i++) {
      if (!hit[i] && !hit[i + 1] && segDist(x, y, pts[i * 2]!, pts[i * 2 + 1]!, pts[i * 2 + 2]!, pts[i * 2 + 3]!) <= reach) {
        // la goma cruza el segmento entre dos puntos sanos: se corta por el más cercano
        const d1 = Math.hypot(pts[i * 2]! - x, pts[i * 2 + 1]! - y);
        const d2 = Math.hypot(pts[i * 2 + 2]! - x, pts[i * 2 + 3]! - y);
        hit[d1 <= d2 ? i : i + 1] = true;
      }
    }
    if (!hit.some(Boolean)) {
      out.push(s);
      continue;
    }
    changed = true;
    let run: number[] = [];
    let first = true;
    const flush = () => {
      if (run.length >= 4) out.push({ ...s, id: first ? s.id : newId('k'), pts: run });
      else if (run.length === 2 && s.tool === 'pen') out.push({ ...s, id: first ? s.id : newId('k'), pts: run });
      if (run.length >= 2) first = false;
      run = [];
    };
    for (let i = 0; i < n; i++) {
      if (hit[i]) flush();
      else run.push(pts[i * 2]!, pts[i * 2 + 1]!);
    }
    flush();
  }
  return changed ? out : ink;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Cambia el color y/o el grosor de unos trazos. El marcador conserva su transparencia. */
export function restyleStrokes(ink: Stroke[], ids: string[], patch: { color?: string; width?: number }): Stroke[] {
  return ink.map((s) => (ids.includes(s.id) ? { ...s, color: patch.color ?? s.color, width: patch.width ?? s.width } : s));
}

/** Escala unos trazos respecto del punto (ox, oy). */
export function scaleStrokes(ink: Stroke[], ids: string[], sx: number, sy: number, ox: number, oy: number): Stroke[] {
  const fx = Math.max(0.05, Math.min(20, sx));
  const fy = Math.max(0.05, Math.min(20, sy));
  return ink.map((s) => (ids.includes(s.id) ? { ...s, pts: s.pts.map((v, i) => r1(i % 2 === 0 ? ox + (v - ox) * fx : oy + (v - oy) * fy)) } : s));
}

/** El rectángulo que ocupan unos trazos (null si no hay ninguno). */
export function boundsOf(ink: Stroke[], ids: string[]): Rect | null {
  const sel = ink.filter((s) => ids.includes(s.id));
  if (!sel.length) return null;
  const bs = sel.map(strokeBounds);
  return { x1: Math.min(...bs.map((b) => b.x1)), y1: Math.min(...bs.map((b) => b.y1)), x2: Math.max(...bs.map((b) => b.x2)), y2: Math.max(...bs.map((b) => b.y2)) };
}

/** Copia unos trazos, desplazados, con identificadores nuevos (copiar y pegar tinta). */
export function duplicateStrokes(ink: Stroke[], ids: string[], dx = 24, dy = 24): Stroke[] {
  return ink.filter((s) => ids.includes(s.id)).map((s) => ({ ...s, id: newId('k'), pts: s.pts.map((v, i) => r1(v + (i % 2 === 0 ? dx : dy))) }));
}

// ------------------------------------------------------------------ regla

/** Una regla sobre la página: un punto de partida, un ángulo (grados) y una longitud. */
export interface Ruler {
  x: number;
  y: number;
  angle: number;
  len: number;
}

export const DEFAULT_RULER: Ruler = { x: 120, y: 200, angle: 0, len: 600 };

/** Proyecta un punto sobre la recta de la regla: devuelve la posición a lo largo de ella (0 a `len`) y la distancia a la recta. */
export function projectOnRuler(r: Ruler, x: number, y: number): { along: number; dist: number } {
  const a = (r.angle * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const dx = x - r.x;
  const dy = y - r.y;
  return { along: dx * ux + dy * uy, dist: Math.abs(-dx * uy + dy * ux) };
}

/**
 * Un trazo hecho junto a la regla: si empieza y acaba a menos de `tol` de su borde, queda como un segmento recto sobre ella;
 * si no, devuelve null (se deja el trazo libre).
 */
export function snapToRuler(r: Ruler, pts: number[], tol = 28): number[] | null {
  if (pts.length < 4) return null;
  const a = (r.angle * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const ps: { along: number; dist: number }[] = [];
  for (let i = 0; i < pts.length; i += 2) ps.push(projectOnRuler(r, pts[i]!, pts[i + 1]!));
  if (ps.some((p) => p.dist > tol)) return null;
  const clamp = (v: number) => Math.max(0, Math.min(r.len, v));
  const s = clamp(ps[0]!.along);
  const e = clamp(ps[ps.length - 1]!.along);
  if (Math.abs(e - s) < 4) return null;
  return [r1(r.x + ux * s), r1(r.y + uy * s), r1(r.x + ux * e), r1(r.y + uy * e)];
}

// ------------------------------------------------------------------ reproducción

/** Los trazos que se ven tras `frac` (0 a 1) de la reproducción: los completos y, el último, a medias. El orden es el del dibujo. */
export function replayAt(ink: Stroke[], frac: number): Stroke[] {
  const f = Math.max(0, Math.min(1, frac));
  const total = ink.reduce((n, s) => n + weight(s), 0);
  if (!total) return [];
  let left = f * total;
  const out: Stroke[] = [];
  for (const s of ink) {
    const w = weight(s);
    if (left >= w) {
      out.push(s);
      left -= w;
      continue;
    }
    if (left > 0 && (s.tool === 'pen' || s.tool === 'highlighter')) {
      const n = s.pts.length / 2;
      const keep = Math.max(1, Math.floor((left / w) * n));
      out.push({ ...s, pts: s.pts.slice(0, keep * 2 < 2 ? 2 : keep * 2) });
    }
    break;
  }
  return out;
}

/** Lo que «pesa» un trazo en la reproducción: sus puntos (una forma pesa como diez puntos). */
const weight = (s: Stroke): number => (s.tool === 'pen' || s.tool === 'highlighter' ? Math.max(1, s.pts.length / 2) : 10);

// ------------------------------------------------------------------ tinta a texto

/** El SVG de unos trazos sobre fondo blanco, con un margen, para leerlo como imagen (OCR). `scale` agranda el dibujo. */
export function strokesToSvg(ink: Stroke[], pad = 16, scale = 1): { svg: string; width: number; height: number } | null {
  if (!ink.length) return null;
  const bs = ink.map(strokeBounds);
  const x1 = Math.min(...bs.map((b) => b.x1)) - pad;
  const y1 = Math.min(...bs.map((b) => b.y1)) - pad;
  const x2 = Math.max(...bs.map((b) => b.x2)) + pad;
  const y2 = Math.max(...bs.map((b) => b.y2)) + pad;
  const w = Math.max(1, Math.ceil((x2 - x1) * scale));
  const h = Math.max(1, Math.ceil((y2 - y1) * scale));
  const paths = ink
    .map((s) => {
      const d = s.tool === 'pen' || s.tool === 'highlighter' ? pathOf(s.pts) : shapePath(s);
      const fill = s.tool === 'rect' || s.tool === 'ellipse' ? 'none' : 'none';
      return `<path d="${d}" fill="${fill}" stroke="#000" stroke-width="${Math.max(2, s.width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${r1(x1)} ${r1(y1)} ${r1(x2 - x1)} ${r1(y2 - y1)}"><rect x="${r1(x1)}" y="${r1(y1)}" width="${r1(x2 - x1)}" height="${r1(y2 - y1)}" fill="#fff"/>${paths}</svg>`;
  return { svg, width: w, height: h };
}

function pathOf(pts: number[]): string {
  if (pts.length === 2) return `M${r1(pts[0]!)} ${r1(pts[1]!)}h0.1`;
  let d = `M${r1(pts[0]!)} ${r1(pts[1]!)}`;
  for (let i = 2; i < pts.length; i += 2) d += `L${r1(pts[i]!)} ${r1(pts[i + 1]!)}`;
  return d;
}

function shapePath(s: Stroke): string {
  const [a, b, c, d] = s.pts as [number, number, number, number];
  if (s.tool === 'rect') return `M${a} ${b}L${c} ${b}L${c} ${d}L${a} ${d}Z`;
  if (s.tool === 'ellipse') {
    const cx = (a + c) / 2;
    const cy = (b + d) / 2;
    const rx = Math.abs(c - a) / 2;
    const ry = Math.abs(d - b) / 2;
    return `M${r1(cx - rx)} ${r1(cy)}a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(rx * 2)} 0a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(-rx * 2)} 0`;
  }
  return `M${a} ${b}L${c} ${d}`;
}

/** Los trazos de lápiz que forman «líneas de escritura»: agrupa por cercanía vertical para leerlas de arriba abajo. */
export function groupIntoLines(ink: Stroke[]): Stroke[][] {
  const pens = ink.filter((s) => s.tool === 'pen').sort((a, b) => strokeBounds(a).y1 - strokeBounds(b).y1);
  const lines: { y1: number; y2: number; items: Stroke[] }[] = [];
  for (const s of pens) {
    const b = strokeBounds(s);
    const mid = (b.y1 + b.y2) / 2;
    const line = lines.find((l) => mid >= l.y1 - 4 && mid <= l.y2 + 4);
    if (line) {
      line.items.push(s);
      line.y1 = Math.min(line.y1, b.y1);
      line.y2 = Math.max(line.y2, b.y2);
    } else lines.push({ y1: b.y1, y2: b.y2, items: [s] });
  }
  return lines.map((l) => l.items.sort((a, b) => strokeBounds(a).x1 - strokeBounds(b).x1));
}
