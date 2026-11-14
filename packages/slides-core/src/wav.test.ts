import { describe, expect, it } from 'vitest';
import { concatSamples, encodeWav, resample, samplesToWav, wavDuration } from './wav';

describe('wav', () => {
  it('writes a valid mono 16-bit header and the samples', () => {
    const w = encodeWav(new Float32Array([0, 1, -1, 0.5]), 8000);
    expect(String.fromCharCode(...w.subarray(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...w.subarray(8, 12))).toBe('WAVE');
    const v = new DataView(w.buffer);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([0, 32767, -32767, 16384]);
    expect(w.length).toBe(52);
  });
  it('clips what is out of range', () => {
    const v = new DataView(encodeWav(new Float32Array([2, -3]), 8000).buffer);
    expect([v.getInt16(44, true), v.getInt16(46, true)]).toEqual([32767, -32767]);
  });
  it('lowers the rate and keeps the duration', () => {
    const one = new Float32Array(48000).fill(0.25);
    const r = resample(one, 48000, 24000);
    expect(r.length).toBe(24000);
    expect(r[100]).toBeCloseTo(0.25);
    const wav = samplesToWav([one.subarray(0, 24000), one.subarray(24000)], 48000, 22050);
    expect(wavDuration(wav)).toBeGreaterThan(990);
    expect(wavDuration(wav)).toBeLessThan(1010);
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(22050);
  });
  it('joins pieces and recognises a file that is not a wav', () => {
    expect(concatSamples([new Float32Array([1, 2]), new Float32Array([3])])).toEqual(new Float32Array([1, 2, 3]));
    expect(wavDuration(new Uint8Array(50))).toBe(0);
  });
});
