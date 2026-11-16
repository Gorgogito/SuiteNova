import { LocalFontSource, layoutText, placeText, warpText, wordArtSvg, type FontLike, type WordArtFx } from '@suitenova/wordart-core';

/*
 * Lo común a los productos que alojan WordArt (Writer, Calc): las fuentes del sistema (se piden una vez por página) y el dibujo de un
 * texto con su estilo y su transformación como marcado SVG. Si no hay fuente, devuelve `null` y el anfitrión dibuja el texto normal.
 */

export const localFonts = new LocalFontSource();

export interface WordArtSpec {
  text: string;
  family: string;
  bold: boolean;
  italic: boolean;
  /** Tamaño de la letra en px. */
  sizePx: number;
  align: 'left' | 'center' | 'right';
  fx: WordArtFx;
  warp: { prst: string; adj?: Record<string, number> } | null;
  width: number;
  height: number;
  /** Identificador único en la página (para los degradados y filtros del SVG). */
  id: string;
}

const cache = new Map<string, string | null>();

/** Texto compuesto con una fuente ya cargada, deformado o colocado sin deformar; devuelve el SVG (sin el elemento `<svg>`). */
export function drawWordArt(font: FontLike, s: WordArtSpec): string | null {
  if (!s.text.trim() || s.width < 4 || s.height < 4) return null;
  const block = layoutText(s.text, font, { size: s.sizePx, align: s.align });
  const contours = s.warp ? warpText(block, s.warp.prst, s.width, s.height, s.warp.adj) : placeText(block, s.width, s.height, s.align);
  return contours ? wordArtSvg(contours, s.fx, s.id) : null;
}

/** Carga la fuente y dibuja; `null` si la fuente no está disponible (sin permiso, sin la API o sin esa familia). */
export async function renderWordArt(s: WordArtSpec): Promise<string | null> {
  const key = JSON.stringify(s);
  if (cache.has(key)) return cache.get(key)!;
  const font = await localFonts.load(s.family, s.bold, s.italic);
  const out = font ? drawWordArt(font, s) : null;
  if (cache.size > 300) cache.clear();
  cache.set(key, out);
  return out;
}
