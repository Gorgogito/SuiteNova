import type { Contour, PathCmd, Pt } from './types';

/** Aplana un trazado con curvas en contornos poligonales; las curvas se parten según su longitud (`step` px por tramo). */
export function flattenPath(cmds: PathCmd[], step = 3): Contour[] {
  const out: Contour[] = [];
  let cur: Pt[] = [];
  let x = 0;
  let y = 0;
  const parts = (len: number) => Math.min(32, Math.max(4, Math.ceil(len / step)));
  const close = () => {
    if (cur.length > 2) out.push(cur);
    cur = [];
  };
  for (const c of cmds) {
    if (c[0] === 'M') {
      close();
      x = c[1];
      y = c[2];
      cur = [{ x, y }];
    } else if (c[0] === 'L') {
      x = c[1];
      y = c[2];
      cur.push({ x, y });
    } else if (c[0] === 'Q') {
      const n = parts(Math.hypot(c[1] - x, c[2] - y) + Math.hypot(c[3] - c[1], c[4] - c[2]));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        cur.push({ x: u * u * x + 2 * u * t * c[1] + t * t * c[3], y: u * u * y + 2 * u * t * c[2] + t * t * c[4] });
      }
      x = c[3];
      y = c[4];
    } else if (c[0] === 'C') {
      const n = parts(Math.hypot(c[1] - x, c[2] - y) + Math.hypot(c[3] - c[1], c[4] - c[2]) + Math.hypot(c[5] - c[3], c[6] - c[4]));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        cur.push({
          x: u * u * u * x + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5],
          y: u * u * u * y + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6],
        });
      }
      x = c[5];
      y = c[6];
    } else close();
  }
  close();
  return out;
}

/** Parte los lados largos de un contorno para que ninguno pase de `max` px: así una recta se curva al deformarla. */
export function subdivide(contour: Contour, max: number): Contour {
  const out: Pt[] = [];
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i]!;
    const b = contour[(i + 1) % contour.length]!;
    out.push(a);
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / max);
    for (let k = 1; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/** Una curva muestreada, con su longitud acumulada: se recorre por fracción de longitud (0 a 1). */
export class Curve {
  readonly pts: Pt[];
  private readonly cum: number[];
  readonly length: number;
  constructor(pts: Pt[]) {
    this.pts = pts.length ? pts : [{ x: 0, y: 0 }];
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1]! + Math.hypot(this.pts[i]!.x - this.pts[i - 1]!.x, this.pts[i]!.y - this.pts[i - 1]!.y));
    this.length = this.cum[this.cum.length - 1]!;
  }
  /** Punto a la fracción `t` de la longitud. */
  at(t: number): Pt {
    const n = this.pts.length;
    if (n === 1 || this.length === 0) return this.pts[0]!;
    const s = Math.min(1, Math.max(0, t)) * this.length;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! <= s) lo = mid;
      else hi = mid;
    }
    const a = this.pts[lo]!;
    const b = this.pts[hi]!;
    const seg = this.cum[hi]! - this.cum[lo]!;
    const k = seg === 0 ? 0 : (s - this.cum[lo]!) / seg;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }
  /** Dirección unitaria de la curva a la fracción `t` (diferencia centrada, para que no «dé saltos» entre tramos). */
  tangent(t: number): Pt {
    const d = 0.5 / Math.max(2, this.pts.length);
    const a = this.at(Math.max(0, t - d));
    const b = this.at(Math.min(1, t + d));
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    return l === 0 ? { x: 1, y: 0 } : { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  }
  /**
   * Como `at`, pero fuera de 0..1 sigue la tangente del extremo (la tinta de una letra puede pasarse un poco del bloque de texto:
   * si se recortara, esos puntos se aplastarían sobre el final de la curva).
   */
  atExtended(t: number): Pt {
    if (t >= 0 && t <= 1) return this.at(t);
    const e = t < 0 ? 0 : 1;
    const p = this.at(e);
    const g = this.tangent(e);
    const d = (t - e) * this.length;
    return { x: p.x + g.x * d, y: p.y + g.y * d };
  }
  reversed(): Curve {
    return new Curve([...this.pts].reverse());
  }
}
