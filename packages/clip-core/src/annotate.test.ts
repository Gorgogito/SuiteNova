import { describe, expect, it } from 'vitest';
import { CLIP_COLORS, CLIP_WIDTHS, arrowHead, commit, distToSegment, drawStrokes, emptyHistory, eraseAlong, eraseAt, hitStroke, redo, simplify, strokeWidth, undo, type Stroke } from './index';

const pen = (points: { x: number; y: number }[], id = 1): Stroke => ({ id, tool: 'pen', color: '#e81123', width: 4, points });

describe('geometry of a mark', () => {
  it('distance to a segment', () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distToSegment({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
  it('simplify drops the close points and keeps the ends', () => {
    const dense = Array.from({ length: 101 }, (_, i) => ({ x: i * 0.1, y: 0 }));
    const out = simplify(dense, 2);
    expect(out[0]).toEqual(dense[0]);
    expect(out.at(-1)).toEqual(dense.at(-1));
    expect(out.length).toBeLessThan(10);
    expect(simplify([{ x: 0, y: 0 }], 2)).toHaveLength(1);
  });
  it('the arrow head sits on the tip with two equal barbs', () => {
    const [l, r] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 4)!;
    expect(Math.hypot(l.x - 100, l.y)).toBeCloseTo(Math.hypot(r.x - 100, r.y));
    expect(l.x).toBeLessThan(100);
    expect(l.y).toBeCloseTo(-r.y);
    expect(arrowHead({ x: 5, y: 5 }, { x: 5, y: 5 }, 4)).toBeNull();
    // a short arrow does not get a head bigger than itself
    const [s] = arrowHead({ x: 0, y: 0 }, { x: 6, y: 0 }, 8)!;
    expect(Math.hypot(s.x - 6, s.y)).toBeLessThanOrEqual(6.001);
  });
  it('the highlighter is drawn wider than the pen', () => {
    expect(strokeWidth({ tool: 'pen', width: 4 })).toBe(4);
    expect(strokeWidth({ tool: 'highlighter', width: 4 })).toBeGreaterThan(8);
  });
  it('offers six colours and three thicknesses, all different', () => {
    expect(new Set(CLIP_COLORS.map((c) => c.color)).size).toBe(6);
    expect(CLIP_WIDTHS.map((w) => w.px)).toEqual([2, 4, 8]);
  });
});

describe('the eraser', () => {
  const line = pen([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  const rect: Stroke = { id: 2, tool: 'rect', color: '#000', width: 2, points: [{ x: 10, y: 10 }, { x: 60, y: 40 }] };
  const arrow: Stroke = { id: 3, tool: 'arrow', color: '#000', width: 2, points: [{ x: 0, y: 100 }, { x: 80, y: 100 }] };
  it('hits a pen line near it and not far from it', () => {
    expect(hitStroke(line, { x: 50, y: 3 }, 2)).toBe(true);
    expect(hitStroke(line, { x: 50, y: 30 }, 2)).toBe(false);
  });
  it('a rectangle is hit on its edges, not in its middle', () => {
    expect(hitStroke(rect, { x: 30, y: 10 }, 2)).toBe(true);
    expect(hitStroke(rect, { x: 60, y: 25 }, 2)).toBe(true);
    expect(hitStroke(rect, { x: 30, y: 25 }, 2)).toBe(false);
  });
  it('an arrow is hit on its shaft and its head', () => {
    expect(hitStroke(arrow, { x: 40, y: 101 }, 2)).toBe(true);
    const [barb] = arrowHead(arrow.points[0]!, arrow.points[1]!, 2)!;
    expect(hitStroke(arrow, barb, 2)).toBe(true);
  });
  it('a single dot is a mark too', () => {
    expect(hitStroke(pen([{ x: 20, y: 20 }]), { x: 21, y: 21 }, 2)).toBe(true);
  });
  it('removes only what is under the point and returns the same array when nothing is', () => {
    const all = [line, rect, arrow];
    expect(eraseAt(all, { x: 50, y: 0 }, 2).map((s) => s.id)).toEqual([2, 3]);
    expect(eraseAt(all, { x: 300, y: 300 }, 2)).toBe(all);
  });
});

describe('the eraser along a drag', () => {
  it('removes every mark the pointer crossed even when it jumped over them', () => {
    const lines = [20, 60, 100].map((y, i) => pen([{ x: 0, y }, { x: 100, y }], i + 1));
    expect(eraseAlong(lines, { x: 50, y: 0 }, { x: 50, y: 120 }, 4)).toEqual([]);
    expect(eraseAlong(lines, { x: 50, y: 0 }, { x: 50, y: 40 }, 4).map((s) => s.id)).toEqual([2, 3]);
    expect(eraseAlong(lines, { x: 300, y: 0 }, { x: 300, y: 120 }, 4)).toBe(lines);
  });
});

describe('history', () => {
  const a = [pen([{ x: 0, y: 0 }], 1)];
  const b = [...a, pen([{ x: 5, y: 5 }], 2)];
  it('undoes and redoes step by step', () => {
    let h = emptyHistory();
    h = commit(h, a);
    h = commit(h, b);
    expect(h.present).toBe(b);
    h = undo(h);
    expect(h.present).toBe(a);
    h = undo(h);
    expect(h.present).toEqual([]);
    expect(undo(h)).toBe(h);
    h = redo(redo(h));
    expect(h.present).toBe(b);
    expect(redo(h)).toBe(h);
  });
  it('a new change after an undo drops what could be redone, and no change is no step', () => {
    let h = commit(commit(emptyHistory(), a), b);
    h = undo(h);
    h = commit(h, [pen([{ x: 9, y: 9 }], 3)]);
    expect(h.future).toEqual([]);
    expect(commit(h, h.present)).toBe(h);
  });
});

describe('drawing on a canvas', () => {
  function fakeCtx() {
    const calls: string[] = [];
    const ctx: Record<string, unknown> = { globalAlpha: 1, lineWidth: 1 };
    for (const m of ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'strokeRect']) ctx[m] = (...a: unknown[]) => calls.push(`${m}(${a.map((x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x)).join(',')})`);
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, raw: ctx };
  }
  it('draws a pen path with a line per point and scales it', () => {
    const { ctx, calls } = fakeCtx();
    drawStrokes(ctx, [pen([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }])], 0.5);
    expect(calls).toContain('moveTo(0,0)');
    expect(calls).toContain('lineTo(5,5)');
    expect(calls).toContain('lineTo(10,0)');
    expect(calls.filter((c) => c === 'stroke()')).toHaveLength(1);
  });
  it('draws a dot for a single point, a rectangle, and a highlighter see-through only while it draws', () => {
    const { ctx, calls, raw } = fakeCtx();
    drawStrokes(ctx, [pen([{ x: 3, y: 3 }]), { id: 2, tool: 'rect', color: '#000', width: 2, points: [{ x: 1, y: 2 }, { x: 11, y: 22 }] }]);
    expect(calls.some((c) => c.startsWith('arc(3,3'))).toBe(true);
    expect(calls).toContain('strokeRect(1,2,10,20)');
    let seen = 1;
    raw.stroke = () => void (seen = raw.globalAlpha as number);
    drawStrokes(ctx, [{ id: 3, tool: 'highlighter', color: '#ffd800', width: 4, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }] }]);
    expect(seen).toBeCloseTo(0.4);
  });
  it('skips empty strokes and saves and restores the canvas state for each mark', () => {
    const { ctx, calls } = fakeCtx();
    drawStrokes(ctx, [pen([]), pen([{ x: 0, y: 0 }, { x: 5, y: 5 }])]);
    expect(calls.filter((c) => c === 'save()')).toHaveLength(1);
    expect(calls.filter((c) => c === 'restore()')).toHaveLength(1);
  });
});
