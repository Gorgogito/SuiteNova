/**
 * Formas agrupadas de una hoja: un grupo son las formas que comparten `group`. Aquí están las transformaciones de un conjunto de formas
 * como un bloque (límites, mover, cambiar de tamaño, girar) sin tocar el modelo: devuelven cambios (`ShapePatch`) que quien llama aplica
 * en un solo paso de deshacer.
 */
import type { SheetShape } from './objects';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Cambios de una forma: su id y los campos de posición, tamaño y giro que cambian. */
export interface ShapePatch {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Grados 0–359; 0 se guarda como ausente (`undefined`). */
  rotation?: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const norm = (deg: number) => ((Math.round(deg * 10) / 10) % 360 + 360) % 360;

/** Rectángulo (en píxeles de la hoja) que rodea una forma, teniendo en cuenta su giro. */
export function shapeBounds(s: SheetShape): Box {
  const a = rad(s.rotation ?? 0);
  const c = Math.abs(Math.cos(a));
  const sn = Math.abs(Math.sin(a));
  const w = s.width * c + s.height * sn;
  const h = s.width * sn + s.height * c;
  const cx = s.x + s.width / 2;
  const cy = s.y + s.height / 2;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

/** Rectángulo que rodea a todas las formas (con sus giros). Vacío si no hay ninguna. */
export function shapesBounds(shapes: SheetShape[]): Box {
  if (!shapes.length) return { x: 0, y: 0, width: 0, height: 0 };
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const s of shapes) {
    const b = shapeBounds(s);
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.width);
    y2 = Math.max(y2, b.y + b.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Todas las formas de los grupos a que pertenecen las dadas, más las propias (el grupo se selecciona entero). */
export function withGroupMates(all: SheetShape[], ids: string[]): string[] {
  const groups = new Set(all.filter((s) => ids.includes(s.id) && s.group).map((s) => s.group));
  return all.filter((s) => ids.includes(s.id) || (s.group && groups.has(s.group))).map((s) => s.id);
}

/** Desplazar un bloque de formas. */
export function moveShapes(shapes: SheetShape[], dx: number, dy: number): ShapePatch[] {
  return shapes.map((s) => ({ id: s.id, x: Math.round(s.x + dx), y: Math.round(s.y + dy) }));
}

/**
 * Llevar el bloque del rectángulo `from` al rectángulo `to`: las posiciones y los tamaños se escalan con él. Una forma girada 90° o 270°
 * intercambia los factores; con otros giros el tamaño es aproximado (el giro se conserva).
 */
export function scaleShapes(shapes: SheetShape[], from: Box, to: Box, min = 4): ShapePatch[] {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return shapes.map((s) => {
    const quarter = Math.round((s.rotation ?? 0) / 90) % 2 !== 0;
    const fw = quarter ? sy : sx;
    const fh = quarter ? sx : sy;
    const width = Math.max(min, s.width * fw);
    const height = Math.max(min, s.height * fh);
    const cx = to.x + (s.x + s.width / 2 - from.x) * sx;
    const cy = to.y + (s.y + s.height / 2 - from.y) * sy;
    return { id: s.id, x: Math.round(cx - width / 2), y: Math.round(cy - height / 2), width: Math.round(width), height: Math.round(height) };
  });
}

/** Girar el bloque `deg` grados alrededor de `center`: cada forma gira sobre sí y su centro describe el mismo giro. */
export function rotateShapes(shapes: SheetShape[], center: { x: number; y: number }, deg: number): ShapePatch[] {
  const a = rad(deg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return shapes.map((s) => {
    const cx = s.x + s.width / 2 - center.x;
    const cy = s.y + s.height / 2 - center.y;
    const nx = center.x + cx * cos - cy * sin;
    const ny = center.y + cx * sin + cy * cos;
    return { id: s.id, x: Math.round(nx - s.width / 2), y: Math.round(ny - s.height / 2), rotation: norm((s.rotation ?? 0) + deg) };
  });
}

/** Aplica los cambios a las formas de una hoja (el giro 0 se guarda como ausente). */
export function applyPatches(shapes: SheetShape[], patches: ShapePatch[]): void {
  const by = new Map(patches.map((p) => [p.id, p]));
  for (let i = 0; i < shapes.length; i++) {
    const p = by.get(shapes[i]!.id);
    if (!p) continue;
    const { id, rotation, ...rest } = p;
    void id;
    const next: SheetShape = { ...shapes[i]!, ...rest };
    if ('rotation' in p) {
      if (rotation) next.rotation = rotation;
      else delete next.rotation;
    }
    shapes[i] = next;
  }
}

let counter = 0;
/** Identificador nuevo para un grupo. */
export const newGroupId = (): string => `grp-${Date.now().toString(36)}-${(++counter).toString(36)}`;

/** Agrupa las formas dadas en un grupo nuevo (los grupos a que ya pertenecían se funden en él). Devuelve el id, o `null` si hay menos de dos. */
export function groupShapes(shapes: SheetShape[], ids: string[]): string | null {
  const sel = shapes.filter((s) => ids.includes(s.id));
  if (sel.length < 2) return null;
  const old = new Set(sel.map((s) => s.group).filter(Boolean));
  const gid = newGroupId();
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i]!;
    if (ids.includes(s.id) || (s.group && old.has(s.group))) shapes[i] = { ...s, group: gid };
  }
  return gid;
}

/** Deshace los grupos a que pertenecen las formas dadas; devuelve los ids de las formas que quedaron sueltas. */
export function ungroupShapes(shapes: SheetShape[], ids: string[]): string[] {
  const groups = new Set(shapes.filter((s) => ids.includes(s.id) && s.group).map((s) => s.group));
  const freed: string[] = [];
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i]!;
    if (s.group && groups.has(s.group)) {
      const { group, ...rest } = s;
      void group;
      shapes[i] = rest;
      freed.push(s.id);
    }
  }
  return freed;
}
