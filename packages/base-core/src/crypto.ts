/**
 * Password protection of a database file. The bytes of the SQLite file are encrypted with AES-256-GCM, with a key derived from the
 * password by PBKDF2-SHA256, and saved after a header that says so. A wrong password, or a file that was changed, fails to open:
 * GCM authenticates what it decrypts. Nothing here can recover a lost password.
 */
const MAGIC = new TextEncoder().encode('NOVADB-ENC1\n');
const ITERATIONS = 250_000;
const SALT = 16;
const IV = 12;

/** Does this file start with the header of an encrypted Nova Base database? */
export function isEncrypted(bytes: Uint8Array): boolean {
  return bytes.length > MAGIC.length + 4 + SALT + IV && MAGIC.every((b, i) => bytes[i] === b);
}

async function keyFor(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** The file to save: header, number of iterations, salt, IV and the encrypted database. */
export async function encryptDb(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  if (!password) throw new Error('La contraseña no puede estar vacía.');
  const salt = crypto.getRandomValues(new Uint8Array(SALT));
  const iv = crypto.getRandomValues(new Uint8Array(IV));
  const key = await keyFor(password, salt, ITERATIONS);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, bytes as BufferSource));
  const out = new Uint8Array(MAGIC.length + 4 + SALT + IV + body.length);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(MAGIC.length, ITERATIONS);
  out.set(salt, MAGIC.length + 4);
  out.set(iv, MAGIC.length + 4 + SALT);
  out.set(body, MAGIC.length + 4 + SALT + IV);
  return out;
}

/** The SQLite file inside an encrypted one. Throws a readable error for a wrong password or a damaged file. */
export async function decryptDb(file: Uint8Array, password: string): Promise<Uint8Array> {
  if (!isEncrypted(file)) throw new Error('El archivo no está cifrado.');
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const iterations = view.getUint32(MAGIC.length);
  if (iterations < 1000 || iterations > 5_000_000) throw new Error('El archivo cifrado está dañado.');
  const salt = file.subarray(MAGIC.length + 4, MAGIC.length + 4 + SALT);
  const iv = file.subarray(MAGIC.length + 4 + SALT, MAGIC.length + 4 + SALT + IV);
  const body = file.subarray(MAGIC.length + 4 + SALT + IV);
  try {
    const key = await keyFor(password, salt, iterations);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, body as BufferSource));
  } catch {
    throw new Error('La contraseña no es correcta, o el archivo está dañado.');
  }
}
