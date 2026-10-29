import type { CommandDef } from '@suitenova/core-ui';
import { MARGIN_PRESETS, PAGE_SIZES, contentBox, docFromText, isLandscape, nodeTypes, markTypes, rotatePage, writerSchema, type WriterDoc } from '@suitenova/writer-core';
import type { Command } from 'prosemirror-state';
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow, deleteTable, isInTable, mergeCells, setCellAttr, splitCell } from 'prosemirror-tables';
import { redo, redoDepth, undo, undoDepth } from 'prosemirror-history';
import type { WriterCtl } from './doc';
import { layoutCommands } from './commands-layout';
import { reviewCommands } from './commands-review';
import { refsCommands } from './commands-refs';
import { objectCommands } from './commands-objects';
import { mailCommands } from './commands-mail';
import { spellCommands } from './commands-spell';
import { securityCommands } from './commands-security';
import {
  FONT_SIZES,
  changeIndent,
  clearFormatting,
  createTable,
  insertBlockAfterCursor,
  insertNode,
  insertPageBreak,
  listAncestor,
  markActive,
  markAttr,
  selectAll,
  selectionParagraph,
  setAlign,
  setMark,
  setStyle,
  toggleList,
  toggleMarkByName,
  updateParagraphs,
} from './editing';

export type WriterDialog = 'link' | 'pageSetup' | 'about' | 'shortcuts' | 'tableSize' | 'columns' | 'watermark' | 'protect' | 'unprotect' | 'user' | 'toc' | 'tof' | 'caption' | 'xref' | 'bookmark' | 'indexMark' | 'cite' | 'sources' | 'noteOptions' | 'equation' | 'shape' | 'control' | 'envelope' | 'labels' | 'recipients' | 'mergeField' | 'mergeBlock' | 'mergeRule' | 'finishMerge' | 'templates' | 'spell' | 'userDict' | 'encrypt' | 'sign' | 'signInfo' | 'macros' | 'macroEditor';

export interface WriterUI {
  ctl: WriterCtl;
  openDialog(kind: WriterDialog, arg?: unknown): void;
  openFind(replace: boolean): void;
  getZoom(): number;
  setZoom(z: number): void;
  fitWidth(): void;
  newWindow(): void;
  open(): Promise<void>;
  save(saveAs: boolean): Promise<void>;
  exportTxt(): Promise<void>;
  exportRtf(): Promise<void>;
  exportOdt(): Promise<void>;
  exportHtml(): Promise<void>;
  print(): void;
  saveTemplate(): Promise<void>;
  applyTemplate(doc: WriterDoc): void;
  openTemplateFile(): Promise<void>;
  insertImage(): void;
  close(): void;
}

export const FONT_NAMES = ['Calibri', 'Calibri Light', 'Arial', 'Arial Narrow', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
export const LINE_HEIGHTS = [1, 1.08, 1.15, 1.5, 2, 2.5, 3];
export { FONT_SIZES };

export function nextFontSize(cur: number, up: boolean): number {
  if (up) return FONT_SIZES.find((s) => s > cur) ?? cur + 4;
  return [...FONT_SIZES].reverse().find((s) => s < cur) ?? Math.max(1, cur - 1);
}

/** Every command of Nova Writer. */
export function writerCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const exec = (cmd: Command) => {
    const v = c.view;
    if (!v) return;
    cmd(v.state, v.dispatch, v);
    v.focus();
  };
  const st = () => c.state;
  const inTable = () => !!st() && isInTable(st()!);
  const ready = () => !!c.view;

  // ---- file
  add({ id: 'writer.new', label: 'Documento nuevo', icon: 'new', shortcut: 'Ctrl+N', run: () => ui.newWindow() });
  add({ id: 'writer.newFromTemplate', label: 'Nuevo desde plantilla…', icon: 'template', description: 'Elija una plantilla: carta, informe, factura, currículum…', run: () => ui.openDialog('templates') });
  add({ id: 'writer.saveTemplate', label: 'Guardar como plantilla (.dotx)…', icon: 'save', description: 'Guarda este documento como plantilla de Word para crear otros a partir de él.', run: () => void ui.saveTemplate() });
  add({ id: 'writer.open', label: 'Abrir…', icon: 'open', shortcut: 'Ctrl+O', run: () => void ui.open() });
  add({ id: 'writer.save', label: 'Guardar', icon: 'save', shortcut: 'Ctrl+S', description: 'Guarda el documento como archivo de Word (.docx).', run: () => void ui.save(false) });
  add({ id: 'writer.saveAs', label: 'Guardar como…', icon: 'save', shortcut: 'Ctrl+Shift+S', run: () => void ui.save(true) });
  add({ id: 'writer.exportRtf', label: 'Exportar como RTF (.rtf)…', icon: 'exportFile', run: () => void ui.exportRtf() });
  add({ id: 'writer.exportOdt', label: 'Exportar como OpenDocument (.odt)…', icon: 'exportFile', run: () => void ui.exportOdt() });
  add({ id: 'writer.exportTxt', label: 'Exportar como texto (.txt)…', icon: 'exportFile', run: () => void ui.exportTxt() });
  add({ id: 'writer.exportHtml', label: 'Exportar como página web (.html)…', icon: 'exportFile', run: () => void ui.exportHtml() });
  add({ id: 'writer.print', label: 'Imprimir / guardar como PDF…', icon: 'print', shortcut: 'Ctrl+P', run: () => ui.print() });
  add({ id: 'writer.about', label: 'Acerca de Nova Writer', icon: 'info', run: () => ui.openDialog('about') });
  add({ id: 'help.shortcuts', label: 'Atajos de teclado', icon: 'keyboard', run: () => ui.openDialog('shortcuts') });

  // ---- undo / clipboard
  add({ id: 'writer.undo', label: 'Deshacer', icon: 'undo', shortcut: 'Ctrl+Z', enabled: () => !!st() && undoDepth(st()!) > 0, run: () => exec(undo) });
  add({ id: 'writer.redo', label: 'Rehacer', icon: 'redo', shortcut: ['Ctrl+Y', 'Ctrl+Shift+Z'], enabled: () => !!st() && redoDepth(st()!) > 0, run: () => exec(redo) });
  add({ id: 'writer.cut', label: 'Cortar', icon: 'cut', hint: 'Ctrl+X', enabled: () => !!st() && !st()!.selection.empty, run: () => { c.focus(); document.execCommand('cut'); } });
  add({ id: 'writer.copy', label: 'Copiar', icon: 'copy', hint: 'Ctrl+C', enabled: () => !!st() && !st()!.selection.empty, run: () => { c.focus(); document.execCommand('copy'); } });
  add({
    id: 'writer.paste',
    label: 'Pegar',
    icon: 'paste',
    hint: 'Ctrl+V',
    enabled: ready,
    run: () => {
      void (async () => {
        const v = c.view;
        if (!v) return;
        try {
          const items = await navigator.clipboard.read();
          for (const it of items) {
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
  add({ id: 'writer.pasteText', label: 'Pegar sin formato', icon: 'paste', shortcut: 'Ctrl+Shift+V', enabled: ready, run: () => void navigator.clipboard.readText().then((t) => { c.view?.pasteText(t); c.focus(); }, () => undefined) });
  add({ id: 'writer.selectAll', label: 'Seleccionar todo', hint: 'Ctrl+A', run: () => exec(selectAll) });

  // ---- character formatting
  const toggles: [string, string, string, string, string][] = [
    ['writer.bold', 'strong', 'Negrita', 'bold', 'Ctrl+B'],
    ['writer.italic', 'em', 'Cursiva', 'italic', 'Ctrl+I'],
    ['writer.underline', 'underline', 'Subrayado', 'underline', 'Ctrl+U'],
    ['writer.strike', 'strike', 'Tachado', 'strike', 'Ctrl+5'],
    ['writer.superscript', 'superscript', 'Superíndice', 'superscript', 'Ctrl+Shift++'],
    ['writer.subscript', 'subscript', 'Subíndice', 'subscript', 'Ctrl+='],
  ];
  for (const [id, mark, label, icon, sc] of toggles) {
    add({ id, label, icon, shortcut: sc, enabled: ready, checked: () => !!st() && markActive(st()!, markTypes[mark]!), run: () => exec(toggleMarkByName(mark)) });
  }
  const curSize = () => (st() ? ((markAttr(st()!, markTypes.fontSize!, 'value') as number | undefined) ?? c.defaults.fontSize) : c.defaults.fontSize);
  add({ id: 'writer.fontGrow', label: 'Aumentar tamaño de fuente', icon: 'plus', shortcut: 'Ctrl+Shift+>', enabled: ready, run: () => exec(setMark(markTypes.fontSize!, { value: nextFontSize(curSize(), true) })) });
  add({ id: 'writer.fontShrink', label: 'Disminuir tamaño de fuente', icon: 'minus', shortcut: 'Ctrl+Shift+<', enabled: ready, run: () => exec(setMark(markTypes.fontSize!, { value: nextFontSize(curSize(), false) })) });
  add({ id: 'writer.clearFormat', label: 'Borrar formato', icon: 'eraser', shortcut: 'Ctrl+Space', enabled: ready, run: () => exec(clearFormatting()) });

  // ---- paragraph
  const aligns: [string, 'left' | 'center' | 'right' | 'justify', string, string, string][] = [
    ['writer.alignLeft', 'left', 'Alinear a la izquierda', 'alignLeft', 'Ctrl+L'],
    ['writer.alignCenter', 'center', 'Centrar', 'alignCenter', 'Ctrl+E'],
    ['writer.alignRight', 'right', 'Alinear a la derecha', 'alignRight', 'Ctrl+R'],
    ['writer.alignJustify', 'justify', 'Justificar', 'alignJustify', 'Ctrl+J'],
  ];
  for (const [id, a, label, icon, sc] of aligns) {
    add({ id, label, icon, shortcut: sc, enabled: ready, checked: () => ((selectionParagraph(st()!)?.attrs.align ?? 'left') === a), run: () => exec(setAlign(a)) });
  }
  add({ id: 'writer.indentMore', label: 'Aumentar sangría', icon: 'indentMore', shortcut: 'Ctrl+M', enabled: ready, run: () => exec(changeIndent(36)) });
  add({ id: 'writer.indentLess', label: 'Disminuir sangría', icon: 'indentLess', shortcut: 'Ctrl+Shift+M', enabled: ready, run: () => exec(changeIndent(-36)) });
  add({ id: 'writer.bullets', label: 'Viñetas', icon: 'list', shortcut: 'Ctrl+Shift+L', enabled: ready, checked: () => !!st() && listAncestor(st()!)?.node.type.name === 'bullet_list', run: () => exec(toggleList('bullet')) });
  const fmts: [string, 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman', string][] = [
    ['decimal', 'decimal', '1. 2. 3.'],
    ['lowerLetter', 'lowerLetter', 'a. b. c.'],
    ['upperLetter', 'upperLetter', 'A. B. C.'],
    ['lowerRoman', 'lowerRoman', 'i. ii. iii.'],
    ['upperRoman', 'upperRoman', 'I. II. III.'],
  ];
  add({ id: 'writer.numbering', label: 'Numeración', icon: 'listOrdered', enabled: ready, checked: () => !!st() && listAncestor(st()!)?.node.type.name === 'ordered_list', run: () => exec(toggleList('ordered', 'decimal')) });
  for (const [k, f, lab] of fmts) add({ id: `writer.numbering.${k}`, label: `Numeración ${lab}`, icon: 'listOrdered', enabled: ready, checked: () => { const l = st() && listAncestor(st()!); return !!l && l.node.type.name === 'ordered_list' && l.node.attrs.format === f; }, run: () => exec(toggleList('ordered', f)) });
  for (const lh of LINE_HEIGHTS) add({ id: `writer.lineHeight.${lh}`, label: `Interlineado ${lh.toString().replace('.', ',')}`, icon: 'lineHeight', enabled: ready, checked: () => (selectionParagraph(st()!)?.attrs.lineHeight ?? c.defaults.lineHeight) === lh, run: () => exec(updateParagraphs({ lineHeight: lh })) });
  add({ id: 'writer.spaceBefore', label: 'Agregar espacio antes del párrafo', icon: 'plus', enabled: ready, run: () => exec(updateParagraphs((n) => ({ spaceBefore: n.attrs.spaceBefore ? 0 : 12 }))) });
  add({ id: 'writer.spaceAfter', label: 'Agregar espacio después del párrafo', icon: 'plus', enabled: ready, run: () => exec(updateParagraphs((n) => ({ spaceAfter: (n.attrs.spaceAfter ?? c.defaults.spaceAfter) ? 0 : 8 }))) });
  add({ id: 'writer.keepNext', label: 'Mantener con el siguiente', enabled: ready, checked: () => !!selectionParagraph(st()!)?.attrs.keepNext, run: () => exec(updateParagraphs((n) => ({ keepNext: !n.attrs.keepNext }))) });
  add({ id: 'writer.pageBreakBefore', label: 'Salto de página antes', enabled: ready, checked: () => !!selectionParagraph(st()!)?.attrs.pageBreakBefore, run: () => exec(updateParagraphs((n) => ({ pageBreakBefore: !n.attrs.pageBreakBefore }))) });
  add({ id: 'writer.showMarks', label: 'Mostrar marcas de formato', icon: 'pilcrow', shortcut: 'Ctrl+Shift+8', checked: () => c.showMarks, run: () => { c.showMarks = !c.showMarks; c.touch(); } });

  // ---- insert
  add({ id: 'writer.pageBreak', label: 'Salto de página', icon: 'pageBreak', shortcut: 'Ctrl+Enter', enabled: ready, run: () => exec(insertPageBreak()) });
  add({ id: 'writer.link', label: 'Hipervínculo…', icon: 'link', shortcut: 'Ctrl+K', enabled: ready, run: () => ui.openDialog('link') });
  add({ id: 'writer.unlink', label: 'Quitar hipervínculo', icon: 'unlink', enabled: () => !!st() && markActive(st()!, markTypes.link!), run: () => { ui.openDialog('link', { remove: true }); } });
  add({ id: 'writer.image', label: 'Imagen…', icon: 'image', enabled: ready, run: () => ui.insertImage() });
  add({ id: 'writer.table', label: 'Tabla…', icon: 'tableGrid', enabled: ready, run: () => ui.openDialog('tableSize') });
  add({ id: 'writer.field.page', label: 'Número de página', icon: 'hash', enabled: ready, run: () => exec(insertNode(nodeTypes.field!.create({ kind: 'page' }))) });
  add({ id: 'writer.field.pages', label: 'Total de páginas', icon: 'hash', enabled: ready, run: () => exec(insertNode(nodeTypes.field!.create({ kind: 'pages' }))) });
  add({ id: 'writer.field.date', label: 'Fecha', icon: 'calendar', enabled: ready, run: () => exec(insertNode(writerSchema.text(new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' })))) });
  add({ id: 'writer.headerFooter', label: 'Editar encabezado', icon: 'panelTop', run: () => c.beginHFEdit('header', Math.max(0, c.currentPage() - 1)) });
  add({ id: 'writer.footerEdit', label: 'Editar pie de página', icon: 'panelTop', run: () => c.beginHFEdit('footer', Math.max(0, c.currentPage() - 1)) });
  const pageNumber = (kind: 'header' | 'footer', align: 'left' | 'center' | 'right') => () => {
    const p = nodeTypes.paragraph!.create({ align }, [nodeTypes.field!.create({ kind: 'page' })]);
    c.setPart(c.currentSection().index, kind, 'default', nodeTypes.doc!.create(null, [p]));
  };
  add({ id: 'writer.pageNumberBottom', label: 'Número de página (parte inferior, centrado)', icon: 'hash', run: pageNumber('footer', 'center') });
  add({ id: 'writer.pageNumberTop', label: 'Número de página (parte superior, a la derecha)', icon: 'hash', run: pageNumber('header', 'right') });
  add({ id: 'writer.removeHeaderFooter', label: 'Quitar encabezado y pie', icon: 'trash', enabled: () => c.parts.size > 0, run: () => c.clearHeadersFooters() });

  // ---- page layout
  for (const [k, m] of Object.entries(MARGIN_PRESETS)) {
    add({ id: `writer.margins.${k}`, label: m.label, icon: 'ruler', checked: () => c.page.marginTop === m.top && c.page.marginLeft === m.left && c.page.marginRight === m.right && c.page.marginBottom === m.bottom, run: () => c.setPage({ marginTop: m.top, marginRight: m.right, marginBottom: m.bottom, marginLeft: m.left }) });
  }
  add({ id: 'writer.orient.portrait', label: 'Vertical', icon: 'fileUp', checked: () => !isLandscape(c.page), run: () => { if (isLandscape(c.page)) c.setPage(rotatePage(c.page)); } });
  add({ id: 'writer.orient.landscape', label: 'Horizontal', icon: 'landscape', checked: () => isLandscape(c.page), run: () => { if (!isLandscape(c.page)) c.setPage(rotatePage(c.page)); } });
  for (const [k, s] of Object.entries(PAGE_SIZES)) {
    add({
      id: `writer.size.${k}`,
      label: s.label,
      icon: 'file',
      checked: () => Math.abs(Math.min(c.page.width, c.page.height) - Math.min(s.width, s.height)) < 1 && Math.abs(Math.max(c.page.width, c.page.height) - Math.max(s.width, s.height)) < 1,
      run: () => (isLandscape(c.page) ? c.setPage({ width: s.height, height: s.width }) : c.setPage({ width: s.width, height: s.height })),
    });
  }
  add({ id: 'writer.pageSetup', label: 'Configurar página…', icon: 'settings', run: () => ui.openDialog('pageSetup') });

  // ---- table
  const tcmd = (id: string, label: string, icon: string, cmd: Command) => add({ id, label, icon, enabled: () => inTable() && !!st() && cmd(st()!), run: () => exec(cmd) });
  tcmd('writer.table.rowBefore', 'Insertar fila arriba', 'rowAbove', addRowBefore);
  tcmd('writer.table.rowAfter', 'Insertar fila abajo', 'rowBelow', addRowAfter);
  tcmd('writer.table.colBefore', 'Insertar columna a la izquierda', 'colLeft', addColumnBefore);
  tcmd('writer.table.colAfter', 'Insertar columna a la derecha', 'colRight', addColumnAfter);
  tcmd('writer.table.deleteRow', 'Eliminar fila', 'trash', deleteRow);
  tcmd('writer.table.deleteCol', 'Eliminar columna', 'trash', deleteColumn);
  tcmd('writer.table.delete', 'Eliminar tabla', 'trash', deleteTable);
  tcmd('writer.table.merge', 'Combinar celdas', 'mergeCells', mergeCells);
  tcmd('writer.table.split', 'Dividir celda', 'unmergeCells', splitCell);
  add({
    id: 'writer.table.borders',
    label: 'Bordes de tabla',
    icon: 'gridlines',
    enabled: inTable,
    checked: () => {
      const s = st();
      if (!s) return false;
      for (let d = s.selection.$from.depth; d > 0; d--) if (s.selection.$from.node(d).type.name === 'table') return !!s.selection.$from.node(d).attrs.borders;
      return false;
    },
    run: () => {
      const v = c.view;
      if (!v) return;
      const { $from } = v.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        const n = $from.node(d);
        if (n.type.name === 'table') {
          v.dispatch(v.state.tr.setNodeMarkup($from.before(d), undefined, { ...n.attrs, borders: !n.attrs.borders }));
          break;
        }
      }
      v.focus();
    },
  });
  for (const [k, v, lab] of [['top', 'top', 'Alinear arriba'], ['middle', 'middle', 'Centrar verticalmente'], ['bottom', 'bottom', 'Alinear abajo']] as const) {
    add({ id: `writer.table.valign.${k}`, label: lab, icon: k === 'top' ? 'alignTop' : k === 'middle' ? 'alignMiddle' : 'alignBottom', enabled: inTable, run: () => exec(setCellAttr('vAlign', v)) });
  }

  // ---- find
  add({ id: 'writer.find', label: 'Buscar', icon: 'search', shortcut: 'Ctrl+F', run: () => ui.openFind(false) });
  add({ id: 'writer.replace', label: 'Reemplazar', icon: 'replace', shortcut: 'Ctrl+H', run: () => ui.openFind(true) });

  // ---- view
  add({ id: 'writer.zoomFit', label: 'Ajustar al ancho', icon: 'fit', run: () => ui.fitWidth() });
  defs.push(...layoutCommands(ui));
  defs.push(...reviewCommands(ui));
  defs.push(...refsCommands(ui));
  defs.push(...objectCommands(ui));
  defs.push(...mailCommands(ui));
  defs.push(...spellCommands(ui));
  defs.push(...securityCommands(ui));
  defs.push(
    { id: 'writer.macros.run', label: 'Macros…', icon: 'script', shortcut: 'Alt+F8', description: 'Ejecuta una macro del documento.', run: () => ui.openDialog('macros') },
    { id: 'writer.macros.edit', label: 'Editor de código…', icon: 'code', shortcut: 'Alt+F11', description: 'Escribe y prueba macros en Nova Basic (un subconjunto de VBA).', run: () => ui.openDialog('macroEditor') },
    { id: 'writer.macros.enable', label: 'Habilitar contenido', icon: 'shield', description: 'Permite que se ejecuten las macros de este documento.', enabled: () => !ui.ctl.contentEnabled, run: () => ui.ctl.enableContent() },
  );
  void docFromText;
  void contentBox;
  void createTable;
  void insertBlockAfterCursor;
  void setStyle;
  return defs;
}
