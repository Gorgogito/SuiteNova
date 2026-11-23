import { parseNumber } from './number';

/** Text to table and table to text. */

export type Separator = 'tab' | 'semicolon' | 'comma' | 'paragraph';
const SEP: Record<Exclude<Separator, 'paragraph'>, string> = { tab: '\t', semicolon: ';', comma: ',' };

/** One line of text split into cells; with quotes, a separator inside «"a,b"» does not split. */
export function splitLine(text: string, sep: Separator): string[] {
  if (sep === 'paragraph') return [text];
  const d = SEP[sep];
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' && sep !== 'tab') {
      if (quoted && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === d && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** The separator that fits a text best: tabs if there are any, else semicolons, else commas, else one cell per line. */
export function detectSeparator(text: string): Separator {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.some((l) => l.includes('\t'))) return 'tab';
  for (const s of ['semicolon', 'comma'] as const) {
    const counts = lines.map((l) => splitLine(l, s).length);
    if (lines.length && counts.every((n) => n > 1) && Math.max(...counts) - Math.min(...counts) <= 1) return s;
  }
  return 'paragraph';
}

/** The text as rows of cells, all rows the same length. Trailing empty lines are dropped. */
export function textToRows(text: string, sep: Separator = detectSeparator(text)): string[][] {
  const lines = text.split(/\r?\n/);
  while (lines.length > 1 && !lines[lines.length - 1]!.trim()) lines.pop();
  const rows = lines.map((l) => (sep === 'paragraph' ? [l.trim()] : splitLine(l, sep).map((c) => c.trim())));
  const n = Math.max(1, ...rows.map((r) => r.length));
  return rows.map((r) => Array.from({ length: n }, (_v, i) => r[i] ?? ''));
}

/** The table as text: the cells of a row joined by the separator, one row per line. A cell that has the separator in it is put in quotes. */
export function rowsToText(rows: string[][], sep: Exclude<Separator, 'paragraph'> = 'tab'): string {
  const d = SEP[sep];
  const cell = (s: string) => (sep !== 'tab' && (s.includes(d) || s.includes('"')) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map(cell).join(d)).join('\n');
}

/** The rows as an HTML table (for the HTML part of a message and for the clipboard). Cell text is escaped. */
export function rowsToHtml(rows: string[][], opts: { header?: boolean; border?: string } = {}): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const border = opts.border ?? '1px solid #999';
  const td = (s: string, tag: string) => `<${tag} style="border:${border};padding:4px 8px">${esc(s)}</${tag}>`;
  const body = rows.map((r, i) => `<tr>${r.map((c) => td(c, opts.header && i === 0 ? 'th' : 'td')).join('')}</tr>`).join('');
  return `<table style="border-collapse:collapse">${body}</table>`;
}

/** True when most of a column looks like numbers (to right-align it or sort it as numbers). */
export function isNumericColumn(values: string[]): boolean {
  const filled = values.filter((v) => v.trim());
  return filled.length > 0 && filled.filter((v) => parseNumber(v) !== null).length / filled.length >= 0.8;
}
