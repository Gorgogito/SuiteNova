import {
  CT_CHARTEX,
  CT_CHARTEX_COLORS,
  CT_CHARTEX_STYLE,
  REL_CHARTEX_COLORS,
  REL_CHARTEX_STYLE,
  chartExColorsXml,
  chartExStyleXml,
  chartExXml,
  chartXml,
  dmlParser,
  gridFromCaches,
  gridSource,
  isExType,
  parseChart,
  parseChartEx,
  readChartCaches,
  type ChartCell,
  type ChartGrid,
  type ChartSpec,
} from '@suitenova/chart-core';

/*
 * Los gráficos de PowerPoint con el motor compartido (chart-core): se lee la parte del gráfico y su rejilla de datos sale de los
 * valores en caché; se escribe la parte con esos valores y el libro mínimo que PowerPoint abre para editar los datos.
 */

const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export const CT_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export { CT_CHARTEX };

/** El gráfico de una parte `c:chartSpace` o `cx:chartSpace`, con su rejilla; o el motivo de no poder mostrarlo. */
export function readChartPart(xml: string): { spec: ChartSpec; grid: ChartGrid } | { skip: string } {
  const doc = dmlParser.parse(xml);
  const ex = doc?.chartSpace?.chartData !== undefined;
  const parsed = ex ? parseChartEx(doc) : parseChart(doc);
  if ('skip' in parsed) return parsed;
  const caches = readChartCaches(doc);
  // los datos que el gráfico trae sin fórmulas (PowerPoint y Word) van con las referencias que parseChartEx les dio
  const literals = (parsed as { literals?: Map<string, ChartCell[]> }).literals;
  if (literals) for (const [ref, values] of literals) caches.set(ref, values);
  return { spec: parsed.def, grid: gridFromCaches(parsed.def, caches) };
}

const relsXml = (items: { id: string; type: string; target: string }[]): string =>
  `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map((i) => `<Relationship Id="${i.id}" Type="${i.type}" Target="${i.target}"/>`).join('')}</Relationships>`;

/**
 * Las partes de un gráfico nuevo o editado, en la forma que entiende `copyRaw` (ruta → bytes): la parte del gráfico, sus relaciones
 * y el libro incrustado (más el estilo y los colores, que Office exige a los gráficos de Office 2016). `book` es el libro ya generado.
 */
export function chartParts(spec: ChartSpec, grid: ChartGrid, book: Uint8Array): Record<string, Uint8Array> {
  const src = gridSource(grid);
  const ex = isExType(spec.type);
  const main = ex ? 'ppt/charts/chartEx1.xml' : 'ppt/charts/chart1.xml';
  const out: Record<string, Uint8Array> = {};
  out[main] = enc(ex ? chartExXml(spec, src, 'rId3') : chartXml(spec, src, 'rId1'));
  out['ppt/embeddings/Microsoft_Excel_Sheet1.xlsx'] = book;
  if (ex) {
    out['ppt/charts/style1.xml'] = enc(chartExStyleXml());
    out['ppt/charts/colors1.xml'] = enc(chartExColorsXml());
    out['ppt/charts/_rels/chartEx1.xml.rels'] = enc(
      relsXml([
        { id: 'rId1', type: REL_CHARTEX_STYLE, target: 'style1.xml' },
        { id: 'rId2', type: REL_CHARTEX_COLORS, target: 'colors1.xml' },
        { id: 'rId3', type: `${RT}/package`, target: '../embeddings/Microsoft_Excel_Sheet1.xlsx' },
      ]),
    );
  } else {
    out['ppt/charts/_rels/chart1.xml.rels'] = enc(relsXml([{ id: 'rId1', type: `${RT}/package`, target: '../embeddings/Microsoft_Excel_Sheet1.xlsx' }]));
  }
  return out;
}

export { CT_CHARTEX_COLORS, CT_CHARTEX_STYLE };
