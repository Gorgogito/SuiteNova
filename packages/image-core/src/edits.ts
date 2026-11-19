import { applyArtistic } from './artistic';
import { brightnessContrast, clamp, NEUTRAL_TEMPERATURE, saturation, sharpness, temperature, transparency } from './adjust';
import { clampCrop, isCropped, type Crop } from './crop';
import { copy, removeBackground, type Pixels, type Pt } from './pixels';
import { hexRgb, recolor, WASHOUT, type Recolor } from './recolor';

/*
 * What can be done to a picture, kept apart from the picture. The original image is never changed: the picture is the original plus
 * these edits («Restablecer imagen» just forgets them). They come in two kinds:
 *  - `PixelEdits` change what is seen inside the picture (corrections, colour, artistic effects, background removal);
 *  - `FrameEdits` change how it is framed (crop, shape, border, effects around it).
 * Each product keeps both next to its own picture object and draws the result; `applyPixelEdits` is the one engine that makes the pixels.
 */

export type Dash = 'solid' | 'dash' | 'dot' | 'dashdot';

export interface Border {
  /** `#rrggbb` */
  color: string;
  /** Width in points. */
  width: number;
  dash?: Dash;
}

/** Effects drawn around the picture (the products draw them with their own machinery). All sizes in points, angles in degrees. */
export interface PictureFx {
  shadow?: { color: string; blur: number; dist: number; angle: number; alpha: number };
  /** `size` is the percent of the picture that is reflected (0–100). */
  reflection?: { size: number; alpha: number; dist: number };
  glow?: { color: string; radius: number; alpha: number };
  softEdge?: number;
}

export interface FrameEdits {
  crop?: Crop;
  /** A preset geometry name of `@suitenova/shapes-core` (`ellipse`, `roundRect`…): the picture is cropped to that shape. */
  shape?: string;
  border?: Border;
  fx?: PictureFx;
}

export interface PixelEdits {
  /** Background removal: the colour distance tolerated and the areas the user marked (pixels of the original). */
  background?: { tolerance: number; keep?: Pt[]; remove?: Pt[] };
  artistic?: { id: string; level?: number };
  /** −100 to 100 */
  sharpness?: number;
  /** percent, 0–400 (100 = as it is) */
  saturation?: number;
  /** kelvin, 1500–11500 (6500 = as it is) */
  temperature?: number;
  /** −100 to 100 */
  brightness?: number;
  /** −100 to 100 */
  contrast?: number;
  recolor?: Recolor;
  /** percent, 0–100 */
  transparency?: number;
}

export interface PictureEdits {
  pixels?: PixelEdits;
  frame?: FrameEdits;
}

// ------------------------------------------------------------------------------------------------ normal form

/** The edits without the values that change nothing, or `undefined` when nothing is left. */
export function normalizePixelEdits(e?: PixelEdits | null): PixelEdits | undefined {
  if (!e) return undefined;
  const o: PixelEdits = {};
  if (e.background) o.background = { tolerance: clamp(e.background.tolerance, 0, 441), ...(e.background.keep?.length ? { keep: e.background.keep } : {}), ...(e.background.remove?.length ? { remove: e.background.remove } : {}) };
  if (e.artistic && e.artistic.id) o.artistic = { id: e.artistic.id, ...(e.artistic.level !== undefined ? { level: clamp(e.artistic.level, 0, 100) } : {}) };
  if (e.sharpness) o.sharpness = clamp(e.sharpness, -100, 100);
  if (e.saturation !== undefined && e.saturation !== 100) o.saturation = clamp(e.saturation, 0, 400);
  if (e.temperature !== undefined && e.temperature !== NEUTRAL_TEMPERATURE) o.temperature = clamp(e.temperature, 1500, 11500);
  if (e.brightness) o.brightness = clamp(e.brightness, -100, 100);
  if (e.contrast) o.contrast = clamp(e.contrast, -100, 100);
  if (e.recolor) o.recolor = e.recolor;
  if (e.transparency) o.transparency = clamp(e.transparency, 0, 100);
  return Object.keys(o).length ? o : undefined;
}

export function normalizeFrameEdits(e?: FrameEdits | null): FrameEdits | undefined {
  if (!e) return undefined;
  const o: FrameEdits = {};
  if (isCropped(e.crop)) o.crop = clampCrop(e.crop!);
  if (e.shape && e.shape !== 'rect') o.shape = e.shape;
  if (e.border && e.border.width > 0) o.border = e.border;
  if (e.fx && Object.values(e.fx).some((v) => v !== undefined)) o.fx = e.fx;
  return Object.keys(o).length ? o : undefined;
}

export function normalizeEdits(e?: PictureEdits | null): PictureEdits | undefined {
  if (!e) return undefined;
  const pixels = normalizePixelEdits(e.pixels);
  const frame = normalizeFrameEdits(e.frame);
  return pixels || frame ? { ...(pixels ? { pixels } : {}), ...(frame ? { frame } : {}) } : undefined;
}

/** A stable text for the pixel edits: the key to cache the picture they make. Nothing to do gives an empty text. */
export const pixelKey = (e?: PixelEdits | null): string => {
  const n = normalizePixelEdits(e);
  return n ? JSON.stringify(n) : '';
};

/** The background marks follow the original when it is cropped (`dx`, `dy`: what was cut at the left and top, in pixels) and resized (`k`). */
export function moveMarks(e: PixelEdits | undefined, dx: number, dy: number, k: number): PixelEdits | undefined {
  if (!e?.background) return e;
  const mv = (l?: Pt[]) => l?.map((p) => ({ x: (p.x - dx) * k, y: (p.y - dy) * k }));
  return { ...e, background: { ...e.background, keep: mv(e.background.keep), remove: mv(e.background.remove) } };
}

// ------------------------------------------------------------------------------------------------ the engine

/**
 * What Office understands without help (DrawingML): brightness and contrast (`a:lum`, washout included), grey scale (`a:grayscl`),
 * black and white (`a:biLevel`), duotone (`a:duotone`, sepia included) and transparency (`a:alphaModFix`). These are the last steps
 * of the engine, so a file can carry the picture with the first steps already done and let Office do the rest.
 */
export interface NativeAdjust {
  /** −100 to 100 each */
  lum?: { bright: number; contrast: number };
  gray?: true;
  /** threshold in percent */
  biLevel?: number;
  /** `#rrggbb` dark and light */
  duotone?: { dark: string; light: string };
  /** percent of transparency */
  transparency?: number;
}

/** The brightness and contrast the engine uses: the ones set plus the washout, if that is the recolor. */
function lumOf(e: PixelEdits): { bright: number; contrast: number } | undefined {
  const w = e.recolor?.kind === 'washout';
  const bright = clamp((e.brightness ?? 0) + (w ? WASHOUT.brightness : 0), -100, 100);
  const contrast = clamp((e.contrast ?? 0) + (w ? WASHOUT.contrast : 0), -100, 100);
  return bright || contrast ? { bright, contrast } : undefined;
}

/** Splits the edits into the steps Office does by itself and the ones a file has to carry already done (`baked`). */
export function splitNative(edits?: PixelEdits | null): { native: NativeAdjust; baked: PixelEdits | undefined } {
  const e = normalizePixelEdits(edits) ?? {};
  const native: NativeAdjust = {};
  const lum = lumOf(e);
  if (lum) native.lum = lum;
  const r = e.recolor;
  if (r?.kind === 'gray') native.gray = true;
  else if (r?.kind === 'bw') native.biLevel = r.threshold;
  else if (r?.kind === 'sepia') native.duotone = { dark: '#3a2410', light: '#fbf0d9' };
  else if (r?.kind === 'duotone') native.duotone = { dark: r.dark, light: r.light };
  if (e.transparency) native.transparency = e.transparency;
  const baked = normalizePixelEdits({ background: e.background, artistic: e.artistic, sharpness: e.sharpness, saturation: e.saturation, temperature: e.temperature });
  return { native, baked };
}

/** The steps that cannot be left to Office: background, artistic effect, sharpness, saturation and temperature (in that order). */
export function applyBaked(p: Pixels, e?: PixelEdits | null): Pixels {
  if (!e) return p;
  let out = p;
  if (e.background) out = removeBackground(out, e.background.tolerance, null, { keep: e.background.keep, remove: e.background.remove }).pixels;
  if (e.artistic) out = applyArtistic(out, e.artistic.id, e.artistic.level);
  if (e.sharpness) out = sharpness(out, e.sharpness);
  if (e.saturation !== undefined) out = saturation(out, e.saturation);
  if (e.temperature !== undefined) out = temperature(out, e.temperature);
  return out;
}

/** The steps Office does by itself, done here (a drawing of the picture in Nova, or a check against Office). */
export function applyNative(p: Pixels, n: NativeAdjust): Pixels {
  let out = p;
  if (n.lum) out = brightnessContrast(out, n.lum.bright, n.lum.contrast);
  if (n.gray) out = recolor(out, { kind: 'gray' });
  else if (n.biLevel !== undefined) out = recolor(out, { kind: 'bw', threshold: n.biLevel });
  else if (n.duotone) out = recolor(out, { kind: 'duotone', dark: n.duotone.dark, light: n.duotone.light });
  if (n.transparency) out = transparency(out, n.transparency);
  return out;
}

/**
 * The picture the pixel edits make from the original. The order is fixed: background, artistic effect, sharpness, saturation,
 * temperature, brightness and contrast, recolor, transparency. With no edits the same pixels come back (not a copy).
 */
export function applyPixelEdits(p: Pixels, edits?: PixelEdits | null): Pixels {
  const { native, baked } = splitNative(edits);
  return applyNative(applyBaked(p, baked), native);
}

/** Does the picture look different from its original with these edits? */
export const changesPixels = (e?: PixelEdits | null): boolean => !!normalizePixelEdits(e);

// ------------------------------------------------------------------------------------------------ storage

const VERSION = 1;

/** The edits as the text a file keeps (the original is kept apart). */
export function serializeEdits(e?: PictureEdits | null): string {
  return JSON.stringify({ v: VERSION, ...(normalizeEdits(e) ?? {}) });
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const color = (v: unknown): string | undefined => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined);
const pts = (v: unknown): Pt[] | undefined => (Array.isArray(v) ? v.filter((p) => finite(p?.x) && finite(p?.y)).map((p) => ({ x: p.x, y: p.y })).slice(0, 500) : undefined);

function parseRecolor(r: any): Recolor | undefined {
  switch (r?.kind) {
    case 'gray':
    case 'sepia':
    case 'washout':
      return { kind: r.kind };
    case 'bw':
      return finite(r.threshold) ? { kind: 'bw', threshold: clamp(r.threshold, 0, 100) } : undefined;
    case 'duotone': {
      const dark = color(r.dark);
      const light = color(r.light);
      return dark && light ? { kind: 'duotone', dark, light } : undefined;
    }
  }
  return undefined;
}

/** Reads what `serializeEdits` wrote. Whatever is damaged or out of range is dropped or brought into range; a text that is not edits gives `null`. */
export function parseEdits(text: string): PictureEdits | null {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const px = raw.pixels ?? {};
  const fr = raw.frame ?? {};
  const pixels: PixelEdits = {
    ...(finite(px.background?.tolerance) ? { background: { tolerance: px.background.tolerance, keep: pts(px.background.keep), remove: pts(px.background.remove) } } : {}),
    ...(typeof px.artistic?.id === 'string' ? { artistic: { id: px.artistic.id, ...(finite(px.artistic.level) ? { level: px.artistic.level } : {}) } } : {}),
    ...(finite(px.sharpness) ? { sharpness: px.sharpness } : {}),
    ...(finite(px.saturation) ? { saturation: px.saturation } : {}),
    ...(finite(px.temperature) ? { temperature: px.temperature } : {}),
    ...(finite(px.brightness) ? { brightness: px.brightness } : {}),
    ...(finite(px.contrast) ? { contrast: px.contrast } : {}),
    ...(parseRecolor(px.recolor) ? { recolor: parseRecolor(px.recolor) } : {}),
    ...(finite(px.transparency) ? { transparency: px.transparency } : {}),
  };
  const c = fr.crop;
  const frame: FrameEdits = {
    ...(c && [c.l, c.t, c.r, c.b].every(finite) ? { crop: { l: c.l, t: c.t, r: c.r, b: c.b } } : {}),
    ...(typeof fr.shape === 'string' ? { shape: fr.shape } : {}),
    ...(color(fr.border?.color) && finite(fr.border?.width) ? { border: { color: color(fr.border.color)!, width: clamp(fr.border.width, 0, 100), ...(['dash', 'dot', 'dashdot'].includes(fr.border.dash) ? { dash: fr.border.dash } : {}) } } : {}),
    ...(fr.fx && typeof fr.fx === 'object' ? { fx: parseFx(fr.fx) } : {}),
  };
  return normalizeEdits({ pixels, frame }) ?? {};
}

function parseFx(f: any): PictureFx | undefined {
  const o: PictureFx = {};
  const s = f.shadow;
  if (s && color(s.color) && [s.blur, s.dist, s.angle, s.alpha].every(finite)) o.shadow = { color: color(s.color)!, blur: clamp(s.blur, 0, 200), dist: clamp(s.dist, 0, 200), angle: s.angle, alpha: clamp(s.alpha, 0, 1) };
  const r = f.reflection;
  if (r && [r.size, r.alpha, r.dist].every(finite)) o.reflection = { size: clamp(r.size, 0, 100), alpha: clamp(r.alpha, 0, 1), dist: clamp(r.dist, 0, 200) };
  const g = f.glow;
  if (g && color(g.color) && [g.radius, g.alpha].every(finite)) o.glow = { color: color(g.color)!, radius: clamp(g.radius, 0, 200), alpha: clamp(g.alpha, 0, 1) };
  if (finite(f.softEdge)) o.softEdge = clamp(f.softEdge, 0, 100);
  return Object.keys(o).length ? o : undefined;
}

void copy;
void hexRgb;
