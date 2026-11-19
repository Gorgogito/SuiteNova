import type { MacroModule } from './debug';

/**
 * The trust centre of the macros, shared by every product: the security level, the trusted locations, the personal certificates and the
 * publishers that are trusted, plus the global library of each product. Everything lives in the settings of the program (localStorage).
 *
 * The signature is NOT an Authenticode signature (Office cannot read it and Nova cannot read Office's): it is an ECDSA P-256 signature over the
 * code of the macros, made with a personal certificate that the user creates here, kept in the file next to the macros.
 */

export type MacroLevel = 'warn' | 'off' | 'signed' | 'all';

export interface Publisher {
  name: string;
  fingerprint: string;
}
export interface Certificate extends Publisher {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}
export interface MacroSecurity {
  level: MacroLevel;
  /** Folders whose files open with their macros enabled. */
  locations: string[];
  publishers: Publisher[];
}

const KEY_SECURITY = 'nova.macros.security';
const KEY_CERTS = 'nova.macros.certs';
const KEY_LIB = 'nova.macros.library.';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* no storage: the settings last until the page closes */
  }
}

export const defaultSecurity = (): MacroSecurity => ({ level: 'warn', locations: [], publishers: [] });

export function getSecurity(): MacroSecurity {
  const s = read<Partial<MacroSecurity>>(KEY_SECURITY, {});
  return {
    level: s.level === 'off' || s.level === 'signed' || s.level === 'all' ? s.level : 'warn',
    locations: Array.isArray(s.locations) ? s.locations.filter((x) => typeof x === 'string') : [],
    publishers: Array.isArray(s.publishers) ? s.publishers.filter((p) => typeof p?.name === 'string' && typeof p?.fingerprint === 'string') : [],
  };
}
export function setSecurity(s: MacroSecurity): void {
  write(KEY_SECURITY, s);
}
export const setLevel = (level: MacroLevel): void => setSecurity({ ...getSecurity(), level });

// ------------------------------------------------------------------------------------------------ trusted locations

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
/** The file is inside a trusted folder (or any folder below one). */
export function inTrustedLocation(path: string | null | undefined, locations = getSecurity().locations): boolean {
  if (!path) return false;
  const f = norm(path);
  return locations.some((l) => {
    const d = norm(l);
    return d !== '' && f.startsWith(`${d}/`);
  });
}
export function addLocation(path: string): void {
  const s = getSecurity();
  const p = path.trim();
  if (p && !s.locations.some((l) => norm(l) === norm(p))) setSecurity({ ...s, locations: [...s.locations, p] });
}
export function removeLocation(path: string): void {
  const s = getSecurity();
  setSecurity({ ...s, locations: s.locations.filter((l) => l !== path) });
}

// ------------------------------------------------------------------------------------------------ signature

/** The reserved module that carries the signature in the list of modules of a file (the editors and the interpreter never see it). */
export const SIGNATURE_MODULE = '$Firma';
export const isSignature = (m: MacroModule): boolean => m.name === SIGNATURE_MODULE;
/** The modules that are code. */
export const codeModules = (mods: MacroModule[]): MacroModule[] => mods.filter((m) => !isSignature(m));

interface SignaturePayload {
  publisher: string;
  fingerprint: string;
  publicKey: JsonWebKey;
  signature: string;
}
export type SignatureState = 'none' | 'valid' | 'invalid';
export interface SignatureInfo {
  state: SignatureState;
  publisher?: string;
  fingerprint?: string;
  trusted?: boolean;
}

const subtle = (): SubtleCrypto => {
  if (!globalThis.crypto?.subtle) throw new Error('Este entorno no tiene criptografía disponible.');
  return globalThis.crypto.subtle;
};
const b64 = (b: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** What is signed: the name and code of every module, in order. */
const canonical = (mods: MacroModule[]): Uint8Array<ArrayBuffer> => new TextEncoder().encode(JSON.stringify(codeModules(mods).map((m) => [m.name, m.code])));

async function fingerprintOf(key: JsonWebKey): Promise<string> {
  const d = await subtle().digest('SHA-256', new TextEncoder().encode(`${key.x}.${key.y}`));
  const hex = [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 32).replace(/(.{4})/g, '$1 ').trim().toUpperCase();
}

export const certificates = (): Certificate[] => read<Certificate[]>(KEY_CERTS, []);

/** A new personal certificate (like SELFCERT): a key pair kept in the settings of this program. */
export async function createCertificate(name: string): Promise<Certificate> {
  const n = name.trim();
  if (!n) throw new Error('Escriba el nombre del publicador.');
  const pair = await subtle().generateKey(ALG, true, ['sign', 'verify']);
  const publicKey = await subtle().exportKey('jwk', pair.publicKey);
  const privateKey = await subtle().exportKey('jwk', pair.privateKey);
  const cert: Certificate = { name: n, fingerprint: await fingerprintOf(publicKey), publicKey, privateKey };
  write(KEY_CERTS, [...certificates(), cert]);
  return cert;
}
export function removeCertificate(fingerprint: string): void {
  write(KEY_CERTS, certificates().filter((c) => c.fingerprint !== fingerprint));
}

const payloadOf = (mods: MacroModule[]): SignaturePayload | null => {
  const m = mods.find(isSignature);
  if (!m) return null;
  try {
    const p = JSON.parse(m.code) as SignaturePayload;
    return typeof p.publisher === 'string' && typeof p.signature === 'string' && p.publicKey && typeof p.fingerprint === 'string' ? p : null;
  } catch {
    return null;
  }
};

/** Signs the macros with the certificate; the signature replaces any earlier one (it is written in place into the list). */
export async function signModules(mods: MacroModule[], cert: Certificate): Promise<void> {
  const key = await subtle().importKey('jwk', cert.privateKey, ALG, false, ['sign']);
  const sig = await subtle().sign(SIGN, key, canonical(mods));
  const payload: SignaturePayload = { publisher: cert.name, fingerprint: cert.fingerprint, publicKey: cert.publicKey, signature: b64(sig) };
  const at = mods.findIndex(isSignature);
  const entry = { name: SIGNATURE_MODULE, code: JSON.stringify(payload) };
  if (at >= 0) mods[at] = entry;
  else mods.push(entry);
  cacheDrop();
  // what was just signed is known to be valid (the runtime cannot wait for a check)
  cache.set(cacheKey(mods), { state: 'valid', publisher: cert.name, fingerprint: cert.fingerprint });
}
export function removeSignature(mods: MacroModule[]): void {
  const at = mods.findIndex(isSignature);
  if (at >= 0) mods.splice(at, 1);
  cacheDrop();
}

const cache = new Map<string, SignatureInfo>();
const cacheDrop = () => cache.clear();
const cacheKey = (mods: MacroModule[]) => JSON.stringify(mods.map((m) => [m.name, m.code]));
const isTrusted = (fingerprint: string, publishers = getSecurity().publishers) => publishers.some((p) => p.fingerprint === fingerprint);

/** Checks the signature of the macros of a file. The result is remembered until the macros change. */
export async function verifyModules(mods: MacroModule[]): Promise<SignatureInfo> {
  const k = cacheKey(mods);
  const hit = cache.get(k);
  if (hit) return { ...hit, trusted: hit.fingerprint ? isTrusted(hit.fingerprint) : undefined };
  const p = payloadOf(mods);
  let info: SignatureInfo;
  if (!p) info = { state: mods.some(isSignature) ? 'invalid' : 'none' };
  else {
    let ok = false;
    try {
      const key = await subtle().importKey('jwk', p.publicKey, ALG, false, ['verify']);
      ok = await subtle().verify(SIGN, key, unb64(p.signature), canonical(mods));
      // the fingerprint written in the file must be the one of the key it carries
      if (ok && (await fingerprintOf(p.publicKey)) !== p.fingerprint) ok = false;
    } catch {
      ok = false;
    }
    info = { state: ok ? 'valid' : 'invalid', publisher: p.publisher, ...(ok ? { fingerprint: p.fingerprint } : {}) };
  }
  cache.set(k, info);
  return { ...info, trusted: info.fingerprint ? isTrusted(info.fingerprint) : undefined };
}
/** The last known result for these macros, if they were verified (for the places that cannot wait). */
export function knownSignature(mods: MacroModule[]): SignatureInfo | undefined {
  const hit = cache.get(cacheKey(mods));
  return hit ? { ...hit, trusted: hit.fingerprint ? isTrusted(hit.fingerprint) : undefined } : undefined;
}

export function trustPublisher(p: Publisher): void {
  const s = getSecurity();
  if (!isTrusted(p.fingerprint, s.publishers)) setSecurity({ ...s, publishers: [...s.publishers, { name: p.name, fingerprint: p.fingerprint }] });
}
export function untrustPublisher(fingerprint: string): void {
  const s = getSecurity();
  setSecurity({ ...s, publishers: s.publishers.filter((p) => p.fingerprint !== fingerprint) });
}

// ------------------------------------------------------------------------------------------------ opening a file

/** What a product does when it opens a file that has macros (or when the macros change). */
export interface MacroOwner {
  contentEnabled: boolean;
  /** What the bar of security says about the signature. */
  macroSignature?: SignatureInfo;
  touch(): void;
}

/**
 * The policy of the trust centre for a file that has just been opened: sets `contentEnabled` at once from what is known without waiting
 * (no macros, level «all», trusted folder) and then, when the macros are signed, checks the signature and enables them if the publisher is trusted.
 */
export function applyOpenPolicy(owner: MacroOwner, mods: MacroModule[], path: string | null): void {
  const code = codeModules(mods);
  const s = getSecurity();
  owner.macroSignature = undefined;
  if (code.length === 0) {
    owner.contentEnabled = true;
    return;
  }
  owner.contentEnabled = s.level === 'all' || (s.level !== 'off' && s.level !== 'signed' && inTrustedLocation(path, s.locations));
  if (owner.contentEnabled && s.level !== 'all' && s.level !== 'warn') return;
  void verifyModules(mods).then((info) => {
    owner.macroSignature = info;
    const now = getSecurity();
    if (info.state === 'valid' && info.trusted && now.level !== 'off') owner.contentEnabled = true;
    owner.touch();
  });
}

/** Can the macros of the file run, given the level and the signature? (Active content has to be enabled besides.) */
export function levelAllows(mods: MacroModule[]): { ok: true } | { ok: false; reason: string } {
  const { level } = getSecurity();
  if (level === 'off') return { ok: false, reason: 'Las macros están deshabilitadas en el Centro de confianza de macros.' };
  if (level === 'signed' && codeModules(mods).length) {
    const sig = knownSignature(mods);
    if (!sig || sig.state !== 'valid' || !sig.trusted) return { ok: false, reason: 'El Centro de confianza solo permite macros firmadas por un publicador de confianza.' };
  }
  return { ok: true };
}

// ------------------------------------------------------------------------------------------------ global library

/** The id of the library of each product (the ones that keep one). */
export type LibraryId = 'writer' | 'calc' | 'slides' | 'mail' | 'plan' | 'diagram';
export const LIBRARY_NAMES: Record<LibraryId, string> = {
  writer: 'Normal (Writer)',
  calc: 'Personal (Calc)',
  slides: 'Biblioteca de Slides',
  mail: 'Biblioteca de Mail',
  plan: 'Global (Plan)',
  diagram: 'Biblioteca de Diagram',
};
/** The prefix the interpreter sees in front of the name of a library module, so it never clashes with a module of the file. */
export const LIBRARY_PREFIX = 'Global_';

const libs = new Map<LibraryId, MacroModule[]>();
/** The live list of modules of a product's library (the editor changes it in place; `saveLibrary` stores it). */
export function libraryOf(id: LibraryId): MacroModule[] {
  let l = libs.get(id);
  if (!l) {
    l = read<MacroModule[]>(KEY_LIB + id, []).filter((m) => typeof m?.name === 'string' && typeof m?.code === 'string');
    libs.set(id, l);
  }
  return l;
}
export function saveLibrary(id: LibraryId): void {
  write(KEY_LIB + id, libraryOf(id));
}
/** For the tests and for «restore»: forget what was read. */
export function resetLibraryCache(): void {
  libs.clear();
}
/** The library modules as the interpreter loads them. */
export const libraryForInterpreter = (id: LibraryId): MacroModule[] => libraryOf(id).map((m) => ({ name: LIBRARY_PREFIX + m.name, code: m.code }));
