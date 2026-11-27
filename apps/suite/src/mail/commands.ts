import type { CommandDef } from '@suitenova/core-ui';
import { LIST_FILTERS, SORT_KEYS, canChangeFolder } from '@suitenova/mail-core';
import { emptyFolder, removeFolder, removeSelected } from './actions';
import type { MailCtl } from './ctl';
import { ocrCommands } from './commands-ocr';
import { voiceCommands } from './commands-voice';

export type MailDialog = 'headers' | 'signatures' | 'imageText' | 'settings' | 'about' | 'shortcuts' | 'accounts' | 'macros' | 'macroEditor' | 'macroSecurity';
export type ImportKind = 'eml' | 'mbox' | 'ics' | 'contacts' | 'outlook';

export interface MailUI {
  ctl: MailCtl;
  openDialog(kind: MailDialog): void;
  newWindow(): void;
  open(): Promise<void>;
  save(saveAs: boolean): Promise<void>;
  importFiles(kind: ImportKind): void;
  exportMessage(): Promise<void>;
  exportFolder(): Promise<void>;
  exportCalendar(): Promise<void>;
  exportContacts(csv: boolean): Promise<void>;
  focusSearch(): void;
  print(): void;
  saveAttachments(): void;
  close(): void;
}

export function mailCommands(ui: MailUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  // while a message is being written, the commands of the selected one wait: Ctrl+R or Ctrl+F do not interrupt
  const hasMsg = () => c.section === 'mail' && !!c.selected && !c.compose;
  // some act on one message; the others on everything selected
  const hasOne = () => hasMsg() && !!c.single;
  const folder = () => c.data.folders.find((f) => f.id === c.folder);

  add({ id: 'mail.new', label: 'Archivo de correo nuevo', icon: 'new', shortcut: 'Ctrl+N', run: () => ui.newWindow() });
  add({ id: 'mail.open', label: 'Abrir…', icon: 'open', shortcut: 'Ctrl+O', run: () => void ui.open() });
  add({ id: 'mail.save', label: 'Guardar', icon: 'save', shortcut: 'Ctrl+S', description: 'Guarda correo, calendario, contactos y tareas en un archivo de Nova Mail (.novamail).', run: () => void ui.save(false) });
  add({ id: 'mail.saveAs', label: 'Guardar como…', icon: 'save', shortcut: 'Ctrl+Shift+S', run: () => void ui.save(true) });
  add({ id: 'mail.macros', label: 'Macros…', icon: 'run', shortcut: 'Alt+F8', description: 'Ejecuta una macro (un Sub de Nova Basic) de Nova Mail.', run: () => ui.openDialog('macros') });
  add({ id: 'mail.macroEditor', label: 'Editor de código…', icon: 'code', shortcut: 'Alt+F11', description: 'Escribe y prueba macros en Nova Basic con los objetos de Outlook (Application, NameSpace, Folder, MailItem…).', run: () => ui.openDialog('macroEditor') });
  add({ id: 'mail.trustCentre', label: 'Centro de confianza…', icon: 'shield', description: 'Nivel de seguridad de las macros, firma y biblioteca global.', run: () => ui.openDialog('macroSecurity') });
  add({ id: 'mail.macroSecurity', label: 'Seguridad de macros', icon: 'shield', description: 'Permite o impide que se ejecuten las macros de Nova Mail.', checked: () => c.macrosEnabled, run: () => c.setMacrosEnabled(!c.macrosEnabled) });
  add({ id: 'mail.about', label: 'Acerca de Nova Mail', icon: 'info', run: () => ui.openDialog('about') });
  add({ id: 'help.shortcuts', label: 'Atajos de teclado', icon: 'keyboard', run: () => ui.openDialog('shortcuts') });
  add({ id: 'mail.settings', label: 'Mi dirección…', icon: 'settings', run: () => ui.openDialog('settings') });
  add({ id: 'mail.accounts', label: 'Cuentas de correo…', icon: 'userPlus', description: 'Conecta Nova Mail con tu servidor de correo (IMAP, POP3, JMAP o Exchange) con contraseña u OAuth.', run: () => ui.openDialog('accounts') });
  add({
    id: 'mail.sync',
    label: 'Enviar y recibir',
    icon: 'refresh',
    shortcut: 'F9',
    description: 'Envía al servidor los cambios pendientes y pone al día todas las carpetas de tus cuentas: baja lo nuevo y refleja lo que se borró, movió o marcó en el servidor.',
    enabled: () => c.canConnect && c.accounts.length > 0 && !c.syncing,
    run: () => void c.syncAll(),
  });

  // sections
  add({ id: 'mail.go.mail', label: 'Correo', icon: 'mail', shortcut: 'Ctrl+1', checked: () => c.section === 'mail', run: () => c.go('mail') });
  add({ id: 'mail.go.calendar', label: 'Calendario', icon: 'calendar', shortcut: 'Ctrl+2', checked: () => c.section === 'calendar', run: () => c.go('calendar') });
  add({ id: 'mail.go.contacts', label: 'Contactos', icon: 'contacts', shortcut: 'Ctrl+3', checked: () => c.section === 'contacts', run: () => c.go('contacts') });
  add({ id: 'mail.go.tasks', label: 'Tareas', icon: 'checkSquare', shortcut: 'Ctrl+4', checked: () => c.section === 'tasks', run: () => c.go('tasks') });

  // mail
  add({ id: 'mail.compose', label: 'Correo nuevo', icon: 'mailNew', shortcut: 'Ctrl+Shift+M', run: () => c.newMessage() });
  add({ id: 'mail.signatures', label: 'Firmas…', icon: 'edit', description: 'Crea firmas y elige cuál se pone sola en cada cuenta, en los mensajes nuevos y en las respuestas.', run: () => ui.openDialog('signatures') });
  add({ id: 'mail.reply', label: 'Responder', icon: 'reply', shortcut: 'Ctrl+R', enabled: () => hasOne() && c.selected!.folder !== 'drafts', run: () => c.reply(c.selectedId!, false) });
  add({ id: 'mail.replyAll', label: 'Responder a todos', icon: 'replyAll', shortcut: 'Ctrl+Shift+R', enabled: () => hasOne() && c.selected!.folder !== 'drafts', run: () => c.reply(c.selectedId!, true) });
  add({ id: 'mail.forward', label: 'Reenviar', icon: 'forward', shortcut: 'Ctrl+F', enabled: hasOne, run: () => c.forward(c.selectedId!) });
  add({ id: 'mail.editDraft', label: 'Editar borrador', icon: 'edit', enabled: () => hasOne() && c.selected!.folder === 'drafts', run: () => c.editDraft(c.selectedId!) });
  add({ id: 'mail.delete', label: 'Eliminar mensaje', icon: 'trash', hint: 'Supr', enabled: hasMsg, run: () => removeSelected(c) });
  add({ id: 'mail.deletePermanent', label: 'Eliminar para siempre', icon: 'trash', hint: 'Mayús+Supr', enabled: hasMsg, run: () => removeSelected(c, true) });
  add({ id: 'mail.undo', label: 'Deshacer', icon: 'undo', hint: 'Ctrl+Z', description: 'Deshace lo último que se hizo con los mensajes: eliminar, mover, archivar, marcar. En el servidor también.', enabled: () => c.section === 'mail' && !c.compose && !!c.undoLabel, run: () => c.undo() });
  add({ id: 'mail.selectAll', label: 'Seleccionar todo', icon: 'checkSquare', hint: 'Ctrl+A', enabled: () => c.section === 'mail' && !c.compose && c.list().length > 0, run: () => c.selectAll() });
  add({ id: 'mail.archive', label: 'Archivar', icon: 'archive', enabled: () => hasMsg() && c.selectedRecords.some((m) => m.folder !== 'archive'), run: () => void c.moveMany(c.selectedIds(), 'archive') });
  add({ id: 'mail.junk', label: 'Correo no deseado', icon: 'ban', enabled: () => hasMsg() && c.selectedRecords.some((m) => m.folder !== 'junk'), run: () => void c.moveMany(c.selectedIds(), 'junk') });
  add({ id: 'mail.markRead', label: 'Marcar como leído', icon: 'mailOpen', shortcut: 'Ctrl+Q', enabled: () => hasMsg() && c.selectedRecords.some((m) => !m.read), run: () => c.setReadMany(c.selectedIds(), true) });
  add({ id: 'mail.markUnread', label: 'Marcar como no leído', icon: 'mail', shortcut: 'Ctrl+U', enabled: () => hasMsg() && c.selectedRecords.some((m) => m.read), run: () => c.setReadMany(c.selectedIds(), false) });
  const allFlagged = () => c.selectedRecords.length > 0 && c.selectedRecords.every((m) => m.flagged);
  add({ id: 'mail.flag', label: 'Marcar con bandera', icon: 'flag', checked: allFlagged, enabled: hasMsg, run: () => c.setFlagMany(c.selectedIds(), !allFlagged()) });
  add({ id: 'mail.print', label: 'Imprimir mensaje…', icon: 'print', shortcut: 'Ctrl+P', enabled: hasOne, run: () => ui.print() });
  add({ id: 'mail.headers', label: 'Encabezados del mensaje…', icon: 'code', description: 'Muestra los encabezados de Internet del mensaje, tal como llegaron.', enabled: hasOne, run: () => ui.openDialog('headers') });
  add({ id: 'mail.saveAttachments', label: 'Guardar todos los adjuntos…', icon: 'save', enabled: () => hasOne() && c.selected!.hasAttachments, run: () => ui.saveAttachments() });
  add({
    id: 'mail.emptyFolder',
    label: 'Vaciar la carpeta',
    icon: 'trash',
    enabled: () => c.section === 'mail' && c.data.messages.some((m) => m.folder === c.folder) && (c.folder === 'trash' || c.folder === 'junk'),
    run: () => emptyFolder(c, c.folder),
  });
  add({ id: 'mail.deleteFolder', label: 'Eliminar carpeta', icon: 'trash', enabled: () => c.section === 'mail' && canChangeFolder(folder()), run: () => removeFolder(c, c.folder) });
  add({ id: 'mail.folder.new', label: 'Carpeta nueva…', icon: 'new', enabled: () => c.section === 'mail', run: () => c.editFolder({ kind: 'new', inside: false }) });
  add({ id: 'mail.folder.rename', label: 'Cambiar nombre', icon: 'edit', hint: 'F2', description: 'Cambia el nombre de la carpeta; si es de una cuenta, también en el servidor.', enabled: () => c.section === 'mail' && canChangeFolder(folder()), run: () => c.editFolder({ kind: 'rename', id: c.folder }) });
  add({ id: 'mail.folder.markRead', label: 'Marcar todo como leído', icon: 'mailOpen', enabled: () => c.section === 'mail' && c.data.messages.some((m) => m.folder === c.folder && !m.read), run: () => c.markFolderRead(c.folder) });
  add({ id: 'mail.folder.favorite', label: 'Favorita', icon: 'star', description: 'Pone la carpeta en Favoritos, encima del árbol de carpetas, o la quita.', checked: () => !!c.data.favorites?.includes(c.folder), enabled: () => c.section === 'mail', run: () => c.toggleFavorite(c.folder) });

  // how the list is shown
  add({ id: 'mail.view.conversations', label: 'Conversaciones', icon: 'conversations', description: 'Reúne en una sola fila los mensajes de cada conversación, también los que enviaste.', checked: () => c.view.conversations, run: () => c.setView({ conversations: !c.view.conversations }) });
  add({ id: 'mail.view.groups', label: 'Mostrar en grupos', icon: 'groups', checked: () => c.view.groups, run: () => c.setView({ groups: !c.view.groups }) });
  add({ id: 'mail.view.reverse', label: 'Orden inverso', icon: 'sortReverse', checked: () => c.view.reverse, run: () => c.setView({ reverse: !c.view.reverse }) });
  for (const k of SORT_KEYS) add({ id: `mail.view.sort.${k.id}`, label: `Ordenar por: ${k.label}`, icon: 'sortReverse', checked: () => c.view.sort === k.id, run: () => c.setView({ sort: k.id }) });
  for (const f of LIST_FILTERS) add({ id: `mail.view.filter.${f.id}`, label: `Mostrar: ${f.label}`, icon: 'search', checked: () => c.view.filter === f.id, run: () => c.setView({ filter: f.id }) });
  add({ id: 'mail.search', label: 'Buscar correo', icon: 'search', shortcut: 'Ctrl+E', run: () => ui.focusSearch() });
  add({ id: 'mail.readingPane', label: 'Panel de lectura', icon: 'panelRight', checked: () => c.showReadingPane, run: () => { c.showReadingPane = !c.showReadingPane; c.touch(); } });

  // calendar
  add({ id: 'cal.new', label: 'Evento nuevo', icon: 'calendarPlus', shortcut: 'Ctrl+Shift+A', run: () => { c.go('calendar'); setTimeout(() => window.dispatchEvent(new Event('nova:new-event')), 0); } });
  add({ id: 'cal.today', label: 'Hoy', icon: 'calendar', run: () => c.setAnchor(Date.now()) });
  for (const v of ['day', 'week', 'month'] as const) add({ id: `cal.view.${v}`, label: v === 'day' ? 'Vista Día' : v === 'week' ? 'Vista Semana' : 'Vista Mes', icon: 'calendar', checked: () => c.calView === v, run: () => { c.calView = v; c.touch(); } });

  // contacts and tasks
  add({ id: 'contact.new', label: 'Contacto nuevo', icon: 'userPlus', shortcut: 'Ctrl+Shift+C', run: () => { c.go('contacts'); c.addContact(); } });
  add({ id: 'task.new', label: 'Tarea nueva', icon: 'checkSquare', shortcut: 'Ctrl+Shift+K', run: () => { c.go('tasks'); setTimeout(() => document.querySelector<HTMLInputElement>('.ml-tasks__add input')?.focus(), 30); } });

  // data
  add({ id: 'data.import.eml', label: 'Importar mensajes (.eml)…', icon: 'open', run: () => ui.importFiles('eml') });
  add({ id: 'data.import.mbox', label: 'Importar buzón (.mbox)…', icon: 'open', run: () => ui.importFiles('mbox') });
  add({ id: 'data.import.outlook', label: 'Importar de Outlook…', icon: 'open', description: 'Archivos .msg, .pst y .ost. Un .msg es un mensaje; un .pst u .ost trae todas sus carpetas de correo, con las subcarpetas, dentro de una carpeta nueva. El calendario, los contactos y las tareas de Outlook no se importan.', run: () => ui.importFiles('outlook') });
  add({ id: 'data.import.ics', label: 'Importar calendario (.ics)…', icon: 'calendar', run: () => ui.importFiles('ics') });
  add({ id: 'data.import.contacts', label: 'Importar contactos (.vcf, .csv)…', icon: 'contacts', run: () => ui.importFiles('contacts') });
  add({ id: 'data.export.eml', label: 'Exportar mensaje (.eml)…', icon: 'exportFile', enabled: hasMsg, run: () => void ui.exportMessage() });
  add({ id: 'data.export.mbox', label: 'Exportar carpeta (.mbox)…', icon: 'exportFile', enabled: () => c.data.messages.some((m) => m.folder === c.folder), run: () => void ui.exportFolder() });
  add({ id: 'data.export.ics', label: 'Exportar calendario y tareas (.ics)…', icon: 'exportFile', run: () => void ui.exportCalendar() });
  add({ id: 'data.export.vcf', label: 'Exportar contactos (.vcf)…', icon: 'exportFile', enabled: () => c.data.contacts.length > 0, run: () => void ui.exportContacts(false) });
  add({ id: 'data.export.csv', label: 'Exportar contactos (.csv)…', icon: 'exportFile', enabled: () => c.data.contacts.length > 0, run: () => void ui.exportContacts(true) });
  defs.push(...ocrCommands(ui));
  defs.push(...voiceCommands(ui));
  return defs;
}
