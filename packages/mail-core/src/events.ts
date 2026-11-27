import { expandEvent, type Attendee, type CalEvent, type EventChange, type PartStat, type Person } from './ics';

/* Changing appointments: one occurrence of a series or the whole of it. Nothing here changes what it is given. */

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const readPerson = (v: unknown): Person | undefined => {
  const p = v as Partial<Person> | undefined;
  return p && typeof p.email === 'string' && /^[^\s<>,;"]+@[^\s<>,;"]+$/.test(p.email) ? { name: str(p.name), email: p.email } : undefined;
};

/** What is known about meetings and changed occurrences of a saved appointment; what cannot be understood is left out. */
export function readEvent(e: CalEvent): CalEvent {
  const out: CalEvent = { ...e, exdates: Array.isArray(e.exdates) ? e.exdates.filter(num) : [] };
  const organizer = readPerson(e.organizer);
  if (organizer) out.organizer = organizer;
  else delete out.organizer;
  const attendees = (Array.isArray(e.attendees) ? e.attendees : []).slice(0, 500).flatMap((a): Attendee[] => {
    const who = readPerson(a);
    return who ? [{ ...who, status: a.status === 'accepted' || a.status === 'tentative' || a.status === 'declined' ? a.status : 'needs-action', ...(a.optional === true ? { optional: true } : {}) }] : [];
  });
  if (attendees.length) out.attendees = attendees;
  else delete out.attendees;
  const changes = (Array.isArray(e.changes) ? e.changes : [])
    .filter((c) => c && num(c.at) && num(c.start) && num(c.end))
    .map((c) => ({ at: c.at, title: str(c.title), location: str(c.location), description: str(c.description), start: c.start, end: c.end, reminder: num(c.reminder) ? c.reminder : null }));
  if (changes.length) out.changes = changes;
  else delete out.changes;
  for (const key of ['sequence', 'sent', 'recurrenceId'] as const) if (!num(out[key])) delete out[key];
  if (out.cancelled !== true) delete out.cancelled;
  if (typeof out.calendar !== 'string' || !out.calendar) delete out.calendar;
  return out;
}

/** The series as the rule makes it, without what was taken away or changed. */
const plain = (e: CalEvent): CalEvent => ({ ...e, exdates: [], changes: undefined });

/** Whether the rule of a series makes an occurrence at that moment. */
export const occursAt = (e: CalEvent, at: number): boolean => !!e.rrule && expandEvent(plain(e), at, at + 1).some((o) => o.start === at);

/** An occurrence as it is now: what was changed, or what the series says. */
export function occurrenceOf(e: CalEvent, at: number): EventChange {
  const changed = e.changes?.find((c) => c.at === at);
  return changed ?? { at, title: e.title, location: e.location, description: e.description, start: at, end: at + (e.end - e.start), reminder: e.reminder };
}

const withChanges = (e: CalEvent, changes: EventChange[]): CalEvent => {
  const out: CalEvent = { ...e, changes: changes.sort((a, b) => a.at - b.at) };
  if (!out.changes!.length) delete out.changes;
  return out;
};

/** Changes one occurrence. If it ends up like the series says, it stops being a change. */
export function changeOccurrence(e: CalEvent, at: number, patch: Partial<Omit<EventChange, 'at'>>): CalEvent {
  const next = { ...occurrenceOf(e, at), ...patch, at };
  const usual = occurrenceOf({ ...e, changes: undefined }, at);
  const same = (['title', 'location', 'description', 'start', 'end', 'reminder'] as const).every((k) => next[k] === usual[k]);
  const others = (e.changes ?? []).filter((c) => c.at !== at);
  return withChanges(e, same ? others : [...others, next]);
}

/** Takes one occurrence out of a series. */
export function removeOccurrence(e: CalEvent, at: number): CalEvent {
  return withChanges(
    { ...e, exdates: e.exdates.includes(at) ? e.exdates : [...e.exdates, at] },
    (e.changes ?? []).filter((c) => c.at !== at),
  );
}

/**
 * A series that was edited: what was taken away or changed follows it if the whole of it moved, and what no longer
 * corresponds to an occurrence is forgotten.
 */
export function changeSeries(before: CalEvent, after: CalEvent): CalEvent {
  if (!after.rrule) {
    const out = { ...after, exdates: [] };
    delete out.changes;
    return out;
  }
  const shift = after.start - before.start;
  const base = { ...after, exdates: [] as number[], changes: undefined };
  const exdates = before.exdates.map((x) => x + shift).filter((x) => occursAt(base, x));
  const changes = (before.changes ?? [])
    .map((c) => ({ ...c, at: c.at + shift, start: c.start + shift, end: c.end + shift }))
    .filter((c) => occursAt(base, c.at));
  return withChanges({ ...after, exdates }, changes);
}

/** How many changes and removals of single occurrences an edit of the series would lose. */
export function lostBy(before: CalEvent, after: CalEvent): number {
  const kept = changeSeries(before, after);
  const count = (e: CalEvent) => e.exdates.length + (e.changes?.length ?? 0);
  return Math.max(0, count(before) - count(kept));
}

/**
 * Moves or stretches an appointment (or one occurrence of a series): `start` and `end` are how far each end goes.
 * It never ends before it starts.
 */
export function shiftEvent(e: CalEvent, original: number | undefined, start: number, end: number): CalEvent {
  const from = original !== undefined && e.rrule ? occurrenceOf(e, original) : e;
  const s = from.start + start;
  const f = Math.max(s + (e.allDay ? 86400_000 : 15 * 60_000), from.end + end);
  return original !== undefined && e.rrule ? changeOccurrence(e, original, { start: s, end: f }) : { ...e, start: s, end: f };
}

// ---------------------------------------------------------------- meetings

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export const attendeeOf = (e: Pick<CalEvent, 'attendees'>, own: ReadonlySet<string>): Attendee | undefined => e.attendees?.find((a) => own.has(a.email.toLowerCase()));

export const isMeeting = (e: Pick<CalEvent, 'attendees' | 'organizer'>): boolean => !!e.attendees?.length || !!e.organizer;

/** Whether the person calls the meeting (or it is a plain appointment of theirs). */
export const organizes = (e: Pick<CalEvent, 'organizer'>, own: ReadonlySet<string>): boolean => !e.organizer || own.has(e.organizer.email.toLowerCase());

/** The people of a meeting, keeping the answers of the ones who were already invited. */
export function invitees(before: Attendee[] | undefined, people: Person[]): Attendee[] {
  const out: Attendee[] = [];
  for (const p of people) {
    if (!p.email || out.some((a) => same(a.email, p.email))) continue;
    const had = before?.find((a) => same(a.email, p.email));
    out.push(had ? { ...had, name: p.name || had.name } : { name: p.name, email: p.email, status: 'needs-action' });
  }
  return out;
}

export const PARTSTATS: Record<PartStat, string> = { 'needs-action': 'Sin respuesta', accepted: 'Aceptó', tentative: 'Provisional', declined: 'Rechazó' };

/** The moments of a meeting that would require asking the others again when they change. */
export const timeChanged = (a: CalEvent, b: CalEvent): boolean => a.start !== b.start || a.end !== b.end || a.rrule !== b.rrule || a.allDay !== b.allDay;
