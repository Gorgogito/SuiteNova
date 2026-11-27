import { Button, DialogActions, DialogContent, DialogTitle, Input } from '@fluentui/react-components';
import { AppFrame, CommandRegistry, coreCommands, t, useLocale, type BackstageEntry } from '@suitenova/core-ui';
import { SNOOZE_CHOICES, calendarOf, calendarsOf, contactsFromCsv, contactsToCsv, isFollowed, parseIcs, parseMailData, parseMbox, parseVcf, rawHeaders, rawOf, serializeMail, writeIcs, writeMbox, writeVcf, type DueReminder } from '@suitenova/mail-core';
import { Calendar, CheckSquare, Mail, Users } from 'lucide-react';
import { parseCsv, toCsv } from '@suitenova/base-core';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { pickAndRead, readPath, saveBytes } from '../fileio';
import { addRecent } from '../recents';
import type { ModuleInfo } from '../modules';
import { backstageEntries, fileCommands } from '../options';
import { useCloseGuard } from '../close-guard';
import { closeThisWindow, isTauri, openModuleWindow } from '../platform';
import { AccountsDialog } from './AccountsDialog';
import { CalendarView } from './CalendarView';
import { ContextMenu, type MenuAt } from './ContextMenu';
import { mailCommands, type DialogArg, type ImportKind, type MailDialog, type MailUI, type OpenDialog } from './commands';
import { AdvancedSearchDialog, CategoriesDialog, FollowDialog, JunkDialog, QuickStepsDialog, RulesDialog, SearchFolderDialog } from './dlg-organize';
import { MailCtl } from './ctl';
import './messages';
import { setTransport } from './remote';
import { onNoticePressed, setNotifier } from './notify';
import { LaterDialog, OptionsForm, UndoSend } from './dlg-send';
import { ComposeBody } from './Composer';
import { FolderTree } from './FolderTree';
import { LinkConfirm, ReadingPane } from './MailViews';
import { MessageList } from './MessageList';
import { removeSelected, saveAttachmentsOf } from './actions';
import { printMessage } from './print';
import { printCalendar } from './calendar-print';
import { MessageImagesForm } from './dlg-ocr';
import { ReadAloudBar } from '../voice/ReadAloudBar';
import { StickyDialog } from './StickyDialog';
import { MacroEditorDialog, MacroListDialog, MacroSecurity } from './dlg-macros';
import { SignaturesDialog } from './rich/Libraries';
import { ContactsView } from './ContactsView';
import { DuplicatesDialog } from './dlg-people';
import { shrinkPhotos } from './photo';
import { TasksView } from './TasksView';
import { mailTabs } from './ribbonDef';
import './mail.css';
import { VERSION } from '../version';

const FILTERS = [{ name: 'Datos de Nova Mail', extensions: ['novamail'] }];
const OPEN_FILTERS = [...FILTERS, { name: 'Archivos de Outlook', extensions: ['msg', 'pst', 'ost'] }];
const AUTOSAVE_MS = 1500;
const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'mensaje';

/** Bytes as a string of one char per byte (and back), so that 8-bit mail survives text handling. */
const toBin = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
};
const fromBin = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

const ACCEPT: Record<ImportKind, string> = { eml: '.eml,message/rfc822', mbox: '.mbox,.mbx', ics: '.ics,.ical,text/calendar', contacts: '.vcf,.vcard,.csv', outlook: '.msg,.pst,.ost' };

/** Content of a simple dialog (title, text and a close button), shown inside the StickyDialog of the app. */
function Modal({ title, onClose, children, actions }: { title: string; onClose: () => void; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{children}</DialogContent>
      <DialogActions>
        {actions ?? (
          <Button appearance="primary" onClick={onClose}>
            {t('Cerrar')}
          </Button>
        )}
      </DialogActions>
    </>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl+N / O / S', 'Nuevo / Abrir / Guardar'],
  ['Ctrl+1 / 2 / 3 / 4', 'Correo / Calendario / Contactos / Tareas'],
  ['Ctrl+Mayús+M', 'Correo nuevo'],
  ['Ctrl+Intro / Esc', 'Enviar / cerrar el mensaje que escribes'],
  ['Ctrl+R / Ctrl+Mayús+R', 'Responder / Responder a todos'],
  ['Ctrl+F', 'Reenviar'],
  ['Supr / Mayús+Supr', 'Eliminar el mensaje / eliminarlo para siempre'],
  ['Ctrl+Z', 'Deshacer: eliminar, mover y marcas'],
  ['Mayús / Ctrl + clic · Mayús+flechas', 'Seleccionar varios mensajes'],
  ['Ctrl+A', 'Seleccionar todos los mensajes de la lista'],
  ['Flecha derecha / izquierda', 'Abrir o cerrar una conversación'],
  ['Insert', 'Marcar para seguimiento o completarlo'],
  ['Ctrl+Mayús+1 … 9', 'Pasos rápidos'],
  ['Mayús+F10', 'Menú del mensaje o de la carpeta'],
  ['F2', 'Cambiar el nombre de la carpeta'],
  ['Ctrl+P', 'Imprimir el mensaje'],
  ['Ctrl+Q / Ctrl+U', 'Marcar como leído / no leído'],
  ['Ctrl+E', 'Buscar'],
  ['F4', 'Buscar en el mensaje (al leer y al escribir); Ctrl+H reemplaza al escribir'],
  ['Ctrl+Mayús+A', 'Evento nuevo'],
  ['Ctrl+Mayús+Q', 'Reunión nueva'],
  ['Ctrl+flechas · Ctrl+Mayús+flechas', 'En el calendario: mover la cita elegida o cambiar su duración'],
  ['Ctrl+Mayús+C', 'Contacto nuevo'],
  ['Ctrl+Mayús+L', 'Grupo nuevo (contactos)'],
  ['Ctrl+Z', 'En el calendario, los contactos y las tareas, Ctrl+Z deshace sus propios cambios.'],
  ['Ctrl+Mayús+K', 'Tarea nueva'],
  ['Alt', 'Atajos de la cinta (KeyTips)'],
];

function SettingsDialog({ ctl, onClose }: { ctl: MailCtl; onClose: () => void }) {
  const [name, setName] = useState(ctl.data.owner.name);
  const [email, setEmail] = useState(ctl.data.owner.email);
  const bad = !!email && !/^[^\s@]+@[^\s@]+$/.test(email);
  return (
    <Modal
      title={t('Mi dirección')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={bad}
            onClick={() => {
              ctl.setOwner({ name: name.trim(), email: email.trim() });
              onClose();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <p>{t('Se usa como remitente de los mensajes que redactas cuando no envías con una cuenta. Con una cuenta conectada (Inicio → Cuentas de correo) el remitente es la dirección de esa cuenta.')}</p>
      <div className="ml-form">
        <label>
          <span>{t('Nombre')}</span>
          <Input aria-label={t('Nombre')} value={name} onChange={(_e, d) => setName(d.value)} />
        </label>
        <label>
          <span>{t('Correo electrónico')}</span>
          <Input aria-label={t('Correo electrónico')} value={email} onChange={(_e, d) => setEmail(d.value)} />
        </label>
        {bad && <span role="alert">{t('Escribe una dirección válida.')}</span>}
      </div>
    </Modal>
  );
}

const NAV = [
  { id: 'mail', label: 'Correo', icon: Mail },
  { id: 'calendar', label: 'Calendario', icon: Calendar },
  { id: 'contacts', label: 'Contactos', icon: Users },
  { id: 'tasks', label: 'Tareas', icon: CheckSquare },
] as const;

export function MailApp({ module }: { module: ModuleInfo }) {
  const registry = useMemo(() => new CommandRegistry(), []);
  const ctl = useMemo(() => new MailCtl(), []);
  const [dialog, setDialog] = useState<MailDialog | null>(null);
  const [arg, setArg] = useState<DialogArg>({});
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const openDialog: OpenDialog = useCallback((kind, with_ = {}) => {
    setArg(with_);
    setDialog(kind);
  }, []);
  const [status, setStatus] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [reminders, setReminders] = useState<DueReminder[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importKind = useRef<ImportKind>('eml');
  useLocale();
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);

  const saveNow = useCallback(
    async (saveAs: boolean, silent = false) => {
      try {
        // the message being written goes into the file too
        if (!silent) ctl.autosaveCompose();
        const base = (ctl.fileName ?? 'Nova Mail').replace(/\.[^.]+$/, '');
        const keep = !saveAs && ctl.filePath?.toLowerCase().endsWith('.novamail') ? ctl.filePath : null;
        const saved = await saveBytes(`${clean(base)}.novamail`, new TextEncoder().encode(serializeMail(ctl.data)), FILTERS, keep);
        if (saved) {
          ctl.markSaved(saved.name, saved.path);
          if (!silent) addRecent({ path: saved.path, name: saved.name, app: 'mail' });
          setStatus(t('Guardado'));
        }
      } catch (e) {
        if (!silent) window.alert(t('No se pudo guardar: {error}', { error: (e as Error).message }));
        else setStatus(t('No se pudo guardar automáticamente'));
      }
    },
    [ctl],
  );

  useEffect(() => {
    if (!isTauri() || !ctl.filePath || !ctl.dirty) return;
    const id = setTimeout(() => void saveNow(false, true), AUTOSAVE_MS);
    return () => clearTimeout(id);
  });

  /** Un archivo de Outlook: un .msg es un mensaje (va a la carpeta actual); un .pst u .ost trae todas sus carpetas dentro de una carpeta nueva. */
  const importOutlookFile = useCallback(
    async (name: string, data: Uint8Array) => {
      setStatus(t('Leyendo {name}…', { name }));
      const { readOutlookFile } = await import('./outlook-files');
      const r = await readOutlookFile(name, data, (n) => setStatus(t('Importando… {n} mensajes', { n })));
      let added = r.messages;
      if (/\.msg$/i.test(name)) {
        const m = r.tree[0]!.messages[0]!;
        ctl.importRaw(m.raw, ctl.folder, { read: m.read, bcc: m.bcc });
      } else added = await ctl.importFolderTree(name.replace(/\.[^.]+$/, ''), r.tree, (n) => setStatus(t('Guardando… {n} de {total} mensajes', { n, total: r.messages })));
      setStatus(t('Se importaron {n} mensajes de «{name}».', { n: added, name }));
      const notes = [...r.warnings];
      if (r.skipped) notes.push(t('Se omitieron {n} elementos que no son correo (calendario, contactos, tareas, notas).', { n: r.skipped }));
      if (notes.length) window.alert(t('El archivo se importó, pero:') + '\n\n' + notes.join('\n'));
    },
    [ctl],
  );

  const loadFile = useCallback(
    async (file: { name: string; path: string | null; data: Uint8Array }) => {
      try {
        if (/\.(msg|pst|ost)$/i.test(file.name)) {
          // abrir un archivo de Outlook empieza un archivo de Nova Mail nuevo con su contenido
          ctl.newDoc();
          await importOutlookFile(file.name, file.data);
          return;
        }
        ctl.load(parseMailData(new TextDecoder('utf-8').decode(file.data)), file.name, file.path);
        addRecent({ path: file.path, name: file.name, app: 'mail' });
      } catch (e) {
        window.alert(t('No se pudo abrir "{name}": {error}', { name: file.name, error: (e as Error).message }));
      }
    },
    [ctl, importOutlookFile],
  );

  const handleImport = useCallback(
    async (files: File[]) => {
      const kind = importKind.current;
      try {
        if (kind === 'eml') {
          const bufs = await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer())));
          ctl.batch(() => bufs.forEach((b) => ctl.importRaw(b)));
          const n = bufs.length;
          setStatus(t('Se importaron {n} mensajes.', { n }));
        } else if (kind === 'outlook') {
          for (const f of files) await importOutlookFile(f.name, new Uint8Array(await f.arrayBuffer()));
        } else if (kind === 'mbox') {
          const raw = parseMbox(toBin(new Uint8Array(await files[0]!.arrayBuffer())));
          ctl.batch(() => raw.forEach((r) => ctl.importRaw(fromBin(r))));
          setStatus(t('Se importaron {n} mensajes.', { n: raw.length }));
        } else if (kind === 'ics') {
          const { events, tasks, warnings } = parseIcs(await files[0]!.text());
          ctl.calendar.import(events, tasks);
          setStatus(t('Se importaron {e} eventos y {t} tareas.', { e: events.length, t: tasks.length }));
          if (warnings.length) window.alert(t('El archivo se importó, pero:') + '\n\n' + warnings.join('\n'));
        } else {
          const f = files[0]!;
          const text = await f.text();
          const r = f.name.toLowerCase().endsWith('.csv') ? contactsFromCsv(parseCsv(text)) : parseVcf(text);
          ctl.people.import(await shrinkPhotos(r.contacts));
          setStatus(t('Se importaron {n} contactos.', { n: r.contacts.length }));
          if (r.warnings.length) window.alert(r.warnings.join('\n'));
        }
      } catch (e) {
        window.alert(t('No se pudo importar: {error}', { error: (e as Error).message }));
      }
    },
    [ctl, importOutlookFile],
  );

  const ui: MailUI = useMemo(
    () => ({
      ctl,
      openDialog,
      showMenu: setMenu,
      newWindow: () => void openModuleWindow('mail', module.name),
      open: async () => {
        ctl.leaveCompose();
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Abrir otro archivo y descartarlos?'))) return;
        const f = await pickAndRead(OPEN_FILTERS).catch((e) => {
          window.alert(String(e));
          return null;
        });
        if (f) await loadFile(f);
      },
      save: (as) => saveNow(as),
      importFiles: (kind) => {
        importKind.current = kind;
        const el = fileRef.current!;
        el.accept = ACCEPT[kind];
        el.multiple = kind === 'eml' || kind === 'outlook';
        el.click();
      },
      exportMessage: async () => {
        const m = ctl.selected;
        if (m) await saveBytes(`${clean(m.subject || 'mensaje')}.eml`, rawOf(m), [{ name: 'Mensaje', extensions: ['eml'] }]);
      },
      exportFolder: async () => {
        const msgs = ctl.data.messages.filter((m) => m.folder === ctl.folder);
        const text = writeMbox(msgs.map((m) => ({ raw: toBin(rawOf(m)), from: m.fromEmail, date: new Date(m.date) })));
        await saveBytes(`${clean(ctl.data.folders.find((f) => f.id === ctl.folder)?.name ?? 'carpeta')}.mbox`, fromBin(text), [{ name: 'Buzón mbox', extensions: ['mbox'] }]);
      },
      exportCalendar: async () => {
        await saveBytes('calendario.ics', new TextEncoder().encode(writeIcs(ctl.data.events, ctl.data.tasks)), [{ name: 'iCalendar', extensions: ['ics'] }]);
      },
      exportOneCalendar: async (id) => {
        const c = calendarsOf(ctl.data).find((x) => x.id === id);
        if (!c) return;
        const events = ctl.data.events.filter((e) => calendarOf(ctl.data, e).id === id);
        await saveBytes(`${clean(c.name)}.ics`, new TextEncoder().encode(writeIcs(events, [], 'Nova Mail', { calendarName: c.name })), [{ name: 'iCalendar', extensions: ['ics'] }]);
      },
      saveEml: async (raw, name) => {
        await saveBytes(`${clean(name)}.eml`, new TextEncoder().encode(raw), [{ name: 'Mensaje', extensions: ['eml'] }]);
      },
      printCalendar: () => printCalendar(ctl),
      exportContacts: async (csv) => {
        if (csv) await saveBytes('contactos.csv', new TextEncoder().encode('﻿' + toCsv(contactsToCsv(ctl.data.contacts)[0]!, contactsToCsv(ctl.data.contacts).slice(1))), [{ name: 'CSV', extensions: ['csv'] }]);
        else await saveBytes('contactos.vcf', new TextEncoder().encode(writeVcf(ctl.data.contacts)), [{ name: 'vCard', extensions: ['vcf'] }]);
      },
      focusSearch: () => {
        ctl.go('mail');
        setTimeout(() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        }, 30);
      },
      print: () => ctl.selected && printMessage(ctl.selected),
      saveAttachments: () => ctl.selected && void saveAttachmentsOf(ctl.selected, setStatus),
      // the close guard asks about unsaved changes, here and from the title bar
      close: () => void closeThisWindow(),
    }),
    [ctl, loadFile, saveNow, module.name, openDialog],
  );

  useEffect(() => {
    const offs = [registry.registerAll(coreCommands), registry.registerAll(mailCommands(ui))];
    fileCommands(registry);
    const unsub = ctl.subscribe(() => registry.invalidate());
    return () => {
      offs.forEach((o) => o());
      unsub();
    };
  }, [registry, ui, ctl]);

  // las cuentas viven en la parte de escritorio; aquí solo se piden sus datos (sin contraseña)
  useEffect(() => {
    ctl.startSync();
    ctl.macroRt.runStartup();
    void ctl.loadAccounts().then(() => {
      // from now on the accounts that can tell are listened to
      ctl.alerts.enableWatch();
      if (ctl.accounts.length && ctl.autoMinutes > 0) void ctl.syncAll({ auto: true });
    });
    const off = onNoticePressed((p) => ctl.alerts.pressed(p));
    return () => {
      off();
      ctl.dispose();
    };
  }, [ctl]);

  useEffect(() => {
    const path = new URLSearchParams(location.search).get('open');
    if (!path || !isTauri()) return;
    readPath(path).then(loadFile, (e) => window.alert(t('No se pudo abrir "{name}": {error}', { name: path, error: String(e) })));
  }, [loadFile]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __novaMail: unknown }).__novaMail = { ctl, checkReminders: () => checkReminders(), setTransport, setNotifier };
  });

  // reminders: of appointments and of messages followed up
  const checkReminders = useCallback(() => {
    const due = ctl.dueReminders();
    ctl.alerts.reminders(due);
    setReminders((cur) => (JSON.stringify(cur) === JSON.stringify(due) ? cur : due));
  }, [ctl]);
  useEffect(() => {
    checkReminders();
    const id = setInterval(checkReminders, 30000);
    return () => clearInterval(id);
  }, [checkReminders, ctl.data.events]);
  // a reminder just set, or one whose message changed
  const version = ctl.getVersion();
  useEffect(() => checkReminders(), [checkReminders, version]);

  const listActions = useMemo(
    () => ({
      print: printMessage,
      headers: () => openDialog('headers'),
      saveAttachments: (rec: Parameters<typeof printMessage>[0]) => void saveAttachmentsOf(rec, setStatus),
      openDialog,
    }),
    [openDialog],
  );

  // Ctrl+Z takes back what was done to the messages; in a field or in the message being written it undoes the typing
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
      const el = e.target as HTMLElement;
      if ((ctl.section === 'mail' && ctl.compose) || el.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && (el as HTMLInputElement).type !== 'checkbox') || el.closest('[role="dialog"]')) return;
      e.preventDefault();
      ctl.undo();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [ctl]);

  // Ctrl+P prints what is seen: the message (a command of its own) or the calendar
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'p' || ctl.section !== 'calendar' || (e.target as HTMLElement).closest?.('[role="dialog"]')) return;
      e.preventDefault();
      printCalendar(ctl);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [ctl]);

  useCloseGuard(
    () => {
      ctl.autosaveCompose();
      return ctl.dirty;
    },
    () => ctl.outbox.closeQuestion(),
  );

  const tabs = useMemo(() => mailTabs(ui, ctl.section), [ui, ctl.section]);
  const backstage: BackstageEntry[] = useMemo(() => {
    const pages = backstageEntries(module.name).filter((e) => e.kind === 'page');
    return [
      { kind: 'command', command: 'mail.new' },
      { kind: 'command', command: 'mail.open' },
      { kind: 'separator' },
      { kind: 'command', command: 'mail.save' },
      { kind: 'command', command: 'mail.saveAs' },
      { kind: 'command', command: 'mail.print' },
      { kind: 'separator' },
      ...pages,
      { kind: 'command', command: 'mail.about' },
      { kind: 'command', command: 'file.close' },
    ] as BackstageEntry[];
  }, [module.name]);

  const sel = ctl.selected;
  const several = ctl.selectedIds().length;
  // the message is written in the reading pane when there is one to be seen
  const canWriteInPane = ctl.section === 'mail' && ctl.showReadingPane;
  const inPane = !!ctl.compose && canWriteInPane && !ctl.composePopped;
  const composer = (variant: 'pane' | 'dialog') =>
    ctl.compose && <ComposeBody key={`${ctl.compose.id}-${variant}`} ctl={ctl} c={ctl.compose} variant={variant} canPop={canWriteInPane} onExport={(raw, name) => void saveBytes(`${clean(name)}.eml`, new TextEncoder().encode(raw), [{ name: 'Mensaje', extensions: ['eml'] }])} />;
  const unreadAll = ctl.data.messages.filter((m) => m.folder === 'inbox' && !m.read).length;

  return (
    <AppFrame
      appId={module.id}
      appName={module.name}
      registry={registry}
      tabs={tabs}
      qat={['mail.save', 'mail.undo', 'mail.compose']}
      docTitle={ctl.docTitle}
      backstage={backstage}
      statusLeft={
        <>
          <span>{ctl.section === 'mail' ? t('{n} mensajes', { n: ctl.list().length }) : ctl.section === 'calendar' ? t('{n} eventos', { n: ctl.data.events.length }) : ctl.section === 'contacts' ? t('{n} contactos', { n: ctl.data.contacts.length }) : t('{n} tareas', { n: ctl.data.tasks.length + ctl.data.messages.filter(isFollowed).length })}</span>
          {status && <span aria-live="polite">{status}</span>}
          {ctl.composeNotice && <span aria-live="polite" data-testid="compose-status">{t(ctl.composeNotice)}</span>}
          {ctl.syncMessage && <span aria-live="polite" data-testid="sync-status">{t(ctl.syncMessage)}</span>}
          {ctl.outbox.messages.length > 0 && <span data-testid="outbox-status">{t('En la Bandeja de salida: {n}', { n: ctl.outbox.messages.length })}</span>}
          {ctl.pendingCount > 0 && <span data-testid="pending-status">{ctl.pendingCount === 1 ? t('1 cambio sin enviar al servidor') : t('{n} cambios sin enviar al servidor', { n: ctl.pendingCount })}</span>}
        </>
      }
      contentFill
    >
      <div className="ml-app nv-work">
        <nav className="ml-rail nv-panel" aria-label={t('Secciones')}>
          {NAV.map((n) => (
            <button key={n.id} type="button" className={ctl.section === n.id ? 'is-current' : ''} aria-current={ctl.section === n.id} onClick={() => ctl.go(n.id)} title={t(n.label)}>
              <n.icon size={20} aria-hidden="true" />
              <span>{t(n.label)}</span>
              {n.id === 'mail' && unreadAll > 0 && <b aria-label={t('{n} sin leer', { n: unreadAll })}>{unreadAll}</b>}
            </button>
          ))}
        </nav>
        {ctl.section === 'mail' && (
          <div className={`ml-mail${ctl.showReadingPane ? '' : ' no-pane'}`}>
            <FolderTree ctl={ctl} openDialog={openDialog} />
            <div className="ml-mail__center">
              <div className="ml-searchbar">
                <input
                  ref={searchRef}
                  type="search"
                  aria-label={t('Buscar correo')}
                  placeholder={ctl.searchFolder ? t('Buscar en esta carpeta de búsqueda') : t('Buscar en esta carpeta (empieza con * para buscar en todas)')}
                  value={ctl.query}
                  aria-invalid={ctl.searchErrors.length > 0}
                  onChange={(e) => ctl.setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') ctl.setQuery('');
                  }}
                />
                <button type="button" className="ml-btn" title={t('Búsqueda avanzada…')} onClick={() => openDialog('advancedSearch')}>
                  {t('Más…')}
                </button>
                {ctl.query.replace(/^\s*\*/, '').trim() && ctl.searchErrors.length === 0 && (
                  <button type="button" className="ml-btn" title={t('Guardar como carpeta de búsqueda…')} onClick={() => openDialog('searchFolder', { query: ctl.query.replace(/^\s*\*\s*/, '') })}>
                    {t('Guardar búsqueda')}
                  </button>
                )}
              </div>
              {ctl.searchErrors.length > 0 && (
                <div className="ml-searcherror" role="alert">
                  {t('No se entiende: {what}', { what: ctl.searchErrors.join(', ') })}
                </div>
              )}
              <MessageList ctl={ctl} actions={listActions} />
            </div>
            {ctl.showReadingPane && (
              <div className="ml-mail__pane">
                {ctl.readAloud.visible && <ReadAloudBar ctrl={ctl.readAloud.voice} onClose={() => ctl.readAloud.stop()} />}
                {inPane ? (
                  composer('pane')
                ) : sel && !ctl.single ? (
                  <div className="ml-several" role="region" aria-label={t('Varios mensajes')}>
                    <p role="status">{t('{n} mensajes seleccionados', { n: several })}</p>
                    <div role="toolbar" aria-label={t('Acciones de la selección')}>
                      <button type="button" className="ml-btn" onClick={() => removeSelected(ctl)}>
                        {t('Eliminar')}
                      </button>
                      <button type="button" className="ml-btn" onClick={() => void ctl.moveMany(ctl.selectedIds(), 'archive')}>
                        {t('Archivar')}
                      </button>
                      <button type="button" className="ml-btn" onClick={() => ctl.setReadMany(ctl.selectedIds(), true)}>
                        {t('Marcar como leído')}
                      </button>
                      <button type="button" className="ml-btn" onClick={() => ctl.setReadMany(ctl.selectedIds(), false)}>
                        {t('Marcar como no leído')}
                      </button>
                      <button type="button" className="ml-btn" onClick={() => ctl.setFlagMany(ctl.selectedIds(), true)}>
                        {t('Marcar con bandera')}
                      </button>
                    </div>
                  </div>
                ) : sel ? (
                  <>
                    <div className="ml-mail__actions" role="toolbar" aria-label={t('Acciones del mensaje')}>
                      {sel.outgoing ? (
                        <>
                          <button type="button" className="ml-btn ml-btn--primary" disabled={ctl.outbox.isSending(sel.id)} onClick={() => void ctl.outbox.sendNow(sel.id)}>
                            {t('Enviar ahora')}
                          </button>
                          <button type="button" className="ml-btn" disabled={ctl.outbox.isSending(sel.id)} onClick={() => openDialog('retime', { ids: [sel.id] })}>
                            {t('Cambiar la hora…')}
                          </button>
                          <button type="button" className="ml-btn" disabled={ctl.outbox.isSending(sel.id)} onClick={() => void ctl.outbox.takeBack(sel.id)}>
                            {t('Editar (cancela el envío)')}
                          </button>
                        </>
                      ) : sel.folder === 'drafts' ? (
                        <button type="button" className="ml-btn" onClick={() => ctl.editDraft(sel.id)}>
                          {t('Editar borrador')}
                        </button>
                      ) : (
                        <>
                          <button type="button" className="ml-btn" onClick={() => ctl.reply(sel.id, false)}>
                            {t('Responder')}
                          </button>
                          <button type="button" className="ml-btn" onClick={() => ctl.reply(sel.id, true)}>
                            {t('Responder a todos')}
                          </button>
                        </>
                      )}
                      {!sel.outgoing && (
                        <button type="button" className="ml-btn" onClick={() => ctl.forward(sel.id)}>
                          {t('Reenviar')}
                        </button>
                      )}
                      <button type="button" className="ml-btn" onClick={() => removeSelected(ctl)}>
                        {t('Eliminar')}
                      </button>
                    </div>
                    <ReadingPane key={sel.id} ctl={ctl} rec={sel} onLink={setLink} showMenu={ui.showMenu} />
                  </>
                ) : (
                  <div className="ml-empty">{t('Selecciona un mensaje para leerlo.')}</div>
                )}
              </div>
            )}
          </div>
        )}
        {ctl.section === 'calendar' && <CalendarView ctl={ctl} ui={ui} />}
        {ctl.section === 'contacts' && <ContactsView ctl={ctl} ui={ui} />}
        {ctl.section === 'tasks' && <TasksView ctl={ctl} />}

        <UndoSend ctl={ctl} />
        {(reminders.length > 0 || ctl.organize.notices.length > 0 || ctl.alerts.toasts.length > 0) && (
          <div className="ml-toasts" role="region" aria-label={t('Recordatorios')} aria-live="polite">
            {ctl.alerts.toasts.map((n) => (
              <div key={n.key} className="ml-toast">
                <strong>{n.title}</strong>
                <span>{n.text}</span>
                <div className="ml-toast__actions">
                {n.messageId && (
                  <button
                    type="button"
                    className="ml-btn"
                    onClick={() => {
                      ctl.openMessage(n.messageId!);
                      ctl.alerts.dismiss(n.key);
                    }}
                  >
                    {t('Abrir')}
                  </button>
                )}
                <button type="button" className="ml-btn" onClick={() => ctl.alerts.dismiss(n.key)}>
                  {t('Cerrar')}
                </button>
                </div>
              </div>
            ))}
            {ctl.organize.notices.map((n) => (
              <div key={n.key} className="ml-toast">
                <strong>{n.title || t('Regla')}</strong>
                <span>{n.text || t('(sin asunto)')}</span>
                <button type="button" className="ml-btn" onClick={() => ctl.organize.dismissNotice(n.key)}>
                  {t('Cerrar')}
                </button>
              </div>
            ))}
            {reminders.map((r) => (
              <div key={r.key} className="ml-toast">
                <strong>{r.title || t('(sin título)')}</strong>
                <span>
                  {r.kind === 'task'
                    ? r.due == null
                      ? t('Tarea')
                      : t('Tarea: vence el {date}.', { date: new Date(r.due).toLocaleDateString() })
                    : r.kind === 'mail'
                    ? r.due == null
                      ? t('Seguimiento')
                      : t('Seguimiento: vence el {date}.', { date: new Date(r.due).toLocaleDateString() })
                    : new Date(r.at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                </span>
                <div className="ml-toast__actions">
                <button type="button" className="ml-btn" onClick={() => ctl.openReminder(r.key)}>
                  {t('Abrir')}
                </button>
                <select
                  className="ml-btn"
                  aria-label={t('Posponer {name}', { name: r.title || t('(sin título)') })}
                  value=""
                  onChange={(e) => {
                    ctl.snoozeReminder(r.key, Number(e.target.value));
                    checkReminders();
                  }}
                >
                  <option value="" disabled>
                    {t('Posponer…')}
                  </option>
                  {SNOOZE_CHOICES.map((c) => (
                    <option key={c.minutes} value={c.minutes}>
                      {t(c.label)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ml-btn"
                  onClick={() => {
                    ctl.dismissReminder(r.key);
                    checkReminders();
                  }}
                >
                  {t('Descartar')}
                </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) void handleImport(files);
          }}
        />
        <StickyDialog open={!!ctl.compose && !inPane} forget={inPane} onClose={() => ctl.requestCloseCompose()} width={880}>
          {!inPane && composer('dialog')}
        </StickyDialog>
        <LinkConfirm link={link} onClose={() => setLink(null)} />
        {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
        {dialog === 'signatures' && <SignaturesDialog accounts={ctl.accounts} onClose={() => setDialog(null)} />}
        {dialog === 'macros' && <MacroListDialog ctl={ctl} onClose={() => setDialog(null)} onEdit={() => setDialog('macroEditor')} />}
        {dialog === 'macroEditor' && <MacroEditorDialog ctl={ctl} onClose={() => setDialog(null)} />}
        {dialog === 'macroSecurity' && <MacroSecurity ctl={ctl} onClose={() => setDialog(null)} />}
        {dialog === 'retime' && (
          <LaterDialog
            initial={ctl.records(arg.ids ?? [])[0]?.outgoing?.at}
            onClose={() => setDialog(null)}
            onPick={(at) => {
              for (const id of arg.ids ?? []) ctl.outbox.retime(id, at);
              setDialog(null);
            }}
          />
        )}
        <StickyDialog open={dialog !== null && dialog !== 'retime' && dialog !== 'macros' && dialog !== 'macroEditor' && dialog !== 'signatures'} onClose={() => setDialog(null)} width={dialog === 'accounts' || dialog === 'categories' || dialog === 'junk' || dialog === 'duplicates' ? 640 : dialog === 'headers' || dialog === 'rules' || dialog === 'quickSteps' ? 760 : undefined}>
          {dialog === 'options' && <OptionsForm ctl={ctl} onClose={() => setDialog(null)} />}
          {dialog === 'duplicates' && <DuplicatesDialog ctl={ctl} onClose={() => setDialog(null)} />}
          {dialog === 'categories' && <CategoriesDialog ctl={ctl} onClose={() => setDialog(null)} />}
          {dialog === 'follow' && <FollowDialog ctl={ctl} ids={arg.ids ?? []} onClose={() => setDialog(null)} />}
          {dialog === 'rules' && <RulesDialog ctl={ctl} initial={arg.rule} onClose={() => setDialog(null)} />}
          {dialog === 'quickSteps' && <QuickStepsDialog ctl={ctl} onClose={() => setDialog(null)} />}
          {dialog === 'junk' && <JunkDialog ctl={ctl} onClose={() => setDialog(null)} />}
          {dialog === 'searchFolder' && <SearchFolderDialog ctl={ctl} id={arg.folder} query={arg.query} onClose={() => setDialog(null)} />}
          {dialog === 'advancedSearch' && <AdvancedSearchDialog ctl={ctl} onClose={() => setDialog(null)} onSave={(query) => openDialog('searchFolder', { query })} />}
          {dialog === 'imageText' && <MessageImagesForm ctl={ctl} onClose={() => setDialog(null)} />}
          {dialog === 'settings' && <SettingsDialog ctl={ctl} onClose={() => setDialog(null)} />}
          {dialog === 'accounts' && <AccountsDialog ctl={ctl} onClose={() => setDialog(null)} />}
          {dialog === 'about' && (
            <Modal title={t('Acerca de Nova Mail')} onClose={() => setDialog(null)}>
              <p>Nova Mail {VERSION}</p>
              <p>{t('Correo, calendario, contactos y tareas libres (MPL-2.0) de SuiteNova. Se conecta a servidores IMAP, POP3, JMAP y Exchange (EWS) con contraseña u OAuth desde la aplicación de escritorio, mantiene todas las carpetas al día y trabaja con archivos (.eml, .mbox, .ics, .vcf, .msg, .pst, .ost). Consulta docs/LIMITACIONES.md.')}</p>
            </Modal>
          )}
          {dialog === 'headers' && sel && (
            <Modal
              title={t('Encabezados del mensaje')}
              onClose={() => setDialog(null)}
              actions={
                <>
                  <Button onClick={() => void navigator.clipboard.writeText(rawHeaders(rawOf(sel)))}>{t('Copiar')}</Button>
                  <Button appearance="primary" onClick={() => setDialog(null)}>
                    {t('Cerrar')}
                  </Button>
                </>
              }
            >
              <textarea className="ml-headers" readOnly aria-label={t('Encabezados del mensaje')} value={rawHeaders(rawOf(sel))} />
            </Modal>
          )}
          {dialog === 'shortcuts' && (
            <Modal title={t('Atajos de teclado')} onClose={() => setDialog(null)}>
              <table className="nw-shortcuts">
                <tbody>
                  {SHORTCUTS.map(([k, d]) => (
                    <tr key={k}>
                      <th scope="row">
                        <kbd>{k}</kbd>
                      </th>
                      <td>{t(d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Modal>
          )}
        </StickyDialog>
      </div>
    </AppFrame>
  );
}
