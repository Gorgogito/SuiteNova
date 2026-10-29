import { clrCss, resolveClr, toCss, type Clr, type ColorContext, type Effects, type Fill, type Ln, type LineEnd, type Rgba } from '@suitenova/slides-core';
import { Fragment, type ReactNode } from 'react';
import { imageDims } from './assets';
import { patternTile } from './patterns';

/*
 * SVG paint servers for DrawingML fills, lines and effects. Everything here is pure: it takes the resolved fill/line/effects and
 * returns SVG definitions plus the attribute values that refer to them.
 */

export interface RenderEnv {
  cc: ColorContext;
  /** URL to show an asset (object URL) */
  assetUrl(id: string | undefined): string;
}

/** `phClr` stands for the colour given by the style reference. */
export function withPh(cc: ColorContext, ref: { c?: Clr } | undefined): ColorContext {
  if (!ref?.c) return cc;
  return { ...cc, phClr: resolveClr(ref.c, { ...cc, phClr: undefined }) };
}

const css = (c: Clr | undefined, cc: ColorContext) => clrCss(c, cc);
const alphaOf = (c: Clr | undefined, cc: ColorContext): number => resolveClr(c, cc).a;
const rgbOf = (c: Rgba): string => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;

export interface Paint {
  defs: ReactNode;
  /** value for `fill` or `stroke` */
  value: string;
  opacity?: number;
  /** an image fill is drawn as a layer clipped to the shape; the caller draws `layer` instead of using `value` */
  layer?: (d: string) => ReactNode;
}

/** Gradient line from an angle (degrees, clockwise from the x axis) covering a w × h box. */
function gradLine(ang: number, w: number, h: number): [number, number, number, number] {
  const a = (ang * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const len = Math.abs(w * dx) + Math.abs(h * dy);
  const cx = w / 2;
  const cy = h / 2;
  return [cx - (dx * len) / 2, cy - (dy * len) / 2, cx + (dx * len) / 2, cy + (dy * len) / 2];
}

export function paintFor(fill: Fill | undefined, id: string, w: number, h: number, env: RenderEnv, ph?: { c?: Clr }): Paint {
  const cc = withPh(env.cc, ph);
  if (!fill || fill.t === 'none' || fill.t === 'inherit' || fill.t === 'group') return { defs: null, value: 'none' };
  if (fill.t === 'solid') {
    const a = alphaOf(fill.c, cc);
    return { defs: null, value: rgbOf(resolveClr(fill.c, cc)), ...(a < 1 ? { opacity: a } : {}) };
  }
  if (fill.t === 'grad') {
    const stops = [...fill.stops].sort((a, b) => a.pos - b.pos);
    const stopEls = stops.map((s, i) => {
      const c = resolveClr(s.c, cc);
      return <stop key={i} offset={`${s.pos / 1000}%`} stopColor={rgbOf(c)} stopOpacity={c.a} />;
    });
    if (fill.path) {
      const r = fill.path.rect;
      const fx = r ? (r.l + (100000 - r.r)) / 2 / 100000 : 0.5;
      const fy = r ? (r.t + (100000 - r.b)) / 2 / 100000 : 0.5;
      // PowerPoint's path gradients run from the focus (first stop) out to the edges (last stop)
      const radius = fill.path.kind === 'circle' ? Math.hypot(w, h) / 2 : Math.max(w, h) / 2 + Math.min(w, h) / 2;
      const rev = [...stops].reverse().map((s, i) => {
        const c = resolveClr(s.c, cc);
        return <stop key={i} offset={`${(100000 - s.pos) / 1000}%`} stopColor={rgbOf(c)} stopOpacity={c.a} />;
      });
      void stopEls;
      return {
        defs: (
          <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={fx * w} cy={fy * h} r={radius} fx={fx * w} fy={fy * h}>
            {rev}
          </radialGradient>
        ),
        value: `url(#${id})`,
      };
    }
    const [x1, y1, x2, y2] = gradLine(fill.lin?.ang ?? 0, w, h);
    return { defs: <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>{stopEls}</linearGradient>, value: `url(#${id})` };
  }
  if (fill.t === 'patt') {
    const fg = resolveClr(fill.fg, cc);
    const bg = resolveClr(fill.bg, cc);
    const tile = patternTile(fill.prst);
    const cell = 0.75;
    return {
      defs: (
        <pattern id={id} patternUnits="userSpaceOnUse" width={8 * cell} height={8 * cell}>
          <rect width={8 * cell} height={8 * cell} fill={rgbOf(bg)} fillOpacity={bg.a} />
          {tile.map((row, y) => [...row].map((c, x) => (c === '1' ? <rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill={rgbOf(fg)} fillOpacity={fg.a} /> : null)))}
        </pattern>
      ),
      value: `url(#${id})`,
    };
  }
  // picture fill
  const url = env.assetUrl(fill.src);
  if (!url) return { defs: null, value: 'none' };
  const opacity = fill.alpha !== undefined ? fill.alpha / 100 : undefined;
  if (fill.tile) {
    const t = fill.tile;
    const dims = imageDims(url);
    const tw = (dims.w * 0.75 * t.sx) / 100;
    const th = (dims.h * 0.75 * t.sy) / 100;
    return {
      defs: (
        <pattern id={id} patternUnits="userSpaceOnUse" width={tw} height={th} x={t.tx} y={t.ty}>
          <image href={url} width={tw} height={th} preserveAspectRatio="none" />
        </pattern>
      ),
      value: `url(#${id})`,
      opacity,
    };
  }
  const sr = fill.srcRect ?? { l: 0, t: 0, r: 0, b: 0 };
  const vis = (v: number) => 1 - v / 100000;
  const iw = (w * 1) / Math.max(0.01, vis(sr.l) - sr.r / 100000);
  const ih = (h * 1) / Math.max(0.01, vis(sr.t) - sr.b / 100000);
  const ix = -(sr.l / 100000) * iw;
  const iy = -(sr.t / 100000) * ih;
  return {
    defs: null,
    value: 'none',
    opacity,
    layer: (d: string) => (
      <g>
        <clipPath id={`${id}c`}>
          <path d={d} />
        </clipPath>
        <image href={url} x={ix} y={iy} width={iw} height={ih} preserveAspectRatio="none" clipPath={`url(#${id}c)`} opacity={opacity} />
      </g>
    ),
  };
}

// ------------------------------------------------------------------------------------------------ lines

const DASH: Record<string, number[]> = {
  dot: [1, 3],
  dash: [4, 3],
  lgDash: [8, 3],
  dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 1],
  sysDot: [1, 1],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
};

const END_SIZE: Record<string, number> = { sm: 2, med: 3, lg: 5 };

function marker(id: string, end: LineEnd, color: string, lw: number, head: boolean): ReactNode {
  const w = (END_SIZE[end.w ?? 'med'] ?? 3) * Math.max(lw, 1.5);
  const l = (END_SIZE[end.len ?? 'med'] ?? 3) * Math.max(lw, 1.5);
  const common = { id, markerUnits: 'userSpaceOnUse' as const, markerWidth: l, markerHeight: w, orient: 'auto-start-reverse' as const, overflow: 'visible' as const };
  switch (end.type) {
    case 'triangle':
      return (
        <marker {...common} refX={head ? 0 : l} refY={w / 2} viewBox={`0 0 ${l} ${w}`}>
          <path d={head ? `M${l} 0L0 ${w / 2}L${l} ${w}Z` : `M0 0L${l} ${w / 2}L0 ${w}Z`} fill={color} />
        </marker>
      );
    case 'stealth':
      return (
        <marker {...common} refX={head ? 0 : l} refY={w / 2} viewBox={`0 0 ${l} ${w}`}>
          <path d={head ? `M${l} 0L0 ${w / 2}L${l} ${w}L${l * 0.7} ${w / 2}Z` : `M0 0L${l} ${w / 2}L0 ${w}L${l * 0.3} ${w / 2}Z`} fill={color} />
        </marker>
      );
    case 'diamond':
      return (
        <marker {...common} refX={l / 2} refY={w / 2} viewBox={`0 0 ${l} ${w}`}>
          <path d={`M0 ${w / 2}L${l / 2} 0L${l} ${w / 2}L${l / 2} ${w}Z`} fill={color} />
        </marker>
      );
    case 'oval':
      return (
        <marker {...common} refX={l / 2} refY={w / 2} viewBox={`0 0 ${l} ${w}`}>
          <ellipse cx={l / 2} cy={w / 2} rx={l / 2} ry={w / 2} fill={color} />
        </marker>
      );
    case 'arrow':
      return (
        <marker {...common} refX={head ? 0 : l} refY={w / 2} viewBox={`0 0 ${l} ${w}`}>
          <path d={head ? `M${l} 0L0 ${w / 2}L${l} ${w}` : `M0 0L${l} ${w / 2}L0 ${w}`} fill="none" stroke={color} strokeWidth={Math.max(lw, 1)} strokeLinejoin="miter" />
        </marker>
      );
    default:
      return null;
  }
}

export interface Stroke {
  defs: ReactNode;
  attrs: Record<string, string | number | undefined>;
  /** extra strokes for compound lines (drawn with the same path) */
  none: boolean;
}

export function strokeFor(ln: Ln | undefined, id: string, w: number, h: number, env: RenderEnv, ph?: { c?: Clr }, minWidth = 0): Stroke {
  if (!ln || !ln.fill || ln.fill.t === 'none' || ln.fill.t === 'inherit') return { defs: null, attrs: {}, none: true };
  const lw = Math.max(ln.w ?? 0.75, minWidth);
  const p = paintFor(ln.fill, `${id}s`, w, h, env, ph);
  if (p.value === 'none') return { defs: null, attrs: {}, none: true };
  const attrs: Stroke['attrs'] = { stroke: p.value, strokeWidth: lw, strokeOpacity: p.opacity };
  attrs.strokeLinecap = ln.cap === 'rnd' ? 'round' : ln.cap === 'sq' ? 'square' : 'butt';
  attrs.strokeLinejoin = ln.join === 'round' ? 'round' : ln.join === 'bevel' ? 'bevel' : ln.join === 'miter' ? 'miter' : 'round';
  if (ln.miterLim) attrs.strokeMiterlimit = ln.miterLim;
  const dash = ln.custDash ? ln.custDash.map((v) => v / 100000) : ln.dash && ln.dash !== 'solid' ? DASH[ln.dash] : undefined;
  if (dash) {
    // dashes are multiples of the line width; round and square caps already extend each dash by half the width
    const extra = ln.cap === 'rnd' || ln.cap === 'sq' ? 1 : 0;
    attrs.strokeDasharray = dash.map((v, i) => (i % 2 === 0 ? Math.max(0.1, (v - extra) * lw) : (v + extra) * lw)).join(' ');
  }
  const cc = withPh(env.cc, ph);
  const color = ln.fill.t === 'solid' ? rgbOf(resolveClr(ln.fill.c, cc)) : '#000';
  const defs: ReactNode[] = [<Fragment key="p">{p.defs}</Fragment>];
  if (ln.head && ln.head.type !== 'none') {
    defs.push(<Fragment key="mh">{marker(`${id}mh`, ln.head, color, lw, true)}</Fragment>);
    attrs.markerStart = `url(#${id}mh)`;
  }
  if (ln.tail && ln.tail.type !== 'none') {
    defs.push(<Fragment key="mt">{marker(`${id}mt`, ln.tail, color, lw, false)}</Fragment>);
    attrs.markerEnd = `url(#${id}mt)`;
  }
  return { defs, attrs, none: false };
}

// ------------------------------------------------------------------------------------------------ effects

export interface EffectRender {
  defs: ReactNode;
  /** `filter` attribute value for the drawn content, or undefined */
  filter?: string;
  /** reflection CSS for the wrapper */
  reflection?: string;
}

const rad = (d: number) => (d * Math.PI) / 180;

export function effectsFor(e: Effects | undefined, id: string, env: RenderEnv, ph?: { c?: Clr }): EffectRender {
  if (!e) return { defs: null };
  const cc = withPh(env.cc, ph);
  const parts: ReactNode[] = [];
  let last = 'SourceGraphic';
  let n = 0;
  const nm = () => `${id}r${n++}`;
  if (e.softEdge) {
    const a = nm();
    const b = nm();
    parts.push(<feMorphology key={a} in={last} operator="erode" radius={e.softEdge.rad / 2} result={a} />, <feGaussianBlur key={b} in={a} stdDeviation={e.softEdge.rad / 2} result={b} />);
    last = b;
  }
  if (e.blur) {
    const a = nm();
    parts.push(<feGaussianBlur key={a} in={last} stdDeviation={e.blur.rad / 2} result={a} />);
    last = a;
  }
  const merged: string[] = [];
  if (e.outer) {
    const o = e.outer;
    const c = resolveClr(o.c, cc);
    const dx = o.dist * Math.cos(rad(o.dir));
    const dy = o.dist * Math.sin(rad(o.dir));
    const blur = nm();
    const off = nm();
    const flood = nm();
    const comp = nm();
    // a "perspective" shadow (scaled / skewed) is drawn as a plain offset one
    parts.push(
      <feGaussianBlur key={blur} in="SourceAlpha" stdDeviation={Math.max(0, o.blur / 2)} result={blur} />,
      <feOffset key={off} in={blur} dx={dx} dy={dy} result={off} />,
      <feFlood key={flood} floodColor={rgbOf(c)} floodOpacity={c.a} result={flood} />,
      <feComposite key={comp} in={flood} in2={off} operator="in" result={comp} />,
    );
    merged.push(comp);
  }
  if (e.glow) {
    const c = resolveClr(e.glow.c, cc);
    const blur = nm();
    const flood = nm();
    const comp = nm();
    parts.push(
      <feMorphology key={`${blur}m`} in="SourceAlpha" operator="dilate" radius={e.glow.rad / 4} result={`${blur}m`} />,
      <feGaussianBlur key={blur} in={`${blur}m`} stdDeviation={e.glow.rad / 2} result={blur} />,
      <feFlood key={flood} floodColor={rgbOf(c)} floodOpacity={c.a} result={flood} />,
      <feComposite key={comp} in={flood} in2={blur} operator="in" result={comp} />,
    );
    merged.push(comp);
  }
  const body = last;
  let withInner = body;
  if (e.inner) {
    const o = e.inner;
    const c = resolveClr(o.c, cc);
    const dx = o.dist * Math.cos(rad(o.dir));
    const dy = o.dist * Math.sin(rad(o.dir));
    const inv = nm();
    const blur = nm();
    const off = nm();
    const flood = nm();
    const comp = nm();
    const out = nm();
    parts.push(
      <feComponentTransfer key={inv} in="SourceAlpha" result={inv}>
        <feFuncA type="table" tableValues="1 0" />
      </feComponentTransfer>,
      <feGaussianBlur key={blur} in={inv} stdDeviation={Math.max(0, o.blur / 2)} result={blur} />,
      <feOffset key={off} in={blur} dx={dx} dy={dy} result={off} />,
      <feFlood key={flood} floodColor={rgbOf(c)} floodOpacity={c.a} result={flood} />,
      <feComposite key={comp} in={flood} in2={off} operator="in" result={comp} />,
      <feComposite key={out} in={comp} in2="SourceAlpha" operator="in" result={out} />,
    );
    withInner = out;
  }
  let reflection: string | undefined;
  if (e.reflection) {
    const r = e.reflection;
    const a0 = r.stA / 100;
    const a1 = r.endA / 100;
    reflection = `below ${r.dist}px linear-gradient(to bottom, rgba(255,255,255,0) ${r.stPos}%, rgba(255,255,255,${a1}) 100%)`;
    // the reflection fades from stA at the start to endA at the end; the mask is applied upside down by the browser
    reflection = `below ${r.dist}px linear-gradient(to top, rgba(255,255,255,${a0}) 0%, rgba(255,255,255,${a0}) ${100 - r.endPos > 0 ? 0 : 0}%, rgba(255,255,255,${a1}) ${r.endPos}%)`;
  }
  if (!parts.length) return { defs: null, reflection };
  const fid = `${id}f`;
  const stack = [...merged, body];
  if (withInner !== body) stack.push(withInner);
  return {
    defs: (
      <filter id={fid} x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
        {parts}
        <feMerge>
          {stack.map((s, i) => (
            <feMergeNode key={i} in={s} />
          ))}
        </feMerge>
      </filter>
    ),
    filter: `url(#${fid})`,
    reflection,
  };
}

export { toCss, css };
