import type { CommandDef } from '@suitenova/core-ui';
import { defaultLineNumbers, type LineNumbers } from '@suitenova/writer-core';
import type { Command } from 'prosemirror-state';
import type { WriterUI } from './commands';
import { COVERS, coverEnd, insertCover, removeCover } from './cover';
import { selectionParagraph, updateParagraphs } from './editing';
import { insertOptionalHyphens, removeOptionalHyphens } from './hyphenate';

/** Page colour and borders, line numbers, hyphenation, column breaks and cover pages. */
export function pageCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const ready = () => !!c.mainView;
  const st = () => c.state;
  const exec = (cmd: Command) => {
    const v = c.mainView;
    if (!v) return;
    cmd(v.state, v.dispatch, v);
    v.focus();
  };
  const here = () => c.currentSection().props;

  add({ id: 'writer.pageColor.remove', label: 'Sin color de página', icon: 'droplet', enabled: () => !!c.pageColor, run: () => c.setPageColor(null) });
  add({ id: 'writer.pageBorders', label: 'Bordes de página…', icon: 'gridlines', description: 'Dibuja un borde alrededor de las páginas: estilo, color, grosor y distancia.', enabled: ready, run: () => ui.openDialog('pageBorders') });

  // ---- line numbers
  const setNumbers = (ln: LineNumbers | null) => c.setSectionsProps({ lineNumbers: ln }, 'section');
  add({ id: 'writer.lineNumbers.none', label: 'Ninguno', icon: 'x', enabled: ready, checked: () => !!st() && !here().lineNumbers, run: () => setNumbers(null) });
  for (const [k, label, restart] of [['continuous', 'Continuo', 'continuous'], ['page', 'Reiniciar en cada página', 'newPage'], ['section', 'Reiniciar en cada sección', 'newSection']] as const) {
    add({
      id: `writer.lineNumbers.${k}`,
      label,
      icon: 'listOrdered',
      enabled: ready,
      checked: () => !!st() && here().lineNumbers?.restart === restart,
      run: () => setNumbers({ ...defaultLineNumbers(), ...(here().lineNumbers ?? {}), restart }),
    });
  }
  add({ id: 'writer.lineNumbers.options', label: 'Opciones de números de línea…', icon: 'settings', enabled: ready, run: () => ui.openDialog('lineNumbers') });
  add({
    id: 'writer.lineNumbers.suppress',
    label: 'Suprimir en el párrafo actual',
    icon: 'eyeOff',
    description: 'El párrafo no recibe número de línea.',
    enabled: () => !!st() && !!selectionParagraph(st()!),
    checked: () => !!st() && !!selectionParagraph(st()!)?.attrs.noLineNumbers,
    run: () => exec(updateParagraphs((n) => ({ noLineNumbers: !n.attrs.noLineNumbers }))),
  });

  // ---- hyphenation
  add({ id: 'writer.hyphenation.none', label: 'Sin guiones', icon: 'x', enabled: ready, checked: () => !c.autoHyphenate, run: () => c.setAutoHyphenate(false) });
  add({ id: 'writer.hyphenation.auto', label: 'Automática', icon: 'caseSensitive', description: 'Divide las palabras al final de la línea según el idioma del documento (usa el diccionario de guiones del navegador).', enabled: ready, checked: () => c.autoHyphenate, run: () => c.setAutoHyphenate(true) });
  add({ id: 'writer.hyphenation.fill', label: 'Dividir palabras ahora', icon: 'caseSensitive', description: 'Pone guiones opcionales entre las sílabas (español) del texto seleccionado, o de todo el documento si no hay selección. Valen en cualquier navegador y en Word.', enabled: ready, run: () => exec(insertOptionalHyphens) });
  add({ id: 'writer.hyphenation.clear', label: 'Quitar los guiones opcionales', icon: 'x', description: 'Quita todos los guiones opcionales del texto seleccionado o del documento.', enabled: ready, run: () => exec(removeOptionalHyphens) });
  add({
    id: 'writer.hyphenation.soft',
    label: 'Insertar guion opcional',
    icon: 'minus',
    description: 'Marca dónde se puede dividir la palabra si hace falta (solo se ve al final de la línea).',
    enabled: ready,
    run: () => {
      const v = c.mainView;
      if (!v) return;
      v.dispatch(v.state.tr.insertText('­').scrollIntoView());
      v.focus();
    },
  });

  // ---- column break
  const inColumns = () => !!st() && here().cols.count > 1;
  add({
    id: 'writer.break.column',
    label: 'Columna',
    icon: 'columns2',
    description: 'El párrafo actual empieza en la columna siguiente (hace falta que la sección tenga columnas).',
    enabled: () => inColumns() && !!selectionParagraph(st()!),
    checked: () => !!st() && !!selectionParagraph(st()!)?.attrs.columnBreakBefore,
    run: () => exec(updateParagraphs((n) => ({ columnBreakBefore: !n.attrs.columnBreakBefore }))),
  });

  // ---- cover pages
  const coverText = () => ({
    title: c.title || 'Título del documento',
    subtitle: 'Subtítulo del documento',
    author: c.author || 'Nombre del autor',
    date: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
  });
  for (const cv of COVERS) add({ id: `writer.cover.${cv.id}`, label: `Portada: ${cv.name}`, icon: 'file', enabled: ready, run: () => exec(insertCover(cv.id, coverText())) });
  add({ id: 'writer.cover.remove', label: 'Quitar la portada', icon: 'trash', enabled: () => !!st() && coverEnd(st()!) !== null, run: () => exec(removeCover) });
  return defs;
}
