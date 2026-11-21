import type { CommandDef } from '@suitenova/core-ui';
import type { MailUI } from './commands';
import '../ocr/messages';

/** The text of the pictures of messages (OCR): read the open message's, read the whole mailbox's (so that searching finds them), see and copy the text. */
export function ocrCommands(ui: MailUI): CommandDef[] {
  const c = ui.ctl;
  const o = c.imageOcr;
  const open = () => c.section === 'mail' && !!c.selected && o.imagesOf(c.selected).length > 0;
  return [
    {
      id: 'mail.ocr.dialog',
      label: 'Texto de las imágenes del mensaje…',
      icon: 'textbox',
      description: 'Muestra el texto leído en las imágenes del mensaje abierto y dónde está; permite leerlas otra vez (idioma, giro o solo una zona) y copiarlo.',
      enabled: open,
      run: () => ui.openDialog('imageText'),
    },
    {
      id: 'mail.ocr.run',
      label: 'Leer las imágenes del mensaje',
      icon: 'sparkles',
      description: 'Lee con OCR el texto de las imágenes del mensaje abierto que aún no se han leído (también si hay muchas o son grandes).',
      enabled: () => !o.state.running && c.section === 'mail' && !!c.selected && o.unread('selected') > 0,
      run: () => void o.readNow('selected'),
    },
    {
      id: 'mail.ocr.runAll',
      label: 'Leer las imágenes del buzón',
      icon: 'sparkles',
      description: 'Lee con OCR el texto de las imágenes de todos los mensajes, en segundo plano, para que la búsqueda de correo también encuentre lo que está escrito en ellas.',
      enabled: () => !o.state.running && o.unread('all') > 0,
      run: () => void o.readNow('all'),
    },
    { id: 'mail.ocr.stop', label: 'Detener la lectura', icon: 'close', enabled: () => o.state.running, run: () => o.stop() },
    {
      id: 'mail.ocr.auto',
      label: 'Leer las imágenes al abrir un mensaje',
      icon: 'check',
      description: 'Lee en segundo plano el texto de las imágenes del mensaje que abres, si no son muchas ni grandes.',
      checked: () => o.auto,
      run: () => {
        o.auto = !o.auto;
      },
    },
  ];
}
