import type { LibraryId } from '../macros/security';
import { basic } from '@suitenova/base-core';
import { addRaw, newContact, newEvent, newTask, parseMessage, rawOf, inFolder, type CalEvent, type Contact, type MailRecord, type TaskItem } from '@suitenova/mail-core';
import { msgBox } from '../base/runtime';
import '../macros/messages';
import { collection, makeObject, noMember, type ParamTable } from '../macros/objects';
import { MacroRuntime, type MacroRun } from '../macros/runtime';
import type { ComposeState, MailCtl } from './ctl';

type BVal = basic.BVal;
type BObject = basic.BObject;
const { BasicError, toNum, toStr, toBool } = basic;

export type { MacroRun };

/** The constants of the Outlook object model that macros use, by lower-case name. */
export const OL_CONSTANTS: Record<string, number> = {
  olmailitem: 0, olappointmentitem: 1, olcontactitem: 2, oltaskitem: 3,
  olfolderdeleteditems: 3, olfoldersentmail: 5, olfolderinbox: 6, olfoldercalendar: 9, olfoldercontacts: 10, olfoldertasks: 13, olfolderdrafts: 16, olfolderjunk: 23,
  olimportancelow: 0, olimportancenormal: 1, olimportancehigh: 2,
  olnoflag: 0, olflagmarked: 2, olflagcomplete: 1,
  vbyes: 6, vbno: 7, vbyesno: 4, vbquestion: 32, vbexclamation: 48,
};

const FOLDER_OF: Record<number, string> = { 3: 'trash', 5: 'sent', 6: 'inbox', 16: 'drafts', 23: 'junk' };
const PARAMS: ParamTable = { createitem: ['itemtype'], getdefaultfolder: ['foldertype'], restrict: ['filter'], move: ['destfolder'] };

/** The `[Field] = value And [Other] = value` filters of `Items.Restrict`, as pairs of field and text to compare. */
function parseFilter(filter: string): { field: string; op: string; value: string }[] {
  const out: { field: string; op: string; value: string }[] = [];
  for (const part of filter.split(/\s+and\s+/i)) {
    const m = /^\s*\[([^\]]+)\]\s*(=|<>|like)\s*(?:'((?:[^']|'')*)'|"((?:[^"]|"")*)"|(\S+))\s*$/i.exec(part);
    if (!m) throw new BasicError(5, `Filtro no admitido: ${part.trim()}`);
    out.push({ field: m[1]!, op: m[2]!.toLowerCase(), value: (m[3] ?? m[4] ?? m[5] ?? '').replace(/''/g, "'").replace(/""/g, '"') });
  }
  return out;
}

/** Runs the macros of the mail program: Nova Basic with the objects of Outlook (Application, Namespace, Folder, MailItem…). */
export class MailRuntime extends MacroRuntime {
  constructor(readonly ctl: MailCtl) {
    super();
  }
  get libraryId(): LibraryId | undefined {
    return 'mail';
  }
  get modules(): { name: string; code: string }[] {
    return this.ctl.macros;
  }
  protected enabled(): boolean {
    return this.ctl.macrosEnabled;
  }
  protected changed(): void {
    this.ctl.touch();
  }
  protected hostObjects(): Record<string, BVal> {
    return { ...OL_CONSTANTS, ...this.objects() };
  }

  /** The interface is told once, when the macro ends. */
  protected guarded(fn: () => MacroRun): MacroRun {
    if (++this.depth > 20) {
      this.depth--;
      return { ok: false, error: 'Demasiadas llamadas anidadas.' };
    }
    let result: MacroRun = { ok: true };
    try {
      this.ctl.batch(() => {
        try {
          result = fn();
        } catch (e) {
          result = this.report(e);
          this.lastAt = result.at;
        }
      });
    } finally {
      this.depth--;
    }
    return result;
  }

  /** `Application_Startup`: once when the program starts, if the macros are enabled. */
  runStartup(): void {
    if (!this.ctl.macrosEnabled || !this.modules.length || !this.hasProcedure('Application_Startup')) return;
    const r = this.run('Application_Startup');
    if (!r.ok) this.print(`⚠ Application_Startup: ${r.error}`);
  }

  private objects(): Record<string, BVal> {
    const rt = this;
    const ctl = this.ctl;
    const make = (def: Parameters<typeof makeObject>[0]) => makeObject(def, PARAMS);
    const err = (msg: string, n = 5): never => {
      throw new BasicError(n, msg);
    };
    const date = (t: number | null): BVal => (t === null ? undefined : new Date(t));
    const ms = (v: BVal): number => {
      if (v instanceof Date) return v.getTime();
      const d = new Date(toStr(v));
      if (Number.isNaN(d.getTime())) return err('Fecha no válida.', 13);
      return d.getTime();
    };

    // ---- mail
    const fmtList = (l: { name: string; email: string }[]) => l.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join('; ');
    const messageOf = (rec: MailRecord) => parseMessage(rawOf(rec));
    const record = (id: string): MailRecord => ctl.data.messages.find((m) => m.id === id) ?? err('El mensaje ya no existe.', 91);

    /** A message that is being composed (not yet in the mailbox). */
    const composeItem = (c: ComposeState): BObject => {
      const field = (k: 'to' | 'cc' | 'bcc' | 'subject' | 'body') => ({ get: () => c[k] as BVal, set: (v: BVal) => void (c[k] = toStr(v)) });
      return make({
        type: 'MailItem',
        props: {
          to: field('to'),
          cc: field('cc'),
          bcc: field('bcc'),
          subject: field('subject'),
          body: field('body'),
          entryid: { get: () => c.id },
          unread: { get: () => 0 },
          attachments: { get: () => collection('Attachments', () => c.attachments.map((a) => make({ type: 'Attachment', props: { filename: { get: () => a.filename }, displayname: { get: () => a.filename } } }))) },
        },
        methods: {
          save: () => {
            ctl.saveDraft(c);
            return undefined;
          },
          display: () => {
            ctl.openCompose(c);
            return undefined;
          },
          send: () => {
            const acc = ctl.accounts[0];
            if (!acc) err('No hay ninguna cuenta de correo conectada desde la que enviar.', 287);
            if (!c.to.trim() && !c.cc.trim() && !c.bcc.trim()) err('Falta algún destinatario.', 287);
            // as Outlook's own guard: a program cannot send mail on the user's behalf without asking
            const answer = msgBox(`Un programa intenta enviar un mensaje de correo en tu nombre.\n\nPara: ${c.to || c.cc || c.bcc}\nAsunto: ${c.subject}\n\n¿Quieres enviarlo?`, 4 + 32, 'Nova Mail');
            if (answer !== 6) err('Se denegó el envío del mensaje.', 287);
            // sending goes out in the background (as to the Outbox): the macro goes on, and a failure shows in the status bar
            void ctl.send(c, acc!.id).catch((e) => {
              ctl.syncMessage = `No se pudo enviar el mensaje: ${(e as Error).message}`;
              ctl.touch();
            });
            return undefined;
          },
        },
      });
    };

    const mailItem = (id: string): BObject => {
      const rec = () => record(id);
      const readOnly = (what: string): never => err(`No se puede cambiar ${what} de un mensaje que ya existe.`, 287);
      const reply = (all: boolean) => {
        ctl.reply(id, all);
        return composeItem(ctl.compose!);
      };
      return make({
        type: 'MailItem',
        props: {
          subject: { get: () => rec().subject, set: () => readOnly('el asunto') },
          body: { get: () => messageOf(rec()).text ?? rec().preview, set: () => readOnly('el texto') },
          sendername: { get: () => rec().from },
          senderemailaddress: { get: () => rec().fromEmail },
          to: { get: () => rec().to },
          cc: { get: () => fmtList(messageOf(rec()).cc) },
          receivedtime: { get: () => date(rec().date) },
          senton: { get: () => date(rec().date) },
          unread: { get: () => (rec().read ? 0 : -1), set: (v) => ctl.setRead(id, !toBool(v)) },
          flagstatus: { get: () => (rec().flagged ? 2 : 0), set: (v) => { if ((toNum(v) === 2) !== rec().flagged) ctl.toggleFlag(id); } },
          attachments: { get: () => collection('Attachments', () => messageOf(rec()).attachments.map((a) => make({ type: 'Attachment', props: { filename: { get: () => a.filename }, displayname: { get: () => a.filename } } }))) },
          entryid: { get: () => id },
          size: { get: () => rec().size },
          parent: { get: () => folderObj(rec().folder) },
        },
        methods: {
          delete: () => {
            ctl.delete(id);
            return undefined;
          },
          move: (a) => {
            const dest = (a[0] as BObject | undefined)?.get('entryid', []);
            if (typeof dest !== 'string' || !ctl.move(id, dest)) err('No se pudo mover el mensaje a esa carpeta.', 5);
            return mailItem(id);
          },
          reply: () => reply(false),
          replyall: () => reply(true),
          forward: () => {
            ctl.forward(id);
            return composeItem(ctl.compose!);
          },
          save: () => undefined,
          display: () => {
            ctl.select(id);
            return undefined;
          },
        },
      });
    };

    // ---- calendar, contacts, tasks
    const eventItem = (src: CalEvent, isNew: boolean): BObject => {
      let ev = src;
      let stored = !isNew;
      const cur = (): CalEvent => (stored ? (ctl.data.events.find((e) => e.id === ev.id) ?? err('La cita ya no existe.', 91)) : ev);
      const set = (patch: Partial<CalEvent>) => {
        ev = { ...cur(), ...patch };
        if (stored) ctl.updateEvent(ev);
      };
      return make({
        type: 'AppointmentItem',
        props: {
          subject: { get: () => cur().title, set: (v) => set({ title: toStr(v) }) },
          start: { get: () => date(cur().start), set: (v) => set({ start: ms(v) }) },
          end: { get: () => date(cur().end), set: (v) => set({ end: ms(v) }) },
          location: { get: () => cur().location, set: (v) => set({ location: toStr(v) }) },
          body: { get: () => cur().description, set: (v) => set({ description: toStr(v) }) },
          alldayevent: { get: () => (cur().allDay ? -1 : 0), set: (v) => set({ allDay: toBool(v) }) },
          reminderminutesbeforestart: { get: () => cur().reminder ?? 0, set: (v) => set({ reminder: toNum(v) || null }) },
          entryid: { get: () => cur().id },
        },
        methods: {
          save: () => {
            if (!stored) {
              ctl.addEvent(ev);
              stored = true;
            }
            return undefined;
          },
          delete: () => {
            if (stored) ctl.deleteEvent(ev.id);
            return undefined;
          },
        },
      });
    };
    const contactItem = (src: Contact, isNew: boolean): BObject => {
      let c = src;
      let stored = !isNew;
      const cur = (): Contact => (stored ? (ctl.data.contacts.find((x) => x.id === c.id) ?? err('El contacto ya no existe.', 91)) : c);
      const set = (patch: Partial<Contact>) => {
        c = { ...cur(), ...patch };
        if (stored) ctl.updateContact(c);
      };
      const fullName = (p: Partial<Contact>) => [p.first, p.last].filter(Boolean).join(' ');
      return make({
        type: 'ContactItem',
        props: {
          fullname: { get: () => cur().name, set: (v) => set({ name: toStr(v) }) },
          firstname: { get: () => cur().first, set: (v) => set({ first: toStr(v), name: cur().name || fullName({ first: toStr(v), last: cur().last }) }) },
          lastname: { get: () => cur().last, set: (v) => set({ last: toStr(v), name: cur().name || fullName({ first: cur().first, last: toStr(v) }) }) },
          companyname: { get: () => cur().org, set: (v) => set({ org: toStr(v) }) },
          jobtitle: { get: () => cur().title, set: (v) => set({ title: toStr(v) }) },
          email1address: { get: () => cur().emails[0]?.value ?? '', set: (v) => set({ emails: [{ ...(cur().emails[0] ?? { label: 'trabajo' }), value: toStr(v) }, ...cur().emails.slice(1)] }) },
          body: { get: () => cur().note, set: (v) => set({ note: toStr(v) }) },
          entryid: { get: () => cur().id },
        },
        methods: {
          save: () => {
            if (!stored) {
              ctl.addContact(c);
              stored = true;
            }
            return undefined;
          },
          delete: () => {
            if (stored) ctl.deleteContact(c.id);
            return undefined;
          },
        },
      });
    };
    const taskItem = (src: TaskItem, isNew: boolean): BObject => {
      let t = src;
      let stored = !isNew;
      const cur = (): TaskItem => (stored ? (ctl.data.tasks.find((x) => x.id === t.id) ?? err('La tarea ya no existe.', 91)) : t);
      const set = (patch: Partial<TaskItem>) => {
        t = { ...cur(), ...patch };
        if (stored) ctl.updateTask(t);
      };
      const IMP = ['low', 'normal', 'high'] as const;
      return make({
        type: 'TaskItem',
        props: {
          subject: { get: () => cur().title, set: (v) => set({ title: toStr(v) }) },
          body: { get: () => cur().notes, set: (v) => set({ notes: toStr(v) }) },
          duedate: { get: () => date(cur().due), set: (v) => set({ due: ms(v) }) },
          complete: { get: () => (cur().done ? -1 : 0), set: (v) => set({ done: toBool(v), completedAt: toBool(v) ? Date.now() : null }) },
          importance: { get: () => IMP.indexOf(cur().priority), set: (v) => set({ priority: IMP[Math.trunc(toNum(v))] ?? 'normal' }) },
          entryid: { get: () => cur().id },
        },
        methods: {
          save: () => {
            if (!stored) {
              ctl.batch(() => {
                const made = ctl.addTask(t.title);
                ctl.updateTask({ ...t, id: made.id, uid: made.uid });
                t = { ...t, id: made.id, uid: made.uid };
              });
              stored = true;
            }
            return undefined;
          },
          delete: () => {
            if (stored) ctl.deleteTask(t.id);
            return undefined;
          },
        },
      });
    };

    // ---- items and folders
    const items = (kind: 'mail' | 'calendar' | 'contacts' | 'tasks', folderId: string): BObject => {
      const list = (): BObject[] => {
        if (kind === 'mail') return inFolder(ctl.data, folderId).map((m) => mailItem(m.id));
        if (kind === 'calendar') return ctl.data.events.map((e) => eventItem(e, false));
        if (kind === 'contacts') return ctl.data.contacts.map((c) => contactItem(c, false));
        return ctl.data.tasks.map((t) => taskItem(t, false));
      };
      const base = collection('Items', list);
      return make({
        type: 'Items',
        props: { count: { get: () => list().length } },
        methods: {
          restrict: (a) => {
            const conds = parseFilter(toStr(a[0]));
            const keep = list().filter((o) =>
              conds.every((c) => {
                const v = o.get(c.field, []);
                const text = v instanceof Date ? v.toISOString() : v === undefined || v === null ? '' : typeof v === 'boolean' ? (v ? 'true' : 'false') : toStr(v as never);
                const want = c.value;
                const same = typeof v === 'number' ? Number(want) === v || (want.toLowerCase() === 'true' && v !== 0) || (want.toLowerCase() === 'false' && v === 0) : text.toLowerCase() === want.toLowerCase();
                if (c.op === '=') return same;
                if (c.op === '<>') return !same;
                return text.toLowerCase().includes(want.replace(/^%|%$/g, '').toLowerCase());
              }),
            );
            return collection('Items', () => keep);
          },
          add: (a) => newItem(Math.trunc(a[0] === undefined ? 0 : toNum(a[0]))),
        },
        index: base.index,
        items: base.items,
      });
    };

    const folderObj = (id: string): BObject => {
      const kind = id === 'cal' ? 'calendar' : id === 'contacts' ? 'contacts' : id === 'tasks' ? 'tasks' : 'mail';
      const folder = () => ctl.data.folders.find((f) => f.id === id);
      const name = () => (kind === 'calendar' ? 'Calendario' : kind === 'contacts' ? 'Contactos' : kind === 'tasks' ? 'Tareas' : (folder()?.name ?? err('La carpeta ya no existe.', 91)));
      return make({
        type: 'Folder',
        props: {
          name: { get: name },
          entryid: { get: () => id },
          items: { get: () => items(kind, id) },
          folders: { get: () => collection('Folders', () => ctl.data.folders.filter((f) => f.parent === id).map((f) => folderObj(f.id)), (o) => toStr(o.get('name', []))) },
        },
        methods: {
          additem: () => undefined,
        },
      });
    };

    const newItem = (type: number): BObject => {
      if (type === 0) {
        const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        return composeItem({ id, to: '', cc: '', bcc: '', subject: '', body: '', attachments: [] });
      }
      if (type === 1) return eventItem(newEvent(Date.now(), Date.now() + 3600000, ''), true);
      if (type === 2) return contactItem(newContact(), true);
      if (type === 3) return taskItem(newTask(''), true);
      return err(`Tipo de elemento no admitido: ${type}`);
    };

    const defaultFolder = (n: number): BObject => {
      if (n === 9) return folderObj('cal');
      if (n === 10) return folderObj('contacts');
      if (n === 13) return folderObj('tasks');
      const id = FOLDER_OF[n];
      if (!id) return err(`Carpeta predeterminada no admitida: ${n}`);
      return folderObj(id);
    };

    const namespace = make({
      type: 'NameSpace',
      props: {
        folders: { get: () => collection('Folders', () => ctl.data.folders.filter((f) => !f.parent).map((f) => folderObj(f.id)), (o) => toStr(o.get('name', []))) },
        currentuser: { get: () => make({ type: 'Recipient', props: { name: { get: () => ctl.data.owner.name }, address: { get: () => ctl.data.owner.email } } }) },
      },
      methods: { getdefaultfolder: (a) => defaultFolder(Math.trunc(toNum(a[0]))) },
    });

    const app = make({
      type: 'Application',
      props: {
        name: { get: () => 'Nova Mail' },
        version: { get: () => '16.0' },
        session: { get: () => namespace },
        activeexplorer: {
          get: () =>
            make({
              type: 'Explorer',
              props: { currentfolder: { get: () => folderObj(ctl.section === 'calendar' ? 'cal' : ctl.section === 'contacts' ? 'contacts' : ctl.section === 'tasks' ? 'tasks' : ctl.folder) } },
            }),
        },
      },
      methods: {
        getnamespace: (a) => {
          if (toStr(a[0]).toUpperCase() !== 'MAPI') err('Solo se admite el espacio de nombres «MAPI».', 5);
          return namespace;
        },
        createitem: (a) => newItem(Math.trunc(a[0] === undefined ? 0 : toNum(a[0]))),
        quit: () => undefined,
      },
    });
    void noMember;
    void addRaw;
    void rt;
    return { application: app, session: namespace };
  }
}
