import JSZip from 'jszip';
import { centerOf } from './geometry';
import type { Connector, Diagram, Page, Shape } from './model';
import { connectorRender, shapeRender } from './render';
import { printablePage } from './layers';
import { stencilOf } from './stencils';
import { escXml } from './svg';

/*
 * Writing Visio drawings (.vsdx, the Open Packaging format); reading them is in `vsdx-import.ts`. Shapes are written as
 * free-form polygons with the text, colours and line styles; connectors are written as plain polylines (they are not
 * glued in Visio). See docs/LIMITACIONES.md for what Visio keeps.
 */

const NS = 'http://schemas.microsoft.com/office/visio/2012/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PX = 96; // pixels per inch

// ------------------------------------------------------------ path flattening

type Pt = [number, number];
interface Poly {
  pts: Pt[];
  closed: boolean;
}

/** Turn the absolute SVG path data used by the stencils (M L H V A C Z) into polylines. */
export function flattenPath(d: string): Poly[] {
  const tokens = d.match(/[MLHVACZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const out: Poly[] = [];
  let cur: Poly | null = null;
  let x = 0;
  let y = 0;
  let i = 0;
  const num = () => Number(tokens[i++]);
  let cmd = '';
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i]!)) cmd = tokens[i++]!;
    if (cmd === 'Z') {
      if (cur) cur.closed = true;
      continue;
    }
    if (cmd === 'M') {
      x = num();
      y = num();
      cur = { pts: [[x, y]], closed: false };
      out.push(cur);
      cmd = 'L';
    } else if (cmd === 'L') {
      x = num();
      y = num();
      cur?.pts.push([x, y]);
    } else if (cmd === 'H') {
      x = num();
      cur?.pts.push([x, y]);
    } else if (cmd === 'V') {
      y = num();
      cur?.pts.push([x, y]);
    } else if (cmd === 'C') {
      const [x1, y1, x2, y2, ex, ey] = [num(), num(), num(), num(), num(), num()];
      for (let k = 1; k <= 12; k++) {
        const t = k / 12;
        const u = 1 - t;
        cur?.pts.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey]);
      }
      x = ex;
      y = ey;
    } else if (cmd === 'A') {
      const [rx, ry, , large, sweep, ex, ey] = [num(), num(), num(), num(), num(), num(), num()];
      for (const p of arcPoints(x, y, rx, ry, !!large, !!sweep, ex, ey)) cur?.pts.push(p);
      x = ex;
      y = ey;
    } else {
      i++; // unknown token
    }
  }
  return out;
}

/** Points along an SVG elliptical arc without rotation (all stencils use axis-aligned arcs). */
function arcPoints(x1: number, y1: number, rx: number, ry: number, large: boolean, sweep: boolean, x2: number, y2: number): Pt[] {
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  let lam = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
    lam = 1;
  }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx;
  const den = rx * rx * dy * dy + ry * ry * dx * dx;
  const k = den === 0 ? 0 : sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * dy) / ry;
  const cyp = (-k * ry * dx) / rx;
  const cx = cxp + (x1 + x2) / 2;
  const cy = cyp + (y1 + y2) / 2;
  const a1 = Math.atan2((y1 - cy) / ry, (x1 - cx) / rx);
  let da = Math.atan2((y2 - cy) / ry, (x2 - cx) / rx) - a1;
  if (!sweep && da > 0) da -= 2 * Math.PI;
  if (sweep && da < 0) da += 2 * Math.PI;
  const n = Math.max(6, Math.ceil(Math.abs(da) / (Math.PI / 16)));
  const pts: Pt[] = [];
  for (let s = 1; s <= n; s++) {
    const a = a1 + (da * s) / n;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  pts[pts.length - 1] = [x2, y2];
  return pts;
}

// ------------------------------------------------------------ export

const inch = (px: number): string => String(Math.round((px / PX) * 1e6) / 1e6);
const hex = (c: string, d = '#000000'): string => {
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toUpperCase();
  return d;
};
const cell = (n: string, v: string | number, f?: string) => `<Cell N="${n}" V="${escXml(String(v))}"${f ? ` F="${escXml(f)}"` : ''}/>`;
const PATTERN = { solid: 1, dash: 2, dot: 3, dashdot: 4 } as const;

function geometryXml(polys: { pts: Pt[]; closed: boolean; fill: boolean; stroke: boolean }[], h: number): string {
  return polys
    .filter((p) => p.pts.length > 1)
    .map((p, ix) => {
      const rows = p.pts.map(([x, y], k) => `<Row T="${k === 0 ? 'MoveTo' : 'LineTo'}" IX="${k + 1}">${cell('X', inch(x))}${cell('Y', inch(h - y))}</Row>`);
      if (p.closed) rows.push(`<Row T="LineTo" IX="${p.pts.length + 1}">${cell('X', inch(p.pts[0]![0]))}${cell('Y', inch(h - p.pts[0]![1]))}</Row>`);
      return `<Section N="Geometry" IX="${ix}">${cell('NoFill', p.fill ? 0 : 1)}${cell('NoLine', p.stroke ? 0 : 1)}${cell('NoShow', 0)}${rows.join('')}</Section>`;
    })
    .join('');
}

function shapeXml(s: Shape, id: number, pageH: number): string {
  const r = shapeRender(s);
  const polys: { pts: Pt[]; closed: boolean; fill: boolean; stroke: boolean }[] = [];
  for (const p of r.paths) for (const f of flattenPath(p.d)) polys.push({ pts: f.pts, closed: f.closed, fill: p.fill !== 'none', stroke: p.stroke !== 'none' });
  const st = s.style;
  const f = s.font;
  const spec = stencilOf(s.stencil).text?.(s.w, s.h) ?? { x: 0, y: 0, w: s.w, h: s.h };
  const c = centerOf(s);
  const cells = [
    cell('PinX', inch(c.x)),
    cell('PinY', inch(pageH - c.y)),
    cell('Width', inch(s.w)),
    cell('Height', inch(s.h)),
    cell('LocPinX', inch(s.w / 2), 'Width*0.5'),
    cell('LocPinY', inch(s.h / 2), 'Height*0.5'),
    cell('Angle', (-s.rot * Math.PI) / 180),
    ...(s.flipH ? [cell('FlipX', 1)] : []),
    ...(s.flipV ? [cell('FlipY', 1)] : []),
    cell('FillForegnd', hex(st.fill === 'none' ? '#FFFFFF' : st.fill, '#FFFFFF')),
    cell('FillPattern', st.fill === 'none' ? 0 : 1),
    cell('LineColor', hex(st.stroke)),
    cell('LinePattern', st.stroke === 'none' ? 0 : PATTERN[st.dash]),
    cell('LineWeight', inch(st.strokeWidth)),
    cell('ShdwPattern', st.shadow ? 1 : 0),
    cell('TxtWidth', inch(Math.max(1, spec.w))),
    cell('TxtHeight', inch(Math.max(1, spec.h))),
    cell('TxtPinX', inch(spec.x + spec.w / 2)),
    cell('TxtPinY', inch(s.h - (spec.y + spec.h / 2))),
    cell('TxtLocPinX', inch(Math.max(1, spec.w) / 2)),
    cell('TxtLocPinY', inch(Math.max(1, spec.h) / 2)),
    cell('VerticalAlign', f.valign === 'top' ? 0 : f.valign === 'middle' ? 1 : 2),
  ];
  const style = (f.bold ? 1 : 0) | (f.italic ? 2 : 0) | (f.underline ? 4 : 0);
  const text = s.text
    ? `<Section N="Character" IX="0"><Row IX="0">${cell('Size', inch(f.size))}${cell('Color', hex(f.color))}${cell('Style', style)}</Row></Section><Section N="Paragraph" IX="0"><Row IX="0">${cell('HorzAlign', f.align === 'left' ? 0 : f.align === 'center' ? 1 : 2)}</Row></Section><Text>${escXml(s.text)}</Text>`
    : '';
  // the stencil id lets Nova Diagram recognise its own shapes when the file comes back
  const user = `<Section N="User"><Row N="NovaStencil">${cell('Value', s.stencil)}</Row></Section>`;
  return `<Shape ID="${id}" NameU="Sheet.${id}" Name="Sheet.${id}" Type="Shape">${cells.join('')}${user}${geometryXml(polys, s.h)}${text}</Shape>`;
}

function connectorXml(c: Connector, id: number, page: Page): string {
  const r = connectorRender(c, page);
  const pts = r.route.points;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(1, Math.max(...xs) - x0);
  const h = Math.max(1, Math.max(...ys) - y0);
  const local: Pt[] = pts.map((p) => [p.x - x0, p.y - y0]);
  const arrow = (a: string) => (a === 'none' ? 0 : 13);
  const cells = [
    cell('PinX', inch(x0 + w / 2)),
    cell('PinY', inch(page.height - (y0 + h / 2))),
    cell('Width', inch(w)),
    cell('Height', inch(h)),
    cell('LocPinX', inch(w / 2), 'Width*0.5'),
    cell('LocPinY', inch(h / 2), 'Height*0.5'),
    cell('LineColor', hex(c.stroke)),
    cell('LinePattern', PATTERN[c.dash]),
    cell('LineWeight', inch(c.strokeWidth)),
    cell('FillPattern', 0),
    cell('BeginArrow', arrow(c.startArrow)),
    cell('EndArrow', arrow(c.endArrow)),
  ];
  const f = c.font;
  const text = c.text
    ? `<Section N="Character" IX="0"><Row IX="0">${cell('Size', inch(f.size))}${cell('Color', hex(f.color))}${cell('Style', 0)}</Row></Section><Text>${escXml(c.text)}</Text>`
    : '';
  const user = `<Section N="User"><Row N="NovaConnector">${cell('Value', c.routing)}</Row></Section>`;
  return `<Shape ID="${id}" NameU="Connector.${id}" Name="Connector.${id}" Type="Shape">${cells.join('')}${user}${geometryXml([{ pts: local, closed: false, fill: false, stroke: true }], h)}${text}</Shape>`;
}

/** A picture that Visio can hold as is: its format, size and bytes. Visio takes PNG, JPEG and GIF; SVG and WebP cannot be put in a drawing here. */
export interface PictureInfo {
  ext: 'png' | 'jpeg' | 'gif';
  w: number;
  h: number;
  data: Uint8Array;
}

export function pictureInfo(src: string): PictureInfo | null {
  const m = /^data:image\/(png|jpeg|gif);base64,([A-Za-z0-9+/=]+)$/.exec(src);
  if (!m) return null;
  let bin: string;
  try {
    bin = atob(m[2]!);
  } catch {
    return null;
  }
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  const u16 = (i: number) => (data[i]! << 8) | data[i + 1]!;
  const le16 = (i: number) => data[i]! | (data[i + 1]! << 8);
  let w = 0;
  let h = 0;
  if (m[1] === 'png') {
    if (data.length < 24) return null;
    w = ((data[16]! << 24) | (data[17]! << 16) | (data[18]! << 8) | data[19]!) >>> 0;
    h = ((data[20]! << 24) | (data[21]! << 16) | (data[22]! << 8) | data[23]!) >>> 0;
  } else if (m[1] === 'gif') {
    if (data.length < 10) return null;
    w = le16(6);
    h = le16(8);
  } else {
    // JPEG: the first start-of-frame marker holds the size
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) {
        i++;
        continue;
      }
      const mk = data[i + 1]!;
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
        h = u16(i + 5);
        w = u16(i + 7);
        break;
      }
      i += 2 + u16(i + 2);
    }
  }
  return w > 0 && h > 0 ? { ext: m[1] as PictureInfo['ext'], w, h, data } : null;
}

/** How many pictures of the diagram cannot go to Visio (not PNG, JPEG or GIF): their shapes are exported without the picture. */
export function vsdxPicturesLost(d: Diagram): number {
  let n = 0;
  for (const p of d.pages) for (const s of p.shapes) if (s.image && !pictureInfo(s.image.src)) n++;
  return n;
}

/**
 * The picture of a shape as a Visio picture shape: it is drawn under the shape (which keeps the text and the Nova data). `contain` and
 * `cover` are made with the picture's own size and offset cells; `stretch` fills the box.
 */
function pictureXml(s: Shape, id: number, pageH: number, rel: string, info: PictureInfo): string {
  const fit = s.image!.fit;
  const k = fit === 'contain' ? Math.min(s.w / info.w, s.h / info.h) : fit === 'cover' ? Math.max(s.w / info.w, s.h / info.h) : 0;
  // the box of the picture itself (contain shrinks it; stretch and cover fill the shape)
  const w = fit === 'contain' ? info.w * k : s.w;
  const h = fit === 'contain' ? info.h * k : s.h;
  const c = centerOf(s);
  const cells = [
    cell('PinX', inch(c.x)),
    cell('PinY', inch(pageH - c.y)),
    cell('Width', inch(w)),
    cell('Height', inch(h)),
    cell('LocPinX', inch(w / 2), 'Width*0.5'),
    cell('LocPinY', inch(h / 2), 'Height*0.5'),
    cell('Angle', (-s.rot * Math.PI) / 180),
    ...(s.flipH ? [cell('FlipX', 1)] : []),
    ...(s.flipV ? [cell('FlipY', 1)] : []),
    // the picture inside the shape: the whole of it, or (cover) bigger than the shape and centred, which Visio clips
    ...(fit === 'cover' ? [cell('ImgOffsetX', inch((s.w - info.w * k) / 2)), cell('ImgOffsetY', inch((s.h - info.h * k) / 2)), cell('ImgWidth', inch(info.w * k)), cell('ImgHeight', inch(info.h * k))] : [cell('ImgOffsetX', 0), cell('ImgOffsetY', 0), cell('ImgWidth', inch(w), 'Width*1'), cell('ImgHeight', inch(h), 'Height*1')]),
  ];
  // the outline of the picture, which is what Visio selects and what the picture is drawn in
  const geometry = '<Section N="Geometry" IX="0"><Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row><Row T="RelLineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="0"/></Row><Row T="RelLineTo" IX="3"><Cell N="X" V="1"/><Cell N="Y" V="1"/></Row><Row T="RelLineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="1"/></Row><Row T="RelLineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row></Section>';
  const compression = info.ext === 'png' ? 'PNG' : info.ext === 'jpeg' ? 'JPEG' : 'GIF';
  const user = `<Section N="User"><Row N="NovaImagePart">${cell('Value', s.id)}</Row></Section>`;
  return `<Shape ID="${id}" NameU="Picture.${id}" Name="Picture.${id}" Type="Foreign">${cells.join('')}${geometry}${user}<ForeignData ForeignType="Bitmap" CompressionType="${compression}"><Rel r:id="${rel}"/></ForeignData></Shape>`;
}

const HEAD = '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n';

/** The date as Visio writes it: UTC, no «Z», no milliseconds. */
const visioDate = (iso: string): string => new Date(iso).toISOString().replace(/\.\d+Z$/, '');

/**
 * The comments of the drawing as Visio keeps them (`visio/comments.xml`): a list of people and a flat list of comments, each on a page and, if it is
 * about a shape, on that shape. Visio has **no replies and no «resolved»**: a conversation is written as one comment after another on the same
 * shape (in order) and reads back as a conversation.
 */
function commentsXml(d: Diagram, sheetIds: Map<string, number>[]): string {
  const people: string[] = [];
  const initialsOf = new Map<string, string>();
  const entries: string[] = [];
  let cid = 0;
  d.pages.forEach((page, pi) => {
    for (const t of page.threads ?? []) {
      let shapeAttr = '';
      if (t.shape) {
        const sid = sheetIds[pi]?.get(t.shape);
        if (sid === undefined) continue; // the shape is not in the file (a layer that does not print)
        shapeAttr = ` ShapeID="${sid}"`;
      }
      for (const m of t.messages) {
        if (!people.includes(m.author)) people.push(m.author);
        if (m.initials) initialsOf.set(m.author, m.initials);
        entries.push(`<CommentEntry AuthorID="${people.indexOf(m.author) + 1}" PageID="${pi}"${shapeAttr} Date="${visioDate(m.date)}" EditDate="${visioDate(m.edited ?? m.date)}" CommentID="${++cid}" AutoCommentType="0">${escXml(m.text)}</CommentEntry>`);
      }
    }
  });
  if (!entries.length) return '';
  const authors = people.map((a, i) => `<AuthorEntry Name="${escXml(a)}" Initials="${escXml(initialsOf.get(a) ?? initialsFor(a))}" ID="${i + 1}"/>`).join('');
  return `${HEAD}<Comments ShowCommentTags="1" xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve"><AuthorList>${authors}</AuthorList><CommentList>${entries.join('')}</CommentList></Comments>`;
}

const initialsFor = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 3).map((w) => [...w][0]!.toUpperCase()).join('') || 'A';

export async function exportVsdx(d: Diagram): Promise<Uint8Array> {
  const zip = new JSZip();
  const n = d.pages.length;
  const mediaExts = new Set<PictureInfo['ext']>();
  let mediaCount = 0;
  let hasComments = false;
  // the types are written last, when it is known which picture formats the drawing uses
  const typesFor = () =>
    `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...mediaExts].map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('')}<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/><Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/><Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>${hasComments ? '<Override PartName="/visio/comments.xml" ContentType="application/vnd.ms-visio.comments+xml"/>' : ''}${d.pages.map((_, i) => `<Override PartName="/visio/pages/page${i + 1}.xml" ContentType="application/vnd.ms-visio.page+xml"/>`).join('')}</Types>`;
  zip.file('_rels/.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/></Relationships>`);
  zip.file('visio/document.xml', `${HEAD}<VisioDocument xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve"><DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0"/><Colors/><FaceNames/><StyleSheets><StyleSheet ID="0" NameU="No Style" Name="No Style"><Cell N="LineWeight" V="0.01041666666666667"/><Cell N="LineColor" V="0"/><Cell N="LinePattern" V="1"/><Cell N="FillForegnd" V="1"/><Cell N="FillPattern" V="1"/></StyleSheet></StyleSheets></VisioDocument>`);
  zip.file('visio/_rels/document.xml.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/><Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/windows" Target="windows.xml"/></Relationships>`);
  // Visio refuses a file without its window part ("faltan algunas partes"), even an empty drawing
  zip.file('visio/windows.xml', `${HEAD}<Windows ClientWidth="1200" ClientHeight="800" xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve"><Window ID="0" WindowType="Drawing" WindowState="1073741824" WindowLeft="0" WindowTop="0" WindowWidth="1200" WindowHeight="800" ContainerType="Page" Page="0" ViewScale="-1"><ShowRulers>1</ShowRulers><ShowGrid>1</ShowGrid><ShowPageBreaks>0</ShowPageBreaks><ShowGuides>1</ShowGuides><ShowConnectionPoints>1</ShowConnectionPoints></Window></Windows>`);
  zip.file(
    'visio/pages/pages.xml',
    `${HEAD}<Pages xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">${d.pages
      .map((p, i) => `<Page ID="${i}" NameU="${escXml(p.name)}" Name="${escXml(p.name)}"><PageSheet>${cell('PageWidth', inch(p.width))}${cell('PageHeight', inch(p.height))}${cell('PageScale', 1)}${cell('DrawingScale', 1)}</PageSheet><Rel r:id="rId${i + 1}"/></Page>`)
      .join('')}</Pages>`,
  );
  zip.file('visio/pages/_rels/pages.xml.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${d.pages.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page${i + 1}.xml"/>`).join('')}</Relationships>`);
  /** Visio's id of each shape, by page: the comments point at them. */
  const sheetIds: Map<string, number>[] = [];
  d.pages.forEach((full, i) => {
    const p = printablePage(full);
    let id = 0;
    const ids = new Map<string, number>();
    sheetIds[i] = ids;
    const rels: string[] = [];
    // a picture goes under its shape, so the shape's text and outline stay on top of it
    const shapes = p.shapes.flatMap((s) => {
      const info = s.image ? pictureInfo(s.image.src) : null;
      if (!info) {
        ids.set(s.id, ++id);
        return [shapeXml(s, id, p.height)];
      }
      const name = `image${++mediaCount}.${info.ext}`;
      zip.file(`visio/media/${name}`, info.data);
      mediaExts.add(info.ext);
      rels.push(`<Relationship Id="rId${rels.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${name}"/>`);
      const pic = pictureXml(s, ++id, p.height, `rId${rels.length}`, info);
      ids.set(s.id, ++id);
      return [pic, shapeXml(s, id, p.height)];
    });
    const conns = p.connectors.map((c) => connectorXml(c, ++id, p));
    if (rels.length) zip.file(`visio/pages/_rels/page${i + 1}.xml.rels`, `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
    zip.file(`visio/pages/page${i + 1}.xml`, `${HEAD}<PageContents xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve"><Shapes>${shapes.join('')}${conns.join('')}</Shapes></PageContents>`);
  });
  void n;
  const comments = commentsXml(d, sheetIds);
  if (comments) {
    // Visio keeps the comments in one part for the whole drawing, linked from the document
    zip.file('visio/comments.xml', comments);
    zip.file('visio/_rels/document.xml.rels', (await zip.file('visio/_rels/document.xml.rels')!.async('string')).replace('</Relationships>', '<Relationship Id="rId3" Type="http://schemas.microsoft.com/visio/2010/relationships/comments" Target="comments.xml"/></Relationships>'));
    hasComments = true;
  }
  zip.file('[Content_Types].xml', typesFor());
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.ms-visio.drawing' });
}

