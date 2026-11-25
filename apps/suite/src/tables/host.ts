import type { Border, BorderMode, BorderStyle, StyleOptions } from '@suitenova/table-core';
import type { DocTheme } from '@suitenova/theme-core';
import { useSyncExternalStore } from 'react';

/** The shading that means "no colour on purpose" (it takes away the colour of the style; null lets the style decide). */
export const NO_SHADING = 'transparent';

/** What the shared table controls need from a product: what the table under the cursor has, and how to change it. */
export interface TableHost {
  /** The product re-renders the controls when the selection changes (a hook: it calls the product's own subscription). */
  useRefresh(): void;
  /** The style and options of the selected table, or null when the selection is not in a table. */
  info(): { styleId: string | null; options: StyleOptions } | null;
  /** The theme of the document: the colours of the table styles and of the shading menu (Office's when the product has no theme). */
  theme?(): DocTheme | undefined;
  /** Gives the table a style (null takes it off). */
  setStyle(id: string | null): void;
  setOption(name: keyof StyleOptions, value: boolean): void;
  /** Shades the selected cells: a colour, `null` to let the style decide again, `NO_SHADING` for no colour on purpose. */
  setShading(color: string | null): void;
  /** Draws borders on the selected cells (null: no line). */
  setBorders(mode: BorderMode, border: Border | null): void;
  /** Inserts a table of `rows` × `cols` where the cursor is. */
  insert(rows: number, cols: number): void;
}

// ------------------------------------------------------------------------------------------------ the pen of the borders

export interface Pen {
  style: Exclude<BorderStyle, 'none'>;
  /** Points. */
  width: number;
  color: string;
}

let pen: Pen = { style: 'single', width: 0.5, color: '#000000' };
const listeners = new Set<() => void>();

/** The line the border commands draw with (the same in every product, like Word's pen). */
export const getPen = (): Pen => pen;
export function setPen(patch: Partial<Pen>): void {
  pen = { ...pen, ...patch };
  listeners.forEach((l) => l());
}
export function usePen(): Pen {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pen,
  );
}

export const PEN_WIDTHS = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6];
