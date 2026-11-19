import { describe, expect, it } from 'vitest';
import { PICTURE_STYLES } from '@suitenova/image-core';
import { adjustOf, frameOf, nativeOf, pixelEditsOf, splitForPicture, styleOf, withFrame, withPictureStyle } from './picedits';
import { newPicture } from './factory';

const pic = () => newPicture('a1', 0, 0, 100, 80);

describe('picture edits in Slides', () => {
  it('adjust ↔ native step ↔ pixel edits', () => {
    const a = { bright: 20, contrast: -10, alpha: 70, duotone: [{ rgb: '#102030' }, { rgb: '#f0e0d0' }] as [{ rgb: string }, { rgb: string }] };
    expect(adjustOf(nativeOf(a))).toEqual(a);
    const p = { ...pic(), adjust: a, edits: { saturation: 150 } };
    expect(pixelEditsOf(p)).toEqual({ saturation: 150, brightness: 20, contrast: -10, recolor: { kind: 'duotone', dark: '#102030', light: '#f0e0d0' }, transparency: 30 });
    expect(pixelEditsOf({ ...pic(), adjust: { gray: true } }).recolor).toEqual({ kind: 'gray' });
    expect(pixelEditsOf({ ...pic(), adjust: { biLevel: 40 } }).recolor).toEqual({ kind: 'bw', threshold: 40 });
    expect(pixelEditsOf({ ...pic(), adjust: adjustOf({ duotone: { dark: '#3a2410', light: '#fbf0d9' } }) }).recolor).toEqual({ kind: 'sepia' });
  });

  it('what PowerPoint does by itself goes to adjust; the rest is kept to be made from the original', () => {
    const { adjust, baked } = splitForPicture({ brightness: 10, recolor: { kind: 'washout' }, sharpness: 20, artistic: { id: 'blur' }, transparency: 25 });
    expect(adjust).toEqual({ bright: 80, contrast: -70, alpha: 75 });
    expect(baked).toEqual({ artistic: { id: 'blur' }, sharpness: 20 });
    expect(splitForPicture(undefined)).toEqual({ adjust: undefined, baked: undefined });
  });

  it('a style of the gallery sets shape, border and effects, clears what it leaves out and keeps the crop', () => {
    const base = { ...pic(), srcRect: { l: 5000, t: 0, r: 0, b: 0 }, geom: { prst: 'ellipse' }, ln: { w: 9, fill: { t: 'solid' as const, c: { rgb: '#000000' } } } };
    const style = PICTURE_STYLES.find((s) => s.id === 'rounded-white')!;
    const p = withPictureStyle(base, style);
    expect(p.srcRect).toEqual({ l: 5000, t: 0, r: 0, b: 0 });
    expect(p.geom).toEqual({ prst: 'roundRect' });
    expect(p.ln?.w).toBe(6);
    expect(p.effects?.outer?.dist).toBe(3);
    expect(styleOf(p)).toBe('rounded-white');
    const plain = withPictureStyle(p, PICTURE_STYLES[0]!);
    expect(plain.geom).toBeUndefined();
    expect(plain.ln).toBeUndefined();
    expect(plain.effects).toBeUndefined();
  });

  it('the frame of a picture says crop, shape, border and effects in the shared form', () => {
    const p = withFrame({ ...pic(), srcRect: { l: 1000, t: 0, r: 0, b: 2000 } }, { shape: 'ellipse', border: { color: '#ff0000', width: 2, dash: 'dash' }, fx: { glow: { color: '#00ff00', radius: 4, alpha: 0.5 }, softEdge: 3 } });
    expect(frameOf(p)).toEqual({ crop: { l: 1000, t: 0, r: 0, b: 2000 }, shape: 'ellipse', border: { color: '#ff0000', width: 2, dash: 'dash' }, fx: { glow: { color: '#00ff00', radius: 4, alpha: 0.5 }, softEdge: 3 } });
  });
});
