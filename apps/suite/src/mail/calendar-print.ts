import { t } from '@suitenova/core-ui';
import { calendarOf, calendarsOf, occurrencesBetween, visibleEvents, type Occurrence } from '@suitenova/mail-core';
import { rangeOf, titleOf } from './calendar-range';
import { addDays, type MailCtl } from './ctl';
import { timeStr } from './dates';
import { printPage } from './print';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The page printed from the calendar: the month as a grid; the other views, day by day. */
export function calendarHtml(ctl: MailCtl): string {
  const view = ctl.calView;
  const { from, to, days } = rangeOf(view, ctl.anchor);
  const occ = occurrencesBetween(visibleEvents(ctl.data), from, to);
  const of = (d: number) => occ.filter((o) => o.start < addDays(d, 1) && Math.max(o.end, o.start + 1) > d);
  const many = calendarsOf(ctl.data).length > 1;
  const when = (o: Occurrence, d: number) => (o.event.allDay ? t('Todo el día') : `${timeStr(Math.max(o.start, d))} – ${timeStr(Math.min(o.end, addDays(d, 1)))}`);
  const name = (o: Occurrence) => `${o.event.cancelled ? `<s>${esc(o.event.title)}</s>` : esc(o.event.title)}`;
  let body: string;
  if (view === 'month') {
    const head = days.slice(0, 7).map((d) => `<th>${esc(new Date(d).toLocaleDateString(undefined, { weekday: 'short' }))}</th>`).join('');
    const weeks = [0, 1, 2, 3, 4, 5]
      .map((w) => {
        const cells = days.slice(w * 7, w * 7 + 7).map((d) => {
          const other = new Date(d).getMonth() !== new Date(ctl.anchor).getMonth();
          const list = of(d).map((o) => `<div>${o.event.allDay ? '' : `<b>${timeStr(o.start)}</b> `}${name(o)}</div>`).join('');
          return `<td class="${other ? 'other' : ''}"><span>${new Date(d).getDate()}</span>${list}</td>`;
        });
        return `<tr>${cells.join('')}</tr>`;
      })
      .join('');
    body = `<table class="month"><thead><tr>${head}</tr></thead><tbody>${weeks}</tbody></table>`;
  } else {
    body = days
      .map((d) => {
        const list = of(d);
        if (!list.length && view === 'agenda') return '';
        const rows = list
          .map((o) => `<tr><td class="time">${esc(when(o, d))}</td><td><b>${name(o)}</b>${o.event.location ? ` · ${esc(o.event.location)}` : ''}${many ? ` <i>(${esc(t(calendarOf(ctl.data, o.event).name))})</i>` : ''}</td></tr>`)
          .join('');
        return `<h2>${esc(new Date(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</h2>${rows ? `<table class="day">${rows}</table>` : `<p>${esc(t('Sin citas.'))}</p>`}`;
      })
      .join('');
    if (!body) body = `<p>${esc(t('Sin citas.'))}</p>`;
  }
  const css = `@page{margin:12mm}body{font:12px 'Segoe UI',Calibri,Arial,sans-serif;color:#000;background:#fff;margin:12px}h1{font-size:18px;border-bottom:2px solid #000;padding-bottom:4px}h2{font-size:13px;margin:12px 0 4px}h1::first-letter,h2::first-letter,.month th::first-letter{text-transform:uppercase}table{border-collapse:collapse;width:100%}.day td{border-bottom:1px solid #bbb;padding:3px 6px;vertical-align:top}.time{width:120px;white-space:nowrap}.month{table-layout:fixed}.month th,.month td{border:1px solid #888;vertical-align:top;padding:2px 3px;font-size:10px;overflow-wrap:anywhere}.month td{height:90px}.month td>span{font-weight:700}.other{color:#777}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>${css}</style></head><body><h1>${esc(titleOf(view, ctl.anchor))}</h1>${body}</body></html>`;
}

export const printCalendar = (ctl: MailCtl): void => printPage(calendarHtml(ctl));
