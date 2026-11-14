import { describe, expect, it } from 'vitest';
import { mergeRegions, type Region } from './booleans';

const rect = (x: number, y: number, w: number, h: number): Region => [[{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]];
const area = (reg: Region[]) =>
  reg.reduce((s, r) => s + r.reduce((a, ring) => a + Math.abs(ring.reduce((t, p, i) => t + p.x * ring[(i + 1) % ring.length]!.y - ring[(i + 1) % ring.length]!.x * p.y, 0) / 2) * 1, 0), 0);
const signed = (reg: Region[]) =>
  reg.reduce((s, r) => s + r.reduce((a, ring) => a + ring.reduce((t, p, i) => t + p.x * ring[(i + 1) % ring.length]!.y - ring[(i + 1) % ring.length]!.x * p.y, 0) / 2, 0), 0);

describe('merge shapes', () => {
  const a = rect(0, 0, 10, 10);
  const b = rect(5, 5, 10, 10);
  it('union of two overlapping squares', () => {
    const r = mergeRegions([a, b], 'union');
    expect(r).toHaveLength(1);
    expect(signed(r)).toBeCloseTo(175);
    expect(r[0]).toHaveLength(1);
    expect(r[0]![0]).toHaveLength(8);
  });
  it('intersect keeps the overlap', () => {
    const r = mergeRegions([a, b], 'intersect');
    expect(signed(r)).toBeCloseTo(25);
    expect(r[0]![0]).toHaveLength(4);
  });
  it('subtract removes the second from the first', () => {
    const r = mergeRegions([a, b], 'subtract');
    expect(signed(r)).toBeCloseTo(75);
    const r2 = mergeRegions([b, a], 'subtract');
    expect(signed(r2)).toBeCloseTo(75);
  });
  it('combine drops the overlap', () => {
    expect(signed(mergeRegions([a, b], 'combine'))).toBeCloseTo(150);
  });
  it('fragment gives three faces', () => {
    const r = mergeRegions([a, b], 'fragment');
    expect(r).toHaveLength(3);
    expect(area(r)).toBeCloseTo(175);
  });
  it('a square inside another leaves a hole', () => {
    const r = mergeRegions([rect(0, 0, 20, 20), rect(5, 5, 5, 5)], 'subtract');
    expect(r).toHaveLength(1);
    expect(r[0]).toHaveLength(2);
    expect(signed(r)).toBeCloseTo(375);
  });
  it('adjacent squares sharing an edge join into one rectangle', () => {
    const r = mergeRegions([rect(0, 0, 10, 10), rect(10, 0, 10, 10)], 'union');
    expect(r[0]).toHaveLength(1);
    expect(r[0]![0]).toHaveLength(4);
    expect(signed(r)).toBeCloseTo(200);
  });
  it('disjoint shapes: empty intersection', () => {
    expect(mergeRegions([a, rect(30, 30, 5, 5)], 'intersect')).toHaveLength(0);
  });
  it('three shapes', () => {
    expect(signed(mergeRegions([a, b, rect(0, 10, 10, 10)], 'union'))).toBeCloseTo(250);
  });
});
