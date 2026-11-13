/**
 * Protección de hojas y del libro (como en Excel): qué acciones se permiten con la hoja protegida, contraseña y bloqueo de celdas.
 * La contraseña nunca se guarda: solo su hash. El de SHA-512 con sal y vueltas es el que Excel escribe hoy; el de 16 bits
 * («password="CC1A"») es el antiguo, que Excel sigue leyendo y que solo se usa para comprobar archivos viejos.
 */
import { concat, fromBase64, sha512, toBase64 } from './sha512';

/** Acciones que una hoja protegida puede dejar hacer (todas, salvo seleccionar celdas, están prohibidas de entrada). */
export const PROTECT_ACTIONS = [
  'selectLocked',
  'selectUnlocked',
  'formatCells',
  'formatColumns',
  'formatRows',
  'insertColumns',
  'insertRows',
  'insertHyperlinks',
  'deleteColumns',
  'deleteRows',
  'sort',
  'autoFilter',
  'pivotTables',
  'objects',
  'scenarios',
] as const;
export type ProtectAction = (typeof PROTECT_ACTIONS)[number];

export interface PasswordHash {
  /** «SHA-512» se puede comprobar; cualquier otro (p. ej. «SHA-1» de archivos ajenos) solo se conserva. */
  algorithm: string;
  /** base64 */
  salt: string;
  /** base64 */
  hash: string;
  spin: number;
}

export interface SheetProtection {
  /** SHA-512 con sal (contraseñas nuevas). */
  hash?: PasswordHash;
  /** Hash antiguo de 16 bits, en hexadecimal (archivos creados por versiones viejas de Excel). */
  legacy?: string;
  /** Acciones permitidas con la hoja protegida. */
  allow: Partial<Record<ProtectAction, boolean>>;
}

export interface WorkbookProtection {
  /** Con la estructura bloqueada no se pueden añadir, borrar, mover, copiar, renombrar ni ocultar hojas. */
  structure: boolean;
  hash?: PasswordHash;
  legacy?: string;
}

export const PROTECT_SPIN = 100000;
/** Lo que se permite al proteger una hoja si no se elige nada: solo seleccionar celdas. */
export const DEFAULT_ALLOW: Partial<Record<ProtectAction, boolean>> = { selectLocked: true, selectUnlocked: true };

const utf16le = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i * 2] = c & 255;
    out[i * 2 + 1] = c >> 8;
  }
  return out;
};

/** SHA-512(sal + contraseña UTF-16LE) y luego `spin` vueltas con un contador de 32 bits. */
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

/** Hash antiguo de 16 bits de Excel (4 dígitos hexadecimales). */
export function legacyHash(password: string): string {
  let hash = 0;
  for (let i = password.length - 1; i >= 0; i--) {
    hash = ((hash >> 14) & 1) | ((hash << 1) & 0x7fff);
    hash ^= password.charCodeAt(i);
  }
  hash = ((hash >> 14) & 1) | ((hash << 1) & 0x7fff);
  hash ^= password.length;
  hash ^= 0xce4b;
  return hash.toString(16).toUpperCase().padStart(4, '0');
}

/** El hash para guardar una contraseña nueva; sin contraseña, nada. */
export function makePasswordHash(password: string | null | undefined, spin = PROTECT_SPIN): PasswordHash | undefined {
  if (!password) return undefined;
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  return { algorithm: 'SHA-512', salt: toBase64(salt), hash: toBase64(spinHash(password, salt, spin)), spin };
}

/** ¿Abre esta contraseña la protección? Sin contraseña guardada, siempre. */
export function checkPassword(p: { hash?: PasswordHash; legacy?: string }, password: string): boolean {
  if (p.hash) {
    if (p.hash.algorithm !== 'SHA-512') return false;
    return toBase64(spinHash(password, fromBase64(p.hash.salt), p.hash.spin)) === p.hash.hash;
  }
  if (p.legacy) return legacyHash(password) === p.legacy.toUpperCase();
  return true;
}

export const hasPassword = (p: { hash?: PasswordHash; legacy?: string }): boolean => Boolean(p.hash || p.legacy);
