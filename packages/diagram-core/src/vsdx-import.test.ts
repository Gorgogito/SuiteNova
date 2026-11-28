/*
 * Reading drawings as Visio structures them. The files are written here by hand (a drawing made with Visio would carry
 * Microsoft's shapes); the rules they exercise were compared with Visio itself.
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { addShape, exportVsdx, importVsdx, newDiagram, parseDiagram, serializeDiagram, setShapeImage, shapeRender, type Page, type Shape } from './index';
import { arcThrough, ellipticalArc, geometryPaths, nurbs, type GeoRow } from './vsdx-geometry';
import { applyMods, gradientColor, parseTheme, themedLook, type PageTheme } from './vsdx-theme';
import { flattenText } from './vsdx-read';

const NS = 'http://schemas.microsoft.com/office/visio/2012/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const c = (n: string, v: string | number, f?: string) => `<Cell N="${n}" V="${v}"${f ? ` F="${f.replace(/"/g, '&quot;')}"` : ''}/>`;
const cells = (o: Record<string, string | number>) => Object.entries(o).map(([n, v]) => c(n, v)).join('');
const box = (x: number, y: number, w: number, h: number) => cells({ PinX: x, PinY: y, Width: w, Height: h });
const row = (t: string, ix: number, o: Record<string, string | number>) => `<Row T="${t}" IX="${ix}">${cells(o)}</Row>`;
const rect = (w: number, h: number, ix = 0, flags: Record<string, number> = {}) =>
  `<Section N="Geometry" IX="${ix}">${cells(flags)}${row('MoveTo', 1, { X: 0, Y: 0 })}${row('LineTo', 2, { X: w, Y: 0 })}${row('LineTo', 3, { X: w, Y: h })}${row('LineTo', 4, { X: 0, Y: h })}${row('LineTo', 5, { X: 0, Y: 0 })}</Section>`;
const section = (name: string, rows: Record<string, Record<string, string | number>>) =>
  `<Section N="${name}">${Object.entries(rows).map(([k, o]) => `<Row ${/^\d+$/.test(k) ? 'IX' : 'N'}="${k}">${cells(o)}</Row>`).join('')}</Section>`;

const solid = (inner: string) => `<a:solidFill>${inner}</a:solidFill>`;
const ph = (mods = '') => `<a:schemeClr val="phClr">${mods}</a:schemeClr>`;
/** A theme in the shape Visio writes it, with only what the reading needs. */
function themeXml(id: number): string {
  const colors = Object.entries({ dk1: '000000', lt1: 'FEFFFF', dk2: '44546A', lt2: 'E7E6E6', accent1: '4672C4', accent2: 'ED7D31', accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47' })
    .map(([k, v]) => `<a:${k}><a:srgbClr val="${v}"/></a:${k}>`)
    .join('');
  const variation = (mono: boolean) => `<vt:variationClrScheme${mono ? ' monotone="1"' : ''}>${['4672C4', '759FCC', '41719C', 'BDD0E9', 'ED7D31', '70AD47', 'FEC000'].map((v, i) => `<vt:varColor${i + 1}><a:srgbClr val="${v}"/></vt:varColor${i + 1}>`).join('')}</vt:variationClrScheme>`;
  const line = (w: number, mods = '') => `<a:ln w="${w}">${solid(ph(mods))}<a:prstDash val="solid"/></a:ln>`;
  const gradient = `<a:gradFill><a:gsLst><a:gs pos="0">${ph('<a:tint val="20000"/>')}</a:gs><a:gs pos="100000"><a:schemeClr val="lt1"/></a:gs></a:gsLst></a:gradFill>`;
  const styles = (ns: string) => `${ns}<a:fillStyleLst>${solid('<a:srgbClr val="FFFFFF"/>')}${solid('<a:srgbClr val="FFFFFF"/>')}${gradient}${solid(ph())}${solid(ph('<a:shade val="75000"/>'))}${gradient}</a:fillStyleLst><a:lnStyleLst>${line(9525)}${line(9525)}${line(9525)}${line(3175)}${line(9525, '<a:shade val="50000"/>')}${line(9525)}</a:lnStyleLst>`;
  const font = (inner: string) => `<vt:fontProps style="0"><vt:color>${inner}</vt:color></vt:fontProps>`;
  const ex = (end: number) => `<vt:lineStyle><vt:lineEx start="0" end="${end}" pattern="1"/></vt:lineStyle>`;
  return `<a:theme xmlns:a="${A}" xmlns:vt="http://schemas.microsoft.com/office/visio/2012/theme"><a:themeElements><a:clrScheme name="x">${colors}</a:clrScheme><a:fontScheme name="x"><a:majorFont><a:latin typeface="Cambria"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme><a:fmtScheme name="x">${styles('')}</a:fmtScheme></a:themeElements><a:extLst><a:ext><vt:themeScheme><vt:schemeID schemeEnum="${id}"/></vt:themeScheme></a:ext><a:ext><vt:variationClrSchemeLst>${variation(true)}${variation(false)}</vt:variationClrSchemeLst></a:ext><a:ext><vt:fmtConnectorScheme><a:fillStyleLst>${solid(ph())}</a:fillStyleLst><a:lnStyleLst>${line(12700)}</a:lnStyleLst></vt:fmtConnectorScheme></a:ext><a:ext><vt:lineStyles><vt:fmtConnectorSchemeLineStyles>${ex(0)}${ex(4)}</vt:fmtConnectorSchemeLineStyles><vt:fmtSchemeLineStyles>${ex(0)}${ex(0)}</vt:fmtSchemeLineStyles></vt:lineStyles></a:ext><a:ext><vt:fontStylesGroup><vt:connectorFontStyles>${font(ph('<a:shade val="75000"/>'))}</vt:connectorFontStyles><vt:fontStyles>${[ph(), ph(), ph(), '<a:schemeClr val="lt1"/>', '<a:schemeClr val="lt1"/>', '<a:schemeClr val="lt1"/>'].map(font).join('')}</vt:fontStyles></vt:fontStylesGroup></a:ext><a:ext><vt:variationStyleSchemeLst><vt:variationStyleScheme>${[4, 3, 5, 4].map((i) => `<vt:varStyle fillIdx="${i}" lineIdx="${i}" effectIdx="${i}" fontIdx="${i}"/>`).join('')}</vt:variationStyleScheme></vt:variationStyleSchemeLst></a:ext></a:extLst></a:theme>`;
}

interface Parts {
  pages: { name: string; shapes: string; sheet?: string; attrs?: string; connects?: string; rels?: string }[];
  masters?: { id: number; name: string; shapes: string }[];
  sheets?: string;
  theme?: boolean;
  media?: Record<string, string>;
}

async function vsdx(p: Parts): Promise<Uint8Array> {
  const zip = new JSZip();
  const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://x/${type}" Target="${target}"/>`;
  const rels = (inner: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;
  zip.file('visio/document.xml', `<VisioDocument xmlns="${NS}"><StyleSheets>${p.sheets ?? ''}</StyleSheets></VisioDocument>`);
  zip.file('visio/_rels/document.xml.rels', rels(`${rel('r1', 'pages', 'pages/pages.xml')}${p.masters ? rel('r2', 'masters', 'masters/masters.xml') : ''}${p.theme ? rel('r3', 'theme', 'theme/theme1.xml') : ''}`));
  if (p.theme) zip.file('visio/theme/theme1.xml', themeXml(59));
  zip.file('visio/pages/pages.xml', `<Pages xmlns="${NS}" xmlns:r="${R}">${p.pages.map((q, i) => `<Page ID="${i}" Name="${q.name}" ${q.attrs ?? ''}><PageSheet>${cells({ PageWidth: 10, PageHeight: 8 })}${q.sheet ?? ''}</PageSheet><Rel r:id="p${i}"/></Page>`).join('')}</Pages>`);
  zip.file('visio/pages/_rels/pages.xml.rels', rels(p.pages.map((_, i) => rel(`p${i}`, 'page', `page${i}.xml`)).join('')));
  p.pages.forEach((q, i) => {
    zip.file(`visio/pages/page${i}.xml`, `<PageContents xmlns="${NS}" xmlns:r="${R}"><Shapes>${q.shapes}</Shapes>${q.connects ? `<Connects>${q.connects}</Connects>` : ''}</PageContents>`);
    if (q.rels) zip.file(`visio/pages/_rels/page${i}.xml.rels`, rels(q.rels));
  });
  if (p.masters) {
    zip.file('visio/masters/masters.xml', `<Masters xmlns="${NS}" xmlns:r="${R}">${p.masters.map((m) => `<Master ID="${m.id}" NameU="${m.name}"><Rel r:id="m${m.id}"/></Master>`).join('')}</Masters>`);
    zip.file('visio/masters/_rels/masters.xml.rels', rels(p.masters.map((m) => rel(`m${m.id}`, 'master', `master${m.id}.xml`)).join('')));
    for (const m of p.masters) zip.file(`visio/masters/master${m.id}.xml`, `<MasterContents xmlns="${NS}"><Shapes>${m.shapes}</Shapes></MasterContents>`);
  }
  for (const [name, b64] of Object.entries(p.media ?? {})) zip.file(`visio/media/${name}`, b64, { base64: true });
  return zip.generateAsync({ type: 'uint8array' });
}

const read = async (p: Parts) => importVsdx(await vsdx(p));
const one = async (shapes: string, extra: Omit<Parts, 'pages'> = {}) => (await read({ ...extra, pages: [{ name: 'P', shapes }] })).diagram.pages[0]!;
const byText = (p: Page, t: string): Shape => p.shapes.find((s) => s.text === t)!;

describe('theme colours', () => {
  const theme = parseTheme(themeXml(59))!;
  const page: PageTheme = { colors: theme, format: theme, connectors: theme, fonts: theme, variationColor: 0, variationStyle: 0 };
  const q = (n: number, connector = false) => themedLook(page, { fillColor: n, lineColor: n, fontColor: n, fillMatrix: n >= 100 ? n : 4, lineMatrix: n >= 100 ? n : 4, fontMatrix: n >= 100 ? n : 4, connector });
  it('tints and shades in linear light, as Visio computes them', () => {
    expect(applyMods('#4672c4', [{ name: 'shade', val: 0.75 }])).toBe('#3d64ac');
    expect(applyMods('#000000', [{ name: 'tint', val: 0.2 }])).toBe('#e7e7e7');
  });
  it('resolves the quick style numbers of a shape', () => {
    expect(q(100).fill).toBe('#4672c4');
    expect(q(102).fill).toBe('#3d64ac');
    expect(q(101).gradient).toBe(true);
    expect(q(100).text).toBe('#feffff');
    expect(q(100).lineWidth * 72).toBeCloseTo(0.25, 3);
    // 0–8 are theme colours; the 200s pick one of the variant even when it has a single colour
    expect(q(3).fill).toBe('#ed7d31');
    expect(themedLook(page, { fillColor: 205, lineColor: 100, fontColor: 100, fillMatrix: 4, lineMatrix: 4, fontMatrix: 4, connector: false }).fill).toBe('#70ad47');
    expect(themedLook(page, { fillColor: 105, lineColor: 100, fontColor: 100, fillMatrix: 4, lineMatrix: 4, fontMatrix: 4, connector: false }).fill).toBe('#4672c4');
  });
  it('gives connectors their own styles', () => {
    const l = themedLook(page, { fillColor: 100, lineColor: 100, fontColor: 100, fillMatrix: 1, lineMatrix: 1, fontMatrix: 1, connector: true });
    expect([l.line, l.endArrow]).toEqual(['#4672c4', 4]);
    expect(l.lineWidth * 72).toBeCloseTo(1, 3);
  });
  it('takes the mean of a gradient', () => {
    expect(gradientColor([{ color: '#000000', pos: 0 }, { color: '#ffffff', pos: 1 }])).toBe('#808080');
  });
});

describe('geometry', () => {
  const rows = (list: [string, Record<string, number | string>][]): GeoRow[] => list.map(([type, o]) => ({ type, v: (n) => Number(o[n] ?? 0), has: (n) => n in o, text: (n) => String(o[n] ?? '') }));
  it('follows circular and elliptical arcs', () => {
    for (const [x, y] of arcThrough([0, 0], [1, 1], [2, 0])) expect(Math.hypot(x - 1, y)).toBeCloseTo(1, 6);
    for (const [x, y] of ellipticalArc([0, 0], [2, 1], [4, 0], 0, 2)) expect(((x - 2) / 2) ** 2 + y ** 2).toBeCloseTo(1, 6);
  });
  it('reads the bow of an arc to the right of the way it goes', () => {
    const { paths } = geometryPaths(rows([['MoveTo', { X: 1, Y: 0 }], ['ArcTo', { X: -1, Y: 0, A: 1 }]]), 2, 1);
    expect(Math.max(...paths[0]!.pts.map((p) => p[1]))).toBeCloseTo(1, 2);
  });
  it('reads polylines and NURBS written as formulas', () => {
    const { paths, approximated } = geometryPaths(rows([['RelMoveTo', { X: 0, Y: 0 }], ['PolylineTo', { X: 0, Y: 0, A: 'POLYLINE(0, 0, 0,1, 1,1, 1,0)' }]]), 4, 2);
    expect(paths[0]).toEqual({ pts: [[0, 0], [0, 2], [4, 2], [4, 0]], closed: true });
    expect(approximated).toBe(false);
    // a straight line written as a first degree spline stays on the line
    const curve = nurbs([[0, 0], [1, 1], [2, 2]], [1, 1, 1], [0, 0, 1, 2, 2], 1)!;
    for (const [x, y] of curve) expect(x).toBeCloseTo(y, 6);
    expect(curve[curve.length - 1]![0]).toBeCloseTo(2, 5);
  });
});

describe('text', () => {
  it('keeps the formatting most of the characters use, and counts the formats', () => {
    expect(flattenText('<Text><cp IX="0"/>Re<cp IX="1"/> y mucho <fld IX="0">más</fld></Text>')).toBe('<Text cp="1" runs="2">Re y mucho más</Text>');
  });
});

describe('a drawing with a theme', () => {
  const sheets = `<StyleSheet ID="0">${cells({ LineWeight: 0.0104, LineColor: 0, LinePattern: 1, FillForegnd: 1, FillPattern: 1, QuickStyleFillColor: 100, QuickStyleFillMatrix: 100, QuickStyleLineColor: 100, QuickStyleLineMatrix: 100, QuickStyleFontColor: 100, QuickStyleFontMatrix: 100 })}</StyleSheet><StyleSheet ID="3" LineStyle="0" FillStyle="0" TextStyle="0">${c('FillForegnd', 'Themed')}${c('FillPattern', 'Themed')}${c('LineColor', 'Themed')}${c('LinePattern', 'Themed')}<Section N="Character"><Row IX="0">${c('Color', 'Themed')}${c('Font', 'Themed')}${c('Size', 0.125)}</Row></Section></StyleSheet>`;
  const themed = (shapes: string) => read({ theme: true, sheets, pages: [{ name: 'P', shapes, sheet: cells({ ThemeIndex: 59, ColorSchemeIndex: 59 }) }] });

  it('colours a shape that stores nothing, and keeps what it does store', async () => {
    const { diagram } = await themed(`<Shape ID="1" LineStyle="3" FillStyle="3" TextStyle="3">${box(2, 2, 1, 1)}${rect(1, 1)}<Text>tema</Text></Shape><Shape ID="2" LineStyle="3" FillStyle="3" TextStyle="3">${box(5, 2, 1, 1)}${c('FillForegnd', '#ffc000')}${c('QuickStyleFillColor', 102)}${rect(1, 1)}<Text>a mano</Text></Shape><Shape ID="3" LineStyle="3" FillStyle="3" TextStyle="3">${box(8, 2, 1, 1)}${cells({ QuickStyleFillColor: 102, QuickStyleFillMatrix: 102 })}${rect(1, 1)}<Text>oscuro</Text></Shape>`);
    const p = diagram.pages[0]!;
    expect(byText(p, 'tema').style.fill).toBe('#4672c4');
    expect(byText(p, 'tema').font).toMatchObject({ family: 'Calibri', color: '#feffff', size: 12 });
    expect(byText(p, 'a mano').style.fill).toBe('#ffc000');
    expect(byText(p, 'oscuro').style.fill).toBe('#3d64ac');
  });

  it('draws light themed text with the colour of the shape when only the page is behind it', async () => {
    const { diagram } = await themed(`<Shape ID="1" LineStyle="3" FillStyle="3" TextStyle="3">${box(2, 2, 1, 1)}${c('FillPattern', 0)}${rect(1, 1)}<Text>suelto</Text></Shape>`);
    expect(byText(diagram.pages[0]!, 'suelto').font.color).toBe('#4672c4');
  });

  it('uses the cached value of THEMEVAL when the page has no theme', async () => {
    const p = await one(`<Shape ID="1">${box(2, 2, 1, 1)}${c('FillForegnd', '#1957ba', 'THEMEVAL("FillColor",RGB(25,87,186))')}${rect(1, 1)}</Shape>`);
    expect(p.shapes[0]!.style.fill).toBe('#1957ba');
  });
});

describe('masters, groups and placing', () => {
  const group = {
    id: 4,
    name: 'Task',
    shapes: `<Shape ID="5" Type="Group">${box(1, 1, 2, 1)}<Shapes><Shape ID="6">${box(1, 0.5, 2, 1)}${cells({ FillForegnd: '#00ff00', FillPattern: 1 })}${rect(2, 1)}</Shape><Shape ID="7">${box(0.25, 0.25, 0.2, 0.2)}${cells({ FillForegnd: '#ff0000' })}${rect(0.2, 0.2)}</Shape></Shapes></Shape>`,
  };

  it('gives the parts of a group the cells and the drawing of their master shapes', async () => {
    const p = await one(`<Shape ID="1" Type="Group" Master="4">${box(5, 4, 2, 1)}<Shapes><Shape ID="2" MasterShape="6"/><Shape ID="3" MasterShape="7"/></Shapes><Text>Tarea</Text></Shape>`, { masters: [group] });
    expect(p.shapes.map((s) => s.style.fill)).toEqual(['#00ff00', '#ff0000', 'none']);
    // the text of the group goes on top of its parts, and all are one group
    expect(p.shapes[2]!.text).toBe('Tarea');
    expect(new Set(p.shapes.map((s) => s.group)).size).toBe(1);
    expect(p.groups).toHaveLength(1);
    expect(p.shapes[0]).toMatchObject({ x: 384, y: 336, w: 192, h: 96 });
  });

  it('turns a group with what is inside it', async () => {
    const p = await one(`<Shape ID="1" Type="Group">${box(5, 4, 2, 1)}${c('Angle', Math.PI / 2)}<Shapes><Shape ID="2">${box(2, 0.5, 1, 0.5)}${rect(1, 0.5)}</Shape></Shapes></Shape>`);
    const s = p.shapes[0]!;
    // the part was at the right end of the group: turned a quarter anticlockwise it is at the top
    expect([s.x + s.w / 2, s.y + s.h / 2]).toEqual([480, 288]);
    expect(s.rot).toBe(270);
  });

  it('mirrors the drawing without turning the text', async () => {
    const p = await one(`<Shape ID="1">${box(2, 2, 1, 1)}${cells({ FlipX: 1, FlipY: 1 })}${rect(1, 1)}<Text>derecho</Text></Shape>`);
    expect(p.shapes[0]).toMatchObject({ rot: 0, flipH: true, flipV: true });
  });

  it('keeps a text turned inside its shape, and one that lies outside it', async () => {
    const p = await one(`<Shape ID="1">${box(2, 4, 1, 1)}${cells({ TxtAngle: Math.PI / 2 })}${rect(1, 1)}<Text>de lado</Text></Shape><Shape ID="2">${box(5, 4, 1, 1)}${cells({ TxtPinX: 0.5, TxtPinY: -0.3, TxtWidth: 1.5, TxtHeight: 0.4 })}${rect(1, 1)}<Text>debajo</Text></Shape>`);
    expect(byText(p, 'de lado')).toMatchObject({ stencil: 'text', rot: 270 });
    expect(byText(p, 'debajo').y).toBeGreaterThan(p.shapes.find((s) => s.x === 432 && !s.text)!.y + 96);
  });

  it('turns the common flowchart masters into the shapes of Nova', async () => {
    const master = { id: 2, name: 'Decision', shapes: `<Shape ID="5">${box(1, 1, 1, 0.75)}${rect(1, 0.75)}</Shape>` };
    const p = await one(`<Shape ID="1" Master="2">${cells({ PinX: 2, PinY: 2 })}<Text>¿Sí?</Text></Shape>`, { masters: [master] });
    expect(p.shapes[0]).toMatchObject({ stencil: 'decision', w: 96, h: 72, text: '¿Sí?' });
    expect(p.shapes[0]!.geometry).toBeUndefined();
  });

  it('gives a shape without height the room its drawing takes, and draws lines over fills', async () => {
    const arrow = `<Section N="Geometry" IX="0">${row('MoveTo', 1, { X: 0, Y: -0.25 })}${row('LineTo', 2, { X: 1, Y: 0 })}${row('LineTo', 3, { X: 0, Y: 0.25 })}${row('LineTo', 4, { X: 0, Y: -0.25 })}</Section>`;
    const p = await one(`<Shape ID="1">${box(2, 2, 1, 0)}${cells({ BeginX: 1.5, BeginY: 2, EndX: 2.5, EndY: 2 })}${arrow}</Shape><Shape ID="2">${box(5, 2, 1, 1)}<Section N="Geometry" IX="0">${c('NoFill', 1)}${row('MoveTo', 1, { X: 0, Y: 0 })}${row('LineTo', 2, { X: 1, Y: 1 })}</Section>${rect(1, 1, 1)}</Shape>`);
    expect(p.connectors).toHaveLength(0);
    expect(p.shapes[0]).toMatchObject({ h: 48, w: 96 });
    expect(p.shapes[1]!.geometry!.map((o) => o.fill)).toEqual([true, false]);
  });

  it('leaves a hole where the filled outlines of a shape overlap', async () => {
    const inner = `<Section N="Geometry" IX="1">${row('MoveTo', 1, { X: 0.25, Y: 0.25 })}${row('LineTo', 2, { X: 0.75, Y: 0.25 })}${row('LineTo', 3, { X: 0.75, Y: 0.75 })}${row('LineTo', 4, { X: 0.25, Y: 0.25 })}</Section>`;
    const p = await one(`<Shape ID="1">${box(2, 2, 1, 1)}${rect(1, 1)}${inner}</Shape>`);
    const paths = shapeRender(p.shapes[0]!).paths;
    expect(paths).toHaveLength(1);
    expect(paths[0]!.evenOdd).toBe(true);
  });

  it('reads a drawing made to scale', async () => {
    const { diagram } = await read({ pages: [{ name: 'Plano', shapes: `<Shape ID="1">${box(50, 40, 20, 10)}${rect(20, 10)}</Shape>`, sheet: cells({ PageWidth: 100, PageHeight: 80, PageScale: 1, DrawingScale: 10 }) }] });
    expect(diagram.pages[0]).toMatchObject({ width: 960, height: 768 });
    expect(diagram.pages[0]!.shapes[0]).toMatchObject({ w: 192, h: 96, x: 384 });
  });

  it('does not go on for ever when masters repeat themselves', async () => {
    const loop = { id: 1, name: 'x', shapes: `<Shape ID="5" Type="Group">${box(1, 1, 1, 1)}<Shapes><Shape ID="6" Master="1">${box(1, 1, 1, 1)}</Shape><Shape ID="7" Master="1">${box(1, 1, 1, 1)}</Shape></Shapes></Shape>` };
    await expect(one(`<Shape ID="1" Master="1">${box(2, 2, 1, 1)}</Shape>`, { masters: [loop] })).rejects.toThrow(/demasiadas formas/);
  });
});

describe('what shapes carry', () => {
  it('brings data, links and layers', async () => {
    const data = section('Property', { Responsable: { Label: 'Responsable', Value: 'Ana', Type: 0 }, Coste: { Value: '12', Type: 2 }, Hecho: { Value: '1', Type: 3 }, Oculto: { Value: 'x', Invisible: 1 } });
    const links = section('Hyperlink', { Row_1: { Address: 'https://example.org/a', Description: 'Aviso' }, Row_2: { SubAddress: 'Dos' } });
    const bad = section('Hyperlink', { Row_1: { Address: 'javascript:alert(1)' } });
    const { diagram, warnings } = await read({
      pages: [
        { name: 'Uno', shapes: `<Shape ID="1">${box(2, 2, 1, 1)}${c('LayerMember', '1')}${data}${links}${rect(1, 1)}<Text>A</Text></Shape><Shape ID="2">${box(5, 2, 1, 1)}${section('Hyperlink', { Row_1: { SubAddress: 'Dos' } })}${rect(1, 1)}<Text>B</Text></Shape><Shape ID="3">${box(8, 2, 1, 1)}${bad}${c('LayerMember', '0;1')}${rect(1, 1)}<Text>C</Text></Shape>`, sheet: section('Layer', { '0': { Name: 'Oculta', Visible: 0 }, '1': { Name: 'Avisos', Visible: 1, Lock: 0, Print: 0 } }) },
        { name: 'Dos', shapes: '' },
      ],
    });
    const p = diagram.pages[0]!;
    expect(byText(p, 'A').data).toEqual([{ name: 'Responsable', value: 'Ana', type: 'text' }, { name: 'Coste', value: '12', type: 'number' }, { name: 'Hecho', value: 'Sí', type: 'bool' }]);
    expect(byText(p, 'A').link).toEqual({ url: 'https://example.org/a', tip: 'Aviso' });
    expect(byText(p, 'B').link).toEqual({ page: diagram.pages[1]!.id });
    expect(byText(p, 'C').link).toBeUndefined();
    expect(p.layers!.map((l) => [l.name, l.visible, l.printable])).toEqual([['Sin capa', true, true], ['Oculta', false, true], ['Avisos', true, false]]);
    expect(byText(p, 'A').layer).toBe(p.layers![2]!.id);
    expect(byText(p, 'B').layer).toBe(p.layers![0]!.id);
    expect(byText(p, 'C').layer).toBe(p.layers![2]!.id);
    expect(warnings.join(' ')).toMatch(/varias capas.*varios vínculos/);
    expect(warnings.join(' ')).toMatch(/1 vínculo\(s\) a archivos/);
    // the diagram is a valid one of Nova
    expect(parseDiagram(serializeDiagram(diagram)).warnings).toEqual([]);
  });

  it('puts the background page behind, on a locked layer', async () => {
    const { diagram, warnings } = await read({
      pages: [
        { name: 'Fondo', attrs: 'Background="1"', shapes: `<Shape ID="1">${box(5, 7, 8, 1)}${rect(8, 1)}<Text>Título</Text></Shape>` },
        { name: 'Hoja', attrs: 'BackPage="0"', shapes: `<Shape ID="1">${box(2, 2, 1, 1)}${rect(1, 1)}<Text>Delante</Text></Shape>` },
      ],
    });
    expect(diagram.pages.map((p) => p.name)).toEqual(['Hoja']);
    const p = diagram.pages[0]!;
    expect(p.shapes.map((s) => s.text)).toEqual(['Título', 'Delante']);
    expect(p.layers!.map((l) => [l.name, l.locked])).toEqual([['Capa 1', false], ['Fondo', true]]);
    expect(byText(p, 'Título').layer).toBe(p.layers![1]!.id);
    expect(warnings.join(' ')).toMatch(/fondo/);
  });

  it('brings pictures, and marks the place of those it cannot show', async () => {
    const picture = (id: number, x: number, rid: string) => `<Shape ID="${id}" Type="Foreign">${box(x, 2, 1, 1)}<ForeignData ForeignType="Bitmap"><Rel r:id="${rid}"/></ForeignData></Shape>`;
    const rels = `<Relationship Id="a" Type="http://x/image" Target="../media/ok.png"/><Relationship Id="b" Type="http://x/image" Target="../media/no.emf"/>`;
    const { diagram, warnings } = await read({ pages: [{ name: 'P', shapes: picture(1, 2, 'a') + picture(2, 5, 'b'), rels }], media: { 'ok.png': PNG, 'no.emf': 'AAAA' } });
    const [ok, no] = diagram.pages[0]!.shapes;
    expect(ok!.image).toEqual({ src: `data:image/png;base64,${PNG}`, fit: 'stretch' });
    expect(no).toMatchObject({ stencil: 'rect', text: 'Imagen no compatible' });
    expect(warnings).toEqual(['1 imagen(es) u objetos incrustados no se importaron.']);
  });

  it('gives back the picture of a drawing written by Nova', async () => {
    const d = newDiagram('Fotos');
    const added = addShape(d.pages[0]!, 'image', 300, 200, { w: 160, h: 160 });
    const src = `data:image/png;base64,${PNG}`;
    const { diagram } = await importVsdx(await exportVsdx({ ...d, pages: [setShapeImage(added.page, [added.shape.id], { src, fit: 'stretch' })] }));
    expect(diagram.pages[0]!.shapes[0]!.image).toEqual({ src, fit: 'stretch' });
  });

  it('glues connectors to the connection point they name', async () => {
    const points = section('Connection', { '0': { X: 0, Y: 0.5 }, '1': { X: 1, Y: 0.5 } });
    const { diagram } = await read({
      pages: [{
        name: 'P',
        shapes: `<Shape ID="1">${box(2, 4, 1, 1)}${points}${rect(1, 1)}<Text>A</Text></Shape><Shape ID="2">${box(6, 4, 1, 1)}${points}${rect(1, 1)}<Text>B</Text></Shape><Shape ID="3">${box(4, 4, 3, 0)}${cells({ BeginX: 2.5, BeginY: 4, EndX: 5.5, EndY: 4, EndArrow: 4 })}<Text>va</Text></Shape>`,
        connects: '<Connect FromSheet="3" FromCell="BeginX" ToSheet="1" ToCell="Connections.X2"/><Connect FromSheet="3" FromCell="EndX" ToSheet="2" ToCell="Connections.X1"/>',
      }],
    });
    const p = diagram.pages[0]!;
    const k = p.connectors[0]!;
    expect(k).toMatchObject({ text: 'va', endArrow: 'arrow' });
    expect(k.from).toMatchObject({ shape: byText(p, 'A').id });
    expect(typeof (k.from as { port: unknown }).port).toBe('number');
    expect((k.from as { port: number }).port).not.toBe((k.to as { port: number }).port);
  });
});
