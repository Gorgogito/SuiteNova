import { formFromSheet, parseGoogleForm, type ImportedForm } from '@suitenova/forms-core';
import { parseDelimited } from '@suitenova/writer-core';
import { readXlsx } from '@suitenova/xlsx-io';
import { firstSheetRows } from '../writer/mail-data';

export const IMPORT_FILTERS = [{ name: 'Google Forms (página guardada) u hoja de respuestas de Microsoft/Google Forms', extensions: ['html', 'htm', 'xlsx', 'csv'] }];
export const isImportName = (name: string): boolean => /\.(html?|xlsx|csv)$/i.test(name);

/** Read a form made in Google Forms (saved page) or rebuild it from the responses sheet of Microsoft or Google Forms. */
export async function readForeignForm(name: string, data: Uint8Array): Promise<ImportedForm> {
  const lower = name.toLowerCase();
  const title = name.replace(/\.[^.]+$/, '');
  if (/\.html?$/.test(lower)) return parseGoogleForm(new TextDecoder('utf-8').decode(data));
  if (lower.endsWith('.xlsx')) {
    const { workbook } = await readXlsx(data);
    const rows = firstSheetRows(workbook);
    if (!rows.length) throw new Error('El libro está vacío.');
    return formFromSheet(rows, title);
  }
  const { fields, records } = parseDelimited(new TextDecoder('utf-8').decode(data));
  if (!fields.length) throw new Error('El archivo está vacío.');
  return formFromSheet([fields, ...records], title);
}
