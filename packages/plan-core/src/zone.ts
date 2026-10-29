import type { Cal } from './calendar';
import { MIN_PER_DAY, type Time } from './model';

/**
 * Times in a project are minutes of the project's own wall clock. A time zone only matters where the clock
 * and the real passing of time differ: elapsed durations and lags across a daylight-saving change, and
 * "now". Working calendars are wall-clock (people work 8:00–17:00 local time on both sides of a change).
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

export function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    formatters.set(zone, f);
  }
  return f;
}

/** Minutes the zone is ahead of UTC at the absolute instant `ms` (milliseconds since 1970). */
export function offsetAt(zone: string, ms: number): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(zone).formatToParts(new Date(Math.floor(ms / 1000) * 1000))) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  const asUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour! % 24, parts.minute!, parts.second!);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** The absolute instant, in minutes since 1970 UTC, of a wall-clock time in the zone. */
export function wallToAbs(zone: string, wall: Time): number {
  const g = wall * 60000;
  const o1 = offsetAt(zone, g);
  let a = g - o1 * 60000;
  const o2 = offsetAt(zone, a);
  if (o2 !== o1) a = g - o2 * 60000;
  return a / 60000;
}

/** The wall-clock time in the zone of an absolute instant (minutes since 1970 UTC). */
export function absToWall(zone: string, abs: number): Time {
  return Math.round(abs + offsetAt(zone, abs * 60000));
}

/** Elapsed time that counts real minutes: a day that has 23 or 25 hours is shorter or longer on the clock. */
export function zonedElapsed(zone: string): Cal {
  return {
    isWorking: () => true,
    nextStart: (t) => t,
    prevEnd: (t) => t,
    addWork: (t, m) => (m <= 0 ? t : absToWall(zone, wallToAbs(zone, t) + m)),
    subWork: (t, m) => (m <= 0 ? t : absToWall(zone, wallToAbs(zone, t) - m)),
    workBetween: (a, b) => (b <= a ? 0 : Math.round(wallToAbs(zone, b) - wallToAbs(zone, a))),
    periodsOf: () => [{ from: 0, to: MIN_PER_DAY }],
  };
}

/** The current wall-clock time in the zone (or of this computer when no zone is given). */
export function nowIn(zone?: string, at: Date = new Date()): Time {
  if (!zone || !validZone(zone)) {
    return Math.floor(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()) / 60000);
  }
  return absToWall(zone, Math.floor(at.getTime() / 60000));
}

/** Zones offered in the project options (the full list when the engine knows it). */
export function zoneNames(): string[] {
  const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const list = f ? f('timeZone') : [];
  return list.length ? ['UTC', ...list.filter((z) => z !== 'UTC')] : ['UTC', 'Europe/Madrid', 'Europe/London', 'America/New_York', 'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Argentina/Buenos_Aires', 'America/Santiago', 'Asia/Tokyo'];
}
