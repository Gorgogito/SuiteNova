import type { CommandDef } from '@suitenova/core-ui';
import type { WriterUI } from './commands';

/** Password to open the file and digital signature. */
export function securityCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  add({ id: 'writer.password.set', label: 'Cifrar con contraseña…', icon: 'lock', description: 'Pide una contraseña para abrir el archivo (cifrado AES-256, como Word).', run: () => ui.openDialog('encrypt') });
  add({
    id: 'writer.password.remove',
    label: 'Quitar la contraseña de apertura',
    icon: 'unlock',
    enabled: () => !!c.password,
    run: () => {
      c.password = null;
      c.dirty = true;
      c.touch();
    },
  });
  add({ id: 'writer.sign', label: 'Firmar documento…', icon: 'fileSign', description: 'Añade una firma digital: cualquier cambio posterior la invalida.', enabled: () => !!c.mainView && !c.signature, run: () => ui.openDialog('sign') });
  add({ id: 'writer.sign.view', label: 'Ver firma…', icon: 'shield', description: 'Muestra quién firmó, cuándo y si el contenido sigue igual.', enabled: () => !!c.signature, run: () => ui.openDialog('signInfo') });
  return defs;
}
