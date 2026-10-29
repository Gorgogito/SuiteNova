import { describe, expect, it } from 'vitest';
import { checkProtectionPassword, makeProtection } from './protection';
import { sha512, toBase64 } from './sha512';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('SHA-512', () => {
  it('matches the standard test vectors', () => {
    expect(hex(sha512(new TextEncoder().encode('abc')))).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    );
    expect(hex(sha512(new Uint8Array(0)))).toBe(
      'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
    );
  });
  it('agrees with WebCrypto on long and block-boundary inputs', async () => {
    for (const n of [1, 111, 112, 127, 128, 129, 255, 1000, 5000]) {
      const data = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 255);
      const web = new Uint8Array(await crypto.subtle.digest('SHA-512', data));
      expect(toBase64(sha512(data)), `n=${n}`).toBe(toBase64(web));
    }
  });
});

describe('document protection password', () => {
  it('accepts the right password and rejects a wrong one', { timeout: 60000 }, () => {
    const p = makeProtection('readOnly', 'secreto');
    expect(p.hash?.spin).toBe(100000);
    expect(checkProtectionPassword(p, 'secreto')).toBe(true);
    expect(checkProtectionPassword(p, 'Secreto')).toBe(false);
    expect(checkProtectionPassword(makeProtection('forms', null), 'lo que sea')).toBe(true);
  });
});
