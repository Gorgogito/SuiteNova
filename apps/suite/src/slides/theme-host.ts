import { applyDocTheme, currentEffectsId, currentThemeId, setThemeColors, setThemeEffects, setThemeFonts, themeToDoc } from '@suitenova/slides-core';
import { officeTheme } from '@suitenova/theme-core';
import { CHANGE_LABEL, type ThemeHost } from '../themes';
import type { SlidesUI } from './commands';
import { useUi } from './ribbonParts';

/** Slides gives the common theme menus the theme of its slide master and changes it as one step of its undo. */
export function slidesThemeHost(ui: SlidesUI): ThemeHost {
  const c = ui.ctl;
  const themeId = () => currentThemeId(c.realDeck, c.index);
  const theme = () => c.realDeck.themes.find((x) => x.id === themeId());
  return {
    theme: () => {
      const th = theme();
      return th ? themeToDoc(th) : undefined;
    },
    enabled: () => !c.inMaster && !!theme(),
    effectsId: () => currentEffectsId(theme()),
    original: () => officeTheme(),
    useRefresh: () => void useUi(ui),
    apply: (what, next) =>
      c.applyReal(CHANGE_LABEL[what], (d) => {
        const id = themeId();
        if (what === 'colors') return setThemeColors(d, id, next.colors);
        if (what === 'fonts') return setThemeFonts(d, id, next.fonts);
        if (what === 'effects') return setThemeEffects(d, id, next.fmtXml);
        return applyDocTheme(d, id, next);
      }),
  };
}
