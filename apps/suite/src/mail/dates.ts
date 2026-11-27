/* Dates as the date and time boxes write them, in local time. */

const pad = (n: number) => String(n).padStart(2, '0');

export const dateStr = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const timeStr = (t: number): string => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const parseLocal = (date: string, time: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  return new Date(y!, m! - 1, d!, h ?? 0, mi ?? 0).getTime();
};
