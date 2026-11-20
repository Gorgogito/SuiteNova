import type { OcrResult, OcrWord } from './model';

export interface TableOptions {
  /** A gap between two words wider than this many line heights separates two columns (a space inside a cell is narrower). Default 1.2. */
  gap?: number;
}

export interface FoundTable {
  rows: string[][];
  columns: number;
}

/**
 * The table in a reading, from where the words are: the lines are the rows, and the columns are the vertical strips where no row has a word
 * (the white space that runs from the top of the table to its bottom). Words are joined into a cell by the narrow spaces inside a row.
 */
export function tableFromWords(result: OcrResult, o: TableOptions = {}): FoundTable {
  const lines = result.lines.filter((l) => l.words.length);
  if (!lines.length) return { rows: [], columns: 0 };
  const gapFactor = o.gap ?? 1.2;
  // 1) the words of each row, in cells split by wide gaps
  const rowCells = lines.map((l) => {
    const h = l.box.h || 1;
    const cells: OcrWord[][] = [];
    for (const w of [...l.words].sort((a, b) => a.box.x - b.box.x)) {
      const cell = cells[cells.length - 1];
      const last = cell?.[cell.length - 1];
      if (cell && last && w.box.x - (last.box.x + last.box.w) <= h * gapFactor) cell.push(w);
      else cells.push([w]);
    }
    return cells;
  });
  // 2) column edges: strips of x where no cell of any row reaches (the rows are one table, so the strips between columns are empty in all)
  const spans = rowCells.flatMap((cells) => cells.map((c) => ({ from: c[0]!.box.x, to: Math.max(...c.map((w) => w.box.x + w.box.w)) })));
  const edges = columnStarts(spans);
  // 3) each cell goes to the column it starts in
  const rows = rowCells.map((cells) => {
    const row = new Array<string>(edges.length).fill('');
    for (const c of cells) {
      const x = c[0]!.box.x;
      let col = 0;
      for (let i = 0; i < edges.length; i++) if (x >= edges[i]! - 1) col = i;
      row[col] = (row[col] ? `${row[col]} ` : '') + c.map((w) => w.text).join(' ');
    }
    return row;
  });
  return { rows, columns: edges.length };
}

/** Where each column starts: the left edge of every strip that has cells after an empty gap. */
function columnStarts(spans: { from: number; to: number }[]): number[] {
  const sorted = [...spans].sort((a, b) => a.from - b.from);
  const starts: number[] = [];
  let reach = -Infinity;
  for (const s of sorted) {
    if (s.from > reach + 1) starts.push(s.from);
    reach = Math.max(reach, s.to);
  }
  return starts;
}

/**
 * A cell as a spreadsheet value: «1.234,56» (Spanish) and «1,234.56» (English) are numbers, «45 %» is a fraction, «€ 3,50» and «$12» are numbers;
 * anything else is text. The text of a cell that is not a number is left as it is.
 */
export function cellValue(text: string, locale: 'es' | 'en' = 'es'): number | string {
  const t = text.trim();
  if (!t) return '';
  const pct = /^(-?[\d.,]+)\s*%$/.exec(t);
  const core = (pct ? pct[1]! : t.replace(/^[€$£]\s*|\s*[€$£]$/g, '')).replace(/\s/g, '');
  if (!/^-?[\d.,]+$/.test(core) || !/\d/.test(core)) return t;
  const [thousand, decimal] = locale === 'es' ? ['.', ','] : [',', '.'];
  const dec = core.lastIndexOf(decimal);
  const groups = core.split(thousand).length - 1;
  let n: string;
  if (dec >= 0) {
    // the decimal mark is the last one; the thousands before it must be groups of three
    const int = core.slice(0, dec).split(thousand).join('');
    if (core.slice(0, dec).includes(decimal)) return t;
    n = `${int}.${core.slice(dec + 1)}`;
  } else if (groups > 0) {
    const parts = core.split(thousand);
    if (!parts.slice(1).every((p) => p.length === 3)) return t;
    n = parts.join('');
  } else n = core;
  const v = Number(n);
  if (!Number.isFinite(v)) return t;
  return pct ? v / 100 : v;
}
