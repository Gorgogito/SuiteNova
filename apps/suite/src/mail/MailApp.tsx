import { Button, DialogActions, DialogContent, DialogTitle, Input } from '@fluentui/react-components';
import { AppFrame, CommandRegistry, coreCommands, t, useLocale, type BackstageEntry } from '@suitenova/core-ui';
import { contactsFromCsv, contactsToCsv, occurrencesBetween, parseIcs, parseMailData, parseMbox, parseVcf, rawOf, serializeMail, writeIcs, writeMbox, writeVcf } from '@suitenova/mail-core';
import { Calendar, CheckSquare, Mail, Users } from 'lucide-react';
import { parseCsv, toCsv } from '@suitenova/base-core';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { pickAndRead, readPath, saveBytes } from '../fileio';
import { addRecent } from '../recents';
import type { ModuleInfo } from '../modules';
import { backstageEntries, fileCommands } from '../options';
import { closeThisWindow, isTauri, openModuleWindow } from '../platform';
import { AccountsDialog } from './AccountsDialog';
import { CalendarView } from './CalendarView';
import { mailCommands, type ImportKind, type MailDialog, type MailUI } from './commands';
import { MailCtl } from './ctl';
import './messages';
import { setTransport } from './remote';
import { ComposeBody, FolderTree, LinkConfirm, MessageList, ReadingPane } from './MailViews';
import { StickyDialog } from './StickyDialog';
import { ContactsView, TasksView } from './PeopleViews';
import { mailTabs } from './ribbonDef';
import './mail.css';

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
  ['Ctrl+R / Ctrl+Mayús+R', 'Responder / Responder a todos'],
  ['Ctrl+F', 'Reenviar'],
  ['Supr', 'Eliminar el mensaje'],
  ['Ctrl+Q / Ctrl+U', 'Marcar como leído / no leído'],
  ['Ctrl+E', 'Buscar'],
  ['Ctrl+Mayús+A', 'Evento nuevo'],
  ['Ctrl+Mayús+C', 'Contacto nuevo'],
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
  const [status, setStatus] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [reminders, setReminders] = useState<{ key: string; title: string; when: string }[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importKind = useRef<ImportKind>('eml');
  useLocale();
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);

  const saveNow = useCallback(
    async (saveAs: boolean, silent = false) => {
      try {
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
          ctl.data.events = [...ctl.data.events, ...events];
          ctl.data.tasks = [...ctl.data.tasks, ...tasks];
          ctl.touch(true);
          setStatus(t('Se importaron {e} eventos y {t} tareas.', { e: events.length, t: tasks.length }));
          if (warnings.length) window.alert(t('El archivo se importó, pero:') + '\n\n' + warnings.join('\n'));
        } else {
          const f = files[0]!;
          const text = await f.text();
          const r = f.name.toLowerCase().endsWith('.csv') ? contactsFromCsv(parseCsv(text)) : parseVcf(text);
          ctl.data.contacts = [...ctl.data.contacts, ...r.contacts];
          ctl.touch(true);
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
      openDialog: (k) => setDialog(k),
      newWindow: () => void openModuleWindow('mail', module.name),
      open: async () => {
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
      close: () => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Cerrar y descartarlos?'))) return;
        void closeThisWindow();
      },
    }),
    [ctl, loadFile, saveNow, module.name],
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
    void ctl.loadAccounts().then(() => {
      if (ctl.accounts.length && ctl.autoMinutes > 0) void ctl.syncAll({ auto: true });
    });
    return () => ctl.dispose();
  }, [ctl]);

  useEffect(() => {
    const path = new URLSearchParams(location.search).get('open');
    if (!path || !isTauri()) return;
    readPath(path).then(loadFile, (e) => window.alert(t('No se pudo abrir "{name}": {error}', { name: path, error: String(e) })));
  }, [loadFile]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __novaMail: unknown }).__novaMail = { ctl, checkReminders: () => checkReminders(), setTransport };
  });

  // reminders: look for events whose reminder time has come
  const checkReminders = useCallback(() => {
    const now = Date.now();
    const due: { key: string; title: string; when: string }[] = [];
    for (const o of occurrencesBetween(ctl.data.events.filter((e) => e.reminder !== null), now - 3600000, now + 7 * 86400000)) {
      const at = o.start - (o.event.reminder ?? 0) * 60000;
      const key = `${o.event.id}@${o.start}`;
      if (at <= now && now < o.end && !ctl.dismissed.has(key)) due.push({ key, title: o.event.title, when: new Date(o.start).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) });
    }
    setReminders((cur) => (JSON.stringify(cur) === JSON.stringify(due) ? cur : due));
  }, [ctl]);
  useEffect(() => {
    checkReminders();
    const id = setInterval(checkReminders, 30000);
    return () => clearInterval(id);
  }, [checkReminders, ctl.data.events]);

  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (ctl.dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', before);
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
        unlisten = await getCurrentWindow().onCloseRequested((e) => {
          if (ctl.dirty && !ctl.filePath && !window.confirm(t('Hay cambios sin guardar. ¿Cerrar y descartarlos?'))) e.preventDefault();
        });
      });
    }
    return () => {
      window.removeEventListener('beforeunload', before);
      unlisten?.();
    };
  }, [ctl]);

  const tabs = useMemo(() => mailTabs(ui, ctl.section), [ui, ctl.section]);
  const backstage: BackstageEntry[] = useMemo(() => {
    const pages = backstageEntries(module.name).filter((e) => e.kind === 'page');
    return [
      { kind: 'command', command: 'mail.new' },
      { kind: 'command', command: 'mail.open' },
      { kind: 'separator' },
      { kind: 'command', command: 'mail.save' },
      { kind: 'command', command: 'mail.saveAs' },
      { kind: 'separator' },
      ...pages,
      { kind: 'command', command: 'mail.about' },
      { kind: 'command', command: 'file.close' },
    ] as BackstageEntry[];
  }, [module.name]);

  const sel = ctl.selected;
  const unreadAll = ctl.data.messages.filter((m) => m.folder === 'inbox' && !m.read).length;

  return (
    <AppFrame
      appId={module.id}
      appName={module.name}
      registry={registry}
      tabs={tabs}
      qat={['mail.save', 'mail.compose']}
      docTitle={ctl.docTitle}
      backstage={backstage}
      statusLeft={
        <>
          <span>{ctl.section === 'mail' ? t('{n} mensajes', { n: ctl.list().length }) : ctl.section === 'calendar' ? t('{n} eventos', { n: ctl.data.events.length }) : ctl.section === 'contacts' ? t('{n} contactos', { n: ctl.data.contacts.length }) : t('{n} tareas', { n: ctl.data.tasks.length })}</span>
          {status && <span aria-live="polite">{status}</span>}
          {ctl.syncMessage && <span aria-live="polite" data-testid="sync-status">{t(ctl.syncMessage)}</span>}
          {ctl.pendingCount > 0 && <span data-testid="pending-status">{ctl.pendingCount === 1 ? t('1 cambio sin enviar al servidor') : t('{n} cambios sin enviar al servidor', { n: ctl.pendingCount })}</span>}
        </>
      }
      contentFill
    >
      <div className="ml-app">
        <nav className="ml-rail" aria-label={t('Secciones')}>
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
            <FolderTree ctl={ctl} />
            <div className="ml-mail__center">
              <div className="ml-searchbar">
                <input
                  ref={searchRef}
                  type="search"
                  aria-label={t('Buscar correo')}
                  placeholder={t('Buscar en esta carpeta (empieza con * para buscar en todas)')}
                  value={ctl.query}
                  onChange={(e) => {
                    ctl.query = e.target.value;
                    ctl.touch();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      ctl.query = '';
                      ctl.touch();
                    }
                  }}
                />
              </div>
              <MessageList ctl={ctl} />
            </div>
            {ctl.showReadingPane && (
              <div className="ml-mail__pane">
                {sel ? (
                  <>
                    <div className="ml-mail__actions" role="toolbar" aria-label={t('Acciones del mensaje')}>
                      {ctl.folder === 'drafts' ? (
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
                      <button type="button" className="ml-btn" onClick={() => ctl.forward(sel.id)}>
                        {t('Reenviar')}
                      </button>
                      <button type="button" className="ml-btn" onClick={() => ctl.delete(sel.id)}>
                        {t('Eliminar')}
                      </button>
                    </div>
                    <ReadingPane key={sel.id} rec={sel} onLink={setLink} />
                  </>
                ) : (
                  <div className="ml-empty">{t('Selecciona un mensaje para leerlo.')}</div>
                )}
              </div>
            )}
          </div>
        )}
        {ctl.section === 'calendar' && <CalendarView ctl={ctl} />}
        {ctl.section === 'contacts' && <ContactsView ctl={ctl} />}
        {ctl.section === 'tasks' && <TasksView ctl={ctl} />}

        {reminders.length > 0 && (
          <div className="ml-toasts" role="region" aria-label={t('Recordatorios')} aria-live="polite">
            {reminders.map((r) => (
              <div key={r.key} className="ml-toast">
                <strong>{r.title || t('(sin título)')}</strong>
                <span>{r.when}</span>
                <button
                  type="button"
                  className="ml-btn"
                  onClick={() => {
                    ctl.dismissed.add(r.key);
                    checkReminders();
                  }}
                >
                  {t('Descartar')}
                </button>
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
        <StickyDialog open={!!ctl.compose} onClose={() => ctl.closeCompose()} width={760}>
          {ctl.compose && <ComposeBody key={ctl.compose.id} ctl={ctl} c={ctl.compose} onExport={(raw, name) => void saveBytes(`${clean(name)}.eml`, new TextEncoder().encode(raw), [{ name: 'Mensaje', extensions: ['eml'] }])} />}
        </StickyDialog>
        <LinkConfirm link={link} onClose={() => setLink(null)} />
        <StickyDialog open={dialog !== null} onClose={() => setDialog(null)} width={dialog === 'accounts' ? 640 : undefined}>
          {dialog === 'settings' && <SettingsDialog ctl={ctl} onClose={() => setDialog(null)} />}
          {dialog === 'accounts' && <AccountsDialog ctl={ctl} onClose={() => setDialog(null)} />}
          {dialog === 'about' && (
            <Modal title={t('Acerca de Nova Mail')} onClose={() => setDialog(null)}>
              <p>Nova Mail 0.0.7</p>
              <p>{t('Correo, calendario, contactos y tareas libres (MPL-2.0) de SuiteNova. Se conecta a servidores IMAP, POP3, JMAP y Exchange (EWS) con contraseña u OAuth desde la aplicación de escritorio, mantiene todas las carpetas al día y trabaja con archivos (.eml, .mbox, .ics, .vcf, .msg, .pst, .ost). Consulta docs/LIMITACIONES.md.')}</p>
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
