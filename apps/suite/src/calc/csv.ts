import { formatValue, type FormulaLocale, type Scalar, type Workbook } from '@suitenova/calc-engine';
import { MAX_COLS, MAX_ROWS } from '@suitenova/calc-engine';

/** RFC-4180-style parser. Handles quotes, embedded delimiters and newlines. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const delim = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function detectDelimiter(text: string): string {
  const head = text.slice(0, 4000);
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let quoted = false;
  for (const ch of head) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch]!++;
    else if (!quoted && ch === '\n') break;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0];
}

/** Serialise a sheet's used range as CSV using displayed text (what the user sees). */
export function toCsv(wb: Workbook, sheetId: number, opts: { delimiter?: string; locale?: FormulaLocale; rawValues?: boolean } = {}): string {
  const delim = opts.delimiter ?? (opts.locale === 'es' ? ';' : ',');
  const sheet = wb.sheet(sheetId);
  const rows = sheet.maxRow + 1;
  const cols = sheet.maxCol + 1;
  const out: string[] = [];
  const esc = (s: string) => (s.includes(delim) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  for (let r = 0; r < Math.min(rows, MAX_ROWS); r++) {
    const line: string[] = [];
    for (let c = 0; c < Math.min(cols, MAX_COLS); c++) {
      const cell = sheet.cells.get(r * MAX_COLS + c);
      const v: Scalar = cell?.value ?? null;
      const text = opts.rawValues ? (v === null ? '' : String(typeof v === 'object' ? v.code : v)) : formatValue(v, wb.styles.get(cell?.style ?? 0).numFmt, opts.locale ?? 'en').text;
      line.push(esc(text));
    }
    out.push(line.join(delim));
  }
  return out.join('\r\n') + '\r\n';
}
