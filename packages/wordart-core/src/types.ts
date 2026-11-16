/** Comandos de trazado de un contorno de letra (coordenadas en píxeles, y hacia abajo). */
export type PathCmd = ['M', number, number] | ['L', number, number] | ['Q', number, number, number, number] | ['C', number, number, number, number, number, number] | ['Z'];

export interface Pt {
  x: number;
  y: number;
}

/** Un contorno ya aplanado (polígono cerrado). */
export type Contour = Pt[];

/** Una letra de la fuente: avance y trazado en unidades de la fuente, con la línea base en y = 0 y los ascendentes en y negativa. */
export interface GlyphInfo {
  advance: number;
  path: PathCmd[];
}

/**
 * Lo que el motor necesita de una fuente. Lo cumple el lector de `opentype.js` (ver `fonts.ts`) y, en las pruebas, una fuente falsa.
 * `ascender` es positivo y `descender` negativo, como en las tablas de la fuente.
 */
export interface FontLike {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  glyph(ch: string): GlyphInfo;
  /** Ajuste de espacio entre dos letras, en unidades de la fuente (0 si no hay). */
  kern(a: string, b: string): number;
}

export type TextAlign = 'left' | 'center' | 'right';

/** Una fuente que se pide por familia y estilo; devuelve `null` si no está disponible (el llamador recurre a otra forma de dibujar). */
export interface FontSource {
  load(family: string, bold: boolean, italic: boolean): Promise<FontLike | null>;
}
