import type { ChartCell, ChartSource, RangeRead } from '@suitenova/chart-core';
import { resolveRangeText } from './charts';
import { formatValue } from './format';
import type { FormulaLocale } from './locale';
import { isErr } from './values';
import type { Workbook } from './workbook';

/** La fuente de datos de un gráfico de una hoja: lee sus rangos del libro (los errores de fórmula llegan como su texto). */
export function chartSource(wb: Workbook, sheetId: number, locale: FormulaLocale = 'en'): ChartSource {
  return {
    range(text: string | undefined): RangeRead {
      const r = resolveRangeText(wb, text, sheetId);
      if (!r) return { values: [], labels: [] };
      const sheet = wb.sheet(r.sheetId);
      const values: ChartCell[] = [];
      const labels: string[] = [];
      const r2 = Math.min(r.rect.r2, Math.max(sheet.maxRow, r.rect.r1));
      const c2 = Math.min(r.rect.c2, Math.max(sheet.maxCol, r.rect.c1));
      for (let row = r.rect.r1; row <= r2; row++) {
        for (let col = r.rect.c1; col <= c2; col++) {
          const cell = sheet.cells.get(row * 16384 + col);
          const v = cell?.value ?? null;
          const text = formatValue(v, wb.styles.get(cell?.style ?? 0).numFmt, locale).text;
          values.push(isErr(v) ? text : (v as ChartCell));
          labels.push(text);
        }
      }
      return { values, labels };
    },
  };
}
