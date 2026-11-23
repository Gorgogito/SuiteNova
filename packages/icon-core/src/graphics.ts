// The looks offered for an icon once it is in a document (Office's «Formato de gráficos»): colors, outline weights, the shadows and glows around it, and
// the ready-made styles. Plain data; the products draw the menus.
import type { IconLook } from './svg';

/** Shadow and glow around a picture, in points and degrees (the `PictureFx` of image-core has the same shape). */
export interface GraphicFx {
  shadow?: { color: string; blur: number; dist: number; angle: number; alpha: number };
  glow?: { color: string; radius: number; alpha: number };
}

/** The standard colors, the first row of the palette (Office's «Colores estándar» and some theme colors). */
export const GRAPHIC_COLORS: { color: string; name: string }[] = [
  { color: '#000000', name: 'Negro' },
  { color: '#595959', name: 'Gris oscuro' },
  { color: '#a6a6a6', name: 'Gris' },
  { color: '#ffffff', name: 'Blanco' },
  { color: '#c00000', name: 'Rojo oscuro' },
  { color: '#ff0000', name: 'Rojo' },
  { color: '#ffc000', name: 'Naranja' },
  { color: '#ffff00', name: 'Amarillo' },
  { color: '#92d050', name: 'Verde claro' },
  { color: '#00b050', name: 'Verde' },
  { color: '#00b0f0', name: 'Azul claro' },
  { color: '#0070c0', name: 'Azul' },
  { color: '#002060', name: 'Azul oscuro' },
  { color: '#7030a0', name: 'Púrpura' },
];

export const OUTLINE_WEIGHTS = [0.5, 1, 1.5, 2, 3];
export const FILL_TRANSPARENCIES = [0, 0.25, 0.5, 0.75];

const BLACK = '#000000';
export const SHADOW_PRESETS: { id: string; name: string; shadow: NonNullable<GraphicFx['shadow']> }[] = [
  { id: 'br', name: 'Exterior, abajo a la derecha', shadow: { color: BLACK, blur: 4, dist: 3, angle: 45, alpha: 0.4 } },
  { id: 'b', name: 'Exterior, abajo', shadow: { color: BLACK, blur: 4, dist: 3, angle: 90, alpha: 0.4 } },
  { id: 'bl', name: 'Exterior, abajo a la izquierda', shadow: { color: BLACK, blur: 4, dist: 3, angle: 135, alpha: 0.4 } },
  { id: 'r', name: 'Exterior, a la derecha', shadow: { color: BLACK, blur: 4, dist: 3, angle: 0, alpha: 0.4 } },
  { id: 'l', name: 'Exterior, a la izquierda', shadow: { color: BLACK, blur: 4, dist: 3, angle: 180, alpha: 0.4 } },
  { id: 'c', name: 'Exterior, centrada y difuminada', shadow: { color: BLACK, blur: 8, dist: 0, angle: 0, alpha: 0.5 } },
];

export const GLOW_SIZES = [5, 10, 18];
export const GLOW_COLORS = ['#4472c4', '#ed7d31', '#ffc000', '#70ad47', '#5b9bd5'];
export function glowOf(radius: number, color: string): NonNullable<GraphicFx['glow']> {
  return { color, radius, alpha: 0.6 };
}

export interface GraphicStyle {
  id: string;
  name: string;
  look: IconLook;
  fx?: GraphicFx;
}

/** The ready-made styles: a look (fill, outline, transparency) and, for some, an effect. A style replaces the whole look and the effects. */
export const GRAPHIC_STYLES: GraphicStyle[] = [
  { id: 'black', name: 'Negro', look: { fill: '#000000', opacity: 1, stroke: null } },
  { id: 'blue', name: 'Azul sólido', look: { fill: '#1f4e79', opacity: 1, stroke: null } },
  { id: 'red', name: 'Rojo sólido', look: { fill: '#c00000', opacity: 1, stroke: null } },
  { id: 'green', name: 'Verde sólido', look: { fill: '#00b050', opacity: 1, stroke: null } },
  { id: 'gray', name: 'Gris', look: { fill: '#595959', opacity: 1, stroke: null } },
  { id: 'outline', name: 'Solo contorno', look: { fill: null, opacity: 1, stroke: { color: '#1f4e79', width: 1.5 } } },
  { id: 'light', name: 'Relleno claro con contorno', look: { fill: '#bdd7ee', opacity: 1, stroke: { color: '#1f4e79', width: 1 } } },
  { id: 'half', name: 'Semitransparente', look: { fill: '#1f4e79', opacity: 0.5, stroke: null } },
  { id: 'shadow', name: 'Con sombra', look: { fill: '#1f4e79', opacity: 1, stroke: null }, fx: { shadow: SHADOW_PRESETS[0]!.shadow } },
  { id: 'glow', name: 'Con resplandor', look: { fill: '#ed7d31', opacity: 1, stroke: null }, fx: { glow: glowOf(10, '#ed7d31') } },
];
