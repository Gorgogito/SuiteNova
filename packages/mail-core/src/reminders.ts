import { occurrencesBetween } from './ics';
import type { MailData } from './store';

/*
 * Reminders: of appointments, of tasks and of messages followed up. One can be dismissed, or snoozed to be told again
 * later; what was dismissed or snoozed is kept in the file.
 */

export interface ReminderState {
  /** Remind again then. */
  until?: number;
  done?: boolean;
}

export interface DueReminder {
  /** `eventId@start` for an appointment, `f:messageId` for a message, `t:taskId` for a task. */
  key: string;
  kind: 'event' | 'mail' | 'task';
  title: string;
  /** When the appointment starts, or when the reminder of the message or the task was set for. */
  at: number;
  messageId?: string;
  /** The due day of a message or a task. */
  due?: number | null;
}

export const SNOOZE_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 5, label: '5 minutos' },
  { minutes: 15, label: '15 minutos' },
  { minutes: 60, label: '1 hora' },
  { minutes: 24 * 60, label: '1 día' },
];

const parts = (key: string): { id: string; start: number } => {
  const i = key.lastIndexOf('@');
  return { id: key.slice(0, i), start: Number(key.slice(i + 1)) };
};

/** What there is to remind of at a moment. */
export function dueReminders(d: MailData, now: number): DueReminder[] {
  const out: DueReminder[] = [];
  for (const m of d.messages) {
    if (m.flagged && m.follow?.remind !== undefined && m.follow.remind <= now) out.push({ key: `f:${m.id}`, kind: 'mail', title: m.subject, at: m.follow.remind, messageId: m.id, due: m.follow.due });
  }
  for (const t of d.tasks) {
    if (!t.done && t.remind !== undefined && t.remind <= now) out.push({ key: `t:${t.id}`, kind: 'task', title: t.title, at: t.remind, due: t.due });
  }
  const states = d.reminders ?? {};
  // a series is looked at whole: one of its occurrences may have a reminder of its own
  const timed = d.events.filter((e) => !e.cancelled && (e.reminder !== null || e.changes?.some((c) => c.reminder !== null)));
  for (const o of occurrencesBetween(timed, now - 3600_000, now + 7 * 86400_000)) {
    if (o.event.reminder === null) continue;
    const key = `${o.event.id}@${o.start}`;
    if (states[key]) continue;
    const at = o.start - (o.event.reminder ?? 0) * 60_000;
    if (at <= now && now < o.end) out.push({ key, kind: 'event', title: o.event.title, at: o.start });
  }
  // a snoozed one comes back even if the appointment has passed: it was asked for
  for (const [key, s] of Object.entries(states)) {
    if (s.done || s.until === undefined || s.until > now) continue;
    const { id, start } = parts(key);
    const e = d.events.find((x) => x.id === id);
    if (e && !e.cancelled) out.push({ key, kind: 'event', title: e.changes?.find((c) => c.start === start)?.title ?? e.title, at: start });
  }
  return out;
}

/** A task is changed as a new one, so that what was kept to undo it stays as it was. */
const remindTask = (d: MailData, key: string, at: number | undefined): void => {
  d.tasks = d.tasks.map((t) => {
    if (`t:${t.id}` !== key) return t;
    const next = { ...t };
    if (at === undefined) delete next.remind;
    else next.remind = at;
    return next;
  });
};

export function dismissReminder(d: MailData, key: string): void {
  if (key.startsWith('t:')) return remindTask(d, key, undefined);
  if (key.startsWith('f:')) {
    const m = d.messages.find((x) => `f:${x.id}` === key);
    if (!m?.follow) return;
    delete m.follow.remind;
    if (m.follow.due === null) delete m.follow;
    return;
  }
  (d.reminders ??= {})[key] = { done: true };
}

export function snoozeReminder(d: MailData, key: string, until: number): void {
  if (key.startsWith('t:')) return remindTask(d, key, until);
  if (key.startsWith('f:')) {
    const m = d.messages.find((x) => `f:${x.id}` === key);
    if (m?.follow) m.follow.remind = until;
    return;
  }
  (d.reminders ??= {})[key] = { until };
}

/** Forgets what is kept about appointments that are gone or long past. */
export function pruneReminders(d: MailData, now: number): void {
  if (!d.reminders) return;
  for (const [key, s] of Object.entries(d.reminders)) {
    const { id, start } = parts(key);
    if (!d.events.some((e) => e.id === id) || (s.done && start < now - 30 * 86400_000)) delete d.reminders[key];
  }
  if (!Object.keys(d.reminders).length) delete d.reminders;
}

export function readReminders(v: unknown): Record<string, ReminderState> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, ReminderState> = {};
  for (const [k, s] of Object.entries(v as Record<string, ReminderState>).slice(-2000)) {
    if (!k.includes('@') || k.length > 200 || !s) continue;
    if (s.done === true) out[k] = { done: true };
    else if (typeof s.until === 'number' && Number.isFinite(s.until)) out[k] = { until: s.until };
  }
  return Object.keys(out).length ? out : undefined;
}
