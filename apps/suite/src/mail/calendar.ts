import {
  DEFAULT_CALENDAR,
  addCalendar,
  answerRequest,
  applyCancel,
  applyReply,
  attendeeOf,
  buildMessage,
  calendarsOf,
  cancelMessage,
  changeCalendar,
  changeOccurrence,
  findInvite,
  newEvent,
  newMailId,
  occurrenceOf,
  organizes,
  parseMessage,
  rawOf,
  removeCalendar,
  removeOccurrence,
  requestMessage,
  replyMessage,
  shiftEvent,
  type CalEvent,
  type CalendarInfo,
  type EventChange,
  type Invite,
  type InviteMessage,
  type MailRecord,
  type PartStat,
  type Person,
  type TaskItem,
} from '@suitenova/mail-core';
import type { MailCtl } from './ctl';
import type { RemoteAccount } from './remote';

/** How many changes of the calendar can be undone. */
const DEPTH = 30;
const NO_ACCOUNT = 'No hay ninguna cuenta con la que enviar: guarda la invitación como .eml y envíala con otro programa.';

export type Answer = Exclude<PartStat, 'needs-action'>;

/** What was sent, and what the others answered, is not undone: a version number must never be used twice. */
function keepSent(back: CalEvent, now: CalEvent | undefined): CalEvent {
  if (now?.sent === undefined) return back;
  const said = new Map(now.attendees?.map((a) => [a.email.toLowerCase(), a.status]));
  return { ...back, organizer: now.organizer, sequence: now.sequence, sent: now.sent, attendees: back.attendees?.map((a) => ({ ...a, status: said.get(a.email.toLowerCase()) ?? a.status })) };
}

/** The calendar of the open mailbox: appointments and their changes, several calendars and meetings by mail. */
export class MailCalendar {
  private past: { label: string; events: CalEvent[] }[] = [];
  /** The calendar the next .ics is imported into. */
  importInto: string | undefined;

  constructor(private readonly ctl: MailCtl) {}

  reset(): void {
    this.past = [];
    this.importInto = undefined;
  }

  private get data() {
    return this.ctl.data;
  }

  // ---------- changes ----------

  /** Changes the appointments; one undo takes it back. */
  change(label: string, run: () => void): void {
    const before = structuredClone(this.data.events);
    run();
    if (JSON.stringify(before) === JSON.stringify(this.data.events)) return;
    this.past.push({ label, events: before });
    if (this.past.length > DEPTH) this.past.shift();
    this.ctl.touch(true);
  }

  get undoLabel(): string {
    return this.past[this.past.length - 1]?.label ?? '';
  }

  undo(): void {
    const step = this.past.pop();
    if (!step) return;
    const now = new Map(this.data.events.map((e) => [e.id, e]));
    this.data.events = step.events.map((e) => keepSent(e, now.get(e.id)));
    if (!this.data.events.some((e) => e.id === this.ctl.selectedEvent)) this.ctl.selectedEvent = null;
    this.ctl.touch(true);
  }

  private replace(id: string, label: string, next: (e: CalEvent) => CalEvent): void {
    this.change(label, () => {
      this.data.events = this.data.events.map((e) => (e.id === id ? next(e) : e));
    });
  }

  find(id: string): CalEvent | undefined {
    return this.data.events.find((e) => e.id === id);
  }

  /** The calendar new appointments go to: the first one that is being shown. */
  get target(): CalendarInfo {
    const all = calendarsOf(this.data);
    return all.find((c) => !c.hidden) ?? all[0]!;
  }

  newAt(start: number, end: number, allDay: boolean): CalEvent {
    const e = { ...newEvent(start, end, ''), allDay };
    if (this.target.id !== DEFAULT_CALENDAR) e.calendar = this.target.id;
    return e;
  }

  move(id: string, original: number | undefined, start: number, end: number): void {
    this.replace(id, 'Mover cita', (e) => shiftEvent(e, original, start, end));
  }

  changeOne(id: string, at: number, patch: Partial<Omit<EventChange, 'at'>>): void {
    this.replace(id, 'Cambiar cita', (e) => changeOccurrence(e, at, patch));
  }

  removeOne(id: string, at: number): void {
    this.replace(id, 'Eliminar cita', (e) => removeOccurrence(e, at));
  }

  import(events: CalEvent[], tasks: TaskItem[]): void {
    const into = this.importInto && calendarsOf(this.data).some((c) => c.id === this.importInto) ? this.importInto : undefined;
    this.importInto = undefined;
    this.change('Importar calendario', () => {
      this.data.events = [...this.data.events, ...events.map((e) => (into && into !== DEFAULT_CALENDAR ? { ...e, calendar: into } : e))];
    });
    this.data.tasks = [...this.data.tasks, ...tasks];
    this.ctl.touch(true);
  }

  // ---------- calendars ----------

  add(name: string, color: string): string {
    const c = addCalendar(this.data, `c${newMailId()}`, name, color);
    this.ctl.touch(true);
    return c.id;
  }

  edit(id: string, patch: Partial<Omit<CalendarInfo, 'id'>>): void {
    changeCalendar(this.data, id, patch);
    this.ctl.touch(true);
  }

  remove(id: string): number {
    const n = removeCalendar(this.data, id);
    // what was done to its appointments cannot be taken back once the calendar is gone
    this.past = [];
    this.ctl.touch(true);
    return n;
  }

  // ---------- meetings ----------

  /** Whether the appointment can be moved and edited: not a meeting someone else calls. */
  editable(e: CalEvent): boolean {
    return !e.cancelled && organizes(e, this.ctl.ownAddresses());
  }

  get canInvite(): boolean {
    return this.ctl.canConnect && this.ctl.accounts.length > 0;
  }

  private accountOf(emails: (string | undefined)[], fallback?: string): RemoteAccount | undefined {
    const wanted = new Set(emails.filter(Boolean).map((e) => e!.toLowerCase()));
    return this.ctl.accounts.find((a) => wanted.has(a.email.toLowerCase())) ?? this.ctl.accounts.find((a) => a.id === fallback) ?? this.ctl.accounts[0];
  }

  /** Who the person is when writing from an account (or without one). */
  private person(account?: RemoteAccount): Person {
    if (account) return { name: this.data.owner.name || account.name, email: account.email };
    return this.data.owner.email ? this.data.owner : { name: this.data.owner.name, email: 'yo@nova.local' };
  }

  private rawFor(from: Person, msg: InviteMessage, to: Person[], inReplyTo?: string): string {
    return buildMessage({ from, to, cc: [], bcc: [], subject: msg.subject, text: msg.text, attachments: [], inReplyTo, references: inReplyTo ? [inReplyTo] : undefined, calendar: { method: msg.method, ics: msg.ics } });
  }

  /** The people a message of a meeting goes to: everyone but the person. */
  private others(msg: InviteMessage, from: Person): Person[] {
    const own = this.ctl.ownAddresses();
    own.add(from.email.toLowerCase());
    return msg.to.filter((p) => !own.has(p.email.toLowerCase()));
  }

  private post(account: RemoteAccount, msg: InviteMessage, inReplyTo?: string): void {
    const from = this.person(account);
    const to = this.others(msg, from);
    if (!to.length) throw new Error('Falta algún invitado.');
    this.ctl.post(this.rawFor(from, msg, to, inReplyTo), { account: account.id, recipients: to.map((p) => p.email), at: Date.now(), kind: 'queued' });
  }

  /** The meeting with the person as its organizer and the number of the version about to be sent. */
  private versioned(e: CalEvent, account?: RemoteAccount): CalEvent {
    const sequence = e.sent === undefined ? (e.sequence ?? 0) : Math.max(e.sequence ?? 0, e.sent) + 1;
    return { ...e, organizer: e.organizer ?? this.person(account), sequence };
  }

  /** What would be sent about a meeting, or about one occurrence of it. */
  private about(e: CalEvent, at: number | undefined): CalEvent {
    if (at === undefined || !e.rrule) return e;
    const { at: _at, ...how } = occurrenceOf(e, at);
    return { ...e, ...how, rrule: '', exdates: [], changes: undefined, recurrenceId: at };
  }

  /**
   * Invites the people of a meeting, or sends them its new version (of the whole, or of one occurrence). It goes
   * through the Outbox: without connection it waits there.
   */
  invite(id: string, at?: number): void {
    const e = this.find(id);
    if (!e?.attendees?.length) throw new Error('La reunión no tiene invitados.');
    const account = this.accountOf([e.organizer?.email]);
    if (!account) throw new Error(NO_ACCOUNT);
    const next = this.versioned(e, account);
    const update = e.sent !== undefined;
    this.post(account, requestMessage(this.about(next, at), update));
    // noted outside the undo: what was sent stays sent
    this.data.events = this.data.events.map((x) => (x.id === id ? { ...next, sent: next.sequence } : x));
    this.ctl.touch(true);
  }

  /** The invitation as a message to send with another program. */
  invitationFile(id: string): string {
    const e = this.find(id);
    if (!e?.attendees?.length) throw new Error('La reunión no tiene invitados.');
    const account = this.accountOf([e.organizer?.email]);
    const next = this.versioned(e, account);
    const from = next.organizer!;
    const msg = requestMessage(next, e.sent !== undefined);
    return this.rawFor(from, msg, this.others(msg, from));
  }

  /** Cancels a meeting that was sent (or one occurrence of it), telling the people if asked to. */
  cancel(id: string, at: number | undefined, tell: boolean): void {
    const e = this.find(id);
    if (!e) return;
    if (tell && e.attendees?.length && e.sent !== undefined) {
      const account = this.accountOf([e.organizer?.email]);
      if (!account) throw new Error(NO_ACCOUNT);
      const next = this.versioned(e, account);
      this.post(account, cancelMessage(this.about(next, at)));
      this.data.events = this.data.events.map((x) => (x.id === id ? { ...next, sent: next.sequence } : x));
    }
    if (at !== undefined && e.rrule) this.removeOne(id, at);
    else
      this.change('Cancelar reunión', () => {
        this.data.events = this.data.events.filter((x) => x.id !== id);
      });
    if (this.ctl.selectedEvent === id && !this.find(id)) this.ctl.selectedEvent = null;
    this.ctl.touch(true);
  }

  // ---------- invitations that arrive ----------

  invitationOf(m: MailRecord): Invite | null {
    return findInvite(parseMessage(rawOf(m)));
  }

  /** The addresses of the person, also the one the message was delivered to. */
  private ownFor(m: MailRecord): Set<string> {
    const own = this.ctl.ownAddresses();
    for (const [k, v] of parseMessage(rawOf(m)).headers) if (/^(delivered-to|x-original-to)$/i.test(k)) own.add(v.trim().toLowerCase());
    return own;
  }

  /** Answers an invitation: puts it in the calendar (or takes it out) and, if asked, tells the organizer. */
  respond(messageId: string, answer: Answer, tell: boolean): void {
    const m = this.data.messages.find((x) => x.id === messageId);
    const invite = m && this.invitationOf(m);
    if (!m || invite?.method !== 'REQUEST') return;
    const own = this.ownFor(m);
    const asked = attendeeOf(invite.event, own);
    const account = this.accountOf([asked?.email], this.ctl.accountFor(m));
    if (tell) {
      if (!this.canInvite || !account) throw new Error('No hay ninguna cuenta con la que enviar la respuesta.');
      const me = asked ? { name: this.data.owner.name || asked.name, email: asked.email } : this.person(account);
      const reply = replyMessage(invite, me, answer);
      if (!reply) throw new Error('La invitación no dice quién organiza la reunión.');
      this.post(account, reply, m.mid);
    }
    this.change('Responder invitación', () => void answerRequest(this.data, invite, answer, own, this.target.id === DEFAULT_CALENDAR ? undefined : this.target.id));
    m.rsvp = answer;
    this.ctl.touch(true);
  }

  /** Takes out of the calendar what a cancellation from the organizer says. */
  removeCancelled(messageId: string): boolean {
    const m = this.data.messages.find((x) => x.id === messageId);
    const invite = m && this.invitationOf(m);
    if (!m || invite?.method !== 'CANCEL') return false;
    let done = false;
    this.change('Quitar reunión cancelada', () => {
      done = applyCancel(this.data, invite, m.fromEmail);
    });
    return done;
  }

  /** Notes in the calendar the answer a message brings. */
  noteReply(messageId: string): void {
    const m = this.data.messages.find((x) => x.id === messageId);
    if (m?.meeting !== 'REPLY' || m.folder === 'junk' || m.folder === 'trash') return;
    const invite = this.invitationOf(m);
    if (invite && applyReply(this.data, invite, m.fromEmail, this.ctl.ownAddresses())) this.ctl.touch(true);
  }

  noteReplies(ids: string[]): void {
    for (const id of ids) this.noteReply(id);
  }
}
