import type { CommandDef } from '@suitenova/core-ui';
import { COLORS_CATALOG, LAYOUT_CATALOG, STYLE_CATALOG } from '@suitenova/smartart-core';
import { changeSmartArt, isLiveSmartArt, reflowSmartArt, smartArtIds, updateSlide, type GroupEl, type SlideElement } from '@suitenova/slides-core';
import '../smartart/messages';
import type { SlidesUI } from './commands';

/** El SmartArt elegido (uno solo y con sus datos), o null. */
export function selectedSmartArt(ui: SlidesUI): GroupEl | null {
  const s = ui.ctl.selected;
  return s.length === 1 && isLiveSmartArt(s[0]!) ? (s[0] as GroupEl) : null;
}

/** Comandos del SmartArt vinculado: editar, cambiar de diseño, colores y estilo, y volver a ajustar al tamaño. */
export function smartArtCommands(ui: SlidesUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const art = () => selectedSmartArt(ui);
  const replace = (label: string, make: (el: GroupEl) => GroupEl | null) => {
    const el = art();
    const next = el && make(el);
    if (!el || !next) return;
    c.apply(label, (d) => updateSlide(d, c.slide.id, (s) => ({ ...s, shapes: s.shapes.map((e): SlideElement => (e.id === el.id ? next : e)) })), { selection: [el.id] });
  };
  add({ id: 'slides.smartart.edit', label: 'Editar SmartArt…', icon: 'smartart', description: 'Cambia el texto, el diseño, los colores y el estilo del SmartArt elegido.', enabled: () => !!art(), run: () => ui.openDialog('smartArt', { edit: true }) });
  for (const l of LAYOUT_CATALOG)
    add({ id: `slides.smartart.layout.${l.id.split('/').pop()}`, label: l.name, icon: 'smartart', description: l.description, enabled: () => !!art(), checked: () => smartArtIds(art()!)?.layout === l.id, run: () => replace('Cambiar diseño del SmartArt', (el) => changeSmartArt(el, { layout: l.id })) });
  for (const k of COLORS_CATALOG)
    add({ id: `slides.smartart.colors.${k.id.split('/').pop()}`, label: k.name, icon: 'palette', enabled: () => !!art(), checked: () => smartArtIds(art()!)?.colors === k.id, run: () => replace('Cambiar colores del SmartArt', (el) => changeSmartArt(el, { colors: k.id })) });
  for (const k of STYLE_CATALOG)
    add({ id: `slides.smartart.style.${k.id.split('/').pop()}`, label: k.name, icon: 'smartart', enabled: () => !!art(), checked: () => smartArtIds(art()!)?.style === k.id, run: () => replace('Cambiar estilo del SmartArt', (el) => changeSmartArt(el, { style: k.id })) });
  add({ id: 'slides.smartart.reflow', label: 'Ajustar al tamaño', icon: 'smartart', description: 'Vuelve a distribuir el SmartArt con el tamaño que tiene ahora.', enabled: () => !!art(), run: () => replace('Ajustar el SmartArt', (el) => reflowSmartArt(el)) });
  return defs;
}
