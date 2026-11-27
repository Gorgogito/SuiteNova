/*
 * Follow-up of a message, like the flags of Outlook. A flagged message is one to follow up; it may have a due date and a
 * reminder. Completing it takes the flag away and remembers when it was done.
 */

export interface FollowUp {
  /** Local midnight of the day it is due, or null. */
  due: number | null;
  /** When it was completed. */
  done?: number;
  /** When to remind. */
  remind?: number;
}

export type Followed = { flagged: boolean; follow?: FollowUp };

export type FollowPreset = 'today' | 'tomorrow' | 'week' | 'nextweek' | 'nodate';

export const FOLLOW_PRESETS: { id: FollowPreset; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'tomorrow', label: 'Mañana' },
  { id: 'week', label: 'Esta semana' },
  { id: 'nextweek', label: 'La semana que viene' },
  { id: 'nodate', label: 'Sin fecha' },
];

const midnight = (t: number, offset = 0): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset).getTime();
};
/** Days from today to the Monday of this week (zero or less). Weeks start on Monday. */
const toMonday = (now: number): number => -((new Date(now).getDay() + 6) % 7);

/** The due day of a preset. «This week» is its Friday, or today when Friday has passed; «next week», the next Friday. */
export function presetDue(p: FollowPreset, now: number): number | null {
  if (p === 'today') return midnight(now);
  if (p === 'tomorrow') return midnight(now, 1);
  if (p === 'week') return midnight(now, Math.max(0, toMonday(now) + 4));
  if (p === 'nextweek') return midnight(now, toMonday(now) + 11);
  return null;
}

export function setFollow(m: Followed, due: number | null, remind?: number): void {
  m.flagged = true;
  const f: FollowUp = { due };
  if (remind !== undefined) f.remind = remind;
  if (due === null && remind === undefined) delete m.follow;
  else m.follow = f;
}

export function completeFollow(m: Followed, now: number): void {
  m.flagged = false;
  m.follow = { due: m.follow?.due ?? null, done: now };
}

export function clearFollow(m: Followed): void {
  m.flagged = false;
  delete m.follow;
}

/** After the flag changed elsewhere (the server, another program): what is kept about the follow-up follows it. */
export function followFlag(m: Followed): void {
  if (!m.follow) return;
  if (m.flagged === (m.follow.done !== undefined)) delete m.follow;
}

export const isDone = (m: Followed): boolean => !m.flagged && m.follow?.done !== undefined;
export const isFollowed = (m: Followed): boolean => m.flagged || isDone(m);
export const isOverdue = (m: Followed, now: number): boolean => m.flagged && typeof m.follow?.due === 'number' && m.follow.due < midnight(now);

/** The groups of the list and of the tasks, in order. */
export function dueGroup(m: Followed, now: number): { key: string; label: string; rank: number } {
  if (isDone(m)) return { key: 'g:done', label: 'Completados', rank: 8 };
  if (!m.flagged) return { key: 'g:off', label: 'Sin bandera', rank: 9 };
  const due = m.follow?.due ?? null;
  if (due === null) return { key: 'g:nodate', label: 'Sin fecha', rank: 7 };
  if (due < midnight(now)) return { key: 'g:late', label: 'Vencidos', rank: 1 };
  if (due < midnight(now, 1)) return { key: 'g:today', label: 'Hoy', rank: 2 };
  if (due < midnight(now, 2)) return { key: 'g:tomorrow', label: 'Mañana', rank: 3 };
  if (due < midnight(now, toMonday(now) + 7)) return { key: 'g:week', label: 'Esta semana', rank: 4 };
  if (due < midnight(now, toMonday(now) + 14)) return { key: 'g:nextweek', label: 'La semana que viene', rank: 5 };
  return { key: 'g:later', label: 'Más adelante', rank: 6 };
}

/** For sorting by flag: what is to be done first (the earliest due, then without date), then what is done, then the rest. */
export function followOrder(a: Followed, b: Followed): number {
  const kind = (m: Followed) => (m.flagged ? 0 : isDone(m) ? 1 : 2);
  const due = (m: Followed) => m.follow?.due ?? Number.MAX_SAFE_INTEGER;
  return kind(a) - kind(b) || (a.flagged && b.flagged ? due(a) - due(b) : 0);
}

export function readFollow(v: unknown): FollowUp | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Partial<FollowUp>;
  const time = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  const f: FollowUp = { due: time(o.due) ? o.due : null };
  if (time(o.done)) f.done = o.done;
  if (time(o.remind)) f.remind = o.remind;
  return f.due === null && f.done === undefined && f.remind === undefined ? undefined : f;
}
