import { flattenPath } from './geometry';
import type { Contour, FontLike, PathCmd, TextAlign } from './types';

export interface LayoutOptions {
  /** Tamaño de la fuente en px. */
  size: number;
  align?: TextAlign;
  /** Espacio extra entre letras, en px. */
  letterSpacing?: number;
  /** Multiplicador de la altura natural de línea (por omisión 1). */
  lineHeight?: number;
}

export interface TextLine {
  /** Línea base, en px desde lo alto del bloque. */
  baseline: number;
  width: number;
  /** Esquina izquierda de la línea, en px. */
  x: number;
}

/** El texto compuesto: contornos de las letras (aplanados) en un bloque de `width` x `height` px con el origen arriba a la izquierda. */
export interface TextBlock {
  contours: Contour[];
  width: number;
  height: number;
  lines: TextLine[];
}

const move = (cmds: PathCmd[], dx: number, dy: number, k: number): PathCmd[] =>
  cmds.map((c): PathCmd => {
    if (c[0] === 'M' || c[0] === 'L') return [c[0], c[1] * k + dx, c[2] * k + dy];
    if (c[0] === 'Q') return ['Q', c[1] * k + dx, c[2] * k + dy, c[3] * k + dx, c[4] * k + dy];
    if (c[0] === 'C') return ['C', c[1] * k + dx, c[2] * k + dy, c[3] * k + dx, c[4] * k + dy, c[5] * k + dx, c[6] * k + dy];
    return c;
  });

/** Compone `text` (las líneas se separan con salto de línea) con la fuente dada. Sin ligaduras ni escrituras complejas. */
export function layoutText(text: string, font: FontLike, o: LayoutOptions): TextBlock {
  const k = o.size / font.unitsPerEm;
  const lh = (font.ascender - font.descender) * k * (o.lineHeight ?? 1);
  const spacing = o.letterSpacing ?? 0;
  const rows = text.split(/\r?\n/);
  const measured = rows.map((row) => {
    const chars = [...row];
    let w = 0;
    const xs: number[] = [];
    chars.forEach((ch, i) => {
      xs.push(w);
      w += font.glyph(ch).advance * k + spacing + (i + 1 < chars.length ? font.kern(ch, chars[i + 1]!) * k : 0);
    });
    return { chars, xs, w: Math.max(0, w - (chars.length ? spacing : 0)) };
  });
  const width = Math.max(0, ...measured.map((m) => m.w));
  const lines: TextLine[] = [];
  const contours: Contour[] = [];
  measured.forEach((m, li) => {
    const x0 = o.align === 'center' ? (width - m.w) / 2 : o.align === 'right' ? width - m.w : 0;
    const baseline = li * lh + font.ascender * k * (o.lineHeight ?? 1);
    lines.push({ baseline, width: m.w, x: x0 });
    m.chars.forEach((ch, i) => {
      const g = font.glyph(ch);
      if (g.path.length) contours.push(...flattenPath(move(g.path, x0 + m.xs[i]!, baseline, k), Math.max(1.5, o.size / 14)));
    });
  });
  return { contours, width, height: lh * rows.length, lines };
}
