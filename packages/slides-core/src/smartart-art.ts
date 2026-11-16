import { PART_TYPES, changeColors, changeLayout, changeStyle, flatten, newSmartArt, outlineToTree, parseSmartArt, refresh, setDrawingRelId, treeOf, treeToOutline, writeSmartArt, type NewSmartArt, type SmartArt, type SmartArtParts } from '@suitenova/smartart-core';
import { newId } from './defaults';
import { readDrawingXml } from './pptx/elements';
import type { GroupEl, RawParts, Xfrm } from './types';

/*
 * SmartArt vinculado a sus datos en Nova Slides. Un SmartArt es un grupo (`GroupEl` con `smartart`) cuyas hijas son las formas del dibujo
 * y cuyo `rawDiagram` guarda las cinco partes del paquete; al editar, el motor (`smartart-core`) recalcula el dibujo y las partes.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

const SLOTS = [
  ['data', 'diagramData'],
  ['layout', 'diagramLayout'],
  ['style', 'diagramQuickStyle'],
  ['colors', 'diagramColors'],
  ['drawing', 'diagramDrawing'],
] as const;

/** Las cinco partes de un SmartArt como bytes con nombre de archivo (`n` distingue varios SmartArt de la misma diapositiva). */
function toRaw(parts: SmartArtParts, n: number): RawParts {
  const raw: Record<string, Uint8Array> = {};
  const types: Record<string, string> = {};
  const name = (slot: keyof typeof PART_TYPES) => `ppt/${PART_TYPES[slot].dir}${n}.xml`;
  for (const [slot] of SLOTS) {
    const xml = parts[slot];
    if (xml === undefined) continue;
    const path = name(slot);
    raw[path] = enc.encode(xml);
    types[path] = PART_TYPES[slot].rel;
  }
  raw['__types'] = enc.encode(JSON.stringify(types));
  return raw;
}

/** Las cinco partes guardadas en un grupo, o `null` si no es un SmartArt completo. */
export function partsOf(el: GroupEl): SmartArtParts | null {
  const raw = el.rawDiagram;
  if (!raw) return null;
  const types: Record<string, string> = JSON.parse(dec.decode(raw['__types'] ?? enc.encode('{}')));
  const found: Partial<SmartArtParts> = {};
  for (const [path, type] of Object.entries(types)) {
    const bytes = raw[path];
    if (!bytes) continue;
    for (const [slot, suffix] of SLOTS) if (type.endsWith(suffix)) found[slot] = dec.decode(bytes);
  }
  return found.data && found.layout && found.style && found.colors ? (found as SmartArtParts) : null;
}

/** El SmartArt vivo de un grupo (lee sus partes); `null` si el grupo no es un SmartArt o sus partes no se pueden leer. */
export function smartArtOf(el: GroupEl): SmartArt | null {
  const parts = partsOf(el);
  if (!parts) return null;
  try {
    return parseSmartArt(parts);
  } catch {
    return null;
  }
}

export const isLiveSmartArt = (el: { kind: string }): el is GroupEl => el.kind === 'group' && !!(el as GroupEl).smartart && partsOf(el as GroupEl) !== null;

let seq = 0;

/** Un grupo con el dibujo de `sa` en el marco dado (en puntos). Si se da `base`, conserva su identidad (id, nombre, texto alternativo…). */
export function groupFromSmartArt(sa: SmartArt, xfrm: Xfrm, base?: Partial<GroupEl>): GroupEl {
  const art = { ...sa, data: { ...sa.data } };
  const hasDrawing = !!art.drawing;
  setDrawingRelId(art.data, hasDrawing ? 'rId1' : null);
  const parts = writeSmartArt(art);
  const xml = parts.drawing;
  const children = xml ? readDrawingXml(xml) : [];
  return {
    kind: 'group',
    id: newId(),
    ...base,
    xfrm,
    chOff: { x: 0, y: 0 },
    chExt: { w: xfrm.w, h: xfrm.h },
    children,
    smartart: true,
    rawDiagram: toRaw(parts, ++seq),
  };
}

/** Inserta un SmartArt nuevo del catálogo: el grupo con su dibujo, listo para ponerlo en la diapositiva. */
export function newSmartArtGroup(o: Omit<NewSmartArt, 'width' | 'height'>, xfrm: Xfrm): GroupEl {
  const sa = newSmartArt({ ...o, width: xfrm.w, height: xfrm.h });
  return groupFromSmartArt(sa, xfrm);
}

/** El texto del panel del SmartArt (un nodo por línea, un tabulador por nivel). */
export function smartArtText(el: GroupEl): string {
  const sa = smartArtOf(el);
  return sa ? treeToOutline(treeOf(sa)) : '';
}

/** Cantidad de nodos del SmartArt. */
export function smartArtNodeCount(el: GroupEl): number {
  const sa = smartArtOf(el);
  return sa ? flatten(treeOf(sa)).length : 0;
}

const size = (el: GroupEl) => ({ width: el.xfrm?.w ?? el.chExt.w, height: el.xfrm?.h ?? el.chExt.h });

function replace(el: GroupEl, sa: SmartArt): GroupEl {
  const xfrm = el.xfrm ?? { x: 0, y: 0, w: el.chExt.w, h: el.chExt.h };
  const { kind, xfrm: _x, chOff, chExt, children, smartart, rawDiagram, ...keep } = el;
  void kind;
  void _x;
  void chOff;
  void chExt;
  void children;
  void smartart;
  void rawDiagram;
  return groupFromSmartArt(sa, xfrm, keep);
}

/** Cambia el texto del SmartArt con el del panel y vuelve a calcular el dibujo. `null` si el grupo no es un SmartArt editable. */
export function setSmartArtText(el: GroupEl, text: string): GroupEl | null {
  const sa = smartArtOf(el);
  if (!sa) return null;
  try {
    return replace(el, refresh(sa, outlineToTree(text, treeOf(sa)), size(el)));
  } catch {
    return null;
  }
}

/** Cambia el diseño (del catálogo), el estilo rápido o los colores conservando el texto. */
export function changeSmartArt(el: GroupEl, what: { layout?: string; style?: string; colors?: string }): GroupEl | null {
  let sa = smartArtOf(el);
  if (!sa) return null;
  try {
    const s = size(el);
    if (what.layout) sa = changeLayout(sa, what.layout, s);
    if (what.style) sa = changeStyle(sa, what.style, s);
    if (what.colors) sa = changeColors(sa, what.colors, s);
    return replace(el, sa);
  } catch {
    return null;
  }
}

/** Vuelve a calcular el dibujo con el tamaño actual del grupo (tras cambiarlo de tamaño). */
export function reflowSmartArt(el: GroupEl): GroupEl | null {
  const sa = smartArtOf(el);
  if (!sa) return null;
  try {
    return replace(el, refresh(sa, treeOf(sa), size(el)));
  } catch {
    return null;
  }
}

/** Identificadores del diseño, el estilo y los colores de un SmartArt. */
export function smartArtIds(el: GroupEl): { layout: string; style: string; colors: string } | null {
  const sa = smartArtOf(el);
  return sa ? { layout: sa.layout.uniqueId, style: sa.style.uniqueId, colors: sa.colors.uniqueId } : null;
}
