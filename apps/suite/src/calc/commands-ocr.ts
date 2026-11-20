import type { CommandDef } from '@suitenova/core-ui';
import { storedText } from '../ocr/driver';
import type { CalcUI } from './commands';
import '../ocr/messages';

/** The text of the pictures (OCR): copy it, see and correct how it was read, read all the pictures, the automatic reading, and data from a picture. */
export function ocrCommands(ui: CalcUI): CommandDef[] {
  const d = ui.doc;
  const o = d.imageOcr;
  const editing = () => !!d.edit;
  const text = (): string => {
    const id = d.x.selectedImage;
    const im = id ? d.sheet.images.find((i) => i.id === id) : undefined;
    return im ? storedText(d.wb.media.get(im.media)?.ocr).trim() : '';
  };
  return [
    {
      id: 'calc.ocr.copyText',
      label: 'Copiar el texto de la imagen',
      icon: 'copy',
      description: 'Copia al portapapeles el texto que se ha leído dentro de la imagen seleccionada.',
      enabled: () => !!text(),
      run: () => void navigator.clipboard?.writeText(text()),
    },
    {
      id: 'calc.ocr.dialog',
      label: 'Texto de la imagen…',
      icon: 'textbox',
      description: 'Muestra el texto leído en la imagen y dónde está; permite leerla otra vez (idioma, giro o solo una zona) y copiarlo.',
      enabled: () => !editing() && !!d.x.selectedImage,
      run: () => ui.openDialog('imageText'),
    },
    {
      id: 'calc.ocr.run',
      label: 'Leer el texto de las imágenes',
      icon: 'sparkles',
      description: 'Lee con OCR el texto de todas las imágenes del libro que aún no se han leído, para poder buscarlo y copiarlo.',
      enabled: () => !o.state.running && o.counts().unread > 0,
      run: () => void o.run(true),
    },
    { id: 'calc.ocr.stop', label: 'Detener la lectura', icon: 'close', enabled: () => o.state.running, run: () => o.stop() },
    {
      id: 'calc.ocr.auto',
      label: 'Leer las imágenes nuevas al insertarlas',
      icon: 'check',
      description: 'Lee en segundo plano el texto de las imágenes que se ponen en el libro. Las que ya tenía un archivo al abrirlo no se leen solas.',
      checked: () => o.auto,
      run: () => {
        o.auto = !o.auto;
      },
    },
    {
      id: 'calc.dataFromPicture',
      label: 'Datos desde imagen…',
      icon: 'picture',
      description: 'Lee una imagen de una tabla (una imagen de la hoja, un archivo, el portapapeles o una captura) y pone sus datos en las celdas, desde la celda activa, después de que los corrijas.',
      enabled: () => !editing(),
      run: () => ui.openDialog('dataFromPicture'),
    },
  ];
}
