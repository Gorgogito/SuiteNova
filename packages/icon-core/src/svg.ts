// An icon as an SVG: a square viewBox and every outline as a path, painted with one fill and, when asked, an outline (stroke). Word draws its icons the same
// way and recolors them by changing those attributes, so what is written here is what Word understands.
export interface IconLook {
  /** Fill color `#rrggbb`, or `null` for no fill (only the outline shows). Default black. */
  fill?: string | null;
  /** Fill opacity from 0 to 1 (default 1). */
  opacity?: number;
  /** Outline: color and width in units of the viewBox (a 24-unit icon: 1 is about one twenty-fourth of its side). */
  stroke?: { color: string; width: number } | null;
}

export interface SvgOptions extends IconLook {
  /** Width and height in pixels; default the size of the viewBox. */
  px?: number;
  /** Alias of `fill` kept for the callers that only set the color. */
  color?: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = (c: string | null | undefined, d: string | null): string | null => (c && HEX.test(c) ? c.toLowerCase() : d);
const num = (n: number): string => String(Math.round(n * 1000) / 1000);

export function iconSvg(d: string[], size: number, opts: SvgOptions = {}): string {
  const fill = opts.fill === null ? null : hex(opts.fill ?? opts.color, '#000000');
  const px = opts.px && opts.px > 0 ? Math.round(opts.px) : size;
  const stroke = opts.stroke && HEX.test(opts.stroke.color) && opts.stroke.width > 0 ? { color: opts.stroke.color.toLowerCase(), width: Math.min(8, opts.stroke.width) } : null;
  const opacity = opts.opacity !== undefined && opts.opacity >= 0 && opts.opacity < 1 ? ` fill-opacity="${num(opts.opacity)}"` : '';
  const attrs =
    `fill="${fill ?? 'none'}"${fill ? opacity : ''}` +
    (stroke ? ` stroke="${stroke.color}" stroke-width="${num(stroke.width)}" stroke-linejoin="round" stroke-linecap="round"` : '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${px}" height="${px}" ${attrs}>${d.map((p) => `<path d="${p}"/>`).join('')}</svg>`;
}

export interface ParsedIconSvg extends Required<Pick<IconLook, 'opacity'>> {
  size: number;
  /** Fill color (`#rrggbb`), or `null` when there is no fill. */
  fill: string | null;
  /** Same as `fill` (black when there is no fill), kept for the callers that only look at the color. */
  color: string;
  stroke: { color: string; width: number } | null;
  d: string[];
}

/** Reads back an SVG made by `iconSvg` (the outlines, the size of the square and how it is painted). Null for any other SVG. */
export function parseIconSvg(svg: string): ParsedIconSvg | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;
  const vb = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(root);
  if (!vb || vb[1] !== vb[2]) return null;
  const d = [...svg.matchAll(/<path\b[^>]*\sd="([^"]*)"/g)].map((m) => m[1]!);
  if (!d.length) return null;
  const f = /\bfill="([^"]*)"/.exec(root)?.[1];
  const fill = f === 'none' ? null : HEX.test(f ?? '') ? f!.toLowerCase() : '#000000';
  const sc = /\bstroke="(#[0-9a-fA-F]{6})"/.exec(root)?.[1];
  const sw = Number(/\bstroke-width="([\d.]+)"/.exec(root)?.[1] ?? 0);
  const op = Number(/\bfill-opacity="([\d.]+)"/.exec(root)?.[1] ?? 1);
  return { size: Number(vb[1]), fill, color: fill ?? '#000000', opacity: op >= 0 && op <= 1 ? op : 1, stroke: sc && sw > 0 ? { color: sc.toLowerCase(), width: sw } : null, d };
}

/** The same icon painted another way (what the patch leaves out stays as it was). Null when it is not an icon of this gallery. */
export function restyleSvg(svg: string, patch: IconLook): string | null {
  const p = parseIconSvg(svg);
  if (!p) return null;
  const px = Number(/\bwidth="(\d+)"/.exec(svg)?.[1] ?? p.size);
  return iconSvg(p.d, p.size, {
    fill: patch.fill !== undefined ? patch.fill : p.fill,
    opacity: patch.opacity !== undefined ? patch.opacity : p.opacity,
    stroke: patch.stroke !== undefined ? patch.stroke : p.stroke,
    px,
  });
}

/** The same icon in another fill color. */
export function recolorSvg(svg: string, color: string): string | null {
  return HEX.test(color) ? restyleSvg(svg, { fill: color }) : null;
}

export function svgDataUri(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/** The text of an SVG data URI (plain or base64), or null when it is not one. */
export function svgFromUri(uri: string): string | null {
  const m = /^data:image\/svg\+xml(?:;charset=[^;,]*)?(;base64)?,(.*)$/is.exec(uri);
  if (!m) return null;
  try {
    if (m[1]) {
      const bin = atob(m[2]!);
      return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    }
    return decodeURIComponent(m[2]!);
  } catch {
    return null;
  }
}
