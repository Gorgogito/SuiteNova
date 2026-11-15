import type { CommandDef } from '@suitenova/core-ui';
import type { PageSort } from '@suitenova/notes-core';
import { isInTable } from 'prosemirror-tables';
import { changeCase } from '../writer/format-tools';
import type { NotesUI } from './commands';
import { ocrTextFor } from './ocrtext';

/** Órdenes añadidas en la segunda ronda de Nova Notes: organizar, insertar, tinta, revisar y ver. */
export function notesCommands2(ui: NotesUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const open = !c.locked;
  const hasText = () => !!c.view;

  // ---- páginas y secciones
  add({ id: 'notes.page.move', label: 'Mover o copiar la página…', icon: 'folder', enabled: () => !c.page.vault && c.nb.sections.filter((s) => !s.vault).length > 0, run: () => ui.openDialog('movePage') });
  add({ id: 'notes.section.copy', label: 'Copiar la sección', icon: 'copy', enabled: () => !c.section.vault, run: () => c.copySection() });
  add({ id: 'notes.section.merge', label: 'Combinar la sección con otra…', icon: 'merge', enabled: () => !c.section.vault && c.nb.sections.length > 1, run: () => ui.openDialog('mergeSection') });
  const sorts: [PageSort, string][] = [
    ['title', 'Ordenar por título (A-Z)'],
    ['created', 'Ordenar por fecha de creación (antiguas primero)'],
    ['created-desc', 'Ordenar por fecha de creación (nuevas primero)'],
    ['modified', 'Ordenar por fecha de modificación (antiguas primero)'],
    ['modified-desc', 'Ordenar por fecha de modificación (nuevas primero)'],
  ];
  for (const [by, label] of sorts) add({ id: `notes.page.sort.${by}`, label, icon: 'nnSort', enabled: () => !c.section.vault && c.section.pages.length > 1, run: () => c.sortPages(by) });
  add({ id: 'notes.page.copyLink', label: 'Copiar el vínculo a la página', icon: 'link', enabled: () => !c.page.vault, run: () => c.copyPageLink() });
  add({ id: 'notes.link.paste', label: 'Pegar vínculo a la página', icon: 'link', enabled: () => !!c.linkClip && hasText(), run: () => void c.pasteLink() });
  add({ id: 'notes.quickNote', label: 'Nota rápida', icon: 'pageNew', description: 'Crea una página nueva en la sección «Notas rápidas» (que se crea si no existe).', run: () => c.quickNote() });
  add({ id: 'notes.history.recent', label: 'Ediciones recientes…', icon: 'history', run: () => ui.openDialog('recent') });
  add({ id: 'notes.history.unread', label: 'Páginas sin leer…', icon: 'history', run: () => ui.openDialog('unread') });
  add({ id: 'notes.history.markRead', label: 'Marcar todo como leído', icon: 'checkSquare', enabled: () => c.unreadCount > 0, run: () => c.markAllSeen() });

  // ---- insertar
  add({ id: 'notes.file.attach', label: 'Archivo adjunto…', icon: 'nnAttach', enabled: () => open, run: () => ui.insertFile() });
  add({ id: 'notes.space', label: 'Insertar espacio', icon: 'nnSpace', checked: () => c.tool === 'space', description: 'Arrastra hacia abajo desde una línea para hacer sitio entre dos partes de la página; hacia arriba quita el espacio.', enabled: () => open, run: () => c.setTool(c.tool === 'space' ? 'select' : 'space') });
  add({ id: 'notes.screenClip', label: 'Recorte de pantalla…', icon: 'nnScissors', enabled: () => open, run: () => void ui.screenClip() });
  add({ id: 'notes.symbol', label: 'Símbolo…', icon: 'nnOmega', enabled: () => open, run: () => ui.openDialog('symbol') });

  // ---- texto
  add({ id: 'notes.formatPainter', label: 'Copiar formato', icon: 'paintbrush', description: 'Copia el formato del texto y lo aplica a lo próximo que selecciones.', enabled: hasText, checked: () => !!c.painter, run: () => c.toggleFormatPainter() });
  const cases: [Parameters<typeof changeCase>[0], string][] = [
    ['sentence', 'Tipo oración'],
    ['lower', 'minúsculas'],
    ['upper', 'MAYÚSCULAS'],
    ['title', 'Poner en Mayúscula Cada Palabra'],
    ['toggle', 'aLTERNAR mayúsculas'],
  ];
  for (const [m, label] of cases) add({ id: `notes.case.${m}`, label, icon: 'nnCase', enabled: hasText, run: () => c.run(changeCase(m)) });
  add({ id: 'notes.para.up', label: 'Subir el párrafo', icon: 'moveUp', shortcut: 'Alt+Shift+Up', enabled: hasText, run: () => c.moveParagraph(-1) });
  add({ id: 'notes.para.down', label: 'Bajar el párrafo', icon: 'moveDown', shortcut: 'Alt+Shift+Down', enabled: hasText, run: () => c.moveParagraph(1) });
  add({ id: 'notes.image.copyText', label: 'Copiar el texto de la imagen', icon: 'scanText', enabled: () => !!ocrTextFor(c), run: () => void navigator.clipboard?.writeText(ocrTextFor(c) ?? '').then(() => c.say('Texto de la imagen copiado.')) });

  // ---- tabla
  add({ id: 'notes.table.sort', label: 'Ordenar…', icon: 'nnSort', enabled: () => !!c.view && isInTable(c.view.state), run: () => ui.openDialog('tableSort') });
  add({ id: 'notes.table.look', label: 'Aspecto y sombreado…', icon: 'tableGrid', enabled: () => !!c.view && isInTable(c.view.state), run: () => ui.openDialog('tableLook') });

  // ---- dibujo
  add({ id: 'notes.eraser.stroke', label: 'Borrar trazos enteros', icon: 'eraser', checked: () => c.eraserMode === 'stroke', run: () => (c.setEraserMode('stroke'), c.setTool('eraser')) });
  add({ id: 'notes.eraser.point', label: 'Borrar solo el trozo tocado', icon: 'eraser', checked: () => c.eraserMode === 'point', run: () => (c.setEraserMode('point'), c.setTool('eraser')) });
  add({ id: 'notes.ruler', label: 'Regla', icon: 'ruler', checked: () => !!c.ruler, description: 'Muestra una regla en la página. Un trazo hecho junto a su borde queda recto.', run: () => c.toggleRuler() });
  add({ id: 'notes.ink.replay', label: 'Reproducir la tinta', icon: 'nnPlay', enabled: () => c.page.ink.length > 0 && c.replay === null, run: () => c.setReplay(0) });
  add({ id: 'notes.ink.toText', label: 'Tinta a texto…', icon: 'scanText', enabled: () => c.page.ink.some((s) => s.tool === 'pen') && !c.locked, run: () => ui.openDialog('inkText') });
  add({ id: 'notes.ink.duplicate', label: 'Duplicar la tinta seleccionada', icon: 'copy', enabled: () => c.selectedStrokes.length > 0, run: () => c.duplicateSelected() });
  add({ id: 'notes.ink.bigger', label: 'Agrandar la tinta seleccionada', icon: 'zoomIn', enabled: () => c.selectedStrokes.length > 0, run: () => c.scaleSelected(1.25) });
  add({ id: 'notes.ink.smaller', label: 'Reducir la tinta seleccionada', icon: 'zoomOut', enabled: () => c.selectedStrokes.length > 0, run: () => c.scaleSelected(0.8) });
  add({ id: 'notes.ink.applyPen', label: 'Aplicar el lápiz actual a la selección', icon: 'pen', enabled: () => c.selectedStrokes.length > 0, run: () => c.restyleSelected({ color: c.penColor, width: c.penWidth }) });
  add({ id: 'notes.ink.deleteSel', label: 'Borrar la tinta seleccionada', icon: 'trash', enabled: () => c.selectedStrokes.length > 0, run: () => c.deleteSelectedStrokes() });
  add({ id: 'notes.touch', label: 'Dibujar con el dedo', icon: 'pointer', checked: () => c.touchDraw, description: 'Si se desactiva, un dedo desplaza la página y solo dibujan el ratón y el lápiz.', run: () => ((c.touchDraw = !c.touchDraw), c.touch()) });

  // ---- revisar y ver
  add({ id: 'notes.find', label: 'Buscar en esta página…', icon: 'search', shortcut: 'Ctrl+F', enabled: () => open, run: () => ui.openDialog('find') });
  add({ id: 'notes.spell', label: 'Ortografía', icon: 'nnSpell', shortcut: 'F7', enabled: () => open, run: () => ui.openDialog('spell') });
  add({ id: 'notes.count', label: 'Contar palabras', icon: 'nnCount', run: () => ui.openDialog('count') });
  add({ id: 'notes.a11y', label: 'Comprobar accesibilidad', icon: 'nnA11y', run: () => ui.openDialog('a11y') });
  add({ id: 'notes.read', label: 'Lector inmersivo y voz', icon: 'nnSpeaker', enabled: () => open, run: () => ui.openDialog('read') });
  add({ id: 'notes.print', label: 'Imprimir o guardar como PDF…', icon: 'print', shortcut: 'Ctrl+P', enabled: () => open, run: () => ui.print() });
  add({ id: 'notes.view.fullPage', label: 'Página completa', icon: 'nnMax', checked: () => c.fullPage, description: 'Oculta las pestañas de secciones y la lista de páginas para dejar solo la página.', run: () => c.toggleFullPage() });
  add({ id: 'notes.view.hideTitle', label: 'Ocultar el título de la página', icon: 'nnEye', checked: () => c.hideTitle, run: () => c.toggleHideTitle() });
  add({ id: 'notes.view.dock', label: 'Acoplar al escritorio', icon: 'nnPin', checked: () => ui.docked(), description: 'Deja la ventana estrecha, a un lado de la pantalla y siempre visible para escribir mientras trabajas en otra cosa (solo en la aplicación de escritorio).', run: () => void ui.dock() });
  return defs;
}
