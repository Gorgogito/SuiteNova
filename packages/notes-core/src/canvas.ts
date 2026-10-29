import { newId, newTextContainer, type Container, type ImageContainer, type MediaContainer, type PageBody, type TextContainer } from './model';

/** Operaciones sobre los cuadros de una página (el lienzo libre). Puras: devuelven una página nueva. */

export const GRID = 8;
export const MIN_W = 60;
export const snap = (v: number, step = GRID): number => Math.round(v / step) * step;

const nextZ = (p: PageBody): number => p.containers.reduce((m, c) => Math.max(m, c.z), 0) + 1;

export function addContainer<P extends PageBody>(p: P, c: Container): P {
  return { ...p, containers: [...p.containers, { ...c, z: nextZ(p) }] };
}

export function updateContainer<P extends PageBody>(p: P, id: string, patch: Partial<Container>): P {
  return { ...p, containers: p.containers.map((c) => (c.id === id ? ({ ...c, ...patch } as Container) : c)) };
}

export function removeContainers<P extends PageBody>(p: P, ids: string[]): P {
  return { ...p, containers: p.containers.filter((c) => !ids.includes(c.id)) };
}

export function moveContainers<P extends PageBody>(p: P, ids: string[], dx: number, dy: number): P {
  return { ...p, containers: p.containers.map((c) => (ids.includes(c.id) ? { ...c, x: Math.max(-2000, c.x + dx), y: Math.max(-2000, c.y + dy) } : c)) };
}

/** Cambia el ancho (y el alto, en imágenes y grabaciones). Un cuadro de imagen conserva su proporción si `keepRatio`. */
export function resizeContainer<P extends PageBody>(p: P, id: string, w: number, h?: number, keepRatio = true): P {
  return {
    ...p,
    containers: p.containers.map((c) => {
      if (c.id !== id) return c;
      const nw = Math.max(MIN_W, Math.round(w));
      if (c.kind === 'text') return { ...c, w: nw };
      const ratio = c.h / c.w;
      return { ...c, w: nw, h: Math.max(30, Math.round(keepRatio && h === undefined ? nw * ratio : (h ?? c.h))) };
    }),
  };
}

export type ZMove = 'front' | 'back' | 'forward' | 'backward';

/** Cambia el orden de apilado de un cuadro. */
export function reorder<P extends PageBody>(p: P, id: string, how: ZMove): P {
  const order = [...p.containers].sort((a, b) => a.z - b.z);
  const i = order.findIndex((c) => c.id === id);
  if (i < 0) return p;
  const [c] = order.splice(i, 1);
  const j = how === 'front' ? order.length : how === 'back' ? 0 : how === 'forward' ? Math.min(order.length, i + 1) : Math.max(0, i - 1);
  order.splice(j, 0, c!);
  const zOf = new Map(order.map((x, k) => [x.id, k + 1]));
  return { ...p, containers: p.containers.map((x) => ({ ...x, z: zOf.get(x.id)! })) };
}

/** Un lugar libre para un cuadro nuevo de ancho `w`: debajo de lo que ya hay. */
export function freeSpot(p: PageBody, heights: Record<string, number> = {}): { x: number; y: number } {
  if (!p.containers.length) return { x: 48, y: 24 };
  const bottom = Math.max(...p.containers.map((c) => c.y + ('h' in c ? c.h : (heights[c.id] ?? 60))));
  const left = Math.min(...p.containers.map((c) => c.x));
  return { x: snap(Math.max(8, left)), y: snap(bottom + 24) };
}

export function newImageContainer(asset: string, w: number, h: number, alt: string, x = 48, y = 24): ImageContainer {
  return { kind: 'image', id: newId('c'), x, y, w, h, z: 1, asset, alt };
}

export function newMediaContainer(asset: string, media: 'audio' | 'video', name: string, seconds: number, x = 48, y = 24): MediaContainer {
  return media === 'audio' ? { kind: 'media', id: newId('c'), x, y, w: 340, h: 54, z: 1, asset, media, name, seconds } : { kind: 'media', id: newId('c'), x, y, w: 420, h: 260, z: 1, asset, media, name, seconds };
}

/** Un cuadro de texto en un punto de la página (doble clic en un espacio vacío). */
export function textAt(x: number, y: number, w = 320): TextContainer {
  return newTextContainer(snap(x), snap(y), w);
}

/** El tamaño del lienzo: lo que ocupan los cuadros y la tinta, más un margen para seguir escribiendo. */
export function pageExtent(p: PageBody, heights: Record<string, number> = {}): { w: number; h: number } {
  let w = 960;
  let h = 1200;
  for (const c of p.containers) {
    w = Math.max(w, c.x + c.w + 160);
    h = Math.max(h, c.y + ('h' in c ? c.h : (heights[c.id] ?? 80)) + 240);
  }
  for (const s of p.ink) {
    for (let i = 0; i < s.pts.length; i += 2) {
      w = Math.max(w, s.pts[i]! + 160);
      h = Math.max(h, s.pts[i + 1]! + 240);
    }
  }
  return { w: Math.round(w), h: Math.round(h) };
}
