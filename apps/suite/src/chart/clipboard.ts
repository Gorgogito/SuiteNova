import { chartClipHtml, chartFromHtml, gridToTsv, type ChartClip } from '@suitenova/chart-core';

/*
 * El portapapeles del sistema para gráficos (Calc, Slides y Writer): ver `chart-core/src/clip.ts` para el formato. Con un evento de
 * copiar o pegar se usa su `DataTransfer`; desde los botones de la cinta, la API asíncrona del portapapeles.
 */

/** Pone el gráfico en el portapapeles de un evento de copiar o cortar. */
export function putChart(dt: DataTransfer, c: ChartClip): void {
  dt.setData('text/html', chartClipHtml(c));
  dt.setData('text/plain', gridToTsv(c.grid));
}

/** El gráfico que lleva un evento de pegar, si lleva uno. */
export const chartOfPaste = (dt: DataTransfer | null | undefined): ChartClip | null => chartFromHtml(dt?.getData('text/html'));

/** Copia el gráfico desde un botón (HTML con el gráfico y texto con los datos; si el navegador no deja, solo los datos). */
export async function writeChart(c: ChartClip): Promise<void> {
  const html = chartClipHtml(c);
  const text = gridToTsv(c.grid);
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
  } catch {
    await navigator.clipboard?.writeText(text).catch(() => undefined);
  }
}

/** El gráfico que hay en el portapapeles del sistema (desde un botón), o null. */
export async function readChart(): Promise<ChartClip | null> {
  try {
    for (const item of await navigator.clipboard.read()) {
      if (!item.types.includes('text/html')) continue;
      const c = chartFromHtml(await (await item.getType('text/html')).text());
      if (c) return c;
    }
  } catch {
    /* sin permiso para leer el portapapeles */
  }
  return null;
}
