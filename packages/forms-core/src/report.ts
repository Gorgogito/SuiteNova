/*
 * The summary of the responses as a page of its own, to print it or to share it. It never carries names, files nor, unless
 * asked for, what people wrote.
 */
import { localize, type Lang } from './i18n';
import { durationText } from './query';
import { numbers, type Form, type Response } from './model';
import { summarize, type QSummary } from './summary';

export interface ReportOptions {
  /** What people wrote in text questions and as «other». */
  texts?: boolean;
  /** Pictures of the charts chosen for the questions, as SVG text, by question. */
  charts?: Record<string, string>;
  /** When only some of the responses are summarised: how many there are in all. */
  of?: number;
  locale?: string;
}

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = `@page{margin:15mm}body{font:12px 'Segoe UI',Calibri,Arial,sans-serif;color:#1b1b1b;background:#fff;max-width:760px;margin:0 auto;padding:16px}h1{font-size:21px;margin:0 0 4px}h2{font-size:14px;margin:0 0 4px}section{border-top:1px solid #bbb;padding:10px 0;break-inside:avoid}p{margin:3px 0}.mut{color:#555}table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #bbb;padding:3px 6px;text-align:left;vertical-align:top}td.n,th.n{text-align:right;white-space:nowrap}.bar{height:8px;background:#0f6cbd;border-radius:2px;-webkit-print-color-adjust:exact;print-color-adjust:exact}.track{min-width:120px;width:40%}img{display:block;max-width:100%;margin:6px 0}li{white-space:pre-wrap;overflow-wrap:anywhere}`;

export function summaryHtml(form: Form, responses: Response[], { texts = false, charts = {}, of, locale }: ReportOptions = {}): string {
  const lang: Lang = form.language ?? 'es';
  const say = (text: string) => escape(localize(text, lang));
  const num = (n: number) => (Math.round(n * 100) / 100).toLocaleString(locale ?? lang);
  const sum = summarize(form, responses);
  const nums = numbers(form);
  const p = (text: string, kind = '') => `<p${kind ? ` class="${kind}"` : ''}>${text}</p>`;
  const table = (head: string[], rows: string[]) => `<table><thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  const bars = (items: { label: string; count: number; pct: number }[]) =>
    `<table><tbody>${items.map((it) => `<tr><th>${it.label === 'Otras respuestas' ? say(it.label) : escape(it.label)}</th><td class="track"><div class="bar" style="width:${Math.max(0, Math.min(100, it.pct))}%"></div></td><td class="n">${it.count} (${num(it.pct)} %)</td></tr>`).join('')}</tbody></table>`;
  const picture = (id: string) => (charts[id] ? `<img alt="${say('Gráfico de las respuestas')}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(charts[id]!)}">` : '');
  const list = (values: string[]) => `<ul>${values.slice(0, 500).map((v) => `<li>${escape(v)}</li>`).join('')}</ul>${values.length > 500 ? p(say(`Y ${values.length - 500} más.`), 'mut') : ''}`;
  const body = (s: QSummary): string => {
    if (!s.answered) return p(say('Nadie ha respondido a esta pregunta.'), 'mut');
    switch (s.kind) {
      case 'counts':
        return picture(s.question.id) + bars(s.items) + (texts && s.others.length ? list(s.others) : '');
      case 'rating':
        return p(`<strong>${num(s.average)} / ${s.question.max}</strong>`) + picture(s.question.id) + bars(s.items);
      case 'nps':
        return p(`<strong>${say(`Puntuación de recomendación: ${s.score}`)}</strong>`) + p(say(`Promotores: ${s.promoters} · Pasivos: ${s.passives} · Detractores: ${s.detractors}`)) + picture(s.question.id) + bars(s.items);
      case 'number':
        return p(`${say(`Media: ${num(s.average)}`)} · ${say(`Mediana: ${num(s.median)}`)} · ${say(`Mínimo: ${num(s.min)}`)} · ${say(`Máximo: ${num(s.max)}`)}`);
      case 'text':
      case 'date':
        return texts ? list(s.values) : p(say('Las respuestas escritas no se incluyen.'), 'mut');
      case 'likert':
        return table(['', ...s.question.options.map(escape), say('Media')], s.rows.map((r) => `<tr><th>${escape(r.row)}</th>${r.counts.map((c) => `<td class="n">${c}</td>`).join('')}<td class="n">${r.average === null ? '—' : num(r.average)}</td></tr>`));
      case 'ranking':
        return table([say('Elemento'), say('Puesto medio'), say('Veces en primer lugar')], s.items.map((it) => `<tr><th>${escape(it.label)}</th><td class="n">${it.average === null ? '—' : num(it.average)}</td><td class="n">${it.first}</td></tr>`));
      case 'files':
        return p(say(`Archivos recibidos: ${s.files.length}`));
      default:
        return '';
    }
  };
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale ?? lang, { dateStyle: 'medium' });
  const top = [
    p(`<strong>${say(sum.total === 1 ? '1 respuesta' : `${sum.total} respuestas`)}</strong>${sum.first ? ` <span class="mut">${escape(day(sum.first))} – ${escape(day(sum.last!))}</span>` : ''}`),
    of !== undefined && of !== sum.total ? p(say(`Se resumen ${sum.total} de ${of} respuestas: hay un filtro.`), 'mut') : '',
    sum.time ? p(say(`Tiempo medio para responder: ${durationText(sum.time.average)}`)) : '',
    sum.quiz ? p(sum.quiz.varies ? say(`Puntuación media: ${num(sum.quiz.percent)} %`) : say(`Puntuación media: ${num(sum.quiz.average)} de ${sum.quiz.max}`)) : '',
  ].join('');
  const sections = sum.questions.map((s) => `<section><h2>${form.hideNumbers ? '' : `${nums.get(s.question.id)}. `}${escape(s.question.title)}</h2>${p(say(s.answered === 1 ? '1 respuesta' : `${s.answered} respuestas`), 'mut')}${body(s)}</section>`).join('');
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${escape(form.title)} – ${say('Resumen de respuestas')}</title><style>${CSS}</style></head><body><h1>${escape(form.title)}</h1>${p(say('Resumen de respuestas'), 'mut')}${top}${sections}</body></html>`;
}
