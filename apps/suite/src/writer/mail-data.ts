import { Workbook, formatValue, isDateFormat, type Scalar } from '@suitenova/calc-engine';
import { mergeDataFromRows, parseDelimited, type MailMergeData } from '@suitenova/writer-core';
import { readXlsx } from '@suitenova/xlsx-io';

export function firstSheetRows(wb: Workbook): string[][] {
  for (const s of wb.sheets) {
    if (s.maxRow < 0) continue;
    const rows: string[][] = [];
    for (let r = 0; r <= s.maxRow; r++) {
      const line: string[] = [];
      for (let c = 0; c <= s.maxCol; c++) {
        const cell = s.cells.get(r * 16384 + c);
        const v: Scalar = cell?.value ?? null;
        const fmt = cell ? wb.styles.get(cell.style ?? 0).numFmt : undefined;
        if (v === null || v === undefined) line.push('');
        else if (typeof v === 'number' && isDateFormat(fmt)) line.push(formatValue(v, Number.isInteger(v) ? 'dd/mm/yyyy' : 'dd/mm/yyyy hh:mm', 'en').text);
        else if (typeof v === 'object') line.push(String((v as { code?: string }).code ?? ''));
        else if (typeof v === 'boolean') line.push(v ? 'Verdadero' : 'Falso');
        else line.push(String(v));
      }
      rows.push(line);
    }
    return rows;
  }
  return [];
}

/** Read the recipients of a mail merge from a .csv/.txt/.tsv or .xlsx file (the first row names the fields). */
export async function readMergeData(name: string, data: Uint8Array): Promise<MailMergeData> {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xlsx')) {
    const { workbook } = await readXlsx(data);
    const rows = firstSheetRows(workbook);
    if (rows.length < 2) throw new Error('El libro no tiene una fila de encabezados y datos.');
    return mergeDataFromRows(rows, name);
  }
  const text = new TextDecoder('utf-8').decode(data);
  const { fields, records } = parseDelimited(text);
  if (!fields.length) throw new Error('El archivo está vacío.');
  return mergeDataFromRows([fields, ...records], name);
}
