/** iCalendar (RFC 5545): events and tasks. Times are kept as epoch milliseconds. */

import { readNames } from './categories';

export interface CalEvent {
  id: string;
  uid: string;
  title: string;
  location: string;
  description: string;
  /** Epoch ms. For all-day events: local midnight of the first day. */
  start: number;
  /** Epoch ms, exclusive. For all-day events: local midnight after the last day. */
  end: number;
  allDay: boolean;
  /** Recurrence rule without the `RRULE:` prefix, e.g. `FREQ=WEEKLY;BYDAY=MO,WE`. */
  rrule: string;
  /** Excluded occurrences (epoch ms of their start). */
  exdates: number[];
  /** Minutes before the start, or null for no reminder. */
  reminder: number | null;
  /** Colour categories, by name. */
  categories?: string[];
  /** The calendar it is in; without it, the first one. */
  calendar?: string;
  /** A meeting: who called it, and who was invited with their answer. */
  organizer?: Person;
  attendees?: Attendee[];
  /** The version of a meeting: it grows with each change that is sent. */
  sequence?: number;
  /** The version whose invitations were sent from here. */
  sent?: number;
  cancelled?: boolean;
  /** Single occurrences of a series that differ from it. */
  changes?: EventChange[];
  /** Read from an invitation that speaks of one occurrence only: the start it would have had. */
  recurrenceId?: number;
}

export interface Person {
  name: string;
  email: string;
}
export type PartStat = 'needs-action' | 'accepted' | 'tentative' | 'declined';
export interface Attendee extends Person {
  status: PartStat;
  optional?: boolean;
}

/** One occurrence of a series as it was changed. */
export interface EventChange {
  /** The start it would have had in the series. */
  at: number;
  title: string;
  location: string;
  description: string;
  start: number;
  end: number;
  reminder: number | null;
}

export interface TaskItem {
  id: string;
  uid: string;
  title: string;
  notes: string;
  /** Epoch ms of the due date (local midnight when `dueAllDay`), or null. */
  due: number | null;
  done: boolean;
  completedAt: number | null;
  priority: 'high' | 'normal' | 'low';
  categories?: string[];
}

let counter = 0;
export const newId = (p: string): string => `${p}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function newEvent(start: number, end: number, title = ''): CalEvent {
  const id = newId('e');
  return { id, uid: `${id}@nova.local`, title, location: '', description: '', start, end, allDay: false, rrule: '', exdates: [], reminder: null };
}

export function newTask(title = ''): TaskItem {
  const id = newId('t');
  return { id, uid: `${id}@nova.local`, title, notes: '', due: null, done: false, completedAt: null, priority: 'normal' };
}

// ---------- reading ----------

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

const unescapeText = (s: string): string => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const escapeText = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function unfold(text: string): string[] {
  const out: string[] = [];
  for (const l of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (/^[ \t]/.test(l) && out.length) out[out.length - 1] += l.slice(1);
    else out.push(l);
  }
  return out.filter((l) => l.trim() !== '');
}

function parseProp(line: string): Prop | null {
  let i = 0;
  let q = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === ':' && !q) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const bits: string[] = [];
  let cur = '';
  q = false;
  for (const c of head) {
    if (c === '"') q = !q;
    if (c === ';' && !q) {
      bits.push(cur);
      cur = '';
    } else cur += c;
  }
  bits.push(cur);
  const params: Record<string, string> = {};
  for (const b of bits.slice(1)) {
    const k = b.indexOf('=');
    if (k > 0) params[b.slice(0, k).toUpperCase()] = b.slice(k + 1).replace(/^"|"$/g, '');
  }
  return { name: bits[0]!.toUpperCase(), params, value };
}

/** Milliseconds that `tz` is ahead of UTC at the instant `epoch`; null when the zone is unknown. */
export function tzOffset(epoch: number, tz: string): number | null {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    const p = Object.fromEntries(f.formatToParts(new Date(epoch)).map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(epoch / 1000) * 1000;
  } catch {
    return null;
  }
}

function zonedToEpoch(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number | null {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const o1 = tzOffset(guess, tz);
  if (o1 === null) return null;
  const o2 = tzOffset(guess - o1, tz) ?? o1;
  return guess - o2;
}

interface Ctx {
  /** Fixed offsets (ms) of zones defined by VTIMEZONE blocks, for TZIDs that are not IANA names. */
  zones: Map<string, number>;
  warnings: Set<string>;
}

function parseTime(p: Prop, ctx: Ctx): { t: number; allDay: boolean } | null {
  const v = p.value.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return { t: new Date(+m[1]!, +m[2]! - 1, +m[3]!).getTime(), allDay: true };
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +m[6]!];
  if (m[7]) return { t: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false };
  const tzid = p.params.TZID;
  if (tzid) {
    const z = zonedToEpoch(y, mo, d, h, mi, s, tzid);
    if (z !== null) return { t: z, allDay: false };
    const fixed = ctx.zones.get(tzid);
    if (fixed !== undefined) {
      ctx.warnings.add(`La zona horaria "${tzid}" no es estándar; se usa su desplazamiento fijo (sin horario de verano).`);
      return { t: Date.UTC(y, mo - 1, d, h, mi, s) - fixed, allDay: false };
    }
    ctx.warnings.add(`Zona horaria desconocida "${tzid}"; se interpretan las horas en la zona local.`);
  }
  return { t: new Date(y, mo - 1, d, h, mi, s).getTime(), allDay: false };
}

function parseDuration(s: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s.trim());
  if (!m) return null;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

/** Most invitations carry a few people; a file with thousands is cut. */
const MAX_PEOPLE = 500;

function personOf(p: Prop): Person | null {
  const email = p.value.trim().replace(/^mailto:/i, '');
  if (!/^[^\s<>,;"]+@[^\s<>,;"]+$/.test(email)) return null;
  return { name: unescapeText(p.params.CN ?? '').replace(/[\r\n]+/g, ' '), email };
}

const STATS: Record<string, PartStat> = { ACCEPTED: 'accepted', DECLINED: 'declined', TENTATIVE: 'tentative' };

export function parseIcs(text: string): { events: CalEvent[]; tasks: TaskItem[]; warnings: string[]; method: string } {
  const lines = unfold(text);
  const method = lines.map((l) => /^METHOD:(\w+)/i.exec(l)?.[1]).find(Boolean)?.toUpperCase() ?? '';
  const ctx: Ctx = { zones: new Map(), warnings: new Set() };
  const events: CalEvent[] = [];
  const tasks: TaskItem[] = [];
  let skipped = 0;

  // time zone definitions first
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.toUpperCase() !== 'BEGIN:VTIMEZONE') continue;
    let tzid = '';
    let off: number | null = null;
    let inStd = false;
    for (i++; i < lines.length && lines[i]!.toUpperCase() !== 'END:VTIMEZONE'; i++) {
      const p = parseProp(lines[i]!);
      if (!p) continue;
      if (p.name === 'TZID') tzid = p.value;
      if (p.name === 'BEGIN') inStd = p.value.toUpperCase() === 'STANDARD';
      if (p.name === 'TZOFFSETTO' && (inStd || off === null)) {
        const m = /^([+-])(\d{2})(\d{2})/.exec(p.value);
        if (m) off = (m[1] === '-' ? -1 : 1) * (+m[2]! * 60 + +m[3]!) * 60000;
      }
    }
    if (tzid && off !== null) ctx.zones.set(tzid, off);
  }

  for (let i = 0; i < lines.length; i++) {
    const kind = /^BEGIN:(VEVENT|VTODO)$/i.exec(lines[i]!)?.[1]?.toUpperCase();
    if (!kind) continue;
    const props: Prop[] = [];
    let depth = 0;
    for (i++; i < lines.length; i++) {
      const p = parseProp(lines[i]!);
      if (!p) continue;
      if (p.name === 'BEGIN') depth++;
      else if (p.name === 'END') {
        if (depth === 0) break;
        depth--;
        continue;
      }
      if (depth === 0) props.push(p);
      else if (depth === 1 && p.name === 'TRIGGER') props.push({ ...p, name: 'X-NOVA-TRIGGER' });
    }
    const get = (n: string) => props.find((p) => p.name === n);
    const all = (n: string) => props.filter((p) => p.name === n);
    const uid = get('UID')?.value ?? newId('u');
    const title = unescapeText(get('SUMMARY')?.value ?? '');
    const categories = readNames(all('CATEGORIES').flatMap((p) => p.value.split(/(?<!\\),/).map(unescapeText)));
    if (kind === 'VEVENT') {
      const ds = get('DTSTART');
      const s = ds && parseTime(ds, ctx);
      if (!s) {
        skipped++;
        continue;
      }
      let end = s.t;
      const de = get('DTEND');
      const du = get('DURATION');
      if (de) end = parseTime(de, ctx)?.t ?? s.t;
      else if (du) end = s.t + (parseDuration(du.value) ?? 0);
      else if (s.allDay) end = new Date(new Date(s.t).getFullYear(), new Date(s.t).getMonth(), new Date(s.t).getDate() + 1).getTime();
      const trig = get('X-NOVA-TRIGGER');
      let reminder: number | null = null;
      if (trig) {
        const d = parseDuration(trig.value);
        if (d !== null && d <= 0) reminder = Math.round(-d / 60000);
      }
      const ex: number[] = [];
      for (const p of all('EXDATE')) for (const v of p.value.split(',')) {
        const t = parseTime({ ...p, value: v }, ctx);
        if (t) ex.push(t.t);
      }
      const id = newId('e');
      const meeting: Partial<CalEvent> = {};
      const organizer = get('ORGANIZER') && personOf(get('ORGANIZER')!);
      if (organizer) meeting.organizer = organizer;
      const attendees = all('ATTENDEE')
        .slice(0, MAX_PEOPLE)
        .flatMap((p): Attendee[] => {
          const who = personOf(p);
          return who ? [{ ...who, status: STATS[(p.params.PARTSTAT ?? '').toUpperCase()] ?? 'needs-action', ...(p.params.ROLE?.toUpperCase() === 'OPT-PARTICIPANT' ? { optional: true } : {}) }] : [];
        });
      if (attendees.length) meeting.attendees = attendees;
      const sequence = Number(get('SEQUENCE')?.value ?? '');
      if (get('SEQUENCE') && Number.isInteger(sequence) && sequence >= 0) meeting.sequence = sequence;
      if ((get('STATUS')?.value ?? '').toUpperCase() === 'CANCELLED') meeting.cancelled = true;
      const ofOne = get('RECURRENCE-ID') && parseTime(get('RECURRENCE-ID')!, ctx);
      if (ofOne) meeting.recurrenceId = ofOne.t;
      events.push({
        id,
        uid,
        title,
        location: unescapeText(get('LOCATION')?.value ?? ''),
        description: unescapeText(get('DESCRIPTION')?.value ?? ''),
        start: s.t,
        end: Math.max(end, s.t),
        allDay: s.allDay,
        rrule: get('RRULE')?.value ?? '',
        exdates: ex,
        reminder,
        ...(categories ? { categories } : {}),
        ...meeting,
      });
    } else {
      const due = get('DUE') ? parseTime(get('DUE')!, ctx) : null;
      const status = (get('STATUS')?.value ?? '').toUpperCase();
      const pr = Number(get('PRIORITY')?.value ?? 0);
      const completed = get('COMPLETED') ? parseTime(get('COMPLETED')!, ctx) : null;
      const id = newId('t');
      tasks.push({
        id,
        uid,
        title,
        notes: unescapeText(get('DESCRIPTION')?.value ?? ''),
        due: due?.t ?? null,
        done: status === 'COMPLETED' || Number(get('PERCENT-COMPLETE')?.value ?? 0) === 100,
        completedAt: completed?.t ?? null,
        priority: pr >= 1 && pr <= 4 ? 'high' : pr >= 6 ? 'low' : 'normal',
        ...(categories ? { categories } : {}),
      });
    }
  }
  if (skipped) ctx.warnings.add(`${skipped} eventos sin fecha de inicio válida se omitieron.`);
  return { events: gather(events), tasks, warnings: [...ctx.warnings], method };
}

/** An occurrence written apart joins its series: as a change, or as one taken away. */
function gather(events: CalEvent[]): CalEvent[] {
  const series = new Map(events.filter((e) => e.recurrenceId === undefined).map((e) => [e.uid, e]));
  return events.filter((e) => {
    const at = e.recurrenceId;
    const of = at === undefined ? undefined : series.get(e.uid);
    if (at === undefined || !of) return true;
    if (e.cancelled) of.exdates.push(at);
    else (of.changes ??= []).push({ at, title: e.title, location: e.location, description: e.description, start: e.start, end: e.end, reminder: e.reminder });
    return false;
  });
}

// ---------- writing ----------

function foldLine(line: string): string {
  // fold at 75 octets without splitting UTF-8 sequences
  const enc = new TextEncoder();
  let out = '';
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out ? 74 : 75)) {
      out += cur + '\r\n ';
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  return out + cur;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const utc = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};
const day = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
};

/** A parameter of a property: without quotes or line breaks, between quotes if it has the signs that separate. */
const param = (v: string): string => {
  const clean = v.replace(/["\r\n\u0000-\u001f]/g, ' ').trim();
  return /[;:,]/.test(clean) ? `"${clean}"` : clean;
};
const mailto = (email: string): string => `mailto:${email.replace(/[\s<>"]/g, '')}`;
const cn = (p: Person): string => (p.name ? `;CN=${param(p.name)}` : '');

function writeEvent(L: string[], stamp: string, e: CalEvent, one?: { at: number; allDay: boolean }): void {
  L.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`);
  if (one) L.push(one.allDay ? `RECURRENCE-ID;VALUE=DATE:${day(one.at)}` : `RECURRENCE-ID:${utc(one.at)}`);
  if (e.allDay) L.push(`DTSTART;VALUE=DATE:${day(e.start)}`, `DTEND;VALUE=DATE:${day(e.end)}`);
  else L.push(`DTSTART:${utc(e.start)}`, `DTEND:${utc(e.end)}`);
  L.push(`SUMMARY:${escapeText(e.title)}`);
  if (e.location) L.push(`LOCATION:${escapeText(e.location)}`);
  if (e.description) L.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.rrule && !one) L.push(`RRULE:${e.rrule}`);
  if (e.categories?.length) L.push(`CATEGORIES:${e.categories.map(escapeText).join(',')}`);
  if (!one) for (const x of e.exdates) L.push(e.allDay ? `EXDATE;VALUE=DATE:${day(x)}` : `EXDATE:${utc(x)}`);
  if (e.organizer) L.push(`ORGANIZER${cn(e.organizer)}:${mailto(e.organizer.email)}`);
  for (const a of e.attendees ?? []) L.push(`ATTENDEE${cn(a)};ROLE=${a.optional ? 'OPT' : 'REQ'}-PARTICIPANT;PARTSTAT=${a.status.toUpperCase()};RSVP=TRUE:${mailto(a.email)}`);
  if (e.sequence !== undefined) L.push(`SEQUENCE:${e.sequence}`);
  if (e.cancelled) L.push('STATUS:CANCELLED');
  if (e.reminder !== null) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(e.title || 'Recordatorio')}`, `TRIGGER:-PT${e.reminder}M`, 'END:VALARM');
  L.push('END:VEVENT');
}

export interface IcsOptions {
  /** For an invitation: REQUEST, REPLY or CANCEL. */
  method?: 'REQUEST' | 'REPLY' | 'CANCEL';
  /** The name of the calendar being exported. */
  calendarName?: string;
}

export function writeIcs(events: CalEvent[], tasks: TaskItem[] = [], name = 'Nova Mail', opts: IcsOptions = {}): string {
  const L: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//SuiteNova//${name}//ES`, 'CALSCALE:GREGORIAN'];
  if (opts.method) L.push(`METHOD:${opts.method}`);
  if (opts.calendarName) L.push(`X-WR-CALNAME:${escapeText(opts.calendarName)}`);
  const stamp = utc(Date.now());
  for (const e of events) {
    // an event that speaks of one occurrence only keeps saying which
    writeEvent(L, stamp, e, e.recurrenceId === undefined ? undefined : { at: e.recurrenceId, allDay: e.allDay });
    for (const c of e.changes ?? []) writeEvent(L, stamp, { ...e, ...c, rrule: '', exdates: [], changes: undefined }, { at: c.at, allDay: e.allDay });
  }
  for (const t of tasks) {
    L.push('BEGIN:VTODO', `UID:${t.uid}`, `DTSTAMP:${stamp}`, `SUMMARY:${escapeText(t.title)}`);
    if (t.notes) L.push(`DESCRIPTION:${escapeText(t.notes)}`);
    if (t.due !== null) L.push(`DUE;VALUE=DATE:${day(t.due)}`);
    if (t.categories?.length) L.push(`CATEGORIES:${t.categories.map(escapeText).join(',')}`);
    L.push(`STATUS:${t.done ? 'COMPLETED' : 'NEEDS-ACTION'}`, `PRIORITY:${t.priority === 'high' ? 1 : t.priority === 'low' ? 9 : 5}`);
    if (t.done && t.completedAt) L.push(`COMPLETED:${utc(t.completedAt)}`);
    L.push('END:VTODO');
  }
  L.push('END:VCALENDAR');
  return L.map(foldLine).join('\r\n') + '\r\n';
}

// ---------- recurrence ----------

export interface Occurrence {
  start: number;
  end: number;
  /** The event as it is in this occurrence (with what was changed in it). */
  event: CalEvent;
  /** In a series: the start it would have had, which names it. */
  original?: number;
  /** It differs from the series. */
  changed?: boolean;
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

interface Rule {
  freq: string;
  interval: number;
  count: number | null;
  until: number | null;
  byday: { n: number; d: number }[];
  bymonthday: number[];
  bymonth: number[];
}

function parseRule(s: string): Rule | null {
  const o: Record<string, string> = {};
  for (const p of s.split(';')) {
    const i = p.indexOf('=');
    if (i > 0) o[p.slice(0, i).toUpperCase()] = p.slice(i + 1);
  }
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(o.FREQ ?? '')) return null;
  let until: number | null = null;
  if (o.UNTIL) {
    const t = parseTime({ name: 'UNTIL', params: {}, value: o.UNTIL }, { zones: new Map(), warnings: new Set() });
    until = t ? (t.allDay ? t.t + 86400000 - 1 : t.t) : null;
  }
  return {
    freq: o.FREQ!,
    interval: Math.max(1, Number(o.INTERVAL ?? 1) || 1),
    count: o.COUNT ? Number(o.COUNT) : null,
    until,
    byday: (o.BYDAY ?? '')
      .split(',')
      .filter(Boolean)
      .map((x) => {
        const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(x.trim());
        return m ? { n: m[1] ? Number(m[1]) : 0, d: DAYS.indexOf(m[2]!) } : { n: 0, d: -1 };
      })
      .filter((x) => x.d >= 0),
    bymonthday: (o.BYMONTHDAY ?? '').split(',').filter(Boolean).map(Number),
    bymonth: (o.BYMONTH ?? '').split(',').filter(Boolean).map(Number),
  };
}

/** The n-th (or last, for negative n) given weekday of a month. */
function nthWeekday(y: number, m: number, wd: number, n: number): number | null {
  const dim = new Date(y, m + 1, 0).getDate();
  if (n > 0) {
    const first = new Date(y, m, 1).getDay();
    const d = 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
    return d <= dim ? d : null;
  }
  const last = new Date(y, m, dim).getDay();
  const d = dim - ((last - wd + 7) % 7) + (n + 1) * 7;
  return d >= 1 ? d : null;
}

const MAX_OCCURRENCES = 20000;

/** Occurrences of an event that overlap [from, to). Recurrences are computed in local wall-clock time. */
export function expandEvent(ev: CalEvent, from: number, to: number): Occurrence[] {
  const dur = ev.end - ev.start;
  const one = (s: number): Occurrence => ({ start: s, end: s + dur, event: ev, ...(ev.rrule ? { original: s } : {}) });
  const rule = ev.rrule ? parseRule(ev.rrule) : null;
  if (!rule) return ev.start < to && Math.max(ev.end, ev.start + 1) > from ? [one(ev.start)] : [];
  const overlaps = (s: number, e: number) => s < to && Math.max(e, s + 1) > from;
  const changed = new Map((ev.changes ?? []).map((c) => [c.at, c]));

  const base = new Date(ev.start);
  const h = base.getHours(), mi = base.getMinutes(), se = base.getSeconds();
  const at = (y: number, m: number, d: number) => new Date(y, m, d, h, mi, se).getTime();
  const out: Occurrence[] = [];
  const ex = new Set(ev.exdates);
  let produced = 0;
  const limit = rule.until ?? Infinity;

  const emit = (t: number): boolean => {
    // returns false when the series is over
    if (t < ev.start) return true;
    if (t > limit) return false;
    produced++;
    if (rule.count !== null && produced > rule.count) return false;
    if (!ex.has(t) && !changed.has(t) && overlaps(t, t + dur)) out.push(one(t));
    return true;
  };

  const sY = base.getFullYear(), sM = base.getMonth(), sD = base.getDate();
  let steps = 0;
  if (rule.freq === 'DAILY') {
    for (let i = 0; steps++ < MAX_OCCURRENCES; i += rule.interval) {
      const t = at(sY, sM, sD + i);
      if (t >= to) break;
      if (!emit(t)) break;
    }
  } else if (rule.freq === 'WEEKLY') {
    const days = rule.byday.length ? rule.byday.map((x) => x.d) : [base.getDay()];
    const weekStart = sD - base.getDay(); // Sunday of the first week
    for (let w = 0; steps++ < MAX_OCCURRENCES; w += rule.interval) {
      let past = false;
      for (const d of [...days].sort((a, b) => a - b)) {
        const t = at(sY, sM, weekStart + w * 7 + d);
        if (t < ev.start) continue;
        if (t >= to) past = true;
        if (!emit(t)) {
          past = true;
          break;
        }
        if (past) break;
      }
      if (past) break;
    }
  } else if (rule.freq === 'MONTHLY') {
    for (let k = 0; steps++ < MAX_OCCURRENCES; k += rule.interval) {
      const y = sY + Math.floor((sM + k) / 12);
      const m = (sM + k) % 12;
      let dates: number[] = [];
      if (rule.byday.length) dates = rule.byday.flatMap((x) => (x.n ? [nthWeekday(y, m, x.d, x.n)] : Array.from({ length: 6 }, (_, i) => nthWeekday(y, m, x.d, i + 1)))).filter((d): d is number => d !== null);
      else if (rule.bymonthday.length) dates = rule.bymonthday.map((d) => (d < 0 ? new Date(y, m + 1, 0).getDate() + d + 1 : d));
      else dates = [sD];
      dates = [...new Set(dates)].filter((d) => d >= 1 && d <= new Date(y, m + 1, 0).getDate()).sort((a, b) => a - b);
      let past = false;
      for (const d of dates) {
        const t = at(y, m, d);
        if (t < ev.start) continue;
        if (t >= to) past = true;
        if (!emit(t)) {
          past = true;
          break;
        }
        if (past) break;
      }
      if (past || at(y, m, 1) >= to) break;
    }
  } else {
    for (let k = 0; steps++ < MAX_OCCURRENCES; k += rule.interval) {
      const y = sY + k;
      const months = rule.bymonth.length ? rule.bymonth.map((x) => x - 1) : [sM];
      let past = false;
      for (const m of months.sort((a, b) => a - b)) {
        const d = rule.bymonthday.length ? rule.bymonthday[0]! : sD;
        if (d > new Date(y, m + 1, 0).getDate()) continue; // 29 Feb in a common year
        const t = at(y, m, d);
        if (t < ev.start) continue;
        if (t >= to) past = true;
        if (!emit(t)) {
          past = true;
          break;
        }
        if (past) break;
      }
      if (past || at(y, 0, 1) >= to) break;
    }
  }
  // the changed ones are where they were moved to, which may be outside the dates of their original
  for (const c of changed.values()) {
    if (ex.has(c.at) || !overlaps(c.start, c.end)) continue;
    const { at: original, ...how } = c;
    out.push({ start: c.start, end: c.end, event: { ...ev, ...how }, original, changed: true });
  }
  return out;
}

export function occurrencesBetween(events: CalEvent[], from: number, to: number): Occurrence[] {
  return events.flatMap((e) => expandEvent(e, from, to)).sort((a, b) => a.start - b.start || a.end - b.end);
}
