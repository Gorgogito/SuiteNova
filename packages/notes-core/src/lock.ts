import { contentNode, newId, type Asset, type Notebook, type OcrResult, type Page, type PageBody, type Protect, type Section, type Vault } from './model';
import { imageKey } from './search';

/*
 * Páginas y secciones protegidas con contraseña. El contenido se cifra con AES-256-GCM; la clave sale de la contraseña con
 * PBKDF2-SHA-256 (600 000 vueltas). En el archivo solo hay contenido cifrado, la sal y las vueltas: ni la contraseña ni la clave.
 *
 * Si se olvida la contraseña **no hay forma de recuperar el contenido**.
 */

export const KDF_ITERATIONS = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s);
};
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// (las vistas se crean sobre un ArrayBuffer normal para que WebCrypto las acepte como BufferSource)
const buf = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

export async function deriveKey(password: string, salt: string, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', buf(enc.encode(password.normalize('NFC'))), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: buf(unb64(salt)), iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Una protección nueva (sal aleatoria) y su clave. `iterations` solo se baja en las pruebas. */
export async function newProtection(password: string, hint = '', iterations = KDF_ITERATIONS): Promise<{ protect: Protect; key: CryptoKey }> {
  if (!password) throw new Error('Escribe una contraseña.');
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const protect: Protect = { salt, iter: iterations };
  if (hint.trim()) protect.hint = hint.trim().slice(0, 200);
  return { protect, key: await deriveKey(password, salt, iterations) };
}

export async function encryptJSON(key: CryptoKey, value: unknown): Promise<Vault> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, key, buf(enc.encode(JSON.stringify(value)))));
  return { iv: b64(iv), data: b64(data) };
}

export class WrongPassword extends Error {
  constructor() {
    super('La contraseña no es correcta.');
  }
}

export async function decryptJSON<T>(key: CryptoKey, vault: Vault): Promise<T> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(unb64(vault.iv)) }, key, buf(unb64(vault.data)));
    return JSON.parse(dec.decode(plain)) as T;
  } catch {
    throw new WrongPassword();
  }
}

// ------------------------------------------------------------------ páginas

/** Las imágenes y grabaciones de una página protegida, y el texto que se leyó de ellas, viajan cifrados con la página. */
export interface Media {
  assets: Record<string, Asset>;
  ocr: Record<string, OcrResult>;
}
type PageSecret = Pick<Page, 'title' | 'containers' | 'ink' | 'versions'> & Partial<Media>;

/** Las claves de `assets` y de `ocr` que usa un cuerpo de página: activos de los cuadros y huellas de las imágenes incrustadas en el texto. */
export function mediaKeysOf(body: PageBody): string[] {
  const out = new Set<string>();
  for (const c of body.containers) {
    if (c.kind === 'image' || c.kind === 'media') out.add(c.asset);
    else if (c.kind === 'text')
      contentNode(c.content).descendants((n) => {
        if (n.type.name === 'image' && typeof n.attrs.src === 'string' && n.attrs.src.startsWith('data:image/')) out.add(imageKey(n.attrs.src));
        return true;
      });
  }
  return [...out];
}
/** Lo mismo para una página entera, con sus versiones. */
export function pageMediaKeys(p: Page): string[] {
  return [...new Set([...mediaKeysOf(p), ...p.versions.flatMap((v) => mediaKeysOf(v.body))])];
}

/** Lo que de `nb.assets` y `nb.ocr` corresponde a esas claves. */
export function pickMedia(nb: Pick<Notebook, 'assets' | 'ocr'>, keys: Iterable<string>): Media {
  const assets: Record<string, Asset> = {};
  const ocr: Record<string, OcrResult> = {};
  for (const k of keys) {
    if (nb.assets[k]) assets[k] = nb.assets[k]!;
    if (nb.ocr[k]) ocr[k] = nb.ocr[k]!;
  }
  return { assets, ocr };
}

/** Las claves que usa lo que se guarda **sin** cifrar (páginas sin contraseña, plantillas y papelera sin proteger). */
export function publicMediaKeys(nb: Notebook): Set<string> {
  const out = new Set<string>();
  const add = (p: Page) => !p.protect && !p.vault && pageMediaKeys(p).forEach((k) => out.add(k));
  for (const s of nb.sections) if (!s.protect && !s.vault) s.pages.forEach(add);
  for (const t of nb.templates) mediaKeysOf(t.body).forEach((k) => out.add(k));
  for (const t of nb.trash) {
    if (t.page) add(t.page);
    if (t.section && !t.section.protect && !t.section.vault) t.section.pages.forEach(add);
  }
  return out;
}

/** Bloquea una página (cifra su contenido y lo quita de la memoria). Necesita que ya tenga `protect`. */
export async function lockPage(page: Page, key: CryptoKey, media?: Media): Promise<Page> {
  if (!page.protect) throw new Error('La página no tiene protección.');
  const secret: PageSecret = { title: page.title, containers: page.containers, ink: page.ink, versions: page.versions, ...(media && { assets: media.assets, ocr: media.ocr }) };
  return { ...page, title: '', containers: [], ink: [], versions: [], vault: await encryptJSON(key, secret) };
}

/** Abre una página bloqueada y devuelve también las imágenes y grabaciones que llevaba cifradas. */
export async function unlockPageFull(page: Page, key: CryptoKey): Promise<{ page: Page } & Media> {
  if (!page.vault) return { page, assets: {}, ocr: {} };
  const s = await decryptJSON<PageSecret>(key, page.vault);
  const { vault: _v, ...rest } = page;
  void _v;
  return { page: { ...rest, title: s.title, containers: s.containers, ink: s.ink, versions: s.versions }, assets: s.assets ?? {}, ocr: s.ocr ?? {} };
}
export async function unlockPage(page: Page, key: CryptoKey): Promise<Page> {
  return (await unlockPageFull(page, key)).page;
}

// ------------------------------------------------------------------ secciones

/** Bloquea una sección: todas sus páginas se cifran juntas. */
export async function lockSection(section: Section, key: CryptoKey, media?: Media): Promise<Section> {
  if (!section.protect) throw new Error('La sección no tiene protección.');
  return { ...section, pages: [], vault: await encryptJSON(key, { pages: section.pages, ...(media && { assets: media.assets, ocr: media.ocr }) }) };
}

export async function unlockSectionFull(section: Section, key: CryptoKey): Promise<{ section: Section } & Media> {
  if (!section.vault) return { section, assets: {}, ocr: {} };
  const s = await decryptJSON<{ pages: Page[] } & Partial<Media>>(key, section.vault);
  const { vault: _v, ...rest } = section;
  void _v;
  return { section: { ...rest, pages: s.pages }, assets: s.assets ?? {}, ocr: s.ocr ?? {} };
}
export async function unlockSection(section: Section, key: CryptoKey): Promise<Section> {
  return (await unlockSectionFull(section, key)).section;
}

// ------------------------------------------------------------------ archivo

/**
 * El texto del archivo. Lo que está protegido y abierto en memoria se cifra de nuevo con su clave (`keys`, por identificador de
 * página o sección); lo que ya está bloqueado se guarda tal cual. Si falta la clave de algo abierto se falla: nunca se escribe en claro.
 */
export async function serializeNotebook(nb: Notebook, keys: Map<string, CryptoKey> = new Map()): Promise<string> {
  // las imágenes, grabaciones y textos leídos que solo usa lo protegido se sacan del cuerpo del archivo y se cifran con ello
  const pub = publicMediaKeys(nb);
  const moved = new Set<string>();
  const secret = (keysOf: string[]): Media => {
    keysOf.forEach((k) => !pub.has(k) && moved.add(k));
    return pickMedia(nb, keysOf);
  };
  const sections: Section[] = [];
  for (const s of nb.sections) {
    const pages: Page[] = [];
    for (const p of s.vault ? [] : s.pages) {
      if (p.protect && !p.vault) {
        const k = keys.get(p.id);
        if (!k) throw new Error('Falta la clave de una página protegida: bloquéala antes de guardar.');
        pages.push(await lockPage(p, k, secret(pageMediaKeys(p))));
      } else pages.push(p);
    }
    if (s.protect && !s.vault) {
      const k = keys.get(s.id);
      if (!k) throw new Error('Falta la clave de una sección protegida: bloquéala antes de guardar.');
      sections.push(await lockSection({ ...s, pages }, k, secret(pages.flatMap(pageMediaKeys))));
    } else sections.push(s.vault ? s : { ...s, pages });
  }
  // lo que hay en la papelera también va cifrado si estaba protegido
  const trash = [];
  for (const t of nb.trash) {
    if (t.page && t.page.protect && !t.page.vault) {
      const k = keys.get(t.page.id);
      if (!k) throw new Error('Falta la clave de una página protegida de la papelera.');
      trash.push({ ...t, page: await lockPage(t.page, k, secret(pageMediaKeys(t.page))) });
    } else if (t.section && t.section.protect && !t.section.vault) {
      const k = keys.get(t.section.id);
      if (!k) throw new Error('Falta la clave de una sección protegida de la papelera.');
      trash.push({ ...t, section: await lockSection(t.section, k, secret(t.section.pages.flatMap(pageMediaKeys))) });
    } else trash.push(t);
  }
  const assets = Object.fromEntries(Object.entries(nb.assets).filter(([k]) => !moved.has(k)));
  const ocr = Object.fromEntries(Object.entries(nb.ocr).filter(([k]) => !moved.has(k)));
  return JSON.stringify({ ...nb, sections, trash, assets, ocr });
}

/** Un identificador nuevo para algo que se copia (para que la copia no comparta clave con el original por error). */
export const copyId = (prefix: string): string => newId(prefix);
