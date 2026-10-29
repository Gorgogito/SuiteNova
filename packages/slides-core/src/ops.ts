import { newId, newSlideFromLayout } from './defaults';
import { docNode, makeDoc, mapDoc } from './text';
import type { Deck, GroupEl, Layout, ListStyle, Master, ParaProps, RunProps, Slide, SlideElement, TableCell, TextBody, Xfrm } from './types';

/*
 * Pure operations on a deck. Each returns a new deck that shares everything it did not touch, so undo is a matter of keeping the
 * previous value.
 */

export type Resolver = (el: SlideElement) => Xfrm;

// ------------------------------------------------------------------------------------------------ lookup

export function findElement(shapes: SlideElement[], id: string): { el: SlideElement; parent: GroupEl | null; list: SlideElement[] } | null {
  for (const el of shapes) {
    if (el.id === id) return { el, parent: null, list: shapes };
    if (el.kind === 'group') {
      const r = findElement(el.children, id);
      if (r) return { ...r, parent: r.parent ?? el };
    }
  }
  return null;
}

export const slideIndex = (deck: Deck, id: string): number => deck.slides.findIndex((s) => s.id === id);

export function mapShapes(shapes: SlideElement[], fn: (el: SlideElement) => SlideElement): SlideElement[] {
  let changed = false;
  const out = shapes.map((el) => {
    let next = fn(el);
    if (next.kind === 'group') {
      const kids = mapShapes(next.children, fn);
      if (kids !== next.children) next = { ...next, children: kids };
    }
    if (next !== el) changed = true;
    return next;
  });
  return changed ? out : shapes;
}

export function updateSlide(deck: Deck, slideId: string, fn: (s: Slide) => Slide): Deck {
  let changed = false;
  const slides = deck.slides.map((s) => {
    if (s.id !== slideId) return s;
    const n = fn(s);
    if (n !== s) changed = true;
    return n;
  });
  return changed ? { ...deck, slides } : deck;
}

export function updateElement(deck: Deck, slideId: string, elId: string, fn: (el: SlideElement) => SlideElement): Deck {
  return updateSlide(deck, slideId, (s) => {
    const shapes = mapShapes(s.shapes, (el) => (el.id === elId ? fn(el) : el));
    return shapes === s.shapes ? s : { ...s, shapes };
  });
}

export function updateElements(deck: Deck, slideId: string, ids: string[], fn: (el: SlideElement) => SlideElement): Deck {
  const set = new Set(ids);
  return updateSlide(deck, slideId, (s) => {
    const shapes = mapShapes(s.shapes, (el) => (set.has(el.id) ? fn(el) : el));
    return shapes === s.shapes ? s : { ...s, shapes };
  });
}

// ------------------------------------------------------------------------------------------------ slides

export function addSlide(deck: Deck, layoutId: string, afterIndex: number): { deck: Deck; slide: Slide } {
  const layout = deck.layouts.find((l) => l.id === layoutId) ?? deck.layouts[0]!;
  const slide: Slide = { id: newId('s'), layoutId: layout.id, shapes: newSlideFromLayout(layout).shapes };
  const slides = [...deck.slides];
  slides.splice(afterIndex + 1, 0, slide);
  return { deck: { ...deck, slides, sections: placeInSection(deck, slide.id, afterIndex) }, slide };
}

/** A new slide joins the section of the slide it follows. */
function placeInSection(deck: Deck, newId: string, afterIndex: number): Deck['sections'] {
  if (!deck.sections.length) return deck.sections;
  const after = deck.slides[afterIndex]?.id;
  let placed = false;
  const secs = deck.sections.map((s) => {
    const i = s.slideIds.indexOf(after ?? '');
    if (i >= 0) {
      placed = true;
      const ids = [...s.slideIds];
      ids.splice(i + 1, 0, newId);
      return { ...s, slideIds: ids };
    }
    return s;
  });
  if (!placed) {
    const first = secs[0]!;
    return [{ ...first, slideIds: [newId, ...first.slideIds] }, ...secs.slice(1)];
  }
  return secs;
}

export function deleteSlides(deck: Deck, ids: string[]): Deck {
  const set = new Set(ids);
  const slides = deck.slides.filter((s) => !set.has(s.id));
  if (!slides.length) return deck;
  return { ...deck, slides, sections: deck.sections.map((s) => ({ ...s, slideIds: s.slideIds.filter((x) => !set.has(x)) })) };
}

/** Moves the given slides (in their current order) so that they start at `toIndex` of the remaining slides. */
export function moveSlides(deck: Deck, ids: string[], toIndex: number): Deck {
  const set = new Set(ids);
  const moving = deck.slides.filter((s) => set.has(s.id));
  const rest = deck.slides.filter((s) => !set.has(s.id));
  const at = Math.max(0, Math.min(rest.length, toIndex));
  const slides = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  // slides keep their section; sections are recomputed in order so that each section stays contiguous
  const secOf = new Map<string, string>();
  for (const s of deck.sections) for (const id of s.slideIds) secOf.set(id, s.id);
  const moved = moving.map((m) => m.id);
  const neighbour = slides[at - 1]?.id ?? slides[at + moving.length]?.id;
  const target = neighbour ? secOf.get(neighbour) : undefined;
  const sections = deck.sections.length
    ? deck.sections.map((s) => ({ ...s, slideIds: slides.map((x) => x.id).filter((id) => (moved.includes(id) ? s.id === target : secOf.get(id) === s.id)) }))
    : deck.sections;
  return { ...deck, slides, sections };
}

export const cloneElements = (shapes: SlideElement[]): SlideElement[] => shapes.map((e) => cloneElement(e));
export function cloneElement(e: SlideElement): SlideElement {
  const copy = { ...e, id: newId() } as SlideElement;
  delete (copy as { srcId?: number }).srcId;
  if (copy.kind === 'group') copy.children = cloneElements(copy.children);
  return copy;
}

export function duplicateSlides(deck: Deck, ids: string[]): { deck: Deck; ids: string[] } {
  const set = new Set(ids);
  const slides: Slide[] = [];
  const created: string[] = [];
  const sections = deck.sections.map((s) => ({ ...s, slideIds: [...s.slideIds] }));
  for (const s of deck.slides) {
    slides.push(s);
    if (set.has(s.id)) {
      const copy: Slide = { ...s, id: newId('s'), shapes: cloneElements(s.shapes), timing: undefined };
      slides.push(copy);
      created.push(copy.id);
      for (const sec of sections) {
        const i = sec.slideIds.indexOf(s.id);
        if (i >= 0) sec.slideIds.splice(i + 1, 0, copy.id);
      }
    }
  }
  return { deck: { ...deck, slides, sections }, ids: created };
}

/** Changes the layout of a slide: placeholders that still exist keep their content, missing ones are added. */
export function setLayout(deck: Deck, slideId: string, layoutId: string): Deck {
  const layout = deck.layouts.find((l) => l.id === layoutId);
  if (!layout) return deck;
  return updateSlide(deck, slideId, (s) => {
    const wanted = layout.shapes.filter((x) => x.kind === 'shape' && x.ph && !['dt', 'ftr', 'sldNum'].includes(x.ph.type));
    const taken = new Set<string>();
    const keep: SlideElement[] = [];
    const orphans: SlideElement[] = [];
    for (const el of s.shapes) {
      if ((el.kind === 'shape' || el.kind === 'pic') && el.ph) {
        const m = wanted.find((w) => w.kind === 'shape' && !taken.has(w.id) && samePh(w.ph!, el.ph!));
        if (m) {
          taken.add(m.id);
          keep.push(el);
          continue;
        }
        const text = el.kind === 'shape' ? el.text : undefined;
        const empty = !text || JSON.stringify(text.doc).indexOf('"text"') < 0;
        if (empty && el.kind === 'shape') continue;
        // content that has no placeholder in the new layout stays where it was, as a loose shape
        orphans.push({ ...el, ph: undefined, xfrm: el.xfrm });
        continue;
      }
      keep.push(el);
    }
    const added = newSlideFromLayout(layout).shapes.filter((n) => n.kind === 'shape' && n.ph && !keep.some((k) => (k.kind === 'shape' || k.kind === 'pic') && k.ph && samePh(k.ph, n.ph!)));
    return { ...s, layoutId, shapes: [...added, ...keep, ...orphans] };
  });
}

const phKind = (t: string) => (t === 'title' || t === 'ctrTitle' ? 'title' : t === 'subTitle' ? 'sub' : t === 'body' || t === 'obj' ? 'body' : t);
function samePh(a: { type: string; idx?: number }, b: { type: string; idx?: number }): boolean {
  if (a.idx !== undefined && b.idx !== undefined && a.idx === b.idx) return phKind(a.type) === phKind(b.type) || true;
  return phKind(a.type) === phKind(b.type) && (a.idx === undefined || b.idx === undefined || a.idx === b.idx);
}

// ------------------------------------------------------------------------------------------------ elements

export function addElements(deck: Deck, slideId: string, els: SlideElement[]): Deck {
  return updateSlide(deck, slideId, (s) => ({ ...s, shapes: [...s.shapes, ...els] }));
}

export function removeElements(deck: Deck, slideId: string, ids: string[]): Deck {
  const set = new Set(ids);
  const strip = (list: SlideElement[]): SlideElement[] => {
    let changed = false;
    const out: SlideElement[] = [];
    for (const e of list) {
      if (set.has(e.id)) {
        changed = true;
        continue;
      }
      if (e.kind === 'group') {
        const kids = strip(e.children);
        if (kids !== e.children) {
          changed = true;
          if (kids.length) out.push({ ...e, children: kids });
          continue;
        }
      }
      out.push(e);
    }
    return changed ? out : list;
  };
  return updateSlide(deck, slideId, (s) => {
    const shapes = strip(s.shapes);
    // animations of removed shapes go away with them
    const timing = s.timing && shapes !== s.shapes ? { ...s.timing, effects: s.timing.effects.filter((e) => !set.has(e.target)), rawXml: undefined } : s.timing;
    return shapes === s.shapes ? s : { ...s, shapes, timing };
  });
}

export type ZMove = 'front' | 'back' | 'forward' | 'backward';
export function reorderElements(deck: Deck, slideId: string, ids: string[], how: ZMove): Deck {
  const set = new Set(ids);
  return updateSlide(deck, slideId, (s) => {
    const arr = [...s.shapes];
    const idx = arr.map((e, i) => (set.has(e.id) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return s;
    const picked = idx.map((i) => arr[i]!);
    const others = arr.filter((e) => !set.has(e.id));
    let out: SlideElement[];
    if (how === 'front') out = [...others, ...picked];
    else if (how === 'back') out = [...picked, ...others];
    else if (how === 'forward') {
      out = [...arr];
      for (let k = idx.length - 1; k >= 0; k--) {
        const i = idx[k]!;
        if (i + 1 < out.length && !set.has(out[i + 1]!.id)) [out[i], out[i + 1]] = [out[i + 1]!, out[i]!];
      }
    } else {
      out = [...arr];
      for (const i of idx) if (i > 0 && !set.has(out[i - 1]!.id)) [out[i], out[i - 1]] = [out[i - 1]!, out[i]!];
    }
    return { ...s, shapes: out };
  });
}

// ------------------------------------------------------------------------------------------------ geometry

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The box of an element once rotated (the bounds of what the eye sees). */
export function visualBox(x: Xfrm): Box {
  if (!x.rot) return { x: x.x, y: x.y, w: x.w, h: x.h };
  const a = (x.rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const w = x.w * c + x.h * s;
  const h = x.w * s + x.h * c;
  return { x: x.x + x.w / 2 - w / 2, y: x.y + x.h / 2 - h / 2, w, h };
}

export function unionBox(boxes: Box[]): Box {
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export const withXfrm = (el: SlideElement, resolve: Resolver, patch: Partial<Xfrm>): SlideElement => ({ ...el, xfrm: { ...resolve(el), ...patch } }) as SlideElement;

export type AlignHow = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
/**
 * Aligns elements. With several objects they align to their common box ("selection"); with one object, to the slide. `to` forces one.
 */
export function alignElements(deck: Deck, slideId: string, ids: string[], how: AlignHow, resolve: Resolver, to?: 'selection' | 'slide'): Deck {
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide || !ids.length) return deck;
  const els = ids.map((id) => findElement(slide.shapes, id)?.el).filter((e): e is SlideElement => !!e);
  const target: Box = (to ?? (els.length > 1 ? 'selection' : 'slide')) === 'slide' ? { x: 0, y: 0, w: deck.size.w, h: deck.size.h } : unionBox(els.map((e) => visualBox(resolve(e))));
  return updateElements(deck, slideId, ids, (el) => {
    const x = resolve(el);
    const v = visualBox(x);
    let dx = 0;
    let dy = 0;
    if (how === 'left') dx = target.x - v.x;
    else if (how === 'center') dx = target.x + target.w / 2 - (v.x + v.w / 2);
    else if (how === 'right') dx = target.x + target.w - (v.x + v.w);
    else if (how === 'top') dy = target.y - v.y;
    else if (how === 'middle') dy = target.y + target.h / 2 - (v.y + v.h / 2);
    else dy = target.y + target.h - (v.y + v.h);
    return dx || dy ? ({ ...el, xfrm: { ...x, x: x.x + dx, y: x.y + dy } } as SlideElement) : el;
  });
}

/** Spreads three or more elements so that the gaps between them are equal. */
export function distributeElements(deck: Deck, slideId: string, ids: string[], axis: 'h' | 'v', resolve: Resolver, to?: 'selection' | 'slide'): Deck {
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) return deck;
  const els = ids.map((id) => findElement(slide.shapes, id)?.el).filter((e): e is SlideElement => !!e);
  if (els.length < 2) return deck;
  const boxes = els.map((e) => ({ el: e, b: visualBox(resolve(e)) }));
  const h = axis === 'h';
  const sorted = [...boxes].sort((a, b) => (h ? a.b.x - b.b.x : a.b.y - b.b.y));
  const span = to === 'slide' ? { start: 0, end: h ? deck.size.w : deck.size.h } : { start: h ? sorted[0]!.b.x : sorted[0]!.b.y, end: Math.max(...sorted.map((s) => (h ? s.b.x + s.b.w : s.b.y + s.b.h))) };
  const total = sorted.reduce((a, s) => a + (h ? s.b.w : s.b.h), 0);
  const gap = (span.end - span.start - total) / Math.max(1, sorted.length - (to === 'slide' ? -1 : 1));
  let pos = to === 'slide' ? span.start + gap : span.start;
  const target = new Map<string, number>();
  for (const s of sorted) {
    target.set(s.el.id, pos);
    pos += (h ? s.b.w : s.b.h) + gap;
  }
  return updateElements(deck, slideId, ids, (el) => {
    const x = resolve(el);
    const v = visualBox(x);
    const t = target.get(el.id);
    if (t === undefined) return el;
    return h ? ({ ...el, xfrm: { ...x, x: x.x + (t - v.x) } } as SlideElement) : ({ ...el, xfrm: { ...x, y: x.y + (t - v.y) } } as SlideElement);
  });
}

export function moveElements(deck: Deck, slideId: string, ids: string[], dx: number, dy: number, resolve: Resolver): Deck {
  return updateElements(deck, slideId, ids, (el) => {
    const x = resolve(el);
    return { ...el, xfrm: { ...x, x: x.x + dx, y: x.y + dy } } as SlideElement;
  });
}

/** Groups the elements; the group box is their common box and the children keep their coordinates. */
export function groupElements(deck: Deck, slideId: string, ids: string[], resolve: Resolver): { deck: Deck; id: string | null } {
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) return { deck, id: null };
  const members = slide.shapes.filter((e) => ids.includes(e.id));
  if (members.length < 2) return { deck, id: null };
  const box = unionBox(members.map((e) => visualBox(resolve(e))));
  const children = members.map((e) => ({ ...e, xfrm: resolve(e), ph: undefined }) as SlideElement);
  const g: GroupEl = { kind: 'group', id: newId(), name: 'Grupo', xfrm: { x: box.x, y: box.y, w: box.w, h: box.h }, chOff: { x: box.x, y: box.y }, chExt: { w: box.w, h: box.h }, children };
  const first = slide.shapes.findIndex((e) => ids.includes(e.id));
  const rest = slide.shapes.filter((e) => !ids.includes(e.id));
  const shapes = [...rest.slice(0, first), g, ...rest.slice(first)];
  return { deck: updateSlide(deck, slideId, (s) => ({ ...s, shapes })), id: g.id };
}

export function ungroupElements(deck: Deck, slideId: string, ids: string[]): { deck: Deck; ids: string[] } {
  const out: string[] = [];
  const d = updateSlide(deck, slideId, (s) => {
    const shapes: SlideElement[] = [];
    for (const e of s.shapes) {
      if (e.kind === 'group' && ids.includes(e.id) && !e.smartart) {
        const x = e.xfrm ?? { x: 0, y: 0, w: e.chExt.w, h: e.chExt.h };
        const sx = e.chExt.w ? x.w / e.chExt.w : 1;
        const sy = e.chExt.h ? x.h / e.chExt.h : 1;
        for (const c of e.children) {
          const cx = (c as { xfrm?: Xfrm }).xfrm;
          if (!cx) continue;
          // child positions go through the group's transform (rotation of the group is applied to the child's centre)
          let nx = x.x + (cx.x - e.chOff.x) * sx;
          let ny = x.y + (cx.y - e.chOff.y) * sy;
          const nw = cx.w * sx;
          const nh = cx.h * sy;
          let rot = cx.rot ?? 0;
          if (x.rot) {
            const a = (x.rot * Math.PI) / 180;
            const gc = { x: x.x + x.w / 2, y: x.y + x.h / 2 };
            const cc = { x: nx + nw / 2, y: ny + nh / 2 };
            const rx = gc.x + (cc.x - gc.x) * Math.cos(a) - (cc.y - gc.y) * Math.sin(a);
            const ry = gc.y + (cc.x - gc.x) * Math.sin(a) + (cc.y - gc.y) * Math.cos(a);
            nx = rx - nw / 2;
            ny = ry - nh / 2;
            rot += x.rot;
          }
          const copy = { ...c, xfrm: { ...cx, x: nx, y: ny, w: nw, h: nh, ...(rot ? { rot } : {}) } } as SlideElement;
          shapes.push(copy);
          out.push(copy.id);
        }
      } else shapes.push(e);
    }
    return { ...s, shapes };
  });
  return { deck: d, ids: out };
}

// ------------------------------------------------------------------------------------------------ slide size

const scaleRun = (r: RunProps, k: number): RunProps => (r.sz !== undefined ? { ...r, sz: Math.round(r.sz * k * 100) / 100 } : r);
const scalePara = (p: ParaProps, k: number): ParaProps => ({
  ...p,
  ...(p.marL !== undefined ? { marL: p.marL * k } : {}),
  ...(p.indent !== undefined ? { indent: p.indent * k } : {}),
  ...(p.tabs ? { tabs: p.tabs.map((t) => ({ ...t, pos: t.pos * k })) } : {}),
  ...(p.spcBef && 'pts' in p.spcBef ? { spcBef: { pts: p.spcBef.pts * k } } : {}),
  ...(p.spcAft && 'pts' in p.spcAft ? { spcAft: { pts: p.spcAft.pts * k } } : {}),
});
function scaleList(ls: ListStyle | undefined, k: number): ListStyle | undefined {
  if (!ls) return ls;
  const lv = (l: { pPr?: ParaProps; rPr?: RunProps } | undefined) => (l ? { pPr: l.pPr ? scalePara(l.pPr, k) : undefined, rPr: l.rPr ? scaleRun(l.rPr, k) : undefined } : l);
  return { def: lv(ls.def), lvl: ls.lvl?.map(lv) };
}
function scaleText(t: TextBody | null | undefined, k: number): TextBody | null | undefined {
  if (!t) return t;
  return {
    ...t,
    body: { ...t.body, ...(t.body.lIns !== undefined ? { lIns: t.body.lIns * k } : {}), ...(t.body.rIns !== undefined ? { rIns: t.body.rIns * k } : {}), ...(t.body.tIns !== undefined ? { tIns: t.body.tIns * k } : {}), ...(t.body.bIns !== undefined ? { bIns: t.body.bIns * k } : {}), ...(t.body.spcCol !== undefined ? { spcCol: t.body.spcCol * k } : {}) },
    lst: scaleList(t.lst, k),
    doc: mapDoc(t.doc, (a) => ({ ...a, p: scalePara(a.p, k) }), (r) => scaleRun(r, k)),
  };
}

function scaleElement(e: SlideElement, sx: number, sy: number, ox: number, oy: number, k: number): SlideElement {
  const x = (e as { xfrm?: Xfrm }).xfrm;
  const nx: Xfrm | undefined = x ? { ...x, x: x.x * sx + ox, y: x.y * sy + oy, w: x.w * sx, h: x.h * sy } : x;
  const base = { ...e, ...(nx ? { xfrm: nx } : {}) } as SlideElement;
  if (base.kind === 'shape') return { ...base, text: scaleText(base.text, k) ?? undefined, ln: base.ln?.w ? { ...base.ln, w: base.ln.w * k } : base.ln };
  if (base.kind === 'group') return { ...base, chOff: { x: base.chOff.x * sx + ox, y: base.chOff.y * sy + oy }, chExt: { w: base.chExt.w * sx, h: base.chExt.h * sy }, children: base.children.map((c) => scaleElement(c, sx, sy, ox, oy, k)) } as SlideElement;
  if (base.kind === 'table') return { ...base, cols: base.cols.map((c) => c * sx), rows: base.rows.map((r) => ({ h: r.h * sy, cells: r.cells.map((c): TableCell => ({ ...c, text: scaleText(c.text, k) ?? null })) })) };
  return base;
}

/**
 * Changes the slide size. The objects move and grow with the slide and **the text size scales with them** (`fit` scales by the
 * smaller ratio and centres, so nothing is cut; `max` by the larger; `stretch` stretches positions and scales text by the smaller).
 */
export function resizeSlide(deck: Deck, w: number, h: number, mode: 'fit' | 'max' | 'stretch' = 'fit', type?: string): Deck {
  const rx = w / deck.size.w;
  const ry = h / deck.size.h;
  if (rx === 1 && ry === 1) return deck;
  const k = mode === 'max' ? Math.max(rx, ry) : Math.min(rx, ry);
  const sx = mode === 'stretch' ? rx : k;
  const sy = mode === 'stretch' ? ry : k;
  const ox = mode === 'stretch' ? 0 : (w - deck.size.w * sx) / 2;
  const oy = mode === 'stretch' ? 0 : (h - deck.size.h * sy) / 2;
  const el = (e: SlideElement) => scaleElement(e, sx, sy, ox, oy, k);
  const masters: Master[] = deck.masters.map((m) => ({ ...m, shapes: m.shapes.map(el), txStyles: { title: scaleList(m.txStyles.title, k)!, body: scaleList(m.txStyles.body, k)!, other: scaleList(m.txStyles.other, k)! } }));
  const layouts: Layout[] = deck.layouts.map((l) => ({ ...l, shapes: l.shapes.map(el) }));
  const slides = deck.slides.map((s) => ({ ...s, shapes: s.shapes.map(el), notes: s.notes }));
  return { ...deck, size: { w, h, type: type ?? 'custom' }, masters, layouts, slides, defaultText: scaleList(deck.defaultText, k), guides: deck.guides?.map((g) => ({ ...g, pos: g.orient === 'h' ? g.pos * sy + oy : g.pos * sx + ox })) };
}

// ------------------------------------------------------------------------------------------------ header and footer

export interface HeaderFooterSpec {
  /** show the slide number */
  sldNum: boolean;
  /** footer text, or null for none */
  ftr: string | null;
  /** date: null for none; fixed text; or updated automatically with a format (`datetime1` short, `datetime4` long) */
  dt: null | { fixed: string } | { auto: string };
  /** do not show them on slides whose layout is a title slide */
  skipTitle?: boolean;
}

const HF_TYPES = ['dt', 'ftr', 'sldNum'] as const;

/** What the dialog shows for a slide: what its footer placeholders say now. */
export function headerFooterOf(slide: Slide): HeaderFooterSpec {
  const find = (t: string) => slide.shapes.find((s): s is Extract<SlideElement, { kind: 'shape' }> => s.kind === 'shape' && s.ph?.type === t);
  const dt = find('dt');
  const ftr = find('ftr');
  let dtSpec: HeaderFooterSpec['dt'] = null;
  if (dt?.text) {
    const node = docNodeOf(dt.text.doc);
    let field: string | undefined;
    node.descendants((n) => {
      if (n.type.name === 'field' && /^datetime/.test(n.attrs.ftype as string)) field = n.attrs.ftype as string;
    });
    dtSpec = field ? { auto: field } : { fixed: node.textContent };
  }
  return { sldNum: !!find('sldNum'), ftr: ftr?.text ? docNodeOf(ftr.text.doc).textContent : null, dt: dtSpec };
}

function docNodeOf(doc: unknown) {
  return docNode(doc);
}

/** Turns the footer placeholders of the slides on or off and sets their content (Insert > Header & Footer). */
export function applyHeaderFooter(deck: Deck, slideIds: string[], spec: HeaderFooterSpec, today = new Date()): Deck {
  const slides = deck.slides.map((s) => {
    if (!slideIds.includes(s.id)) return s;
    const layout = deck.layouts.find((l) => l.id === s.layoutId);
    const skip = spec.skipTitle && layout?.type === 'title';
    let shapes = s.shapes.filter((x) => !(x.kind === 'shape' && x.ph && (HF_TYPES as readonly string[]).includes(x.ph.type)));
    const old = (t: string) => s.shapes.find((x) => x.kind === 'shape' && x.ph?.type === t);
    const make = (type: (typeof HF_TYPES)[number], doc: unknown): SlideElement | null => {
      const src = layout?.shapes.find((x) => x.kind === 'shape' && x.ph?.type === type);
      if (!src || src.kind !== 'shape') return null;
      const keep = old(type);
      return { kind: 'shape', id: keep?.id ?? newId(), name: src.name, ph: { ...src.ph! }, text: { body: {}, doc: doc as never } };
    };
    if (!skip) {
      const add: SlideElement[] = [];
      if (spec.dt) {
        const doc = 'fixed' in spec.dt ? makeDoc([{ text: spec.dt.fixed }]) : makeDoc([{ runs: [{ field: { ftype: spec.dt.auto, text: today.toLocaleDateString() } }] }]);
        const e = make('dt', doc.toJSON());
        if (e) add.push(e);
      }
      if (spec.ftr !== null) {
        const e = make('ftr', makeDoc([{ text: spec.ftr }]).toJSON());
        if (e) add.push(e);
      }
      if (spec.sldNum) {
        const e = make('sldNum', makeDoc([{ runs: [{ field: { ftype: 'slidenum', text: '‹#›' } }] }]).toJSON());
        if (e) add.push(e);
      }
      shapes = [...shapes, ...add];
    }
    return { ...s, shapes, hf: { sldNum: spec.sldNum, ftr: spec.ftr !== null, dt: spec.dt !== null } };
  });
  return { ...deck, slides };
}

// ------------------------------------------------------------------------------------------------ sections

const sectionSlides = (deck: Deck, s: Deck['sections'][number]) => s.slideIds.filter((id) => deck.slides.some((x) => x.id === id));

/** Starts a section at a slide: it takes that slide and the ones after it up to the end of the section it was in. */
export function addSection(deck: Deck, atSlideId: string, name: string): Deck {
  const at = deck.slides.findIndex((s) => s.id === atSlideId);
  if (at < 0) return deck;
  if (!deck.sections.length) {
    const before = deck.slides.slice(0, at).map((s) => s.id);
    const rest = deck.slides.slice(at).map((s) => s.id);
    const first = before.length ? [{ id: newId('sec'), name: 'Sección predeterminada', slideIds: before }] : [];
    return { ...deck, sections: [...first, { id: newId('sec'), name, slideIds: rest }] };
  }
  const si = deck.sections.findIndex((s) => s.slideIds.includes(atSlideId));
  if (si < 0) return deck;
  const sec = deck.sections[si]!;
  const k = sec.slideIds.indexOf(atSlideId);
  if (k === 0) return deck;
  const left = { ...sec, slideIds: sec.slideIds.slice(0, k) };
  const right = { id: newId('sec'), name, slideIds: sec.slideIds.slice(k) };
  return { ...deck, sections: [...deck.sections.slice(0, si), left, right, ...deck.sections.slice(si + 1)] };
}

export const renameSection = (deck: Deck, id: string, name: string): Deck => ({ ...deck, sections: deck.sections.map((s) => (s.id === id ? { ...s, name } : s)) });

/** Removes a section: its slides join the previous one (the next one for the first section), or are deleted with it. */
export function removeSection(deck: Deck, id: string, withSlides: boolean): Deck {
  const i = deck.sections.findIndex((s) => s.id === id);
  if (i < 0) return deck;
  const sec = deck.sections[i]!;
  if (withSlides) {
    const gone = new Set(sectionSlides(deck, sec));
    if (gone.size >= deck.slides.length) return deck;
    return { ...deck, slides: deck.slides.filter((s) => !gone.has(s.id)), sections: deck.sections.filter((s) => s.id !== id) };
  }
  if (deck.sections.length === 1) return { ...deck, sections: [] };
  const rest = deck.sections.filter((s) => s.id !== id);
  const into = i > 0 ? i - 1 : 0;
  const merged = rest.map((s, k) => (k === into ? { ...s, slideIds: i > 0 ? [...s.slideIds, ...sec.slideIds] : [...sec.slideIds, ...s.slideIds] } : s));
  return { ...deck, sections: merged };
}

/** Moves a section up or down; its slides move with it. */
export function moveSection(deck: Deck, id: string, delta: -1 | 1): Deck {
  const i = deck.sections.findIndex((s) => s.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= deck.sections.length) return deck;
  const sections = [...deck.sections];
  [sections[i], sections[j]] = [sections[j]!, sections[i]!];
  const byId = new Map(deck.slides.map((s) => [s.id, s]));
  const slides = sections.flatMap((s) => sectionSlides(deck, s).map((x) => byId.get(x)!));
  return { ...deck, sections, slides: slides.length === deck.slides.length ? slides : deck.slides };
}
