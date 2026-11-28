/* The responses as an Excel workbook: one sheet with a row per response and one with the figures. */
import { Workbook, serialFromDate, type Scalar } from '@suitenova/calc-engine';
import { numbers, responseTable, summarize, type Form, type Response, type TableValue } from '@suitenova/forms-core';
import { writeXlsx } from '@suitenova/xlsx-io';

/** The most a cell of Excel holds. */
const CELL = 32_767;
/** Text a workbook can carry: without the control characters XML refuses. */
// eslint-disable-next-line no-control-regex
const clean = (s: string): string => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').slice(0, CELL);

export async function responsesXlsx(form: Form, responses: Response[]): Promise<Uint8Array> {
  const wb = new Workbook();
  const first = wb.sheets[0]!;
  first.name = 'Respuestas';
  const bold = wb.styles.derive(0, { bold: true });
  const moment = wb.styles.derive(0, { numFmt: 'yyyy-mm-dd hh:mm' });
  const day = wb.styles.derive(0, { numFmt: 'yyyy-mm-dd' });
  // written as values: a text that starts like a formula stays a text
  const put = (sheet: number, row: number, col: number, value: TableValue | undefined, style = 0) => {
    if (value === null || value === undefined || value === '') return;
    if (value instanceof Date) {
      const timed = !!(value.getHours() || value.getMinutes() || value.getSeconds());
      wb.loadCell(sheet, row, col, { value: serialFromDate(value), style: timed ? moment : day });
    } else wb.loadCell(sheet, row, col, { value: (typeof value === 'string' ? clean(value) : value) as Scalar, style });
  };

  const table = responseTable(form, responses);
  table.head.forEach((h, c) => {
    put(first.id, 0, c, h, bold);
    first.colWidths.set(c, c < 2 ? 130 : 170);
  });
  table.rows.forEach((row, r) => row.forEach((v, c) => put(first.id, r + 1, c, v)));
  first.freeze = { rows: 1, cols: 0 };

  const second = wb.addSheet('Resumen');
  const nums = numbers(form);
  let line = 0;
  const add = (cells: TableValue[], style = 0) => {
    cells.forEach((v, c) => put(second.id, line, c, v, style));
    line++;
  };
  add(['Pregunta', 'Dato', 'Respuestas', '%'], bold);
  for (const s of summarize(form, responses).questions) {
    const title = `${nums.get(s.question.id)}. ${s.question.title}`;
    if (s.kind === 'counts' || s.kind === 'rating' || s.kind === 'nps') for (const i of s.items) add([title, i.label, i.count, i.pct]);
    else if (s.kind === 'number') {
      if (s.answered) for (const [label, value] of [['Media', s.average], ['Mediana', s.median], ['Mínimo', s.min], ['Máximo', s.max]] as const) add([title, label, value]);
    } else if (s.kind === 'likert') for (const row of s.rows) row.counts.forEach((n, i) => add([title, `${row.row}: ${s.question.options[i]}`, n]));
    else if (s.kind === 'ranking') for (const i of s.items) add([title, `${i.label} (puesto medio)`, i.average === null ? null : Math.round(i.average * 100) / 100]);
    else add([title, 'Respondidas', s.answered]);
  }
  [320, 220, 90, 60].forEach((w, c) => second.colWidths.set(c, w));
  second.freeze = { rows: 1, cols: 0 };
  return writeXlsx(wb);
}
