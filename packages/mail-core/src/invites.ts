import { attendeeOf, changeOccurrence, organizes, removeOccurrence } from './events';
import { newId, occurrencesBetween, parseIcs, writeIcs, type CalEvent, type PartStat, type Person } from './ics';
import type { ParsedMessage } from './mime';
import type { MailData } from './store';

/*
 * Invitations by mail (iCalendar, RFC 5546): a request to a meeting, the answer to it and its cancellation. The sender
 * of a message can be forged: what an invitation asks for is only done when the person says so, and an answer or a
 * cancellation only counts if it comes from who it should.
 */

export type InviteMethod = 'REQUEST' | 'REPLY' | 'CANCEL';
export interface Invite {
  method: InviteMethod;
  event: CalEvent;
}

/** The meeting a message speaks of, if it is an invitation, an answer or a cancellation. */
export function findInvite(m: Pick<ParsedMessage, 'calendar'>): Invite | null {
  if (!m.calendar) return null;
  const read = parseIcs(m.calendar);
  const method = (['REQUEST', 'REPLY', 'CANCEL'] as const).find((x) => x === read.method);
  const event = read.events[0];
  return method && event ? { method, event } : null;
}

const same = (a: string | undefined, b: string | undefined): boolean => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
const byUid = (d: MailData, uid: string): CalEvent | undefined => d.events.find((e) => e.uid === uid);

export interface InviteState {
  /** The appointment this invitation speaks of, if it is already in a calendar. */
  existing?: CalEvent;
  /** `new`, a newer version of one there, the same one, or older than the one there. */
  kind: 'new' | 'update' | 'same' | 'outdated';
  /** Why the invitation cannot be trusted; empty when nothing is odd. */
  warning: string;
}

export function inviteState(d: MailData, invite: Invite, from: string): InviteState {
  const existing = byUid(d, invite.event.uid);
  const organizer = invite.event.organizer?.email;
  let warning = '';
  if (existing?.organizer && organizer && !same(existing.organizer.email, organizer)) warning = 'El organizador no es el de la reunión que ya está en tu calendario.';
  else if (invite.method !== 'REPLY' && organizer && !same(organizer, from)) warning = 'El mensaje no viene de quien organiza la reunión.';
  if (!existing) return { kind: 'new', warning };
  const a = invite.event.sequence ?? 0;
  const b = existing.sequence ?? 0;
  return { existing, kind: a > b ? 'update' : a < b ? 'outdated' : 'same', warning };
}

/** What overlaps the meeting in the calendars, apart from itself. */
export function conflicts(d: MailData, e: CalEvent): CalEvent[] {
  if (e.allDay) return [];
  const others = d.events.filter((x) => x.uid !== e.uid && !x.allDay && !x.cancelled);
  return occurrencesBetween(others, e.start, Math.max(e.end, e.start + 1)).map((o) => o.event);
}

/**
 * Answers a request: accepted or tentative, the meeting goes into the calendar (or is brought up to date); declined, it
 * leaves it. Returns the appointment, or null if there is none now.
 */
export function answerRequest(d: MailData, invite: Invite, status: Exclude<PartStat, 'needs-action'>, own: ReadonlySet<string>, calendar?: string): CalEvent | null {
  const incoming = invite.event;
  const at = incoming.recurrenceId;
  const existing = byUid(d, incoming.uid);
  const mine = (e: CalEvent): CalEvent => ({ ...e, attendees: e.attendees?.map((a) => (own.has(a.email.toLowerCase()) ? { ...a, status } : a)) });
  // an invitation about one occurrence of a series already there
  if (at !== undefined && existing?.rrule) {
    const next = status === 'declined' ? removeOccurrence(existing, at) : changeOccurrence(existing, at, { title: incoming.title, location: incoming.location, description: incoming.description, start: incoming.start, end: incoming.end });
    d.events = d.events.map((e) => (e.id === existing.id ? next : e));
    return next;
  }
  if (status === 'declined') {
    if (existing) d.events = d.events.filter((e) => e.id !== existing.id);
    return null;
  }
  const next = mine({
    ...incoming,
    id: existing?.id ?? newId('e'),
    // what belongs to this calendar stays
    calendar: existing?.calendar ?? calendar,
    categories: existing?.categories ?? incoming.categories,
    reminder: existing ? existing.reminder : (incoming.reminder ?? 15),
    cancelled: undefined,
    sent: undefined,
  });
  for (const key of ['calendar', 'cancelled', 'sent', 'categories'] as const) if (next[key] === undefined) delete next[key];
  d.events = existing ? d.events.map((e) => (e.id === existing.id ? next : e)) : [...d.events, next];
  return next;
}

/** Takes a cancelled meeting out of the calendar. Only if the cancellation comes from its organizer. */
export function applyCancel(d: MailData, invite: Invite, from: string): boolean {
  const existing = byUid(d, invite.event.uid);
  if (!existing || !same(existing.organizer?.email, from)) return false;
  const at = invite.event.recurrenceId;
  if (at !== undefined && existing.rrule) d.events = d.events.map((e) => (e.id === existing.id ? removeOccurrence(e, at) : e));
  else d.events = d.events.filter((e) => e.id !== existing.id);
  return true;
}

/**
 * Notes the answer of someone invited to a meeting of the person. The answer must come from that person and be about
 * the version that was sent (or a later one). Returns who answered what, or null if it changes nothing.
 */
export function applyReply(d: MailData, invite: Invite, from: string, own: ReadonlySet<string>): { event: CalEvent; email: string; status: PartStat } | null {
  const existing = byUid(d, invite.event.uid);
  const answer = invite.event.attendees?.find((a) => same(a.email, from));
  if (!existing || !answer || answer.status === 'needs-action' || !organizes(existing, own)) return null;
  if ((invite.event.sequence ?? 0) < (existing.sequence ?? 0)) return null;
  const known = existing.attendees?.find((a) => same(a.email, from));
  if (!known || known.status === answer.status) return null;
  const next = { ...existing, attendees: existing.attendees!.map((a) => (a === known ? { ...a, status: answer.status } : a)) };
  d.events = d.events.map((e) => (e.id === existing.id ? next : e));
  return { event: next, email: known.email, status: answer.status };
}

export interface InviteMessage {
  subject: string;
  text: string;
  to: Person[];
  method: InviteMethod;
  ics: string;
}

const ics = (e: CalEvent, method: InviteMethod): string => writeIcs([{ ...e, reminder: method === 'REQUEST' ? e.reminder : null, categories: undefined }], [], 'Nova Mail', { method });

/** The when and where of a meeting, in words, for the text of the message. */
export function describeEvent(e: CalEvent, locale?: string): string {
  const day: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  const a = new Date(e.start);
  const last = new Date(e.allDay ? e.end - 1 : e.end);
  const oneDay = a.toDateString() === last.toDateString();
  const when = e.allDay
    ? oneDay
      ? a.toLocaleDateString(locale, day)
      : `${a.toLocaleDateString(locale, day)} – ${last.toLocaleDateString(locale, day)}`
    : oneDay
      ? `${a.toLocaleDateString(locale, day)}, ${a.toLocaleTimeString(locale, time)} – ${last.toLocaleTimeString(locale, time)}`
      : `${a.toLocaleString(locale, { ...day, ...time })} – ${last.toLocaleString(locale, { ...day, ...time })}`;
  return [when, e.location].filter(Boolean).join('\n');
}

/** The message that invites (or brings up to date) the people of a meeting. */
export const requestMessage = (e: CalEvent, update: boolean): InviteMessage => ({
  subject: `${update ? 'Actualización' : 'Invitación'}: ${e.title}`,
  text: [describeEvent(e), e.description].filter(Boolean).join('\n\n'),
  to: e.attendees ?? [],
  method: 'REQUEST',
  ics: ics(e, 'REQUEST'),
});

export const cancelMessage = (e: CalEvent): InviteMessage => ({
  subject: `Cancelada: ${e.title}`,
  text: `La reunión se ha cancelado.\n\n${describeEvent(e)}`,
  to: e.attendees ?? [],
  method: 'CANCEL',
  ics: ics({ ...e, cancelled: true }, 'CANCEL'),
});

const ANSWERS: Record<Exclude<PartStat, 'needs-action'>, string> = { accepted: 'Aceptada', tentative: 'Provisional', declined: 'Rechazada' };

/** The answer to the organizer; it names only who answers. Null when the invitation does not say who organizes. */
export function replyMessage(invite: Invite, me: Person, status: Exclude<PartStat, 'needs-action'>): InviteMessage | null {
  const e = invite.event;
  if (!e.organizer) return null;
  const had = attendeeOf(e, new Set([me.email.toLowerCase()]));
  const answer: CalEvent = { ...e, attendees: [{ name: me.name || had?.name || '', email: me.email, status }], changes: undefined, exdates: [] };
  return {
    subject: `${ANSWERS[status]}: ${e.title}`,
    text: `${me.name || me.email}: ${ANSWERS[status].toLowerCase()}\n\n${describeEvent(e)}`,
    to: [e.organizer],
    method: 'REPLY',
    ics: ics(answer, 'REPLY'),
  };
}
