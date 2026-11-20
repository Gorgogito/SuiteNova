/** «hace 5 minutos», «ayer», o la fecha cuando ya pasó una semana: lo que muestra un comentario junto al autor. */
export function whenText(iso: string, now: Date = new Date(), locale = 'es'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const secs = Math.round((d.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(secs);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 45) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(secs / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(secs / 3600), 'hour');
  if (abs < 7 * 86400) return rtf.format(Math.round(secs / 86400), 'day');
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }).format(d);
}

/** The full date and time, for the tooltip. */
export const fullWhen = (iso: string, locale = 'es'): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(d);
};
