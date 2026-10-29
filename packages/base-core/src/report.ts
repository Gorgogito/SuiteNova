import type { ReportLayout } from './report-layout';

export interface ReportDef {
  source: { kind: 'table' | 'query'; name: string };
  title: string;
  columns: string[];
  groupBy: string | null;
  /** Columns to total (numeric columns). */
  sums: string[];
  landscape: boolean;
  /** Free design made in the report designer. Reports without one are laid out from the options above. */
  layout?: ReportLayout;
}

export const newReport = (source: ReportDef['source'], columns: string[]): ReportDef => ({ source, title: source.name, columns, groupBy: null, sums: [], landscape: false });

export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : new Intl.NumberFormat('es-ES', { maximumFractionDigits: 6 }).format(v);
  if (v instanceof Uint8Array) return `[${v.length} bytes]`;
  return String(v);
};
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v)) || 0;

/** The report as a standalone HTML document, ready to be shown or printed. */
export function renderReport(def: ReportDef, result: { columns: string[]; rows: unknown[][] }, opts: { date?: string } = {}): string {
  const idx = (name: string) => result.columns.indexOf(name);
  const cols = def.columns.filter((c) => idx(c) >= 0);
  const sums = def.sums.filter((c) => cols.includes(c));
  const gi = def.groupBy ? idx(def.groupBy) : -1;
  const cell = (c: string, v: unknown) => `<td class="${sums.includes(c) || typeof v === 'number' ? 'num' : ''}">${escapeHtml(fmt(v))}</td>`;
  const row = (r: unknown[]) => `<tr>${cols.map((c) => cell(c, r[idx(c)])).join('')}</tr>`;
  const totals = (rows: unknown[][], label: string, cls: string) =>
    sums.length || cls === 'grand'
      ? `<tr class="${cls}"><td colspan="${Math.max(1, cols.findIndex((c) => sums.includes(c)))}">${escapeHtml(label)} (${rows.length})</td>${cols
          .map((c, i) => (i < Math.max(1, cols.findIndex((x) => sums.includes(x)))) ? '' : sums.includes(c) ? `<td class="num">${escapeHtml(fmt(rows.reduce((s, r) => s + num(r[idx(c)]), 0)))}</td>` : '<td></td>')
          .join('')}</tr>`
      : '';
  let body = '';
  if (gi >= 0) {
    const groups = new Map<string, unknown[][]>();
    for (const r of result.rows) {
      const k = fmt(r[gi]) || '(vacío)';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    for (const k of keys) {
      const rs = groups.get(k)!;
      body += `<tr class="group"><th colspan="${cols.length}">${escapeHtml(def.groupBy!)}: ${escapeHtml(k)}</th></tr>${rs.map(row).join('')}${totals(rs, 'Subtotal', 'sub')}`;
    }
  } else body = result.rows.map(row).join('');
  body += totals(result.rows, 'Total', 'grand');
  const date = opts.date ?? new Date().toLocaleDateString('es-ES');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(def.title)}</title><style>
@page{size:${def.landscape ? 'A4 landscape' : 'A4'};margin:15mm}
body{font:10pt 'Segoe UI',Calibri,Arial,sans-serif;color:#000;margin:0}
h1{font-size:16pt;margin:0 0 2pt}.meta{color:#555;font-size:9pt;margin-bottom:10pt}
table{border-collapse:collapse;width:100%}th,td{padding:3pt 6pt;text-align:left;border-bottom:1px solid #ddd}
thead th{border-bottom:2px solid #000;background:#f2f2f2}td.num{text-align:right}
tr.group th{background:#e8eef7;border-bottom:1px solid #99a}tr.sub td{font-weight:600;border-top:1px solid #999}tr.grand td{font-weight:700;border-top:2px solid #000}
tr{break-inside:avoid}thead{display:table-header-group}
</style></head><body><h1>${escapeHtml(def.title)}</h1><div class="meta">${escapeHtml(date)} · ${result.rows.length} registros</div>
<table><thead><tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}
