import { PICTURE_STYLES, applyStyle, clampCrop, isCropped, splitNative, type FrameEdits, type NativeAdjust, type PictureEdits, type PictureStyle, type PixelEdits, type Recolor } from '@suitenova/image-core';
import type { Clr, Effects, Fill, Ln, PicEl } from './types';

/*
 * The bridge between the shared picture edits (`@suitenova/image-core`) and what a PicEl keeps. Brightness, contrast, recolor and
 * transparency live in `adjust` (PowerPoint does them itself: `a:lum`, `a:grayscl`, `a:biLevel`, `a:duotone`, `a:alphaModFix`); the edits that
 * change pixels live in `edits`, with `orig` (the original image) and `src` (the original with those edits made).
 */

type Adjust = NonNullable<PicEl['adjust']>;
const hex = (c?: Clr): string => (c?.rgb && /^#[0-9a-f]{6}$/i.test(c.rgb) ? c.rgb.toLowerCase() : '#000000');
const SEPIA = { dark: '#3a2410', light: '#fbf0d9' };

/** What the picture's `adjust` says, as the shared engine's native step. */
export function nativeOf(a: PicEl['adjust']): NativeAdjust {
  const n: NativeAdjust = {};
  if (!a) return n;
  if (a.bright || a.contrast) n.lum = { bright: a.bright ?? 0, contrast: a.contrast ?? 0 };
  if (a.gray) n.gray = true;
  if (a.biLevel !== undefined) n.biLevel = a.biLevel;
  if (a.duotone) n.duotone = { dark: hex(a.duotone[0]), light: hex(a.duotone[1]) };
  if (a.alpha !== undefined && a.alpha < 100) n.transparency = 100 - a.alpha;
  return n;
}

/** `adjust` for a native step (no adjustment gives undefined). */
export function adjustOf(n: NativeAdjust): PicEl['adjust'] {
  const a: Adjust = {};
  if (n.lum) {
    if (n.lum.bright) a.bright = n.lum.bright;
    if (n.lum.contrast) a.contrast = n.lum.contrast;
  }
  if (n.gray) a.gray = true;
  if (n.biLevel !== undefined) a.biLevel = n.biLevel;
  if (n.duotone) a.duotone = [{ rgb: n.duotone.dark }, { rgb: n.duotone.light }];
  if (n.transparency) a.alpha = 100 - n.transparency;
  return Object.keys(a).length ? a : undefined;
}

/** The recolor the picture has, in the shared form. */
function recolorOf(a: PicEl['adjust']): Recolor | undefined {
  if (!a) return undefined;
  if (a.gray) return { kind: 'gray' };
  if (a.biLevel !== undefined) return { kind: 'bw', threshold: a.biLevel };
  if (a.duotone) {
    const dark = hex(a.duotone[0]);
    const light = hex(a.duotone[1]);
    return dark === SEPIA.dark && light === SEPIA.light ? { kind: 'sepia' } : { kind: 'duotone', dark, light };
  }
  return undefined;
}

/** Everything done to the pixels of a picture: what `adjust` says plus what `edits` made. */
export function pixelEditsOf(p: PicEl): PixelEdits {
  const a = p.adjust;
  return {
    ...(p.edits ?? {}),
    ...(a?.bright ? { brightness: a.bright } : {}),
    ...(a?.contrast ? { contrast: a.contrast } : {}),
    ...(recolorOf(a) ? { recolor: recolorOf(a) } : {}),
    ...(a?.alpha !== undefined && a.alpha < 100 ? { transparency: 100 - a.alpha } : {}),
  };
}

/** Splits pixel edits into the `adjust` PowerPoint understands and the `edits` that need the original made again. */
export function splitForPicture(edits: PixelEdits | undefined): { adjust: PicEl['adjust']; baked: PixelEdits | undefined } {
  const { native, baked } = splitNative(edits);
  return { adjust: adjustOf(native), baked };
}

// ------------------------------------------------------------------------------------------------ frame

const clr = (rgb: string, alpha?: number): Clr => ({ rgb, ...(alpha !== undefined ? { mods: [{ t: 'alpha' as const, v: Math.round(alpha * 100000) }] } : {}) });
const solid = (rgb: string, alpha?: number): Fill => ({ t: 'solid', c: { rgb, ...(alpha !== undefined ? { mods: [{ t: 'alpha' as const, v: Math.round(alpha * 100000) }] } : {}) } });
const DASH = { dash: 'dash', dot: 'dot', dashdot: 'dashDot' } as const;
const alphaOf = (c: Clr): number => {
  const m = c.mods?.find((x) => x.t === 'alpha');
  return m?.v !== undefined ? m.v / 100000 : 1;
};

/** The frame of a picture in the shared form (what it can say: crop, shape, border and the effects of the styles). */
export function frameOf(p: PicEl): FrameEdits {
  const f: FrameEdits = {};
  if (isCropped(p.srcRect)) f.crop = clampCrop(p.srcRect!);
  if (p.geom && 'prst' in p.geom && p.geom.prst !== 'rect') f.shape = p.geom.prst;
  const ln = p.ln;
  if (ln?.fill && ln.fill.t === 'solid' && (ln.w ?? 0) > 0) f.border = { color: hex(ln.fill.c), width: ln.w!, ...(ln.dash && ln.dash !== 'solid' ? { dash: (Object.entries(DASH).find(([, v]) => v === ln.dash)?.[0] ?? 'dash') as 'dash' | 'dot' | 'dashdot' } : {}) };
  const e = p.effects;
  if (e) {
    const fx: NonNullable<FrameEdits['fx']> = {};
    if (e.outer) fx.shadow = { color: hex(e.outer.c), blur: e.outer.blur, dist: e.outer.dist, angle: e.outer.dir, alpha: alphaOf(e.outer.c) };
    if (e.reflection) fx.reflection = { size: e.reflection.endPos, alpha: e.reflection.stA / 100, dist: e.reflection.dist };
    if (e.glow) fx.glow = { color: hex(e.glow.c), radius: e.glow.rad, alpha: alphaOf(e.glow.c) };
    if (e.softEdge) fx.softEdge = e.softEdge.rad;
    if (Object.keys(fx).length) f.fx = fx;
  }
  return f;
}

/** The picture with that border, shape and effects (crop untouched). What the frame leaves out is cleared. */
export function withFrame(p: PicEl, f: Pick<FrameEdits, 'shape' | 'border' | 'fx'>): PicEl {
  const { geom: _g, ln: _l, effects: _e, ...rest } = p;
  void _g;
  void _l;
  void _e;
  const out: PicEl = { ...rest };
  if (f.shape && f.shape !== 'rect') out.geom = { prst: f.shape };
  if (f.border) {
    const ln: Ln = { w: f.border.width, fill: solid(f.border.color) };
    if (f.border.dash && f.border.dash !== 'solid') ln.dash = DASH[f.border.dash];
    out.ln = ln;
  }
  if (f.fx) {
    const e: Effects = {};
    if (f.fx.shadow) e.outer = { blur: f.fx.shadow.blur, dist: f.fx.shadow.dist, dir: f.fx.shadow.angle, c: clr(f.fx.shadow.color, f.fx.shadow.alpha), algn: 'tl', rotWithShape: false };
    if (f.fx.reflection) e.reflection = { blur: 0.5, stA: Math.round(f.fx.reflection.alpha * 100), stPos: 0, endA: 0, endPos: Math.round(f.fx.reflection.size), dist: f.fx.reflection.dist, dir: 90, fadeDir: 90, sx: 100, sy: -100, algn: 'bl', rotWithShape: false };
    if (f.fx.glow) e.glow = { rad: f.fx.glow.radius, c: clr(f.fx.glow.color, f.fx.glow.alpha) };
    if (f.fx.softEdge) e.softEdge = { rad: f.fx.softEdge };
    if (Object.keys(e).length) out.effects = e;
  }
  return out;
}

/** The picture with a style of the shared gallery on (shape, border and effects; the crop stays). */
export function withPictureStyle(p: PicEl, style: PictureStyle): PicEl {
  return withFrame(p, applyStyle(frameOf(p), style));
}

/** Which style of the gallery the picture has now, if it matches one. */
export function styleOf(p: PicEl): string | undefined {
  const f = frameOf(p);
  const key = (x: Pick<FrameEdits, 'shape' | 'border' | 'fx'>) => JSON.stringify([x.shape ?? null, x.border ?? null, x.fx ?? null]);
  return PICTURE_STYLES.find((s) => key(s.frame) === key({ shape: f.shape, border: f.border, fx: f.fx }))?.id;
}

export type { PictureEdits };
