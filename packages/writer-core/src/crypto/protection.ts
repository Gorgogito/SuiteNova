import type { Protection } from '../docx/model';
import { concat, fromBase64, sha512, toBase64 } from './sha512';

const utf16le = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i * 2] = c & 255;
    out[i * 2 + 1] = c >> 8;
  }
  return out;
};

/** Word's password hash for document protection: SHA-512 of salt + password, then spun `spin` times with a counter. */
export function spinHash(password: string, salt: Uint8Array, spin: number): Uint8Array {
  let h = sha512(concat(salt, utf16le(password)));
  const counter = new Uint8Array(4);
  for (let i = 0; i < spin; i++) {
    counter[0] = i & 255;
    counter[1] = (i >>> 8) & 255;
    counter[2] = (i >>> 16) & 255;
    counter[3] = (i >>> 24) & 255;
    h = sha512(concat(h, counter));
  }
  return h;
}

export const PROTECTION_SPIN = 100000;

/** Build the protection record for a mode; with a password the hash is stored (never the password). */
export function makeProtection(mode: Protection['mode'], password: string | null): Protection {
  if (!password) return { mode };
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  return { mode, hash: { algorithm: 'SHA-512', salt: toBase64(salt), hash: toBase64(spinHash(password, salt, PROTECTION_SPIN)), spin: PROTECTION_SPIN } };
}

/** Whether a password opens the protection (always true when there is no password). */
export function checkProtectionPassword(p: Protection, password: string): boolean {
  if (!p.hash) return true;
  const h = toBase64(spinHash(password, fromBase64(p.hash.salt), p.hash.spin));
  return h === p.hash.hash;
}
