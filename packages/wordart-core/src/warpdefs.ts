import { baseEnv, ellipsePoint, formula, rad, val, type Env } from '@suitenova/shapes-core';
import { Curve } from './geometry';
import type { Pt } from './types';
import data from './textwarps.json';

/*
 * Las transformaciones de texto de ECMA-376 (`prstTxWarp`). Las 40 definiciones se compilan (scripts/build-textwarps.mjs) a
 * textwarps.json y se evalúan con las mismas fórmulas de guías que las formas. Cada una trae una o varias curvas guía.
 */

type Cmd = (string | number)[];
interface WarpDef {
  av: Record<string, string>;
  gd: [string, string][];
  ah: Record<string, string>[];
  paths: Cmd[][];
}

const DEFS = data as unknown as Record<string, WarpDef>;

export const warpNames = (): string[] => Object.keys(DEFS);
export const hasWarp = (name: string): boolean => name in DEFS;

/** Las que llevan el texto sobre una trayectoria (las letras conservan su forma y giran); las demás deforman el texto entre dos curvas. */
export const PATH_WARPS = new Set(['textArchUp', 'textArchDown', 'textCircle', 'textButton']);

/** Valores de ajuste por omisión (`{ adj: 10800000 }`). */
export function warpDefaults(name: string): Record<string, number> {
  const d = DEFS[name];
  const out: Record<string, number> = {};
  if (!d) return out;
  const env = baseEnv(100, 100);
  for (const [k, v] of Object.entries(d.av)) out[k] = formula(v, env);
  return out;
}

export interface WarpHandle {
  kind: 'xy' | 'polar';
  x: number;
  y: number;
}

export interface WarpGeometry {
  mode: 'path' | 'envelope';
  /** Curvas guía en el orden de la definición (el texto se acomoda al primer grupo: una para trayectoria, dos para envolvente). */
  curves: Curve[];
  handles: WarpHandle[];
}

/** Muestrea un trazado de la definición en una polilínea. */
function sample(cmds: Cmd[], env: Env): Pt[] {
  const pts: Pt[] = [];
  let cx = 0;
  let cy = 0;
  const num = (t: string | number | undefined) => val(String(t), env);
  for (const c of cmds) {
    const k = c[0];
    if (k === 'M' || k === 'L') {
      cx = num(c[1]);
      cy = num(c[2]);
      pts.push({ x: cx, y: cy });
    } else if (k === 'Q') {
      const x1 = num(c[1]);
      const y1 = num(c[2]);
      const x2 = num(c[3]);
      const y2 = num(c[4]);
      for (let i = 1; i <= 32; i++) {
        const t = i / 32;
        const u = 1 - t;
        pts.push({ x: u * u * cx + 2 * u * t * x1 + t * t * x2, y: u * u * cy + 2 * u * t * y1 + t * t * y2 });
      }
      cx = x2;
      cy = y2;
    } else if (k === 'C') {
      const x1 = num(c[1]);
      const y1 = num(c[2]);
      const x2 = num(c[3]);
      const y2 = num(c[4]);
      const x3 = num(c[5]);
      const y3 = num(c[6]);
      for (let i = 1; i <= 48; i++) {
        const t = i / 48;
        const u = 1 - t;
        pts.push({ x: u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, y: u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3 });
      }
      cx = x3;
      cy = y3;
    } else if (k === 'A') {
      const wr = num(c[1]);
      const hr = num(c[2]);
      const st = num(c[3]);
      const sw = num(c[4]);
      const [sx, sy] = ellipsePoint(wr, hr, rad(st));
      const ox = cx - sx;
      const oy = cy - sy;
      const n = Math.max(8, Math.ceil(Math.abs(sw) / 60000 / 2));
      for (let i = 1; i <= n; i++) {
        const [ex, ey] = ellipsePoint(wr, hr, rad(st + (sw * i) / n));
        pts.push({ x: ox + ex, y: oy + ey });
      }
      cx = pts[pts.length - 1]!.x;
      cy = pts[pts.length - 1]!.y;
    }
  }
  return pts;
}

/** La geometría de una transformación para una caja de `w` x `h` px y unos valores de ajuste (los que falten, los de por omisión). */
export function warpGeometry(name: string, w: number, h: number, adj: Record<string, number> = {}): WarpGeometry | null {
  const def = DEFS[name];
  if (!def) return null;
  const env = baseEnv(w, h);
  const defaults = warpDefaults(name);
  for (const k of Object.keys(def.av)) env.set(k, adj[k] ?? defaults[k] ?? 0);
  for (const [n, fm] of def.gd) env.set(n, formula(fm, env));
  const curves = def.paths.map((p) => new Curve(sample(p, env)));
  const handles: WarpHandle[] = def.ah.map((a) => ({ kind: a.t === 'xy' ? 'xy' : 'polar', x: val(a.x, env), y: val(a.y, env) }));
  return { mode: PATH_WARPS.has(name) ? 'path' : 'envelope', curves, handles };
}
