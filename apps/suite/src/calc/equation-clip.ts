import type { MathClip } from '@suitenova/math-core';
import { renderEquation } from '../slides/equation';
import type { CalcDoc } from './doc';

const DEFAULT_SIZE = 14;

/** La ecuación elegida en la hoja, lista para el portapapeles (o null si lo elegido no es una ecuación). */
export function equationClipOf(doc: CalcDoc): MathClip | null {
  const s = doc.sheet.shapes.find((o) => o.id === doc.x.selectedShape);
  return s?.math ? { tex: s.math.tex, display: s.math.display ?? true } : null;
}

/** Pega una ecuación que viene de fuera: un cuadro nuevo junto a la celda activa, con su imagen de respaldo. */
export async function pasteEquation(doc: CalcDoc, clip: MathClip): Promise<void> {
  // un píxel de la hoja es 3/4 de punto: la fórmula se mide a ese tamaño (como en el cuadro «Ecuación»)
  const img = await renderEquation(clip.tex, '#000000', (DEFAULT_SIZE * 4) / 3);
  doc.x.insertEquation(clip.tex, DEFAULT_SIZE, img);
}
