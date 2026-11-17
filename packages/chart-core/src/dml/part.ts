import type { ChartGrid } from '../grid';
import { GRID_SHEET, gridSource, parseRef, refOf } from '../grid';
import type { ChartSpec } from '../model';
import type { ChartCell, ChartSource } from '../source';
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
import { patchGridWorkbook } from './workbook';
import { mergeChartXml, sameXml } from './merge';
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
  const grid = gridFromCaches(parsed.def, caches);
  // una serie sin nombre en el archivo (Word suele quitarlo) recibe «Serie n» en la cabecera de su columna
  parsed.def.series.forEach((s, i) => {
    const p = s.nameRef ? null : parseRef(s.values);
    if (!p || p.rect.r1 < 1) return;
    const r = p.rect.r1 - 1;
    const c = p.rect.c1;
    if (grid[r]?.[c] !== undefined && grid[r]![c] !== null && grid[r]![c] !== '') return;
    while (grid.length <= r) grid.push([]);
    const row = grid[r]!;
    while (row.length <= c) row.push(null);
    row[c] = s.name ?? `Serie ${i + 1}`;
    s.nameRef = refOf({ r1: r, c1: c, r2: r, c2: c }, p.sheet ?? GRID_SHEET);
  });
  return { spec: parsed.def, grid };
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

/** La relación del libro incrustado que usa la parte original (para escribirla igual), si trae una. */
export function workbookRidOf(xml: string): string | undefined {
  const doc = dmlParser.parse(xml);
  const ext = doc?.chartSpace?.externalData ?? doc?.chartSpace?.chartData?.externalData;
  return ext?.['@_id'] as string | undefined;
}

/**
 * Reescribe una parte de gráfico de otro programa con los cambios de `edited`, conservando lo que Nova no entiende. `original` es el
 * XML tal cual vino; `before` es el gráfico como se leyó de él (con su fuente de datos `srcBefore`) y `after` es el de ahora.
 * Devuelve el mismo XML original si nada cambió. Con `ex` se escribe un gráfico de Office 2016.
 */
export function rewriteChart(original: string, before: { spec: ChartSpec; src: ChartSource }, after: { spec: ChartSpec; src: ChartSource }, ex: boolean): string {
  const rid = workbookRidOf(original);
  const gen = (s: { spec: ChartSpec; src: ChartSource }) => (ex ? chartExXml(s.spec, s.src, rid) : chartXml(s.spec, s.src, rid));
  const g0 = gen(before);
  const g1 = gen(after);
  if (sameXml(g0, g1)) return original;
  return mergeChartXml(original, g0, g1);
}

/** Como `rewriteChart` para Slides y Writer, donde los datos del gráfico están en una rejilla (la de antes sale de los valores en caché). */
export function rewriteChartFromGrid(original: string, spec: ChartSpec, grid: ChartGrid): string | null {
  const read = readChartPart(original);
  if ('skip' in read) return null;
  const ex = dmlParser.parse(original)?.chartSpace?.chartData !== undefined;
  if (ex !== isExType(spec.type)) return null;
  return rewriteChart(original, { spec: read.spec, src: gridSource(read.grid) }, { spec, src: gridSource(grid) }, ex);
}

const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const dirOf = (p: string): string => p.slice(0, p.lastIndexOf('/') + 1);
function resolveTarget(from: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : dirOf(from) + target).split('/');
  const out: string[] = [];
  for (const x of parts) {
    if (x === '..') out.pop();
    else if (x && x !== '.') out.push(x);
  }
  return out.join('/');
}

/** La parte principal de un conjunto de partes de gráfico (`…/charts/chart1.xml` o `…/chartEx1.xml`). */
export const mainChartPath = (raw: Record<string, Uint8Array>): string | undefined => Object.keys(raw).find((k) => /charts\/chart(Ex)?\d*\.xml$/.test(k));

/**
 * Las partes de un gráfico de otro programa con los cambios de `spec` y `grid`: la parte del gráfico fusionada con la original
 * (`rewriteChartFromGrid`) y el libro incrustado parcheado celda a celda. Devuelve las mismas partes si no cambió nada, y `null`
 * cuando no se puede conservar el original (cambió de clásico a Office 2016 o al revés): entonces se escribe uno nuevo.
 */
export async function rewriteRawChart(raw: Record<string, Uint8Array>, spec: ChartSpec, grid: ChartGrid): Promise<Record<string, Uint8Array> | null> {
  const main = mainChartPath(raw);
  if (!main) return null;
  const xml = dec(raw[main]!);
  const read = readChartPart(xml);
  if ('skip' in read) return raw; // no se entiende: se conserva sin tocar
  const merged = rewriteChartFromGrid(xml, spec, grid);
  if (merged === null) return null;
  if (merged === xml) return raw;
  const out: Record<string, Uint8Array> = { ...raw, [main]: enc(merged) };
  // el libro incrustado: la relación de tipo «package» de la parte
  const relsPath = `${dirOf(main)}_rels/${main.split('/').pop()}.rels`;
  const rels = raw[relsPath] ? dec(raw[relsPath]!) : '';
  const m = /<Relationship[^>]*Type="[^"]*\/package"[^>]*>/.exec(rels) ?? /<Relationship[^>]*Target="[^"]*\.xlsx"[^>]*>/.exec(rels);
  const target = m ? /Target="([^"]+)"/.exec(m[0])?.[1] : undefined;
  const book = target ? resolveTarget(main, target) : undefined;
  if (book && raw[book]) out[book] = await patchGridWorkbook(raw[book]!, read.grid, grid);
  return out;
}

/**
 * Las partes de un gráfico de otro programa (ruta → bytes) con nombres nuevos para el gráfico número `n` de un documento: los números
 * del final de cada nombre pasan a ser `n` (`chart1.xml` → `chart3.xml`, `Microsoft_Excel_Sheet1.xlsx` → `…Sheet3.xlsx`) y las
 * relaciones apuntan a los nombres nuevos. Las carpetas no cambian.
 */
export function renameBundle(raw: Record<string, Uint8Array>, n: number): Record<string, Uint8Array> {
  const stem = (base: string) => base.replace(/\d*(\.[^.]+)$/, `${n}$1`);
  const map = new Map<string, string>();
  for (const p of Object.keys(raw)) if (!p.endsWith('.rels')) map.set(p, dirOf(p) + stem(p.slice(p.lastIndexOf('/') + 1)));
  const out: Record<string, Uint8Array> = {};
  for (const [p, bytes] of Object.entries(raw)) {
    if (!p.endsWith('.rels')) {
      out[map.get(p)!] = bytes;
      continue;
    }
    // «dir/_rels/parte.xml.rels» es de «dir/parte.xml»
    const owner = `${dirOf(p).replace(/_rels\/$/, '')}${p.slice(p.lastIndexOf('/') + 1).replace(/\.rels$/, '')}`;
    const newOwner = map.get(owner);
    if (!newOwner) continue;
    const text = dec(bytes).replace(/Target="([^"]+)"/g, (full, t: string) => {
      if (/^[a-z]+:/i.test(t)) return full;
      const nw = map.get(resolveTarget(owner, t));
      return nw ? `Target="${t.slice(0, t.lastIndexOf('/') + 1)}${nw.slice(nw.lastIndexOf('/') + 1)}"` : full;
    });
    out[`${dirOf(newOwner)}_rels/${newOwner.slice(newOwner.lastIndexOf('/') + 1)}.rels`] = enc(text);
  }
  return out;
}
