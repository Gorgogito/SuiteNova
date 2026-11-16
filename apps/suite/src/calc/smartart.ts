import type { SheetImage } from '@suitenova/calc-engine';
import { drawingSvg, partsShapes, type SmartArtParts } from '@suitenova/smartart-core';

/** El dibujo de un SmartArt como SVG de `width` x `height` píxeles de hoja (los puntos del dibujo son 0,75 px). */
export function smartArtSvgBytes(parts: SmartArtParts, width: number, height: number): Uint8Array {
  return new TextEncoder().encode(drawingSvg(partsShapes(parts), width * 0.75, height * 0.75, { width, height }));
}

/** Tamaño del dibujo en puntos de una imagen de hoja. */
export const ptSizeOf = (img: Pick<SheetImage, 'width' | 'height'>): { width: number; height: number } => ({ width: img.width * 0.75, height: img.height * 0.75 });
