import { DEFAULT_CLRMAP, type ColorContext } from './color';
import type { BodyProps, Deck, Effects, Fill, Layout, ListStyle, Ln, Master, ParaProps, Placeholder, RunProps, ShapeEl, Slide, SlideElement, StyleRef, TextBody, Theme, Xfrm } from './types';

export const layoutOf = (deck: Deck, slide: Slide): Layout | undefined => deck.layouts.find((l) => l.id === slide.layoutId) ?? deck.layouts[0];
export const masterOf = (deck: Deck, layout: Layout | undefined): Master | undefined => deck.masters.find((m) => m.id === layout?.masterId) ?? deck.masters[0];
export const themeOfMaster = (deck: Deck, master: Master | undefined): Theme => deck.themes.find((t) => t.id === master?.themeId) ?? deck.themes[0]!;

export interface Chain {
  slide?: Slide;
  layout?: Layout;
  master?: Master;
  theme: Theme;
}
export function chainFor(deck: Deck, slide: Slide | undefined, layoutOverride?: Layout): Chain {
  const layout = layoutOverride ?? (slide ? layoutOf(deck, slide) : undefined);
  const master = masterOf(deck, layout);
  return { slide, layout, master, theme: themeOfMaster(deck, master) };
}

export function colorContext(ch: Chain): ColorContext {
  return { theme: ch.theme, clrMap: { ...DEFAULT_CLRMAP, ...ch.master?.clrMap, ...ch.layout?.clrMapOvr, ...ch.slide?.clrMapOvr } };
}

// ------------------------------------------------------------------------------------------------ placeholders

const bodyKind = (t: Placeholder['type']) => (t === 'title' || t === 'ctrTitle' ? 'title' : t === 'dt' || t === 'ftr' || t === 'sldNum' || t === 'hdr' ? t : 'body');

/** The shape of `shapes` that a placeholder inherits from. */
export function matchPlaceholder(shapes: SlideElement[], ph: Placeholder, lvl: 'layout' | 'master'): ShapeEl | undefined {
  const cands = shapes.filter((s): s is ShapeEl => s.kind === 'shape' && !!s.ph);
  if (lvl === 'layout') {
    if (ph.idx !== undefined) {
      const byIdx = cands.find((c) => c.ph!.idx === ph.idx && bodyKind(c.ph!.type) === bodyKind(ph.type));
      if (byIdx) return byIdx;
      const any = cands.find((c) => c.ph!.idx === ph.idx);
      if (any) return any;
    }
    return cands.find((c) => c.ph!.type === ph.type) ?? cands.find((c) => bodyKind(c.ph!.type) === bodyKind(ph.type) && (bodyKind(ph.type) !== 'body' || ph.idx === undefined || c.ph!.idx === undefined));
  }
  return cands.find((c) => c.ph!.type === ph.type) ?? cands.find((c) => bodyKind(c.ph!.type) === bodyKind(ph.type));
}

/** The chain of shapes a placeholder inherits from: layout shape then master shape. */
export function placeholderParents(ch: Chain, el: SlideElement, onSlide = true): ShapeEl[] {
  const ph = (el.kind === 'shape' || el.kind === 'pic') && el.ph ? el.ph : undefined;
  if (!ph) return [];
  const out: ShapeEl[] = [];
  let layoutShape: ShapeEl | undefined;
  if (onSlide && ch.layout) layoutShape = matchPlaceholder(ch.layout.shapes, ph, 'layout');
  if (layoutShape) out.push(layoutShape);
  if (ch.master) {
    const m = matchPlaceholder(ch.master.shapes, layoutShape?.ph ?? ph, 'master');
    if (m) out.push(m);
  }
  return out;
}

export function effectiveXfrm(ch: Chain, el: SlideElement, onSlide = true): Xfrm {
  if (el.xfrm) return el.xfrm;
  for (const p of placeholderParents(ch, el, onSlide)) if (p.xfrm) return p.xfrm;
  return { x: 0, y: 0, w: 100, h: 50 };
}

// ------------------------------------------------------------------------------------------------ fills, lines, effects

type FillOrRef = Fill | undefined;

/** Resolves `inherit`/style references into a concrete fill. `phClr` colours are substituted by the caller via the context. */
export function styleFill(theme: Theme, ref: StyleRef['fill']): { fill: Fill; c?: StyleRef['fill'] } | undefined {
  if (!ref || ref.idx === 0) return undefined;
  const list = ref.idx >= 1001 ? theme.fmt.bgFills : theme.fmt.fills;
  const f = list[(ref.idx >= 1001 ? ref.idx - 1001 : ref.idx - 1) % Math.max(1, list.length)];
  return f ? { fill: f, c: ref } : undefined;
}
export function styleLn(theme: Theme, ref: StyleRef['ln']): Ln | undefined {
  if (!ref || ref.idx === 0) return undefined;
  return theme.fmt.lns[(ref.idx - 1) % Math.max(1, theme.fmt.lns.length)];
}
export function styleEffects(theme: Theme, ref: StyleRef['effect']): Effects | undefined {
  if (!ref || ref.idx === 0) return undefined;
  return theme.fmt.effects[(ref.idx - 1) % Math.max(1, theme.fmt.effects.length)];
}

export interface Look {
  fill: Fill;
  /** colour that `phClr` means for fills of this shape */
  fillClr?: StyleRef['fill'];
  ln: Ln | undefined;
  lnClr?: StyleRef['ln'];
  effects: Effects;
  effectClr?: StyleRef['effect'];
}

/** The fill, outline and effects of a shape after inheriting from its style and placeholder parents. */
export function resolveLook(ch: Chain, el: SlideElement, onSlide = true): Look {
  const chain: SlideElement[] = [el, ...placeholderParents(ch, el, onSlide)];
  let fill: FillOrRef;
  let ln: Ln | undefined;
  let effects: Effects | undefined;
  let style: StyleRef | undefined;
  for (const e of chain) {
    const s = e as { fill?: Fill; ln?: Ln; effects?: Effects; style?: StyleRef };
    if (!fill && s.fill && s.fill.t !== 'inherit') fill = s.fill;
    if (s.ln) ln = mergeLn(ln, s.ln);
    if (!effects && s.effects && Object.keys(s.effects).length) effects = s.effects;
    if (!style && s.style) style = s.style;
  }
  let fillClr: StyleRef['fill'];
  if (!fill) {
    const sf = styleFill(ch.theme, style?.fill);
    fill = sf?.fill ?? { t: 'none' };
    fillClr = sf?.c;
  }
  let lnClr: StyleRef['ln'];
  const base = styleLn(ch.theme, style?.ln);
  if (base) {
    ln = mergeLn(base, ln);
    lnClr = style?.ln;
  }
  let effectClr: StyleRef['effect'];
  if (!effects) {
    effects = styleEffects(ch.theme, style?.effect) ?? {};
    effectClr = style?.effect;
  }
  return { fill, fillClr, ln, lnClr, effects, effectClr };
}

export function mergeLn(base: Ln | undefined, over: Ln | undefined): Ln | undefined {
  if (!base) return over;
  if (!over) return base;
  const out: Ln = { ...base };
  for (const [k, v] of Object.entries(over)) if (v !== undefined && !(k === 'fill' && (v as Fill).t === 'inherit')) (out as Record<string, unknown>)[k] = v;
  return out;
}

// ------------------------------------------------------------------------------------------------ text styles

const mergeP = (a: ParaProps | undefined, b: ParaProps | undefined): ParaProps => {
  const out: ParaProps = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) {
    if (v === undefined) continue;
    if (k === 'bullet' && a?.bullet && (v as ParaProps['bullet'])!.kind === 'inherit') continue;
    if (k === 'bullet' && a?.bullet && (v as ParaProps['bullet'])!.kind !== 'inherit') {
      // a partial bullet (colour, size) keeps the kind of the parent
      const nb = v as NonNullable<ParaProps['bullet']>;
      (out as Record<string, unknown>)[k] = { ...a.bullet, ...nb };
      continue;
    }
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
};
export const mergeR = (a: RunProps | undefined, b: RunProps | undefined): RunProps => {
  const out: RunProps = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
};

function levelOf(ls: ListStyle | undefined, lvl: number): { pPr?: ParaProps; rPr?: RunProps } {
  if (!ls) return {};
  const def = ls.def;
  const l = ls.lvl?.[lvl];
  return { pPr: mergeP(def?.pPr, l?.pPr), rPr: mergeR(def?.rPr, l?.rPr) };
}

/** Which master text style a shape uses. */
function masterStyleFor(master: Master | undefined, ph?: Placeholder): ListStyle | undefined {
  if (!master) return undefined;
  if (!ph) return master.txStyles.other;
  const k = bodyKind(ph.type);
  if (k === 'title') return master.txStyles.title;
  if (k === 'body') return master.txStyles.body;
  return master.txStyles.other;
}

export interface TextContext {
  /** the lists of styles from most general to most specific */
  lists: (ListStyle | undefined)[];
  body: BodyProps;
  ph?: Placeholder;
}

export function textContext(deck: Deck, ch: Chain, el: ShapeEl, onSlide = true): TextContext {
  const parents = placeholderParents(ch, el, onSlide);
  const lists: (ListStyle | undefined)[] = [deck.defaultText, masterStyleFor(ch.master, el.ph)];
  const bodies: (BodyProps | undefined)[] = [];
  // parents come layout first; apply master then layout (general to specific)
  for (const p of [...parents].reverse()) {
    lists.push(p.text?.lst);
    bodies.push(p.text?.body);
  }
  // the colour (and font) a shape's style gives to its text
  if (el.style?.font?.c) lists.push({ def: { rPr: { color: el.style.font.c } } });
  lists.push(el.text?.lst);
  bodies.push(el.text?.body);
  const body: BodyProps = {};
  for (const b of bodies) for (const [k, v] of Object.entries(b ?? {})) if (v !== undefined) (body as Record<string, unknown>)[k] = v;
  return { lists, body, ph: el.ph };
}

export function levelStyle(tc: TextContext, lvl: number): { pPr: ParaProps; rPr: RunProps } {
  let pPr: ParaProps = {};
  let rPr: RunProps = {};
  for (const l of tc.lists) {
    const x = levelOf(l, lvl);
    pPr = mergeP(pPr, x.pPr);
    rPr = mergeR(rPr, x.rPr);
  }
  return { pPr, rPr };
}

/** Replaces `+mj-lt`-style font tokens with the theme fonts. */
export function themeFont(theme: Theme, name: string | undefined): string | undefined {
  if (!name) return undefined;
  switch (name) {
    case '+mj-lt':
      return theme.fonts.major.latin;
    case '+mn-lt':
      return theme.fonts.minor.latin;
    case '+mj-ea':
      return theme.fonts.major.ea || theme.fonts.major.latin;
    case '+mn-ea':
      return theme.fonts.minor.ea || theme.fonts.minor.latin;
    case '+mj-cs':
      return theme.fonts.major.cs || theme.fonts.major.latin;
    case '+mn-cs':
      return theme.fonts.minor.cs || theme.fonts.minor.latin;
    default:
      return name;
  }
}

/** Body properties of a text box (insets default to PowerPoint's 7.2/3.6 pt). */
export const withBodyDefaults = (b: BodyProps): Required<Pick<BodyProps, 'lIns' | 'tIns' | 'rIns' | 'bIns' | 'anchor' | 'wrap'>> & BodyProps => ({ lIns: 7.2, tIns: 3.6, rIns: 7.2, bIns: 3.6, anchor: 't', wrap: 'square', ...b });

export function bodyOf(t: TextBody | undefined): BodyProps {
  return t?.body ?? {};
}
