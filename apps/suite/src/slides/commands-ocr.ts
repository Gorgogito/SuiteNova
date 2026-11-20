import type { CommandDef } from '@suitenova/core-ui';
import { storedText } from '../ocr/driver';
import type { PicEl } from '@suitenova/slides-core';
import type { SlidesUI } from './commands';
import '../ocr/messages';

/** The text of the pictures (OCR): copy it, see and correct how it was read, read all the pictures, and the automatic reading. */
export function ocrCommands(ui: SlidesUI): CommandDef[] {
  const c = ui.ctl;
  const o = c.imageOcr;
  const pic = (): PicEl | null => (c.selected.length === 1 && c.selected[0]!.kind === 'pic' ? (c.selected[0] as PicEl) : null);
  const text = (): string => {
    const p = pic();
    return p ? storedText(c.deck.assets[p.src]?.ocr).trim() : '';
  };
  return [
    {
      id: 'slides.ocr.copyText',
      label: 'Copiar el texto de la imagen',
      icon: 'copy',
      description: 'Copia al portapapeles el texto que se ha leído dentro de la imagen seleccionada.',
      enabled: () => !!text(),
      run: () => void navigator.clipboard?.writeText(text()),
    },
    {
      id: 'slides.ocr.dialog',
      label: 'Texto de la imagen…',
      icon: 'textbox',
      description: 'Muestra el texto leído en la imagen y dónde está; permite leerla otra vez (idioma, giro o solo una zona) y copiarlo.',
      enabled: () => !!pic(),
      run: () => ui.openDialog('imageText'),
    },
    {
      id: 'slides.ocr.run',
      label: 'Leer el texto de las imágenes',
      icon: 'sparkles',
      description: 'Lee con OCR el texto de todas las imágenes de la presentación que aún no se han leído, para poder buscarlo y copiarlo.',
      enabled: () => !o.state.running && o.counts().unread > 0,
      run: () => void o.run(true),
    },
    { id: 'slides.ocr.stop', label: 'Detener la lectura', icon: 'close', enabled: () => o.state.running, run: () => o.stop() },
    {
      id: 'slides.ocr.auto',
      label: 'Leer las imágenes nuevas al insertarlas',
      icon: 'check',
      description: 'Lee en segundo plano el texto de las imágenes que se ponen en la presentación. Las que ya tenía un archivo al abrirlo no se leen solas.',
      checked: () => o.auto,
      run: () => {
        o.auto = !o.auto;
      },
    },
  ];
}
