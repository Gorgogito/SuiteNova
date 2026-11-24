import { officeTheme } from '@suitenova/theme-core';
import { useSyncExternalStore } from 'react';
import { CHANGE_LABEL, type ThemeHost } from '../themes';
import type { CalcUI } from './commands';

/** Calc gives the common theme menus the theme of the workbook; changing it is one step of the undo. */
export function calcThemeHost(ui: CalcUI): ThemeHost {
  const d = ui.doc;
  return {
    theme: () => d.wb.theme,
    enabled: () => true,
    original: () => officeTheme(),
    useRefresh: () => void useSyncExternalStore(d.subscribe, d.getVersion),
    apply: (what, next) => d.setTheme(next, CHANGE_LABEL[what]),
  };
}
