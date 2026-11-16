import { changeColors, changeLayout, changeStyle, newSmartArt, refresh, treeOf, type NewSmartArt } from './catalog/factory';
import { setDrawingRelId } from './datamodel';
import { parseDrawing, type DrawnShape } from './drawing';
import { flatten, outlineToTree, treeToOutline } from './model';
import { parseSmartArt, writeSmartArt, type SmartArt, type SmartArtParts } from './parts';

/*
 * El SmartArt tal como lo guarda un anfitrión que no lo desmonta en formas (Writer, Calc): las cinco partes del paquete y las
 * operaciones de edición sobre ellas. Cada operación devuelve partes nuevas (con el dibujo vuelto a calcular) o `null` si las partes
 * no se pueden leer.
 */

/** Tamaño del dibujo en puntos. */
export interface PartsSize {
  width: number;
  height: number;
}

const toParts = (sa: SmartArt): SmartArtParts => {
  const art = { ...sa, data: { ...sa.data } };
  setDrawingRelId(art.data, art.drawing ? 'rId1' : null);
  return writeSmartArt(art);
};

const read = (p: SmartArtParts): SmartArt | null => {
  try {
    return parseSmartArt(p);
  } catch {
    return null;
  }
};

/** ¿Son las partes un SmartArt que el motor puede leer? */
export const partsReadable = (p: SmartArtParts | null | undefined): p is SmartArtParts => !!p && !!p.data && !!p.layout && !!p.style && !!p.colors && read(p) !== null;

/** Las partes de un SmartArt nuevo del catálogo. */
export const newParts = (o: NewSmartArt): SmartArtParts => toParts(newSmartArt(o));

/** El texto del panel (un nodo por línea, un tabulador por nivel). */
export function partsText(p: SmartArtParts): string {
  const sa = read(p);
  return sa ? treeToOutline(treeOf(sa)) : '';
}

export function partsNodeCount(p: SmartArtParts): number {
  const sa = read(p);
  return sa ? flatten(treeOf(sa)).length : 0;
}

/** Identificadores del diseño, el estilo y los colores. */
export function partsIds(p: SmartArtParts): { layout: string; style: string; colors: string } | null {
  const sa = read(p);
  return sa ? { layout: sa.layout.uniqueId, style: sa.style.uniqueId, colors: sa.colors.uniqueId } : null;
}

export function partsSetText(p: SmartArtParts, text: string, size: PartsSize): SmartArtParts | null {
  const sa = read(p);
  if (!sa) return null;
  try {
    return toParts(refresh(sa, outlineToTree(text, treeOf(sa)), size));
  } catch {
    return null;
  }
}

export function partsChange(p: SmartArtParts, what: { layout?: string; style?: string; colors?: string }, size: PartsSize): SmartArtParts | null {
  let sa = read(p);
  if (!sa) return null;
  try {
    if (what.layout) sa = changeLayout(sa, what.layout, size);
    if (what.style) sa = changeStyle(sa, what.style, size);
    if (what.colors) sa = changeColors(sa, what.colors, size);
    return toParts(sa);
  } catch {
    return null;
  }
}

/** Vuelve a calcular el dibujo con otro tamaño. */
export function partsReflow(p: SmartArtParts, size: PartsSize): SmartArtParts | null {
  const sa = read(p);
  if (!sa) return null;
  try {
    return toParts(refresh(sa, treeOf(sa), size));
  } catch {
    return null;
  }
}

/** Las formas del dibujo en caché (vacío si no hay). */
export function partsShapes(p: SmartArtParts): DrawnShape[] {
  try {
    return p.drawing ? parseDrawing(p.drawing) : [];
  } catch {
    return [];
  }
}
