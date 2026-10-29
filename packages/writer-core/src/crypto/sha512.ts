/**
 * SHA-512 (and SHA-256 helper not needed here) in plain TypeScript with 32-bit halves. It is synchronous on purpose:
 * Word's password hash and the Office encryption key derivation spin the hash 100 000 times.
 */

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt((n.toString(2).length >> 1) + 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}
function icbrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 3) + 1);
  for (;;) {
    const y = (2n * x + n / (x * x)) / 3n;
    if (y >= x) return x;
    x = y;
  }
}

function primes(count: number): number[] {
  const out: number[] = [];
  for (let n = 2; out.length < count; n++) if (out.every((p) => n % p !== 0)) out.push(n);
  return out;
}

const MASK64 = (1n << 64n) - 1n;
const P = primes(80);
// round constants: first 64 bits of the fractional parts of the cube roots of the first 80 primes
const K_HI = new Uint32Array(80);
const K_LO = new Uint32Array(80);
P.forEach((p, i) => {
  const k = icbrt(BigInt(p) << 192n) & MASK64;
  K_HI[i] = Number(k >> 32n);
  K_LO[i] = Number(k & 0xffffffffn);
});
// initial hash: fractional parts of the square roots of the first 8 primes
const H0_HI = new Uint32Array(8);
const H0_LO = new Uint32Array(8);
P.slice(0, 8).forEach((p, i) => {
  const h = isqrt(BigInt(p) << 128n) & MASK64;
  H0_HI[i] = Number(h >> 32n);
  H0_LO[i] = Number(h & 0xffffffffn);
});

const wh = new Uint32Array(80);
const wl = new Uint32Array(80);

function compress(hh: Uint32Array, hl: Uint32Array, block: Uint8Array, off: number): void {
  for (let i = 0; i < 16; i++) {
    const j = off + i * 8;
    wh[i] = ((block[j]! << 24) | (block[j + 1]! << 16) | (block[j + 2]! << 8) | block[j + 3]!) >>> 0;
    wl[i] = ((block[j + 4]! << 24) | (block[j + 5]! << 16) | (block[j + 6]! << 8) | block[j + 7]!) >>> 0;
  }
  for (let i = 16; i < 80; i++) {
    // sigma0(w[i-15]) = rotr1 ^ rotr8 ^ shr7
    const h15 = wh[i - 15]!, l15 = wl[i - 15]!;
    const s0h = (((h15 >>> 1) | (l15 << 31)) ^ ((h15 >>> 8) | (l15 << 24)) ^ (h15 >>> 7)) >>> 0;
    const s0l = (((l15 >>> 1) | (h15 << 31)) ^ ((l15 >>> 8) | (h15 << 24)) ^ ((l15 >>> 7) | (h15 << 25))) >>> 0;
    // sigma1(w[i-2]) = rotr19 ^ rotr61 ^ shr6
    const h2 = wh[i - 2]!, l2 = wl[i - 2]!;
    const s1h = (((h2 >>> 19) | (l2 << 13)) ^ ((l2 >>> 29) | (h2 << 3)) ^ (h2 >>> 6)) >>> 0;
    const s1l = (((l2 >>> 19) | (h2 << 13)) ^ ((h2 >>> 29) | (l2 << 3)) ^ ((l2 >>> 6) | (h2 << 26))) >>> 0;
    const lo = (wl[i - 16]! + s0l + wl[i - 7]! + s1l) >>> 0;
    const carry = Math.floor((wl[i - 16]! + s0l + wl[i - 7]! + s1l) / 4294967296);
    wl[i] = lo;
    wh[i] = (wh[i - 16]! + s0h + wh[i - 7]! + s1h + carry) >>> 0;
  }
  let ah = hh[0]!, al = hl[0]!, bh = hh[1]!, bl = hl[1]!, ch = hh[2]!, cl = hl[2]!, dh = hh[3]!, dl = hl[3]!;
  let eh = hh[4]!, el = hl[4]!, fh = hh[5]!, fl = hl[5]!, gh = hh[6]!, gl = hl[6]!, hhh = hh[7]!, hhl = hl[7]!;
  for (let i = 0; i < 80; i++) {
    // Sigma1(e) = rotr14 ^ rotr18 ^ rotr41
    const S1h = (((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23))) >>> 0;
    const S1l = (((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23))) >>> 0;
    const chh = ((eh & fh) ^ (~eh & gh)) >>> 0;
    const chl = ((el & fl) ^ (~el & gl)) >>> 0;
    let t1l = hhl + S1l + chl + K_LO[i]! + wl[i]!;
    let t1h = hhh + S1h + chh + K_HI[i]! + wh[i]! + Math.floor(t1l / 4294967296);
    t1l = t1l >>> 0;
    t1h = t1h >>> 0;
    // Sigma0(a) = rotr28 ^ rotr34 ^ rotr39
    const S0h = (((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25))) >>> 0;
    const S0l = (((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25))) >>> 0;
    const mjh = ((ah & bh) ^ (ah & ch) ^ (bh & ch)) >>> 0;
    const mjl = ((al & bl) ^ (al & cl) ^ (bl & cl)) >>> 0;
    const t2l = S0l + mjl;
    const t2h = (S0h + mjh + Math.floor(t2l / 4294967296)) >>> 0;
    hhh = gh; hhl = gl;
    gh = fh; gl = fl;
    fh = eh; fl = el;
    const nel = dl + t1l;
    eh = (dh + t1h + Math.floor(nel / 4294967296)) >>> 0;
    el = nel >>> 0;
    dh = ch; dl = cl;
    ch = bh; cl = bl;
    bh = ah; bl = al;
    const nal = t1l + (t2l >>> 0);
    ah = (t1h + t2h + Math.floor(nal / 4294967296)) >>> 0;
    al = nal >>> 0;
  }
  const add = (idx: number, h: number, l: number) => {
    const lo = hl[idx]! + l;
    hl[idx] = lo >>> 0;
    hh[idx] = (hh[idx]! + h + Math.floor(lo / 4294967296)) >>> 0;
  };
  add(0, ah, al); add(1, bh, bl); add(2, ch, cl); add(3, dh, dl);
  add(4, eh, el); add(5, fh, fl); add(6, gh, gl); add(7, hhh, hhl);
}

export function sha512(data: Uint8Array): Uint8Array {
  const hh = new Uint32Array(H0_HI);
  const hl = new Uint32Array(H0_LO);
  const len = data.length;
  const padded = new Uint8Array(Math.ceil((len + 17) / 128) * 128);
  padded.set(data);
  padded[len] = 0x80;
  const bits = BigInt(len) * 8n;
  for (let i = 0; i < 16; i++) padded[padded.length - 1 - i] = Number((bits >> BigInt(8 * i)) & 0xffn);
  for (let off = 0; off < padded.length; off += 128) compress(hh, hl, padded, off);
  const out = new Uint8Array(64);
  for (let i = 0; i < 8; i++) {
    out[i * 8] = hh[i]! >>> 24; out[i * 8 + 1] = (hh[i]! >>> 16) & 255; out[i * 8 + 2] = (hh[i]! >>> 8) & 255; out[i * 8 + 3] = hh[i]! & 255;
    out[i * 8 + 4] = hl[i]! >>> 24; out[i * 8 + 5] = (hl[i]! >>> 16) & 255; out[i * 8 + 6] = (hl[i]! >>> 8) & 255; out[i * 8 + 7] = hl[i]! & 255;
  }
  return out;
}

export const toBase64 = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromBase64 = (s: string): Uint8Array => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
export const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
