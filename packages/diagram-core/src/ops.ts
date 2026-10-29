import { boundsOf, centerOf, referencePoint, resolveEnd, rotatePoint, snap, type Point, type Rect } from './geometry';
import { defaultFont, defaultStyle, isGlued, newId, newPage, type Connector, type Diagram, type End, type Font, type Page, type Routing, type Shape, type Style } from './model';
import { stencilOf } from './stencils';
import { normalizeGroups } from './groups';
import { containerDefaults } from './container';
import type { Group } from './model';
import type { DataField, ShapeImage, ShapeLink } from './model';

/** Pure edits: each returns a new page (or diagram) and leaves its argument untouched. */

const MIN_SIZE = 8;

export function createShape(stencil: string, x: number, y: number, over: Partial<Shape> = {}): Shape {
  const st = stencilOf(stencil);
  const cd = containerDefaults(stencil);
  return {
    ...(cd ? { container: cd.props } : {}),
    id: newId('s'),
    stencil: st.id,
    x,
    y,
    w: cd?.w ?? st.w,
    h: cd?.h ?? st.h,
    rot: 0,
    text: '',
    style: { ...defaultStyle(), ...st.style },
    font: defaultFont(),
    locked: false,
    ...over,
  };
}

/** Add a shape centred on (cx, cy). */
export function addShape(page: Page, stencil: string, cx: number, cy: number, over: Partial<Shape> = {}): { page: Page; shape: Shape } {
  const base = createShape(stencil, 0, 0, over);
  const shape = { ...base, x: snap(cx - base.w / 2, page.grid), y: snap(cy - base.h / 2, page.grid), ...(page.activeLayer && !over.layer ? { layer: page.activeLayer } : {}) };
  return { page: { ...page, shapes: shape.container ? [shape, ...page.shapes] : [...page.shapes, shape] }, shape };
}

export function updateShapes(page: Page, ids: string[], patch: Partial<Shape> | ((s: Shape) => Partial<Shape>)): Page {
  const set = new Set(ids);
  return { ...page, shapes: page.shapes.map((s) => (set.has(s.id) ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s)) };
}

export const styleShapes = (page: Page, ids: string[], patch: Partial<Style>): Page => updateShapes(page, ids, (s) => ({ style: { ...s.style, ...patch } }));
export const fontShapes = (page: Page, ids: string[], patch: Partial<Font>): Page => updateShapes(page, ids, (s) => ({ font: { ...s.font, ...patch } }));

export function updateConnectors(page: Page, ids: string[], patch: Partial<Connector> | ((c: Connector) => Partial<Connector>)): Page {
  const set = new Set(ids);
  return { ...page, connectors: page.connectors.map((c) => (set.has(c.id) ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } : c)) };
}

export function moveShapes(page: Page, ids: string[], dx: number, dy: number): Page {
  const set = new Set(ids);
  return {
    ...page,
    shapes: page.shapes.map((s) => (set.has(s.id) && !s.locked ? { ...s, x: s.x + dx, y: s.y + dy } : s)),
    // free ends of connectors move with a selection only when the connector itself is selected; see moveConnectorEnds
  };
}

/** Move the free ends of the given connectors (glued ends follow their shapes by themselves). */
export function moveConnectorEnds(page: Page, ids: string[], dx: number, dy: number): Page {
  const set = new Set(ids);
  const mv = (e: End): End => (isGlued(e) ? e : { x: e.x + dx, y: e.y + dy });
  return { ...page, connectors: page.connectors.map((c) => (set.has(c.id) ? { ...c, from: mv(c.from), to: mv(c.to) } : c)) };
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Resize from a handle while the opposite side stays where it is, also when the shape is rotated. */
export function resizeShape(s: Shape, handle: Handle, world: Point, opts: { keepAspect?: boolean; grid?: number; fromCenter?: boolean } = {}): Shape {
  const c = centerOf(s);
  let q = rotatePoint(world, c, -s.rot);
  if (opts.grid && s.rot % 90 === 0) q = { x: snap(q.x, opts.grid), y: snap(q.y, opts.grid) };
  let x0 = s.x;
  let y0 = s.y;
  let x1 = s.x + s.w;
  let y1 = s.y + s.h;
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  if (opts.fromCenter) {
    if (west || east) {
      const half = Math.max(MIN_SIZE / 2, Math.abs(q.x - c.x));
      x0 = c.x - half;
      x1 = c.x + half;
    }
    if (north || south) {
      const half = Math.max(MIN_SIZE / 2, Math.abs(q.y - c.y));
      y0 = c.y - half;
      y1 = c.y + half;
    }
  } else {
    if (west) x0 = Math.min(q.x, x1 - MIN_SIZE);
    if (east) x1 = Math.max(q.x, x0 + MIN_SIZE);
    if (north) y0 = Math.min(q.y, y1 - MIN_SIZE);
    if (south) y1 = Math.max(q.y, y0 + MIN_SIZE);
  }
  let w = x1 - x0;
  let h = y1 - y0;
  if (opts.keepAspect && (west || east) && (north || south)) {
    const k = Math.max(w / s.w, h / s.h);
    const nw = s.w * k;
    const nh = s.h * k;
    if (west) x0 = x1 - nw;
    else x1 = x0 + nw;
    if (north) y0 = y1 - nh;
    else y1 = y0 + nh;
    w = nw;
    h = nh;
  }
  const cl = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const wc = rotatePoint(cl, c, s.rot);
  return { ...s, x: wc.x - w / 2, y: wc.y - h / 2, w, h };
}

export function normalizeAngle(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  return Math.round(a * 100) / 100;
}

/** Remove shapes and connectors. Connectors that were glued to a removed shape stay where they were, now loose. */
export function deleteItems(page: Page, shapeIds: string[], connectorIds: string[]): Page {
  const gone = new Set(shapeIds);
  const dropC = new Set(connectorIds);
  const freeze = (c: Connector, which: 'from' | 'to'): End => {
    const e = c[which];
    if (!isGlued(e) || !gone.has(e.shape)) return e;
    const other = referencePoint(which === 'from' ? c.to : c.from, page);
    return { ...resolveEnd(e, page, other).point };
  };
  return normalizeGroups({
    ...page,
    shapes: page.shapes.filter((s) => !gone.has(s.id)),
    connectors: page.connectors.filter((c) => !dropC.has(c.id)).map((c) => (isGlued(c.from) && gone.has(c.from.shape)) || (isGlued(c.to) && gone.has(c.to.shape)) ? { ...c, from: freeze(c, 'from'), to: freeze(c, 'to') } : c),
  });
}

/** Copies of shapes and connectors with new ids. A connector is copied when every glued end is also being copied. */
export function cloneItems(page: Page, shapeIds: string[], connectorIds: string[], dx = 0, dy = 0): { shapes: Shape[]; connectors: Connector[]; groups: Group[] } {
  const map = new Map<string, string>();
  const gmap = new Map<string, string>();
  const gnew = (id: string | undefined): string | undefined => {
    if (!id) return undefined;
    if (!gmap.has(id)) gmap.set(id, newId('g'));
    return gmap.get(id);
  };
  const shapes = page.shapes
    .filter((s) => shapeIds.includes(s.id))
    .map((s) => {
      const id = newId('s');
      map.set(s.id, id);
      const copy: Shape = { ...s, id, x: s.x + dx, y: s.y + dy, style: { ...s.style }, font: { ...s.font }, ...(s.data ? { data: s.data.map((d) => ({ ...d })) } : {}), ...(s.group ? { group: gnew(s.group) } : {}) };
      return copy;
    });
  const end = (e: End): End | null => {
    if (isGlued(e)) return map.has(e.shape) ? { shape: map.get(e.shape)!, port: e.port } : null;
    return { x: e.x + dx, y: e.y + dy };
  };
  const connectors: Connector[] = [];
  for (const c of page.connectors) {
    if (!connectorIds.includes(c.id)) continue;
    const from = end(c.from);
    const to = end(c.to);
    if (from && to) connectors.push({ ...c, id: newId('c'), from, to, font: { ...c.font } });
  }
  // groups the copies belong to (and the groups those sit in)
  const groups: Group[] = [];
  const gs = page.groups ?? [];
  const pending = [...gmap.keys()];
  for (let i = 0; i < pending.length; i++) {
    const old = gs.find((g) => g.id === pending[i]);
    if (!old) continue;
    const parent = old.parent && gs.some((g) => g.id === old.parent) ? gnew(old.parent) : undefined;
    if (old.parent && !pending.includes(old.parent)) pending.push(old.parent);
    groups.push({ id: gmap.get(old.id)!, ...(parent ? { parent } : {}) });
  }
  return { shapes, connectors, groups };
}

export function addItems(page: Page, shapes: Shape[], connectors: Connector[], groups: Group[] = []): Page {
  return normalizeGroups({ ...page, shapes: [...page.shapes, ...shapes], connectors: [...page.connectors, ...connectors], ...(groups.length ? { groups: [...(page.groups ?? []), ...groups] } : {}) });
}

export function newConnector(from: End, to: End, over: Partial<Connector> = {}): Connector {
  return { id: newId('c'), from, to, routing: 'elbow', stroke: '#2f4f6f', strokeWidth: 1.5, dash: 'solid', startArrow: 'none', endArrow: 'arrow', text: '', font: { ...defaultFont(), size: 12 }, ...over };
}

export function addConnector(page: Page, c: Connector): Page {
  return { ...page, connectors: [...page.connectors, page.activeLayer && !c.layer ? { ...c, layer: page.activeLayer } : c] };
}

export function setRouting(page: Page, ids: string[], routing: Routing): Page {
  return updateConnectors(page, ids, { routing });
}

// ------------------------------------------------------------ flip, link, data, picture

/** Mirror shapes left-right or top-bottom. Several shapes are mirrored as a block: each one in place, and the block's positions reflected. */
export function flipShapes(page: Page, ids: string[], axis: 'h' | 'v'): Page {
  const sel = page.shapes.filter((s) => ids.includes(s.id) && !s.locked);
  if (!sel.length) return page;
  const bs = sel.map(boundsOf);
  const all = { x0: Math.min(...bs.map((b) => b.x)), x1: Math.max(...bs.map((b) => b.x + b.w)), y0: Math.min(...bs.map((b) => b.y)), y1: Math.max(...bs.map((b) => b.y + b.h)) };
  const many = sel.length > 1;
  return updateShapes(page, sel.map((s) => s.id), (s) => {
    const c = centerOf(s);
    const patch: Partial<Shape> = axis === 'h' ? { flipH: !s.flipH } : { flipV: !s.flipV };
    // a rotated shape mirrors its turn as well
    if (s.rot) patch.rot = normalizeAngle(-s.rot);
    if (many) {
      const nc = axis === 'h' ? { x: all.x0 + all.x1 - c.x, y: c.y } : { x: c.x, y: all.y0 + all.y1 - c.y };
      patch.x = nc.x - s.w / 2;
      patch.y = nc.y - s.h / 2;
    }
    return patch;
  });
}

export function setShapeLink(page: Page, ids: string[], link: ShapeLink | null): Page {
  return updateShapes(page, ids, (s) => {
    if (link) return { link };
    const { link: _l, ...rest } = s;
    void _l;
    void rest;
    return { link: undefined };
  });
}

export function setShapeData(page: Page, id: string, data: DataField[]): Page {
  return updateShapes(page, [id], { data: data.length ? data : undefined });
}

/** Adds the same field to several shapes (shapes that already have it keep their value). */
export function addDataField(page: Page, ids: string[], field: DataField): Page {
  return updateShapes(page, ids, (s) => ((s.data ?? []).some((d) => d.name.toLowerCase() === field.name.toLowerCase()) ? {} : { data: [...(s.data ?? []), field] }));
}

export function setShapeImage(page: Page, ids: string[], image: ShapeImage | null): Page {
  return updateShapes(page, ids, { image: image ?? undefined });
}

/** The data of all shapes as a table: one row per shape with text or data, one column per field name. */
export function dataTable(page: Page): { columns: string[]; rows: string[][] } {
  const names: string[] = [];
  for (const s of page.shapes) for (const d of s.data ?? []) if (!names.some((n) => n.toLowerCase() === d.name.toLowerCase())) names.push(d.name);
  const rows: string[][] = [];
  for (const s of page.shapes) {
    if (!s.data?.length) continue;
    rows.push([s.id, s.text.replace(/\s*\n\s*/g, ' '), s.stencil, ...names.map((n) => s.data!.find((d) => d.name.toLowerCase() === n.toLowerCase())?.value ?? '')]);
  }
  return { columns: ['id', 'texto', 'forma', ...names], rows };
}

export function dataToCsv(page: Page): string {
  const t = dataTable(page);
  const q = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [t.columns, ...t.rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}

// ------------------------------------------------------------ order

export function reorder(page: Page, ids: string[], mode: 'front' | 'back' | 'forward' | 'backward'): Page {
  const set = new Set(ids);
  const sel = page.shapes.filter((s) => set.has(s.id));
  const rest = page.shapes.filter((s) => !set.has(s.id));
  if (!sel.length) return page;
  if (mode === 'front') return { ...page, shapes: [...rest, ...sel] };
  if (mode === 'back') return { ...page, shapes: [...sel, ...rest] };
  const arr = [...page.shapes];
  if (mode === 'forward') {
    for (let i = arr.length - 2; i >= 0; i--) if (set.has(arr[i]!.id) && !set.has(arr[i + 1]!.id)) [arr[i], arr[i + 1]] = [arr[i + 1]!, arr[i]!];
  } else {
    for (let i = 1; i < arr.length; i++) if (set.has(arr[i]!.id) && !set.has(arr[i - 1]!.id)) [arr[i], arr[i - 1]] = [arr[i - 1]!, arr[i]!];
  }
  return { ...page, shapes: arr };
}

// ------------------------------------------------------------ arrange

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export function alignShapes(page: Page, ids: string[], mode: AlignMode): Page {
  const sel = page.shapes.filter((s) => ids.includes(s.id) && !s.locked);
  if (sel.length < 2) return page;
  const bs = new Map<string, Rect>(sel.map((s) => [s.id, boundsOf(s)]));
  const all = [...bs.values()];
  const left = Math.min(...all.map((b) => b.x));
  const right = Math.max(...all.map((b) => b.x + b.w));
  const top = Math.min(...all.map((b) => b.y));
  const bottom = Math.max(...all.map((b) => b.y + b.h));
  return updateShapes(page, sel.map((s) => s.id), (s) => {
    const b = bs.get(s.id)!;
    switch (mode) {
      case 'left': return { x: s.x + (left - b.x) };
      case 'right': return { x: s.x + (right - (b.x + b.w)) };
      case 'center': return { x: s.x + ((left + right) / 2 - (b.x + b.w / 2)) };
      case 'top': return { y: s.y + (top - b.y) };
      case 'bottom': return { y: s.y + (bottom - (b.y + b.h)) };
      case 'middle': return { y: s.y + ((top + bottom) / 2 - (b.y + b.h / 2)) };
    }
  });
}

/** Equal gaps between three or more shapes; the outermost ones stay in place. */
export function distributeShapes(page: Page, ids: string[], axis: 'h' | 'v'): Page {
  const sel = page.shapes.filter((s) => ids.includes(s.id) && !s.locked);
  if (sel.length < 3) return page;
  const key = axis === 'h' ? (b: Rect) => b.x : (b: Rect) => b.y;
  const len = axis === 'h' ? (b: Rect) => b.w : (b: Rect) => b.h;
  const items = sel.map((s) => ({ s, b: boundsOf(s) })).sort((a, b) => key(a.b) - key(b.b));
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const span = key(last.b) + len(last.b) - key(first.b);
  const gap = (span - items.reduce((a, i) => a + len(i.b), 0)) / (items.length - 1);
  const delta = new Map<string, number>();
  let pos = key(first.b) + len(first.b) + gap;
  for (let i = 1; i < items.length - 1; i++) {
    delta.set(items[i]!.s.id, pos - key(items[i]!.b));
    pos += len(items[i]!.b) + gap;
  }
  return updateShapes(page, [...delta.keys()], (s) => (axis === 'h' ? { x: s.x + delta.get(s.id)! } : { y: s.y + delta.get(s.id)! }));
}

/** Make the selected shapes the same width and/or height as the first one. */
export function matchSize(page: Page, ids: string[], dim: 'w' | 'h' | 'both'): Page {
  // the first id is the reference, as the primary selection is in Visio
  const ref = page.shapes.find((s) => s.id === ids[0]);
  if (!ref || ids.length < 2) return page;
  return updateShapes(page, ids.filter((id) => id !== ref.id), (s) => (s.locked ? {} : { ...(dim !== 'h' ? { w: ref.w } : {}), ...(dim !== 'w' ? { h: ref.h } : {}) }));
}

export function rotateBy(page: Page, ids: string[], deg: number): Page {
  return updateShapes(page, ids, (s) => (s.locked ? {} : { rot: normalizeAngle(s.rot + deg) }));
}

/** Swap left/right (or top/bottom) positions of connection points by turning the shape 180° — the drawing itself is not mirrored. */
export function snapToGrid(page: Page, ids: string[]): Page {
  return updateShapes(page, ids, (s) => (s.locked ? {} : { x: snap(s.x, page.grid), y: snap(s.y, page.grid) }));
}

// ------------------------------------------------------------ pages and diagram

export function updatePage(d: Diagram, id: string, fn: (p: Page) => Page): Diagram {
  return { ...d, pages: d.pages.map((p) => (p.id === id ? fn(p) : p)) };
}

export function addPage(d: Diagram, afterId?: string): { diagram: Diagram; page: Page } {
  const page = newPage(`Página ${d.pages.length + 1}`);
  const i = afterId ? d.pages.findIndex((p) => p.id === afterId) + 1 : d.pages.length;
  const pages = [...d.pages];
  pages.splice(i, 0, page);
  return { diagram: { ...d, pages }, page };
}

export function duplicatePage(d: Diagram, id: string): { diagram: Diagram; page: Page } | null {
  const src = d.pages.find((p) => p.id === id);
  if (!src) return null;
  const copy = cloneItems(src, src.shapes.map((s) => s.id), src.connectors.map((c) => c.id));
  const page: Page = { ...src, id: newId('pg'), name: `${src.name} (copia)`, shapes: copy.shapes, connectors: copy.connectors, groups: copy.groups };
  const pages = [...d.pages];
  pages.splice(d.pages.indexOf(src) + 1, 0, page);
  return { diagram: { ...d, pages }, page };
}

export function deletePage(d: Diagram, id: string): Diagram {
  if (d.pages.length <= 1) return d;
  return { ...d, pages: d.pages.filter((p) => p.id !== id) };
}

export function movePage(d: Diagram, id: string, dir: -1 | 1): Diagram {
  const i = d.pages.findIndex((p) => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= d.pages.length) return d;
  const pages = [...d.pages];
  [pages[i], pages[j]] = [pages[j]!, pages[i]!];
  return { ...d, pages };
}

/** Shapes and connectors whose box touches `r` (for marquee selection). Connectors are chosen when all their points are inside. */
export function shapesInRect(page: Page, r: Rect): string[] {
  return page.shapes
    .filter((s) => {
      const b = boundsOf(s);
      return b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
    })
    .map((s) => s.id);
}
