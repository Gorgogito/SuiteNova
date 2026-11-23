import { svgFromUri, svgToFreeform, type Freeform } from '@suitenova/icon-core';

/** The freeform of an icon image (null when the image is not an icon of the gallery). */
export function freeformOfImage(attrs: Record<string, any> | undefined): Freeform | null {
  const svg = attrs && typeof attrs.src === 'string' ? svgFromUri(attrs.src) : null;
  return svg ? svgToFreeform(svg) : null;
}

const WRAP: Record<string, string> = { left: 'left', right: 'right', top: 'topBottom', front: 'front', behind: 'behind' };

/**
 * The attributes of the Writer shape that «Convertir en forma» makes of an icon image: its paths as a custom geometry, the fill and the outline of the
 * icon, its size, place, turn and alternative text. The effects (shadow, glow) and the transparency of the fill are not part of a shape of Writer.
 */
export function shapeAttrsOfImage(attrs: Record<string, any>, f: Freeform): Record<string, unknown> {
  const w = attrs.width ?? 64;
  const h = attrs.height ?? 64;
  return {
    kind: 'rect',
    cust: f.paths,
    width: w,
    height: h,
    fill: f.fill ?? '#ffffff',
    fillNone: f.fill === null,
    stroke: f.stroke?.color ?? '#000000',
    strokeWidth: f.stroke ? Math.round(f.stroke.width * (w / f.size) * 100) / 100 : 0,
    rotation: attrs.rotate ?? 0,
    wrap: attrs.wrap ? (WRAP[attrs.wrap] ?? 'inline') : 'inline',
    x: attrs.x ?? 0,
    y: attrs.y ?? 0,
    alt: attrs.alt ?? '',
  };
}
