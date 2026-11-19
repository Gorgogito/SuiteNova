import type { CommandDef } from '@suitenova/core-ui';
import { NodeSelection, type EditorState } from 'prosemirror-state';
import type { WriterUI } from './commands';

import { wrapPatch } from './image-objects';

export type ImageWrap = 'left' | 'right' | 'top' | 'front' | 'behind' | null;

/** The selected picture (position and attributes), or null. */
export function selectedImage(state: EditorState | null | undefined): { pos: number; attrs: Record<string, any> } | null {
  const s = state?.selection;
  return s instanceof NodeSelection && s.node.type.name === 'image' ? { pos: s.from, attrs: s.node.attrs } : null;
}

/** Change attributes of the selected picture in one undoable step, keeping it selected. */
export function patchImage(ui: WriterUI, patch: Record<string, unknown>): boolean {
  const v = ui.ctl.mainView;
  const sel = selectedImage(v?.state);
  if (!v || !sel) return false;
  const tr = v.state.tr.setNodeMarkup(sel.pos, null, { ...sel.attrs, ...patch });
  v.dispatch(tr.setSelection(NodeSelection.create(tr.doc, sel.pos)));
  return true;
}

/** Picture tools: format dialog, rotate, flip, text wrapping and reset. */
export function imageCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const sel = () => selectedImage(c.mainState);
  const ready = () => !!c.mainView && !c.readOnly && !!sel();
  const at = () => sel()?.attrs ?? {};
  const defs: CommandDef[] = [
    { id: 'writer.image.format', label: 'Formato de imagen…', icon: 'image', description: 'Texto alternativo, tamaño, recorte, giro, borde y ajuste de texto de la imagen seleccionada.', enabled: ready, run: () => ui.openDialog('imageFormat') },
    { id: 'writer.image.corrections', label: 'Opciones de corrección de imagen…', icon: 'contrast', description: 'Brillo, contraste y nitidez de la imagen; no la cambian: se pueden quitar con «Restablecer imagen».', enabled: ready, run: () => ui.openDialog('pictureCorrections') },
    { id: 'writer.image.color', label: 'Opciones de color de imagen…', icon: 'palette', description: 'Saturación, temperatura, transparencia y recolorear la imagen.', enabled: ready, run: () => ui.openDialog('pictureColor') },
    { id: 'writer.image.artistic', label: 'Opciones de efectos artísticos…', icon: 'sparkles', description: 'Efecto artístico de la imagen y su intensidad.', enabled: ready, run: () => ui.openDialog('pictureArtistic') },
    { id: 'writer.image.removeBg', label: 'Quitar fondo…', icon: 'eraser', description: 'Quita el fondo de la imagen; puede marcar las áreas que se mantienen o se quitan.', enabled: ready, run: () => ui.openDialog('removeBg') },
    { id: 'writer.image.rotateRight', label: 'Girar a la derecha', icon: 'arrowRight', description: 'Gira la imagen 90° en el sentido de las agujas del reloj.', enabled: ready, run: () => patchImage(ui, { rotate: (((at().rotate ?? 0) + 90) % 360) }) },
    { id: 'writer.image.rotateLeft', label: 'Girar a la izquierda', icon: 'arrowLeft', description: 'Gira la imagen 90° en sentido contrario.', enabled: ready, run: () => patchImage(ui, { rotate: (((at().rotate ?? 0) + 270) % 360) }) },
    { id: 'writer.image.flipH', label: 'Voltear horizontalmente', icon: 'columns2', enabled: ready, checked: () => !!at().flipH, run: () => patchImage(ui, { flipH: !at().flipH }) },
    { id: 'writer.image.flipV', label: 'Voltear verticalmente', icon: 'panelTop', enabled: ready, checked: () => !!at().flipV, run: () => patchImage(ui, { flipV: !at().flipV }) },
    {
      id: 'writer.image.reset',
      label: 'Restablecer imagen',
      icon: 'eraser',
      description: 'Quita el recorte, el giro, el volteo, el borde y el ajuste de texto (el tamaño se conserva).',
      enabled: () => ready() && (!!at().edits || !!at().crop || !!at().rotate || !!at().flipH || !!at().flipV || !!at().border || !!at().wrap),
      run: () => {
        const a = at();
        const crop = a.crop as { l: number; t: number; r: number; b: number } | null;
        const kx = crop ? 1 - crop.l - crop.r : 1;
        const ky = crop ? 1 - crop.t - crop.b : 1;
        // the picture goes back to its original too (the effects, the background removal and the colours)
        patchImage(ui, { ...(a.edits ? { src: a.orig, orig: null, edits: null } : {}), crop: null, rotate: 0, flipH: false, flipV: false, border: null, wrap: null, x: 0, y: 0, width: a.width ? Math.round(a.width / kx) : null, height: a.height ? Math.round(a.height / ky) : null });
      },
    },
  ];
  const wraps: [string, string, ImageWrap, string][] = [
    ['inline', 'En línea con el texto', null, 'alignJustify'],
    ['left', 'A la izquierda, texto alrededor', 'left', 'alignLeft'],
    ['right', 'A la derecha, texto alrededor', 'right', 'alignRight'],
    ['top', 'Arriba y abajo', 'top', 'alignCenter'],
    ['front', 'Delante del texto', 'front', 'alignJustify'],
    ['behind', 'Detrás del texto', 'behind', 'alignJustify'],
  ];
  // dentro de un grupo la imagen siempre es libre: su ajuste es el del grupo
  const inGroup = () => { const s = sel(); const st = c.mainState; return !!s && !!st && st.doc.resolve(s.pos).parent.type.name === 'shape_group'; };
  for (const [id, label, wrap, icon] of wraps) defs.push({ id: `writer.image.wrap.${id}`, label, icon, enabled: () => ready() && !inGroup(), checked: () => (at().wrap ?? null) === wrap, run: () => { const v = c.mainView; const s = sel(); if (v && s) patchImage(ui, wrapPatch(v, s.pos, wrap)); } });
  return defs;
}
