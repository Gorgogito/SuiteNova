import { boundsOf, portsOf, rectsIntersect, type Rect } from './geometry';
import { defaultStyle, isGlued, newId, type Connector, type Font, type Group, type Guide, type Page, type Shape, type Style } from './model';
import { addConnector, createShape, newConnector, updateConnectors, updateShapes } from './ops';
import { parseDiagram } from './io';
import { hasStencil, stencilOf } from './stencils';

/*
 * What helps to draw: connecting a shape to the next one in one step, the guides that appear while shapes are moved,
 * guides of the page, changing a shape for another, copying the format from one thing to others, and the text that
 * shapes travel in through the clipboard.
 */

// ------------------------------------------------------------ connect to the next shape

export type Side = 'n' | 'e' | 's' | 'w';

/** The room left between a shape and the one added next to it. */
export const AUTO_GAP = 48;
/** How far a shape may be to count as the neighbour on a side. */
const NEIGHBOUR_REACH = 220;

const QUICK: Record<string, string[]> = {
  basic: ['rect', 'roundRect', 'ellipse', 'diamond'],
  flow: ['process', 'decision', 'terminator', 'document'],
  uml: ['umlClass', 'umlUseCase', 'umlComponent', 'umlNote'],
  network: ['netServer', 'netPc', 'netRouter', 'netCloud'],
  bpmn: ['bpmnTask', 'bpmnXor', 'bpmnIntermediate', 'bpmnEnd'],
};

/** The shapes offered next to the arrows of a shape: those of its family. */
export function quickShapes(stencil: string): string[] {
  return QUICK[stencilOf(stencil).category] ?? QUICK.flow!;
}

/** What follows a shape when no other is chosen: the same, except after the shapes that begin or branch a flow. */
export function nextStencil(stencil: string): string {
  if (stencil === 'terminator' || stencil === 'decision') return 'process';
  if (stencil === 'bpmnStart' || stencil === 'bpmnXor') return 'bpmnTask';
  if (stencil === 'text') return 'rect';
  return stencilOf(stencil).category === 'extra' ? 'process' : stencil;
}

const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });

/** The nearest shape on a side of another, in line with it. */
export function neighbourOn(page: Page, source: Shape, side: Side): Shape | null {
  const a = boundsOf(source);
  let best: { s: Shape; d: number } | null = null;
  for (const s of page.shapes) {
    if (s.id === source.id || s.container) continue;
    const b = boundsOf(s);
    const across = side === 'e' || side === 'w' ? Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) : Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    if (across <= 0) continue;
    const d = side === 'e' ? b.x - (a.x + a.w) : side === 'w' ? a.x - (b.x + b.w) : side === 's' ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
    if (d < 0 || d > NEIGHBOUR_REACH) continue;
    if (!best || d < best.d) best = { s, d };
  }
  return best?.s ?? null;
}

const OPPOSITE: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };
const DIR: Record<Side, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

/** The connection point of a shape that looks to a side, or "auto" when none does. */
function portToward(s: Shape, side: Side): number | 'auto' {
  const [x, y] = DIR[side];
  const found = portsOf(s).find((p) => p.dir.x === x && p.dir.y === y);
  return found ? found.index : 'auto';
}

export interface AutoConnected {
  page: Page;
  /** The shape the connector reaches. */
  shapeId: string;
  connectorId: string;
  /** False when the shape was already there. */
  added: boolean;
}

/**
 * Connects a shape to what comes next on one of its sides. Without a `stencil`, a shape already there is connected;
 * otherwise (or with one) a new shape is placed on that side, past whatever is in the way. Null when there is nothing
 * to do (the two are already connected).
 */
export function autoConnect(page: Page, sourceId: string, side: Side, stencil: string | null, connector: Partial<Connector> = {}): AutoConnected | null {
  const source = page.shapes.find((s) => s.id === sourceId);
  if (!source) return null;
  let target = stencil === null ? neighbourOn(page, source, side) : null;
  let next = page;
  const added = !target;
  if (target) {
    const id = target.id;
    const joined = page.connectors.some((c) => isGlued(c.from) && isGlued(c.to) && ((c.from.shape === sourceId && c.to.shape === id) || (c.from.shape === id && c.to.shape === sourceId)));
    if (joined) return null;
  } else {
    const wanted = stencil ?? nextStencil(source.stencil);
    const base = createShape(hasStencil(wanted) ? wanted : 'process', 0, 0, source.layer ? { layer: source.layer } : {});
    const a = boundsOf(source);
    const [dx, dy] = DIR[side];
    const at = (extra: number): Rect => ({
      x: dx > 0 ? a.x + a.w + AUTO_GAP + extra : dx < 0 ? a.x - AUTO_GAP - base.w - extra : a.x + a.w / 2 - base.w / 2,
      y: dy > 0 ? a.y + a.h + AUTO_GAP + extra : dy < 0 ? a.y - AUTO_GAP - base.h - extra : a.y + a.h / 2 - base.h / 2,
      w: base.w,
      h: base.h,
    });
    let extra = 0;
    // past the shapes that are already in the way (containers are places, not obstacles)
    for (let i = 0; i < 200 && page.shapes.some((s) => !s.container && rectsIntersect(grow(boundsOf(s), 8), at(extra))); i++) extra += (dx ? base.w : base.h) / 2 + 16;
    const box = at(extra);
    target = { ...base, x: Math.round(box.x), y: Math.round(box.y) };
    next = { ...page, shapes: [...page.shapes, target] };
  }
  const c = newConnector({ shape: source.id, port: portToward(source, side) }, { shape: target.id, port: portToward(target, OPPOSITE[side]) }, { ...connector, ...(source.layer ? { layer: source.layer } : {}) });
  return { page: addConnector(next, c), shapeId: target.id, connectorId: c.id, added };
}

// ------------------------------------------------------------ guides that appear while moving

export interface SnapLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** `space`: the line measures a gap that is repeated. */
  kind: 'align' | 'space';
}

export interface Snap {
  /** How much to move on each axis to line up; null when nothing is near enough on that axis. */
  dx: number | null;
  dy: number | null;
  lines: SnapLine[];
}

interface Axis {
  /** Position and length along the axis, and across it. */
  at: number;
  len: number;
  cross: number;
  crossLen: number;
}

const along = (r: Rect, axis: 'x' | 'y'): Axis => (axis === 'x' ? { at: r.x, len: r.w, cross: r.y, crossLen: r.h } : { at: r.y, len: r.h, cross: r.x, crossLen: r.w });

const line = (axis: 'x' | 'y', at: number, from: number, to: number, kind: SnapLine['kind']): SnapLine => (axis === 'x' ? { x1: at, y1: from, x2: at, y2: to, kind } : { x1: from, y1: at, x2: to, y2: at, kind });

function snapAxis(moving: Rect, others: Rect[], guides: number[], axis: 'x' | 'y', threshold: number): { delta: number | null; lines: (shifted: Rect) => SnapLine[] } {
  const m = along(moving, axis);
  const mine = [m.at, m.at + m.len / 2, m.at + m.len];
  let best: number | null = null;
  const offer = (d: number) => {
    if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  };
  for (const o of others) {
    const a = along(o, axis);
    for (const t of [a.at, a.at + a.len / 2, a.at + a.len]) for (const v of mine) offer(t - v);
  }
  for (const g of guides) for (const v of mine) offer(g - v);

  // the same gap as between two neighbours of the same row (or column)
  const row = others
    .map((o) => along(o, axis))
    .filter((a) => Math.min(a.cross + a.crossLen, m.cross + m.crossLen) > Math.max(a.cross, m.cross))
    .sort((p, q) => p.at - q.at);
  const spaced: { at: number; gaps: [number, number][] }[] = [];
  for (let i = 0; i + 1 < row.length; i++) {
    const a = row[i]!;
    const b = row[i + 1]!;
    const gap = b.at - (a.at + a.len);
    if (gap <= 0) continue;
    spaced.push({ at: b.at + b.len + gap, gaps: [[a.at + a.len, b.at], [b.at + b.len, b.at + b.len + gap]] });
    spaced.push({ at: a.at - gap - m.len, gaps: [[a.at - gap, a.at], [a.at + a.len, b.at]] });
    if (gap > m.len) {
      const at = a.at + a.len + (gap - m.len) / 2;
      spaced.push({ at, gaps: [[a.at + a.len, at], [at + m.len, b.at]] });
    }
  }
  for (const s of spaced) offer(s.at - m.at);

  const delta: number | null = best;
  return {
    delta,
    lines: (shifted) => {
      if (delta === null) return [];
      const n = along(shifted, axis);
      const out: SnapLine[] = [];
      const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
      const here = [n.at, n.at + n.len / 2, n.at + n.len];
      for (const v of here) {
        const lined = others.map((o) => along(o, axis)).filter((a) => [a.at, a.at + a.len / 2, a.at + a.len].some((t) => near(t, v)));
        const onGuide = guides.some((g) => near(g, v));
        if (!lined.length && !onGuide) continue;
        const from = Math.min(n.cross, ...lined.map((a) => a.cross));
        const to = Math.max(n.cross + n.crossLen, ...lined.map((a) => a.cross + a.crossLen));
        out.push(line(axis, v, from, to, 'align'));
      }
      for (const s of spaced) {
        if (!near(s.at, n.at)) continue;
        const mid = n.cross + n.crossLen / 2;
        // across the axis: a segment over each of the equal gaps
        for (const [from, to] of s.gaps) out.push(axis === 'x' ? { x1: from, y1: mid, x2: to, y2: mid, kind: 'space' } : { x1: mid, y1: from, x2: mid, y2: to, kind: 'space' });
        break;
      }
      return out;
    },
  };
}

/** Where a moved box lines up with other boxes (edges, middles, equal gaps) or with the guides of the page. */
export function snapBox(moving: Rect, others: Rect[], guides: Guide[], threshold: number): Snap {
  const x = snapAxis(moving, others, guides.filter((g) => g.axis === 'x').map((g) => g.pos), 'x', threshold);
  const y = snapAxis(moving, others, guides.filter((g) => g.axis === 'y').map((g) => g.pos), 'y', threshold);
  const shifted = { ...moving, x: moving.x + (x.delta ?? 0), y: moving.y + (y.delta ?? 0) };
  return { dx: x.delta, dy: y.delta, lines: [...x.lines(shifted), ...y.lines(shifted)] };
}

// ------------------------------------------------------------ guides of the page

export const MAX_GUIDES = 200;

export function addGuide(page: Page, axis: Guide['axis'], pos: number): { page: Page; guide: Guide } {
  const guide: Guide = { id: newId('gd'), axis, pos: Math.round(pos * 100) / 100 };
  return { page: { ...page, guides: [...(page.guides ?? []), guide].slice(-MAX_GUIDES) }, guide };
}

export function moveGuide(page: Page, id: string, pos: number): Page {
  return { ...page, guides: (page.guides ?? []).map((g) => (g.id === id ? { ...g, pos: Math.round(pos * 100) / 100 } : g)) };
}

export function removeGuide(page: Page, id: string): Page {
  const rest = (page.guides ?? []).filter((g) => g.id !== id);
  const { guides: _old, ...bare } = page;
  void _old;
  return rest.length ? { ...bare, guides: rest } : bare;
}

// ------------------------------------------------------------ change one shape for another

/** Containers, pools and pictures are not changed for other shapes, nor other shapes for them. */
export const canChangeStencil = (s: Pick<Shape, 'stencil' | 'container' | 'image' | 'locked'>): boolean => !s.locked && !s.container && !s.image && stencilOf(s.stencil).category !== 'extra';

/** Gives shapes another stencil. Their place, size, text, format, data and connections stay. */
export function changeStencil(page: Page, ids: string[], stencil: string): Page {
  const st = stencilOf(stencil);
  if (!hasStencil(stencil) || st.category === 'extra') return page;
  const chosen = new Set(page.shapes.filter((s) => ids.includes(s.id) && canChangeStencil(s) && (s.stencil !== stencil || s.geometry)).map((s) => s.id));
  if (!chosen.size) return page;
  const shapes = page.shapes.map((s) => {
    if (!chosen.has(s.id)) return s;
    const { geometry: _g, ...rest } = s;
    void _g;
    // a shape with nothing to see (a text box) would stay unseen
    const unseen = s.style.fill === 'none' && s.style.stroke === 'none' && stencil !== 'text';
    return { ...rest, stencil, ...(unseen ? { style: { ...defaultStyle(), ...st.style } } : {}) };
  });
  const end = <T extends Connector['from']>(e: T): T => (isGlued(e) && chosen.has(e.shape) && e.port !== 'auto' && e.port >= st.ports.length ? ({ ...e, port: 'auto' } as T) : e);
  return { ...page, shapes, connectors: page.connectors.map((c) => ({ ...c, from: end(c.from), to: end(c.to) })) };
}

// ------------------------------------------------------------ copy the format

/** The format picked from a shape or a connector. */
export interface Look {
  from: 'shape' | 'connector';
  /** Only from a shape. */
  style?: Style;
  line: Pick<Style, 'stroke' | 'strokeWidth' | 'dash'>;
  font: Font;
}

export function lookOf(page: Page, id: string): Look | null {
  const s = page.shapes.find((x) => x.id === id);
  if (s) return { from: 'shape', style: { ...s.style }, line: { stroke: s.style.stroke, strokeWidth: s.style.strokeWidth, dash: s.style.dash }, font: { ...s.font } };
  const c = page.connectors.find((x) => x.id === id);
  return c ? { from: 'connector', line: { stroke: c.stroke, strokeWidth: c.strokeWidth, dash: c.dash }, font: { ...c.font } } : null;
}

export function applyLook(page: Page, shapeIds: string[], connectorIds: string[], look: Look): Page {
  const shapes = shapeIds.filter((id) => !page.shapes.find((s) => s.id === id)?.locked);
  const next = updateShapes(page, shapes, (s) => ({
    // from a line a shape takes the line; where the text sits is its own
    style: look.style ? { ...look.style } : { ...s.style, ...look.line },
    font: look.from === 'shape' ? { ...look.font } : { ...look.font, align: s.font.align, valign: s.font.valign },
  }));
  return updateConnectors(next, connectorIds, (c) => ({
    stroke: look.line.stroke === 'none' ? c.stroke : look.line.stroke,
    strokeWidth: look.line.strokeWidth > 0 ? look.line.strokeWidth : c.strokeWidth,
    dash: look.line.dash,
    font: { ...look.font, align: c.font.align, valign: c.font.valign },
  }));
}

// ------------------------------------------------------------ the clipboard

export interface ClipContent {
  shapes: Shape[];
  connectors: Connector[];
  groups?: Group[];
}

const CLIP_FORMAT = 'nova-diagram-clip';

/** Shapes and connectors as the text they travel in between windows. */
export function writeClip(c: ClipContent): string {
  return JSON.stringify({ format: CLIP_FORMAT, shapes: c.shapes, connectors: c.connectors, ...(c.groups?.length ? { groups: c.groups } : {}) });
}

/** Reads what `writeClip` wrote, checking it as a file is checked; null for anything else. */
export function readClip(text: string): ClipContent | null {
  if (text.length > 50_000_000) return null;
  try {
    const raw = JSON.parse(text);
    if (raw?.format !== CLIP_FORMAT || !Array.isArray(raw.shapes) || !Array.isArray(raw.connectors)) return null;
    // the layers belong to the page they came from
    const strip = (x: Record<string, unknown>) => ({ ...x, layer: undefined });
    const page = parseDiagram(JSON.stringify({ format: 'novadiagram', pages: [{ shapes: raw.shapes.map(strip), connectors: raw.connectors.map(strip), groups: raw.groups }] })).diagram.pages[0]!;
    if (!page.shapes.length && !page.connectors.length) return null;
    return { shapes: page.shapes, connectors: page.connectors, ...(page.groups ? { groups: page.groups } : {}) };
  } catch {
    return null;
  }
}
