import type { Contour } from './types';

/*
 * Dibujo del texto deformado como SVG. Los colores ya vienen resueltos (css): quien llama (Slides, Writer o Calc) los saca de su
 * propio modelo y de su tema. Sin relieve 3D.
 */

export interface FxColor {
  /** Color css (`#rrggbb`). */
  color: string;
  /** Opacidad de 0 a 1 (1 si falta). */
  alpha?: number;
}

export type FxFill = { type: 'none' } | ({ type: 'solid' } & FxColor) | { type: 'gradient'; /** grados, 0 = de izquierda a derecha, 90 = de arriba abajo */ angle: number; stops: ({ pos: number } & FxColor)[] };

export interface WordArtFx {
  fill: FxFill;
  outline?: FxColor & { width: number };
  shadow?: FxColor & { blur: number; dx: number; dy: number };
  glow?: FxColor & { radius: number };
  /** Reflejo: opacidad inicial, hasta qué fracción del alto se ve y separación en px. */
  reflection?: { alpha: number; size: number; gap: number };
}

const num = (n: number) => (Math.round(n * 100) / 100).toString();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** El trazado SVG (`d`) de unos contornos. */
export function contoursToPath(contours: Contour[]): string {
  let d = '';
  for (const c of contours) {
    if (!c.length) continue;
    d += `M${num(c[0]!.x)} ${num(c[0]!.y)}`;
    for (let i = 1; i < c.length; i++) d += `L${num(c[i]!.x)} ${num(c[i]!.y)}`;
    d += 'Z';
  }
  return d;
}

export function boundsOf(contours: Contour[]): { x: number; y: number; width: number; height: number } {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const c of contours) for (const p of c) {
    x1 = Math.min(x1, p.x);
    y1 = Math.min(y1, p.y);
    x2 = Math.max(x2, p.x);
    y2 = Math.max(y2, p.y);
  }
  return Number.isFinite(x1) ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } : { x: 0, y: 0, width: 0, height: 0 };
}

/**
 * Marcado SVG (sin el elemento `<svg>`) de los contornos con el estilo dado. `id` debe ser único en la página: se usa para los
 * degradados y filtros. Orden de dibujo: resplandor, sombra, reflejo, texto.
 */
export function wordArtSvg(contours: Contour[], fx: WordArtFx, id: string): string {
  const d = contoursToPath(contours);
  if (!d) return '';
  const b = boundsOf(contours);
  let defs = '';
  let fill = 'none';
  if (fx.fill.type === 'solid') fill = fx.fill.color;
  else if (fx.fill.type === 'gradient') {
    const a = (fx.fill.angle * Math.PI) / 180;
    const x2 = 0.5 + Math.cos(a) / 2;
    const y2 = 0.5 + Math.sin(a) / 2;
    defs += `<linearGradient id="${esc(id)}-g" gradientUnits="objectBoundingBox" x1="${num(1 - x2)}" y1="${num(1 - y2)}" x2="${num(x2)}" y2="${num(y2)}">${fx.fill.stops
      .map((s) => `<stop offset="${num(s.pos * 100)}%" stop-color="${esc(s.color)}"${s.alpha !== undefined && s.alpha < 1 ? ` stop-opacity="${num(s.alpha)}"` : ''}/>`)
      .join('')}</linearGradient>`;
    fill = `url(#${esc(id)}-g)`;
  }
  const fillAlpha = fx.fill.type === 'solid' && fx.fill.alpha !== undefined && fx.fill.alpha < 1 ? ` fill-opacity="${num(fx.fill.alpha)}"` : '';
  const stroke = fx.outline ? ` stroke="${esc(fx.outline.color)}" stroke-width="${num(fx.outline.width)}" stroke-linejoin="round"${fx.outline.alpha !== undefined && fx.outline.alpha < 1 ? ` stroke-opacity="${num(fx.outline.alpha)}"` : ''}` : '';
  const text = `<path d="${d}" fill="${fill}"${fillAlpha}${stroke}/>`;
  let before = '';
  if (fx.glow) {
    defs += `<filter id="${esc(id)}-glow" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="${num(fx.glow.radius / 2)}"/></filter>`;
    before += `<path d="${d}" fill="${esc(fx.glow.color)}" fill-opacity="${num(fx.glow.alpha ?? 0.6)}" stroke="${esc(fx.glow.color)}" stroke-width="${num(fx.glow.radius / 2)}" stroke-opacity="${num(fx.glow.alpha ?? 0.6)}" filter="url(#${esc(id)}-glow)"/>`;
  }
  if (fx.shadow) {
    defs += `<filter id="${esc(id)}-sh" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="${num(fx.shadow.blur / 2)}"/></filter>`;
    before += `<path d="${d}" transform="translate(${num(fx.shadow.dx)} ${num(fx.shadow.dy)})" fill="${esc(fx.shadow.color)}" fill-opacity="${num(fx.shadow.alpha ?? 0.45)}" filter="url(#${esc(id)}-sh)"/>`;
  }
  if (fx.reflection) {
    const r = fx.reflection;
    const base = b.y + b.height;
    defs += `<linearGradient id="${esc(id)}-rg" gradientUnits="userSpaceOnUse" x1="0" y1="${num(base + r.gap)}" x2="0" y2="${num(base + r.gap + b.height * r.size)}"><stop offset="0" stop-color="#fff" stop-opacity="${num(r.alpha)}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
    defs += `<mask id="${esc(id)}-rm" maskUnits="userSpaceOnUse" x="${num(b.x - 10)}" y="${num(base)}" width="${num(b.width + 20)}" height="${num(b.height * 2 + r.gap + 10)}"><rect x="${num(b.x - 10)}" y="${num(base)}" width="${num(b.width + 20)}" height="${num(b.height * 2 + r.gap + 10)}" fill="url(#${esc(id)}-rg)"/></mask>`;
    before += `<g mask="url(#${esc(id)}-rm)"><path d="${d}" transform="translate(0 ${num(2 * base + r.gap)}) scale(1 -1)" fill="${fill}"${fillAlpha}${stroke}/></g>`;
  }
  return `${defs ? `<defs>${defs}</defs>` : ''}${before}${text}`;
}
