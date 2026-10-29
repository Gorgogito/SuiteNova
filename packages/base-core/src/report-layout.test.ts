import { describe, expect, it } from 'vitest';
import type { Row } from './expr';
import { LABEL_PRESETS, addGroup, addReportControl, bandOf, chartData, chartSvg, contentWidth, defaultLabelLayout, defaultReportLayout, formatValue, labelRows, layoutFromLegacy, newReport, newReportControl, orderedBands, paginate, removeGroup, renderReportLayout, setBandHeight, sortRows, updateReportControl, validateReportLayout, type DataSet, type ReportLayout } from './index';

const data = (n: number, extra: (i: number) => Row = () => ({})): DataSet => ({
  columns: ['Zona', 'Producto', 'Importe'],
  rows: Array.from({ length: n }, (_, i) => ({ Zona: i % 2 ? 'Sur' : 'Norte', Producto: `P${i + 1}`, Importe: i + 1, ...extra(i) })),
});
const NOW = new Date(2025, 0, 2, 10, 30);
const kinds = (p: { blocks: { band: { kind: string } }[] }) => p.blocks.map((b) => b.band.kind);

describe('building layouts', () => {
  it('a default report has title, headings, detail, page footer and totals in the right order', () => {
    const l = defaultReportLayout(['Zona', 'Producto', 'Importe'], { title: 'Ventas', sums: ['Importe'] });
    expect(orderedBands(l).map((b) => b.kind)).toEqual(['reportHeader', 'pageHeader', 'detail', 'pageFooter', 'reportFooter']);
    expect(l.controls.filter((c) => c.band === bandOf(l, 'detail')!.id).map((c) => c.type)).toEqual(['field', 'field', 'field']);
    expect(l.controls.find((c) => c.name === 'Titulo')).toMatchObject({ type: 'label', text: 'Ventas' });
    expect(l.controls.find((c) => c.name === 'Total3')).toMatchObject({ type: 'calc', expr: '=Sum([Importe])' });
    // numbers align to the right; every control fits inside the printable width
    expect(l.controls.find((c) => c.name === 'Campo3')).toMatchObject({ align: 'right' });
    for (const c of l.controls) expect(c.x + c.w).toBeLessThanOrEqual(contentWidth(l));
    expect(new Set(l.controls.map((c) => c.id)).size).toBe(l.controls.length);
  });

  it('with a grouping field it adds the group bands in drawing order', () => {
    const l = defaultReportLayout(['Zona', 'Importe'], { groupBy: 'Zona', sums: ['Importe'] });
    expect(orderedBands(l).map((b) => b.kind)).toEqual(['reportHeader', 'pageHeader', 'groupHeader', 'detail', 'groupFooter', 'pageFooter', 'reportFooter']);
    expect(l.groups).toEqual([{ field: 'Zona' }]);
  });

  it('a quick report converts to a free design', () => {
    const l = layoutFromLegacy({ ...newReport({ kind: 'table', name: 'V' }, ['Zona', 'Importe']), groupBy: 'Zona', sums: ['Importe'], landscape: true, title: 'T' });
    expect(l.landscape).toBe(true);
    expect(l.groups).toHaveLength(1);
    expect(contentWidth(l)).toBe(1123 - 80);
  });

  it('groups can be added and removed, with their bands and controls', () => {
    let l = defaultReportLayout(['Zona', 'Producto', 'Importe']);
    l = addGroup(l, 'Zona');
    l = addGroup(l, 'Producto');
    l = addGroup(l, 'Zona'); // already there
    expect(l.groups.map((g) => g.field)).toEqual(['Zona', 'Producto']);
    expect(orderedBands(l).map((b) => `${b.kind}${b.level ?? ''}`)).toEqual(['reportHeader', 'pageHeader', 'groupHeader0', 'groupHeader1', 'detail', 'groupFooter1', 'groupFooter0', 'pageFooter', 'reportFooter']);
    const gh0 = bandOf(l, 'groupHeader', 0)!;
    l = addReportControl(l, newReportControl(l, gh0, 'field', { field: 'Zona' }));
    l = removeGroup(l, 0);
    expect(l.groups.map((g) => g.field)).toEqual(['Producto']);
    expect(l.bands.filter((b) => b.kind === 'groupHeader').map((b) => b.level)).toEqual([0]); // renumbered
    expect(l.controls.some((c) => c.band === gh0.id)).toBe(false);
  });

  it('controls get free names and bands grow to hold them', () => {
    let l = defaultReportLayout(['A']);
    const det = bandOf(l, 'detail')!;
    const c1 = newReportControl(l, det, 'calc');
    l = addReportControl(l, c1);
    const c2 = newReportControl(l, det, 'calc');
    expect([c1.name, c2.name]).toEqual(['Calculado1', 'Calculado2']);
    l = updateReportControl(l, c1.id, { y: 100, h: 20 });
    expect(bandOf(l, 'detail')!.height).toBe(120);
    expect(setBandHeight(l, det.id, 40).bands.find((b) => b.id === det.id)!.height).toBe(40);
    expect(setBandHeight(l, det.id, -5).bands.find((b) => b.id === det.id)!.height).toBe(0);
  });
});

describe('pagination', () => {
  it('fills pages with the records and repeats page header and footer on each', () => {
    const l = defaultReportLayout(['Zona', 'Producto', 'Importe']);
    const pages = paginate(l, data(120), { now: NOW });
    expect(pages.length).toBeGreaterThan(2);
    expect(kinds(pages[0]!)[0]).toBe('reportHeader');
    expect(kinds(pages[1]!).every((k) => k === 'detail')).toBe(true);
    expect(pages.reduce((s, p) => s + p.rows.length, 0)).toBe(120);
    const bodyH = 1123 - 80 - 28 - 28;
    for (const p of pages) expect(p.blocks.reduce((s, b) => s + b.h, 0)).toBeLessThanOrEqual(bodyH);
    // blocks are stacked without gaps or overlaps
    for (const p of pages) p.blocks.reduce((y, b) => (expect(b.y).toBe(y), y + b.h), 0);
    // records stay in order
    expect(pages.flatMap((p) => p.rows.map((r) => r.Producto))[119]).toBe('P120');
  });

  it('groups: header before, footer after, scope = the group; sorted by the group field', () => {
    const l = defaultReportLayout(['Zona', 'Producto', 'Importe'], { groupBy: 'Zona', sums: ['Importe'] });
    const [p] = paginate(l, data(5), { now: NOW });
    expect(kinds(p!)).toEqual(['reportHeader', 'groupHeader', 'detail', 'detail', 'detail', 'groupFooter', 'groupHeader', 'detail', 'detail', 'groupFooter', 'reportFooter']);
    const footers = p!.blocks.filter((b) => b.band.kind === 'groupFooter');
    expect(footers.map((f) => f.scope.map((r) => r.Producto))).toEqual([['P1', 'P3', 'P5'], ['P2', 'P4']]);
    expect(p!.blocks.filter((b) => b.band.kind === 'groupHeader').map((b) => b.row!.Zona)).toEqual(['Norte', 'Sur']);
    expect(p!.blocks.at(-1)!.scope).toHaveLength(5);
  });

  it('two nested groups close and open in the right order', () => {
    let l = defaultReportLayout(['Zona', 'Producto', 'Importe']);
    l = addGroup(addGroup(l, 'Zona'), 'Producto');
    l = { ...l, bands: l.bands.map((b) => (b.kind === 'groupFooter' ? { ...b, height: 10 } : b)) };
    const [p] = paginate(l, { columns: [], rows: [{ Zona: 'A', Producto: 'x', Importe: 1 }, { Zona: 'A', Producto: 'y', Importe: 2 }, { Zona: 'B', Producto: 'x', Importe: 3 }] });
    const seq = p!.blocks.map((b) => (b.band.kind === 'groupHeader' ? `H${b.band.level}` : b.band.kind === 'groupFooter' ? `F${b.band.level}` : b.band.kind === 'detail' ? 'D' : ''));
    expect(seq.filter(Boolean)).toEqual(['H0', 'H1', 'D', 'F1', 'H1', 'D', 'F1', 'F0', 'H0', 'H1', 'D', 'F1', 'F0']);
  });

  it('a group header never ends a page: it moves with its first record', () => {
    const l = defaultReportLayout(['Zona', 'Producto', 'Importe'], { groupBy: 'Zona' });
    // leave between 28 and 49 px: the second header (28) alone would fit, header + record (50) does not
    const det = bandOf(l, 'detail')!;
    const bodyH = 1123 - 80 - 28 - 28;
    const rh = bandOf(l, 'reportHeader')!;
    const gh = bandOf(l, 'groupHeader', 0)!;
    const avail = bodyH - rh.height - gh.height;
    const fill = Math.ceil((avail - 49) / det.height);
    const left = avail - fill * det.height;
    expect(left).toBeGreaterThanOrEqual(gh.height);
    expect(left).toBeLessThan(gh.height + det.height);
    const rows = [...Array.from({ length: fill }, (_, i) => ({ Zona: 'A', Producto: `a${i}`, Importe: 1 })), { Zona: 'B', Producto: 'b', Importe: 1 }];
    const pages = paginate(l, { columns: [], rows });
    const last = pages.at(-1)!;
    expect(pages.length).toBe(2);
    expect(kinds(last).slice(0, 2)).toEqual(['groupHeader', 'detail']);
  });

  it('keepTogether starts a new page when the group would not fit in what is left', () => {
    let l = defaultReportLayout(['Zona', 'Producto', 'Importe'], { groupBy: 'Zona' });
    l = { ...l, groups: [{ field: 'Zona', keepTogether: true }] };
    const rows = [...Array.from({ length: 40 }, (_, i) => ({ Zona: 'A', Producto: `a${i}`, Importe: 1 })), ...Array.from({ length: 10 }, (_, i) => ({ Zona: 'B', Producto: `b${i}`, Importe: 1 }))];
    const pages = paginate(l, { columns: [], rows });
    // group B (10 records) would split over the page boundary; it starts a page of its own instead
    const bPage = pages.find((p) => p.blocks.some((b) => b.band.kind === 'groupHeader' && b.row!.Zona === 'B'))!;
    expect(kinds(bPage)[0]).toBe('groupHeader');
    expect(bPage.rows).toHaveLength(10);
  });

  it('an empty data set still gives one page with header and footer', () => {
    const pages = paginate(defaultReportLayout(['A'], { sums: ['A'] }), { columns: [], rows: [] });
    expect(pages).toHaveLength(1);
    expect(kinds(pages[0]!)).toEqual(['reportHeader', 'reportFooter']);
  });

  it('sorting: groups first, then the detail sort, stable and accent-aware', () => {
    let l = defaultReportLayout(['Zona', 'Producto']);
    l = { ...addGroup(l, 'Zona'), sort: [{ field: 'Producto', desc: true }] };
    const rows: Row[] = [{ Zona: 'b', Producto: 1 }, { Zona: 'á', Producto: 2 }, { Zona: 'b', Producto: 3 }, { Zona: null, Producto: 4 }];
    expect(sortRows(l, rows).map((r) => r.Producto)).toEqual([4, 2, 3, 1]);
  });

  it('a subreport makes its band as tall as its rows need', () => {
    let l = defaultReportLayout(['Id']);
    const det = bandOf(l, 'detail')!;
    l = addReportControl(l, newReportControl(l, det, 'subreport', { table: 'T', childField: 'a', parentField: 'Id', w: 300 }, { x: 0, y: 24 }));
    const fetchSub = (_c: unknown, parent: Row) => ({ columns: ['n'], rows: Array.from({ length: Number(parent.Id) }, (_, i) => [i, `x${i}`]) });
    const [p] = paginate(l, { columns: [], rows: [{ Id: 1 }, { Id: 4 }] }, { fetchSub });
    const d = p!.blocks.filter((b) => b.band.kind === 'detail');
    expect(d[0]!.h).toBeGreaterThan(d[0]!.band.height - 1);
    expect(d[1]!.h).toBe(24 + 18 + 4 * 18 + 4);
    expect(d[1]!.h).toBeGreaterThan(d[0]!.h);
  });
});

describe('rendering', () => {
  it('numbers the pages "Página 2 de N" and prints the date from the clock given', () => {
    const l = defaultReportLayout(['Zona', 'Producto', 'Importe']);
    const html = renderReportLayout(l, data(120), { now: NOW });
    const n = (html.match(/<section class="pg"/g) ?? []).length;
    expect(n).toBeGreaterThan(2);
    expect(html).toContain('Página 1 de ' + n);
    expect(html).toContain(`Página ${n} de ${n}`);
    expect(html).toContain('02/01/2025');
    expect(html).toContain('@page{size:794px 1123px;margin:0}');
  });

  it('evaluates calculated controls over their scope: group subtotals and report totals', () => {
    const l = defaultReportLayout(['Zona', 'Producto', 'Importe'], { groupBy: 'Zona', sums: ['Importe'] });
    const html = renderReportLayout(l, data(5), { now: NOW });
    expect(html).toContain('>9,00<'); // Norte: 1 + 3 + 5
    expect(html).toContain('>6,00<'); // Sur: 2 + 4
    expect(html).toContain('>15,00<'); // total
    expect(html).toContain('>Subtotal<');
  });

  it('a calculated control can use the record: price times quantity, with a format', () => {
    let l = defaultReportLayout(['Precio', 'Cant']);
    l = addReportControl(l, newReportControl(l, bandOf(l, 'detail')!, 'calc', { expr: '=[Precio]*[Cant]', format: 'dec2' }));
    const html = renderReportLayout(l, { columns: [], rows: [{ Precio: 2.5, Cant: 4 }] }, { now: NOW });
    expect(html).toContain('>10,00<');
  });

  it('a broken expression prints #Error instead of failing the whole report', () => {
    let l = defaultReportLayout(['A']);
    l = addReportControl(l, newReportControl(l, bandOf(l, 'detail')!, 'calc', { expr: '=[Nada] + 1' }));
    expect(renderReportLayout(l, { columns: [], rows: [{ A: 1 }] })).toContain('#Error');
  });

  it('escapes everything that comes from the data or the design, and ignores bad colours', () => {
    let l = defaultReportLayout(['A']);
    const det = bandOf(l, 'detail')!;
    l = addReportControl(l, newReportControl(l, det, 'label', { text: '<img src=x onerror=alert(1)>', color: 'red;background:url(x)' }));
    l = addReportControl(l, newReportControl(l, det, 'label', { text: 'ok', color: '#a00' }, { x: 0, y: 30 }));
    const html = renderReportLayout(l, { columns: [], rows: [{ A: '<script>alert(1)</script>' }] }, { title: '</title><script>x</script>' });
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x');
    expect(html).not.toContain('background:url');
    expect(html).toContain('color:#a00;');
  });

  it('subreports render as a small table of the linked rows, escaped', () => {
    let l = defaultReportLayout(['Id']);
    l = addReportControl(l, newReportControl(l, bandOf(l, 'detail')!, 'subreport', { table: 'T', childField: 'a', parentField: 'Id' }, { x: 0, y: 24 }));
    const html = renderReportLayout(l, { columns: [], rows: [{ Id: 1 }] }, { fetchSub: () => ({ columns: ['n', 'txt'], rows: [[5, 1, '<b>x</b>']] }) });
    expect(html).toContain('<th>txt</th>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('landscape and other paper sizes change the page', () => {
    const l = { ...defaultReportLayout(['A']), paper: 'Letter' as const, landscape: true };
    expect(renderReportLayout(l, { columns: [], rows: [] })).toContain('@page{size:1056px 816px;margin:0}');
  });
});

describe('charts', () => {
  const scope: Row[] = [{ z: 'N', v: 10 }, { z: 'S', v: 5 }, { z: 'N', v: 20 }, { z: null, v: 1 }];
  const c = { id: 'x', name: 'G', band: 'b', x: 0, y: 0, w: 300, h: 160, type: 'chart' as const, kind: 'bar' as const, category: 'z', value: 'v', fn: 'sum' as const };

  it('groups the records by category with sum, count or average', () => {
    expect(chartData(c, scope)).toEqual([{ label: 'N', value: 30 }, { label: 'S', value: 5 }, { label: '(vacío)', value: 1 }]);
    expect(chartData({ ...c, fn: 'count' }, scope).map((d) => d.value)).toEqual([2, 1, 1]);
    expect(chartData({ ...c, fn: 'avg' }, scope).map((d) => d.value)).toEqual([15, 5, 1]);
  });

  it('draws bars, lines and pies as SVG with the data in them and no markup injection', () => {
    const data = [{ label: '<b>a</b>', value: 3 }, { label: 'b', value: 7 }];
    const bar = chartSvg('bar', data, 300, 160, 'T<i>');
    expect(bar.match(/<rect /g)).toHaveLength(2);
    expect(bar).not.toContain('<b>');
    expect(bar).not.toContain('<i>');
    expect(chartSvg('line', data, 300, 160)).toContain('<polyline');
    const pie = chartSvg('pie', data, 300, 160);
    expect(pie.match(/<path /g)).toHaveLength(2);
    expect(chartSvg('pie', [{ label: 'x', value: 5 }], 300, 160)).toContain('<circle');
    expect(chartSvg('bar', [], 300, 160)).toContain('Sin datos');
    expect(chartSvg('bar', [{ label: 'neg', value: -4 }, { label: 'pos', value: 6 }], 300, 160)).toContain('<rect');
  });

  it('a chart control is drawn inside the report from its scope', () => {
    let l = defaultReportLayout(['z', 'v']);
    l = addReportControl(l, newReportControl(l, bandOf(l, 'reportHeader')!, 'chart', { category: 'z', value: 'v', title: 'Por zona' }, { x: 0, y: 40 }));
    const html = renderReportLayout(l, { columns: [], rows: scope });
    expect(html).toContain('<svg');
    expect(html).toContain('Por zona');
  });
});

describe('labels', () => {
  it('computes how many labels fit and places them on a grid', () => {
    const l = defaultLabelLayout(['Nombre', 'Calle', 'Ciudad'], LABEL_PRESETS[0]!);
    expect(labelRows(l)).toBe(7);
    const rows = Array.from({ length: 50 }, (_, i) => ({ Nombre: `N${i}`, Calle: 'c', Ciudad: 'x' }));
    const pages = paginate(l, { columns: [], rows });
    expect(pages.map((p) => p.rows.length)).toEqual([21, 21, 8]);
    const html = renderReportLayout(l, { columns: [], rows });
    expect(html.match(/<section class="pg"/g)).toHaveLength(3);
    expect(html).toContain('>N0<');
    expect(html).toContain('>N49<');
    // second label is one label width plus the gap to the right of the first
    const lefts = [...html.matchAll(/class="bd" style="left:([\d.]+)px;top:([\d.]+)px/g)].slice(0, 4).map((m) => [Number(m[1]), Number(m[2])]);
    expect(lefts[1]![0]! - lefts[0]![0]!).toBeCloseTo(l.labels!.labelW + l.labels!.gapX, 0);
    expect(lefts[3]![1]! - lefts[0]![1]!).toBeCloseTo(l.labels!.labelH + l.labels!.gapY, 0);
  });

  it('presets keep every label inside the paper', () => {
    for (const p of LABEL_PRESETS) {
      const l = defaultLabelLayout(['A'], p);
      const s = l.labels!;
      expect(s.marginLeft + s.cols * s.labelW + (s.cols - 1) * s.gapX).toBeLessThanOrEqual(l.paper === 'A4' ? 794.5 : 816.5);
      expect(s.marginTop + labelRows(l) * s.labelH).toBeLessThanOrEqual(l.paper === 'A4' ? 1123.5 : 1056.5);
    }
  });

  it('with no records there is still one (empty) page', () => {
    expect(paginate(defaultLabelLayout(['A']), { columns: [], rows: [] })).toHaveLength(1);
  });
});

describe('checks and formats', () => {
  it('validation names the control and what is wrong', () => {
    let l: ReportLayout = defaultReportLayout(['A', 'B']);
    expect(validateReportLayout(l, ['A', 'B'])).toEqual([]);
    const det = bandOf(l, 'detail')!;
    l = addReportControl(l, newReportControl(l, det, 'field', { field: 'Zzz' }));
    l = addReportControl(l, newReportControl(l, det, 'field', { field: '' }));
    l = addReportControl(l, newReportControl(l, det, 'calc', { expr: '=[Nope] + ' }));
    l = addReportControl(l, newReportControl(l, det, 'calc', { expr: '=Sum([Nada])' }));
    l = addReportControl(l, newReportControl(l, det, 'chart', { category: 'A', value: 'Q' }));
    l = addReportControl(l, newReportControl(l, det, 'subreport'));
    l = { ...l, groups: [{ field: 'Gone' }], controls: [...l.controls, { ...l.controls[0]!, id: 'dup', band: 'nope' }] };
    const w = validateReportLayout(l, ['A', 'B']);
    expect(w).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/"Zzz" no existe/),
        expect.stringMatching(/no tiene campo asignado/),
        expect.stringMatching(/Campo\d|Calculado\d/),
        expect.stringMatching(/\[Nada\] no existe/),
        expect.stringMatching(/"Q" no existe/),
        expect.stringMatching(/indique la tabla/),
        expect.stringMatching(/Agrupación: el campo "Gone"/),
        expect.stringMatching(/sección ya no existe/),
        expect.stringMatching(/repetido/),
      ]),
    );
  });

  it('formats numbers and dates the Spanish way', () => {
    expect(formatValue(1234.5, 'dec2')).toBe('1234,50'); // es-ES keeps four-digit numbers ungrouped
    expect(formatValue(12345.678, 'dec1')).toBe('12.345,7');
    expect(formatValue(7.6, 'int')).toBe('8');
    expect(formatValue(0.256, 'percent')).toBe('25,6 %');
    expect(formatValue('2024-03-05', 'date')).toBe('05/03/2024');
    expect(formatValue('2024-03-05 14:07', 'datetime')).toBe('05/03/2024 14:07');
    expect(formatValue('texto', 'dec2')).toBe('texto');
    expect(formatValue(null, 'dec2')).toBe('');
    expect(formatValue(true)).toBe('Sí');
    expect(formatValue(2.5)).toBe('2,5');
  });
});
