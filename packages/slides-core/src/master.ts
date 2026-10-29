import { newId, placeholder } from './defaults';
import { cloneElement, setLayout } from './ops';
import type { Deck, Layout, Master, PhType, ShapeEl, Slide, SlideElement, Theme } from './types';

/*
 * Slide master view. A master or a layout is edited as if it were a slide: `virtualMasterDeck` builds a deck with a single slide
 * that holds the shapes being edited (and an empty copy of the master or layout in its place, so placeholders inherit correctly),
 * every editing operation works on that deck, and `foldMasterDeck` puts the result back into the real one.
 */

export type MasterTarget = { kind: 'master' | 'layout'; id: string };
export const VIRTUAL_LAYOUT = '__master_view';

export function masterTargetValid(deck: Deck, t: MasterTarget | null): t is MasterTarget {
  if (!t) return false;
  return t.kind === 'master' ? deck.masters.some((m) => m.id === t.id) : deck.layouts.some((l) => l.id === t.id);
}

export function virtualMasterDeck(deck: Deck, t: MasterTarget): Deck {
  if (t.kind === 'layout') {
    const l = deck.layouts.find((x) => x.id === t.id)!;
    const slide: Slide = { id: l.id, layoutId: l.id, shapes: l.shapes, ...(l.bg ? { bg: l.bg } : {}), showMasterSp: l.showMasterSp };
    return { ...deck, layouts: deck.layouts.map((x) => (x.id === l.id ? { ...l, shapes: [] } : x)), slides: [slide] };
  }
  const m = deck.masters.find((x) => x.id === t.id)!;
  const vl: Layout = { id: VIRTUAL_LAYOUT, name: m.name, masterId: m.id, shapes: [], showMasterSp: false };
  const slide: Slide = { id: m.id, layoutId: VIRTUAL_LAYOUT, shapes: m.shapes, ...(m.bg ? { bg: m.bg } : {}) };
  return { ...deck, masters: deck.masters.map((x) => (x.id === m.id ? { ...m, shapes: [], bg: undefined } : x)), layouts: [...deck.layouts, vl], slides: [slide] };
}

export function foldMasterDeck(real: Deck, next: Deck, t: MasterTarget): Deck {
  const vs = next.slides[0];
  if (!vs) return real;
  if (t.kind === 'layout') {
    return { ...next, slides: real.slides, layouts: next.layouts.map((l) => (l.id === t.id ? { ...l, shapes: vs.shapes, bg: vs.bg, showMasterSp: vs.showMasterSp } : l)) };
  }
  return {
    ...next,
    slides: real.slides,
    layouts: next.layouts.filter((l) => l.id !== VIRTUAL_LAYOUT),
    masters: next.masters.map((m) => (m.id === t.id ? { ...m, shapes: vs.shapes, bg: vs.bg } : m)),
  };
}

// ------------------------------------------------------------------------------------------------ layouts

const FOOTERS: PhType[] = ['dt', 'ftr', 'sldNum'];

const cloneShapes = (els: SlideElement[]): SlideElement[] => els.map((e) => cloneElement(e));

/** A new layout in a master: a title and the footer placeholders of the master. */
export function addLayout(deck: Deck, masterId: string, name = 'Diseño personalizado', afterId?: string): { deck: Deck; id: string } {
  const m = deck.masters.find((x) => x.id === masterId);
  if (!m) return { deck, id: '' };
  const title = m.shapes.find((s): s is ShapeEl => s.kind === 'shape' && (s.ph?.type === 'title' || s.ph?.type === 'ctrTitle'));
  const shapes: SlideElement[] = [placeholder('title', undefined, title?.xfrm ? { ...title.xfrm } : undefined, 'Haga clic para modificar el título')];
  for (const s of m.shapes) if (s.kind === 'shape' && s.ph && FOOTERS.includes(s.ph.type)) shapes.push({ ...cloneElement(s), xfrm: undefined } as SlideElement);
  const layout: Layout = { id: newId('l'), name, masterId, shapes, showMasterSp: true, userDrawn: true };
  return { deck: insertLayout(deck, layout, afterId), id: layout.id };
}

function insertLayout(deck: Deck, layout: Layout, afterId?: string): Deck {
  const m = deck.masters.find((x) => x.id === layout.masterId)!;
  const ids = [...m.layoutIds];
  const at = afterId ? ids.indexOf(afterId) : -1;
  ids.splice(at >= 0 ? at + 1 : ids.length, 0, layout.id);
  return { ...deck, layouts: [...deck.layouts, layout], masters: deck.masters.map((x) => (x.id === m.id ? { ...x, layoutIds: ids } : x)) };
}

export function duplicateLayout(deck: Deck, id: string): { deck: Deck; id: string } {
  const l = deck.layouts.find((x) => x.id === id);
  if (!l) return { deck, id: '' };
  const copy: Layout = { ...l, id: newId('l'), name: `1_${l.name}`, shapes: cloneShapes(l.shapes), userDrawn: true };
  return { deck: insertLayout(deck, copy, id), id: copy.id };
}

export const renameLayout = (deck: Deck, id: string, name: string): Deck => ({ ...deck, layouts: deck.layouts.map((l) => (l.id === id ? { ...l, name } : l)) });
export const renameMaster = (deck: Deck, id: string, name: string): Deck => ({ ...deck, masters: deck.masters.map((m) => (m.id === id ? { ...m, name } : m)) });

export function moveLayout(deck: Deck, id: string, delta: number): Deck {
  const l = deck.layouts.find((x) => x.id === id);
  const m = deck.masters.find((x) => x.id === l?.masterId);
  if (!l || !m) return deck;
  const ids = [...m.layoutIds];
  const i = ids.indexOf(id);
  const j = Math.max(0, Math.min(ids.length - 1, i + delta));
  if (i < 0 || i === j) return deck;
  ids.splice(i, 1);
  ids.splice(j, 0, id);
  return { ...deck, masters: deck.masters.map((x) => (x.id === m.id ? { ...x, layoutIds: ids } : x)) };
}

/** Removes a layout; the slides that used it move to the nearest layout of the same master. A master keeps at least one. */
export function deleteLayout(deck: Deck, id: string): { deck: Deck; moved: number } {
  const l = deck.layouts.find((x) => x.id === id);
  const m = deck.masters.find((x) => x.id === l?.masterId);
  if (!l || !m || m.layoutIds.length <= 1) return { deck, moved: 0 };
  const siblings = m.layoutIds.filter((x) => x !== id);
  const pos = m.layoutIds.indexOf(id);
  const sibs = deck.layouts.filter((x) => siblings.includes(x.id));
  const target = sibs.find((x) => l.type && x.type === l.type) ?? sibs.find((x) => x.id === siblings[Math.min(pos, siblings.length - 1)]) ?? sibs[0]!;
  let d = deck;
  let moved = 0;
  for (const s of deck.slides) {
    if (s.layoutId === id) {
      d = setLayout(d, s.id, target.id);
      moved++;
    }
  }
  return { deck: { ...d, layouts: d.layouts.filter((x) => x.id !== id), masters: d.masters.map((x) => (x.id === m.id ? { ...x, layoutIds: siblings } : x)) }, moved };
}

/** Which footer placeholders (date, footer, slide number) a layout has. */
export const layoutFooters = (l: Layout): Record<'dt' | 'ftr' | 'sldNum', boolean> => ({
  dt: l.shapes.some((s) => s.kind === 'shape' && s.ph?.type === 'dt'),
  ftr: l.shapes.some((s) => s.kind === 'shape' && s.ph?.type === 'ftr'),
  sldNum: l.shapes.some((s) => s.kind === 'shape' && s.ph?.type === 'sldNum'),
});

/** The placeholder shape of a kind for a layout (footers copy the master's). */
export function newPlaceholder(deck: Deck, masterId: string, kind: PhType): ShapeEl {
  const m = deck.masters.find((x) => x.id === masterId);
  const fromMaster = m?.shapes.find((s): s is ShapeEl => s.kind === 'shape' && s.ph?.type === kind);
  if (fromMaster && FOOTERS.includes(kind)) return { ...(cloneElement(fromMaster) as ShapeEl), xfrm: undefined };
  const W = deck.size.w;
  const H = deck.size.h;
  const prompts: Partial<Record<PhType, string>> = {
    title: 'Haga clic para modificar el título',
    body: 'Haga clic para modificar los estilos de texto del patrón',
    obj: 'Haga clic para agregar contenido',
    pic: 'Haga clic para agregar una imagen',
    chart: 'Haga clic para agregar un gráfico',
    tbl: 'Haga clic para agregar una tabla',
    media: 'Haga clic para agregar multimedia',
    clipArt: 'Haga clic para agregar una imagen prediseñada',
    dgm: 'Haga clic para agregar un diagrama',
  };
  const xfrm = { x: W * 0.1, y: H * 0.3, w: W * 0.8, h: H * 0.5 };
  const idx = Math.max(10, ...(m?.shapes ?? []).map(() => 0)) + 1;
  return placeholder(kind, kind === 'title' ? undefined : idx, xfrm, prompts[kind] ?? '');
}

// ------------------------------------------------------------------------------------------------ masters

/** A copy of a master with its layouts and theme. */
export function duplicateMaster(deck: Deck, id: string): { deck: Deck; id: string } {
  const m = deck.masters.find((x) => x.id === id);
  if (!m) return { deck, id: '' };
  const theme = deck.themes.find((t) => t.id === m.themeId);
  const newTheme: Theme | undefined = theme ? { ...theme, id: newId('th'), name: theme.name } : undefined;
  const nm: Master = { ...m, id: newId('m'), name: `1_${m.name}`, themeId: newTheme?.id ?? m.themeId, shapes: cloneShapes(m.shapes), layoutIds: [] };
  const layouts: Layout[] = m.layoutIds
    .map((lid) => deck.layouts.find((l) => l.id === lid))
    .filter((l): l is Layout => !!l)
    .map((l) => ({ ...l, id: newId('l'), masterId: nm.id, shapes: cloneShapes(l.shapes) }));
  nm.layoutIds = layouts.map((l) => l.id);
  return { deck: { ...deck, themes: newTheme ? [...deck.themes, newTheme] : deck.themes, masters: [...deck.masters, nm], layouts: [...deck.layouts, ...layouts] }, id: nm.id };
}

/** Removes a master (not the last one); its slides move to the layouts of the first remaining master with the same name or type. */
export function deleteMaster(deck: Deck, id: string): Deck {
  const m = deck.masters.find((x) => x.id === id);
  if (!m || deck.masters.length <= 1) return deck;
  const rest = deck.masters.find((x) => x.id !== id)!;
  const restLayouts = deck.layouts.filter((l) => l.masterId === rest.id);
  let d = deck;
  for (const s of deck.slides) {
    const cur = deck.layouts.find((l) => l.id === s.layoutId);
    if (cur?.masterId !== id) continue;
    const t = restLayouts.find((l) => l.name === cur.name) ?? restLayouts.find((l) => cur.type && l.type === cur.type) ?? restLayouts[0]!;
    d = setLayout(d, s.id, t.id);
  }
  const themeUsed = d.masters.some((x) => x.id !== id && x.themeId === m.themeId);
  return { ...d, masters: d.masters.filter((x) => x.id !== id), layouts: d.layouts.filter((l) => l.masterId !== id), themes: themeUsed ? d.themes : d.themes.filter((t) => t.id !== m.themeId) };
}
