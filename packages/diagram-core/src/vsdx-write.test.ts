/*
 * Writing drawings for Visio: what the file says in Visio's own terms (checked against Visio itself) and what comes back
 * to Nova from it, also after the changes Visio would make.
 */
import JSZip from 'jszip';
import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import {
  addConnector, addShape, exportVsdx, groupShapes, importVsdx, newConnector, newDiagram, newPage, parseDiagram, serializeDiagram, setShapeImage, settleContainers,
  type Diagram, type Page, type Shape,
} from './index';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** A page with shapes found by a short name. */
function builder(name = 'Página 1') {
  let page: Page = { ...newPage(name), grid: 0 };
  const ids: Record<string, string> = {};
  const b = {
    ids,
    put(key: string, stencil: string, x: number, y: number, over: Partial<Shape> = {}) {
      const r = addShape(page, stencil, x, y, { text: key, ...over });
      page = r.page;
      ids[key] = r.shape.id;
      return b;
    },
    link(from: string, to: string, over: Parameters<typeof newConnector>[2] = {}, a: number | 'auto' = 'auto', z: number | 'auto' = 'auto') {
      page = addConnector(page, newConnector({ shape: ids[from]!, port: a }, { shape: ids[to]!, port: z }, over));
      return b;
    },
    do(fn: (p: Page) => Page) {
      page = fn(page);
      return b;
    },
    get page() {
      return page;
    },
  };
  return b;
}

const diagramOf = (...pages: Page[]): Diagram => ({ ...newDiagram('Prueba'), pages });

async function written(d: Diagram) {
  const zip = await JSZip.loadAsync(await exportVsdx(d));
  const text = (path: string) => zip.file(path)!.async('string');
  const page = await text('visio/pages/page1.xml');
  expect(XMLValidator.validate(page)).toBe(true);
  return { zip, page, pages: await text('visio/pages/pages.xml') };
}

/** The sheet that has this text of its own (the XML of its `<Shape>` up to its parts). */
const sheetWith = (xml: string, text: string) => xml.split(/(?=<Shape ID=)/).find((s) => s.includes(`>${text}</Text>`))!;
const idOf = (sheet: string) => Number(/<Shape ID="(\d+)"/.exec(sheet)![1]);
const cellOf = (sheet: string, name: string) => new RegExp(`<Cell N="${name}" V="([^"]*)"(?: U="[^"]*")?(?: F="([^"]*)")?/>`).exec(sheet);

/** Reads back the file after changing its first page, as Visio would. */
async function readAfter(d: Diagram, change: (xml: string) => string = (x) => x) {
  const zip = await JSZip.loadAsync(await exportVsdx(d));
  const path = 'visio/pages/page1.xml';
  zip.file(path, change(await zip.file(path)!.async('string')));
  return importVsdx(await zip.generateAsync({ type: 'uint8array' }));
}

/** A page without its identifiers, to compare what two diagrams hold. */
function plain(p: Page) {
  const at = new Map<string, string>();
  const key = (s: Shape) => `${s.stencil}|${s.text}|${Math.round(s.x)}|${Math.round(s.y)}`;
  const shapes = [...p.shapes].sort((a, b) => key(a).localeCompare(key(b)));
  shapes.forEach((s, i) => at.set(s.id, `s${i}`));
  p.layers?.forEach((l) => at.set(l.id, l.name));
  const name = (id: string | undefined, kind: string) => {
    if (id === undefined) return undefined;
    if (!at.has(id)) at.set(id, `${kind}${at.size}`);
    return at.get(id);
  };
  const round = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Math.round(x) : x)));
  return round({
    shapes: shapes.map((s) => ({
      ...s, id: at.get(s.id), layer: s.layer && at.get(s.layer), parent: s.parent && at.get(s.parent), lane: name(s.lane, 'lane'), group: name(s.group, 'g'),
      ...(s.container?.lanes ? { container: { ...s.container, lanes: s.container.lanes.map((l) => ({ ...l, id: name(l.id, 'lane') })) } } : {}),
    })),
    connectors: p.connectors.map(({ id: _id, ...c }) => ({
      ...c,
      from: 'shape' in c.from ? { ...c.from, shape: at.get(c.from.shape) } : c.from,
      to: 'shape' in c.to ? { ...c.to, shape: at.get(c.to.shape) } : c.to,
      layer: c.layer && at.get(c.layer),
    })),
    layers: p.layers?.map((l) => ({ ...l, id: l.name })),
    active: p.activeLayer && at.get(p.activeLayer),
  });
}

async function expectSame(d: Diagram) {
  const { diagram, warnings } = await importVsdx(await exportVsdx(d));
  expect(warnings).toEqual([]);
  expect(parseDiagram(serializeDiagram(diagram)).warnings).toEqual([]);
  diagram.pages.forEach((p, i) => expect(plain(p)).toEqual(plain(d.pages[i]!)));
  return diagram;
}

describe('connectors', () => {
  const b = builder()
    .put('A', 'rect', 100, 100)
    .put('B', 'rect', 400, 300)
    .link('A', 'B', { text: 'dinámico' })
    .link('A', 'B', { text: 'a puntos', routing: 'straight', startArrow: 'diamond', endArrow: 'open' }, 2, 3)
    .do((p) => addConnector(p, newConnector({ x: 50, y: 400 }, { x: 250, y: 500 }, { text: 'suelto', routing: 'curve', startArrow: 'oval', endArrow: 'bar' })));
  const d = diagramOf(b.page);

  it('are glued to shapes and connection points, as Visio glues them', async () => {
    const { page } = await written(d);
    const a = idOf(sheetWith(page, 'A'));
    const z = idOf(sheetWith(page, 'B'));
    const walking = sheetWith(page, 'dinámico');
    expect(cellOf(walking, 'BeginX')![2]).toBe('_WALKGLUE(BegTrigger,EndTrigger,WalkPreference)');
    expect(cellOf(walking, 'EndX')![2]).toBe('_WALKGLUE(EndTrigger,BegTrigger,WalkPreference)');
    expect(cellOf(walking, 'EndTrigger')![2]).toBe(`_XFTRIGGER(Sheet.${z}!EventXFMod)`);
    expect(cellOf(walking, 'ObjType')![1]).toBe('2');
    const fixed = sheetWith(page, 'a puntos');
    expect(cellOf(fixed, 'BeginX')![2]).toBe(`PAR(PNT(Sheet.${a}!Connections.X3,Sheet.${a}!Connections.Y3))`);
    expect(page).toContain(`<Connect FromSheet="${idOf(walking)}" FromCell="BeginX" FromPart="9" ToSheet="${a}" ToCell="PinX" ToPart="3"/>`);
    expect(page).toContain(`<Connect FromSheet="${idOf(fixed)}" FromCell="EndX" FromPart="12" ToSheet="${z}" ToCell="Connections.X4" ToPart="103"/>`);
    // a straight line follows its ends even before Visio routes it again
    expect(fixed).toContain('F="Width*1"');
    // the free one has no formulas and no connections
    expect(cellOf(sheetWith(page, 'suelto'), 'BeginX')![2]).toBeUndefined();
    expect((page.match(/<Connect /g) ?? []).length).toBe(4);
  });

  it('come back with their ends, routing and arrow heads', async () => {
    await expectSame(d);
  });

  it('take the arrow head Visio shows once it is changed there', async () => {
    const { diagram } = await readAfter(d, (x) => x.replace('<Cell N="BeginArrow" V="22"/>', '<Cell N="BeginArrow" V="4"/>'));
    expect(diagram.pages[0]!.connectors[1]!.startArrow).toBe('arrow');
    expect(diagram.pages[0]!.connectors[1]!.endArrow).toBe('open');
  });
});

describe('data, links and layers', () => {
  const data: Shape['data'] = [
    { name: 'Responsable', value: 'Ana', type: 'text' },
    { name: 'Coste (€)', value: '12.5', type: 'number' },
    { name: 'Urgente', value: 'Sí', type: 'bool' },
    { name: 'Fecha límite', value: '2026-12-24', type: 'date' },
    { name: '2.ª fecha', value: '', type: 'date' },
    { name: 'Fecha limite', value: 'otra', type: 'text' },
  ];
  const second = builder('Igual').put('C', 'rect', 100, 100).page;
  const b = builder('Igual')
    .do((p) => ({ ...p, layers: [{ id: 'base', name: 'Base', visible: true, locked: false, printable: true }, { id: 'oc', name: 'Oculta', visible: false, locked: false, printable: true }, { id: 'fija', name: 'Fija', visible: true, locked: true, printable: false }], activeLayer: 'base' }))
    .put('Lleva {{Responsable}}: {{coste (€)}} y {{otro}}', 'rect', 100, 100, { data, showData: true, link: { url: 'https://example.org/?a=1&b=2', tip: 'Ver «más»' } })
    .put('escondida', 'rect', 400, 100, { layer: 'oc' })
    .put('fija', 'rect', 400, 300, { layer: 'fija', link: { page: second.id } });
  const d = diagramOf(b.page, second);

  it('writes shape data with names Visio takes, and the text tied to it', async () => {
    const { page } = await written(d);
    expect([...page.matchAll(/<Row N="([A-Za-z]\w*)"><Cell N="Value"/g)].map((m) => m[1]).filter((n) => !n!.startsWith('Nova'))).toEqual(['Responsable', 'Coste____', 'Urgente', 'Fecha_limite', 'Row_5', 'Fecha_limite_2']);
    expect(page).toContain('<Cell N="Value" V="2026-12-24T00:00:00" U="DATE"/>');
    expect(page).toContain('<Cell N="Value" V="1" U="BOOL"/>');
    expect(page).toContain('Lleva <fld IX="0">Ana</fld>: <fld IX="1">12.5</fld> y {{otro}}');
    expect(page).toContain('<Cell N="Value" V="Ana" U="STR" F="Prop.Responsable"/>');
    expect(page).toContain('<Cell N="Format" V="esc(0)" U="STR" F="FIELDPICTURE(0)"/>');
  });

  it('writes every layer, hidden ones too, and tells pages of the same name apart', async () => {
    const { page, pages } = await written(d);
    expect([...pages.matchAll(/<Page ID="\d+" NameU="([^"]*)"/g)].map((m) => m[1])).toEqual(['Igual', 'Igual (2)']);
    expect([...pages.matchAll(/<Row IX="\d+"><Cell N="Name" V="([^"]*)"\/>.*?<Cell N="Visible" V="(\d)"\/><Cell N="Print" V="(\d)"\/>/g)].map((m) => m.slice(1))).toEqual([['Base', '1', '1'], ['Oculta', '0', '1'], ['Fija', '1', '0']]);
    expect(cellOf(sheetWith(page, 'escondida'), 'LayerMember')![1]).toBe('1');
    expect(page).toContain('<Cell N="SubAddress" V="Igual (2)" U="STR"/>');
  });

  it('brings them back', async () => {
    const { diagram } = await importVsdx(await exportVsdx(d));
    const [one, two] = diagram.pages;
    const [a, hidden, locked] = one!.shapes;
    expect(a!.text).toBe('Lleva {{Responsable}}: {{coste (€)}} y {{otro}}');
    expect(a!.data).toEqual(data);
    expect(a!.showData).toBe(true);
    expect(a!.link).toEqual({ url: 'https://example.org/?a=1&b=2', tip: 'Ver «más»' });
    expect(locked!.link).toEqual({ page: two!.id });
    expect(one!.layers!.map((l) => [l.name, l.visible, l.locked, l.printable])).toEqual([['Base', true, false, true], ['Oculta', false, false, true], ['Fija', true, true, false]]);
    expect(hidden!.layer).toBe(one!.layers![1]!.id);
    expect(one!.activeLayer).toBe(one!.layers![0]!.id);
  });

  it('adds no layer of its own to a drawing with groups', async () => {
    const g = builder().do((p) => ({ ...p, layers: [{ id: 'base', name: 'Base', visible: true, locked: false, printable: true }], activeLayer: 'base' })).put('A', 'rect', 100, 100).put('B', 'rect', 300, 100);
    g.do((p) => groupShapes(p, [g.ids.A!, g.ids.B!])!.page);
    await expectSame(diagramOf(g.page));
  });

  it('follows a datum changed in Visio, and keeps a text rewritten there', async () => {
    const changed = await readAfter(d, (x) => x.replace(/V="Ana" U="STR"/g, 'V="Luis" U="STR"').replace('>Ana</fld>', '>Luis</fld>'));
    const a = changed.diagram.pages[0]!.shapes[0]!;
    expect(a.data![0]!.value).toBe('Luis');
    expect(a.text).toBe('Lleva {{Responsable}}: {{coste (€)}} y {{otro}}');
    const rewritten = await readAfter(d, (x) => x.replace('Lleva <fld', 'Ya no lleva <fld'));
    expect(rewritten.diagram.pages[0]!.shapes[0]!.text).toBe('Ya no lleva Ana: 12.5 y {{otro}}');
  });
});

describe('groups', () => {
  const b = builder().put('A', 'rect', 100, 100).put('B', 'ellipse', 300, 100).put('C', 'hexagon', 200, 300, { rot: 30 });
  b.do((p) => groupShapes(p, [b.ids.A!, b.ids.B!])!.page).do((p) => groupShapes(p, [b.ids.A!, b.ids.C!])!.page);
  const d = diagramOf(b.page);

  it('are groups of Visio, whose parts follow their size', async () => {
    const { page } = await written(d);
    expect(page.match(/Type="Group"/g)).toHaveLength(2);
    const a = sheetWith(page, 'A');
    expect(cellOf(a, 'PinX')![2]).toMatch(/^Sheet\.2!Width\*0\.\d+$/);
    expect(cellOf(a, 'Height')![2]).toMatch(/^Sheet\.2!Height\*/);
    // a turned part is moved with the group, not stretched
    expect(cellOf(sheetWith(page, 'C'), 'Width')![2]).toBeUndefined();
  });

  it('come back one inside the other', async () => {
    const back = await expectSame(d);
    const [outer, inner] = [back.pages[0]!.groups!.find((g) => !g.parent)!, back.pages[0]!.groups!.find((g) => g.parent)!];
    expect(inner.parent).toBe(outer.id);
  });
});

describe('shapes that take more than one sheet', () => {
  const b = builder()
    .put('Pedido\n---\n+ total: {{Total}}\n---\n+ enviar()', 'umlClass', 120, 120, { w: 180, h: 150, data: [{ name: 'Total', value: '99', type: 'number' }] })
    .put('impresora', 'netPrinter', 400, 120)
    .put('final', 'umlFinal', 560, 120)
    .put('', 'umlInitial', 640, 120)
    .put('fin', 'bpmnEnd', 700, 120)
    .put('servidor', 'netServer', 120, 400)
    .put('vida', 'umlLifeline', 300, 500)
    .put('foto', 'image', 520, 400, { rot: 20, flipH: true })
    .put('', 'image', 700, 400);
  b.do((p) => setShapeImage(p, [b.ids.foto!], { src: PNG, fit: 'contain', alt: 'Una «foto»' })).do((p) => setShapeImage(p, [b.ids['']!], { src: PNG, fit: 'stretch' }));
  const d = diagramOf(b.page);

  it('writes the compartments of a class apart, tied to the data of the shape', async () => {
    const { page } = await written(d);
    const total = page.split(/(?=<Shape ID=)/).find((s) => s.includes('+ total: <fld'))!;
    expect(total).toContain('F="Sheet.1!Prop.Total"');
    expect(page).not.toContain('---</Text>');
  });

  it('paints with the line colour in a sheet of its own, so that Visio does not leave a hole', async () => {
    const { page } = await written(diagramOf(builder().put('f', 'umlFinal', 100, 100).page));
    expect([...page.matchAll(/<Cell N="FillForegnd" V="(#\w+)"\/>/g)].map((m) => m[1])).toEqual(['#FFFFFF', '#2F4F6F']);
    expect(page).toContain('V="body"');
  });

  it('brings each back as one shape of Nova', async () => {
    await expectSame(d);
  });
});

describe('containers and swimlanes', () => {
  function sample() {
    const b = builder()
      .put('', 'pool', 380, 200)
      .put('v1', 'process', 200, 100)
      .put('v2', 'process', 380, 200)
      .put('Equipo', 'container', 1000, 220)
      .put('m1', 'rect', 950, 220, { w: 80, h: 50 })
      .put('vertical', 'poolV', 380, 700)
      .put('w1', 'rect', 220, 640, { w: 90, h: 50 });
    // the horizontal pool gets titles of its own
    b.do((p) => ({ ...p, shapes: p.shapes.map((s) => (s.stencil === 'pool' ? { ...s, container: { ...s.container!, lanes: s.container!.lanes!.map((l, i) => ({ ...l, title: ['Ventas', 'Almacén', 'Envíos'][i]! })) } } : s)) }));
    b.do(settleContainers).link('v1', 'v2').link('v2', 'Equipo');
    return b;
  }
  const b = sample();
  const d = diagramOf(b.page);

  it('says to Visio what each container holds', async () => {
    const { page } = await written(d);
    const box = sheetWith(page, 'Equipo');
    const member = sheetWith(page, 'm1');
    expect(box).toContain('<Row N="msvStructureType"><Cell N="Value" V="Container" U="STR"/></Row>');
    expect(cellOf(box, 'Relationships')![2]).toBe(`SUM(DEPENDSON(1,Sheet.${idOf(member)}!SheetRef()))`);
    expect(cellOf(member, 'Relationships')![2]).toBe(`SUM(DEPENDSON(4,Sheet.${idOf(box)}!SheetRef()))`);
    // a shape in a lane is in the lane and in the pool; the lane is in the pool and holds the shape
    const lane = sheetWith(page, 'Ventas');
    const inLane = cellOf(sheetWith(page, 'v1'), 'Relationships')![2]!;
    expect(inLane).toContain(`Sheet.${idOf(lane)}!SheetRef()`);
    expect(inLane.match(/SheetRef/g)).toHaveLength(2);
    expect(cellOf(lane, 'Relationships')![2]).toMatch(new RegExp(`^SUM\\(DEPENDSON\\(4,Sheet\\.\\d+!SheetRef\\(\\)\\),DEPENDSON\\(1,Sheet\\.${idOf(sheetWith(page, 'v1'))}!SheetRef\\(\\)\\)\\)$`));
    // titles of horizontal lanes run upwards
    expect(Number(cellOf(lane, 'TxtAngle')![1])).toBeCloseTo(Math.PI / 2, 5);
  });

  it('brings back pools, lanes, containers and members', async () => {
    const back = await expectSame(d);
    const p = back.pages[0]!;
    expect(p.shapes.filter((s) => s.parent)).toHaveLength(b.page.shapes.filter((s) => s.parent).length);
  });

  it('takes the titles, sizes and order of the lanes from the drawing', async () => {
    // rename a lane and swap the places of the first two, as one would in Visio
    const { diagram } = await readAfter(d, (xml) => {
      const sheets = xml.split(/(?=<Shape ID=)/);
      const find = (t: string) => sheets.findIndex((s) => s.includes(`>${t}</Text>`));
      const [one, two] = [find('Ventas'), find('Almacén')];
      const pinY = (s: string) => /<Cell N="PinY" V="[^"]*"(?: F="[^"]*")?\/>/.exec(s)![0];
      const [y1, y2] = [pinY(sheets[one]!), pinY(sheets[two]!)];
      sheets[one] = sheets[one]!.replace(y1, y2).replace('>Ventas</Text>', '>Compras</Text>');
      sheets[two] = sheets[two]!.replace(y2, y1);
      return sheets.join('');
    });
    const pool = diagram.pages[0]!.shapes.find((s) => s.stencil === 'pool')!;
    expect(pool.container!.lanes!.map((l) => l.title)).toEqual(['Almacén', 'Compras', 'Envíos']);
    expect(pool.container!.lanes!.map((l) => Math.round(l.size))).toEqual([100, 100, 100]);
  });

  it('counts a lane copied in Visio, and keeps the lanes whose pool is gone', async () => {
    const lanesOnly = builder().put('', 'pool', 380, 200).page;
    const sheetsOf = (xml: string) => /<Shapes>([\s\S]*)<\/Shapes>/.exec(xml)![1]!.split(/(?=<Shape ID=)/);
    const copied = await readAfter(diagramOf(lanesOnly), (xml) => {
      const sheets = sheetsOf(xml);
      // the last lane again, below it
      const copy = sheets.at(-1)!.replace(/<Shape ID="\d+"/, '<Shape ID="90"').replace(/(<Cell N="PinY" V=")([^"]+)/, (_m, head: string, y: string) => head + (Number(y) - 100 / 96)).replace('>Carril 3</Text>', '>Carril 4</Text>');
      return xml.replace('</Shapes>', `${copy}</Shapes>`);
    });
    const pool = copied.diagram.pages[0]!.shapes[0]!;
    expect(pool.container!.lanes!.map((l) => l.title)).toEqual(['Carril 1', 'Carril 2', 'Carril 3', 'Carril 4']);
    expect(new Set(pool.container!.lanes!.map((l) => l.id)).size).toBe(4);
    expect(Math.round(pool.h)).toBe(400);
    const orphans = await readAfter(diagramOf(lanesOnly), (xml) => xml.replace(sheetsOf(xml)[0]!, ''));
    expect(orphans.diagram.pages[0]!.shapes.map((s) => s.text)).toEqual(['Carril 1', 'Carril 2', 'Carril 3']);
  });

  it('keeps the lanes of a turned pool', async () => {
    const turned = builder().put('', 'pool', 500, 400, { rot: 90 }).page;
    const { page } = await written(diagramOf(turned));
    expect(page.match(/<Cell N="Angle" V="-1\.5707963267948966"\/>/g)).toHaveLength(4);
    const { diagram } = await importVsdx(await exportVsdx(diagramOf(turned)));
    expect(diagram.pages[0]!.shapes[0]!.container!.lanes!.map((l) => [l.title, Math.round(l.size)])).toEqual([['Carril 1', 100], ['Carril 2', 100], ['Carril 3', 100]]);
  });

  it('copes with identifiers of any form', async () => {
    const odd = { ...b.page, shapes: b.page.shapes.map((s) => ({ ...s, id: `a/${s.id}`, ...(s.parent ? { parent: `a/${s.parent}` } : {}) })), connectors: [] };
    await expect(exportVsdx(diagramOf(odd))).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('guides', () => {
  it('go to Visio as its guides and come back', async () => {
    const p = { ...builder().put('A', 'rect', 100, 100).page, guides: [{ id: 'a', axis: 'x' as const, pos: 192 }, { id: 'b', axis: 'y' as const, pos: 96 }] };
    const { page } = await written(diagramOf(p));
    expect(page.match(/Type="Guide"/g)).toHaveLength(2);
    expect(page).toContain('<Row T="InfiniteLine" IX="1">');
    const { diagram, warnings } = await importVsdx(await exportVsdx(diagramOf(p)));
    expect(warnings).toEqual([]);
    expect(diagram.pages[0]!.guides!.map((g) => [g.axis, g.pos])).toEqual([['x', 192], ['y', 96]]);
    expect(diagram.pages[0]!.shapes).toHaveLength(1);
    const tilted = await readAfter(diagramOf(p), (x) => x.replace('<Cell N="Angle" V="0"/><Cell N="LineColor" V="#7F7F7F"/>', '<Cell N="Angle" V="0.5"/><Cell N="LineColor" V="#7F7F7F"/>'));
    expect(tilted.diagram.pages[0]!.guides).toHaveLength(1);
    expect(tilted.warnings.join(' ')).toMatch(/1 guía/);
  });
});

describe('files written by earlier versions', () => {
  it('still read: a picture as a sheet of its own and a connector without ends', async () => {
    const cell = (n: string, v: string | number) => `<Cell N="${n}" V="${v}"/>`;
    const box = (x: number, y: number, w: number, h: number) => cell('PinX', x) + cell('PinY', y) + cell('Width', w) + cell('Height', h);
    const user = (n: string, v: string) => `<Section N="User"><Row N="${n}">${cell('Value', v)}</Row></Section>`;
    const zip = await JSZip.loadAsync(await exportVsdx(newDiagram('x')));
    zip.file('visio/pages/page1.xml', `<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><Shapes><Shape ID="1" Type="Foreign">${box(2, 2, 1, 1)}${user('NovaImagePart', 's1')}<ForeignData ForeignType="Bitmap"><Rel r:id="rId1"/></ForeignData></Shape><Shape ID="2" Type="Shape">${box(2, 2, 1, 1)}${user('NovaStencil', 'image')}<Text>vieja</Text></Shape><Shape ID="3" Type="Shape">${box(5, 2, 2, 1)}${user('NovaConnector', 'elbow')}<Section N="Geometry" IX="0">${[[0, 0], [1, 0], [1, 1], [2, 1]].map(([px, py], i) => `<Row T="${i ? 'LineTo' : 'MoveTo'}" IX="${i + 1}">${cell('X', px!)}${cell('Y', py!)}</Row>`).join('')}</Section></Shape></Shapes></PageContents>`);
    zip.file('visio/pages/_rels/page1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://x/image" Target="../media/image1.png"/></Relationships>');
    zip.file('visio/media/image1.png', PNG.split(',')[1]!, { base64: true });
    const { diagram, warnings } = await importVsdx(await zip.generateAsync({ type: 'uint8array' }));
    const p = diagram.pages[0]!;
    expect(warnings).toEqual([]);
    expect(p.shapes).toHaveLength(1);
    expect(p.shapes[0]).toMatchObject({ stencil: 'image', text: 'vieja', image: { src: PNG, fit: 'stretch' } });
    const k = p.connectors[0]!;
    expect(k.routing).toBe('elbow');
    expect(k.from).toEqual({ x: 384, y: expect.any(Number) });
    expect(k.to).toEqual({ x: 576, y: expect.any(Number) });
  });
});
