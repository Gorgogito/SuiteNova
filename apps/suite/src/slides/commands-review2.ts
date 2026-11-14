import type { CommandDef } from '@suitenova/core-ui';
import type { SlidesUI } from './commands';

/** Review tools: properties, accessibility checker, compare with another file, reuse slides and zoom slides. */
export function reviewCommands2(ui: SlidesUI): CommandDef[] {
  return [
    { id: 'slides.doc.properties', label: 'Propiedades…', icon: 'info', description: 'Título, autor, asunto, palabras clave, categoría y comentarios del archivo.', run: () => ui.openDialog('docProps') },
    { id: 'slides.review.accessibility', label: 'Comprobar accesibilidad', icon: 'accessibility', description: 'Busca lo que dificulta usar la presentación con lector de pantalla o con poca visión: objetos sin texto alternativo, diapositivas sin título, poco contraste…', run: () => ui.openDialog('accessibility') },
    { id: 'slides.review.compare', label: 'Comparar…', icon: 'compareDocs', description: 'Compara esta presentación con otra versión: diapositivas nuevas, quitadas y cambiadas.', run: () => ui.openDialog('compareDecks') },
    { id: 'slides.insert.reuse', label: 'Reutilizar diapositivas…', icon: 'slideNew', description: 'Inserta diapositivas de otro archivo con el tema de esta presentación.', enabled: () => !ui.ctl.inMaster, run: () => ui.openDialog('reuse') },
    { id: 'slides.insert.zoomSummary', label: 'Zoom de resumen…', icon: 'layout', description: 'Inserta una diapositiva con imágenes de otras que saltan a ellas.', enabled: () => !ui.ctl.inMaster, run: () => ui.openDialog('zoomSummary') },
    { id: 'slides.show.narration', label: 'Grabar narración…', icon: 'mic', description: 'Graba con el micrófono la narración de la diapositiva actual; suena sola al presentar.', enabled: () => !ui.ctl.inMaster, run: () => ui.openDialog('narration') },
    { id: 'slides.insert.zoomSlide', label: 'Zoom de diapositiva…', icon: 'layout', description: 'Inserta una imagen de una diapositiva que salta a ella al hacer clic.', enabled: () => !ui.ctl.inMaster, run: () => ui.openDialog('zoomSlide') },
  ];
}
