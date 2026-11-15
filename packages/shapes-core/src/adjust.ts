/**
 * Puntos de ajuste (los tiradores amarillos) de una forma, por su nombre en el catálogo común: dónde están, cómo cambian los valores al
 * arrastrarlos y cómo se escriben/leen en DrawingML (`<a:avLst><a:gd name="adj" fmla="val 16667"/></a:avLst>`).
 */
import { dragHandle, presetDefaults, presetGeometry } from './preset';
import { presetOf } from './gallery';

export type Adjust = Record<string, number>;

/** Posición (en píxeles de la forma) de cada tirador de ajuste. Vacío si la forma no tiene. */
export function adjustHandles(kind: string, w: number, h: number, adj: Adjust = {}): { x: number; y: number }[] {
  const g = presetGeometry(presetOf(kind), w, h, adj);
  return g ? g.handles.map((p) => ({ x: p.x, y: p.y })) : [];
}

/** Valores de ajuste nuevos (`undefined` = los de la forma por omisión) al arrastrar el tirador `index` hasta (x, y) (píxeles de la forma). */
export function dragAdjust(kind: string, w: number, h: number, adj: Adjust, index: number, x: number, y: number): Adjust | undefined {
  return cleanAdjust(kind, dragHandle(presetOf(kind), w, h, adj, index, x, y));
}

/** Quita los valores iguales a los de la forma por omisión; `undefined` si no queda ninguno. */
export function cleanAdjust(kind: string, adj: Adjust | undefined): Adjust | undefined {
  if (!adj) return undefined;
  const def = presetDefaults(presetOf(kind));
  const out: Adjust = {};
  for (const [k, v] of Object.entries(adj)) if (Number.isFinite(v) && v !== def[k]) out[k] = Math.round(v);
  return Object.keys(out).length ? out : undefined;
}

/** `<a:avLst>` con los valores de ajuste (vacío si no hay). */
export function avLstXml(adj: Adjust | undefined): string {
  const e = adj ? Object.entries(adj).filter(([k, v]) => /^[A-Za-z][\w]*$/.test(k) && Number.isFinite(v)) : [];
  return e.length ? `<a:avLst>${e.map(([k, v]) => `<a:gd name="${k}" fmla="val ${Math.round(v)}"/>`).join('')}</a:avLst>` : '<a:avLst/>';
}

/** Lee un valor de ajuste de `<a:gd name fmla>`; `null` si la fórmula no es un `val` simple. */
export function parseGuide(name: string | undefined, fmla: string | undefined): [string, number] | null {
  const m = /^val\s+(-?\d+)/.exec(fmla ?? '');
  return m ? [name ?? 'adj', Number(m[1])] : null;
}
