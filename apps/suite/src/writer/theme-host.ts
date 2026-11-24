import { officeTheme } from '@suitenova/theme-core';
import { useSyncExternalStore } from 'react';
import type { ThemeHost } from '../themes';
import type { WriterUI } from './commands';

/** Writer gives the common theme menus the theme of the document; changing it is one step of the undo. */
export function writerThemeHost(ui: WriterUI): ThemeHost {
  const c = ui.ctl;
  return {
    theme: () => c.theme,
    enabled: () => !!c.mainView && !c.readOnly,
    original: () => officeTheme(),
    useRefresh: () => void useSyncExternalStore(c.subscribe, c.getVersion),
    apply: (_what, next) => c.applyTheme(next),
  };
}
