import type { CommandDef } from '@suitenova/core-ui';
import type { MailCtl } from './ctl';

export type MailDialog = 'settings' | 'about' | 'shortcuts' | 'accounts';
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
  close(): void;
}

export function mailCommands(ui: MailUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const hasMsg = () => c.section === 'mail' && !!c.selected;

  add({ id: 'mail.new', label: 'Archivo de correo nuevo', icon: 'new', shortcut: 'Ctrl+N', run: () => ui.newWindow() });
  add({ id: 'mail.open', label: 'Abrir…', icon: 'open', shortcut: 'Ctrl+O', run: () => void ui.open() });
  add({ id: 'mail.save', label: 'Guardar', icon: 'save', shortcut: 'Ctrl+S', description: 'Guarda correo, calendario, contactos y tareas en un archivo de Nova Mail (.novamail).', run: () => void ui.save(false) });
  add({ id: 'mail.saveAs', label: 'Guardar como…', icon: 'save', shortcut: 'Ctrl+Shift+S', run: () => void ui.save(true) });
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
  add({ id: 'mail.reply', label: 'Responder', icon: 'reply', shortcut: 'Ctrl+R', enabled: () => hasMsg() && c.folder !== 'drafts', run: () => c.reply(c.selectedId!, false) });
  add({ id: 'mail.replyAll', label: 'Responder a todos', icon: 'replyAll', shortcut: 'Ctrl+Shift+R', enabled: () => hasMsg() && c.folder !== 'drafts', run: () => c.reply(c.selectedId!, true) });
  add({ id: 'mail.forward', label: 'Reenviar', icon: 'forward', shortcut: 'Ctrl+F', enabled: hasMsg, run: () => c.forward(c.selectedId!) });
  add({ id: 'mail.editDraft', label: 'Editar borrador', icon: 'edit', enabled: () => hasMsg() && c.folder === 'drafts', run: () => c.editDraft(c.selectedId!) });
  add({ id: 'mail.delete', label: 'Eliminar mensaje', icon: 'trash', hint: 'Supr', enabled: hasMsg, run: () => c.delete(c.selectedId!) });
  add({ id: 'mail.archive', label: 'Archivar', icon: 'archive', enabled: () => hasMsg() && c.folder !== 'archive', run: () => c.move(c.selectedId!, 'archive') });
  add({ id: 'mail.junk', label: 'Correo no deseado', icon: 'ban', enabled: () => hasMsg() && c.folder !== 'junk', run: () => c.move(c.selectedId!, 'junk') });
  add({ id: 'mail.markRead', label: 'Marcar como leído', icon: 'mailOpen', shortcut: 'Ctrl+Q', enabled: () => hasMsg() && !c.selected!.read, run: () => c.setRead(c.selectedId!, true) });
  add({ id: 'mail.markUnread', label: 'Marcar como no leído', icon: 'mail', shortcut: 'Ctrl+U', enabled: () => hasMsg() && c.selected!.read, run: () => c.setRead(c.selectedId!, false) });
  add({ id: 'mail.flag', label: 'Marcar con bandera', icon: 'flag', checked: () => !!c.selected?.flagged, enabled: hasMsg, run: () => c.toggleFlag(c.selectedId!) });
  add({
    id: 'mail.emptyFolder',
    label: 'Vaciar la carpeta',
    icon: 'trash',
    enabled: () => c.section === 'mail' && c.data.messages.some((m) => m.folder === c.folder) && (c.folder === 'trash' || c.folder === 'junk'),
    run: () => {
      if (window.confirm('¿Eliminar para siempre todos los mensajes de esta carpeta? Esta acción no se puede deshacer.')) c.emptyFolder(c.folder);
    },
  });
  add({
    id: 'mail.deleteFolder',
    label: 'Eliminar carpeta',
    icon: 'trash',
    enabled: () => c.section === 'mail' && !c.data.folders.find((f) => f.id === c.folder)?.system && !c.folder.startsWith('c:'),
    run: () => {
      const f = c.data.folders.find((x) => x.id === c.folder);
      const text = f?.remote ? '¿Eliminar la carpeta? También se eliminará en el servidor, con todos sus mensajes. Esta acción no se puede deshacer.' : '¿Eliminar la carpeta? Sus mensajes pasarán a Archivo.';
      if (!window.confirm(text)) return;
      try {
        c.deleteFolder(c.folder);
      } catch (e) {
        c.syncMessage = (e as Error).message;
        c.touch();
      }
    },
  });
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
  return defs;
}
