export type HAlign = 'general' | 'left' | 'center' | 'right' | 'fill' | 'justify';
export type VAlign = 'top' | 'middle' | 'bottom';
export type BorderStyle = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double' | 'hair';

export interface Border {
  style: BorderStyle;
  color?: string;
}

export interface Style {
  /** Excel number-format code; undefined = General. */
  numFmt?: string;
  fontName?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** "#rrggbb" */
  color?: string;
  bg?: string;
  hAlign?: HAlign;
  vAlign?: VAlign;
  wrap?: boolean;
  indent?: number;
  top?: Border;
  right?: Border;
  bottom?: Border;
  left?: Border;
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
