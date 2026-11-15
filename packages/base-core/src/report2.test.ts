import { describe, expect, it } from 'vitest';
import type { Row } from './expr';
import { addReportControl, columnWidth, setColumns, bandOf, defaultReportLayout, imageSource, newReportControl, paginate, renderReportLayout, updateReportControl, validateReportLayout, type DataSet, type ReportLayout } from './index';

const NOW = new Date(2025, 0, 2, 10, 30);
const data = (n: number, extra: (i: number) => Row = () => ({})): DataSet => ({
  columns: ['Zona', 'Producto', 'Importe'],
  rows: Array.from({ length: n }, (_, i) => ({ Zona: i % 2 ? 'Sur' : 'Norte', Producto: `P${i + 1}`, Importe: i + 1, ...extra(i) })),
});
const base = (opts: Parameters<typeof defaultReportLayout>[1] = {}): ReportLayout => defaultReportLayout(['Zona', 'Producto', 'Importe'], { ...opts, numeric: ['Importe'] });
const detailControls = (l: ReportLayout) => l.controls.filter((c) => c.band === bandOf(l, 'detail')!.id);
const withControl = (l: ReportLayout, id: string, patch: object) => updateReportControl(l, id, patch);
const html = (l: ReportLayout, d: DataSet) => renderReportLayout(l, d, { now: NOW });

describe('report: conditional format, running sums, repeated values', () => {
  it('the first true rule colours the control; others keep the plain style', () => {
    let l = base();
    const imp = detailControls(l).find((c) => c.type === 'field' && c.field === 'Importe')!;
    l = withControl(l, imp.id, { cond: [{ expr: '[Importe]>2', color: '#ff0000', bold: true, background: '#ffff00' }] });
    const out = html(l, data(4));
    expect(out.match(/color:#ff0000/g)).toHaveLength(2);
    expect(out).toContain('background:#ffff00');
  });

  it('a rule can hide the value, and an unsafe colour is ignored', () => {
    let l = base();
    const imp = detailControls(l).find((c) => c.type === 'field' && c.field === 'Importe')!;
    l = withControl(l, imp.id, { cond: [{ expr: '[Importe]=1', hide: true }, { expr: '[Importe]=2', color: 'red;position:fixed' }] });
    const out = html(l, data(2));
    expect(out).toContain('visibility:hidden');
    expect(out).not.toContain('position:fixed');
  });

  it('running sum over the group restarts, over the whole report it does not', () => {
    let l = base({ groupBy: 'Zona' });
    const det = bandOf(l, 'detail')!;
    const c1 = { ...newReportControl(l, det, 'field', { field: 'Importe', running: 'group', format: 'int' }, { x: 0, y: 1 }), name: 'RG' };
    const c2 = { ...newReportControl(l, det, 'field', { field: 'Importe', running: 'all', format: 'int' }, { x: 150, y: 1 }), name: 'RA' };
    l = addReportControl(addReportControl(l, c1), c2);
    // Norte: 1, 3 ; Sur: 2, 4 (sorted by group) => group sums 1,4,2,6 ; all sums 1,4,6,10
    const out = html(l, data(4));
    const cells = [...out.matchAll(/<div class="c" style="[^"]*">([^<]*)<\/div>/g)].map((m) => m[1]!);
    const tail = (name: string) => name;
    expect(tail('x')).toBe('x');
    for (const n of ['1', '4', '2', '6', '10']) expect(cells).toContain(n);
    const pages = paginate(l, data(4), { now: NOW });
    const details = pages[0]!.blocks.filter((b) => b.band.kind === 'detail');
    expect(details.map((b) => b.run!.gs)).toEqual([0, 0, 2, 2]);
  });

  it('hide duplicates blanks the repeated value inside a group and shows it again on a new group', () => {
    let l = base();
    const z = detailControls(l).find((c) => c.type === 'field' && c.field === 'Zona')!;
    l = withControl(l, z.id, { hideDup: true });
    const d: DataSet = { columns: ['Zona', 'Producto', 'Importe'], rows: [{ Zona: 'A', Producto: 'x', Importe: 1 }, { Zona: 'A', Producto: 'y', Importe: 2 }, { Zona: 'B', Producto: 'z', Importe: 3 }] };
    const out = html(l, d);
    expect(out.match(/>A</g)).toHaveLength(1);
    expect(out.match(/>B</g)).toHaveLength(1);
  });
});

describe('report: growing, shrinking, filter, expressions', () => {
  it('a growing text makes the section taller and wraps', () => {
    let l = base();
    const p = detailControls(l).find((c) => c.type === 'field' && c.field === 'Producto')!;
    l = withControl(l, p.id, { canGrow: true, w: 60 });
    const d: DataSet = { columns: ['Zona', 'Producto', 'Importe'], rows: [{ Zona: 'A', Producto: 'palabra '.repeat(30), Importe: 1 }, { Zona: 'A', Producto: 'corto', Importe: 2 }] };
    const pages = paginate(l, d, { now: NOW });
    const [a, b] = pages[0]!.blocks.filter((x) => x.band.kind === 'detail');
    expect(a!.h).toBeGreaterThan(b!.h * 3);
    expect(b!.h).toBe(bandOf(l, 'detail')!.height);
  });

  it('a shrinking section takes no room when its text is empty', () => {
    let l = base({ groupBy: 'Zona' });
    const fb = bandOf(l, 'groupHeader', 0)!;
    l = { ...l, bands: l.bands.map((b) => (b.id === fb.id ? { ...b, canShrink: true } : b)), controls: l.controls.map((c) => (c.band === fb.id && c.type === 'field' ? { ...c, field: 'Vacio' } : c)) };
    const pages = paginate(l, data(2), { now: NOW });
    expect(pages[0]!.blocks.filter((b) => b.band.kind === 'groupHeader')).toHaveLength(0);
  });

  it('the filter keeps only the records for which it is true', () => {
    const l = { ...base(), filter: '[Importe]>=3' };
    const pages = paginate(l, data(5), { now: NOW });
    expect(pages.flatMap((p) => p.rows).map((r) => r.Importe)).toEqual([3, 4, 5]);
  });

  it('sorts and groups by an expression, and by the first characters', () => {
    let l: ReportLayout = base();
    l = { ...l, sort: [{ field: '=-[Importe]' }] };
    const pages = paginate(l, data(3), { now: NOW });
    expect(pages[0]!.rows.map((r) => r.Importe)).toEqual([3, 2, 1]);
    const g = base({ groupBy: 'Producto' });
    const d: DataSet = { columns: ['Zona', 'Producto', 'Importe'], rows: [{ Zona: 'a', Producto: 'Ana', Importe: 1 }, { Zona: 'a', Producto: 'Alba', Importe: 2 }, { Zona: 'a', Producto: 'Beto', Importe: 3 }] };
    const grouped = paginate({ ...g, groups: [{ field: 'Producto', prefix: 1 }] }, d, { now: NOW });
    expect(grouped[0]!.blocks.filter((b) => b.band.kind === 'groupHeader')).toHaveLength(2);
    const byExpr = paginate({ ...g, groups: [{ field: '=Left([Producto], 2)' }] }, d, { now: NOW });
    expect(byExpr[0]!.blocks.filter((b) => b.band.kind === 'groupHeader')).toHaveLength(3);
  });
});

describe('report: column width', () => {
  it('setColumns rescales the detail controls to the column width and back', () => {
    const l = base();
    const w1 = columnWidth(l);
    const two = setColumns(l, { n: 2, gap: 20, direction: 'across' });
    expect(columnWidth(two)).toBeCloseTo((w1 - 20) / 2, 5);
    for (const c of detailControls(two)) expect(c.x + c.w).toBeLessThanOrEqual(columnWidth(two) + 1);
    // the headings of the page header keep their size
    expect(two.controls.find((c) => c.name === 'Encabezado1')).toEqual(l.controls.find((c) => c.name === 'Encabezado1'));
    const back = setColumns(two, undefined);
    expect(back.columns).toBeUndefined();
    expect(Math.abs(detailControls(back)[0]!.w - detailControls(l)[0]!.w)).toBeLessThanOrEqual(2);
  });
});

describe('report: columns, page header and footer, no data, images', () => {
  const colLayout = (direction: 'down' | 'across'): ReportLayout => {
    const l = base();
    return { ...l, margins: { top: 0, right: 0, bottom: 0, left: 0 }, columns: { n: 2, gap: 20, direction } };
  };
  it('two columns across: records go left to right, and the first line shares one y', () => {
    const pages = paginate(colLayout('across'), data(4), { now: NOW });
    const det = pages[0]!.blocks.filter((b) => b.band.kind === 'detail');
    expect(det.map((b) => b.col)).toEqual([0, 1, 0, 1]);
    expect(det[0]!.y).toBe(det[1]!.y);
    expect(det[2]!.y).toBeGreaterThan(det[0]!.y);
    expect(det.map((b) => (b.row as Row).Importe)).toEqual([1, 2, 3, 4]);
  });
  it('two columns down: the first column is filled before the second', () => {
    const pages = paginate(colLayout('down'), data(4), { now: NOW });
    const det = pages[0]!.blocks.filter((b) => b.band.kind === 'detail');
    expect(det.map((b) => [b.col, (b.row as Row).Importe])).toEqual([[0, 1], [0, 2], [1, 3], [1, 4]]);
  });
  it('many records make several pages, and no record is lost or repeated', () => {
    const pages = paginate(colLayout('down'), data(300), { now: NOW });
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap((p) => p.rows).map((r) => r.Importe)).toEqual(Array.from({ length: 300 }, (_, i) => i + 1));
    const out = html(colLayout('down'), data(10));
    expect(out).toContain('width:387px');
  });
  it('a page header that is not shown with the report header leaves its room to page one only', () => {
    const l = { ...base(), pageHeaderOn: 'notFirst' as const };
    const out = html(l, data(2));
    expect(out).not.toContain('>Producto</div>');
    const big = html(l, data(120));
    expect(big.split('<section class="pg"').length).toBeGreaterThan(2);
    expect(big.match(/>Producto<\/div>/g)!.length).toBe(big.split('<section class="pg"').length - 2);
  });
  it('shows the no-data text only when there are no records', () => {
    const l = { ...base(), noData: 'Nada que mostrar' };
    expect(html(l, data(0))).toContain('Nada que mostrar');
    expect(html(l, data(1))).not.toContain('Nada que mostrar');
  });
  it('images accept only raster data URIs, from the control or from a field', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    let l = base();
    const rh = bandOf(l, 'reportHeader')!;
    const img = newReportControl(l, rh, 'image', { src: png, fit: 'stretch', alt: 'Logo "x"' }, { x: 0, y: 0 });
    l = addReportControl(l, img);
    const out = html(l, data(1));
    expect(out).toContain(`src="${png}"`);
    expect(out).toContain('object-fit:fill');
    expect(out).toContain('alt="Logo &quot;x&quot;"');
    expect(imageSource({ ...img, src: 'data:image/svg+xml;base64,AAAA' } as never, null)).toBe('');
    expect(imageSource({ ...img, src: 'javascript:alert(1)' } as never, null)).toBe('');
    expect(imageSource({ ...img, src: '', field: 'Foto' } as never, { Foto: png })).toBe(png);
  });
  it('validation names bad expressions, filter and empty images', () => {
    let l = { ...base(), filter: '[Nada]>1', sort: [{ field: '=[Falta]' }] } as ReportLayout;
    const det = bandOf(l, 'detail')!;
    l = addReportControl(l, newReportControl(l, det, 'image', {}, { x: 0, y: 0 }));
    const f = detailControls(l).find((c) => c.type === 'field')!;
    l = withControl(l, f.id, { cond: [{ expr: '[Otro]>1', color: '#f00' }] });
    const w = validateReportLayout(l, ['Zona', 'Producto', 'Importe']).join('\n');
    expect(w).toContain('Filtro');
    expect(w).toContain('[Nada]');
    expect(w).toContain('[Falta]');
    expect(w).toContain('formato condicional');
    expect(w).toContain('elija una imagen');
  });
});
