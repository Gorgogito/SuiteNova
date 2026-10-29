import { newId, type Stroke, type StrokeTool } from './model';

/** Tinta y dibujo: trazos a mano alzada y formas (línea, flecha, rectángulo, elipse) sobre el lienzo de la página. */

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const PEN_COLORS = ['#000000', '#c50f1f', '#ca5010', '#c19c00', '#107c10', '#0f6cbd', '#5c2d91', '#b4009e', '#ffffff'];
export const HIGHLIGHT_COLORS = ['#ffe34d', '#7fe38a', '#7fd4ff', '#ffa6d1', '#ffb870'];
export const PEN_WIDTHS = [1.5, 3, 6];
export const HIGHLIGHT_WIDTH = 18;

export function newStroke(tool: StrokeTool, color: string, width: number, pts: number[]): Stroke {
  const opacity = tool === 'highlighter' ? 0.4 : 1;
  return { id: newId('k'), tool, color, width, opacity, pts: pts.map((n) => Math.round(n * 10) / 10) };
}

export function strokeBounds(s: Stroke): Rect {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (let i = 0; i < s.pts.length; i += 2) {
    x1 = Math.min(x1, s.pts[i]!);
    x2 = Math.max(x2, s.pts[i]!);
    y1 = Math.min(y1, s.pts[i + 1]!);
    y2 = Math.max(y2, s.pts[i + 1]!);
  }
  const pad = s.width / 2;
  return { x1: x1 - pad, y1: y1 - pad, x2: x2 + pad, y2: y2 + pad };
}

const dist2 = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
};

/** Los segmentos que forman un trazo o una forma (para saber si algo lo toca). */
function segments(s: Stroke): [number, number, number, number][] {
  const p = s.pts;
  if (s.tool === 'rect') {
    const [x1, y1, x2, y2] = p as [number, number, number, number];
    return [[x1, y1, x2, y1], [x2, y1, x2, y2], [x2, y2, x1, y2], [x1, y2, x1, y1]];
  }
  if (s.tool === 'ellipse') {
    const [x1, y1, x2, y2] = p as [number, number, number, number];
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const a = Math.abs(x2 - x1) / 2;
    const b = Math.abs(y2 - y1) / 2;
    const out: [number, number, number, number][] = [];
    for (let i = 0; i < 48; i++) {
      const t1 = (i / 48) * Math.PI * 2;
      const t2 = ((i + 1) / 48) * Math.PI * 2;
      out.push([cx + a * Math.cos(t1), cy + b * Math.sin(t1), cx + a * Math.cos(t2), cy + b * Math.sin(t2)]);
    }
    return out;
  }
  if (p.length === 2) return [[p[0]!, p[1]!, p[0]!, p[1]!]];
  const out: [number, number, number, number][] = [];
  for (let i = 0; i + 3 < p.length; i += 2) out.push([p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!]);
  return out;
}

/** ¿Pasa el trazo a menos de `r` de (x, y)? */
export function hitStroke(s: Stroke, x: number, y: number, r: number): boolean {
  const reach = r + s.width / 2;
  const b = strokeBounds(s);
  if (x < b.x1 - r || x > b.x2 + r || y < b.y1 - r || y > b.y2 + r) return false;
  return segments(s).some(([ax, ay, bx, by]) => dist2(x, y, ax, ay, bx, by) <= reach * reach);
}

/** La goma: quita los trazos que toca. */
export function eraseAt(ink: Stroke[], x: number, y: number, r: number): Stroke[] {
  const keep = ink.filter((s) => !hitStroke(s, x, y, r));
  return keep.length === ink.length ? ink : keep;
}

export function strokesInRect(ink: Stroke[], r: Rect): Stroke[] {
  const x1 = Math.min(r.x1, r.x2);
  const x2 = Math.max(r.x1, r.x2);
  const y1 = Math.min(r.y1, r.y2);
  const y2 = Math.max(r.y1, r.y2);
  return ink.filter((s) => {
    const b = strokeBounds(s);
    return b.x1 >= x1 && b.x2 <= x2 && b.y1 >= y1 && b.y2 <= y2;
  });
}

export function moveStrokes(ink: Stroke[], ids: string[], dx: number, dy: number): Stroke[] {
  return ink.map((s) => (ids.includes(s.id) ? { ...s, pts: s.pts.map((v, i) => Math.round((v + (i % 2 === 0 ? dx : dy)) * 10) / 10) } : s));
}

/** Quita puntos casi iguales (la tinta del ratón o del lápiz trae muchos). */
export function simplify(pts: number[], tolerance = 0.8): number[] {
  if (pts.length <= 4) return pts;
  const out = [pts[0]!, pts[1]!];
  let lx = pts[0]!;
  let ly = pts[1]!;
  for (let i = 2; i < pts.length - 2; i += 2) {
    if (Math.hypot(pts[i]! - lx, pts[i + 1]! - ly) >= tolerance) {
      out.push(pts[i]!, pts[i + 1]!);
      lx = pts[i]!;
      ly = pts[i + 1]!;
    }
  }
  out.push(pts[pts.length - 2]!, pts[pts.length - 1]!);
  return out;
}

const f = (n: number) => Math.round(n * 10) / 10;

/** El camino SVG de un trazo, suavizado con curvas por los puntos medios. */
export function smoothPath(pts: number[]): string {
  if (pts.length < 4) return pts.length === 2 ? `M${f(pts[0]!)} ${f(pts[1]!)}h0.01` : '';
  let d = `M${f(pts[0]!)} ${f(pts[1]!)}`;
  for (let i = 2; i < pts.length - 2; i += 2) {
    const mx = (pts[i]! + pts[i + 2]!) / 2;
    const my = (pts[i + 1]! + pts[i + 3]!) / 2;
    d += `Q${f(pts[i]!)} ${f(pts[i + 1]!)} ${f(mx)} ${f(my)}`;
  }
  d += `L${f(pts[pts.length - 2]!)} ${f(pts[pts.length - 1]!)}`;
  return d;
}

/** El camino SVG de cualquier trazo o forma. La flecha lleva la punta al final. */
export function strokePath(s: Stroke): string {
  const p = s.pts;
  switch (s.tool) {
    case 'line':
      return `M${f(p[0]!)} ${f(p[1]!)}L${f(p[2]!)} ${f(p[3]!)}`;
    case 'arrow': {
      const [x1, y1, x2, y2] = p as [number, number, number, number];
      const a = Math.atan2(y2 - y1, x2 - x1);
      const h = Math.max(8, s.width * 4);
      const l = `${f(x2 - h * Math.cos(a - 0.45))} ${f(y2 - h * Math.sin(a - 0.45))}`;
      const r = `${f(x2 - h * Math.cos(a + 0.45))} ${f(y2 - h * Math.sin(a + 0.45))}`;
      return `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}M${l}L${f(x2)} ${f(y2)}L${r}`;
    }
    case 'rect': {
      const [x1, y1, x2, y2] = p as [number, number, number, number];
      return `M${f(x1)} ${f(y1)}H${f(x2)}V${f(y2)}H${f(x1)}Z`;
    }
    case 'ellipse': {
      const [x1, y1, x2, y2] = p as [number, number, number, number];
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const a = Math.abs(x2 - x1) / 2;
      const b = Math.abs(y2 - y1) / 2;
      return `M${f(cx - a)} ${f(cy)}a${f(a)} ${f(b)} 0 1 0 ${f(2 * a)} 0a${f(a)} ${f(b)} 0 1 0 ${f(-2 * a)} 0Z`;
    }
    default:
      return smoothPath(p);
  }
}

/**
 * «Tinta a forma»: si el trazo a mano alzada parece una línea recta, un rectángulo o una elipse, devuelve esa forma limpia; si no,
 * null. Es una heurística sencilla (no reconoce polígonos ni letras).
 */
export function recognizeShape(s: Stroke): Stroke | null {
  if (s.tool !== 'pen' || s.pts.length < 12) return null;
  const p = s.pts;
  const n = p.length / 2;
  const first = { x: p[0]!, y: p[1]! };
  const last = { x: p[p.length - 2]!, y: p[p.length - 1]! };
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    x1 = Math.min(x1, p[i]!);
    x2 = Math.max(x2, p[i]!);
    y1 = Math.min(y1, p[i + 1]!);
    y2 = Math.max(y2, p[i + 1]!);
  }
  const w = x2 - x1;
  const h = y2 - y1;
  const diag = Math.hypot(w, h);
  if (diag < 24) return null;
  const chord = Math.hypot(last.x - first.x, last.y - first.y);
  // recta: todos los puntos cerca de la cuerda
  let maxDev = 0;
  for (let i = 0; i < n; i++) maxDev = Math.max(maxDev, Math.sqrt(dist2(p[2 * i]!, p[2 * i + 1]!, first.x, first.y, last.x, last.y)));
  if (chord > diag * 0.85 && maxDev < Math.max(4, chord * 0.05)) return { ...s, id: newId('k'), tool: 'line', pts: [first.x, first.y, last.x, last.y] };
  // cerrada: el final vuelve cerca del principio
  if (chord > diag * 0.3 || w < 12 || h < 12) return null;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const a = w / 2;
  const b = h / 2;
  let onBorder = 0;
  let ellipseErr = 0;
  for (let i = 0; i < n; i++) {
    const px = p[2 * i]!;
    const py = p[2 * i + 1]!;
    const nearV = Math.min(Math.abs(px - x1), Math.abs(px - x2)) < w * 0.12;
    const nearH = Math.min(Math.abs(py - y1), Math.abs(py - y2)) < h * 0.12;
    if (nearV || nearH) onBorder++;
    ellipseErr += Math.abs(((px - cx) / a) ** 2 + ((py - cy) / b) ** 2 - 1);
  }
  if (onBorder / n > 0.9) return { ...s, id: newId('k'), tool: 'rect', pts: [x1, y1, x2, y2] };
  if (ellipseErr / n < 0.22) return { ...s, id: newId('k'), tool: 'ellipse', pts: [x1, y1, x2, y2] };
  return null;
}
