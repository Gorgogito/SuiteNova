import { boundsOf, centerOf, rotatePoint, unionRects, type Rect } from './geometry';
import { newId, type Group, type Page, type Shape } from './model';

/*
 * Groups. Shapes with the same `group` id belong together: selecting one selects them all, and they move, scale and turn as a
 * block. A group can hold other groups (`Group.parent`). Groups live in `page.groups`; a group with fewer than two members
 * dissolves by itself.
 */

const groupsOf = (page: Page): Group[] => page.groups ?? [];

/** The outermost group of a shape (itself when it is in a group that is in no other group). */
export function topGroupId(page: Page, shape: Pick<Shape, 'group'>): string | undefined {
  let g = shape.group;
  if (!g) return undefined;
  const gs = groupsOf(page);
  for (let guard = 0; guard < 50; guard++) {
    const parent = gs.find((x) => x.id === g)?.parent;
    if (!parent || !gs.some((x) => x.id === parent)) return g;
    g = parent;
  }
  return g;
}

/** Is `id` the group, or inside it at any depth? */
function inside(page: Page, gid: string | undefined, root: string): boolean {
  const gs = groupsOf(page);
  for (let guard = 0; gid && guard < 50; guard++) {
    if (gid === root) return true;
    gid = gs.find((x) => x.id === gid)?.parent;
  }
  return false;
}

/** All shapes of a group, nested groups included. */
export function groupMembers(page: Page, groupId: string): Shape[] {
  return page.shapes.filter((s) => inside(page, s.group, groupId));
}

/** The ids with every shape of the groups they touch (the selection a click makes). */
export function expandSelection(page: Page, ids: string[]): string[] {
  const out = new Set(ids);
  const tops = new Set<string>();
  for (const id of ids) {
    const s = page.shapes.find((x) => x.id === id);
    const t = s && topGroupId(page, s);
    if (t) tops.add(t);
  }
  for (const t of tops) for (const m of groupMembers(page, t)) out.add(m.id);
  return [...out];
}

/** Groups the selected shapes (and groups they belong to) into a new group. Needs at least two units. */
export function groupShapes(page: Page, ids: string[]): { page: Page; groupId: string } | null {
  const sel = page.shapes.filter((s) => expandSelection(page, ids).includes(s.id) && !s.locked);
  const units = new Set<string>(sel.map((s) => topGroupId(page, s) ?? s.id));
  if (units.size < 2) return null;
  const gid = newId('g');
  const tops = new Set(sel.map((s) => topGroupId(page, s)).filter((x): x is string => !!x));
  const groups: Group[] = groupsOf(page).map((g) => (tops.has(g.id) ? { ...g, parent: gid } : g));
  groups.push({ id: gid });
  const shapes = page.shapes.map((s) => (sel.some((x) => x.id === s.id) && !topGroupId(page, s) ? { ...s, group: gid } : s));
  return { page: { ...page, groups, shapes }, groupId: gid };
}

/** Takes apart the outermost group of each selected shape; groups inside it stay groups. */
export function ungroupShapes(page: Page, ids: string[]): Page {
  const tops = new Set<string>();
  for (const id of ids) {
    const s = page.shapes.find((x) => x.id === id);
    const t = s && topGroupId(page, s);
    if (t) tops.add(t);
  }
  if (!tops.size) return page;
  const gs = groupsOf(page);
  return {
    ...page,
    groups: gs.filter((g) => !tops.has(g.id)).map((g) => (g.parent && tops.has(g.parent) ? { id: g.id } : g)),
    shapes: page.shapes.map((s) => {
      if (!s.group || !tops.has(s.group)) return s;
      const { group: _g, ...rest } = s;
      void _g;
      return rest as Shape;
    }),
  };
}

/** Removes groups that have fewer than two members and groups that no longer exist from shapes. */
export function normalizeGroups(page: Page): Page {
  let groups = groupsOf(page);
  let shapes = page.shapes;
  if (!groups.length && !shapes.some((s) => s.group)) return page;
  for (let round = 0; round < 20; round++) {
    const ids = new Set(groups.map((g) => g.id));
    const units = new Map<string, number>();
    for (const s of shapes) if (s.group && ids.has(s.group)) units.set(s.group, (units.get(s.group) ?? 0) + 1);
    for (const g of groups) if (g.parent && ids.has(g.parent)) units.set(g.parent, (units.get(g.parent) ?? 0) + 1);
    const dead = groups.filter((g) => (units.get(g.id) ?? 0) < 2).map((g) => g.id);
    const stale = shapes.some((s) => s.group && !ids.has(s.group));
    if (!dead.length && !stale) break;
    const parentOf = new Map(groups.map((g) => [g.id, g.parent]));
    const up = (id: string | undefined): string | undefined => {
      let g = id;
      for (let guard = 0; g && guard < 50 && (dead.includes(g) || !ids.has(g)); guard++) g = parentOf.get(g);
      return g && ids.has(g) && !dead.includes(g) ? g : undefined;
    };
    shapes = shapes.map((s) => {
      if (!s.group) return s;
      const g = up(s.group);
      if (g === s.group) return s;
      if (g) return { ...s, group: g };
      const { group: _g, ...rest } = s;
      void _g;
      return rest as Shape;
    });
    groups = groups.filter((g) => !dead.includes(g.id)).map((g) => {
      const p = g.parent ? up(g.parent) : undefined;
      return p === g.parent ? g : p ? { ...g, parent: p } : { id: g.id };
    });
  }
  return { ...page, groups, shapes };
}

export function blockBounds(shapes: Shape[]): Rect | null {
  return unionRects(shapes.map(boundsOf));
}

/** Scales shapes (positions and sizes) from one box to another, as a group is resized. */
export function scaleShapes(page: Page, ids: string[], from: Rect, to: Rect): Page {
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;
  const set = new Set(ids);
  return {
    ...page,
    shapes: page.shapes.map((s) => {
      if (!set.has(s.id) || s.locked) return s;
      const c = centerOf(s);
      const nc = { x: to.x + (c.x - from.x) * sx, y: to.y + (c.y - from.y) * sy };
      const turned = ((Math.round(s.rot / 90) % 2) + 2) % 2 === 1 && Math.abs(s.rot % 90) < 0.01;
      const axis = Math.abs(s.rot % 90) < 0.01;
      // a shape turned by a quarter turn takes the other scale for its width; at other angles one average scale avoids shearing it
      const kw = axis ? (turned ? sy : sx) : (sx + sy) / 2;
      const kh = axis ? (turned ? sx : sy) : (sx + sy) / 2;
      const w = Math.max(8, s.w * kw);
      const h = Math.max(8, s.h * kh);
      return { ...s, x: nc.x - w / 2, y: nc.y - h / 2, w, h };
    }),
  };
}

/** Turns shapes as a block around a point. */
export function rotateBlock(page: Page, ids: string[], center: { x: number; y: number }, deg: number): Page {
  const set = new Set(ids);
  return {
    ...page,
    shapes: page.shapes.map((s) => {
      if (!set.has(s.id) || s.locked) return s;
      const c = rotatePoint(centerOf(s), center, deg);
      return { ...s, x: c.x - s.w / 2, y: c.y - s.h / 2, rot: ((((s.rot + deg) % 360) + 360) % 360) };
    }),
  };
}
