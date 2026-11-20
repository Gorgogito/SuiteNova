import type { CommandDef } from '@suitenova/core-ui';
import type { WriterUI } from './commands';
import { selectedImage } from './commands-image';
import { readingOf } from './ocr-images';
import '../ocr/messages';

/** The text of the pictures (OCR): copy it from a picture, see and correct how it was read, read the pictures of the document, and the automatic reading. */
export function ocrCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const o = c.imageOcr;
  const sel = () => selectedImage(c.mainState);
  const text = (): string => {
    const s = c.mainState?.selection;
    const n = s && 'node' in s ? (s as unknown as { node?: import('prosemirror-model').Node }).node : undefined;
    return n && n.type.name === 'image' ? (readingOf(n)?.text ?? '').trim() : '';
  };
  return [
    {
      id: 'writer.ocr.copyText',
      label: 'Copiar el texto de la imagen',
      icon: 'copy',
      description: 'Copia al portapapeles el texto que se ha leído dentro de la imagen seleccionada.',
      enabled: () => !!sel() && !!text(),
      run: () => void navigator.clipboard?.writeText(text()),
    },
    {
      id: 'writer.ocr.dialog',
      label: 'Texto de la imagen…',
      icon: 'textbox',
      description: 'Muestra el texto leído en la imagen y dónde está; permite leerla otra vez (idioma, giro o solo una zona) y copiarlo o insertarlo.',
      enabled: () => !!c.mainView && !!sel(),
      run: () => ui.openDialog('imageText'),
    },
    {
      id: 'writer.ocr.run',
      label: 'Leer el texto de las imágenes',
      icon: 'sparkles',
      description: 'Lee con OCR el texto de todas las imágenes del documento que aún no se han leído, para poder buscarlo y copiarlo.',
      enabled: () => !!c.mainView && !o.state.running && o.counts().unread > 0,
      run: () => void o.run(true),
    },
    { id: 'writer.ocr.stop', label: 'Detener la lectura', icon: 'close', enabled: () => o.state.running, run: () => o.stop() },
    {
      id: 'writer.ocr.auto',
      label: 'Leer las imágenes nuevas al insertarlas',
      icon: 'check',
      description: 'Lee en segundo plano el texto de las imágenes que se ponen en el documento. Las que ya tenía un archivo al abrirlo no se leen solas.',
      checked: () => o.auto,
      run: () => {
        o.auto = !o.auto;
      },
    },
  ];
}
