import { describe, expect, it } from 'vitest';
import { clampPoint, clipFileName, cropBox, describeSize, fitScale, fullRect, isZone, moveRect, rectBetween, resizeRect } from './index';

const B = { w: 1000, h: 600 };

describe('rectBetween and clampPoint', () => {
  it('gives the same zone whatever the direction of the drag', () => {
    const a = { x: 10, y: 20 };
    const b = { x: 110, y: 70 };
    expect(rectBetween(a, b)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(rectBetween(b, a)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(rectBetween({ x: 110, y: 20 }, { x: 10, y: 70 })).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });
  it('keeps a point inside the capture', () => {
    expect(clampPoint({ x: -5, y: 700 }, B)).toEqual({ x: 0, y: 600 });
    expect(clampPoint({ x: 500, y: 300 }, B)).toEqual({ x: 500, y: 300 });
  });
});

describe('isZone and cropBox', () => {
  it('a click or a sliver is not a zone', () => {
    expect(isZone(null)).toBe(false);
    expect(isZone({ x: 5, y: 5, w: 3, h: 100 })).toBe(false);
    expect(isZone({ x: 5, y: 5, w: 4, h: 4 })).toBe(true);
  });
  it('with no zone the whole capture is cut', () => {
    expect(cropBox(null, B)).toEqual({ x: 0, y: 0, w: 1000, h: 600 });
    expect(cropBox({ x: 10, y: 10, w: 2, h: 2 }, B)).toEqual(fullRect(B));
  });
  it('rounds to whole pixels inside the capture and is never empty', () => {
    expect(cropBox({ x: 10.4, y: 20.6, w: 100.2, h: 50.2 }, B)).toEqual({ x: 10, y: 21, w: 101, h: 50 });
    const edge = cropBox({ x: 990, y: 590, w: 40, h: 40 }, B);
    expect(edge.x + edge.w).toBeLessThanOrEqual(1000);
    expect(edge.y + edge.h).toBeLessThanOrEqual(600);
    expect(edge.w).toBeGreaterThanOrEqual(1);
    expect(cropBox({ x: 2000, y: 2000, w: 50, h: 50 }, B).w).toBeGreaterThanOrEqual(1);
  });
});

describe('moveRect and resizeRect', () => {
  const r = { x: 100, y: 100, w: 200, h: 100 };
  it('moves the zone but never out of the capture', () => {
    expect(moveRect(r, 10, -20, B)).toEqual({ x: 110, y: 80, w: 200, h: 100 });
    expect(moveRect(r, -500, -500, B)).toMatchObject({ x: 0, y: 0 });
    expect(moveRect(r, 5000, 5000, B)).toMatchObject({ x: 800, y: 500 });
  });
  it('resizes from the bottom-right corner within the capture and the minimum', () => {
    expect(resizeRect(r, 50, -20, B)).toEqual({ x: 100, y: 100, w: 250, h: 80 });
    expect(resizeRect(r, 5000, 5000, B)).toMatchObject({ w: 900, h: 500 });
    expect(resizeRect(r, -5000, -5000, B)).toMatchObject({ w: 4, h: 4 });
  });
});

describe('fitScale, file name and size text', () => {
  it('fits the preview and never enlarges it', () => {
    expect(fitScale({ w: 3840, h: 2160 }, { w: 960, h: 540 })).toBeCloseTo(0.25);
    expect(fitScale({ w: 400, h: 300 }, { w: 960, h: 540 })).toBe(1);
    expect(fitScale({ w: 0, h: 0 }, { w: 960, h: 540 })).toBe(1);
  });
  it('names the file with the local date and without forbidden characters', () => {
    expect(clipFileName('Recorte de pantalla', new Date(2026, 10, 23, 9, 5, 7))).toBe('Recorte de pantalla 2026-11-23 09-05-07.png');
    expect(clipFileName('a/b:c', new Date(2026, 0, 2, 3, 4, 5))).toBe('a-b-c 2026-01-02 03-04-05.png');
  });
  it('describes a size', () => {
    expect(describeSize({ w: 300.4, h: 199.6 })).toBe('300 × 200 px');
  });
});
