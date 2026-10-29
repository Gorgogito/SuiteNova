import type { CommandDef } from '@suitenova/core-ui';
import { markTypes } from '@suitenova/writer-core';
import { redoDepth, redo, undo, undoDepth } from 'prosemirror-history';
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow, deleteTable, isInTable, mergeCells, splitCell } from 'prosemirror-tables';
import type { NotesCtl } from './ctl';
import { FONT_SIZES, changeIndent, clearFormatting, listAncestor, markActive, markAttr, selectionParagraph, setAlign, setMark, setStyle, toggleList, toggleMarkByName, selectAll } from './editing';
import { BUILTIN_TAGS } from '@suitenova/notes-core';

export type NotesDialog = 'link' | 'table' | 'tags' | 'about' | 'shortcuts' | 'templates' | 'style' | 'versions' | 'trash' | 'protectPage' | 'protectSection' | 'share' | 'equation' | 'image' | 'email';

export interface NotesUI {
  ctl: NotesCtl;
  openDialog(kind: NotesDialog, arg?: unknown): void;
  getZoom(): number;
  setZoom(z: number): void;
  newWindow(): void;
  open(): Promise<void>;
  save(saveAs: boolean): Promise<void>;
  importFile(): Promise<void>;
  exportPage(kind: 'md' | 'html' | 'docx'): Promise<void>;
  insertImage(): void;
  insertMediaFile(): void;
  /** Empieza o termina una grabación de audio o de vídeo. */
  toggleRecording(kind: 'audio' | 'video'): void;
  recording(): 'audio' | 'video' | null;
  runOcr(): void;
  ocrLang(): string;
  setOcrLang(l: string): void;
  mergeFile(): Promise<void>;
  focusSearch(): void;
  close(): void;
}

export const FONT_NAMES = ['Calibri', 'Arial', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Verdana'];
/** Atajos de las tres primeras etiquetas (como en OneNote: Ctrl+1, 2, 3). */
export const TAG_SHORTCUTS: Record<string, string> = { todo: 'Ctrl+1', important: 'Ctrl+2', question: 'Ctrl+3' };
export const STYLES: [string, string][] = [
  ['Normal', 'Normal'],
  ['Title', 'Título'],
  ['Heading1', 'Título 1'],
  ['Heading2', 'Título 2'],
  ['Heading3', 'Título 3'],
  ['Quote', 'Cita'],
];
export { FONT_SIZES };

function nextSize(cur: number, up: boolean): number {
  if (up) return FONT_SIZES.find((s) => s > cur) ?? cur + 4;
  return [...FONT_SIZES].reverse().find((s) => s < cur) ?? Math.max(1, cur - 1);
}

export function notesCommands(ui: NotesUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const st = () => c.view?.state ?? null;
  const ready = () => !!c.view;

  // ---- file
  add({ id: 'notes.new', label: 'Libreta nueva', icon: 'new', shortcut: 'Ctrl+N', run: () => ui.newWindow() });
  add({ id: 'notes.open', label: 'Abrir…', icon: 'open', shortcut: 'Ctrl+O', run: () => void ui.open() });
  add({ id: 'notes.save', label: 'Guardar', icon: 'save', shortcut: 'Ctrl+S', description: 'Guarda la libreta como archivo de Nova Notes (.novanotes).', run: () => void ui.save(false) });
  add({ id: 'notes.saveAs', label: 'Guardar como…', icon: 'save', shortcut: 'Ctrl+Shift+S', run: () => void ui.save(true) });
  add({ id: 'notes.import', label: 'Importar página (Word, texto, HTML)…', icon: 'open', run: () => void ui.importFile() });
  add({ id: 'notes.export.md', label: 'Exportar página como Markdown…', icon: 'exportFile', run: () => void ui.exportPage('md') });
  add({ id: 'notes.export.html', label: 'Exportar página como página web…', icon: 'exportFile', run: () => void ui.exportPage('html') });
  add({ id: 'notes.export.docx', label: 'Exportar página como Word (.docx)…', icon: 'exportFile', run: () => void ui.exportPage('docx') });
  add({ id: 'notes.about', label: 'Acerca de Nova Notes', icon: 'info', run: () => ui.openDialog('about') });
  add({ id: 'help.shortcuts', label: 'Atajos de teclado', icon: 'keyboard', run: () => ui.openDialog('shortcuts') });

  // ---- edit
  add({ id: 'notes.undo', label: 'Deshacer', icon: 'undo', shortcut: 'Ctrl+Z', enabled: () => (!!st() && undoDepth(st()!) > 0) || c.canUndoPage, run: () => (c.view && c.view.hasFocus() && undoDepth(c.view.state) > 0 ? c.run(undo) : c.undoPage()) });
  add({ id: 'notes.redo', label: 'Rehacer', icon: 'redo', shortcut: ['Ctrl+Y', 'Ctrl+Shift+Z'], enabled: () => (!!st() && redoDepth(st()!) > 0) || c.canRedoPage, run: () => (c.view && c.view.hasFocus() && redoDepth(c.view.state) > 0 ? c.run(redo) : c.redoPage()) });
  add({ id: 'notes.cut', label: 'Cortar', icon: 'cut', hint: 'Ctrl+X', enabled: () => !!st() && !st()!.selection.empty, run: () => { c.focusEditor(); document.execCommand('cut'); } });
  add({ id: 'notes.copy', label: 'Copiar', icon: 'copy', hint: 'Ctrl+C', enabled: () => !!st() && !st()!.selection.empty, run: () => { c.focusEditor(); document.execCommand('copy'); } });
  add({
    id: 'notes.paste',
    label: 'Pegar',
    icon: 'paste',
    hint: 'Ctrl+V',
    enabled: ready,
    run: () => {
      void (async () => {
        const v = c.view;
        if (!v) return;
        try {
          for (const it of await navigator.clipboard.read()) {
            if (it.types.includes('text/html')) {
              v.pasteHTML(await (await it.getType('text/html')).text());
              v.focus();
              return;
            }
          }
          v.pasteText(await navigator.clipboard.readText());
        } catch {
          window.alert('El navegador no permite leer el portapapeles desde el botón. Usa Ctrl+V.');
        }
        v.focus();
      })();
    },
  });
  add({ id: 'notes.selectAll', label: 'Seleccionar todo', hint: 'Ctrl+A', run: () => c.run(selectAll) });

  // ---- text
  const toggles: [string, string, string, string, string][] = [
    ['notes.bold', 'strong', 'Negrita', 'bold', 'Ctrl+B'],
    ['notes.italic', 'em', 'Cursiva', 'italic', 'Ctrl+I'],
    ['notes.underline', 'underline', 'Subrayado', 'underline', 'Ctrl+U'],
    ['notes.strike', 'strike', 'Tachado', 'strike', 'Ctrl+5'],
    ['notes.superscript', 'superscript', 'Superíndice', 'superscript', 'Ctrl+Shift++'],
    ['notes.subscript', 'subscript', 'Subíndice', 'subscript', 'Ctrl+='],
  ];
  for (const [id, mark, label, icon, sc] of toggles) add({ id, label, icon, shortcut: sc, enabled: ready, checked: () => !!st() && markActive(st()!, markTypes[mark]!), run: () => c.run(toggleMarkByName(mark)) });
  const curSize = () => (st() && (markAttr(st()!, markTypes.fontSize!, 'value') as number | undefined)) || 11;
  add({ id: 'notes.fontGrow', label: 'Aumentar tamaño de fuente', icon: 'plus', shortcut: 'Ctrl+Shift+>', enabled: ready, run: () => c.run(setMark(markTypes.fontSize!, { value: nextSize(curSize(), true) })) });
  add({ id: 'notes.fontShrink', label: 'Disminuir tamaño de fuente', icon: 'minus', shortcut: 'Ctrl+Shift+<', enabled: ready, run: () => c.run(setMark(markTypes.fontSize!, { value: nextSize(curSize(), false) })) });
  add({ id: 'notes.clearFormat', label: 'Borrar formato', icon: 'eraser', shortcut: 'Ctrl+Space', enabled: ready, run: () => c.run(clearFormatting()) });
  const aligns: [string, 'left' | 'center' | 'right', string, string, string][] = [
    ['notes.alignLeft', 'left', 'Alinear a la izquierda', 'alignLeft', 'Ctrl+L'],
    ['notes.alignCenter', 'center', 'Centrar', 'alignCenter', ''],
    ['notes.alignRight', 'right', 'Alinear a la derecha', 'alignRight', 'Ctrl+R'],
  ];
  for (const [id, a, label, icon, sc] of aligns) add({ id, label, icon, shortcut: sc || undefined, enabled: ready, checked: () => !!st() && (selectionParagraph(st()!)?.attrs.align ?? 'left') === a, run: () => c.run(setAlign(a)) });
  add({ id: 'notes.indentMore', label: 'Aumentar sangría', icon: 'indentMore', shortcut: 'Ctrl+M', enabled: ready, run: () => c.run(changeIndent(36)) });
  add({ id: 'notes.indentLess', label: 'Disminuir sangría', icon: 'indentLess', shortcut: 'Ctrl+Shift+M', enabled: ready, run: () => c.run(changeIndent(-36)) });
  add({ id: 'notes.bullets', label: 'Viñetas', icon: 'list', shortcut: 'Ctrl+.', enabled: ready, checked: () => !!st() && listAncestor(st()!)?.node.type.name === 'bullet_list', run: () => c.run(toggleList('bullet')) });
  add({ id: 'notes.numbering', label: 'Numeración', icon: 'listOrdered', shortcut: 'Ctrl+/', enabled: ready, checked: () => !!st() && listAncestor(st()!)?.node.type.name === 'ordered_list', run: () => c.run(toggleList('ordered', 'decimal')) });
  for (const [id, label] of STYLES) add({ id: `notes.style.${id}`, label, icon: 'document', enabled: ready, checked: () => !!st() && (selectionParagraph(st()!)?.attrs.style ?? 'Normal') === id, run: () => c.run(setStyle(id)) });

  // ---- tags
  for (const d of BUILTIN_TAGS) add({ id: `notes.tag.${d.id}`, label: `Etiqueta: ${d.label}`, icon: d.checkbox ? 'checkSquare' : 'star', shortcut: TAG_SHORTCUTS[d.id], enabled: ready, checked: () => c.currentTag() === d.id, run: () => c.setTag(d.id) });
  add({ id: 'notes.tag.clear', label: 'Quitar etiqueta', icon: 'eraser', enabled: () => c.currentTag() !== null, run: () => c.setTag(null) });
  add({ id: 'notes.tag.summary', label: 'Resumen de etiquetas…', icon: 'list', run: () => ui.openDialog('tags') });

  // ---- insert
  add({ id: 'notes.table', label: 'Tabla…', icon: 'tableGrid', run: () => ui.openDialog('table') });
  add({ id: 'notes.image', label: 'Imagen…', icon: 'image', run: () => ui.insertImage() });
  add({ id: 'notes.textbox', label: 'Cuadro de texto', icon: 'document', description: 'Coloca un cuadro de texto en un lugar libre de la página.', run: () => c.addTextBoxFree() });
  add({ id: 'notes.media.file', label: 'Audio o vídeo desde un archivo…', icon: 'open', run: () => ui.insertMediaFile() });
  add({ id: 'notes.audio', label: 'Grabar audio', icon: 'mic', checked: () => ui.recording() === 'audio', enabled: () => ui.recording() !== 'video', run: () => ui.toggleRecording('audio') });
  add({ id: 'notes.video', label: 'Grabar vídeo', icon: 'video', checked: () => ui.recording() === 'video', enabled: () => ui.recording() !== 'audio', run: () => ui.toggleRecording('video') });
  add({ id: 'notes.equation', label: 'Ecuación…', icon: 'sigma', run: () => ui.openDialog('equation') });
  add({ id: 'notes.link', label: 'Hipervínculo…', icon: 'link', shortcut: 'Ctrl+K', enabled: ready, run: () => ui.openDialog('link') });
  add({ id: 'notes.date', label: 'Fecha', icon: 'calendar', shortcut: 'Alt+Shift+D', enabled: ready, run: () => c.insertText(new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })) });
  add({ id: 'notes.time', label: 'Hora', icon: 'clock', shortcut: 'Alt+Shift+T', enabled: ready, run: () => c.insertText(new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })) });
  add({ id: 'notes.datetime', label: 'Fecha y hora', icon: 'calendar', enabled: ready, run: () => c.insertText(new Date().toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })) });

  // ---- table
  const inTable = () => !!st() && isInTable(st()!);
  const tcmd = (id: string, label: string, icon: string, cmd: Parameters<NotesCtl['run']>[0]) => add({ id, label, icon, enabled: () => inTable() && !!st() && cmd(st()!), run: () => c.run(cmd) });
  tcmd('notes.table.rowBefore', 'Insertar fila arriba', 'rowAbove', addRowBefore);
  tcmd('notes.table.rowAfter', 'Insertar fila abajo', 'rowBelow', addRowAfter);
  tcmd('notes.table.colBefore', 'Insertar columna a la izquierda', 'colLeft', addColumnBefore);
  tcmd('notes.table.colAfter', 'Insertar columna a la derecha', 'colRight', addColumnAfter);
  tcmd('notes.table.deleteRow', 'Eliminar fila', 'trash', deleteRow);
  tcmd('notes.table.deleteCol', 'Eliminar columna', 'trash', deleteColumn);
  tcmd('notes.table.delete', 'Eliminar tabla', 'trash', deleteTable);
  tcmd('notes.table.merge', 'Combinar celdas', 'mergeCells', mergeCells);
  tcmd('notes.table.split', 'Dividir celda', 'unmergeCells', splitCell);

  // ---- pages and sections
  add({ id: 'notes.page.new', label: 'Página nueva', icon: 'pageNew', shortcut: 'Ctrl+Alt+N', run: () => c.addPage() });
  add({ id: 'notes.page.duplicate', label: 'Duplicar página', icon: 'copy', run: () => c.duplicatePage() });
  add({
    id: 'notes.page.delete',
    label: 'Eliminar página',
    icon: 'trash',
    run: () => {
      if (window.confirm('¿Eliminar esta página? Esta acción no se puede deshacer.')) c.deletePage();
    },
  });
  add({ id: 'notes.page.up', label: 'Mover página hacia arriba', icon: 'moveUp', enabled: () => c.section.pages[0]?.id !== c.pageId, run: () => c.movePage(-1) });
  add({ id: 'notes.page.down', label: 'Mover página hacia abajo', icon: 'moveDown', enabled: () => c.section.pages[c.section.pages.length - 1]?.id !== c.pageId, run: () => c.movePage(1) });
  add({ id: 'notes.section.new', label: 'Sección nueva', icon: 'plus', shortcut: 'Ctrl+T', run: () => c.addSection() });
  add({
    id: 'notes.section.delete',
    label: 'Eliminar sección',
    icon: 'trash',
    enabled: () => c.nb.sections.length > 1,
    run: () => {
      if (window.confirm('¿Eliminar la sección con todas sus páginas? Esta acción no se puede deshacer.')) c.deleteSection();
    },
  });
  add({ id: 'notes.section.left', label: 'Mover sección a la izquierda', icon: 'moveUp', enabled: () => c.nb.sections[0]?.id !== c.sectionId, run: () => c.moveSection(-1) });
  add({ id: 'notes.section.right', label: 'Mover sección a la derecha', icon: 'moveDown', enabled: () => c.nb.sections[c.nb.sections.length - 1]?.id !== c.sectionId, run: () => c.moveSection(1) });

  add({ id: 'notes.page.indent', label: 'Hacer subpágina', icon: 'indentMore', enabled: () => c.canIndent(1), run: () => c.indentPage(1) });
  add({ id: 'notes.page.outdent', label: 'Subir de nivel', icon: 'indentLess', enabled: () => c.canIndent(-1), run: () => c.indentPage(-1) });
  add({ id: 'notes.page.template', label: 'Plantillas de página…', icon: 'layout', run: () => ui.openDialog('templates') });
  add({ id: 'notes.page.style', label: 'Reglas y color de la página…', icon: 'gridlines', run: () => ui.openDialog('style') });
  add({ id: 'notes.page.versions', label: 'Historial de versiones…', icon: 'history', run: () => ui.openDialog('versions') });
  add({ id: 'notes.page.protect', label: 'Contraseña de la página…', icon: 'lock', enabled: () => !c.locked, run: () => ui.openDialog('protectPage') });
  add({ id: 'notes.page.lock', label: 'Bloquear la página', icon: 'lock', enabled: () => !!c.page.protect && !c.page.vault && c.keys.has(c.page.id), run: () => void c.lockCurrent('page') });
  add({ id: 'notes.section.protect', label: 'Contraseña de la sección…', icon: 'lock', enabled: () => !c.section.vault, run: () => ui.openDialog('protectSection') });
  add({ id: 'notes.section.lock', label: 'Bloquear la sección', icon: 'lock', enabled: () => !!c.section.protect && !c.section.vault && c.keys.has(c.section.id), run: () => void c.lockCurrent('section') });
  add({ id: 'notes.lockAll', label: 'Bloquear todo lo protegido', icon: 'lock', run: () => void c.lockAll() });
  add({ id: 'notes.trash', label: 'Papelera…', icon: 'trash', run: () => ui.openDialog('trash') });
  add({ id: 'notes.group.new', label: 'Grupo de secciones nuevo', icon: 'folder', run: () => void c.addGroup() });
  add({ id: 'notes.group.remove', label: 'Deshacer el grupo (las secciones se conservan)', icon: 'folder', enabled: () => !!c.groupId, run: () => c.groupId && c.ungroup(c.groupId) });
  add({ id: 'notes.section.outOfGroup', label: 'Sacar la sección del grupo', icon: 'moveUp', enabled: () => !!c.section.group, run: () => c.moveSectionToGroup(c.nb.groups.find((g) => g.id === c.section.group)?.parent ?? null) });
  add({ id: 'notes.share', label: 'Libreta compartida…', icon: 'share', run: () => ui.openDialog('share') });
  add({ id: 'notes.merge', label: 'Combinar con otro archivo…', icon: 'merge', run: () => void ui.mergeFile() });
  add({ id: 'notes.email', label: 'Enviar la página por correo…', icon: 'mail', enabled: () => !c.locked, run: () => ui.openDialog('email') });

  // ---- dibujo
  const tools: [string, Parameters<NotesCtl['setTool']>[0], string, string][] = [
    ['select', 'select', 'Seleccionar y escribir', 'pointer'],
    ['pen', 'pen', 'Lápiz', 'pen'],
    ['highlighter', 'highlighter', 'Marcador', 'highlighter'],
    ['eraser', 'eraser', 'Borrador', 'eraser'],
    ['lasso', 'lasso', 'Seleccionar tinta (recuadro)', 'lasso'],
    ['line', 'line', 'Línea', 'minus'],
    ['arrow', 'arrow', 'Flecha', 'arrowRight'],
    ['rect', 'rect', 'Rectángulo', 'square'],
    ['ellipse', 'ellipse', 'Elipse', 'circle'],
  ];
  for (const [id, tool, label, icon] of tools) add({ id: `notes.tool.${id}`, label, icon, checked: () => c.tool === tool, run: () => c.setTool(tool) });
  add({ id: 'notes.ink.toShape', label: 'Convertir el trazo en forma', icon: 'shapes', checked: () => c.inkToShape, description: 'Al terminar un trazo, si parece una línea, un rectángulo o una elipse, se sustituye por la forma limpia.', run: () => { c.inkToShape = !c.inkToShape; c.touch(); } });
  add({ id: 'notes.ink.clear', label: 'Borrar toda la tinta de la página', icon: 'trash', enabled: () => c.page.ink.length > 0, run: () => { if (window.confirm('¿Borrar toda la tinta de esta página? Se puede deshacer.')) c.clearInk(); } });
  add({ id: 'notes.box.front', label: 'Traer al frente', icon: 'moveUp', enabled: () => !!c.selectedContainer, run: () => c.selected && c.reorderContainer(c.selected, 'front') });
  add({ id: 'notes.box.back', label: 'Enviar al fondo', icon: 'moveDown', enabled: () => !!c.selectedContainer, run: () => c.selected && c.reorderContainer(c.selected, 'back') });
  add({ id: 'notes.box.delete', label: 'Eliminar el cuadro seleccionado', icon: 'trash', enabled: () => !!c.selectedContainer, run: () => c.selected && c.deleteContainer(c.selected) });
  add({ id: 'notes.image.props', label: 'Texto de la imagen y texto alternativo…', icon: 'image', enabled: () => c.selectedContainer?.kind === 'image', run: () => c.selected && ui.openDialog('image', c.selected) });

  // ---- OCR
  add({ id: 'notes.ocr.run', label: 'Reconocer el texto de las imágenes', icon: 'scanText', description: 'Lee con OCR el texto de las imágenes de la libreta para poder buscarlo.', enabled: () => !c.ocr.running && c.ocrPending > 0, run: () => ui.runOcr() });
  add({ id: 'notes.ocr.stop', label: 'Detener el reconocimiento', icon: 'close', enabled: () => c.ocr.running, run: () => c.stopOcr() });

  // ---- search
  add({ id: 'notes.search', label: 'Buscar en todas las páginas', icon: 'search', shortcut: 'Ctrl+E', run: () => ui.focusSearch() });
  return defs;
}
