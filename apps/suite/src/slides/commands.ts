import type { CommandDef } from '@suitenova/core-ui';
import { redo as pmRedo, undo as pmUndo } from 'prosemirror-history';
import type { SlidesCtl } from './ctl';
import { applyPara, applyRun, applyTextFormat, canFormatText } from './textcmds';
import { addNodeAt, deleteNode, segmentCount, setNodeKind, setSegmentKind, toggleClosed, type NodeKind } from '@suitenova/slides-core';
import { addLayout, deleteLayout, deleteMaster, duplicateLayout, duplicateMaster, moveLayout, newPlaceholder, type PhType } from '@suitenova/slides-core';
import { fitCrop, cellsOf, deleteCols, deleteRows, distributeCols, distributeRows, insertCols, insertRows, mapCells, mergeCells, type CellRange } from '@suitenova/slides-core';
import { imageDims } from './render/assets';
import { effectsOf, moveEffect, removeEffect, transitionToAll } from './animctl';

export type SlidesDialog =
  | 'about'
  | 'shortcuts'
  | 'slideSize'
  | 'hyperlink'
  | 'table'
  | 'chart'
  | 'headerFooter'
  | 'findReplace'
  | 'format'
  | 'smartArt'
  | 'wordArt'
  | 'themes'
  | 'pictureCorrections'
  | 'exportMedia'
  | 'tableSplit'
  | 'tableCell'
  | 'tableSize'
  | 'background'
  | 'transition'
  | 'setupShow'
  | 'comment'
  | 'spelling'
  | 'sections'
  | 'customShows'
  | 'exportImages'
  | 'exportVideo'
  | 'fontDialog'
  | 'paragraphDialog'
  | 'tabsDialog'
  | 'columnsDialog'
  | 'position'
  | 'altText'
  | 'masterLayout'
  | 'equation'
  | 'sections'
  | 'actionSettings';

export interface SlidesUI {
  ctl: SlidesCtl;
  openDialog(kind: SlidesDialog, arg?: unknown): void;
  newWindow(): void;
  open(): Promise<void>;
  save(saveAs: boolean): Promise<void>;
  exportAs(kind: 'pdf' | 'pptx' | 'ppsx' | 'potx' | 'odp' | 'png' | 'video'): Promise<void>;
  print(): void;
  present(from: 'start' | 'current', opts?: { presenter?: boolean; rehearse?: boolean; preview?: 'transition' | 'animation'; show?: string }): void;
  insertPicture(): void;
  /** stores a file in the presentation and returns its asset id */
  addAsset(data: Uint8Array, mime: string, name: string): string;
  /** asks for a picture file and returns the id of the asset it was stored as */
  pickAsset(kind: 'image'): Promise<string | null>;
  insertMedia(kind: 'video' | 'audio'): void;
  close(): void;
  /** the drawing context of the current slide (theme colours, fonts) */
  canvasCtx(): import('./render/SlideCanvas').CanvasCtx | null;
  runProps(): import('@suitenova/slides-core').RunProps;
  paraProps(): import('@suitenova/slides-core').ParaProps & { lvl: number };
}

export const FONT_NAMES = ['Calibri', 'Calibri Light', 'Arial', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Impact', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];

const nextSize = (cur: number, up: boolean): number => (up ? (FONT_SIZES.find((s) => s > cur) ?? cur + 8) : ([...FONT_SIZES].reverse().find((s) => s < cur) ?? Math.max(1, cur - 1)));

export function slidesCommands(ui: SlidesUI): CommandDef[] {
  const c = ui.ctl;
  const runProps = () => ui.runProps();
  const paraProps = () => ui.paraProps();
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const hasSel = () => c.selection.length > 0;
  const text = () => canFormatText(c);

  // ---- file
  add({ id: 'slides.new', label: 'Presentación nueva', icon: 'new', shortcut: 'Ctrl+N', run: () => ui.newWindow() });
  add({ id: 'slides.open', label: 'Abrir…', icon: 'open', shortcut: 'Ctrl+O', run: () => void ui.open() });
  add({ id: 'slides.save', label: 'Guardar', icon: 'save', shortcut: 'Ctrl+S', description: 'Guarda la presentación como archivo de PowerPoint (.pptx).', run: () => void ui.save(false) });
  add({ id: 'slides.saveAs', label: 'Guardar como…', icon: 'save', shortcut: 'Ctrl+Shift+S', run: () => void ui.save(true) });
  add({ id: 'slides.export.pdf', label: 'Exportar a PDF (imprimir)…', icon: 'exportFile', run: () => void ui.exportAs('pdf') });
  add({ id: 'slides.export.pptx', label: 'Exportar como presentación de PowerPoint (.pptx)…', icon: 'exportFile', run: () => void ui.exportAs('pptx') });
  add({ id: 'slides.export.ppsx', label: 'Exportar como presentación con diapositivas (.ppsx)…', icon: 'exportFile', run: () => void ui.exportAs('ppsx') });
  add({ id: 'slides.export.potx', label: 'Guardar como plantilla (.potx)…', icon: 'exportFile', run: () => void ui.exportAs('potx') });
  add({ id: 'slides.export.odp', label: 'Exportar como OpenDocument (.odp)…', icon: 'exportFile', run: () => void ui.exportAs('odp') });
  add({ id: 'slides.export.png', label: 'Exportar las diapositivas como imágenes…', icon: 'image', run: () => void ui.exportAs('png') });
  add({ id: 'slides.export.video', label: 'Exportar como vídeo…', icon: 'video', run: () => void ui.exportAs('video') });
  add({ id: 'slides.print', label: 'Imprimir', icon: 'print', shortcut: 'Ctrl+P', run: () => ui.print() });
  add({ id: 'slides.about', label: 'Acerca de Nova Slides', icon: 'info', run: () => ui.openDialog('about') });
  add({ id: 'help.shortcuts', label: 'Atajos de teclado', icon: 'keyboard', run: () => ui.openDialog('shortcuts') });

  // ---- edit
  add({ id: 'slides.undo', label: 'Deshacer', icon: 'undo', shortcut: 'Ctrl+Z', enabled: () => c.canUndo || !!c.editor, run: () => (c.editor && c.editor.hasFocus() ? pmUndo(c.editor.state, c.editor.dispatch) : c.undo()) });
  add({ id: 'slides.redo', label: 'Rehacer', icon: 'redo', shortcut: ['Ctrl+Y', 'Ctrl+Shift+Z'], enabled: () => c.canRedo || !!c.editor, run: () => (c.editor && c.editor.hasFocus() ? pmRedo(c.editor.state, c.editor.dispatch) : c.redo()) });
  add({ id: 'slides.cut', label: 'Cortar', icon: 'cut', shortcut: 'Ctrl+X', enabled: () => !c.editor && (hasSel() || c.selSlides.length > 0), run: () => c.cut() });
  add({ id: 'slides.copy', label: 'Copiar', icon: 'copy', shortcut: 'Ctrl+C', enabled: () => !c.editor, run: () => c.copy() });
  add({ id: 'slides.paste', label: 'Pegar', icon: 'paste', shortcut: 'Ctrl+V', enabled: () => !c.editor && !!c.clip, run: () => c.paste() });
  add({ id: 'slides.duplicate', label: 'Duplicar objeto', icon: 'copy', shortcut: 'Ctrl+D', enabled: hasSel, run: () => c.duplicateSelected() });
  add({ id: 'slides.delete', label: 'Eliminar objeto', icon: 'trash', enabled: hasSel, run: () => c.deleteSelected() });
  add({ id: 'slides.selectAll', label: 'Seleccionar todo', run: () => c.selectAll() });
  const takeFormat = (sticky: boolean) => {
    if (c.painter) {
      c.painter = null;
      return c.touch();
    }
    const src = c.selected[0] as unknown as Record<string, unknown>;
    const fmt: Record<string, unknown> = {};
    for (const k of ['fill', 'ln', 'effects', 'style']) if (src[k] !== undefined) fmt[k] = src[k];
    const hasText = src.kind === 'shape' || src.kind === 'table';
    const pp = ui.paraProps();
    c.painter = { fmt: fmt as never, sticky, ...(hasText ? { text: { r: ui.runProps(), p: { algn: pp.algn, lnSpc: pp.lnSpc, spcBef: pp.spcBef, spcAft: pp.spcAft, marL: pp.marL, indent: pp.indent, bullet: pp.bullet } } } : {}) };
    c.touch();
  };
  add({
    id: 'slides.painter',
    label: 'Copiar formato',
    icon: 'paintbrush',
    shortcut: 'Ctrl+Shift+C',
    description: 'Copia el formato (relleno, contorno, efectos y formato del texto) del objeto seleccionado para pasarlo a otro con un clic.',
    checked: () => !!c.painter && !c.painter.sticky,
    enabled: () => c.selection.length === 1 || !!c.painter,
    run: () => takeFormat(false),
  });
  add({
    id: 'slides.painter.sticky',
    label: 'Pincel continuo',
    icon: 'paintbrush',
    description: 'Como Copiar formato, pero sigue activo para pasarlo a varios objetos; Esc lo termina.',
    checked: () => !!c.painter?.sticky,
    enabled: () => c.selection.length === 1 || !!c.painter,
    run: () => takeFormat(true),
  });
  add({
    id: 'slides.painter.paste',
    label: 'Pegar formato',
    icon: 'paintbrush',
    shortcut: 'Ctrl+Shift+V',
    enabled: () => !!c.painter && c.selection.length > 0 && !c.editor,
    run: () => {
      if (!c.painter) return;
      pasteFormat(c, c.selection);
      if (!c.painter.sticky) c.painter = null;
      c.touch();
    },
  });

  // ---- slides
  add({ id: 'slides.slide.new', label: 'Nueva diapositiva', icon: 'slideNew', shortcut: 'Ctrl+M', run: () => c.newSlide() });
  add({ id: 'slides.slide.duplicate', label: 'Duplicar diapositiva', icon: 'copy', run: () => c.duplicateSlides() });
  add({ id: 'slides.slide.delete', label: 'Eliminar diapositiva', icon: 'trash', enabled: () => c.deck.slides.length > 1, run: () => c.deleteSlides() });
  add({ id: 'slides.slide.up', label: 'Mover diapositiva hacia arriba', icon: 'moveUp', enabled: () => c.index > 0, run: () => c.moveSlidesTo(c.selSlides, Math.max(0, c.index - 1)) });
  add({ id: 'slides.slide.down', label: 'Mover diapositiva hacia abajo', icon: 'moveDown', enabled: () => c.index < c.deck.slides.length - 1, run: () => c.moveSlidesTo(c.selSlides, c.index + 1) });
  add({ id: 'slides.slide.hide', label: 'Ocultar diapositiva', icon: 'eyeOff', checked: () => !!c.slide.hidden, run: () => c.hideSlides(!c.slide.hidden) });
  add({ id: 'slides.slide.size', label: 'Tamaño de la diapositiva…', icon: 'ruler', enabled: () => !c.inMaster, run: () => ui.openDialog('slideSize') });
  add({ id: 'slides.section.add', label: 'Agregar sección', icon: 'folder', run: () => ui.openDialog('sections', 'add') });
  add({ id: 'slides.section.manage', label: 'Secciones…', icon: 'folder', run: () => ui.openDialog('sections') });

  // ---- text
  const tog = (id: string, label: string, icon: string, key: keyof import('@suitenova/slides-core').RunProps, sc: string, on: unknown = true, offVal: unknown = false) =>
    add({
      id,
      label,
      icon,
      shortcut: sc,
      enabled: text,
      checked: () => !!runProps()[key],
      run: () => {
        const has = !!runProps()[key];
        applyRun(c, (r) => {
          const n = { ...r } as Record<string, unknown>;
          if (has) {
            if (offVal === undefined) delete n[key];
            else n[key] = offVal;
          } else n[key] = on;
          return n as import('@suitenova/slides-core').RunProps;
        });
      },
    });
  tog('slides.bold', 'Negrita', 'bold', 'b', 'Ctrl+B');
  tog('slides.italic', 'Cursiva', 'italic', 'i', 'Ctrl+I');
  tog('slides.underline', 'Subrayado', 'underline', 'u', 'Ctrl+U', 'sng', undefined);
  tog('slides.strike', 'Tachado', 'strike', 'strike', 'Ctrl+5', 'sng', undefined);
  add({ id: 'slides.fontGrow', label: 'Aumentar tamaño de fuente', icon: 'plus', shortcut: 'Ctrl+Shift+>', enabled: text, run: () => applyRun(c, (r) => ({ ...r, sz: nextSize(runProps().sz ?? 18, true) })) });
  add({ id: 'slides.fontShrink', label: 'Disminuir tamaño de fuente', icon: 'minus', shortcut: 'Ctrl+Shift+<', enabled: text, run: () => applyRun(c, (r) => ({ ...r, sz: nextSize(runProps().sz ?? 18, false) })) });
  add({ id: 'slides.superscript', label: 'Superíndice', icon: 'superscript', shortcut: 'Ctrl+Shift++', enabled: text, checked: () => (runProps().baseline ?? 0) > 0, run: () => applyRun(c, (r) => (runProps().baseline && runProps().baseline! > 0 ? { ...r, baseline: undefined } : { ...r, baseline: 30 })) });
  add({ id: 'slides.subscript', label: 'Subíndice', icon: 'subscript', shortcut: 'Ctrl+=', enabled: text, checked: () => (runProps().baseline ?? 0) < 0, run: () => applyRun(c, (r) => (runProps().baseline && runProps().baseline! < 0 ? { ...r, baseline: undefined } : { ...r, baseline: -25 })) });
  add({ id: 'slides.clearFormat', label: 'Borrar todo el formato', icon: 'eraser', enabled: text, run: () => applyRun(c, () => ({})) });
  add({ id: 'slides.caps', label: 'Mayúsculas', icon: 'caseUpper', enabled: text, checked: () => runProps().cap === 'all', run: () => applyRun(c, (r) => ({ ...r, cap: runProps().cap === 'all' ? undefined : 'all' })) });
  add({ id: 'slides.smallCaps', label: 'Versalitas', icon: 'caseUpper', enabled: text, checked: () => runProps().cap === 'small', run: () => applyRun(c, (r) => ({ ...r, cap: runProps().cap === 'small' ? undefined : 'small' })) });
  add({ id: 'slides.textShadow', label: 'Sombra de texto', icon: 'shadow', enabled: text, checked: () => !!runProps().fx?.effects?.outer, run: () => applyRun(c, (r) => (runProps().fx?.effects?.outer ? { ...r, fx: { ...r.fx, effects: { ...r.fx?.effects, outer: undefined } } } : { ...r, fx: { ...r.fx, effects: { ...r.fx?.effects, outer: { blur: 2, dist: 2, dir: 45, c: { rgb: '#000000', mods: [{ t: 'alpha', v: 40000 }] } } } } })) });
  add({ id: 'slides.fontDialog', label: 'Fuente…', icon: 'type', shortcut: 'Ctrl+T', enabled: text, run: () => ui.openDialog('fontDialog') });

  // ---- paragraph
  const aligns: [string, 'l' | 'ctr' | 'r' | 'just', string, string, string?][] = [
    ['slides.alignLeft', 'l', 'Alinear a la izquierda', 'alignLeft', 'Ctrl+L'],
    ['slides.alignCenter', 'ctr', 'Centrar', 'alignCenter', 'Ctrl+E'],
    ['slides.alignRight', 'r', 'Alinear a la derecha', 'alignRight', 'Ctrl+R'],
    ['slides.alignJustify', 'just', 'Justificar', 'alignJustify', 'Ctrl+J'],
  ];
  for (const [id, a, label, icon, sc] of aligns) add({ id, label, icon, shortcut: sc, enabled: text, checked: () => (paraProps().algn ?? 'l') === a, run: () => applyPara(c, (p) => ({ p: { ...p, algn: a } })) });
  add({ id: 'slides.bullets', label: 'Viñetas', icon: 'list', enabled: text, checked: () => paraProps().bullet?.kind === 'char', run: () => applyPara(c, (p, lvl) => (p.bullet?.kind === 'char' ? { p: { ...p, bullet: { kind: 'none' }, marL: 0, indent: 0 } } : { p: { ...p, bullet: { kind: 'char', char: '•', font: 'Arial' }, marL: 18 + lvl * 36, indent: -18 } })) });
  add({ id: 'slides.numbering', label: 'Numeración', icon: 'listOrdered', enabled: text, checked: () => paraProps().bullet?.kind === 'auto', run: () => applyPara(c, (p, lvl) => (p.bullet?.kind === 'auto' ? { p: { ...p, bullet: { kind: 'none' }, marL: 0, indent: 0 } } : { p: { ...p, bullet: { kind: 'auto', auto: 'arabicPeriod', startAt: 1 }, marL: 27 + lvl * 36, indent: -27 } })) });
  add({ id: 'slides.levelUp', label: 'Aumentar nivel de lista', icon: 'indentMore', shortcut: 'Alt+Shift+→', enabled: text, run: () => applyPara(c, (_p, lvl) => ({ lvl: Math.min(8, lvl + 1) })) });
  add({ id: 'slides.levelDown', label: 'Disminuir nivel de lista', icon: 'indentLess', shortcut: 'Alt+Shift+←', enabled: text, run: () => applyPara(c, (_p, lvl) => ({ lvl: Math.max(0, lvl - 1) })) });
  add({ id: 'slides.paragraphDialog', label: 'Párrafo…', icon: 'pilcrow', enabled: text, run: () => ui.openDialog('paragraphDialog') });
  add({ id: 'slides.tabs', label: 'Tabulaciones…', icon: 'ruler', enabled: text, run: () => ui.openDialog('tabsDialog') });
  add({ id: 'slides.columns', label: 'Columnas…', icon: 'columns', enabled: () => c.selected.some((e) => e.kind === 'shape'), run: () => ui.openDialog('columnsDialog') });

  // ---- arrange
  add({ id: 'slides.front', label: 'Traer al frente', icon: 'toFront', enabled: hasSel, run: () => c.order('front') });
  add({ id: 'slides.back', label: 'Enviar al fondo', icon: 'toBack', enabled: hasSel, run: () => c.order('back') });
  add({ id: 'slides.forward', label: 'Traer adelante', icon: 'moveUp', enabled: hasSel, run: () => c.order('forward') });
  add({ id: 'slides.backward', label: 'Enviar atrás', icon: 'moveDown', enabled: hasSel, run: () => c.order('backward') });
  const al: [string, 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom', string, string][] = [
    ['slides.alignObjLeft', 'left', 'Alinear a la izquierda (objetos)', 'alignLeft'],
    ['slides.alignObjCenter', 'center', 'Alinear al centro (objetos)', 'alignCenter'],
    ['slides.alignObjRight', 'right', 'Alinear a la derecha (objetos)', 'alignRight'],
    ['slides.alignObjTop', 'top', 'Alinear arriba', 'alignTop'],
    ['slides.alignObjMiddle', 'middle', 'Alinear al medio', 'alignMiddle'],
    ['slides.alignObjBottom', 'bottom', 'Alinear abajo', 'alignBottom'],
  ];
  for (const [id, how, label, icon] of al) add({ id, label, icon, description: 'Con varios objetos se alinean entre sí (su cuadro común); con uno solo, respecto a la diapositiva.', enabled: hasSel, run: () => c.align(how) });
  add({ id: 'slides.distributeH', label: 'Distribuir horizontalmente', icon: 'distributeH', enabled: () => c.selection.length >= 3, run: () => c.distribute('h') });
  add({ id: 'slides.distributeV', label: 'Distribuir verticalmente', icon: 'distributeV', enabled: () => c.selection.length >= 3, run: () => c.distribute('v') });
  add({ id: 'slides.group', label: 'Agrupar', icon: 'group', shortcut: 'Ctrl+G', enabled: () => c.selection.length >= 2, run: () => c.group() });
  add({ id: 'slides.ungroup', label: 'Desagrupar', icon: 'ungroup', shortcut: 'Ctrl+Shift+G', enabled: () => c.selected.some((e) => e.kind === 'group' && !e.smartart), run: () => c.ungroup() });
  add({ id: 'slides.rotateRight', label: 'Girar a la derecha 90°', icon: 'rotate', enabled: hasSel, run: () => c.patchSelected('Girar', (e) => rot(c, e, 90)) });
  add({ id: 'slides.rotateLeft', label: 'Girar a la izquierda 90°', icon: 'rotate', enabled: hasSel, run: () => c.patchSelected('Girar', (e) => rot(c, e, -90)) });
  add({ id: 'slides.flipH', label: 'Voltear horizontalmente', icon: 'flipH', enabled: hasSel, run: () => c.patchSelected('Voltear', (e) => ({ ...e, xfrm: { ...c.xfrmOf(e), flipH: !c.xfrmOf(e).flipH } }) as typeof e) });
  add({ id: 'slides.flipV', label: 'Voltear verticalmente', icon: 'flipV', enabled: hasSel, run: () => c.patchSelected('Voltear', (e) => ({ ...e, xfrm: { ...c.xfrmOf(e), flipV: !c.xfrmOf(e).flipV } }) as typeof e) });
  add({ id: 'slides.altText', label: 'Texto alternativo…', icon: 'info', enabled: hasSel, run: () => ui.openDialog('altText') });
  add({ id: 'slides.action', label: 'Acción…', icon: 'play', enabled: hasSel, run: () => ui.openDialog('actionSettings') });
  add({ id: 'slides.position', label: 'Tamaño y posición…', icon: 'ruler', enabled: hasSel, run: () => ui.openDialog('position') });
  add({ id: 'slides.formatPane', label: 'Formato de forma', icon: 'paintbucket', checked: () => c.pane === 'format', run: () => ((c.pane = c.pane === 'format' ? 'none' : 'format'), c.touch()) });

  // ---- pictures
  const onePic = () => c.selected.length === 1 && c.selected[0]!.kind === 'pic';
  const picNat = (src: string) => imageDims(c.urls.url(src));
  add({ id: 'slides.pic.crop', label: 'Recortar', icon: 'crop', enabled: onePic, checked: () => !!c.cropPic, run: () => ((c.cropping = c.cropPic ? null : c.selection[0] ?? null), c.touch()) });
  for (const [id, mode, label] of [['slides.pic.fill', 'fill', 'Rellenar'], ['slides.pic.fit', 'fit', 'Ajustar']] as const) {
    add({ id, label, icon: 'crop', enabled: onePic, run: () => { const p = c.selected[0]; if (p?.kind !== 'pic') return; const n = picNat(p.src); const x = c.xfrmOf(p); c.patch([p.id], label, (e) => ({ ...(e as typeof p), srcRect: fitCrop(x, n.w, n.h, mode) })); } });
  }
  add({
    id: 'slides.pic.reset',
    label: 'Restablecer imagen',
    icon: 'reset',
    enabled: () => c.selected.some((e) => e.kind === 'pic'),
    run: () => {
      c.cropping = null;
      c.patch(c.selected.filter((e) => e.kind === 'pic').map((e) => e.id), 'Restablecer imagen', (e) => {
        const p = e as typeof e & { kind: 'pic'; src: string };
        const n = picNat(p.src);
        const x = c.xfrmOf(p);
        const { srcRect, adjust, geom, ln, effects, ...rest } = p as never as Record<string, unknown>;
        void srcRect; void adjust; void geom; void ln; void effects;
        return { ...rest, xfrm: { ...x, h: (x.w * n.h) / n.w } } as never;
      });
    },
  });
  add({ id: 'slides.pic.change', label: 'Cambiar imagen…', icon: 'image', enabled: onePic, run: () => { const id = c.selection[0]!; void ui.pickAsset('image').then((a) => a && c.patch([id], 'Cambiar imagen', (e) => ({ ...e, src: a }) as typeof e)); } });
  add({ id: 'slides.pic.corrections', label: 'Correcciones de imagen…', icon: 'contrast', enabled: () => c.selected.some((e) => e.kind === 'pic'), run: () => ui.openDialog('pictureCorrections') });

  // ---- tables
  const tbl = () => c.table;
  const hasCells = () => !!c.cellSelection;
  const rangeOf = (): CellRange => c.cellSelection?.range ?? { r1: 0, c1: 0, r2: (c.table?.rows.length ?? 1) - 1, c2: (c.table?.cols.length ?? 1) - 1 };
  const flags: [string, 'firstRow' | 'lastRow' | 'bandRow' | 'firstCol' | 'lastCol' | 'bandCol', string][] = [
    ['slides.table.firstRow', 'firstRow', 'Fila de encabezado'],
    ['slides.table.lastRow', 'lastRow', 'Fila de totales'],
    ['slides.table.bandRow', 'bandRow', 'Filas con bandas'],
    ['slides.table.firstCol', 'firstCol', 'Primera columna'],
    ['slides.table.lastCol', 'lastCol', 'Última columna'],
    ['slides.table.bandCol', 'bandCol', 'Columnas con bandas'],
  ];
  for (const [id, key, label] of flags) add({ id, label, icon: 'tableGrid', enabled: () => !!tbl(), checked: () => !!tbl()?.[key], run: () => c.tableApply(label, (t) => ({ ...t, [key]: !t[key] })) });
  add({ id: 'slides.table.rowAbove', label: 'Insertar arriba', icon: 'rowAbove', enabled: hasCells, run: () => { const rg = rangeOf(); c.tableApply('Insertar fila', (t) => insertRows(t, rg.r1, 1, rg.r1), (t) => [rg.r1, 0, rg.r1, t.cols.length - 1]); } });
  add({ id: 'slides.table.rowBelow', label: 'Insertar debajo', icon: 'rowBelow', enabled: hasCells, run: () => { const rg = rangeOf(); c.tableApply('Insertar fila', (t) => insertRows(t, rg.r2 + 1, 1, rg.r2), (t) => [rg.r2 + 1, 0, rg.r2 + 1, t.cols.length - 1]); } });
  add({ id: 'slides.table.colLeft', label: 'Insertar a la izquierda', icon: 'colLeft', enabled: hasCells, run: () => { const rg = rangeOf(); c.tableApply('Insertar columna', (t) => insertCols(t, rg.c1, 1, rg.c1), (t) => [0, rg.c1, t.rows.length - 1, rg.c1]); } });
  add({ id: 'slides.table.colRight', label: 'Insertar a la derecha', icon: 'colRight', enabled: hasCells, run: () => { const rg = rangeOf(); c.tableApply('Insertar columna', (t) => insertCols(t, rg.c2 + 1, 1, rg.c2), (t) => [0, rg.c2 + 1, t.rows.length - 1, rg.c2 + 1]); } });
  add({ id: 'slides.table.deleteRows', label: 'Eliminar filas', icon: 'rows', enabled: hasCells, run: () => { const rg = rangeOf(); c.tableApply('Eliminar filas', (t) => deleteRows(t, rg.r1, rg.r2), (t) => { const r = Math.min(rg.r1, t.rows.length - 1); return [r, 0, r, t.cols.length - 1]; }); } });
  add({ id: 'slides.table.deleteCols', label: 'Eliminar columnas', icon: 'columns', enabled: hasCells, run: () => { const rg = rangeOf(); c.tableApply('Eliminar columnas', (t) => deleteCols(t, rg.c1, rg.c2), (t) => { const k = Math.min(rg.c1, t.cols.length - 1); return [0, k, t.rows.length - 1, k]; }); } });
  add({ id: 'slides.table.delete', label: 'Eliminar tabla', icon: 'trash', enabled: () => !!tbl(), run: () => c.tableApply('Eliminar tabla', () => null) });
  add({ id: 'slides.table.merge', label: 'Combinar celdas', icon: 'mergeCells', enabled: () => !!tbl() && !!c.cellSelection && cellsOf(tbl()!, c.cellSelection.range).length > 1, run: () => { const rg = rangeOf(); c.tableApply('Combinar celdas', (t) => mergeCells(t, rg), () => [rg.r1, rg.c1, rg.r1, rg.c1]); } });
  add({ id: 'slides.table.split', label: 'Dividir celdas…', icon: 'splitCells', enabled: hasCells, run: () => ui.openDialog('tableSplit') });
  add({ id: 'slides.table.distRows', label: 'Distribuir filas', icon: 'rows', enabled: () => !!tbl(), run: () => { const rg = rangeOf(); const one = rg.r1 === rg.r2; c.tableApply('Distribuir filas', (t) => distributeRows(t, one ? 0 : rg.r1, one ? t.rows.length - 1 : rg.r2)); } });
  add({ id: 'slides.table.distCols', label: 'Distribuir columnas', icon: 'columns', enabled: () => !!tbl(), run: () => { const rg = rangeOf(); const one = rg.c1 === rg.c2; c.tableApply('Distribuir columnas', (t) => distributeCols(t, one ? 0 : rg.c1, one ? t.cols.length - 1 : rg.c2)); } });
  const anchorOf = () => (tbl() ? (cellsOf(tbl()!, rangeOf())[0]?.cell.anchor ?? 't') : 't');
  for (const [id, a, label, icon] of [['slides.table.anchorTop', 't', 'Alinear arriba', 'anchorTop'], ['slides.table.anchorMiddle', 'ctr', 'Centrar verticalmente', 'anchorMiddle'], ['slides.table.anchorBottom', 'b', 'Alinear abajo', 'anchorBottom']] as const) {
    add({ id, label, icon, enabled: () => !!tbl(), checked: () => anchorOf() === a, run: () => c.tableApply(label, (t, rg) => mapCells(t, rg, (cell) => ({ ...cell, anchor: a }))) });
  }
  add({ id: 'slides.table.cellOptions', label: 'Opciones de celda…', icon: 'tableGrid', enabled: () => !!tbl(), run: () => ui.openDialog('tableCell') });
  add({ id: 'slides.table.size', label: 'Tamaño de celda…', icon: 'ruler', enabled: () => !!tbl(), run: () => ui.openDialog('tableSize') });

  // ---- insert
  add({ id: 'slides.insert.textbox', label: 'Cuadro de texto', icon: 'textbox', checked: () => c.tool.kind === 'text', run: () => c.setTool(c.tool.kind === 'text' ? { kind: 'select' } : { kind: 'text' }) });
  add({ id: 'slides.insert.picture', label: 'Imagen…', icon: 'image', run: () => ui.insertPicture() });
  add({ id: 'slides.insert.video', label: 'Vídeo…', icon: 'video', run: () => ui.insertMedia('video') });
  add({ id: 'slides.insert.audio', label: 'Audio…', icon: 'volume', run: () => ui.insertMedia('audio') });
  add({ id: 'slides.insert.table', label: 'Tabla…', icon: 'tableGrid', run: () => ui.openDialog('table') });
  add({ id: 'slides.insert.chart', label: 'Gráfico…', icon: 'chart', run: () => ui.openDialog('chart') });
  add({ id: 'slides.chart.edit', label: 'Editar datos y tipo del gráfico…', icon: 'chart', enabled: () => c.selected.length === 1 && c.selected[0]!.kind === 'chart', run: () => ui.openDialog('chart', c.selection[0]) });
  add({ id: 'slides.insert.smartart', label: 'SmartArt…', icon: 'smartart', run: () => ui.openDialog('smartArt') });
  add({ id: 'slides.insert.wordart', label: 'WordArt (NovaArt)…', icon: 'wordart', run: () => ui.openDialog('wordArt') });
  add({ id: 'slides.insert.hyperlink', label: 'Hipervínculo…', icon: 'link', shortcut: 'Ctrl+K', enabled: () => text() || hasSel(), run: () => ui.openDialog('hyperlink') });
  add({ id: 'slides.insert.headerFooter', label: 'Encabezado y pie de página…', icon: 'panelTop', run: () => ui.openDialog('headerFooter') });
  add({ id: 'slides.insert.comment', label: 'Comentario nuevo…', icon: 'comment', run: () => ui.openDialog('comment') });
  add({ id: 'slides.insert.equation', label: 'Ecuación…', icon: 'sigma', run: () => ui.openDialog('equation') });

  // ---- design, show, review, view
  add({ id: 'slides.design.themes', label: 'Temas y plantillas…', icon: 'palette', run: () => ui.openDialog('themes') });
  add({ id: 'slides.design.background', label: 'Formato del fondo…', icon: 'paintbucket', run: () => ui.openDialog('background') });
  add({ id: 'slides.show.start', label: 'Desde el principio', icon: 'play', shortcut: 'F5', run: () => ui.present('start') });
  add({ id: 'slides.show.current', label: 'Desde la diapositiva actual', icon: 'play', shortcut: 'Shift+F5', run: () => ui.present('current') });
  add({ id: 'slides.show.presenter', label: 'Vista de moderador (dos pantallas)', icon: 'monitor', run: () => ui.present('start', { presenter: true }) });
  add({ id: 'slides.show.rehearse', label: 'Ensayar intervalos', icon: 'timer', run: () => ui.present('start', { rehearse: true }) });
  add({ id: 'slides.show.setup', label: 'Configurar la presentación…', icon: 'settings', run: () => ui.openDialog('setupShow') });
  add({ id: 'slides.sections', label: 'Secciones…', icon: 'folder', run: () => ui.openDialog('sections') });
  add({ id: 'slides.trans.preview', label: 'Vista previa de la transición', icon: 'play', run: () => ui.present('current', { preview: 'transition' }) });
  add({ id: 'slides.trans.applyAll', label: 'Aplicar a todas las diapositivas', icon: 'copy', enabled: () => !!c.slide.transition, run: () => transitionToAll(c) });
  add({ id: 'slides.anim.preview', label: 'Vista previa de las animaciones', icon: 'play', enabled: () => effectsOf(c.slide).length > 0, run: () => ui.present('current', { preview: 'animation' }) });
  add({ id: 'slides.anim.pane', label: 'Panel de animación', icon: 'animOrder', checked: () => c.pane === 'animations', run: () => ((c.pane = c.pane === 'animations' ? 'none' : 'animations'), c.touch()) });
  add({ id: 'slides.anim.remove', label: 'Quitar la animación', icon: 'trash', enabled: () => !!c.selEffect && effectsOf(c.slide).some((e) => e.id === c.selEffect), run: () => c.selEffect && removeEffect(c, c.selEffect) });
  add({ id: 'slides.anim.earlier', label: 'Mover antes', icon: 'moveUp', enabled: () => !!c.selEffect, run: () => c.selEffect && moveEffect(c, c.selEffect, -1) });
  add({ id: 'slides.anim.later', label: 'Mover después', icon: 'moveDown', enabled: () => !!c.selEffect, run: () => c.selEffect && moveEffect(c, c.selEffect, 1) });
  add({ id: 'slides.show.custom', label: 'Presentaciones personalizadas…', icon: 'list', run: () => ui.openDialog('customShows') });
  add({ id: 'slides.review.spelling', label: 'Revisar ortografía', icon: 'spell', shortcut: 'F7', run: () => ui.openDialog('spelling') });
  add({ id: 'slides.review.find', label: 'Buscar y reemplazar…', icon: 'search', shortcut: 'Ctrl+F', run: () => ui.openDialog('findReplace') });
  add({ id: 'slides.review.comments', label: 'Panel de comentarios', icon: 'comment', checked: () => c.pane === 'comments', run: () => ((c.pane = c.pane === 'comments' ? 'none' : 'comments'), c.touch()) });
  const views: [string, 'normal' | 'sorter' | 'reading' | 'outline' | 'master' | 'notes', string, string][] = [
    ['slides.view.normal', 'normal', 'Normal', 'layout'],
    ['slides.view.outline', 'outline', 'Esquema', 'list'],
    ['slides.view.sorter', 'sorter', 'Clasificador de diapositivas', 'gridlines'],
    ['slides.view.notes', 'notes', 'Página de notas', 'notes'],
    ['slides.view.reading', 'reading', 'Vista de lectura', 'book'],
    ['slides.view.master', 'master', 'Patrón de diapositivas', 'layout'],
  ];
  for (const [id, v, label, icon] of views) add({ id, label, icon, checked: () => c.view === v, run: () => c.setView(v) });
  // ---- freeforms and edit points
  for (const [id, mode, label, icon] of [['slides.draw.polygon', 'polygon', 'Forma libre: forma', 'freeform'], ['slides.draw.curve', 'curve', 'Forma libre: curva', 'curve'], ['slides.draw.scribble', 'scribble', 'Forma libre: garabato', 'pencil']] as const) {
    add({ id, label, icon, checked: () => c.tool.kind === 'freeform' && c.tool.mode === mode, run: () => c.setTool(c.tool.kind === 'freeform' && c.tool.mode === mode ? { kind: 'select' } : { kind: 'freeform', mode }) });
  }
  const oneShape = () => c.selection.length === 1 && c.selected[0]?.kind === 'shape';
  const pts = () => !!c.editPoints && !!c.editPt;
  add({ id: 'slides.editPoints', label: 'Modificar puntos', icon: 'freeform', enabled: oneShape, checked: () => !!c.editPoints, run: () => (c.editPoints ? (c.leavePoints(), c.touch()) : c.startPoints()) });
  add({
    id: 'slides.points.delete',
    label: 'Eliminar punto',
    icon: 'trash',
    enabled: pts,
    run: () => c.pointOp('Eliminar punto', (p, s) => ({ paths: deleteNode(p, s.si, s.ni), sel: null })),
  });
  for (const [id, kind, label] of [['slides.points.corner', 'corner', 'Punto de esquina'], ['slides.points.smooth', 'smooth', 'Punto suave'], ['slides.points.symmetric', 'symmetric', 'Punto simétrico']] as [string, NodeKind, string][]) {
    add({ id, label, icon: 'freeform', enabled: pts, run: () => c.pointOp(label, (p, s) => ({ paths: setNodeKind(p, s.si, s.ni, kind) })) });
  }
  add({ id: 'slides.points.line', label: 'Segmento recto', icon: 'freeform', enabled: pts, run: () => c.pointOp('Segmento recto', (p, s) => ({ paths: setSegmentKind(p, s.si, Math.min(s.ni, Math.max(0, segmentCount(p[s.si]!) - 1)), 'line') })) });
  add({ id: 'slides.points.curve', label: 'Segmento curvo', icon: 'curve', enabled: pts, run: () => c.pointOp('Segmento curvo', (p, s) => ({ paths: setSegmentKind(p, s.si, Math.min(s.ni, Math.max(0, segmentCount(p[s.si]!) - 1)), 'curve') })) });
  add({ id: 'slides.points.close', label: 'Cerrar o abrir el trazado', icon: 'freeform', enabled: () => !!c.editPoints, run: () => c.pointOp('Cerrar o abrir el trazado', (p, s) => ({ paths: toggleClosed(p, s.si) })) });
  void addNodeAt;
  // ---- slide master view
  const inM = () => c.inMaster;
  const tg = () => c.masterTarget;
  const isLayout = () => inM() && tg()?.kind === 'layout';
  add({ id: 'slides.master.close', label: 'Cerrar la vista Patrón', icon: 'close', enabled: inM, run: () => c.setView('normal') });
  add({
    id: 'slides.master.addLayout',
    label: 'Insertar diseño',
    icon: 'layout',
    enabled: inM,
    run: () => {
      const mid = c.masterIdOfTarget!;
      let id = '';
      c.applyReal('Insertar diseño', (d) => {
        const r = addLayout(d, mid, 'Diseño personalizado', tg()?.kind === 'layout' ? tg()!.id : undefined);
        id = r.id;
        return r.deck;
      });
      if (id) c.setMasterTarget({ kind: 'layout', id });
    },
  });
  add({
    id: 'slides.master.duplicate',
    label: 'Duplicar',
    icon: 'copy',
    enabled: inM,
    run: () => {
      const t = tg()!;
      let id = '';
      c.applyReal(t.kind === 'layout' ? 'Duplicar el diseño' : 'Insertar patrón', (d) => {
        const r = t.kind === 'layout' ? duplicateLayout(d, t.id) : duplicateMaster(d, t.id);
        id = r.id;
        return r.deck;
      });
      if (id) c.setMasterTarget(t.kind === 'layout' ? { kind: 'layout', id } : { kind: 'master', id });
    },
  });
  add({
    id: 'slides.master.delete',
    label: 'Eliminar',
    icon: 'trash',
    enabled: inM,
    run: () => {
      const t = tg()!;
      const before = c.realDeck;
      if (t.kind === 'layout') {
        const m = before.masters.find((x) => x.id === c.masterIdOfTarget)!;
        const i = m.layoutIds.indexOf(t.id);
        const next = m.layoutIds[i + 1] ?? m.layoutIds[i - 1];
        c.applyReal('Eliminar el diseño', (d) => deleteLayout(d, t.id).deck, next ? { kind: 'layout', id: next } : undefined);
        if (c.realDeck === before) c.say('Un patrón necesita al menos un diseño.');
      } else {
        c.applyReal('Eliminar el patrón', (d) => deleteMaster(d, t.id), undefined);
        if (c.realDeck === before) c.say('La presentación necesita al menos un patrón.');
      }
    },
  });
  add({ id: 'slides.master.properties', label: 'Cambiar nombre y opciones…', icon: 'pencil', enabled: inM, run: () => ui.openDialog('masterLayout') });
  add({ id: 'slides.master.up', label: 'Subir el diseño', icon: 'chevronUp', enabled: isLayout, run: () => c.applyReal('Mover el diseño', (d) => moveLayout(d, tg()!.id, -1)) });
  add({ id: 'slides.master.down', label: 'Bajar el diseño', icon: 'chevronDown', enabled: isLayout, run: () => c.applyReal('Mover el diseño', (d) => moveLayout(d, tg()!.id, 1)) });
  add({
    id: 'slides.master.hideBg',
    label: 'Ocultar los gráficos de fondo',
    icon: 'eyeOff',
    enabled: isLayout,
    checked: () => isLayout() && c.slide.showMasterSp === false,
    run: () => c.apply('Gráficos de fondo', (d) => ({ ...d, slides: [{ ...d.slides[0]!, showMasterSp: d.slides[0]!.showMasterSp === false ? true : false }] })),
  });
  const PH: [PhType, string][] = [['obj', 'Contenido'], ['body', 'Texto'], ['pic', 'Imagen'], ['chart', 'Gráfico'], ['tbl', 'Tabla'], ['media', 'Multimedia'], ['dgm', 'SmartArt']];
  for (const [kind, label] of PH) {
    add({
      id: `slides.master.ph.${kind}`,
      label: `Marcador de posición: ${label}`,
      icon: 'textbox',
      enabled: isLayout,
      run: () => c.addElement(newPlaceholder(c.realDeck, c.masterIdOfTarget!, kind)),
    });
  }
  add({ id: 'slides.view.grid', label: 'Cuadrícula', icon: 'gridlines', checked: () => c.showGrid, run: () => ((c.showGrid = !c.showGrid), c.touch()) });
  add({ id: 'slides.view.guides', label: 'Guías', icon: 'ruler', checked: () => c.showGuides, run: () => ((c.showGuides = !c.showGuides), c.touch()) });
  add({ id: 'slides.view.ruler', label: 'Reglas', icon: 'ruler', checked: () => c.showRuler, run: () => ((c.showRuler = !c.showRuler), c.touch()) });
  add({ id: 'slides.view.clearGuides', label: 'Quitar todas las guías', icon: 'trash', enabled: () => !!c.deck.guides?.length, run: () => c.apply('Quitar las guías', (d) => ({ ...d, guides: [] })) });
  add({ id: 'slides.view.addGuideV', label: 'Agregar guía vertical', icon: 'ruler', run: () => addGuide(c, 'v') });
  add({ id: 'slides.view.addGuideH', label: 'Agregar guía horizontal', icon: 'ruler', run: () => addGuide(c, 'h') });
  add({ id: 'slides.view.snap', label: 'Ajustar a la cuadrícula y a las guías', icon: 'magnet', checked: () => c.snap, run: () => ((c.snap = !c.snap), c.touch()) });
  add({ id: 'slides.view.notesPane', label: 'Notas', icon: 'notes', checked: () => c.showNotes, run: () => ((c.showNotes = !c.showNotes), c.touch()) });
  add({ id: 'slides.view.fit', label: 'Ajustar a la ventana', icon: 'fit', run: () => ((c.zoom = 0), c.touch()) });
  return defs;
}

function rot(c: SlidesCtl, e: import('@suitenova/slides-core').SlideElement, deg: number) {
  const x = c.xfrmOf(e);
  return { ...e, xfrm: { ...x, rot: (((x.rot ?? 0) + deg) % 360 + 360) % 360 } } as typeof e;
}

function addGuide(c: SlidesCtl, orient: 'h' | 'v'): void {
  const pos = orient === 'v' ? c.deck.size.w / 2 : c.deck.size.h / 2;
  c.apply('Agregar guía', (d) => ({ ...d, guides: [...(d.guides ?? []), { id: `g${Date.now().toString(36)}`, orient, pos }] }));
}

/** Paints the format held by the format painter onto objects: look first, then the text. */
export function pasteFormat(c: SlidesCtl, ids: string[]): void {
  const p = c.painter;
  if (!p) return;
  const fmt = p.fmt;
  c.patch(ids, 'Copiar formato', (el) => ({ ...el, ...fmt, xfrm: (el as { xfrm?: unknown }).xfrm }) as typeof el);
  if (p.text) applyTextFormat(c, ids.filter((id) => { const k = c.element(id)?.kind; return k === 'shape' || k === 'table'; }), p.text);
}
