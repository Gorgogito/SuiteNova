import type { ChartSpec, Report, TableSpec } from './reports';

/** Own export of a report: CSV for spreadsheets, and one HTML page (charts drawn as SVG) that prints well. */

const PALETTE = ['#4a7bd0', '#2e7d32', '#e6a100', '#c0392b', '#7b57c9', '#00838f', '#8d6e63', '#546e7a'];
const esc = (s: string | number): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const id = (s: string): string => s;

type Tr = (s: string) => string;

const csvCell = (v: string | number | null): string => {
  const s = v === null ? '' : String(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells: (string | number | null)[]): string => cells.map(csvCell).join(';');

function chartTable(c: ChartSpec, tr: Tr): TableSpec {
  return { title: tr(c.title), columns: ['', ...c.series.map((s) => tr(s.name))], rows: c.categories.map((cat, i) => [cat, ...c.series.map((s) => s.data[i] ?? '')]) };
}

/** Semicolon-separated, with a byte-order mark added by the caller if wanted; numbers keep a dot. */
export function reportToCsv(r: Report, tr: Tr = id): string {
  const out: string[] = [csvRow([tr(r.title)]), ''];
  if (r.kpis.length) {
    for (const k of r.kpis) out.push(csvRow([tr(k.label), k.value]));
    out.push('');
  }
  for (const t of [...r.tables, ...r.charts.map((c) => chartTable(c, tr))]) {
    out.push(csvRow([t.title]), csvRow(t.columns.map((c) => tr(c))), ...t.rows.map((row) => csvRow(row)), '');
  }
  return out.join('\r\n');
}

function ticks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

const num = (v: number): string => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('es-ES') : String(Math.round(v * 100) / 100));

/** One chart as a self-contained SVG. */
export function chartSvg(c: ChartSpec, tr: Tr = id, w = 680, h = 280): string {
  const color = (i: number) => c.series[i]?.color ?? PALETTE[i % PALETTE.length]!;
  const legend = (y: number) =>
    c.series.map((s, i) => `<g transform="translate(${60 + i * 130},${y})"><rect width="10" height="10" fill="${color(i)}"/><text x="14" y="9" font-size="11">${esc(tr(s.name))}</text></g>`).join('');
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(tr(c.title))}" font-family="Segoe UI, Arial, sans-serif">`;
  if (c.kind === 'pie') {
    const data = (c.series[0]?.data ?? []).map((v) => Math.max(0, v ?? 0));
    const total = data.reduce((a, v) => a + v, 0);
    const cx = 130;
    const cy = h / 2;
    const r = Math.min(110, h / 2 - 20);
    let a0 = -Math.PI / 2;
    const slices = total <= 0
      ? ''
      : data
          .map((v, i) => {
            const a1 = a0 + (v / total) * Math.PI * 2;
            const large = a1 - a0 > Math.PI ? 1 : 0;
            const d = v / total >= 0.9999 ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy}` : `M ${cx} ${cy} L ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} Z`;
            a0 = a1;
            return `<path d="${d}" fill="${PALETTE[i % PALETTE.length]}" stroke="#fff"/>`;
          })
          .join('');
    const items = c.categories.map((cat, i) => `<g transform="translate(290,${30 + i * 20})"><rect width="10" height="10" fill="${PALETTE[i % PALETTE.length]}"/><text x="16" y="9" font-size="12">${esc(cat)} — ${esc(num(data[i] ?? 0))}${total > 0 ? ` (${Math.round(((data[i] ?? 0) / total) * 100)} %)` : ''}</text></g>`).join('');
    return `${head}${slices}${items}</svg>`;
  }
  const left = 56;
  const top = 12;
  const bottom = 56;
  const pw = w - left - 12;
  const ph = h - top - bottom;
  const n = Math.max(1, c.categories.length);
  const stacked = c.kind === 'stack';
  const maxOf = (i: number) => (stacked ? c.series.reduce((a, s) => a + Math.max(0, s.data[i] ?? 0), 0) : Math.max(0, ...c.series.map((s) => s.data[i] ?? 0)));
  const ymax = Math.max(0, ...c.categories.map((_, i) => maxOf(i)));
  const tk = ticks(ymax);
  const top1 = tk[tk.length - 1]!;
  const y = (v: number) => top + ph - (v / top1) * ph;
  const grid = tk.map((v) => `<line x1="${left}" x2="${left + pw}" y1="${y(v)}" y2="${y(v)}" stroke="#ddd"/><text x="${left - 6}" y="${y(v) + 4}" font-size="10" text-anchor="end">${esc(num(v))}</text>`).join('');
  const every = Math.max(1, Math.ceil(n / 12));
  const labels = c.categories.map((cat, i) => (i % every === 0 ? `<text x="${left + ((i + 0.5) * pw) / n}" y="${top + ph + 14}" font-size="10" text-anchor="middle">${esc(cat)}</text>` : '')).join('');
  let body = '';
  if (c.kind === 'bar' || c.kind === 'stack') {
    const slot = pw / n;
    const bw = stacked ? slot * 0.7 : (slot * 0.8) / Math.max(1, c.series.length);
    c.categories.forEach((_, i) => {
      let acc = 0;
      c.series.forEach((s, k) => {
        const v = Math.max(0, s.data[i] ?? 0);
        const x = stacked ? left + i * slot + slot * 0.15 : left + i * slot + slot * 0.1 + k * bw;
        const y0 = stacked ? y(acc + v) : y(v);
        const hh = stacked ? y(acc) - y(acc + v) : y(0) - y(v);
        if (hh > 0) body += `<rect x="${x}" y="${y0}" width="${Math.max(1, bw)}" height="${hh}" fill="${color(k)}"/>`;
        acc += v;
      });
    });
  } else {
    const x = (i: number) => left + (n === 1 ? pw / 2 : (i * pw) / (n - 1));
    c.series.forEach((s, k) => {
      const runs: string[][] = [[]];
      s.data.forEach((v, i) => (v === null ? runs.push([]) : runs[runs.length - 1]!.push(`${x(i)},${y(v)}`)));
      for (const run of runs.filter((r) => r.length)) {
        if (c.kind === 'area') body += `<polygon points="${run[0]!.split(',')[0]},${y(0)} ${run.join(' ')} ${run[run.length - 1]!.split(',')[0]},${y(0)}" fill="${color(k)}" fill-opacity="0.25"/>`;
        body += `<polyline points="${run.join(' ')}" fill="none" stroke="${color(k)}" stroke-width="2"/>`;
      }
    });
  }
  const unit = c.unit ? `<text x="${left}" y="${top - 2}" font-size="10" fill="#555">${esc(c.unit)}</text>` : '';
  return `${head}${grid}${body}<line x1="${left}" x2="${left + pw}" y1="${y(0)}" y2="${y(0)}" stroke="#888"/>${labels}${unit}${legend(h - 18)}</svg>`;
}

const tableHtml = (t: TableSpec, tr: Tr): string =>
  `<table><caption>${esc(tr(t.title))}</caption><thead><tr>${t.columns.map((c) => `<th>${esc(tr(c))}</th>`).join('')}</tr></thead><tbody>${t.rows
    .map((row) => `<tr>${row.map((v) => `<td${typeof v === 'number' ? ' class="n"' : ''}>${esc(v)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;

export interface ReportHtmlOptions {
  project: string;
  /** Text of the page language, for the `lang` attribute. */
  lang?: string;
  /** Generation date shown under the title. */
  date?: string;
  /** Calls `print()` when the page opens (used to print from the app). */
  autoPrint?: boolean;
}

/** A standalone page with the KPIs, charts and tables of a report. */
export function reportToHtml(r: Report, opts: ReportHtmlOptions, tr: Tr = id): string {
  const kpis = r.kpis.length ? `<div class="kpis">${r.kpis.map((k) => `<div class="kpi ${k.tone ?? ''}"><span>${esc(tr(k.label))}</span><strong>${esc(k.value)}</strong></div>`).join('')}</div>` : '';
  const charts = r.charts.map((c) => `<figure><figcaption>${esc(tr(c.title))}</figcaption>${chartSvg(c, tr)}</figure>`).join('');
  const tables = r.tables.map((t) => tableHtml(t, tr)).join('');
  return `<!doctype html><html lang="${esc(opts.lang ?? 'es')}"><head><meta charset="utf-8"><title>${esc(opts.project)} — ${esc(tr(r.title))}</title><style>
body{font:13px/1.4 "Segoe UI",Arial,sans-serif;margin:24px;color:#222}h1{font-size:20px;margin:0}p.sub{margin:2px 0 16px;color:#666}
.kpis{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px}.kpi{border:1px solid #ccc;border-radius:6px;padding:6px 12px;min-width:120px}.kpi span{display:block;font-size:11px;color:#555}.kpi strong{font-size:16px}
.kpi.good strong{color:#2e7d32}.kpi.bad strong{color:#c0392b}.kpi.warn strong{color:#b27b00}
figure{margin:0 0 18px;break-inside:avoid}figcaption{font-weight:600;margin-bottom:4px}
table{border-collapse:collapse;margin-bottom:18px;width:100%;break-inside:auto}caption{text-align:left;font-weight:600;padding:4px 0}th,td{border:1px solid #ccc;padding:3px 8px;text-align:left}th{background:#f1f1f1}td.n{text-align:right}
@media print{body{margin:12mm}tr{break-inside:avoid}}</style></head><body${opts.autoPrint ? ' onload="window.print()"' : ''}><h1>${esc(tr(r.title))}</h1><p class="sub">${esc(opts.project)}${opts.date ? ` · ${esc(opts.date)}` : ''}</p>${kpis}${charts}${tables}</body></html>`;
}
