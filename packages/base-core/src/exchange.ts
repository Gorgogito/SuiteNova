/*
 * Moving data in and out: JSON, XML and HTML tables to export, JSON to import. (CSV is in csv.ts, SQL dumps and copies between
 * databases are methods of BaseDb.)
 */

const cell = (v: unknown): unknown => {
  if (v instanceof Uint8Array) {
    let s = '';
    for (let i = 0; i < v.length; i += 0x8000) s += String.fromCharCode(...v.subarray(i, i + 0x8000));
    return typeof btoa === 'function' ? btoa(s) : `[${v.length} bytes]`;
  }
  return v;
};

/** An array of objects, one per record, with the columns as keys. Yes/No columns stay as 0/1 (that is how they are stored). */
export function toJson(columns: string[], rows: unknown[][], pretty = true): string {
  const list = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, cell(r[i] ?? null)])));
  return JSON.stringify(list, null, pretty ? 2 : undefined) + '\n';
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A name that is valid as an XML element (spaces and symbols become underscores). */
export const xmlName = (s: string): string => {
  const n = s.replace(/[^\p{L}\p{N}_.-]/gu, '_');
  return /^[\p{L}_]/u.test(n) ? n : `_${n}`;
};

/** `<Tabla nombre="…"><Registro><campo>valor</campo>…</Registro>…</Tabla>`; an empty value has no element, as Access exports it. */
export function toXml(table: string, columns: string[], rows: unknown[][]): string {
  const names = columns.map(xmlName);
  const body = rows
    .map((r) => `  <Registro>\n${columns.map((_c, i) => (r[i] === null || r[i] === undefined ? '' : `    <${names[i]}>${xmlEscape(String(cell(r[i])))}</${names[i]}>\n`)).join('')}  </Registro>\n`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Tabla nombre="${xmlEscape(table)}">\n${body}</Tabla>\n`;
}

/** A complete HTML page with the data as a table. */
export function toHtml(title: string, columns: string[], rows: unknown[][], numeric: boolean[] = []): string {
  const th = columns.map((c) => `<th>${xmlEscape(c)}</th>`).join('');
  const tr = rows
    .map((r) => `<tr>${columns.map((_c, i) => `<td${numeric[i] ? ' style="text-align:right"' : ''}>${r[i] === null || r[i] === undefined ? '' : xmlEscape(String(r[i] instanceof Uint8Array ? `[${(r[i] as Uint8Array).length} bytes]` : r[i]))}</td>`).join('')}</tr>`)
    .join('\n');
  return `<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><title>${xmlEscape(title)}</title><style>body{font:13px Calibri,Arial,sans-serif;margin:24px}table{border-collapse:collapse}th,td{border:1px solid #bbb;padding:3px 8px}th{background:#eee;text-align:left}</style></head>\n<body><h1>${xmlEscape(title)}</h1>\n<table><thead><tr>${th}</tr></thead>\n<tbody>\n${tr}\n</tbody></table></body></html>\n`;
}

/**
 * Rows of text from JSON: an array of objects (the columns are all the keys, in order of appearance), an array of arrays (the first is
 * the header), an object holding one such array (`{"clientes": [...]}`), or one object per line (NDJSON).
 */
export function parseJson(text: string): { columns: string[]; rows: string[][] } {
  const src = text.replace(/^﻿/, '').trim();
  let data: unknown;
  try {
    data = JSON.parse(src);
  } catch {
    const lines = src.split(/\r?\n/).filter((l) => l.trim());
    try {
      data = lines.map((l) => JSON.parse(l));
    } catch {
      throw new Error('El archivo no es JSON válido.');
    }
  }
  if (data && !Array.isArray(data) && typeof data === 'object') {
    const arrays = Object.values(data as object).filter(Array.isArray);
    if (arrays.length === 1) data = arrays[0];
    else data = [data];
  }
  if (!Array.isArray(data) || !data.length) throw new Error('El JSON no contiene registros.');
  const text1 = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  if (data.every((r) => Array.isArray(r))) {
    const [head, ...rest] = data as unknown[][];
    return { columns: head!.map(text1), rows: rest.map((r) => head!.map((_h, i) => text1(r[i]))) };
  }
  if (!data.every((r) => r && typeof r === 'object' && !Array.isArray(r))) throw new Error('El JSON debe ser una lista de objetos o de listas.');
  const columns: string[] = [];
  for (const r of data as Record<string, unknown>[]) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
  return { columns, rows: (data as Record<string, unknown>[]).map((r) => columns.map((c) => text1(r[c]))) };
}
