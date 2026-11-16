/**
 * Formas agrupadas de una hoja: un grupo son las formas que comparten `group`. Aquí están las transformaciones de un conjunto de formas
 * como un bloque (límites, mover, cambiar de tamaño, girar) sin tocar el modelo: devuelven cambios (`ShapePatch`) que quien llama aplica
 * en un solo paso de deshacer.
 */
import { frameBounds, framesBounds, moveFrames, rotateFrames, scaleFrames, type FrameBox as Box, type FramePatch } from '@suitenova/shapes-core';
import type { SheetShape } from './objects';

export type { Box };

/** Cambios de una forma: su id y los campos de posición, tamaño y giro que cambian. */
export type ShapePatch = FramePatch;

/** Rectángulo (en píxeles de la hoja) que rodea una forma, teniendo en cuenta su giro. */
export const shapeBounds = (s: SheetShape): Box => frameBounds(s);

/** Rectángulo que rodea a todas las formas (con sus giros). Vacío si no hay ninguna. */
export const shapesBounds = (shapes: SheetShape[]): Box => framesBounds(shapes);

/** Desplazar un bloque de formas. */
export const moveShapes = (shapes: SheetShape[], dx: number, dy: number): ShapePatch[] => moveFrames(shapes, dx, dy);

/** Llevar el bloque del rectángulo from al rectángulo to (ver scaleFrames en shapes-core). */
export const scaleShapes = (shapes: SheetShape[], from: Box, to: Box, min = 4): ShapePatch[] => scaleFrames(shapes, from, to, min);

/** Girar el bloque deg grados alrededor de center. */
export const rotateShapes = (shapes: SheetShape[], center: { x: number; y: number }, deg: number): ShapePatch[] => rotateFrames(shapes, center, deg);

/** Todas las formas de los grupos a que pertenecen las dadas, más las propias (el grupo se selecciona entero). */
export function withGroupMates(all: SheetShape[], ids: string[]): string[] {
  const groups = new Set(all.filter((s) => ids.includes(s.id) && s.group).map((s) => s.group));
  return all.filter((s) => ids.includes(s.id) || (s.group && groups.has(s.group))).map((s) => s.id);
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
