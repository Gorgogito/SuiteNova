import type { ChartGrid } from '../grid';
import { gridSource } from '../grid';
import type { ChartSpec } from '../model';
import type { ChartCell } from '../source';
import { readChartCaches, gridFromCaches } from './cache';
import {
  chartExColorsXml,
  chartExStyleXml,
  chartExXml,
  isExType,
  parseChartEx,
  REL_CHARTEX_COLORS,
  REL_CHARTEX_STYLE,
} from './chartex';
import { chartXml, parseChart } from './chartspace';
import { parser as dmlParser } from './xml';

/*
 * Un gráfico de Word o PowerPoint como partes del paquete: lectura de la parte del gráfico (con su rejilla, sacada de los valores en
 * caché) y escritura de la parte, sus relaciones y el libro mínimo incrustado.
 */

const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

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
 * Las partes de un gráfico nuevo o editado (ruta → bytes): la parte del gráfico, sus relaciones y el libro incrustado (más el estilo y
 * los colores, que Office exige a los gráficos de Office 2016). `root` es `ppt` o `word`; `n` numera las partes; `book` es el libro ya
 * generado (`writeGridWorkbook` es asíncrono).
 */
export function chartParts(spec: ChartSpec, grid: ChartGrid, book: Uint8Array, root: 'ppt' | 'word', n = 1): Record<string, Uint8Array> {
  const src = gridSource(grid);
  const ex = isExType(spec.type);
  const dir = `${root}/charts`;
  const main = ex ? `${dir}/chartEx${n}.xml` : `${dir}/chart${n}.xml`;
  const sheet = `Microsoft_Excel_Sheet${n}.xlsx`;
  const out: Record<string, Uint8Array> = {};
  out[main] = enc(ex ? chartExXml(spec, src, 'rId3') : chartXml(spec, src, 'rId1'));
  out[`${root}/embeddings/${sheet}`] = book;
  if (ex) {
    out[`${dir}/style${n}.xml`] = enc(chartExStyleXml());
    out[`${dir}/colors${n}.xml`] = enc(chartExColorsXml());
    out[`${dir}/_rels/chartEx${n}.xml.rels`] = enc(
      relsXml([
        { id: 'rId1', type: REL_CHARTEX_STYLE, target: `style${n}.xml` },
        { id: 'rId2', type: REL_CHARTEX_COLORS, target: `colors${n}.xml` },
        { id: 'rId3', type: `${RT}/package`, target: `../embeddings/${sheet}` },
      ]),
    );
  } else {
    out[`${dir}/_rels/chart${n}.xml.rels`] = enc(relsXml([{ id: 'rId1', type: `${RT}/package`, target: `../embeddings/${sheet}` }]));
  }
  return out;
}
