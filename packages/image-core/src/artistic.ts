import { boxBlur, glow, grain, mosaic, pencilSketch, posterize, type Pixels } from './pixels';

/**
 * Artistic effects with an intensity (0–100; 50 is the usual one and gives what `ARTISTIC` has always given). Radii and block sizes
 * follow the size of the picture, so the same intensity looks the same on a small and on a large one.
 */
export interface ArtisticEffect {
  id: string;
  name: string;
  run(p: Pixels, level: number): Pixels;
}
export const DEFAULT_LEVEL = 50;
const k = (level: number) => Math.min(2, Math.max(0.1, level / 50));
const small = (p: Pixels) => Math.min(p.w, p.h);

export const ARTISTIC_EFFECTS: ArtisticEffect[] = [
  { id: 'blur', name: 'Desenfoque', run: (p, l) => boxBlur(p, Math.max(1, Math.round(Math.max(2, Math.round(small(p) / 60)) * k(l)))) },
  { id: 'mosaic', name: 'Mosaico', run: (p, l) => mosaic(p, Math.max(2, Math.round(Math.max(4, Math.round(small(p) / 40)) * k(l)))) },
  { id: 'sketch', name: 'Boceto a lápiz', run: (p, l) => pencilSketch(p, Math.max(1, Math.round(Math.max(2, Math.round(small(p) / 150)) * k(l)))) },
  { id: 'posterize', name: 'Carteles (pocos colores)', run: (p, l) => posterize(p, Math.round(6 - Math.min(100, Math.max(0, l)) / 25)) },
  { id: 'grain', name: 'Grano de película', run: (p, l) => grain(p, 50 * k(l)) },
  { id: 'glow', name: 'Enfoque suave', run: (p, l) => glow(p, Math.max(1, Math.round(Math.max(3, Math.round(small(p) / 80)) * k(l)))) },
];

export const artisticById = (id: string): ArtisticEffect | undefined => ARTISTIC_EFFECTS.find((e) => e.id === id);

/** Applies the effect; an unknown one leaves the picture as it is. */
export function applyArtistic(p: Pixels, id: string, level = DEFAULT_LEVEL): Pixels {
  const e = artisticById(id);
  return e ? e.run(p, level) : p;
}
