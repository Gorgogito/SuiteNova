import * as opentype from 'opentype.js';
import type { FontLike, FontSource, PathCmd } from './types';

/** Una fuente lista para el motor, leída de los bytes de un archivo TrueType/OpenType (con `opentype.js`). */
export function fontFromBytes(bytes: ArrayBuffer | Uint8Array): FontLike {
  const buf = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
  const font = opentype.parse(buf as ArrayBuffer);
  const upm = font.unitsPerEm;
  const cache = new Map<string, { advance: number; path: PathCmd[] }>();
  return {
    unitsPerEm: upm,
    ascender: font.ascender,
    descender: font.descender,
    glyph(ch) {
      let g = cache.get(ch);
      if (!g) {
        const gl = font.charToGlyph(ch);
        // getPath(0, 0, upm) da el trazado en unidades de la fuente con la y hacia abajo y la línea base en 0
        const path: PathCmd[] = [];
        for (const c of gl.getPath(0, 0, upm).commands) {
          if (c.type === 'M') path.push(['M', c.x, c.y]);
          else if (c.type === 'L') path.push(['L', c.x, c.y]);
          else if (c.type === 'Q') path.push(['Q', c.x1, c.y1, c.x, c.y]);
          else if (c.type === 'C') path.push(['C', c.x1, c.y1, c.x2, c.y2, c.x, c.y]);
          else path.push(['Z']);
        }
        g = { advance: gl.advanceWidth ?? upm / 2, path };
        cache.set(ch, g);
      }
      return g;
    },
    kern(a, b) {
      try {
        return font.getKerningValue(font.charToGlyph(a), font.charToGlyph(b)) || 0;
      } catch {
        return 0;
      }
    },
  };
}

export interface LocalFontData {
  family: string;
  style: string;
  fullName: string;
  blob(): Promise<Blob>;
}

/**
 * Fuentes del sistema por la API de fuentes locales del navegador (Edge/Chromium; pide el permiso `local-fonts`), o por el proveedor
 * que se pase (la app de escritorio usa uno propio porque su WebView2 no responde a esa API). Devuelve `null` si no hay API ni
 * proveedor, si se niega el permiso o si la fuente no está: el llamador dibuja entonces de otra forma.
 */
export class LocalFontSource implements FontSource {
  private list: Promise<LocalFontData[] | null> | null = null;
  constructor(private readonly provider?: () => Promise<LocalFontData[] | null>) {}
  private readonly cache = new Map<string, Promise<FontLike | null>>();
  private fonts(): Promise<LocalFontData[] | null> {
    if (!this.list) {
      if (this.provider) {
        this.list = this.provider().catch(() => null);
        return this.list;
      }
      const q = (globalThis as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
      this.list = q ? q.call(globalThis).catch(() => null) : Promise.resolve(null);
    }
    return this.list;
  }
  load(family: string, bold: boolean, italic: boolean): Promise<FontLike | null> {
    const key = `${family.toLowerCase()}|${bold ? 1 : 0}|${italic ? 1 : 0}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.find(family, bold, italic);
      this.cache.set(key, p);
    }
    return p;
  }
  private async find(family: string, bold: boolean, italic: boolean): Promise<FontLike | null> {
    const all = await this.fonts();
    if (!all) return null;
    const fam = all.filter((f) => f.family.toLowerCase() === family.toLowerCase());
    if (!fam.length) return null;
    const isBold = (f: LocalFontData) => /bold|black|heavy/i.test(f.style) && !/semi/i.test(f.style);
    const isItalic = (f: LocalFontData) => /italic|oblique/i.test(f.style);
    const pick = fam.find((f) => isBold(f) === bold && isItalic(f) === italic) ?? fam.find((f) => isBold(f) === bold) ?? fam[0]!;
    try {
      return fontFromBytes(await (await pick.blob()).arrayBuffer());
    } catch {
      return null;
    }
  }
}
