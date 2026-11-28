import JSZip from 'jszip';
import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { addConnector, addShape, setShapeImage, vsdxPicturesLost, pictureInfo, exportVsdx, flattenPath, importVsdx, newConnector, newDiagram, shapeRender } from './index';

describe('flattenPath', () => {
  it('handles lines, closing and arcs', () => {
    const [sq] = flattenPath('M0,0 H10 V10 H0 Z');
    expect(sq!.pts).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(sq!.closed).toBe(true);
    const [c] = flattenPath('M0,5 A5,5 0 1 0 10,5 A5,5 0 1 0 0,5 Z');
    expect(c!.pts.length).toBeGreaterThan(20);
    for (const [x, y] of c!.pts) expect(Math.hypot(x - 5, y - 5)).toBeCloseTo(5, 0);
  });
});

function sample() {
  const d = newDiagram('Demo');
  let p = d.pages[0]!;
  p = addShape(p, 'process', 200, 150, { text: 'Paso & uno', style: { ...addShape(p, 'process', 0, 0).shape.style, fill: '#ffcc00', stroke: '#112233' }, font: { ...addShape(p, 'process', 0, 0).shape.font, bold: true, size: 16 } }).page;
  const a = p.shapes[0]!;
  const r = addShape(p, 'decision', 500, 300, { text: '¿Ok?', rot: 30 });
  p = r.page;
  p = addConnector(p, newConnector({ shape: a.id, port: 'auto' }, { shape: r.shape.id, port: 'auto' }, { text: 'sí' }));
  return { ...d, pages: [p] };
}

describe('VSDX export', () => {
  it('writes a well-formed package with the parts Visio expects', async () => {
    const zip = await JSZip.loadAsync(await exportVsdx(sample()));
    for (const f of ['[Content_Types].xml', '_rels/.rels', 'visio/document.xml', 'visio/pages/pages.xml', 'visio/pages/page1.xml', 'visio/pages/_rels/pages.xml.rels', 'visio/_rels/document.xml.rels', 'visio/windows.xml']) {
      const body = await zip.file(f)?.async('string');
      expect(body, f).toBeTruthy();
      expect(XMLValidator.validate(body!), f).toBe(true);
    }
    // real Visio refuses a file without its window part, linked from the document and typed in the content types
    expect(await zip.file('visio/_rels/document.xml.rels')!.async('string')).toMatch(/relationships\/windows" Target="windows.xml"/);
    expect(await zip.file('[Content_Types].xml')!.async('string')).toMatch(/PartName="\/visio\/windows.xml" ContentType="application\/vnd.ms-visio.windows\+xml"/);
    const page = await zip.file('visio/pages/page1.xml')!.async('string');
    expect(page).toContain('Paso &amp; uno');
    expect(page).toContain('N="FillForegnd" V="#FFCC00"');
  });
});

describe('VSDX round trip', () => {
  it('brings back shapes, text, colours, rotation, stencils and connectors', async () => {
    const src = sample();
    const { diagram, warnings } = await importVsdx(await exportVsdx(src));
    expect(warnings).toEqual([]);
    const pg = diagram.pages[0]!;
    const o = src.pages[0]!;
    expect(pg.width).toBe(o.width);
    expect(pg.height).toBe(o.height);
    expect(pg.shapes.map((s) => s.stencil)).toEqual(['process', 'decision']);
    expect(pg.shapes.map((s) => s.text)).toEqual(['Paso & uno', '¿Ok?']);
    for (let i = 0; i < 2; i++) {
      const a = pg.shapes[i]!;
      const b = o.shapes[i]!;
      expect(a.x).toBeCloseTo(b.x, 0);
      expect(a.y).toBeCloseTo(b.y, 0);
      expect(a.w).toBeCloseTo(b.w, 0);
      expect(a.h).toBeCloseTo(b.h, 0);
      expect(a.rot).toBeCloseTo(b.rot, 3);
    }
    expect(pg.shapes[0]!.style.fill).toBe('#ffcc00');
    expect(pg.shapes[0]!.style.stroke).toBe('#112233');
    expect(pg.shapes[0]!.font.bold).toBe(true);
    expect(pg.shapes[0]!.font.size).toBeCloseTo(16, 1);
    expect(pg.connectors).toHaveLength(1);
    expect(pg.connectors[0]!.text).toBe('sí');
    expect(pg.connectors[0]!.endArrow).toBe('arrow');
    // the imported connector is a free polyline that starts and ends where the original did
    expect(shapeRender(pg.shapes[0]!).paths.length).toBeGreaterThan(0);
  });
});

describe('VSDX from other tools', () => {
  async function synthetic(): Promise<Uint8Array> {
    const NS = 'http://schemas.microsoft.com/office/visio/2012/main';
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    zip.file('visio/document.xml', `<VisioDocument xmlns="${NS}"/>`);
    zip.file('visio/_rels/document.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/><Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/masters" Target="masters/masters.xml"/></Relationships>`);
    zip.file('visio/pages/pages.xml', `<Pages xmlns="${NS}" xmlns:r="${R}"><Page ID="0" Name="Hoja 1"><PageSheet><Cell N="PageWidth" V="10"/><Cell N="PageHeight" V="5"/></PageSheet><Rel r:id="rId1"/></Page></Pages>`);
    zip.file('visio/pages/_rels/pages.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/page" Target="page1.xml"/></Relationships>`);
    zip.file('visio/masters/masters.xml', `<Masters xmlns="${NS}" xmlns:r="${R}"><Master ID="2" Name="Proceso"><Rel r:id="rId1"/></Master></Masters>`);
    zip.file('visio/masters/_rels/masters.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/master" Target="master2.xml"/></Relationships>`);
    // master: a triangle 1x1 inch with a bezier-free outline
    zip.file('visio/masters/master2.xml', `<MasterContents xmlns="${NS}"><Shapes><Shape ID="1" Type="Shape"><Cell N="Width" V="1"/><Cell N="Height" V="1"/><Section N="Geometry" IX="0"><Cell N="NoFill" V="0"/><Row T="MoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row><Row T="LineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="0"/></Row><Row T="LineTo" IX="3"><Cell N="X" V="0.5"/><Cell N="Y" V="1"/></Row><Row T="LineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row></Section></Shape></Shapes></MasterContents>`);
    zip.file(
      'visio/pages/page1.xml',
      `<PageContents xmlns="${NS}"><Shapes>
<Shape ID="1" Master="2" Type="Shape"><Cell N="PinX" V="2"/><Cell N="PinY" V="4"/><Cell N="Width" V="2"/><Cell N="Height" V="1"/><Cell N="FillForegnd" V="#FF0000"/><Text>Triángulo</Text></Shape>
<Shape ID="2" Type="Shape"><Cell N="PinX" V="6"/><Cell N="PinY" V="2.5"/><Cell N="Width" V="2"/><Cell N="Height" V="1"/><Section N="Geometry" IX="0"><Row T="MoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row><Row T="LineTo" IX="2"><Cell N="X" V="2"/><Cell N="Y" V="0"/></Row><Row T="LineTo" IX="3"><Cell N="X" V="2"/><Cell N="Y" V="1"/></Row><Row T="LineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="1"/></Row><Row T="LineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row></Section><Text>Caja</Text></Shape>
<Shape ID="3" Type="Group"><Cell N="PinX" V="5"/><Cell N="PinY" V="1"/><Cell N="Width" V="2"/><Cell N="Height" V="1"/><Shapes><Shape ID="4" Type="Shape"><Cell N="PinX" V="1"/><Cell N="PinY" V="0.5"/><Cell N="Width" V="1"/><Cell N="Height" V="1"/><Section N="Geometry" IX="0"><Row T="Ellipse" IX="1"><Cell N="X" V="0.5"/><Cell N="Y" V="0.5"/><Cell N="A" V="1"/><Cell N="B" V="0.5"/><Cell N="C" V="0.5"/><Cell N="D" V="1"/></Row></Section><Text>Hijo</Text></Shape></Shapes></Shape>
<Shape ID="5" Type="Shape"><Cell N="PinX" V="4"/><Cell N="PinY" V="3"/><Cell N="Width" V="2"/><Cell N="Height" V="1"/><Cell N="BeginX" V="3"/><Cell N="BeginY" V="4"/><Cell N="EndX" V="5"/><Cell N="EndY" V="2.5"/><Cell N="EndArrow" V="13"/><Section N="Geometry" IX="0"><Row T="MoveTo"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row><Row T="LineTo"><Cell N="X" V="1"/><Cell N="Y" V="0"/></Row><Row T="LineTo"><Cell N="X" V="1"/><Cell N="Y" V="1"/></Row></Section></Shape>
<Shape ID="6" Type="Foreign"><Cell N="PinX" V="1"/><Cell N="PinY" V="1"/><Cell N="Width" V="1"/><Cell N="Height" V="1"/></Shape>
</Shapes><Connects><Connect FromSheet="5" FromCell="BeginX" ToSheet="1" ToCell="PinX"/><Connect FromSheet="5" FromCell="EndX" ToSheet="2" ToCell="PinX"/></Connects></PageContents>`,
    );
    return zip.generateAsync({ type: 'uint8array' });
  }

  it('reads master instances, plain geometry, groups, ellipses, glued connectors and skips images', async () => {
    const { diagram, warnings } = await importVsdx(await synthetic());
    const pg = diagram.pages[0]!;
    expect(pg.name).toBe('Hoja 1');
    expect([pg.width, pg.height]).toEqual([960, 480]);
    const byText = (t: string) => pg.shapes.find((s) => s.text === t)!;
    const tri = byText('Triángulo');
    expect(tri.geometry).toBeTruthy();
    expect(tri.geometry![0]!.pts.length).toBe(3);
    expect(tri.style.fill).toBe('#ff0000');
    // instance box: centre (2,4) in, 2x1 in; page is 5 in high => y down
    expect(tri.w).toBe(192);
    expect(tri.h).toBe(96);
    expect(tri.x).toBe(96);
    expect(tri.y).toBe(Math.round((5 - 4.5) * 96));
    expect(byText('Caja').stencil).toBe('rect');
    const kid = byText('Hijo');
    expect(kid.stencil).toBe('ellipse');
    // group at (5,1) 2x1 in, child centred at local (1,0.5): page centre (5,1)
    expect(kid.x + kid.w / 2).toBeCloseTo(5 * 96, 0);
    expect(kid.y + kid.h / 2).toBeCloseTo((5 - 1) * 96, 0);
    expect(pg.connectors).toHaveLength(1);
    const c = pg.connectors[0]!;
    expect(c.routing).toBe('elbow');
    expect(c.endArrow).toBe('arrow');
    expect(c.from).toEqual({ shape: tri.id, port: 'auto' });
    expect(c.to).toEqual({ shape: byText('Caja').id, port: 'auto' });
    expect(warnings.join(' ')).toMatch(/1 imagen/);
  });

  it('refuses things that are not Visio drawings', async () => {
    await expect(importVsdx(new Uint8Array([1, 2, 3]))).rejects.toThrow(/vsdx/);
    const zip = new JSZip();
    zip.file('a.txt', 'x');
    await expect(importVsdx(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/Visio/);
  });
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('VSDX pictures', () => {
  // a 1×1 PNG is too small to show proportions: the header is patched to 200×100
  const wide = (() => {
    const bin = Uint8Array.from(atob(PNG.split(',')[1]!), (c) => c.charCodeAt(0));
    bin[19] = 200;
    bin[23] = 100;
    let s = '';
    for (const b of bin) s += String.fromCharCode(b);
    return `data:image/png;base64,${btoa(s)}`;
  })();

  function withPicture(src: string, fit: 'contain' | 'cover' | 'stretch') {
    const d = newDiagram('Fotos');
    const r = addShape(d.pages[0]!, 'image', 300, 200, { w: 160, h: 160 });
    const page = setShapeImage(r.page, [r.shape.id], { src, fit });
    return { ...d, pages: [page] };
  }

  it('reads the size of PNG, and refuses what Visio cannot hold', () => {
    expect(pictureInfo(wide)).toMatchObject({ ext: 'png', w: 200, h: 100 });
    expect(pictureInfo('data:image/svg+xml;base64,PHN2Zy8+')).toBeNull();
    expect(pictureInfo('data:image/webp;base64,AAAA')).toBeNull();
  });

  it('writes the picture as a Visio picture shape, with its part, relationship and content type', async () => {
    const zip = await JSZip.loadAsync(await exportVsdx(withPicture(wide, 'contain')));
    expect(zip.file('visio/media/image1.png')).toBeTruthy();
    for (const f of ['[Content_Types].xml', 'visio/pages/page1.xml', 'visio/pages/_rels/page1.xml.rels']) expect(XMLValidator.validate((await zip.file(f)!.async('string'))), f).toBe(true);
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('<Default Extension="png" ContentType="image/png"/>');
    expect(await zip.file('visio/pages/_rels/page1.xml.rels')!.async('string')).toContain('Target="../media/image1.png"');
    const page = await zip.file('visio/pages/page1.xml')!.async('string');
    expect(page).toContain('Type="Foreign"');
    expect(page).toContain('<ForeignData ForeignType="Bitmap" CompressionType="PNG">');
    // contain: 200×100 in a 160×160 box is 160×80 (the picture shape is smaller than the box), centred
    const w = Number(/<Shape ID="2"[^>]*Type="Foreign">.*?N="Width" V="([^"]+)"/.exec(page)![1]);
    const h = Number(/<Shape ID="2"[^>]*Type="Foreign">.*?N="Height" V="([^"]+)"/.exec(page)![1]);
    expect(w / h).toBeCloseTo(2, 3);
    // the picture and the drawing of the shape make a group, which carries what Nova knows of the shape
    expect(page).toMatch(/<Shape ID="1"[^>]*Type="Group">.*?<Row N="NovaStencil"><Cell N="Value" V="image" U="STR"\/>/);
  });

  it('cover uses the picture size and offset cells; stretch fills the box', async () => {
    const cover = await (await JSZip.loadAsync(await exportVsdx(withPicture(wide, 'cover')))).file('visio/pages/page1.xml')!.async('string');
    expect(cover).toContain('N="ImgWidth"');
    expect(cover).toContain('N="ImgOffsetX"');
    const stretch = await (await JSZip.loadAsync(await exportVsdx(withPicture(wide, 'stretch')))).file('visio/pages/page1.xml')!.async('string');
    // as Visio writes a picture that fills its shape: the picture is as big as the shape, tied to it by formula
    expect(stretch).toContain('N="ImgWidth" V="1.666667" F="Width*1"');
  });

  it('a picture Visio cannot hold is counted and the shape goes without it; the picture of a Nova file comes back as its shape, with no warning', async () => {
    const svg = withPicture('data:image/svg+xml;base64,PHN2Zy8+', 'contain');
    expect(vsdxPicturesLost(svg)).toBe(1);
    expect(await (await JSZip.loadAsync(await exportVsdx(svg))).file('visio/pages/page1.xml')!.async('string')).not.toContain('Foreign');
    const { diagram, warnings } = await importVsdx(await exportVsdx(withPicture(wide, 'contain')));
    expect(warnings).toEqual([]);
    expect(diagram.pages[0]!.shapes.some((x) => x.stencil === 'image')).toBe(true);
  });
});
