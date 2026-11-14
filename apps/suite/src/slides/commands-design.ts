import type { CommandDef } from '@suitenova/core-ui';
import { BG_STYLES, FONT_SCHEMES, COLOR_SCHEMES, applyBackgroundStyle, currentBackgroundStyle, currentThemeId, resetSlide, setThemeColors, setThemeFonts } from '@suitenova/slides-core';
import type { SlidesUI } from './commands';

/** Design tab: theme variants (colours, fonts, background styles), quick slide sizes and Reset slide. */
export function designCommands(ui: SlidesUI): CommandDef[] {
  const c = ui.ctl;
  const themeId = () => currentThemeId(c.realDeck, c.index);
  const theme = () => c.realDeck.themes.find((x) => x.id === themeId());
  const defs: CommandDef[] = [];
  for (const s of COLOR_SCHEMES)
    defs.push({
      id: `slides.design.colors.${s.id}`,
      label: s.name,
      icon: 'palette',
      checked: () => !!theme() && Object.entries(s.colors).every(([k, v]) => theme()!.colors[k as keyof typeof s.colors]?.toLowerCase() === v),
      enabled: () => !c.inMaster,
      run: () => c.applyReal('Colores del tema', (d) => setThemeColors(d, themeId(), s.colors)),
    });
  for (const s of FONT_SCHEMES)
    defs.push({
      id: `slides.design.fonts.${s.id}`,
      label: `${s.name}: ${s.fonts.major.latin} / ${s.fonts.minor.latin}`,
      icon: 'type',
      checked: () => theme()?.fonts.major.latin === s.fonts.major.latin && theme()?.fonts.minor.latin === s.fonts.minor.latin,
      enabled: () => !c.inMaster,
      run: () => c.applyReal('Fuentes del tema', (d) => setThemeFonts(d, themeId(), s.fonts)),
    });
  for (const s of BG_STYLES)
    defs.push({
      id: `slides.design.bgstyle.${s.id}`,
      label: s.name,
      icon: 'paintbucket',
      checked: () => currentBackgroundStyle(c.realDeck) === s.id,
      enabled: () => !c.inMaster,
      run: () => c.applyReal('Estilo de fondo', (d) => applyBackgroundStyle(d, s.id)),
    });
  defs.push({ id: 'slides.design.size.wide', label: 'Panorámica (16:9)', icon: 'ruler', checked: () => Math.round(c.deck.size.w) === 960 && Math.round(c.deck.size.h) === 540, enabled: () => !c.inMaster, run: () => c.setSlideSize(960, 540, 'fit') });
  defs.push({ id: 'slides.design.size.standard', label: 'Estándar (4:3)', icon: 'ruler', checked: () => Math.round(c.deck.size.w) === 720 && Math.round(c.deck.size.h) === 540, enabled: () => !c.inMaster, run: () => c.setSlideSize(720, 540, 'fit', 'screen4x3') });
  defs.push({ id: 'slides.design.size.custom', label: 'Tamaño personalizado…', icon: 'ruler', enabled: () => !c.inMaster, run: () => ui.openDialog('slideSize') });
  defs.push({
    id: 'slides.slide.reset',
    label: 'Restablecer diapositiva',
    icon: 'eraser',
    description: 'Devuelve los marcadores de posición de la diapositiva a la posición, el tamaño y el formato de su diseño.',
    enabled: () => !c.inMaster,
    run: () => c.apply('Restablecer diapositiva', (d) => (c.selSlides.length ? c.selSlides : [c.slide.id]).reduce((acc, id) => resetSlide(acc, id), d)),
  });
  return defs;
}
