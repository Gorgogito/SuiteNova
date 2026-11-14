/*
 * Narration is recorded as raw samples and stored as a WAV file (16-bit, mono): PowerPoint plays it, which it does not do with the
 * formats browsers record in.
 */

/** Joins the pieces recorded one after another. */
export function concatSamples(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Lower sample rate by averaging the samples that fall in each new one. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return samples;
  const ratio = from / to;
  const n = Math.floor(samples.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.max(a + 1, Math.min(samples.length, Math.floor((i + 1) * ratio)));
    let s = 0;
    for (let k = a; k < b; k++) s += samples[k]!;
    out[i] = s / (b - a);
  }
  return out;
}

/** A mono 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), true);
  return bytes;
}

/** Duration in milliseconds of a WAV made by `encodeWav`, or 0 when it is not one. */
export function wavDuration(data: Uint8Array): number {
  if (data.length < 44 || String.fromCharCode(...data.subarray(0, 4)) !== 'RIFF') return 0;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const rate = v.getUint32(24, true);
  return rate ? Math.round(((data.length - 44) / 2 / rate) * 1000) : 0;
}

/** Recorded samples as a WAV at the given rate (22.05 kHz by default). */
export const samplesToWav = (parts: Float32Array[], fromRate: number, toRate = 22050): Uint8Array => {
  const rate = Math.min(fromRate, toRate);
  return encodeWav(resample(concatSamples(parts), fromRate, rate), rate);
};
