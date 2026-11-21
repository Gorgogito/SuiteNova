import type { CommandDef } from '@suitenova/core-ui';
import { storedText } from '../ocr/driver';
import type { DiagramUI } from './commands';
import '../ocr/messages';

/** The text of the pictures (OCR): copy it, see and correct how it was read, read all the pictures, the automatic reading, and find in the page. */
export function ocrCommands(ui: DiagramUI): CommandDef[] {
  const c = ui.ctl;
  const o = c.imageOcr;
  const pic = () => {
    const s = c.selectedShapes();
    return s.length === 1 && s[0]!.image ? s[0]! : null;
  };
  const text = (): string => storedText(pic()?.image?.ocr).trim();
  return [
    {
      id: 'diagram.ocr.copyText',
      label: 'Copiar el texto de la imagen',
      icon: 'copy',
      description: 'Copia al portapapeles el texto que se ha leído dentro de la imagen seleccionada.',
      enabled: () => !!text(),
      run: () => void navigator.clipboard?.writeText(text()),
    },
    {
      id: 'diagram.ocr.dialog',
      label: 'Texto de la imagen…',
      icon: 'textbox',
      description: 'Muestra el texto leído en la imagen y dónde está; permite leerla otra vez (idioma, giro o solo una zona) y copiarlo.',
      enabled: () => !!pic(),
      run: () => ui.openDialog('imageText'),
    },
    {
      id: 'diagram.ocr.run',
      label: 'Leer el texto de las imágenes',
      icon: 'sparkles',
      description: 'Lee con OCR el texto de todas las imágenes del diagrama que aún no se han leído, para poder buscarlo y copiarlo.',
      enabled: () => !o.state.running && o.counts().unread > 0,
      run: () => void o.run(true),
    },
    { id: 'diagram.ocr.stop', label: 'Detener la lectura', icon: 'close', enabled: () => o.state.running, run: () => o.stop() },
    {
      id: 'diagram.ocr.auto',
      label: 'Leer las imágenes nuevas al insertarlas',
      icon: 'check',
      description: 'Lee en segundo plano el texto de las imágenes que se ponen en el diagrama. Las que ya tenía un archivo al abrirlo no se leen solas.',
      checked: () => o.auto,
      run: () => {
        o.auto = !o.auto;
      },
    },
    {
      id: 'diagram.find',
      label: 'Buscar…',
      icon: 'search',
      shortcut: 'Ctrl+F',
      description: 'Busca texto en las formas, en las líneas y dentro de las imágenes de todas las páginas, y va a lo que encuentra.',
      run: () => ui.openDialog('find'),
    },
  ];
}
