// An icon as an SVG: one color, a square viewBox, every outline as a filled path (that is how Office draws its icons too, so Word can recolor it).
export interface SvgOptions {
  /** Fill color (`#rrggbb`); default black. */
  color?: string;
  /** Width and height in pixels; default the size of the viewBox. */
  px?: number;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function iconSvg(d: string[], size: number, opts: SvgOptions = {}): string {
  const color = opts.color && HEX.test(opts.color) ? opts.color.toLowerCase() : '#000000';
  const px = opts.px && opts.px > 0 ? Math.round(opts.px) : size;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${px}" height="${px}" fill="${color}">${d.map((p) => `<path d="${p}"/>`).join('')}</svg>`;
}

export interface ParsedIconSvg {
  size: number;
  color: string;
  d: string[];
}

/** Reads back an SVG made by `iconSvg` (the outlines, the size of the square and the color). Null for any other SVG. */
export function parseIconSvg(svg: string): ParsedIconSvg | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;
  const vb = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(root);
  if (!vb || vb[1] !== vb[2]) return null;
  const d = [...svg.matchAll(/<path\b[^>]*\sd="([^"]*)"/g)].map((m) => m[1]!);
  if (!d.length) return null;
  const color = /\bfill="(#[0-9a-fA-F]{6})"/.exec(root)?.[1]?.toLowerCase() ?? '#000000';
  return { size: Number(vb[1]), color, d };
}

/** The same icon in another color. */
export function recolorSvg(svg: string, color: string): string | null {
  const p = parseIconSvg(svg);
  if (!p) return null;
  const px = Number(/\bwidth="(\d+)"/.exec(svg)?.[1] ?? p.size);
  return iconSvg(p.d, p.size, { color, px });
}

export function svgDataUri(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
