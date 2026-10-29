import type { CommandDef } from '@suitenova/core-ui';
import { CITE_STYLES } from '@suitenova/writer-core';
import type { WriterUI } from './commands';
import { generatedKindsIn, insertCitation, insertGenerated, removeGenerated, updateFields, updateGenerated } from './refs-actions';
import { defaultTocOptions, tocInstr } from '@suitenova/writer-core';

/** Footnotes, table of contents, captions, cross references, citations, bibliography and index. */
export function refsCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const ready = () => !!c.mainView && !c.readOnly;
  const has = (kind: string) => generatedKindsIn(c).has(kind);

  // ---- notes
  add({ id: 'writer.note.footnote', label: 'Insertar nota al pie', icon: 'footnote', shortcut: 'Ctrl+Alt+F', description: 'Añade una nota al pie de la página en el punto donde está el cursor.', enabled: ready, run: () => c.insertNote('footnote') });
  add({ id: 'writer.note.endnote', label: 'Insertar nota final', icon: 'footnote', shortcut: 'Ctrl+Alt+D', description: 'Añade una nota que se muestra al final del documento.', enabled: ready, run: () => c.insertNote('endnote') });
  add({ id: 'writer.note.next', label: 'Siguiente nota', icon: 'arrowRight', enabled: () => c.notes().length > 0, run: () => c.stepNote(1) });
  add({ id: 'writer.note.prev', label: 'Nota anterior', icon: 'arrowLeft', enabled: () => c.notes().length > 0, run: () => c.stepNote(-1) });
  add({ id: 'writer.note.options', label: 'Opciones de notas…', icon: 'settings', run: () => ui.openDialog('noteOptions') });

  // ---- table of contents and figures
  add({
    id: 'writer.toc.auto',
    label: 'Tabla de contenido automática',
    icon: 'toc',
    description: 'Inserta una tabla de contenido con los títulos 1 a 3 y sus números de página.',
    enabled: ready,
    run: () => void insertGenerated(c, 'toc', { ...defaultTocOptions(), instr: tocInstr(defaultTocOptions()) } as never),
  });
  add({ id: 'writer.toc.custom', label: 'Tabla de contenido personalizada…', icon: 'toc', enabled: ready, run: () => ui.openDialog('toc') });
  add({ id: 'writer.toc.update', label: 'Actualizar tabla', icon: 'refresh', enabled: () => ready() && (has('toc') || has('tof') || has('index') || has('bibliography')), run: () => void updateGenerated(c) });
  add({ id: 'writer.toc.remove', label: 'Quitar la tabla de contenido', icon: 'trash', enabled: () => ready() && has('toc'), run: () => removeGenerated(c, 'toc') });
  add({ id: 'writer.tof.insert', label: 'Insertar tabla de ilustraciones…', icon: 'toc', enabled: ready, run: () => ui.openDialog('tof') });
  add({ id: 'writer.fields.update', label: 'Actualizar campos', icon: 'refresh', shortcut: 'F9', description: 'Recalcula números de títulos, referencias cruzadas, citas y páginas.', enabled: ready, run: () => { updateFields(c); void updateGenerated(c); } });

  // ---- captions, references, bookmarks
  add({ id: 'writer.caption.insert', label: 'Insertar título…', icon: 'tag', description: 'Añade un título numerado (Figura 1, Tabla 1…) a un elemento.', enabled: ready, run: () => ui.openDialog('caption') });
  add({ id: 'writer.xref.insert', label: 'Referencia cruzada…', icon: 'link', description: 'Hace referencia a un título, un marcador, una figura o una nota.', enabled: ready, run: () => ui.openDialog('xref') });
  add({ id: 'writer.bookmark.insert', label: 'Marcador…', icon: 'bookmark', enabled: ready, run: () => ui.openDialog('bookmark') });

  // ---- citations
  add({ id: 'writer.cite.insert', label: 'Insertar cita…', icon: 'quote', description: 'Cita una fuente en el texto con el estilo elegido.', enabled: ready, run: () => ui.openDialog('cite') });
  add({ id: 'writer.cite.manage', label: 'Administrar fuentes…', icon: 'book', run: () => ui.openDialog('sources') });
  for (const s of CITE_STYLES) {
    add({
      id: `writer.cite.style.${s.id}`,
      label: s.label,
      icon: 'quote',
      checked: () => c.citeStyle === s.id,
      run: () => {
        c.citeStyle = s.id;
        c.dirty = true;
        c.touch();
        updateFields(c);
        void updateGenerated(c, 1);
      },
    });
  }
  add({ id: 'writer.bib.insert', label: 'Insertar bibliografía', icon: 'book', description: 'Inserta la lista de las fuentes citadas con el estilo elegido.', enabled: ready, run: () => void insertGenerated(c, 'bibliography', { instr: ' BIBLIOGRAPHY \\l 1033 ' }) });

  // ---- index
  add({ id: 'writer.index.mark', label: 'Marcar entrada…', icon: 'bookIndex', enabled: ready, run: () => ui.openDialog('indexMark') });
  add({ id: 'writer.index.insert', label: 'Insertar índice', icon: 'bookIndex', enabled: ready, run: () => void insertGenerated(c, 'index', { instr: ' INDEX \\c "1" ' }) });
  void insertCitation;
  return defs;
}
