import { boundsOf, unionRects, type Rect } from './geometry';
import type { Connector, DataField, Dash, Font, Page, Shape } from './model';
import { arrowPath, routeOf, type Route } from './route';
import { stencilOf, type PathDef } from './stencils';
import { visibleConnectors, visibleShapes } from './layers';
import { containerParts } from './container';

// ------------------------------------------------------------ text layout
// Text is measured with a table of average glyph widths so that the screen, the SVG export and the print output wrap
// at the same places without needing a browser.

const NARROW = new Set("iljtfI.,:;|!'`()[]/\\ ");
const WIDE = new Set('mwMW@%');

/** Typefaces clearly narrower than the average the table was made for (the one of imported Visio drawings). */
const NARROW_FONTS: Record<string, number> = { Calibri: 0.88 };

export function textWidth(s: string, size: number, bold = false, family = ''): number {
  let w = 0;
  for (const ch of s) {
    let k = 0.54;
    if (NARROW.has(ch)) k = 0.3;
    else if (WIDE.has(ch)) k = 0.82;
    else if (ch >= 'A' && ch <= 'Z') k = 0.64;
    else if (ch >= '0' && ch <= '9') k = 0.56;
    else if (ch.charCodeAt(0) > 0x2e80) k = 1; // CJK
    w += k;
  }
  return w * size * (bold ? 1.06 : 1) * (NARROW_FONTS[family] ?? 1);
}

/**
 * Break text into lines that fit `maxW`; explicit line breaks are kept. A word longer than a line stays whole (on a
 * line of its own) while it fits in `hardW`, the room there really is; only a word longer than that is split.
 */
export function wrapLines(text: string, maxW: number, font: Pick<Font, 'size' | 'bold'> & { family?: string }, wrap = true, hardW = maxW): string[] {
  const limit = Math.max(maxW, hardW);
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!wrap || maxW <= 0) {
      out.push(para);
      continue;
    }
    let line = '';
    for (const word of para.split(/(?<= )/)) {
      const trial = line + word;
      if (line && textWidth(trial.trimEnd(), font.size, font.bold, font.family) > maxW) {
        out.push(line.trimEnd());
        line = '';
      }
      let rest = word;
      while (textWidth(rest.trimEnd(), font.size, font.bold, font.family) > limit && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && textWidth(rest.slice(0, cut), font.size, font.bold, font.family) > limit) cut--;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line += rest;
    }
    out.push(line.trimEnd());
  }
  return out;
}

export const LINE_H = 1.25;

export interface TextLine {
  text: string;
  x: number;
  y: number;
}
export interface TextRun {
  lines: TextLine[];
  anchor: 'start' | 'middle' | 'end';
  font: Font;
  /** The text is turned (around this point) when it is drawn: lane titles of horizontal lanes. */
  rotate?: { deg: number; cx: number; cy: number };
}

/** `bounds` is the room around the text rectangle that a long word may use before it is split (the shape itself). */
function layout(text: string, rect: { x: number; y: number; w: number; h: number; wrap?: boolean }, font: Font, bounds?: { x: number; w: number }): TextRun | null {
  if (!text.trim() || (rect.w <= 0 && rect.wrap !== false)) return null;
  const pad = 4;
  const x = font.align === 'left' ? rect.x + pad : font.align === 'right' ? rect.x + rect.w - pad : rect.x + rect.w / 2;
  const room = !bounds ? 0 : font.align === 'left' ? bounds.x + bounds.w - x - 1 : font.align === 'right' ? x - bounds.x - 1 : 2 * Math.min(x - bounds.x, bounds.x + bounds.w - x) - 2;
  const lines = wrapLines(text, rect.w - 2 * pad, font, rect.wrap !== false, Math.max(rect.w - 2 * pad, room));
  const lh = font.size * LINE_H;
  const total = lines.length * lh;
  const top = font.valign === 'top' ? rect.y + pad : font.valign === 'bottom' ? rect.y + rect.h - total - pad : rect.y + (rect.h - total) / 2;
  return {
    anchor: font.align === 'left' ? 'start' : font.align === 'right' ? 'end' : 'middle',
    font,
    lines: lines.map((t, i) => ({ text: t, x, y: top + i * lh + font.size * 0.92 })),
  };
}

// ------------------------------------------------------------ shapes

export interface DrawnPath {
  d: string;
  /** Overlapping parts of the path leave holes. */
  evenOdd?: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
  dasharray?: string;
}
export interface ImageRender {
  href: string;
  w: number;
  h: number;
  /** SVG preserveAspectRatio */
  par: string;
  /** Alternative text. */
  alt?: string;
}
export interface ShapeRender {
  /** Position and rotation of the whole shape. */
  transform: string;
  /** Mirroring of the drawing (paths and picture) inside the box; empty when the shape is not mirrored. The text is never mirrored. */
  flip: string;
  paths: DrawnPath[];
  image: ImageRender | null;
  texts: TextRun[];
  /** The shape data shown under the shape, when asked for. */
  caption: TextRun | null;
  opacity: number;
  shadow: boolean;
}

/** Text with {{name}} replaced by the value of the shape datum of that name (unknown names stay as written). */
export function resolveText(text: string, data?: DataField[]): string {
  if (!data?.length || !text.includes('{{')) return text;
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, name) => {
    const f = data.find((d) => d.name.toLowerCase() === String(name).toLowerCase());
    return f ? f.value : m;
  });
}

export const dashArray = (dash: Dash, width: number): string | undefined => {
  const w = Math.max(1, width);
  switch (dash) {
    case 'dash': return `${w * 4} ${w * 3}`;
    case 'dot': return `${w} ${w * 2.2}`;
    case 'dashdot': return `${w * 4} ${w * 2} ${w} ${w * 2}`;
    default: return undefined;
  }
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Free-form outlines scaled to the shape's current size. As in Visio, the filled outlines of one shape that overlap
 * leave a hole (a ring is two outlines), so those that follow each other with the same line are one path.
 */
function outlinePaths(s: Shape): PathDef[] {
  const out: PathDef[] = [];
  for (const o of s.geometry ?? []) {
    if (o.pts.length < 2) continue;
    const d = `M${o.pts.map(([x, y]) => `${r2(x * s.w)},${r2(y * s.h)}`).join(' L')}${o.closed ? ' Z' : ''}`;
    const last = out[out.length - 1];
    if (o.fill && last?.fill === 'main' && last.stroke === o.stroke) {
      last.d += ` ${d}`;
      last.evenOdd = true;
    } else out.push({ d, fill: o.fill ? 'main' : 'none', stroke: o.stroke });
  }
  return out;
}

export function shapeRender(s: Shape): ShapeRender {
  const st = stencilOf(s.stencil);
  const parts = s.container ? containerParts(s) : null;
  const defs: PathDef[] = s.geometry?.length ? outlinePaths(s) : parts ? parts.paths : st.paths(s.w, s.h);
  const paths: DrawnPath[] = defs.map((p) => {
    const sw = s.style.strokeWidth * (p.width ?? 1);
    const hasStroke = p.stroke !== false && s.style.stroke !== 'none';
    return {
      d: p.d,
      ...(p.evenOdd ? { evenOdd: true } : {}),
      fill: p.fill === 'main' ? s.style.fill : p.fill === 'stroke' ? (s.style.stroke === 'none' ? s.style.fill : s.style.stroke) : p.fill === 'light' ? 'rgba(255,255,255,0.55)' : 'none',
      stroke: hasStroke ? s.style.stroke : 'none',
      strokeWidth: sw,
      dasharray: p.dashed ? `${Math.max(1, sw) * 4} ${Math.max(1, sw) * 3}` : dashArray(s.style.dash, sw),
    };
  });
  const texts: TextRun[] = [];
  const label = resolveText(s.text, s.data);
  const spec = st.text ? st.text(s.w, s.h) : { x: 0, y: 0, w: s.w, h: s.h };
  if (st.sections) {
    const parts = label.split(/\n-{3,}\n?/);
    const head = 30;
    const rest = (s.h - head) / 2;
    const rects = [
      { x: 0, y: 0, w: s.w, h: head },
      { x: 0, y: head, w: s.w, h: rest },
      { x: 0, y: head + rest, w: s.w, h: rest },
    ];
    parts.slice(0, 3).forEach((t, i) => {
      const f: Font = i === 0 ? { ...s.font, bold: true, align: 'center', valign: 'middle' } : { ...s.font, align: 'left', valign: 'top' };
      const run = layout(t, rects[i]!, f, { x: 0, w: s.w });
      if (run) texts.push(run);
    });
  } else {
    const run = layout(label, spec, s.font, { x: 0, w: s.w });
    if (run) texts.push(run);
  }
  if (parts && s.container!.kind === 'pool') {
    // the lane titles
    for (const t of parts.titles) {
      const f: Font = { ...s.font, align: 'center', valign: 'middle', bold: true };
      if (t.rotate) {
        // laid out as if the band were lying down, then turned a quarter back
        const cx = t.rect.x + t.rect.w / 2;
        const cy = t.rect.y + t.rect.h / 2;
        const run = layout(t.text, { x: cx - t.rect.h / 2, y: cy - t.rect.w / 2, w: t.rect.h, h: t.rect.w }, f);
        if (run) texts.push({ ...run, rotate: { deg: -90, cx, cy } });
      } else {
        const run = layout(t.text, t.rect, f);
        if (run) texts.push(run);
      }
    }
  }
  const flip = s.flipH || s.flipV ? `translate(${s.flipH ? s.w : 0} ${s.flipV ? s.h : 0}) scale(${s.flipH ? -1 : 1} ${s.flipV ? -1 : 1})` : '';
  const image: ImageRender | null = s.image ? { href: s.image.src, w: s.w, h: s.h, par: s.image.fit === 'stretch' ? 'none' : s.image.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet', ...(s.image.alt ? { alt: s.image.alt } : {}) } : null;
  let caption: TextRun | null = null;
  if (s.showData && s.data?.length) {
    const f: Font = { ...s.font, size: Math.max(9, Math.round(s.font.size * 0.85)), color: '#555555', bold: false, italic: false, underline: false, align: 'left', valign: 'top' };
    const lines = s.data.map((d) => `${d.name}: ${d.value}`).join('\n');
    const h = s.data.length * f.size * LINE_H + 8;
    caption = layout(lines, { x: 0, y: s.h + 2, w: Math.max(s.w, 120), h, wrap: false }, f);
  }
  return {
    transform: `translate(${s.x} ${s.y})${s.rot ? ` rotate(${s.rot} ${s.w / 2} ${s.h / 2})` : ''}`,
    flip,
    paths,
    image,
    texts,
    caption,
    opacity: s.style.opacity,
    shadow: s.style.shadow,
  };
}

// ------------------------------------------------------------ connectors

export interface ConnectorRender {
  route: Route;
  stroke: string;
  strokeWidth: number;
  dasharray?: string;
  arrows: { d: string; fill: boolean }[];
  label: { run: TextRun; box: Rect } | null;
}

export function connectorRender(c: Connector, page: Page): ConnectorRender {
  const route = routeOf(c, page);
  const size = Math.max(10, c.strokeWidth * 5);
  const arrows: { d: string; fill: boolean }[] = [];
  const a = arrowPath(c.startArrow, route.points[0]!, route.startDir, size);
  const b = arrowPath(c.endArrow, route.points[route.points.length - 1]!, route.endDir, size);
  if (a) arrows.push(a);
  if (b) arrows.push(b);
  let label: ConnectorRender['label'] = null;
  if (c.text.trim()) {
    const lines = wrapLines(c.text, 160, c.font, true, 320);
    const w = Math.max(...lines.map((l) => textWidth(l, c.font.size, c.font.bold, c.font.family))) + 8;
    const h = lines.length * c.font.size * LINE_H + 4;
    const box = { x: route.mid.x - w / 2, y: route.mid.y - h / 2, w, h };
    // the lines are already broken: the box is measured on them
    const run = layout(lines.join('\n'), { x: box.x, y: box.y, w, h, wrap: false }, { ...c.font, align: 'center', valign: 'middle' });
    if (run) label = { run: { ...run, lines: run.lines.map((l) => ({ ...l, x: route.mid.x })) }, box };
  }
  return { route, stroke: c.stroke, strokeWidth: c.strokeWidth, dasharray: dashArray(c.dash, c.strokeWidth), arrows, label };
}

// ------------------------------------------------------------ content bounds

export function contentBounds(page: Page): Rect | null {
  const rects: Rect[] = visibleShapes(page).map(boundsOf);
  for (const c of visibleConnectors(page)) {
    const pts = routeOf(c, page).points;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    rects.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
  }
  return unionRects(rects);
}
