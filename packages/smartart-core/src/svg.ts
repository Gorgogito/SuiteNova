import { shapeSvg } from '@suitenova/shapes-core';
import type { DrawnShape } from './drawing';
import { kid, kidsOf, local, serializeXml, type El } from './xml';

/*
 * El dibujo de un SmartArt como SVG (para mostrarlo en Writer, Calc y las vistas previas). Usa los colores del tema de Office por
 * omisión; el texto sale centrado, con el color y el tamaño del dibujo si los trae.
 */

const THEME: Record<string, string> = { accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5', accent4: '#ffc000', accent5: '#5b9bd5', accent6: '#70ad47', lt1: '#ffffff', dk1: '#000000', tx1: '#000000', bg1: '#ffffff', lt2: '#e7e6e6', dk2: '#44546a', tx2: '#44546a', bg2: '#e7e6e6' };

const mix = (hex: string, to: number, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - k) + to * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

/** Un color de DrawingML (`a:schemeClr` o `a:srgbClr` con `tint`, `shade`, `alpha`) como color css y opacidad. */
export function drawingColor(c: El | undefined): { color: string; alpha: number } | null {
  const e = c?.kids[0];
  if (!e) return null;
  let hex = local(e.name) === 'srgbClr' ? `#${e.attrs.val}` : (THEME[e.attrs.val ?? ''] ?? '#808080');
  let alpha = 1;
  for (const m of e.kids) {
    const v = Number(m.attrs.val ?? 0) / 100000;
    const n = local(m.name);
    if (n === 'tint') hex = mix(hex, 255, 1 - v);
    else if (n === 'shade') hex = mix(hex, 0, 1 - v);
    else if (n === 'alpha') alpha = v;
  }
  return { color: hex, alpha };
}

const fillOf = (s: DrawnShape) => {
  const f = s.spPr.find((x) => local(x.name) === 'solidFill');
  return f ? drawingColor(f) : null;
};
const lineOf = (s: DrawnShape): { color: string; width: number } | null => {
  const ln = s.spPr.find((x) => local(x.name) === 'ln');
  if (!ln || kid(ln, 'noFill')) return null;
  const c = drawingColor(kid(ln, 'solidFill'));
  return c ? { color: c.color, width: Math.max(0.5, Number(ln.attrs.w ?? 12700) / 12700) } : null;
};

/** Los segmentos de una geometría propia (conector): `moveTo` y `lnTo` en puntos. */
function customPath(g: El): string {
  const path = kid(kid(g, 'pathLst'), 'path');
  if (!path) return '';
  let d = '';
  for (const k of path.kids) {
    const pt = kid(k, 'pt');
    if (!pt) continue;
    d += `${local(k.name) === 'moveTo' ? 'M' : 'L'}${Number(pt.attrs.x) / 12700} ${Number(pt.attrs.y) / 12700}`;
  }
  return d;
}

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Párrafos de texto de una forma, con su nivel de sangría. */
export function drawnParagraphs(s: DrawnShape): { text: string; sz?: number }[] {
  const out: { text: string; sz?: number }[] = [];
  const walk = (e: El) => {
    if (local(e.name) === 'p') {
      const runs = kidsOf(e, 'r');
      const text = runs.map((r) => unesc(serializeXml(kid(r, 't') ?? r).replace(/<[^>]*>/g, ''))).join('');
      const sz = Number(kid(runs[0], 'rPr')?.attrs.sz ?? kid(e, 'pPr')?.attrs.sz ?? 0) / 100;
      if (text) out.push({ text, sz: sz || undefined });
    } else e.kids.forEach(walk);
  };
  if (s.txBody) walk(s.txBody);
  return out;
}

const textColorOf = (s: DrawnShape): string => {
  const ref = kid(s.style, 'fontRef');
  const c = drawingColor(ref ?? undefined);
  return c ? c.color : '#000000';
};

export interface SvgOptions {
  /** Dibujar el texto (por omisión sí). */
  text?: boolean;
  /** Ancho y alto del SVG en la unidad del destino; por omisión, el espacio del dibujo (puntos). */
  width?: number;
  height?: number;
}

/** El SVG de un dibujo cuyo espacio es de `w` x `h` puntos. */
export function drawingSvg(shapes: DrawnShape[], w: number, h: number, o: SvgOptions = {}): string {
  const text = o.text !== false;
  const body = shapes
    .map((s) => {
      const x = s.x / 12700;
      const y = s.y / 12700;
      const sw = s.w / 12700;
      const sh = s.h / 12700;
      const rot = s.rot / 60000;
      const f = fillOf(s);
      const ln = lineOf(s);
      const flip = `${s.flipH ? ` translate(${sw} 0) scale(-1 1)` : ''}${s.flipV ? ` translate(0 ${sh}) scale(1 -1)` : ''}`;
      const tr = `translate(${x} ${y})${rot ? ` rotate(${rot} ${sw / 2} ${sh / 2})` : ''}`;
      if (s.custGeom) return `<path d="${customPath(s.custGeom)}" transform="${tr}${flip}" fill="none" stroke="${ln?.color ?? '#4472c4'}" stroke-width="${ln?.width ?? 1}"/>`;
      let shape = shapeSvg(s.prst ?? 'rect', sw, sh, { fill: f ? f.color : null, stroke: ln?.color ?? null, strokeWidth: ln?.width ?? 0, adj: s.adj });
      if (f && f.alpha < 1) shape = shape.replace(/<path /g, `<path fill-opacity="${f.alpha}" `);
      let label = '';
      const lines = text ? drawnParagraphs(s) : [];
      if (lines.length) {
        const tx = s.txXfrm ? s.txXfrm.x / 12700 - x : 0;
        const ty = s.txXfrm ? s.txXfrm.y / 12700 - y : 0;
        const tw = s.txXfrm ? s.txXfrm.w / 12700 : sw;
        const th = s.txXfrm ? s.txXfrm.h / 12700 : sh;
        const size = lines[0]!.sz || Math.max(6, Math.min(th / (lines.length + 0.6), (tw / Math.max(3, ...lines.map((l) => l.text.length))) * 1.9, 28));
        const top = ty + th / 2 - ((lines.length - 1) * size * 1.2) / 2 + size * 0.35;
        label = `<text x="${tx + tw / 2}" y="${top}" text-anchor="middle" font-size="${size}" font-family="Calibri, Carlito, Arial, sans-serif" fill="${textColorOf(s)}">${lines.map((l, j) => `<tspan x="${tx + tw / 2}"${j ? ` dy="${size * 1.2}"` : ''}>${esc(l.text)}</tspan>`).join('')}</text>`;
      }
      return `<g transform="${tr}${flip}">${shape}${label}</g>`;
    })
    .join('');
  const wAttr = o.width ?? w;
  const hAttr = o.height ?? h;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${wAttr}" height="${hAttr}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}
