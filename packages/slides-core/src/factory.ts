import { newId } from './defaults';
import { emptyDocJson, makeDoc } from './text';
import type { ChartEl, ChartModel, ConnEl, MediaEl, PicEl, ShapeEl, StyleRef, TableCell, TableEl, TextBody } from './types';

/** The style PowerPoint gives a new shape: accent 1 fill, darker outline, white text. */
export const SHAPE_STYLE: StyleRef = {
  ln: { idx: 2, c: { scheme: 'accent1', mods: [{ t: 'shade', v: 50000 }] } },
  fill: { idx: 1, c: { scheme: 'accent1' } },
  effect: { idx: 0, c: { scheme: 'accent1' } },
  font: { idx: 'minor', c: { scheme: 'lt1' } },
};
export const LINE_STYLE: StyleRef = {
  ln: { idx: 1, c: { scheme: 'accent1' } },
  fill: { idx: 0, c: { scheme: 'accent1' } },
  effect: { idx: 0, c: { scheme: 'accent1' } },
  font: { idx: 'minor', c: { scheme: 'tx1' } },
};

const emptyText = (body: TextBody['body'] = {}, algn?: 'ctr'): TextBody => ({ body, doc: algn ? makeDoc([{ p: { algn } }]).toJSON() : emptyDocJson() });

export function newShape(prst: string, x: number, y: number, w: number, h: number): ShapeEl {
  return { kind: 'shape', id: newId(), name: prst, geom: { prst }, xfrm: { x, y, w, h }, style: SHAPE_STYLE, text: emptyText({ anchor: 'ctr' }, 'ctr') };
}

export function newTextBox(x: number, y: number, w: number, h: number): ShapeEl {
  return { kind: 'shape', id: newId(), name: 'Cuadro de texto', isTextBox: true, geom: { prst: 'rect' }, xfrm: { x, y, w, h }, fill: { t: 'none' }, text: emptyText({ wrap: 'square', fit: { t: 'shape' } }) };
}

export function newLine(prst: string, x1: number, y1: number, x2: number, y2: number): ConnEl {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return { kind: 'cxn', id: newId(), name: prst, geom: { prst }, xfrm: { x, y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), ...(x2 < x1 ? { flipH: true } : {}), ...(y2 < y1 ? { flipV: true } : {}) }, style: LINE_STYLE };
}

export function newPicture(src: string, x: number, y: number, w: number, h: number, alt = ''): PicEl {
  return { kind: 'pic', id: newId(), name: 'Imagen', descr: alt, src, xfrm: { x, y, w, h } };
}

export function newMedia(media: 'video' | 'audio', src: string, mime: string, x: number, y: number, w: number, h: number): MediaEl {
  return { kind: 'media', id: newId(), name: media === 'video' ? 'Vídeo' : 'Audio', media, src, mime, xfrm: { x, y, w, h } };
}

export function newTable(rows: number, cols: number, x: number, y: number, w: number, rowH = 37): TableEl {
  const cell = (): TableCell => ({ text: { body: {}, doc: emptyDocJson() } });
  return {
    kind: 'table',
    id: newId(),
    name: 'Tabla',
    xfrm: { x, y, w, h: rows * rowH },
    cols: Array.from({ length: cols }, () => w / cols),
    rows: Array.from({ length: rows }, () => ({ h: rowH, cells: Array.from({ length: cols }, cell) })),
    styleId: '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}',
    firstRow: true,
    bandRow: true,
  };
}

export function newChart(chart: ChartModel, x: number, y: number, w: number, h: number): ChartEl {
  return { kind: 'chart', id: newId(), name: 'Gráfico', xfrm: { x, y, w, h }, chart };
}

export const SAMPLE_CHART: ChartModel = {
  kind: 'bar',
  barDir: 'col',
  grouping: 'clustered',
  categories: ['Categoría 1', 'Categoría 2', 'Categoría 3', 'Categoría 4'],
  series: [
    { name: 'Serie 1', values: [4.3, 2.5, 3.5, 4.5] },
    { name: 'Serie 2', values: [2.4, 4.4, 1.8, 2.8] },
    { name: 'Serie 3', values: [2, 2, 3, 5] },
  ],
  title: 'Título del gráfico',
  legend: 'b',
  axes: { val: { gridlines: true } },
};
