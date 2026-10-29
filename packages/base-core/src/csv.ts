/** RFC 4180 style CSV reader (quoted fields, doubled quotes, embedded line breaks). The delimiter is detected when not given. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const d = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let any = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      quoted = true;
      any = true;
    } else if (c === d) {
      row.push(field);
      field = '';
      any = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (any || row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      field = '';
      any = false;
    } else {
      field += c;
      any = true;
    }
  }
  if (any || field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function detectDelimiter(text: string): string {
  const head = text.slice(0, 4000).split(/\r?\n/).slice(0, 5).join('\n');
  const counts = [',', ';', '\t', '|'].map((d) => [d, head.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ',';
}

export function toCsv(columns: string[], rows: unknown[][], delimiter = ','): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Uint8Array ? `[${v.length} bytes]` : String(v);
    return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(cell).join(delimiter), ...rows.map((r) => r.map(cell).join(delimiter))].join('\r\n') + '\r\n';
}
