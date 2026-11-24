import type { ColorRef } from '@suitenova/theme-core';

export type HAlign = 'general' | 'left' | 'center' | 'right' | 'fill' | 'justify';
export type VAlign = 'top' | 'middle' | 'bottom';
export type BorderStyle = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double' | 'hair';

export interface Border {
  style: BorderStyle;
  color?: string;
  /** The colour is a colour of the theme (`color` keeps the one it has for the theme of the moment). */
  ref?: ColorRef;
}

export interface Style {
  /** Excel number-format code; undefined = General. */
  numFmt?: string;
  fontName?: string;
  /** The font is the heading font (`major`) or the body font (`minor`) of the theme: `fontName` is the one it has for the theme of the moment. */
  fontTheme?: 'major' | 'minor';
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** "#rrggbb" */
  color?: string;
  /** The text colour points at the theme: `color` is what it is for the theme of the moment, and follows it when it changes. */
  colorRef?: ColorRef;
  bg?: string;
  bgRef?: ColorRef;
  hAlign?: HAlign;
  vAlign?: VAlign;
  wrap?: boolean;
  indent?: number;
  top?: Border;
  right?: Border;
  bottom?: Border;
  left?: Border;
  /** Celda bloqueada (por defecto sí): solo cuenta con la hoja protegida. Se guarda únicamente `false`. */
  locked?: boolean;
  /** Oculta la fórmula en la barra de fórmulas cuando la hoja está protegida. */
  hidden?: boolean;
}

function canonical(s: Style): string {
  const keys = Object.keys(s).sort() as (keyof Style)[];
  return JSON.stringify(keys.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
}

/** Interned, immutable cell styles. Id 0 is always the default (empty) style. */
export class StyleTable {
  private list: Style[] = [{}];
  private index = new Map<string, number>([[canonical({}), 0]]);

  get(id: number): Style {
    return this.list[id] ?? this.list[0]!;
  }

  get size(): number {
    return this.list.length;
  }

  intern(style: Style): number {
    const clean: Style = {};
    for (const [k, v] of Object.entries(style)) if (v !== undefined) (clean as Record<string, unknown>)[k] = v;
    const key = canonical(clean);
    let id = this.index.get(key);
    if (id === undefined) {
      id = this.list.length;
      this.list.push(Object.freeze(clean));
      this.index.set(key, id);
    }
    return id;
  }

  /**
   * The theme changed: every colour that points at it takes the value it has now. The ids stay, so the cells and the history do not move.
   * `resolve` gives the colour of a reference.
   */
  retheme(resolve: (ref: ColorRef) => string, font: (which: 'major' | 'minor') => string): void {
    const next = (st: Style): Style => {
      const out: Style = { ...st };
      if (st.fontTheme) out.fontName = font(st.fontTheme);
      if (st.colorRef) out.color = resolve(st.colorRef);
      if (st.bgRef) out.bg = resolve(st.bgRef);
      for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        const b = st[side];
        if (b?.ref) out[side] = { ...b, color: resolve(b.ref) };
      }
      return out;
    };
    this.list = this.list.map((st, i) => (i === 0 ? st : Object.freeze(next(st))));
    this.index = new Map(this.list.map((st, i) => [canonical(st), i] as [string, number]));
    if (!this.index.has(canonical({}))) this.index.set(canonical({}), 0);
  }

  /** Derive a style by overlaying `patch` on an existing id. `undefined` values remove properties. */
  derive(baseId: number, patch: Partial<Record<keyof Style, unknown>>): number {
    const next: Record<string, unknown> = { ...this.get(baseId) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    return this.intern(next as Style);
  }
}
