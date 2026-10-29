import { boundsOf, centerOf, unionRects, type Rect } from './geometry';
import { newId, type ContainerProps, type Lane, type Page, type Shape } from './model';
import type { PathDef } from './stencils';

/*
 * Containers and swimlanes. A container (or pool) is a shape that holds other shapes: which shapes it holds is decided by where
 * they are (the innermost container around a shape's centre; in a pool, the lane around it) and stored in `parent` / `lane`.
 * Containers follow their members and, by their `autoSize` setting, grow or fit around them; the lanes of a pool take the size
 * their members need, and the lanes below move along. `settleContainers` does all of that and is run after every edit.
 */

export const MIN_BOX = { w: 80, h: 60 };
export const MIN_LANE = 60;

export function containerDefaults(stencil: string): { props: ContainerProps; w: number; h: number } | null {
  if (stencil === 'container') return { props: { kind: 'box', autoSize: 'grow', margin: 16, header: 28 }, w: 320, h: 220 };
  if (stencil === 'pool') {
    const lanes: Lane[] = [1, 2, 3].map((i) => ({ id: newId('ln'), title: `Carril ${i}`, size: 100 }));
    return { props: { kind: 'pool', autoSize: 'grow', margin: 14, header: 30, dir: 'h', lanes }, w: 640, h: 300 };
  }
  if (stencil === 'poolV') {
    const lanes: Lane[] = [1, 2, 3].map((i) => ({ id: newId('ln'), title: `Carril ${i}`, size: 160 }));
    return { props: { kind: 'pool', autoSize: 'grow', margin: 14, header: 30, dir: 'v', lanes }, w: 480, h: 420 };
  }
  return null;
}

export const isContainer = (s: Shape): boolean => !!s.container;
export const isPool = (s: Shape): boolean => s.container?.kind === 'pool' && !!s.container.lanes?.length;

// ------------------------------------------------------------------------------------------------ geometry of lanes

export interface LaneBox {
  lane: Lane;
  index: number;
  /** The whole lane, including its title band. */
  rect: Rect;
  /** Its title band. */
  title: Rect;
}

export function laneBoxes(s: Shape): LaneBox[] {
  const c = s.container;
  if (!c || c.kind !== 'pool' || !c.lanes) return [];
  const horizontal = (c.dir ?? 'h') === 'h';
  let pos = 0;
  return c.lanes.map((lane, index) => {
    const rect: Rect = horizontal ? { x: s.x, y: s.y + pos, w: s.w, h: lane.size } : { x: s.x + pos, y: s.y, w: lane.size, h: s.h };
    pos += lane.size;
    const title: Rect = horizontal ? { x: rect.x, y: rect.y, w: c.header, h: rect.h } : { x: rect.x, y: rect.y, w: rect.w, h: c.header };
    return { lane, index, rect, title };
  });
}

const inRect = (r: Rect, p: { x: number; y: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** Does a click at `p` hit the frame of a container (its border or title band) rather than the empty inside? */
export function hitContainerFrame(s: Shape, p: { x: number; y: number }, margin = 0): boolean {
  const c = s.container;
  if (!c) return false;
  const inside = p.x >= s.x - margin && p.x <= s.x + s.w + margin && p.y >= s.y - margin && p.y <= s.y + s.h + margin;
  if (!inside) return false;
  const edge = 6 + margin;
  const onBorder = p.x - s.x <= edge || s.x + s.w - p.x <= edge || p.y - s.y <= edge || s.y + s.h - p.y <= edge;
  if (onBorder) return true;
  if (c.kind === 'box') return p.y - s.y <= c.header;
  return laneBoxes(s).some((l) => inRect(l.title, p) || Math.abs(p.x - l.rect.x) <= edge || Math.abs(p.y - l.rect.y) <= edge);
}

/** The lane at a point of a pool. */
export function laneAt(s: Shape, p: { x: number; y: number }): LaneBox | null {
  return laneBoxes(s).find((l) => inRect(l.rect, p)) ?? null;
}

// ------------------------------------------------------------------------------------------------ drawing

export interface PoolPart {
  paths: PathDef[];
  titles: { text: string; rect: { x: number; y: number; w: number; h: number }; rotate: boolean }[];
}

/** The drawing of a pool or container, in the shape's own coordinates. */
export function containerParts(s: Shape): PoolPart {
  const c = s.container!;
  const n = (v: number) => String(Math.round(v * 100) / 100);
  const R = (x: number, y: number, w: number, h: number) => `M${n(x)},${n(y)} H${n(x + w)} V${n(y + h)} H${n(x)} Z`;
  if (c.kind === 'box') {
    const k = Math.min(6, s.w / 2, s.h / 2);
    const rr = `M${n(k)},0 H${n(s.w - k)} A${n(k)},${n(k)} 0 0 1 ${n(s.w)},${n(k)} V${n(s.h - k)} A${n(k)},${n(k)} 0 0 1 ${n(s.w - k)},${n(s.h)} H${n(k)} A${n(k)},${n(k)} 0 0 1 0,${n(s.h - k)} V${n(k)} A${n(k)},${n(k)} 0 0 1 ${n(k)},0 Z`;
    return { paths: [{ d: rr, fill: 'main' }, { d: R(0, 0, s.w, Math.min(c.header, s.h)), fill: 'light' }], titles: [] };
  }
  const horizontal = (c.dir ?? 'h') === 'h';
  const paths: PathDef[] = [{ d: R(0, 0, s.w, s.h), fill: 'main' }];
  const titles: PoolPart['titles'] = [];
  let pos = 0;
  (c.lanes ?? []).forEach((lane, i) => {
    if (horizontal) {
      paths.push({ d: R(0, pos, c.header, lane.size), fill: 'light' });
      if (i > 0) paths.push({ d: `M0,${n(pos)} H${n(s.w)}`, fill: 'none' });
      titles.push({ text: lane.title, rect: { x: 0, y: pos, w: c.header, h: lane.size }, rotate: true });
    } else {
      paths.push({ d: R(pos, 0, lane.size, c.header), fill: 'light' });
      if (i > 0) paths.push({ d: `M${n(pos)},0 V${n(s.h)}`, fill: 'none' });
      titles.push({ text: lane.title, rect: { x: pos, y: 0, w: lane.size, h: c.header }, rotate: false });
    }
    pos += lane.size;
  });
  if (horizontal) paths.push({ d: `M${n(c.header)},0 V${n(s.h)}`, fill: 'none' });
  else paths.push({ d: `M0,${n(c.header)} H${n(s.w)}`, fill: 'none' });
  return { paths, titles };
}

// ------------------------------------------------------------------------------------------------ membership

const byId = (page: Page) => new Map(page.shapes.map((s) => [s.id, s]));

/** The containers that hold a shape, innermost first. */
function ancestors(page: Page, s: Shape, map = byId(page)): Shape[] {
  const out: Shape[] = [];
  let cur = s.parent ? map.get(s.parent) : undefined;
  for (let guard = 0; cur && guard < 50; guard++) {
    out.push(cur);
    cur = cur.parent ? map.get(cur.parent) : undefined;
  }
  return out;
}

export const containerDepth = (page: Page, s: Shape, map = byId(page)): number => ancestors(page, s, map).length;

/** Everything inside a container, at any depth. */
export function descendantsOf(page: Page, id: string): Shape[] {
  const out: Shape[] = [];
  const seen = new Set<string>([id]);
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const s of page.shapes) if (s.parent && frontier.includes(s.parent) && !seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
      next.push(s.id);
    }
    frontier = next;
  }
  return out;
}

/** The ids with everything inside the containers among them (what moves when a container moves). */
export function withMembers(page: Page, ids: string[]): string[] {
  const out = new Set(ids);
  for (const id of ids) if (page.shapes.find((s) => s.id === id)?.container) for (const d of descendantsOf(page, id)) out.add(d.id);
  return [...out];
}

/** Sets `parent` and `lane` of every shape from where it is: the smallest container around its centre. */
export function assignMembership(page: Page): Page {
  const containers = page.shapes.filter(isContainer);
  if (!containers.length && !page.shapes.some((s) => s.parent || s.lane)) return page;
  const map = byId(page);
  let changed = false;
  const shapes = page.shapes.map((s) => {
    const c = centerOf(s);
    // a container cannot be inside itself or inside what it holds
    const forbidden = new Set<string>([s.id, ...(s.container ? descendantsOf(page, s.id).map((d) => d.id) : [])]);
    let best: Shape | null = null;
    for (const k of containers) {
      if (forbidden.has(k.id)) continue;
      if (c.x < k.x || c.x > k.x + k.w || c.y < k.y || c.y > k.y + k.h) continue;
      // a container is held by one that is clearly bigger
      if (s.container && !(k.w * k.h > s.w * s.h)) continue;
      if (!best || k.w * k.h < best.w * best.h) best = k;
    }
    const parent = best?.id;
    const lane = best && isPool(best) ? laneAt(best, c)?.lane.id : undefined;
    if (s.parent === parent && s.lane === lane) return s;
    changed = true;
    const { parent: _p, lane: _l, ...rest } = s;
    void _p;
    void _l;
    return { ...rest, ...(parent ? { parent } : {}), ...(lane ? { lane } : {}) } as Shape;
  });
  void map;
  return changed ? { ...page, shapes } : page;
}

// ------------------------------------------------------------------------------------------------ sizes

function shift(page: Page, ids: Set<string>, dx: number, dy: number): Page {
  if (!ids.size || (!dx && !dy)) return page;
  return { ...page, shapes: page.shapes.map((s) => (ids.has(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s)) };
}

/** Gives a pool new lane sizes; the members of each lane move along with their lane, and the pool takes the new total. */
export function setLaneSizes(page: Page, poolId: string, sizes: number[]): Page {
  const pool = page.shapes.find((s) => s.id === poolId);
  const c = pool?.container;
  if (!pool || !c?.lanes || sizes.length !== c.lanes.length) return page;
  const horizontal = (c.dir ?? 'h') === 'h';
  let q = page;
  let oldTop = 0;
  let newTop = 0;
  c.lanes.forEach((lane, i) => {
    const ids = new Set(page.shapes.filter((s) => s.parent === poolId && s.lane === lane.id).flatMap((s) => [s.id, ...descendantsOf(page, s.id).map((d) => d.id)]));
    q = horizontal ? shift(q, ids, 0, newTop - oldTop) : shift(q, ids, newTop - oldTop, 0);
    oldTop += lane.size;
    newTop += sizes[i]!;
  });
  const lanes = c.lanes.map((l, i) => ({ ...l, size: sizes[i]! }));
  const total = sizes.reduce((a, b) => a + b, 0);
  return { ...q, shapes: q.shapes.map((s) => (s.id === poolId ? { ...s, container: { ...c, lanes }, ...(horizontal ? { h: total } : { w: total }) } : s)) };
}

/** Fits one container around its members, by its `autoSize` setting. */
function fitOne(page: Page, id: string): Page {
  const s = page.shapes.find((x) => x.id === id);
  const c = s?.container;
  if (!s || !c || c.autoSize === 'never') return page;
  const members = page.shapes.filter((m) => m.parent === id);
  const fit = c.autoSize === 'fit';
  if (c.kind === 'box') {
    const mb = unionRects(members.map(boundsOf));
    if (!mb) return page;
    const target = { x0: mb.x - c.margin, y0: mb.y - c.margin - c.header, x1: mb.x + mb.w + c.margin, y1: mb.y + mb.h + c.margin };
    let x0 = target.x0;
    let y0 = target.y0;
    let x1 = target.x1;
    let y1 = target.y1;
    if (!fit) {
      x0 = Math.min(x0, s.x);
      y0 = Math.min(y0, s.y);
      x1 = Math.max(x1, s.x + s.w);
      y1 = Math.max(y1, s.y + s.h);
    }
    const w = Math.max(MIN_BOX.w, x1 - x0);
    const h = Math.max(MIN_BOX.h, y1 - y0);
    if (Math.abs(x0 - s.x) < 0.01 && Math.abs(y0 - s.y) < 0.01 && Math.abs(w - s.w) < 0.01 && Math.abs(h - s.h) < 0.01) return page;
    return { ...page, shapes: page.shapes.map((x) => (x.id === id ? { ...x, x: x0, y: y0, w, h } : x)) };
  }
  // pool: each lane takes what its members need; across the lanes the pool grows (or fits) to the farthest member
  const horizontal = (c.dir ?? 'h') === 'h';
  const lanes = c.lanes ?? [];
  let top = 0;
  const sizes = lanes.map((lane) => {
    const mine = members.filter((m) => m.lane === lane.id);
    const start = (horizontal ? s.y : s.x) + top;
    top += lane.size;
    if (!mine.length) return lane.size;
    const b = unionRects(mine.map(boundsOf))!;
    const lo = horizontal ? b.y : b.x;
    const hi = horizontal ? b.y + b.h : b.x + b.w;
    const needed = Math.max(hi - start + c.margin, lo < start ? c.margin + (start - lo) + (hi - lo) : 0);
    return fit ? Math.max(MIN_LANE, needed) : Math.max(lane.size, needed);
  });
  let q = page;
  if (sizes.some((v, i) => Math.abs(v - lanes[i]!.size) > 0.01)) q = setLaneSizes(q, id, sizes);
  const cur = q.shapes.find((x) => x.id === id)!;
  const far = members.length ? Math.max(...q.shapes.filter((m) => m.parent === id).map((m) => (horizontal ? boundsOf(m).x + boundsOf(m).w : boundsOf(m).y + boundsOf(m).h))) : 0;
  const needLen = far - (horizontal ? cur.x : cur.y) + c.margin;
  const have = horizontal ? cur.w : cur.h;
  const len = members.length ? (fit ? Math.max(c.header + 120, needLen) : Math.max(have, needLen)) : have;
  if (Math.abs(len - have) > 0.01) q = { ...q, shapes: q.shapes.map((x) => (x.id === id ? { ...x, ...(horizontal ? { w: len } : { h: len }) } : x)) };
  return q;
}

/** A pool that was resized by hand (its size no longer matches its lanes) gives its lanes the new size, in proportion. */
function reconcilePools(page: Page): Page {
  let q = page;
  for (const s of page.shapes) {
    const c = s.container;
    if (!c || c.kind !== 'pool' || !c.lanes?.length) continue;
    const horizontal = (c.dir ?? 'h') === 'h';
    const have = c.lanes.reduce((a, l) => a + l.size, 0);
    const want = horizontal ? s.h : s.w;
    if (Math.abs(have - want) < 0.5) continue;
    const k = want / have;
    q = setLaneSizes(q, s.id, c.lanes.map((l) => Math.max(MIN_LANE / 2, l.size * k)));
    // the shape keeps the size it was given
    q = { ...q, shapes: q.shapes.map((x) => (x.id === s.id ? { ...x, ...(horizontal ? { h: want } : { w: want }) } : x)) };
  }
  return q;
}

/** Membership first, then every container fitted around its members, the innermost ones first. */
export function settleContainers(page: Page): Page {
  if (!page.shapes.some((s) => s.container || s.parent)) return page;
  let q = assignMembership(reconcilePools(page));
  for (let round = 0; round < 3; round++) {
    const map = byId(q);
    const order = q.shapes.filter(isContainer).sort((a, b) => containerDepth(q, b, map) - containerDepth(q, a, map));
    let next = q;
    for (const k of order) next = fitOne(next, k.id);
    // the pools or boxes that moved may have taken in other shapes, or let some go
    next = assignMembership(next);
    if (next === q) break;
    q = next;
  }
  return q;
}

// ------------------------------------------------------------------------------------------------ lanes

export function addLane(page: Page, poolId: string, at?: number, title?: string): Page {
  const pool = page.shapes.find((s) => s.id === poolId);
  const c = pool?.container;
  if (!pool || !c?.lanes) return page;
  const i = at === undefined ? c.lanes.length : Math.max(0, Math.min(c.lanes.length, at));
  const size = c.lanes[Math.min(i, c.lanes.length - 1)]?.size ?? 100;
  const lane: Lane = { id: newId('ln'), title: title ?? `Carril ${c.lanes.length + 1}`, size };
  const horizontal = (c.dir ?? 'h') === 'h';
  // members of the lanes after the new one move down (or right) to keep their lane
  const after = new Set(page.shapes.filter((s) => s.parent === poolId && s.lane && c.lanes!.findIndex((l) => l.id === s.lane) >= i).flatMap((s) => [s.id, ...descendantsOf(page, s.id).map((d) => d.id)]));
  let q = horizontal ? shift(page, after, 0, size) : shift(page, after, size, 0);
  const lanes = [...c.lanes.slice(0, i), lane, ...c.lanes.slice(i)];
  q = { ...q, shapes: q.shapes.map((s) => (s.id === poolId ? { ...s, container: { ...c, lanes }, ...(horizontal ? { h: s.h + size } : { w: s.w + size }) } : s)) };
  return q;
}

/** Removes a lane; its members go to the neighbouring lane and the pool gets smaller. The last lane stays. */
export function removeLane(page: Page, poolId: string, laneId: string): Page {
  const pool = page.shapes.find((s) => s.id === poolId);
  const c = pool?.container;
  if (!pool || !c?.lanes || c.lanes.length <= 1) return page;
  const i = c.lanes.findIndex((l) => l.id === laneId);
  if (i < 0) return page;
  const gone = c.lanes[i]!;
  const horizontal = (c.dir ?? 'h') === 'h';
  const after = new Set(page.shapes.filter((s) => s.parent === poolId && s.lane && c.lanes!.findIndex((l) => l.id === s.lane) > i).flatMap((s) => [s.id, ...descendantsOf(page, s.id).map((d) => d.id)]));
  let q = horizontal ? shift(page, after, 0, -gone.size) : shift(page, after, -gone.size, 0);
  const lanes = c.lanes.filter((l) => l.id !== laneId);
  const target = (c.lanes[i + 1] ?? c.lanes[i - 1])!.id;
  q = {
    ...q,
    shapes: q.shapes.map((s) => {
      if (s.id === poolId) return { ...s, container: { ...c, lanes }, ...(horizontal ? { h: s.h - gone.size } : { w: s.w - gone.size }) };
      return s.parent === poolId && s.lane === laneId ? { ...s, lane: target } : s;
    }),
  };
  return q;
}

export function renameLane(page: Page, poolId: string, laneId: string, title: string): Page {
  return { ...page, shapes: page.shapes.map((s) => (s.id === poolId && s.container?.lanes ? { ...s, container: { ...s.container, lanes: s.container.lanes.map((l) => (l.id === laneId ? { ...l, title } : l)) } } : s)) };
}

export function resizeLane(page: Page, poolId: string, laneId: string, size: number): Page {
  const c = page.shapes.find((s) => s.id === poolId)?.container;
  if (!c?.lanes) return page;
  return setLaneSizes(page, poolId, c.lanes.map((l) => (l.id === laneId ? Math.max(MIN_LANE, size) : l.size)));
}

export function moveLane(page: Page, poolId: string, laneId: string, dir: -1 | 1): Page {
  const pool = page.shapes.find((s) => s.id === poolId);
  const c = pool?.container;
  if (!pool || !c?.lanes) return page;
  const i = c.lanes.findIndex((l) => l.id === laneId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= c.lanes.length) return page;
  const horizontal = (c.dir ?? 'h') === 'h';
  const a = c.lanes[i]!;
  const b = c.lanes[j]!;
  const lo = Math.min(i, j);
  const hi = Math.max(i, j);
  // members of the two lanes swap places
  const moved = (id: string) => new Set(page.shapes.filter((s) => s.parent === poolId && s.lane === id).flatMap((s) => [s.id, ...descendantsOf(page, s.id).map((d) => d.id)]));
  const first = c.lanes[lo]!;
  const second = c.lanes[hi]!;
  let q = page;
  q = horizontal ? shift(q, moved(first.id), 0, second.size) : shift(q, moved(first.id), second.size, 0);
  q = horizontal ? shift(q, moved(second.id), 0, -first.size) : shift(q, moved(second.id), -first.size, 0);
  const lanes = [...c.lanes];
  lanes[i] = b;
  lanes[j] = a;
  return { ...q, shapes: q.shapes.map((s) => (s.id === poolId ? { ...s, container: { ...c, lanes } } : s)) };
}

export function setContainerProps(page: Page, ids: string[], patch: Partial<Pick<ContainerProps, 'autoSize' | 'margin' | 'header'>>): Page {
  return { ...page, shapes: page.shapes.map((s) => (ids.includes(s.id) && s.container ? { ...s, container: { ...s.container, ...patch } } : s)) };
}

/** A new container around some shapes, sent behind them. */
export function wrapInContainer(page: Page, ids: string[], stencil: 'container' = 'container'): { page: Page; id: string } | null {
  const sel = page.shapes.filter((s) => ids.includes(s.id));
  const b = unionRects(sel.map(boundsOf));
  const d = containerDefaults(stencil);
  if (!b || !d) return null;
  const id = newId('s');
  const box: Shape = {
    id,
    stencil,
    x: b.x - d.props.margin,
    y: b.y - d.props.margin - d.props.header,
    w: b.w + 2 * d.props.margin,
    h: b.h + 2 * d.props.margin + d.props.header,
    rot: 0,
    text: 'Contenedor',
    style: { fill: '#f4f7fb', stroke: '#7a8fa6', strokeWidth: 1.5, dash: 'dash', opacity: 1, shadow: false },
    font: { family: 'Segoe UI', size: 13, color: '#1b1b1b', bold: true, italic: false, underline: false, align: 'left', valign: 'middle' },
    locked: false,
    container: d.props,
  };
  return { page: settleContainers({ ...page, shapes: [box, ...page.shapes] }), id };
}
