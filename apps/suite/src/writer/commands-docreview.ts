import type { CommandDef } from '@suitenova/core-ui';
import type { WriterUI } from './commands';

/** Recuento, propiedades del documento, comprobador de accesibilidad y comparación de documentos. */
export function docReviewCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const ready = () => !!c.mainView;
  return [
    { id: 'writer.review.wordCount', label: 'Contar palabras', icon: 'hash', description: 'Palabras, caracteres y párrafos del documento, o de lo seleccionado.', enabled: ready, run: () => ui.openDialog('wordCount') },
    { id: 'writer.review.accessibility', label: 'Comprobar accesibilidad', icon: 'shield', description: 'Busca lo que dificulta leer el documento con lector de pantalla o con poca visión: imágenes sin descripción, tablas sin encabezado, títulos que saltan de nivel, poco contraste…', enabled: ready, run: () => ui.openDialog('accessibility') },
    { id: 'writer.review.compare', label: 'Comparar…', icon: 'trackChanges', description: 'Compara dos versiones y las deja como un documento nuevo con las diferencias de texto marcadas como cambios.', enabled: ready, run: () => ui.openDialog('compare') },
    { id: 'writer.doc.properties', label: 'Propiedades…', icon: 'tag', description: 'Propiedades del documento: título, autor, asunto, palabras clave, categoría y descripción del archivo.', enabled: ready, run: () => ui.openDialog('docProps') },
  ];
}
