import { CATEGORY_COLORS } from './categories';
import type { CalEvent } from './ics';
import type { MailData } from './store';

/* Several calendars, each with a colour, shown one over another. */

export interface CalendarInfo {
  id: string;
  name: string;
  /** One of CATEGORY_COLORS. */
  color: string;
  hidden?: boolean;
}

/** The calendar every mailbox has; an appointment without calendar is in it. */
export const DEFAULT_CALENDAR = 'cal';
const FIRST: CalendarInfo = { id: DEFAULT_CALENDAR, name: 'Calendario', color: 'blue' };

export function calendarsOf(d: MailData): CalendarInfo[] {
  const list = d.calendars ?? [];
  return list.some((c) => c.id === DEFAULT_CALENDAR) ? list : [FIRST, ...list];
}

export const calendarOf = (d: MailData, e: Pick<CalEvent, 'calendar'>): CalendarInfo => {
  const all = calendarsOf(d);
  return all.find((c) => c.id === (e.calendar ?? DEFAULT_CALENDAR)) ?? all.find((c) => c.id === DEFAULT_CALENDAR)!;
};

export const calendarHex = (c: CalendarInfo): string => (CATEGORY_COLORS.find((x) => x.id === c.color) ?? CATEGORY_COLORS[CATEGORY_COLORS.length - 1]!).hex;

/** The appointments of the calendars that are being shown. */
export function visibleEvents(d: MailData): CalEvent[] {
  const hidden = new Set(calendarsOf(d).filter((c) => c.hidden).map((c) => c.id));
  return hidden.size ? d.events.filter((e) => !hidden.has(calendarOf(d, e).id)) : d.events;
}

export function calendarName(d: MailData, name: string, self?: string): string {
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n) throw new Error('Escribe un nombre para el calendario.');
  if (n.length > 80) throw new Error('El nombre del calendario es demasiado largo.');
  if (calendarsOf(d).some((c) => c.id !== self && c.name.toLowerCase() === n.toLowerCase())) throw new Error('Ya existe un calendario con ese nombre.');
  return n;
}

const own = (d: MailData): CalendarInfo[] => (d.calendars = calendarsOf(d).map((c) => ({ ...c })));

export function addCalendar(d: MailData, id: string, name: string, color: string): CalendarInfo {
  const c = { id, name: calendarName(d, name), color: CATEGORY_COLORS.some((x) => x.id === color) ? color : 'gray' };
  own(d).push(c);
  return c;
}

export function changeCalendar(d: MailData, id: string, patch: Partial<Omit<CalendarInfo, 'id'>>): void {
  const c = own(d).find((x) => x.id === id);
  if (!c) return;
  if (patch.name !== undefined && patch.name !== c.name) c.name = calendarName(d, patch.name, id);
  if (patch.color && CATEGORY_COLORS.some((x) => x.id === patch.color)) c.color = patch.color;
  if (patch.hidden !== undefined) {
    if (patch.hidden) c.hidden = true;
    else delete c.hidden;
  }
}

/** Removes a calendar with its appointments. The first one stays. */
export function removeCalendar(d: MailData, id: string): number {
  if (id === DEFAULT_CALENDAR) return 0;
  d.calendars = own(d).filter((c) => c.id !== id);
  const before = d.events.length;
  d.events = d.events.filter((e) => e.calendar !== id);
  return before - d.events.length;
}

export function readCalendars(v: unknown): CalendarInfo[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: CalendarInfo[] = [];
  for (const c of v as Partial<CalendarInfo>[]) {
    if (!c || typeof c.id !== 'string' || !c.id || c.id.length > 100 || typeof c.name !== 'string' || !c.name.trim() || out.some((x) => x.id === c.id)) continue;
    const info: CalendarInfo = { id: c.id, name: c.name.slice(0, 80), color: CATEGORY_COLORS.some((x) => x.id === c.color) ? c.color! : 'gray' };
    if (c.hidden === true) info.hidden = true;
    out.push(info);
  }
  return out.length ? out.slice(0, 100) : undefined;
}
