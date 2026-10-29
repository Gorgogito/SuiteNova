import { isCfb, readCfb, writeCfb, type CfbEntry } from './cfb';
import { concat, fromBase64, sha512, toBase64 } from './sha512';

/**
 * Password encryption of Office Open XML files, "agile" encryption of [MS-OFFCRYPTO] (what Office 2010+ writes): the
 * package (.docx zip) is encrypted in 4096-byte segments with AES-256-CBC, the key is wrapped with a key derived from the
 * password (SHA-512, 100 000 rounds), and everything sits in a Compound File with the `EncryptionInfo` and
 * `EncryptedPackage` streams.
 */

const subtle = () => globalThis.crypto.subtle;
const SEGMENT = 4096;
const SPIN = 100000;

const BLOCK = {
  hmacKey: Uint8Array.of(0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6),
  hmacValue: Uint8Array.of(0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33),
  key: Uint8Array.of(0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6),
  verifierInput: Uint8Array.of(0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79),
  verifierValue: Uint8Array.of(0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e),
};

const utf16le = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i * 2] = c & 255;
    out[i * 2 + 1] = c >> 8;
  }
  return out;
};
const le32 = (n: number): Uint8Array => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
const random = (n: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(n));

export class WrongPasswordError extends Error {
  constructor() {
    super('La contraseña no es correcta.');
    this.name = 'WrongPasswordError';
  }
}

// ------------------------------------------------------------------------------------------------ primitives

type HashName = 'SHA1' | 'SHA256' | 'SHA384' | 'SHA512';
const SUBTLE_HASH: Record<HashName, string> = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA384: 'SHA-384', SHA512: 'SHA-512' };
const HASH_SIZE: Record<HashName, number> = { SHA1: 20, SHA256: 32, SHA384: 48, SHA512: 64 };

async function hash(name: HashName, data: Uint8Array): Promise<Uint8Array> {
  if (name === 'SHA512') return sha512(data);
  return new Uint8Array(await subtle().digest(SUBTLE_HASH[name], data as BufferSource));
}

/** AES-CBC without padding: WebCrypto always pads, so the padding block it adds is cut off (encrypt) or supplied (decrypt). */
async function aesCbc(encrypt: boolean, key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (data.length % 16) throw new Error('Los datos cifrados no son múltiplo del tamaño de bloque.');
  const k = await subtle().importKey('raw', key as BufferSource, 'AES-CBC', false, ['encrypt', 'decrypt']);
  if (encrypt) {
    const out = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: iv as BufferSource }, k, data as BufferSource));
    return out.subarray(0, data.length);
  }
  // a block of padding encrypted after the last ciphertext block lets the real data decrypt with "no padding"
  const last = data.length ? data.subarray(data.length - 16) : iv;
  const pad = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: last as BufferSource }, k, new Uint8Array(0)));
  const full = new Uint8Array(data.length + 16);
  full.set(data);
  full.set(pad.subarray(0, 16), data.length);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv: iv as BufferSource }, k, full as BufferSource));
}

function hmacSha512(key: Uint8Array, data: Uint8Array): Uint8Array {
  const block = 128;
  let k = key.length > block ? sha512(key) : key;
  const kp = new Uint8Array(block);
  kp.set(k);
  const ipad = kp.map((b) => b ^ 0x36);
  const opad = kp.map((b) => b ^ 0x5c);
  k = sha512(concat(opad, sha512(concat(ipad, data))));
  return k;
}

async function hmac(name: HashName, key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (name === 'SHA512') return hmacSha512(key, data);
  const k = await subtle().importKey('raw', key as BufferSource, { name: 'HMAC', hash: SUBTLE_HASH[name] }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', k, data as BufferSource));
}

/** The password hash after the spin rounds (the slow part, the same for every key derived from it). */
async function spunHash(name: HashName, password: string, salt: Uint8Array, spin: number): Promise<Uint8Array> {
  let h = await hash(name, concat(salt, utf16le(password)));
  if (name === 'SHA512') {
    for (let i = 0; i < spin; i++) h = sha512(concat(le32(i), h));
  } else {
    for (let i = 0; i < spin; i++) h = await hash(name, concat(le32(i), h));
  }
  return h;
}

/** The key for one purpose (`blockKey`), as in [MS-OFFCRYPTO] 2.3.4.11. */
async function deriveKey(name: HashName, spun: Uint8Array, blockKey: Uint8Array, keyBytes: number): Promise<Uint8Array> {
  const d = await hash(name, concat(spun, blockKey));
  const out = new Uint8Array(keyBytes).fill(0x36);
  out.set(d.subarray(0, Math.min(keyBytes, d.length)));
  return out;
}

const pad16 = (b: Uint8Array): Uint8Array => {
  if (b.length % 16 === 0) return b;
  const out = new Uint8Array(Math.ceil(b.length / 16) * 16);
  out.set(b);
  return out;
};

const segmentIv = async (name: HashName, salt: Uint8Array, index: number): Promise<Uint8Array> => (await hash(name, concat(salt, le32(index)))).subarray(0, 16);

async function cryptSegments(encrypt: boolean, name: HashName, key: Uint8Array, salt: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (let i = 0, off = 0; off < data.length; i++, off += SEGMENT) {
    const seg = data.subarray(off, off + SEGMENT);
    parts.push(await aesCbc(encrypt, key, await segmentIv(name, salt, i), encrypt ? pad16(seg) : seg));
  }
  return concat(...parts);
}

// ------------------------------------------------------------------------------------------------ DataSpaces

const lpP4 = (s: string): Uint8Array => {
  const raw = utf16le(s);
  const pad = (4 - (raw.length % 4)) % 4;
  return concat(le32(raw.length), raw, new Uint8Array(pad));
};

function dataSpaces(): CfbEntry[] {
  const ver = concat(lpP4('Microsoft.Container.DataSpaces'), Uint8Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0));
  const entryBody = concat(le32(1), le32(0), lpP4('EncryptedPackage'), lpP4('StrongEncryptionDataSpace'));
  const map = concat(le32(8), le32(1), le32(entryBody.length + 4), entryBody);
  const space = concat(le32(8), le32(1), lpP4('StrongEncryptionTransform'));
  const id = lpP4('{FF9A3F03-56EF-4613-BDD5-5A41C1D07246}');
  const primary = concat(le32(8 + id.length), le32(1), id, lpP4('Microsoft.Container.EncryptionTransform'), Uint8Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0), le32(0), le32(0), le32(0), le32(4));
  return [
    { path: '\u0006DataSpaces/Version', data: ver },
    { path: '\u0006DataSpaces/DataSpaceMap', data: map },
    { path: '\u0006DataSpaces/DataSpaceInfo/StrongEncryptionDataSpace', data: space },
    { path: '\u0006DataSpaces/TransformInfo/StrongEncryptionTransform/\u0006Primary', data: primary },
  ];
}

// ------------------------------------------------------------------------------------------------ encrypt

/** Encrypt a package (the bytes of a .docx) with a password; the result is the Compound File Word opens with a password prompt. */
export async function encryptPackage(pkg: Uint8Array, password: string, spin = SPIN): Promise<Uint8Array> {
  if (!password) throw new Error('La contraseña no puede estar vacía.');
  const name: HashName = 'SHA512';
  const keyDataSalt = random(16);
  const secretKey = random(32);
  // the package, size first
  const size = new Uint8Array(8);
  new DataView(size.buffer).setUint32(0, pkg.length, true);
  const encrypted = concat(size, await cryptSegments(true, name, secretKey, keyDataSalt, pkg));
  // key wrapped by the password
  const pwSalt = random(16);
  const verifierInput = random(16);
  const spun = await spunHash(name, password, pwSalt, spin);
  const kVerifierInput = await deriveKey(name, spun, BLOCK.verifierInput, 32);
  const kVerifierValue = await deriveKey(name, spun, BLOCK.verifierValue, 32);
  const kKey = await deriveKey(name, spun, BLOCK.key, 32);
  const encVerifierInput = await aesCbc(true, kVerifierInput, pwSalt, verifierInput);
  const encVerifierValue = await aesCbc(true, kVerifierValue, pwSalt, pad16(sha512(verifierInput)));
  const encKeyValue = await aesCbc(true, kKey, pwSalt, secretKey);
  // integrity
  const hmacKey = random(64);
  const encHmacKey = await aesCbc(true, secretKey, (await hash(name, concat(keyDataSalt, BLOCK.hmacKey))).subarray(0, 16), hmacKey);
  const hmacValue = hmacSha512(hmacKey, encrypted);
  const encHmacValue = await aesCbc(true, secretKey, (await hash(name, concat(keyDataSalt, BLOCK.hmacValue))).subarray(0, 16), hmacValue);

  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password" xmlns:c="http://schemas.microsoft.com/office/2006/keyEncryptor/certificate">` +
    `<keyData saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${toBase64(keyDataSalt)}"/>` +
    `<dataIntegrity encryptedHmacKey="${toBase64(encHmacKey)}" encryptedHmacValue="${toBase64(encHmacValue)}"/>` +
    `<keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">` +
    `<p:encryptedKey spinCount="${spin}" saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${toBase64(pwSalt)}" ` +
    `encryptedVerifierHashInput="${toBase64(encVerifierInput)}" encryptedVerifierHashValue="${toBase64(encVerifierValue)}" encryptedKeyValue="${toBase64(encKeyValue)}"/>` +
    `</keyEncryptor></keyEncryptors></encryption>`;
  const info = concat(Uint8Array.of(4, 0, 4, 0, 0x40, 0, 0, 0), new TextEncoder().encode(xml));
  return writeCfb([{ path: 'EncryptionInfo', data: info }, { path: 'EncryptedPackage', data: encrypted }, ...dataSpaces()]);
}

// ------------------------------------------------------------------------------------------------ decrypt

const attr = (xml: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(xml)?.[1];
const num = (xml: string, name: string): number => {
  const v = attr(xml, name);
  if (v === undefined) throw new Error(`Falta «${name}» en la información de cifrado.`);
  return Number(v);
};

/** Whether these bytes are a password-encrypted OOXML package. */
export function isEncryptedPackage(bytes: Uint8Array): boolean {
  if (!isCfb(bytes)) return false;
  try {
    const names = readCfb(bytes).map((e) => e.path);
    return names.includes('EncryptionInfo') && names.includes('EncryptedPackage');
  } catch {
    return false;
  }
}

/** Decrypt an agile-encrypted package. Throws `WrongPasswordError` when the password does not open it. */
export async function decryptPackage(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const entries = readCfb(bytes);
  const info = entries.find((e) => e.path === 'EncryptionInfo')?.data;
  const pkg = entries.find((e) => e.path === 'EncryptedPackage')?.data;
  if (!info || !pkg) throw new Error('El archivo no es un documento de Office cifrado.');
  const major = info[0]! | (info[1]! << 8);
  const minor = info[2]! | (info[3]! << 8);
  if (!(major === 4 && minor === 4)) throw new Error('Este archivo usa un cifrado antiguo (Office 2007 o anterior) que Nova Writer no puede abrir. Ábralo con Word y guárdelo de nuevo con el cifrado actual.');
  const xml = new TextDecoder().decode(info.subarray(8));
  const keyData = /<keyData\b[^>]*>/.exec(xml)?.[0] ?? '';
  const enc = /<p:encryptedKey\b[^>]*>/.exec(xml)?.[0] ?? '';
  const integrity = /<dataIntegrity\b[^>]*>/.exec(xml)?.[0] ?? '';
  if (!keyData || !enc) throw new Error('La información de cifrado no es válida o usa un método no admitido.');
  if (attr(enc, 'cipherAlgorithm') !== 'AES' || attr(enc, 'cipherChaining') !== 'ChainingModeCBC') throw new Error('El método de cifrado de este archivo no es compatible.');
  const hname = (attr(enc, 'hashAlgorithm') ?? '') as HashName;
  const dname = (attr(keyData, 'hashAlgorithm') ?? '') as HashName;
  if (!(hname in HASH_SIZE) || !(dname in HASH_SIZE)) throw new Error('El algoritmo de hash de este archivo no es compatible.');
  const spin = num(enc, 'spinCount');
  const keyBytes = num(enc, 'keyBits') / 8;
  const pwSalt = fromBase64(attr(enc, 'saltValue')!);
  const keyDataSalt = fromBase64(attr(keyData, 'saltValue')!);
  const spun = await spunHash(hname, password, pwSalt, spin);
  const kVerifierInput = await deriveKey(hname, spun, BLOCK.verifierInput, keyBytes);
  const kVerifierValue = await deriveKey(hname, spun, BLOCK.verifierValue, keyBytes);
  const verifierInput = await aesCbc(false, kVerifierInput, pwSalt.subarray(0, 16), fromBase64(attr(enc, 'encryptedVerifierHashInput')!));
  const verifierValue = await aesCbc(false, kVerifierValue, pwSalt.subarray(0, 16), fromBase64(attr(enc, 'encryptedVerifierHashValue')!));
  const expected = await hash(hname, verifierInput.subarray(0, num(enc, 'saltSize')));
  const got = verifierValue.subarray(0, HASH_SIZE[hname]);
  if (expected.length !== got.length || expected.some((b, i) => b !== got[i])) throw new WrongPasswordError();
  const kKey = await deriveKey(hname, spun, BLOCK.key, keyBytes);
  const secretKey = (await aesCbc(false, kKey, pwSalt.subarray(0, 16), fromBase64(attr(enc, 'encryptedKeyValue')!))).subarray(0, num(keyData, 'keyBits') / 8);
  // integrity (when the file carries it)
  if (integrity) {
    const encHmacKey = fromBase64(attr(integrity, 'encryptedHmacKey')!);
    const encHmacValue = fromBase64(attr(integrity, 'encryptedHmacValue')!);
    const hs = HASH_SIZE[dname];
    const hmacKey = (await aesCbc(false, secretKey, (await hash(dname, concat(keyDataSalt, BLOCK.hmacKey))).subarray(0, 16), encHmacKey)).subarray(0, hs);
    const hmacValue = (await aesCbc(false, secretKey, (await hash(dname, concat(keyDataSalt, BLOCK.hmacValue))).subarray(0, 16), encHmacValue)).subarray(0, hs);
    const actual = await hmac(dname, hmacKey, pkg);
    if (actual.length !== hmacValue.length || actual.some((b, i) => b !== hmacValue[i])) throw new Error('El archivo está dañado o fue modificado: la comprobación de integridad falló.');
  }
  const size = new DataView(pkg.buffer, pkg.byteOffset, pkg.byteLength).getUint32(0, true);
  const body = pkg.subarray(8);
  const usable = body.subarray(0, Math.floor(body.length / 16) * 16);
  const plain = await cryptSegments(false, dname, secretKey, keyDataSalt, usable);
  return plain.subarray(0, size);
}
