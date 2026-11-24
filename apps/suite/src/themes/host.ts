import { emptyCustom, parseCustom, removeCustom, saveColors, saveFonts, saveTheme, stringifyCustom, type CustomThemes, type DocTheme, type NamedColors, type NamedFonts } from '@suitenova/theme-core';
import { useSyncExternalStore } from 'react';

/** What each product tells the common theme menus about itself. */
export interface ThemeHost {
  /** The theme of the document now (undefined when there is no document). */
  theme(): DocTheme | undefined;
  /** The theme can be changed now (a read-only view or a master being edited cannot). */
  enabled(): boolean;
  /**
   * Changes the theme of the document, as one step of its undo. `what` says what the person chose: the whole theme, only the colours,
   * the fonts or the effects; `next` is the theme as it must be afterwards.
   */
  apply(what: ThemeChange, next: DocTheme): void;
  /** The theme to go back to with «Reset» (Office's own for a new document). */
  original(): DocTheme;
  /** Which of the shared effect schemes the theme has, when the product can tell (otherwise the name of the scheme is compared). */
  effectsId?(): string | undefined;
  /** Re-renders the menus when the document or its theme change. */
  useRefresh(): void;
}

export type ThemeChange = 'theme' | 'colors' | 'fonts' | 'effects';

export const CHANGE_LABEL: Record<ThemeChange, string> = { theme: 'Tema', colors: 'Colores del tema', fonts: 'Fuentes del tema', effects: 'Efectos del tema' };

// ------------------------------------------------------------------------------------------------ what the person has saved

const KEY = 'suitenova.themes.custom';
let state: CustomThemes | null = null;
const listeners = new Set<() => void>();

function load(): CustomThemes {
  if (state) return state;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    /* no storage: the list lives while the program is open */
  }
  state = raw ? parseCustom(raw) : emptyCustom();
  return state;
}

function commit(next: CustomThemes): void {
  state = next;
  try {
    localStorage.setItem(KEY, stringifyCustom(next));
  } catch {
    /* ignored */
  }
  listeners.forEach((l) => l());
}

export const getCustom = (): CustomThemes => load();
export const addCustomColors = (c: NamedColors): void => commit(saveColors(load(), c));
export const addCustomFonts = (f: NamedFonts): void => commit(saveFonts(load(), f));
export const addCustomTheme = (t: DocTheme): void => commit(saveTheme(load(), t));
export const deleteCustom = (kind: 'colors' | 'fonts' | 'themes', name: string): void => commit(removeCustom(load(), kind, name));
/** For tests: forgets what was saved. */
export const resetCustom = (): void => commit(emptyCustom());

/** The colours, fonts and themes the person saved, kept up to date. */
export function useCustomThemes(): CustomThemes {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    load,
  );
}
