import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { GRID_SHEET, type ChartGrid } from '../grid';
import type { ChartCell } from '../source';
import { escapeXml } from './xml';

/*
 * El libro mínimo que Office incrusta en un gráfico de Word o PowerPoint: una sola hoja con la rejilla. Se escribe lo justo para que
 * Excel lo abra y deje editar los datos; no lleva estilos ni fórmulas.
 */

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const colName = (c: number): string => {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

function sheetXml(grid: ChartGrid): string {
  const rows = grid
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          if (v === null || v === undefined || v === '') return '';
          const ref = `${colName(c)}${r + 1}`;
          if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : '';
          if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`;
        })
        .join('');
      return cells ? `<row r="${r + 1}">${cells}</row>` : '';
    })
    .join('');
  return `${HEAD}<worksheet xmlns="${NS}"><sheetData>${rows}</sheetData></worksheet>`;
}

/** El libro (`.xlsx`) de una rejilla. */
export async function writeGridWorkbook(grid: ChartGrid): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  zip.file('_rels/.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `${HEAD}<workbook xmlns="${NS}" xmlns:r="${NS_R}"><sheets><sheet name="${GRID_SHEET}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  zip.file('xl/worksheets/sheet1.xml', sheetXml(grid));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', parseTagValue: false, parseAttributeValue: false, trimValues: false, removeNSPrefix: true, isArray: (n) => ['row', 'c', 'si', 't', 'r', 'sheet', 'Relationship'].includes(n) });
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const txt = (n: any): string => (n === undefined || n === null ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(txt).join('') : typeof n === 'object' ? (n['#text'] !== undefined ? String(n['#text']) : '') : String(n));
const colIndex = (name: string): number => [...name].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** La primera hoja de un libro (`.xlsx`) como rejilla: lo que se incrusta en un gráfico, o el libro de otro programa. */
export async function readGridWorkbook(bytes: Uint8Array): Promise<ChartGrid> {
  const zip = await JSZip.loadAsync(bytes);
  const strings: string[] = [];
  const sst = zip.file('xl/sharedStrings.xml');
  if (sst) for (const si of arr(parser.parse(await sst.async('string'))?.sst?.si)) strings.push(txt(si.t ?? si.r?.map((x: { t?: unknown }) => x.t)));
  const wbXml = parser.parse((await zip.file('xl/workbook.xml')?.async('string')) ?? '');
  const rels = parser.parse((await zip.file('xl/_rels/workbook.xml.rels')?.async('string')) ?? '');
  const first = arr(wbXml?.workbook?.sheets?.sheet)[0];
  const rid = first?.['@_id'];
  const target = arr(rels?.Relationships?.Relationship).find((r) => r['@_Id'] === rid)?.['@_Target'] as string | undefined;
  const path = target ? `xl/${target.replace(/^\/?(xl\/)?/, '')}` : 'xl/worksheets/sheet1.xml';
  const sheet = zip.file(path);
  if (!sheet) return [];
  const grid: ChartGrid = [];
  for (const row of arr(parser.parse(await sheet.async('string'))?.worksheet?.sheetData?.row)) {
    for (const c of arr(row.c)) {
      const m = /^([A-Z]+)(\d+)$/.exec(String(c['@_r'] ?? ''));
      if (!m) continue;
      const col = colIndex(m[1]!);
      const r = Number(m[2]) - 1;
      const t = c['@_t'];
      let v: ChartCell;
      if (t === 's') v = strings[Number(txt(c.v))] ?? '';
      else if (t === 'inlineStr') v = txt(c.is?.t ?? c.is);
      else if (t === 'str') v = txt(c.v);
      else if (t === 'b') v = txt(c.v) === '1';
      else if (t === 'e') v = txt(c.v);
      else {
        const n = Number(txt(c.v));
        v = txt(c.v) === '' || !Number.isFinite(n) ? null : n;
      }
      while (grid.length <= r) grid.push([]);
      const rowArr = grid[r]!;
      while (rowArr.length <= col) rowArr.push(null);
      rowArr[col] = v;
    }
  }
  return grid;
}
