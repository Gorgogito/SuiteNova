import type { CommandDef } from '@suitenova/core-ui';
import { COLORS_CATALOG, LAYOUT_CATALOG, STYLE_CATALOG, partsChange, partsIds, partsReflow, type SmartArtParts } from '@suitenova/smartart-core';
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, type EditorState } from 'prosemirror-state';
import '../smartart/messages';
import type { WriterUI } from './commands';

/** El SmartArt elegido como objeto, con su posición. */
export function smartArtTarget(state: EditorState | null | undefined): { pos: number; node: PMNode } | null {
  const s = state?.selection;
  return s instanceof NodeSelection && s.node.type.name === 'smartart' ? { pos: s.from, node: s.node } : null;
}

/** Tamaño del dibujo en puntos (los píxeles de Word son 0,75 pt). */
export const ptSize = (node: PMNode): { width: number; height: number } => ({ width: Number(node.attrs.width) * 0.75, height: Number(node.attrs.height) * 0.75 });

/** Cambia atributos del SmartArt en `pos` y lo deja elegido. */
export function patchSmartArt(ui: WriterUI, pos: number, patch: Record<string, unknown>): void {
  const v = ui.ctl.mainView;
  const node = v?.state.doc.nodeAt(pos);
  if (!v || !node || node.type.name !== 'smartart') return;
  const tr = v.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch }).setMeta('nw-no-track', true);
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  v.dispatch(tr);
  v.focus();
}

/** Cambia diseño, colores o estilo del SmartArt elegido (conserva el texto). */
export function changeSmartArtAt(ui: WriterUI, what: { layout?: string; style?: string; colors?: string }): void {
  const t = smartArtTarget(ui.ctl.mainState);
  if (!t) return;
  const parts = partsChange(t.node.attrs.parts as SmartArtParts, what, ptSize(t.node));
  if (parts) patchSmartArt(ui, t.pos, { parts });
}

export function smartArtCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const ready = () => !!c.mainView && !c.readOnly;
  const target = () => smartArtTarget(c.mainState);
  const ids = () => {
    const t = target();
    return t ? partsIds(t.node.attrs.parts as SmartArtParts) : null;
  };
  const defs: CommandDef[] = [
    { id: 'writer.insert.smartart', label: 'SmartArt…', icon: 'smartart', description: 'Inserta un diagrama (lista, proceso, ciclo, organigrama, pirámide, Venn o matriz) que guarda su texto y su diseño.', enabled: ready, run: () => ui.openDialog('smartart', {}) },
    { id: 'writer.smartart.edit', label: 'Editar SmartArt…', icon: 'smartart', description: 'Cambia el texto, el diseño, los colores, el estilo, el tamaño y el ajuste del SmartArt elegido.', enabled: () => ready() && !!target(), run: () => { const t = target(); if (t) ui.openDialog('smartart', { pos: t.pos }); } },
    {
      id: 'writer.smartart.reflow',
      label: 'Ajustar al tamaño',
      icon: 'smartart',
      description: 'Vuelve a distribuir el SmartArt con el tamaño que tiene ahora.',
      enabled: () => ready() && !!target(),
      run: () => {
        const t = target();
        const parts = t && partsReflow(t.node.attrs.parts as SmartArtParts, ptSize(t.node));
        if (t && parts) patchSmartArt(ui, t.pos, { parts });
      },
    },
  ];
  for (const l of LAYOUT_CATALOG) defs.push({ id: `writer.smartart.layout.${l.id.split('/').pop()}`, label: l.name, icon: 'smartart', description: l.description, enabled: () => ready() && !!target(), checked: () => ids()?.layout === l.id, run: () => changeSmartArtAt(ui, { layout: l.id }) });
  for (const k of COLORS_CATALOG) defs.push({ id: `writer.smartart.colors.${k.id.split('/').pop()}`, label: k.name, icon: 'palette', enabled: () => ready() && !!target(), checked: () => ids()?.colors === k.id, run: () => changeSmartArtAt(ui, { colors: k.id }) });
  for (const k of STYLE_CATALOG) defs.push({ id: `writer.smartart.style.${k.id.split('/').pop()}`, label: k.name, icon: 'smartart', enabled: () => ready() && !!target(), checked: () => ids()?.style === k.id, run: () => changeSmartArtAt(ui, { style: k.id }) });
  return defs;
}
