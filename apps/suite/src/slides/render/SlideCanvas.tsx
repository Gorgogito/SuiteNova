import {
  chainFor,
  colorContext,
  docNode,
  effectiveXfrm,
  geometryOf,
  isEmptyDoc,
  layoutOf,
  matchPlaceholder,
  placeholderParents,
  resolveLook,
  textContext,
  withBodyDefaults,
  type Background,
  type BodyProps,
  type Chain,
  type Deck,
  type Layout,
  type Master,
  type PicEl,
  type Placeholder,
  type ShapeEl,
  type Slide,
  type SlideElement,
  type TextBody,
  type Xfrm,
} from '@suitenova/slides-core';
import { clrCss } from '@suitenova/slides-core';
import { Children, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { onImageDims, type AssetUrls } from './assets';
import { ChartView } from './chart';
import { useAutofit } from './autofit';
import { effectsFor, paintFor, strokeFor, withPh, type RenderEnv } from './paint';
import { TableView } from './table';
import { TextView, type TextEnv } from './TextView';
import { WarpedText } from './warp';

export interface CanvasCtx {
  deck: Deck;
  chain: Chain;
  env: TextEnv;
  /** placeholders inherit from layout and master only on slides */
  onSlide: boolean;
  /** the element being edited draws no text (the editor shows it) */
  editingId?: string | null;
  /** the table cell being edited draws no text (the editor shows it) */
  editingCell?: { id: string; r: number; c: number } | null;
  /** hide the prompt of empty placeholders */
  noPrompts?: boolean;
  /** ids of elements that are drawn invisible (during the animations of a presentation) */
  hidden?: Set<string>;
  media: 'edit' | 'show' | 'thumb';
  /** maps the coordinates of a group's children into the group's box (set inside groups) */
  xf?: (x: Xfrm) => Xfrm;
}

/** The transform of an element as drawn: inherited from its placeholder and mapped through the groups it is in. */
export function xfOf(ctx: CanvasCtx, el: SlideElement): Xfrm {
  const x = effectiveXfrm(ctx.chain, el, ctx.onSlide);
  return ctx.xf ? ctx.xf(x) : x;
}

const PROMPTS: Record<string, string> = {
  title: 'Haga clic para agregar título',
  ctrTitle: 'Haga clic para agregar título',
  subTitle: 'Haga clic para agregar subtítulo',
  body: 'Haga clic para agregar texto',
  obj: 'Haga clic para agregar texto',
  chart: 'Haga clic en el icono para agregar un gráfico',
  tbl: 'Haga clic en el icono para agregar una tabla',
  pic: 'Haga clic en el icono para agregar una imagen',
  media: 'Haga clic en el icono para agregar un elemento multimedia',
  dgm: 'Haga clic en el icono para insertar un elemento gráfico SmartArt',
  clipArt: 'Haga clic en el icono para agregar una imagen',
};

/** The paragraphs shown in an empty placeholder: the layout's custom prompt or the standard one for its type. */
export function promptDoc(ctx: CanvasCtx, ph: Placeholder): ReturnType<typeof docNode> | null {
  if (ph.type === 'dt' || ph.type === 'ftr' || ph.type === 'sldNum' || ph.type === 'hdr') return null;
  const lay = ctx.chain.layout;
  const ls = lay ? matchPlaceholder(lay.shapes, ph, 'layout') : undefined;
  const custom = ls?.ph?.hasCustomPrompt && ls.text && !isEmptyDoc(ls.text.doc) ? ls.text.doc : null;
  if (custom) return docNode(custom);
  const text = PROMPTS[ph.type] ?? PROMPTS.body!;
  return docNode({ type: 'doc', content: [{ type: 'paragraph', attrs: { lvl: 0, p: {}, end: {} }, content: [{ type: 'text', text }] }] });
}

// ------------------------------------------------------------------------------------------------ background

export function backgroundOf(deck: Deck, slide: Slide | undefined, layout: Layout | undefined, master: Master | undefined): { bg: Background | undefined; from: 'slide' | 'layout' | 'master' } {
  if (slide?.bg) return { bg: slide.bg, from: 'slide' };
  if (layout?.bg) return { bg: layout.bg, from: 'layout' };
  void deck;
  return { bg: master?.bg, from: 'master' };
}

export function BackgroundView({ deck, chain, env, w, h }: { deck: Deck; chain: Chain; env: RenderEnv; w: number; h: number }) {
  const { bg } = backgroundOf(deck, chain.slide, chain.layout, chain.master);
  const id = 'bg';
  let fill = undefined as Parameters<typeof paintFor>[0];
  let ph: { c?: import('@suitenova/slides-core').Clr } | undefined;
  if (bg && 'fill' in bg) fill = bg.fill;
  else if (bg && 'ref' in bg) {
    const idx = bg.ref.idx;
    const list = chain.theme.fmt.bgFills;
    fill = list[(idx >= 1001 ? idx - 1001 : idx - 1) % Math.max(1, list.length)];
    ph = { c: bg.ref.c };
  } else fill = { t: 'solid', c: { scheme: 'bg1' } };
  const p = paintFor(fill, id, w, h, env, ph);
  const d = `M0 0H${w}V${h}H0Z`;
  return (
    <svg className="sl-bg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', left: 0, top: 0 }}>
      <defs>{Children.toArray(p.defs)}</defs>
      <rect width={w} height={h} fill="#fff" />
      {p.layer ? p.layer(d) : <path d={d} fill={p.value} fillOpacity={p.opacity} />}
    </svg>
  );
}

// ------------------------------------------------------------------------------------------------ elements

const safeId = (s: string) => s.replace(/[^\w-]/g, '_');

function wrapStyle(x: Xfrm): CSSProperties {
  const st: CSSProperties = { position: 'absolute', left: x.x, top: x.y, width: x.w, height: x.h };
  if (x.rot) st.transform = `rotate(${x.rot}deg)`;
  return st;
}
const flipStyle = (x: Xfrm): CSSProperties | undefined => (x.flipH || x.flipV ? { transform: `scale(${x.flipH ? -1 : 1},${x.flipV ? -1 : 1})` } : undefined);

export function ElementView({ el, ctx }: { el: SlideElement; ctx: CanvasCtx }): ReactNode {
  if (el.hidden) return null;
  switch (el.kind) {
    case 'shape':
      return <ShapeView el={el} ctx={ctx} />;
    case 'cxn':
      return <ShapeView el={{ ...el, kind: 'shape' } as unknown as ShapeEl} ctx={ctx} />;
    case 'pic':
      return <PicView el={el} ctx={ctx} />;
    case 'group': {
      const x = xfOf(ctx, el);
      const sx = el.chExt.w ? x.w / el.chExt.w : 1;
      const sy = el.chExt.h ? x.h / el.chExt.h : 1;
      const st = wrapStyle(x);
      if (x.flipH || x.flipV) st.transform = `${st.transform ?? ''} scale(${x.flipH ? -1 : 1},${x.flipV ? -1 : 1})`.trim();
      // children are placed in the group's box; sizes of lines and text do not scale with the box
      const inner: CanvasCtx = {
        ...ctx,
        xf: (c) => {
          const m = { ...c, x: (c.x - el.chOff.x) * sx, y: (c.y - el.chOff.y) * sy, w: c.w * sx, h: c.h * sy };
          return m;
        },
      };
      return (
        <div className="sl-el sl-group" data-id={el.id} data-link={el.hlink && ctx.media === "show" ? JSON.stringify(el.hlink) : undefined} style={st}>
          {el.children.map((c) => (
            <ElementView key={c.id} el={c} ctx={inner} />
          ))}
        </div>
      );
    }
    case 'table':
      return <TableView el={el} ctx={ctx} />;
    case 'chart':
      return <ChartView el={el} ctx={ctx} />;
    case 'media': {
      const x = xfOf(ctx, el);
      const src = ctx.env.assetUrl(el.src);
      const poster = ctx.env.assetUrl(el.poster);
      return (
        <div className="sl-el sl-media" data-id={el.id} style={{ ...wrapStyle(x), background: el.media === 'audio' ? 'transparent' : '#000' }}>
          {el.media === 'video' && src ? <video src={src} poster={poster || undefined} controls={ctx.media === 'edit'} muted={ctx.media !== 'show' || el.mute} loop={el.loop} style={{ width: '100%', height: '100%', objectFit: 'contain' }} data-autoplay={el.autoplay ? '1' : undefined} /> : poster ? <img src={poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'fill' }} /> : null}
          {el.media === 'audio' && (
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', fontSize: Math.min(x.w, x.h) * 0.6 }} title="Audio">
              {poster ? <img src={poster} alt="" style={{ width: '100%', height: '100%' }} /> : '🔊'}
              {src && ctx.media === 'edit' && <audio src={src} controls style={{ position: 'absolute', bottom: 0, width: '100%', height: 20 }} />}
              {src && ctx.media === 'show' && <audio src={src} data-autoplay={el.autoplay ? '1' : undefined} loop={el.loop} />}
            </div>
          )}
        </div>
      );
    }
    case 'ole': {
      const x = xfOf(ctx, el);
      const url = ctx.env.assetUrl(el.poster);
      return (
        <div className="sl-el sl-ole" data-id={el.id} style={wrapStyle(x)}>
          {url ? <img src={url} alt={el.name ?? ''} style={{ width: '100%', height: '100%' }} /> : <div style={{ width: '100%', height: '100%', border: '1px dashed #888' }} />}
        </div>
      );
    }
  }
}

function ShapeView({ el, ctx }: { el: ShapeEl; ctx: CanvasCtx }) {
  const { deck, chain, env, onSlide } = ctx;
  const x = xfOf(ctx, el);
  const w = Math.max(0, x.w);
  const h = Math.max(0, x.h);
  const id = `s${safeId(el.id)}`;
  const parents = placeholderParents(chain, el, onSlide);
  const geom = el.geom ?? parents.find((p) => p.geom)?.geom ?? (el.ph || el.isTextBox ? { prst: 'rect' } : { prst: 'rect' });
  const g = geometryOf(geom, w, h);
  const look = resolveLook(chain, el as unknown as SlideElement, onSlide);
  const fillPaint = paintFor(look.fill, `${id}f`, w, h, env, look.fillClr);
  const isLine = !g.paths.some((p) => p.fill !== 'none') || ('prst' in geom && /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(geom.prst));
  const stroke = strokeFor(look.ln, id, w, h, env, look.lnClr);
  const fx = effectsFor(look.effects, id, env, look.effectClr);
  const tc = el.text || el.ph ? textContext(deck, chain, el, onSlide) : undefined;
  const body = tc ? withBodyDefaults(tc.body) : undefined;
  const fontRef = el.style?.font;
  void fontRef;
  const st = wrapStyle(x);
  if (fx.reflection) (st as Record<string, unknown>).WebkitBoxReflect = fx.reflection;
  const lightenStroke = false;
  void lightenStroke;
  const empty = !el.text || isEmptyDoc(el.text.doc);
  const prompt = el.ph && empty && onSlide && env.prompts && !ctx.noPrompts ? promptDoc(ctx, el.ph) : null;
  const showText = (!!el.text && !empty) || !!prompt;
  const editing = ctx.editingId === el.id;
  const hasGeomDraw = true;
  return (
    <div className="sl-el sl-shape" data-id={el.id} data-link={el.hlink && ctx.media === "show" ? JSON.stringify(el.hlink) : undefined} data-ph={el.ph?.type} style={st}>
      {hasGeomDraw && (g.paths.length > 0 || fillPaint.layer) && (
        <svg width={w + 1} height={h + 1} viewBox={`0 0 ${w + 1} ${h + 1}`} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', ...flipStyle(x) }}>
          <defs>
            {Children.toArray(fillPaint.defs)}
            {Children.toArray(stroke.defs)}
            {Children.toArray(fx.defs)}
          </defs>
          <g filter={fx.filter}>
            {g.paths.map((p, i) => {
              const filled = p.fill !== 'none' && !isLine;
              const shade = p.fill === 'darken' ? 'rgba(0,0,0,.4)' : p.fill === 'darkenLess' ? 'rgba(0,0,0,.2)' : p.fill === 'lighten' ? 'rgba(255,255,255,.4)' : p.fill === 'lightenLess' ? 'rgba(255,255,255,.2)' : undefined;
              return (
                <g key={i}>
                  {filled && fillPaint.layer && i === 0 ? fillPaint.layer(p.d) : null}
                  {filled && !(fillPaint.layer && i === 0) && (
                    <path d={p.d} fill={shade ? 'none' : fillPaint.value} fillOpacity={fillPaint.opacity} stroke="none" />
                  )}
                  {filled && shade && <path d={p.d} fill={shade} stroke="none" />}
                  {p.stroke && !stroke.none && <path d={p.d} fill="none" {...(stroke.attrs as Record<string, string | number>)} />}
                </g>
              );
            })}
          </g>
        </svg>
      )}
      {showText && !editing && tc && body && (
        <TextBox el={el} ctx={ctx} x={x} geom={g.textRect} body={body} tc={tc} text={el.text} prompt={prompt} look={look} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ text box

export interface TextBoxProps {
  el: ShapeEl;
  ctx: CanvasCtx;
  x: Xfrm;
  geom: { l: number; t: number; r: number; b: number };
  body: ReturnType<typeof withBodyDefaults>;
  tc: ReturnType<typeof textContext>;
  text: TextBody | undefined;
  prompt: ReturnType<typeof docNode> | null;
  look: ReturnType<typeof resolveLook>;
}

/** Style of the box that holds a shape's text (its text rectangle, insets, anchor, direction). */
export function textBoxStyle(x: Xfrm, geom: { l: number; t: number; r: number; b: number }, body: ReturnType<typeof withBodyDefaults>): CSSProperties {
  const anchor = body.anchor === 'ctr' ? 'center' : body.anchor === 'b' ? 'flex-end' : 'flex-start';
  const flipText = x.flipV && !x.flipH ? 'rotate(180deg)' : undefined;
  const vertical = body.vert && body.vert !== 'horz';
  const style: CSSProperties = {
    position: 'absolute',
    left: geom.l,
    top: geom.t,
    width: Math.max(0, geom.r - geom.l),
    height: Math.max(0, geom.b - geom.t),
    paddingLeft: body.lIns,
    paddingTop: body.tIns,
    paddingRight: body.rIns,
    paddingBottom: body.bIns,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: anchor,
    alignItems: body.anchorCtr ? 'center' : undefined,
    transform: flipText,
    overflow: 'visible',
    pointerEvents: 'none',
    whiteSpace: body.wrap === 'none' ? 'pre' : undefined,
    writingMode: vertical ? (body.vert === 'vert270' ? 'vertical-lr' : 'vertical-rl') : undefined,
  };
  if (body.vert === 'vert270') style.transform = `${style.transform ?? ''} rotate(180deg)`.trim();
  if (body.rot) style.transform = `${style.transform ?? ''} rotate(${body.rot}deg)`.trim();
  return style;
}

/** Everything needed to lay out the text of a shape. */
export function shapeLayout(ctx: CanvasCtx, el: ShapeEl) {
  const x = xfOf(ctx, el);
  const parents = placeholderParents(ctx.chain, el, ctx.onSlide);
  const geom = el.geom ?? parents.find((p) => p.geom)?.geom ?? { prst: 'rect' };
  const g = geometryOf(geom, Math.max(0, x.w), Math.max(0, x.h));
  const look = resolveLook(ctx.chain, el as unknown as SlideElement, ctx.onSlide);
  const tc = textContext(ctx.deck, ctx.chain, el, ctx.onSlide);
  return { x, g, look, tc, body: withBodyDefaults(tc.body) };
}

export function TextBox({ ctx, x, geom, body, tc, text, prompt, look }: TextBoxProps) {
  const { env } = ctx;
  const box = { left: geom.l, top: geom.t, width: Math.max(0, geom.r - geom.l), height: Math.max(0, geom.b - geom.t) };
  const ref = useRef<HTMLDivElement>(null);
  const fit = body.fit;
  const [tick, setTick] = useState(0);
  useEffect(() => onImageDims(() => setTick((t) => t + 1)), []);
  const docKey = JSON.stringify(text?.doc ?? null) + (prompt ? 'p' : '') + box.width + 'x' + box.height + JSON.stringify(body.fit) + tick;
  useAutofit(ref, !!fit && fit.t === 'norm' && !prompt, docKey, { font: fit && fit.t === 'norm' ? fit.fontScale : undefined });
  const style = textBoxStyle(x, geom, body);
  const colStyle: CSSProperties = body.numCol && body.numCol > 1 ? { columnCount: body.numCol, columnGap: body.spcCol ?? 0, columnFill: 'auto', height: '100%' } : {};
  const inner = (
    <div style={{ width: body.wrap === 'none' ? undefined : '100%', ...colStyle }}>
      <TextView tb={text} tc={tc} env={env} prompt={prompt} ph={look.fillClr} />
    </div>
  );
  if (body.warp && body.warp.prst !== 'textNoShape' && body.warp.prst !== 'textPlain') {
    return (
      <div ref={ref} style={{ ...style, display: 'block' }} className="sl-text">
        <WarpedText warp={body.warp} width={box.width - (body.lIns + body.rIns)} height={box.height - (body.tIns + body.bIns)} text={text} tc={tc} env={env} />
      </div>
    );
  }
  return (
    <div ref={ref} style={style} className="sl-text" data-fit={fit?.t}>
      {inner}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ pictures

const rgbCache = new Map<string, [number, number, number]>();
/** The red, green and blue (0–255) of any CSS colour. */
function rgbOf(css: string): [number, number, number] {
  const hit = rgbCache.get(css);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = css;
  g.fillRect(0, 0, 1, 1);
  const d = g.getImageData(0, 0, 1, 1).data;
  const out: [number, number, number] = [d[0]!, d[1]!, d[2]!];
  rgbCache.set(css, out);
  return out;
}

function PicView({ el, ctx }: { el: PicEl; ctx: CanvasCtx }) {
  const { chain, env, onSlide } = ctx;
  const x = xfOf(ctx, el);
  const w = Math.max(0, x.w);
  const h = Math.max(0, x.h);
  const id = `p${safeId(el.id)}`;
  const url = env.assetUrl(el.src);
  const g = geometryOf(el.geom ?? { prst: 'rect' }, w, h);
  const look = resolveLook(chain, el, onSlide);
  const stroke = strokeFor(look.ln, id, w, h, env, look.lnClr);
  const fx = effectsFor(look.effects, id, env, look.effectClr);
  const fillPaint = paintFor(look.fill, `${id}f`, w, h, env, look.fillClr);
  const sr = el.srcRect ?? { l: 0, t: 0, r: 0, b: 0 };
  const vw = Math.max(0.01, 1 - (sr.l + sr.r) / 100000);
  const vh = Math.max(0.01, 1 - (sr.t + sr.b) / 100000);
  const iw = w / vw;
  const ih = h / vh;
  const ix = -(sr.l / 100000) * iw;
  const iy = -(sr.t / 100000) * ih;
  const a = el.adjust;
  const adjId = `${id}a`;
  const st = wrapStyle(x);
  if (fx.reflection) (st as Record<string, unknown>).WebkitBoxReflect = fx.reflection;
  const cc = withPh(env.cc, look.fillClr);
  void cc;
  const filters: ReactNode[] = [];
  if (a) {
    if (a.gray) filters.push(<feColorMatrix key="g" type="saturate" values="0" />);
    if (a.bright !== undefined || a.contrast !== undefined) {
      const slope = 1 + (a.contrast ?? 0) / 100;
      const icpt = (a.bright ?? 0) / 100 + (1 - slope) / 2;
      filters.push(
        <feComponentTransfer key="c">
          <feFuncR type="linear" slope={slope} intercept={icpt} />
          <feFuncG type="linear" slope={slope} intercept={icpt} />
          <feFuncB type="linear" slope={slope} intercept={icpt} />
        </feComponentTransfer>,
      );
    }
    if (a.duotone) {
      const [c0, c1] = a.duotone.map((c) => rgbOf(clrCss(c, env.cc)));
      const tv = (i: number) => `${c0![i]! / 255} ${c1![i]! / 255}`;
      filters.push(<feColorMatrix key="d0" type="saturate" values="0" />);
      filters.push(
        <feComponentTransfer key="d1">
          <feFuncR type="table" tableValues={tv(0)} />
          <feFuncG type="table" tableValues={tv(1)} />
          <feFuncB type="table" tableValues={tv(2)} />
        </feComponentTransfer>,
      );
    }
    if (a.biLevel !== undefined) {
      filters.push(
        <feComponentTransfer key="b">
          <feFuncR type="discrete" tableValues={a.biLevel > 50 ? '0 0 0 1' : '0 1 1 1'} />
          <feFuncG type="discrete" tableValues={a.biLevel > 50 ? '0 0 0 1' : '0 1 1 1'} />
          <feFuncB type="discrete" tableValues={a.biLevel > 50 ? '0 0 0 1' : '0 1 1 1'} />
        </feComponentTransfer>,
      );
    }
  }
  return (
    <div className="sl-el sl-pic" data-id={el.id} data-link={el.hlink && ctx.media === "show" ? JSON.stringify(el.hlink) : undefined} style={st}>
      <svg width={w + 1} height={h + 1} viewBox={`0 0 ${w + 1} ${h + 1}`} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', ...flipStyle(x) }}>
        <defs>
          {Children.toArray(fillPaint.defs)}
          {Children.toArray(stroke.defs)}
          {Children.toArray(fx.defs)}
          <clipPath id={`${id}c`}>{g.paths.slice(0, 1).map((p, i) => <path key={i} d={p.d} />)}</clipPath>
          {filters.length > 0 && <filter id={adjId}>{filters}</filter>}
        </defs>
        <g filter={fx.filter}>
          {look.fill.t !== 'none' && g.paths[0] && <path d={g.paths[0].d} fill={fillPaint.value} />}
          {url ? (
            <image href={url} x={ix} y={iy} width={iw} height={ih} preserveAspectRatio="none" clipPath={`url(#${id}c)`} opacity={a?.alpha !== undefined ? a.alpha / 100 : undefined} filter={filters.length ? `url(#${adjId})` : undefined} />
          ) : (
            <rect width={w} height={h} fill="#eee" stroke="#aaa" strokeDasharray="4 3" />
          )}
          {!stroke.none && g.paths[0] && <path d={g.paths[0].d} fill="none" {...(stroke.attrs as Record<string, string | number>)} />}
        </g>
      </svg>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the slide

export interface SlideCanvasProps {
  deck: Deck;
  slide: Slide;
  urls: AssetUrls;
  slideNumber: number;
  /** edit | show | thumb */
  mode: 'edit' | 'show' | 'thumb';
  prompts?: boolean;
  editingId?: string | null;
  editingCell?: CanvasCtx['editingCell'];
  hidden?: Set<string>;
  onLink?: TextEnv['onLink'];
  /** layout being previewed instead of the slide's own (master view) */
  layoutOverride?: Layout;
  /** draw only the tree of the master/layout instead of a slide */
  tree?: { shapes: SlideElement[]; owner: 'layout' | 'master' };
}

export function useSlideEnv(deck: Deck, slide: Slide | undefined, urls: AssetUrls, slideNumber: number, prompts: boolean, onLink?: TextEnv['onLink'], layoutOverride?: Layout): { ctx: CanvasCtx; chain: Chain } {
  return useMemo(() => {
    const chain = chainFor(deck, slide, layoutOverride);
    const cc = colorContext(chain);
    const env: TextEnv = { cc, assetUrl: (id) => urls.url(id), deck, chain, slideNumber, prompts, onLink };
    return { ctx: { deck, chain, env, onSlide: true, media: 'edit' } as CanvasCtx, chain };
  }, [deck, slide, urls, slideNumber, prompts, onLink, layoutOverride]);
}

export function SlideCanvas({ deck, slide, urls, slideNumber, mode, prompts = true, editingId, editingCell, hidden, onLink, layoutOverride, tree }: SlideCanvasProps) {
  const { ctx, chain } = useSlideEnv(deck, tree ? undefined : slide, urls, slideNumber, prompts, onLink, layoutOverride);
  const w = deck.size.w;
  const h = deck.size.h;
  const layout = chain.layout ?? (slide ? layoutOf(deck, slide) : undefined);
  const master = chain.master;
  const showMaster = !tree && layout?.showMasterSp !== false && slide?.showMasterSp !== false;
  const showLayout = !tree && slide?.showMasterSp !== false;
  const base: CanvasCtx = { ...ctx, editingId, editingCell, hidden, media: mode };
  const nonPh = (els: SlideElement[]) => els.filter((e) => !((e.kind === 'shape' || e.kind === 'pic') && e.ph));
  // master/layout shapes inherit from nothing: they are drawn with their own chain
  const staticCtx: CanvasCtx = { ...base, onSlide: false };
  return (
    <div className={`sl-slide sl-mode-${mode}`} style={{ position: 'relative', width: w, height: h, overflow: 'hidden', background: '#fff' }} data-slide={slide?.id}>
      <BackgroundView deck={deck} chain={chain} env={ctx.env} w={w} h={h} />
      {showMaster && master && nonPh(master.shapes).map((e) => <ElementView key={`m${e.id}`} el={e} ctx={staticCtx} />)}
      {showLayout && layout && nonPh(layout.shapes).map((e) => <ElementView key={`l${e.id}`} el={e} ctx={staticCtx} />)}
      {tree ? tree.shapes.map((e) => <ElementView key={e.id} el={e} ctx={{ ...base, onSlide: tree.owner === 'layout' }} />) : slide.shapes.map((e) => <ElementView key={e.id} el={e} ctx={base} />)}
    </div>
  );
}

export type { BodyProps };
