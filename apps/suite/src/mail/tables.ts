import { DEFAULT_OPTIONS, evalFormula, lookOf, parseNumber, styleById, type CellLook, type StyleOptions } from '@suitenova/table-core';

/*
 * Tables in the body of a message. The body stays plain text; a table is a token in it, `[Tabla: nombre]`. What is sent has the table twice:
 * in the HTML part, as a real <table> with the style written inline (mail programs do not read style sheets), and in the text part, as
 * aligned text. The cells of the table in the message being written are text; one that starts with «=» is a formula (=SUM(ABOVE), =B2*C2),
 * as in Outlook, and shows its result. A saved draft keeps the token in its text and the table in its HTML (`data-nova`), so it opens again
 * as it was.
 */

export interface ComposeTable {
  id: string;
  /** The name in the body token. */
  name: string;
  /** What is written in each cell (a formula starts with «=»). */
  rows: string[][];
  /** The style of the table (an id of `@suitenova/table-core`), or null for a plain grid with thin lines. */
  styleId: string | null;
  options: StyleOptions;
}

export const tableToken = (name: string): string => `[Tabla: ${name}]`;
const TOKEN = /\[Tabla: ([^\]\n]+)\]/g;

export function newTable(name: string, rows: number, cols: number): ComposeTable {
  return {
    id: `nova-t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')),
    styleId: 'grid-1',
    options: { ...DEFAULT_OPTIONS },
  };
}

/** A name for a new table that no other table of the message has («Tabla 1», «Tabla 2»…). */
export function uniqueTableName(taken: string[]): string {
  for (let i = 1; ; i++) if (!taken.includes(`Tabla ${i}`)) return `Tabla ${i}`;
}

const systemDecimal = (): '.' | ',' => ((1.5).toLocaleString().includes(',') ? ',' : '.');

/** What every cell shows: its text, or the result of its formula. A formula may read another one, so it is calculated again until nothing changes. */
export function shownCells(t: ComposeTable, decimal: '.' | ',' = systemDecimal()): string[][] {
  const rows = t.rows.length;
  const cols = Math.max(0, ...t.rows.map((r) => r.length));
  const shown = t.rows.map((r) => Array.from({ length: cols }, (_x, c) => r[c] ?? ''));
  const isF = (r: number, c: number) => /^\s*=/.test(t.rows[r]?.[c] ?? '');
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (isF(r, c)) shown[r]![c] = '';
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!isF(r, c)) continue;
        const f = (t.rows[r]![c] ?? '').replace(/^\s*=\s*/, '');
        const out = evalFormula(f, { row: r, col: c, rows, cols, text: (rr, cc) => (rr === r && cc === c ? '' : (shown[rr]?.[cc] ?? '')), decimal }).text;
        if (out !== shown[r]![c]) {
          shown[r]![c] = out;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return shown;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const looks = (t: ComposeTable): CellLook[][] => {
  const style = t.styleId ? styleById(t.styleId) : undefined;
  const size = { rows: t.rows.length, cols: Math.max(0, ...t.rows.map((r) => r.length)) };
  const plain = { style: 'single' as const, width: 0.5, color: '#999999' };
  return t.rows.map((_row, r) =>
    Array.from({ length: size.cols }, (_x, c) => {
      const look = lookOf(style, t.options, { r, c }, size);
      // a table with no style still has thin lines, so that it reads as a table
      return style ? look : { ...look, borders: { t: plain, r: plain, b: plain, l: plain } };
    }),
  );
};

const cssBorder = (b: { style: string; width: number; color: string } | undefined): string => {
  if (!b) return 'none';
  const st = b.style === 'dashed' ? 'dashed' : b.style === 'dotted' ? 'dotted' : b.style === 'double' ? 'double' : 'solid';
  return `${Math.max(1, Math.round((b.width * 96) / 72))}px ${st} ${b.color}`;
};

const isNumber = (s: string): boolean => s.trim() !== '' && parseNumber(s) !== null && /^[^A-Za-z]*$/.test(s);

/** The table as HTML with the style inline; `data-nova` has the table as it is written, to open the draft again. */
export function tableHtml(t: ComposeTable, decimal?: '.' | ','): string {
  const shown = shownCells(t, decimal);
  const lk = looks(t);
  const head = t.options.firstRow && !!t.styleId;
  const data = esc(JSON.stringify({ id: t.id, name: t.name, rows: t.rows, styleId: t.styleId, options: t.options }));
  const body = shown
    .map((row, r) => {
      const tds = row
        .map((txt, c) => {
          const l = lk[r]![c]!;
          const css = [
            'padding:4px 8px',
            `border-top:${cssBorder(l.borders.t)}`,
            `border-right:${cssBorder(l.borders.r)}`,
            `border-bottom:${cssBorder(l.borders.b)}`,
            `border-left:${cssBorder(l.borders.l)}`,
            l.fill ? `background-color:${l.fill}` : '',
            l.color ? `color:${l.color}` : '',
            l.bold ? 'font-weight:bold' : '',
            isNumber(txt) ? 'text-align:right' : 'text-align:left',
          ].filter(Boolean);
          const tag = head && r === 0 ? 'th' : 'td';
          return `<${tag} style="${css.join(';')}">${esc(txt) || '&nbsp;'}</${tag}>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `<table role="table" data-nova="${data}" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tbody>${body}</tbody></table>`;
}

/** The table as aligned text: columns padded to the same width, numbers to the right, a line under the header row. */
export function tableText(t: ComposeTable, decimal?: '.' | ','): string {
  const shown = shownCells(t, decimal);
  const cols = shown[0]?.length ?? 0;
  const w = Array.from({ length: cols }, (_x, c) => Math.max(1, ...shown.map((r) => [...(r[c] ?? '')].length)));
  const pad = (s: string, n: number, right: boolean) => (right ? ' '.repeat(Math.max(0, n - [...s].length)) + s : s + ' '.repeat(Math.max(0, n - [...s].length)));
  const lines = shown.map((r) => r.map((s, c) => pad(s, w[c]!, isNumber(s))).join(' | ').trimEnd());
  if (t.options.firstRow && t.styleId && lines.length > 1) lines.splice(1, 0, w.map((n) => '-'.repeat(n)).join('-+-'));
  return lines.join('\n');
}

/** The tables the body still mentions, in order. */
export const usedTables = (body: string, tables: ComposeTable[]): ComposeTable[] => {
  const out: ComposeTable[] = [];
  for (const m of body.matchAll(TOKEN)) {
    const t = tables.find((x) => x.name === m[1]);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
};

/** The text part of what is sent: every table token becomes its aligned text. */
export function textBody(body: string, tables: ComposeTable[], decimal?: '.' | ','): string {
  if (!tables.length) return body;
  return body.replace(TOKEN, (all, name: string) => {
    const t = tables.find((x) => x.name === name);
    return t ? tableText(t, decimal) : all;
  });
}

/** The tables of a draft that is opened again, read from the `data-nova` of its HTML. */
export function tablesOfDraft(html: string | null): ComposeTable[] {
  if (!html) return [];
  const out: ComposeTable[] = [];
  for (const m of html.matchAll(/<table[^>]*\sdata-nova="([^"]*)"/gi)) {
    try {
      const raw = m[1]!.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      const d = JSON.parse(raw) as Partial<ComposeTable>;
      if (typeof d.name !== 'string' || !Array.isArray(d.rows)) continue;
      out.push({ id: String(d.id ?? d.name), name: d.name, rows: d.rows.map((r) => (Array.isArray(r) ? r.map(String) : [])), styleId: d.styleId ?? null, options: { ...DEFAULT_OPTIONS, ...(d.options ?? {}) } });
    } catch {
      /* a table that cannot be read is left as text */
    }
  }
  return out;
}
