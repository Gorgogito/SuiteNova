import { unionRects, type Rect } from './geometry';
import type { Page } from './model';
import { printablePage } from './layers';
import { connectorRender, contentBounds, shapeRender, type TextRun } from './render';

export const escXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number): string => String(Math.round(v * 100) / 100);

function textSvg(run: TextRun): string {
  const f = run.font;
  const attrs = [
    `font-family="${escXml(f.family)}, sans-serif"`,
    `font-size="${f.size}"`,
    `fill="${escXml(f.color)}"`,
    `text-anchor="${run.anchor}"`,
    f.bold ? 'font-weight="700"' : '',
    f.italic ? 'font-style="italic"' : '',
    f.underline ? 'text-decoration="underline"' : '',
  ].filter(Boolean);
  if (run.rotate) attrs.push(`transform="rotate(${num(run.rotate.deg)} ${num(run.rotate.cx)} ${num(run.rotate.cy)})"`);
  return `<text ${attrs.join(' ')}>${run.lines.map((l) => `<tspan x="${num(l.x)}" y="${num(l.y)}">${escXml(l.text) || '&#160;'}</tspan>`).join('')}</text>`;
}

export interface SvgOptions {
  /** "page" draws the whole page; "content" crops to the drawing plus a margin. */
  area?: 'page' | 'content';
  margin?: number;
  /** Transparent instead of the page colour. */
  transparent?: boolean;
}

/** The region that an export covers, in page coordinates. */
export function exportArea(page: Page, opts: SvgOptions = {}): Rect {
  const pageRect = { x: 0, y: 0, w: page.width, h: page.height };
  const content = contentBounds(page);
  const m = opts.margin ?? 16;
  if (opts.area === 'content' && content) return { x: content.x - m, y: content.y - m, w: content.w + 2 * m, h: content.h + 2 * m };
  // content that sticks out of the page is not cut off
  return unionRects(content ? [pageRect, content] : [pageRect])!;
}

/** A standalone SVG document of one page. */
export function pageToSvg(full: Page, opts: SvgOptions = {}): string {
  // hidden layers and layers that are not printable are left out
  const page = printablePage(full);
  const area = exportArea(page, opts);
  const parts: string[] = [];
  const shadows = page.shapes.some((s) => s.style.shadow);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${num(area.w)}" height="${num(area.h)}" viewBox="${num(area.x)} ${num(area.y)} ${num(area.w)} ${num(area.h)}">`);
  parts.push(`<title>${escXml(page.name)}</title>`);
  if (shadows) parts.push('<defs><filter id="sh" x="-20%" y="-20%" width="150%" height="150%"><feDropShadow dx="3" dy="3" stdDeviation="2" flood-opacity="0.35"/></filter></defs>');
  if (!opts.transparent) parts.push(`<rect x="${num(area.x)}" y="${num(area.y)}" width="${num(area.w)}" height="${num(area.h)}" fill="${escXml(page.background)}"/>`);
  for (const s of page.shapes) {
    const r = shapeRender(s);
    const g = [`transform="${r.transform}"`, r.opacity < 1 ? `opacity="${r.opacity}"` : '', r.shadow ? 'filter="url(#sh)"' : ''].filter(Boolean).join(' ');
    if (s.link?.url) parts.push(`<a href="${escXml(s.link.url)}"${s.link.tip ? ` xlink:title="${escXml(s.link.tip)}"` : ''}>`);
    parts.push(`<g ${g}>`);
    if (r.flip) parts.push(`<g transform="${r.flip}">`);
    if (r.image) parts.push(`<image href="${escXml(r.image.href)}" x="0" y="0" width="${num(r.image.w)}" height="${num(r.image.h)}" preserveAspectRatio="${r.image.par}"/>`);
    for (const p of r.paths) parts.push(`<path d="${p.d}" fill="${escXml(p.fill)}" stroke="${escXml(p.stroke)}" stroke-width="${num(p.strokeWidth)}"${p.dasharray ? ` stroke-dasharray="${p.dasharray}"` : ''} stroke-linejoin="round"/>`);
    if (r.flip) parts.push('</g>');
    for (const t of r.texts) parts.push(textSvg(t));
    if (r.caption) parts.push(textSvg(r.caption));
    parts.push('</g>');
    if (s.link?.url) parts.push('</a>');
  }
  for (const c of page.connectors) {
    const r = connectorRender(c, page);
    parts.push('<g>');
    parts.push(`<path d="${r.route.d}" fill="none" stroke="${escXml(r.stroke)}" stroke-width="${num(r.strokeWidth)}"${r.dasharray ? ` stroke-dasharray="${r.dasharray}"` : ''} stroke-linejoin="round"/>`);
    for (const a of r.arrows) parts.push(`<path d="${a.d}" fill="${a.fill ? escXml(r.stroke) : page.background}" stroke="${escXml(r.stroke)}" stroke-width="${num(r.strokeWidth)}" stroke-linejoin="round"/>`);
    if (r.label) {
      parts.push(`<rect x="${num(r.label.box.x)}" y="${num(r.label.box.y)}" width="${num(r.label.box.w)}" height="${num(r.label.box.h)}" fill="${escXml(page.background)}"/>`);
      parts.push(textSvg(r.label.run));
    }
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('\n');
}
