import { t } from '@suitenova/core-ui';
import {
  boundsOf, centerOf, connectorRender, slotOffset, hitContainerFrame, laneBoxes, withMembers, expandSelection, rotateBlock, scaleShapes, topGroupId, visibleConnectors, visibleShapes, contentBounds, cornersOf, hitConnector, hitShape, isGlued, newConnector, normalizeAngle, portsOf, resizeShape, resolveEnd, referencePoint, rotatePoint, shapeRender, shapesInRect, snap, unionRects, updateConnectors, updateShapes,
  type Connector, type End, type Handle, type Page, type Point, type Shape, type TextRun,
} from '@suitenova/diagram-core';
import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DiagramCtl } from './ctl';

const MARGIN = 160;
const HANDLES: [Handle, number, number][] = [
  ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5], ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5],
];
const CURSOR: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

type Gesture =
  | { k: 'move'; start: Point; ids: string[]; conns: string[]; primary: Shape | null; moved: boolean; sub: string | null }
  | { k: 'lanegrip'; pool: string; lane: string }
  | { k: 'block'; mode: 'resize' | 'rotate'; handle?: Handle; ids: string[]; box: { x: number; y: number; w: number; h: number }; a0: number }
  | { k: 'resize'; id: string; handle: Handle }
  | { k: 'rotate'; id: string }
  | { k: 'marquee'; start: Point; additive: boolean; base: { s: string[]; c: string[] } }
  | { k: 'connect'; from: End; start: Point; sourceShape: string | null }
  | { k: 'endpoint'; id: string; which: 'from' | 'to' };

const TextView = ({ run }: { run: TextRun }) => (
  <text
    fontFamily={`${run.font.family}, sans-serif`}
    fontSize={run.font.size}
    fill={run.font.color}
    textAnchor={run.anchor}
    fontWeight={run.font.bold ? 700 : undefined}
    fontStyle={run.font.italic ? 'italic' : undefined}
    textDecoration={run.font.underline ? 'underline' : undefined}
    transform={run.rotate ? `rotate(${run.rotate.deg} ${run.rotate.cx} ${run.rotate.cy})` : undefined}
    style={{ userSelect: 'none' }}
  >
    {run.lines.map((l, i) => (
      <tspan key={i} x={l.x} y={l.y}>
        {l.text || ' '}
      </tspan>
    ))}
  </text>
);

const ShapeView = memo(function ShapeView({ shape }: { shape: Shape }) {
  const r = shapeRender(shape);
  return (
    <g data-shape-id={shape.id} data-stencil={shape.stencil} transform={r.transform} opacity={r.opacity < 1 ? r.opacity : undefined} filter={r.shadow ? 'url(#dg-shadow)' : undefined}>
      <g transform={r.flip || undefined}>
        {r.image && <image href={r.image.href} x={0} y={0} width={r.image.w} height={r.image.h} preserveAspectRatio={r.image.par} pointerEvents="none" />}
        {r.paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={p.dasharray} strokeLinejoin="round" />
        ))}
      </g>
      {r.texts.map((tx, i) => (
        <TextView key={i} run={tx} />
      ))}
      {r.caption && <TextView run={r.caption} />}
      {shape.link && (
        <g className="dg-linkbadge" transform={`translate(${shape.w - 14} -4)`} pointerEvents="none">
          <circle cx="7" cy="7" r="7" fill="#0f6cbd" />
          <path d="M4.5 7h5M6 5H5a2 2 0 0 0 0 4h1M8 5h1a2 2 0 0 1 0 4H8" stroke="#fff" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        </g>
      )}
    </g>
  );
});

const ConnectorView = memo(
  function ConnectorView({ c, page }: { c: Connector; page: Page; a?: Shape; b?: Shape; sf?: number; st?: number }) {
    const r = connectorRender(c, page);
    return (
      <g data-connector-id={c.id}>
        <path d={r.route.d} fill="none" stroke={r.stroke} strokeWidth={r.strokeWidth} strokeDasharray={r.dasharray} strokeLinejoin="round" />
        {r.arrows.map((a, i) => (
          <path key={i} d={a.d} fill={a.fill ? r.stroke : page.background} stroke={r.stroke} strokeWidth={r.strokeWidth} strokeLinejoin="round" />
        ))}
        {r.label && (
          <>
            <rect x={r.label.box.x} y={r.label.box.y} width={r.label.box.w} height={r.label.box.h} fill={page.background} />
            <TextView run={r.label.run} />
          </>
        )}
      </g>
    );
  },
  // the route also depends on the other connectors that end at the same connection points (their spacing)
  (p, n) => p.c === n.c && p.a === n.a && p.b === n.b && p.sf === n.sf && p.st === n.st && p.page.background === n.page.background,
);

export function Stage({ ctl }: { ctl: DiagramCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const scroller = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const g = useRef<Gesture | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [rubber, setRubber] = useState<{ a: Point; b: Point; target: { shape: string; port: number | 'auto' } | null } | null>(null);
  const [draft, setDraft] = useState('');

  const page = ctl.page;
  const scale = ctl.zoom / 100;
  const content = contentBounds(page);
  const ext = unionRects([{ x: 0, y: 0, w: page.width, h: page.height }, ...(content ? [content] : [])])!;
  const ox = Math.min(0, ext.x) - MARGIN;
  const oy = Math.min(0, ext.y) - MARGIN;
  const ew = Math.max(page.width, ext.x + ext.w) - ox + MARGIN;
  const eh = Math.max(page.height, ext.y + ext.h) - oy + MARGIN;

  const toPage = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ox + (e.clientX - r.left) / scale, y: oy + (e.clientY - r.top) / scale };
  };

  // ---- hit testing
  /** The shape under a point. Shapes of hidden layers are never found; those of locked layers only when `any` (to glue connectors to them). */
  const shapeAt = (p: Point, margin = 0, any = false): Shape | null => {
    for (let i = page.shapes.length - 1; i >= 0; i--) {
      const sh = page.shapes[i]!;
      if (!(any ? isVisibleItem(sh) : ctl.canSelect(sh))) continue;
      if (sh.container ? hitContainerFrame(sh, p, margin) : hitShape(sh, p, margin)) return sh;
    }
    return null;
  };
  const isVisibleItem = (it: { layer?: string }) => visibleShapes({ ...page, shapes: [it as Shape] }).length === 1;
  const connectorAt = (p: Point): Connector | null => {
    for (let i = page.connectors.length - 1; i >= 0; i--) if (ctl.canSelect(page.connectors[i]!) && hitConnector(page.connectors[i]!, page, p, 6 / scale)) return page.connectors[i]!;
    return null;
  };
  /** The glue target under the pointer: a port when close to one, else "auto" on the shape under it. */
  const targetAt = (p: Point, exclude?: string): { shape: string; port: number | 'auto' } | null => {
    const s = shapeAt(p, 6 / scale, true);
    if (!s || s.id === exclude) return null;
    let best: { i: number; d: number } | null = null;
    for (const port of portsOf(s)) {
      const d = Math.hypot(port.point.x - p.x, port.point.y - p.y);
      if (d <= 14 / scale && (!best || d < best.d)) best = { i: port.index, d };
    }
    return { shape: s.id, port: best ? best.i : 'auto' };
  };
  const gridStep = (e: { altKey: boolean }) => (ctl.snapToGrid && !e.altKey ? page.grid : 0);

  // ---- pointer handling
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || ctl.editing) return;
    scroller.current?.focus({ preventScroll: true });
    const p = toPage(e);
    const el = e.target as Element;
    svgRef.current!.setPointerCapture(e.pointerId);

    const portShape = el.getAttribute('data-port-shape');
    if (portShape) {
      const idx = Number(el.getAttribute('data-port-index'));
      const s = page.shapes.find((x) => x.id === portShape)!;
      g.current = { k: 'connect', from: { shape: portShape, port: idx }, start: portsOf(s)[idx]!.point, sourceShape: portShape };
      setRubber({ a: portsOf(s)[idx]!.point, b: p, target: null });
      return;
    }
    const gripLane = el.getAttribute('data-lane-grip');
    if (gripLane) {
      g.current = { k: 'lanegrip', pool: el.getAttribute('data-lane-pool')!, lane: gripLane };
      return;
    }
    const act = el.closest('[data-lane-act]');
    if (act) {
      ctl.activeLane = { pool: act.getAttribute('data-lane-pool')!, lane: act.getAttribute('data-lane')! };
      if (act.getAttribute('data-lane-act') === 'add') ctl.addLaneAfter();
      else ctl.removeActiveLane();
      return;
    }
    const bh = el.getAttribute('data-bhandle') as Handle | null;
    if (bh || el.getAttribute('data-brotate')) {
      const sel = ctl.selectedShapes();
      const box = unionRects(sel.map(boundsOf))!;
      const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      g.current = { k: 'block', mode: bh ? 'resize' : 'rotate', handle: bh ?? undefined, ids: sel.map((x) => x.id), box, a0: Math.atan2(p.y - c.y, p.x - c.x) };
      return;
    }
    const handle = el.getAttribute('data-handle') as Handle | null;
    if (handle) {
      g.current = { k: 'resize', id: el.getAttribute('data-handle-for')!, handle };
      return;
    }
    if (el.getAttribute('data-rotate')) {
      g.current = { k: 'rotate', id: el.getAttribute('data-rotate')! };
      return;
    }
    const endpoint = el.getAttribute('data-endpoint') as 'from' | 'to' | null;
    if (endpoint) {
      g.current = { k: 'endpoint', id: el.getAttribute('data-endpoint-for')!, which: endpoint };
      return;
    }

    const additive = (e.shiftKey || e.ctrlKey || e.metaKey) && !(shapeAt(p)?.link && (e.ctrlKey || e.metaKey));
    if (ctl.tool === 'connector') {
      const s = shapeAt(p, 0, true);
      const t0 = s ? targetAt(p) : null;
      const from: End = t0 ? { shape: t0.shape, port: t0.port } : { x: snap(p.x, gridStep(e)), y: snap(p.y, gridStep(e)) };
      const startPt = s && t0 ? resolveEnd(from, page, p).point : (from as Point);
      g.current = { k: 'connect', from, start: startPt, sourceShape: s?.id ?? null };
      setRubber({ a: startPt, b: p, target: null });
      return;
    }

    const c = connectorAt(p);
    const s = shapeAt(p);
    // connectors lie above shapes, so they win where both are under the pointer
    if (c) {
      if (additive) ctl.toggle('connector', c.id);
      else if (!ctl.selConnectors.includes(c.id) || ctl.selShapes.length) ctl.setSelection([], [c.id]);
      g.current = { k: 'move', start: p, ids: [], conns: [c.id], primary: null, moved: false, sub: null };
      return;
    }
    if (s && s.link && (e.ctrlKey || e.metaKey)) {
      ctl.openLinkHandler?.(s);
      return;
    }
    if (s?.container?.kind === 'pool') {
      const lb = laneBoxes(s).find((l) => p.x >= l.rect.x && p.x <= l.rect.x + l.rect.w && p.y >= l.rect.y && p.y <= l.rect.y + l.rect.h);
      if (lb) ctl.activeLane = { pool: s.id, lane: lb.lane.id };
    }
    if (s) {
      const members = topGroupId(page, s) ? expandSelection(page, [s.id]).filter((id) => ctl.canSelect(page.shapes.find((x) => x.id === id)!)) : [s.id];
      const wholeSelected = members.every((id) => ctl.selShapes.includes(id));
      let sub: string | null = null;
      if (additive) {
        // Shift/Ctrl adds or removes the whole group
        const next = wholeSelected ? ctl.selShapes.filter((id) => !members.includes(id)) : [...new Set([...ctl.selShapes, ...members])];
        ctl.setSelection(next, ctl.selConnectors);
      } else if (!wholeSelected) ctl.setSelection(members, []);
      else if (members.length > 1 && ctl.selShapes.length === members.length) sub = s.id;
      const ids = withMembers(page, ctl.selShapes.includes(s.id) ? ctl.selShapes : [s.id]);
      g.current = { k: 'move', start: p, ids, conns: ctl.selConnectors, primary: s, moved: false, sub };
      return;
    }
    if (!additive) ctl.clearSelection();
    g.current = { k: 'marquee', start: p, additive, base: { s: ctl.selShapes, c: ctl.selConnectors } };
  };

  /** A group is picked by a marquee only when all of it is inside. */
  const wholeGroupsOnly = (ids: string[]): string[] => ids.filter((id) => {
    const sh = page.shapes.find((x) => x.id === id)!;
    const t = topGroupId(page, sh);
    return !t || expandSelection(page, [id]).every((m) => ids.includes(m));
  });

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toPage(e);
    const cur = g.current;
    if (!cur) {
      const s = shapeAt(p);
      const id = s ? s.id : null;
      if (id !== hover) setHover(id);
      return;
    }
    const base = ctl.basePage;
    const step = gridStep(e);
    if (cur.k === 'move') {
      const dx0 = p.x - cur.start.x;
      const dy0 = p.y - cur.start.y;
      if (!cur.moved && Math.hypot(dx0, dy0) * scale < 4) return;
      cur.moved = true;
      let dx = dx0;
      let dy = dy0;
      if (step && cur.primary) {
        dx = snap(cur.primary.x + dx0, step) - cur.primary.x;
        dy = snap(cur.primary.y + dy0, step) - cur.primary.y;
      }
      ctl.previewWith((pg) => {
        const moved = pg.shapes.map((s) => (cur.ids.includes(s.id) && !ctl.isFrozen(s) ? { ...s, x: s.x + dx, y: s.y + dy } : s));
        let q: Page = { ...pg, shapes: moved };
        const free = cur.conns;
        if (free.length) q = updateConnectors(q, free, (c) => ({ from: isGlued(c.from) ? c.from : { x: c.from.x + dx, y: c.from.y + dy }, to: isGlued(c.to) ? c.to : { x: c.to.x + dx, y: c.to.y + dy } }));
        return q;
      });
    } else if (cur.k === 'resize') {
      const s = base.shapes.find((x) => x.id === cur.id);
      if (!s || ctl.isFrozen(s)) return;
      const corner = cur.handle.length === 2;
      const next = resizeShape(s, cur.handle, p, { keepAspect: e.shiftKey && corner, grid: step, fromCenter: e.altKey });
      ctl.previewWith((pg) => ({ ...pg, shapes: pg.shapes.map((x) => (x.id === s.id ? next : x)) }));
    } else if (cur.k === 'rotate') {
      const s = base.shapes.find((x) => x.id === cur.id);
      if (!s || ctl.isFrozen(s)) return;
      const c = centerOf(s);
      let deg = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
      deg = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
      ctl.previewWith((pg) => updateShapes(pg, [s.id], { rot: normalizeAngle(deg) }));
    } else if (cur.k === 'lanegrip') {
      const pool = base.shapes.find((x) => x.id === cur.pool);
      const lb = pool && laneBoxes(pool).find((l) => l.lane.id === cur.lane);
      if (!pool || !lb) return;
      const horizontal = (pool.container!.dir ?? 'h') === 'h';
      ctl.setLaneSize(cur.pool, cur.lane, Math.max(60, snap(horizontal ? p.y - lb.rect.y : p.x - lb.rect.x, step)), true);
    } else if (cur.k === 'block') {
      const b0 = cur.box;
      if (cur.mode === 'rotate') {
        const c = { x: b0.x + b0.w / 2, y: b0.y + b0.h / 2 };
        let deg = ((Math.atan2(p.y - c.y, p.x - c.x) - cur.a0) * 180) / Math.PI;
        deg = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
        ctl.previewWith(() => rotateBlock(base, cur.ids, c, deg));
      } else {
        const h = cur.handle!;
        let x0 = b0.x;
        let y0 = b0.y;
        let x1 = b0.x + b0.w;
        let y1 = b0.y + b0.h;
        const q = { x: snap(p.x, step), y: snap(p.y, step) };
        if (h.includes('w')) x0 = Math.min(q.x, x1 - 8);
        if (h.includes('e')) x1 = Math.max(q.x, x0 + 8);
        if (h.includes('n')) y0 = Math.min(q.y, y1 - 8);
        if (h.includes('s')) y1 = Math.max(q.y, y0 + 8);
        if (e.shiftKey && h.length === 2) {
          const k = Math.max((x1 - x0) / b0.w, (y1 - y0) / b0.h);
          if (h.includes('w')) x0 = x1 - b0.w * k;
          else x1 = x0 + b0.w * k;
          if (h.includes('n')) y0 = y1 - b0.h * k;
          else y1 = y0 + b0.h * k;
        }
        ctl.previewWith(() => scaleShapes(base, cur.ids, b0, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }));
      }
    } else if (cur.k === 'marquee') {
      setMarquee({ x: Math.min(cur.start.x, p.x), y: Math.min(cur.start.y, p.y), w: Math.abs(p.x - cur.start.x), h: Math.abs(p.y - cur.start.y) });
    } else if (cur.k === 'connect') {
      const tg = targetAt(p, cur.sourceShape ?? undefined);
      const b = tg ? resolveEnd({ shape: tg.shape, port: tg.port }, page, cur.start).point : { x: snap(p.x, step), y: snap(p.y, step) };
      setRubber({ a: cur.start, b, target: tg });
    } else if (cur.k === 'endpoint') {
      const c = base.connectors.find((x) => x.id === cur.id);
      if (!c) return;
      const other = cur.which === 'from' ? c.to : c.from;
      const tg = targetAt(p, isGlued(other) ? undefined : undefined);
      const end: End = tg ? { shape: tg.shape, port: tg.port } : { x: snap(p.x, step), y: snap(p.y, step) };
      ctl.previewWith((pg) => updateConnectors(pg, [c.id], { [cur.which]: end }));
      setRubber(tg ? { a: p, b: p, target: tg } : null);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const cur = g.current;
    g.current = null;
    if (!cur) return;
    const p = toPage(e);
    const step = gridStep(e);
    if (cur.k === 'move') {
      ctl.endGesture(cur.moved);
      // a click on a member of an already selected group picks just that member
      if (!cur.moved && cur.sub) ctl.setSelection([cur.sub], []);
    } else if (cur.k === 'block' || cur.k === 'lanegrip') ctl.endGesture(true);
    else if (cur.k === 'resize' || cur.k === 'rotate' || cur.k === 'endpoint') {
      ctl.endGesture(true);
      setRubber(null);
    } else if (cur.k === 'marquee') {
      const r = marquee;
      setMarquee(null);
      if (r && (r.w > 3 || r.h > 3)) {
        const shapes = wholeGroupsOnly(shapesInRect(page, r).filter((id) => ctl.canSelect(page.shapes.find((x) => x.id === id)!)));
        const conns = page.connectors.filter((c) => ctl.canSelect(c)).filter((c) => {
          const pts = connectorRender(c, page).route.points;
          return pts.every((q) => q.x >= r.x && q.y >= r.y && q.x <= r.x + r.w && q.y <= r.y + r.h);
        }).map((c) => c.id);
        ctl.setSelection(cur.additive ? [...new Set([...cur.base.s, ...shapes])] : shapes, cur.additive ? [...new Set([...cur.base.c, ...conns])] : conns);
      }
    } else if (cur.k === 'connect') {
      setRubber(null);
      const tg = targetAt(p, cur.sourceShape ?? undefined);
      const to: End = tg ? { shape: tg.shape, port: tg.port } : { x: snap(p.x, step), y: snap(p.y, step) };
      const far = Math.hypot(p.x - cur.start.x, p.y - cur.start.y) * scale > 8;
      if (far) ctl.addConnectorBetween(cur.from, to);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toPage(e);
    const c = connectorAt(p);
    const hitShapeAt = c ? null : shapeAt(p);
    if (hitShapeAt?.container?.kind === 'pool') {
      const lb = laneBoxes(hitShapeAt).find((l) => p.x >= l.title.x && p.x <= l.title.x + l.title.w && p.y >= l.title.y && p.y <= l.title.y + l.title.h);
      if (lb) {
        ctl.setSelection([hitShapeAt.id], []);
        ctl.startLaneEdit(hitShapeAt.id, lb.lane.id);
        return;
      }
    }
    const id = c ? c.id : hitShapeAt?.id;
    if (!id) return;
    if (c) ctl.setSelection([], [c.id]);
    else ctl.setSelection([id], []);
    ctl.startEditing(id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (ctl.editing) return;
    const stepBy = e.shiftKey ? 1 : page.grid || 8;
    switch (e.key) {
      case 'Delete':
      case 'Backspace': ctl.deleteSelection(); break;
      case 'ArrowLeft': ctl.nudge(-stepBy, 0); break;
      case 'ArrowRight': ctl.nudge(stepBy, 0); break;
      case 'ArrowUp': ctl.nudge(0, -stepBy); break;
      case 'ArrowDown': ctl.nudge(0, stepBy); break;
      case 'Enter':
      case 'F2': {
        const id = ctl.selShapes.length === 1 && !ctl.selConnectors.length ? ctl.selShapes[0] : ctl.selConnectors.length === 1 && !ctl.selShapes.length ? ctl.selConnectors[0] : null;
        if (id) ctl.startEditing(id);
        break;
      }
      case 'Escape':
        if (g.current) {
          g.current = null;
          ctl.endGesture(false);
          setRubber(null);
          setMarquee(null);
        } else if (ctl.tool !== 'select') ctl.setTool('select');
        else ctl.clearSelection();
        break;
      default: return;
    }
    e.preventDefault();
  };

  // start each page with its top-left corner in view
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, (-ox - 24) * scale);
    el.scrollTop = Math.max(0, (-oy - 24) * scale);
  }, [ctl.pageId]); // eslint-disable-line react-hooks/exhaustive-deps

  // zoom with Ctrl + wheel
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      ctl.setZoom(ctl.zoom + (e.deltaY < 0 ? 10 : -10));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ctl]);

  // text editor
  const editingShape = ctl.editing ? page.shapes.find((s) => s.id === ctl.editing) : undefined;
  const editingConn = ctl.editing ? page.connectors.find((c) => c.id === ctl.editing) : undefined;
  useLayoutEffect(() => {
    if (editingShape) setDraft(editingShape.text);
    else if (editingConn) setDraft(editingConn.text);
  }, [ctl.editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const finishEdit = (accept: boolean) => {
    const id = ctl.editing;
    if (!id) return;
    ctl.editing = null;
    if (accept) ctl.setText(id, draft);
    ctl.touch();
    scroller.current?.focus({ preventScroll: true });
  };

  // ---- drawing helpers
  const single = ctl.selShapes.length === 1 && !ctl.selConnectors.length ? page.shapes.find((s) => s.id === ctl.selShapes[0]) : undefined;
  const showPorts = (id: string | null) => (id ? page.shapes.find((s) => s.id === id) : undefined);
  const portShape = showPorts(rubber?.target?.shape ?? (ctl.tool === 'connector' ? hover : null) ?? hover ?? (single ? single.id : null));
  const handleSize = 8 / scale;
  const gridOn = ctl.showGrid && page.grid > 0 && page.grid * scale >= 4;
  const shapeById = new Map(page.shapes.map((s) => [s.id, s]));

  return (
    <div
      className={`dg-scroller dg-tool-${ctl.tool}`}
      ref={scroller}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-nova-stencil') || e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          ctl.onImageFiles?.([...e.dataTransfer.files], toPage(e));
          return;
        }
        const id = e.dataTransfer.getData('application/x-nova-stencil');
        if (!id) return;
        e.preventDefault();
        const p = toPage(e);
        ctl.addStencil(id, p);
      }}
    >
      <div className="dg-canvas" style={{ width: ew * scale, height: eh * scale }}>
        <svg
          ref={svgRef}
          className="dg-svg"
          width={ew * scale}
          height={eh * scale}
          viewBox={`${ox} ${oy} ${ew} ${eh}`}
          role="img"
          aria-label={t('Lienzo del diagrama')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={onDoubleClick}
          onPointerLeave={() => !g.current && setHover(null)}
        >
          <defs>
            <filter id="dg-shadow" x="-20%" y="-20%" width="150%" height="150%">
              <feDropShadow dx="3" dy="3" stdDeviation="2" floodOpacity="0.35" />
            </filter>
            <pattern id="dg-grid" width={page.grid} height={page.grid} patternUnits="userSpaceOnUse">
              <circle cx="0.5" cy="0.5" r="0.7" className="dg-gridcircle" />
            </pattern>
          </defs>
          <rect className="dg-pageshadow" x={3} y={3} width={page.width} height={page.height} />
          <rect className="dg-page" x={0} y={0} width={page.width} height={page.height} fill={page.background} data-testid="page" />
          {gridOn && <rect x={0} y={0} width={page.width} height={page.height} fill="url(#dg-grid)" pointerEvents="none" />}
          <g className="dg-shapes">
            {visibleShapes(page).map((s) => (
              <ShapeView key={s.id} shape={s} />
            ))}
          </g>
          <g className="dg-connectors">
            {visibleConnectors(page).map((c) => (
              <ConnectorView key={c.id} c={c} page={page} sf={slotOffset(c, 'from', page)} st={slotOffset(c, 'to', page)} a={isGlued(c.from) ? shapeById.get(c.from.shape) : undefined} b={isGlued(c.to) ? shapeById.get(c.to.shape) : undefined} />
            ))}
          </g>

          {/* selection */}
          <g className="dg-selection">
            {ctl.selectedShapes().map((s) => (
              <polygon key={s.id} className="dg-outline" points={cornersOf(s).map((q) => `${q.x},${q.y}`).join(' ')} data-selected={s.id} />
            ))}
            {ctl.selectedConnectors().map((c) => {
              const route = connectorRender(c, page).route;
              return (
                <g key={c.id} data-selected-connector={c.id}>
                  <path d={route.d} className="dg-connsel" fill="none" />
                  {(['from', 'to'] as const).map((w) => {
                    const pt = w === 'from' ? route.points[0]! : route.points[route.points.length - 1]!;
                    return <circle key={w} className="dg-endpoint" cx={pt.x} cy={pt.y} r={5 / scale} data-endpoint={w} data-endpoint-for={c.id} />;
                  })}
                </g>
              );
            })}
            {single && !single.locked && (
              <g data-testid="handles">
                {HANDLES.map(([h, fx, fy]) => {
                  const q = rotatePoint({ x: single.x + fx * single.w, y: single.y + fy * single.h }, centerOf(single), single.rot);
                  return <rect key={h} className="dg-handle" x={q.x - handleSize / 2} y={q.y - handleSize / 2} width={handleSize} height={handleSize} data-handle={h} data-handle-for={single.id} style={{ cursor: CURSOR[h] }} />;
                })}
                {(() => {
                  const top = rotatePoint({ x: single.x + single.w / 2, y: single.y }, centerOf(single), single.rot);
                  const up = rotatePoint({ x: single.x + single.w / 2, y: single.y - 26 / scale }, centerOf(single), single.rot);
                  return (
                    <>
                      <line className="dg-rotline" x1={top.x} y1={top.y} x2={up.x} y2={up.y} />
                      <circle className="dg-rotate" cx={up.x} cy={up.y} r={5 / scale} data-rotate={single.id} />
                    </>
                  );
                })()}
              </g>
            )}
            {single?.container?.kind === 'pool' && !ctl.editingLane && (() => {
              const horizontal = (single.container!.dir ?? 'h') === 'h';
              const r = 8 / scale;
              return (
                <g data-testid="lanes-ui">
                  {laneBoxes(single).map((lb, i, all) => (
                    <g key={lb.lane.id}>
                      {i < all.length - 1 && (
                        <rect className="dg-lanegrip" data-lane-grip={lb.lane.id} data-lane-pool={single.id} x={horizontal ? single.x : lb.rect.x + lb.rect.w - 3 / scale} y={horizontal ? lb.rect.y + lb.rect.h - 3 / scale : single.y} width={horizontal ? single.w : 6 / scale} height={horizontal ? 6 / scale : single.h} style={{ cursor: horizontal ? 'ns-resize' : 'ew-resize' }} />
                      )}
                      {([['add', '+', 0], ['del', '×', 1]] as const).map(([kind, glyph, k]) => {
                        const cx = horizontal ? lb.title.x + lb.title.w / 2 : lb.title.x + 14 / scale + k * 20 / scale;
                        const cy = horizontal ? lb.title.y + 14 / scale + k * 20 / scale : lb.title.y + lb.title.h / 2;
                        if (kind === 'del' && all.length <= 1) return null;
                        return (
                          <g key={kind} className="dg-laneact" data-lane-act={kind} data-lane-pool={single.id} data-lane={lb.lane.id} role="button" aria-label={kind === 'add' ? t('Agregar un carril después de {name}', { name: lb.lane.title }) : t('Quitar el carril {name}', { name: lb.lane.title })}>
                            <circle cx={cx} cy={cy} r={r} />
                            <text x={cx} y={cy + 4 / scale} textAnchor="middle" fontSize={12 / scale}>{glyph}</text>
                          </g>
                        );
                      })}
                    </g>
                  ))}
                </g>
              );
            })()}
            {single?.locked && <text className="dg-lock" x={single.x + single.w + 4} y={single.y + 12}>🔒</text>}
            {ctl.selShapes.length > 1 && (() => {
              const sel = ctl.selectedShapes();
              const b = unionRects(sel.map(boundsOf))!;
              const frozen = sel.some((x) => ctl.isFrozen(x));
              const groupSel = sel.every((x) => topGroupId(page, x) === topGroupId(page, sel[0]!)) && !!topGroupId(page, sel[0]!);
              return (
                <g data-testid="block" data-group-selected={groupSel ? '1' : undefined}>
                  <rect className={`dg-multibox${groupSel ? ' is-group' : ''}`} x={b.x} y={b.y} width={b.w} height={b.h} />
                  {!frozen && (
                    <>
                      {HANDLES.map(([h, fx, fy]) => (
                        <rect key={h} className="dg-handle" x={b.x + fx * b.w - handleSize / 2} y={b.y + fy * b.h - handleSize / 2} width={handleSize} height={handleSize} data-bhandle={h} style={{ cursor: CURSOR[h] }} />
                      ))}
                      <line className="dg-rotline" x1={b.x + b.w / 2} y1={b.y} x2={b.x + b.w / 2} y2={b.y - 26 / scale} />
                      <circle className="dg-rotate" cx={b.x + b.w / 2} cy={b.y - 26 / scale} r={5 / scale} data-brotate="1" />
                    </>
                  )}
                </g>
              );
            })()}
          </g>

          {/* connection points of the shape under the pointer */}
          {portShape && !ctl.editing && (
            <g className="dg-ports">
              {portsOf(portShape).map((p) => (
                <circle key={p.index} className={`dg-port${rubber?.target?.shape === portShape.id && rubber.target.port === p.index ? ' is-target' : ''}`} cx={p.point.x} cy={p.point.y} r={5 / scale} data-port-shape={portShape.id} data-port-index={p.index} />
              ))}
            </g>
          )}
          {rubber && <line className="dg-rubber" x1={rubber.a.x} y1={rubber.a.y} x2={rubber.b.x} y2={rubber.b.y} />}
          {rubber?.target && (() => {
            const s = page.shapes.find((x) => x.id === rubber.target!.shape);
            return s ? <polygon className="dg-target" points={cornersOf(s).map((q) => `${q.x},${q.y}`).join(' ')} /> : null;
          })()}
          {marquee && <rect className="dg-marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} />}
        </svg>

        {ctl.editingLane && (() => {
          const pool = page.shapes.find((x) => x.id === ctl.editingLane!.pool);
          const lb = pool && laneBoxes(pool).find((l) => l.lane.id === ctl.editingLane!.lane);
          if (!pool || !lb) return null;
          const horizontal = (pool.container!.dir ?? 'h') === 'h';
          return (
            <input
              className="dg-laneeditor"
              aria-label={t('Nombre del carril')}
              autoFocus
              defaultValue={lb.lane.title}
              style={{ left: (lb.title.x + (horizontal ? lb.title.w : 0) - ox) * scale + 4, top: (lb.title.y + lb.title.h / 2 - oy) * scale - 14, width: 180 }}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => {
                const v = e.target.value.trim();
                const le = ctl.editingLane!;
                ctl.editingLane = null;
                if (v && v !== lb.lane.title) ctl.renameLaneTo(le.pool, le.lane, v);
                else ctl.touch();
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  ctl.editingLane = null;
                  ctl.touch();
                }
              }}
            />
          );
        })()}
        {(editingShape || editingConn) &&
          (() => {
            const box = editingShape ? { x: editingShape.x, y: editingShape.y, w: editingShape.w, h: editingShape.h, rot: editingShape.rot } : (() => {
              const mid = connectorRender(editingConn!, page).route.mid;
              return { x: mid.x - 70, y: mid.y - 14, w: 140, h: 28, rot: 0 };
            })();
            const font = editingShape ? editingShape.font : editingConn!.font;
            return (
              <textarea
                className="dg-editor"
                aria-label={t('Texto de la forma')}
                autoFocus
                value={draft}
                spellCheck={false}
                style={{
                  left: (box.x - ox) * scale,
                  top: (box.y - oy) * scale,
                  width: Math.max(60, box.w * scale),
                  height: Math.max(28, box.h * scale),
                  transform: `rotate(${box.rot}deg)`,
                  fontFamily: font.family,
                  fontSize: font.size * scale,
                  fontWeight: font.bold ? 700 : 400,
                  fontStyle: font.italic ? 'italic' : 'normal',
                  color: font.color,
                  textAlign: font.align,
                }}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => finishEdit(true)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Escape') finishEdit(false);
                  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finishEdit(true);
                }}
              />
            );
          })()}
      </div>
    </div>
  );
}

void newConnector;
void referencePoint;
