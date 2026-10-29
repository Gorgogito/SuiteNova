/** Excel 1900 date system. Serial 1 = 1900-01-01; serial 60 is the fictitious 1900-02-29. */

const MS_PER_DAY = 86_400_000;
// Serial 0 would be 1899-12-31; for serials >= 61 the usable epoch is 1899-12-30.
const EPOCH_UTC = Date.UTC(1899, 11, 30);

export function serialFromYMD(y: number, m: number, d: number): number {
  // Normalise overflow months/days like DATE() does.
  const ms = Date.UTC(2000, 0, 1);
  const dt = new Date(ms);
  dt.setUTCFullYear(y, m - 1, d);
  const serial = Math.round((dt.getTime() - EPOCH_UTC) / MS_PER_DAY);
  return serial < 61 ? serial - 1 : serial;
}

export interface YMD {
  y: number;
  m: number;
  d: number;
}

export function ymdFromSerial(serial: number): YMD {
  const s = Math.floor(serial);
  if (s === 60) return { y: 1900, m: 2, d: 29 };
  const adj = s < 60 ? s + 1 : s;
  const dt = new Date(EPOCH_UTC + adj * MS_PER_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** 0 = Sunday ... 6 = Saturday, matching Excel's WEEKDAY(…,1) minus one. */
export function weekdayFromSerial(serial: number): number {
  const s = Math.floor(serial);
  if (s === 60) return 3; // fictitious Wednesday
  return ((s + 6) % 7 + 7) % 7;
}

export function timeFromFraction(frac: number): { h: number; mi: number; s: number } {
  const total = Math.round((frac - Math.floor(frac)) * 86_400);
  return { h: Math.floor(total / 3600) % 24, mi: Math.floor((total % 3600) / 60), s: total % 60 };
}

export function serialFromDate(date: Date): number {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds());
  const serial = (local - EPOCH_UTC) / MS_PER_DAY;
  return serial < 61 ? serial - 1 : serial;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
