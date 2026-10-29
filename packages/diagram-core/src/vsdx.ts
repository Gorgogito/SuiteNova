import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { centerOf, rotatePoint } from './geometry';
import { defaultFont, defaultStyle, newDiagram, newId, type Connector, type Diagram, type End, type Font, type Outline, type Page, type Shape, type Style } from './model';
import { connectorRender, shapeRender } from './render';
import { printablePage } from './layers';
import { hasStencil, stencilOf } from './stencils';
import { escXml } from './svg';

/*
 * Reading and writing Visio drawings (.vsdx, the Open Packaging format). Shapes are written as free-form polygons with
 * the text, colours and line styles; connectors are written as plain polylines (they are not glued in Visio). When
 * reading, the geometry of shapes and of the masters they come from is converted to outlines. Nothing here has been
 * opened in Microsoft Visio, see docs/LIMITACIONES.md.
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

const HEAD = '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n';

export async function exportVsdx(d: Diagram): Promise<Uint8Array> {
  const zip = new JSZip();
  const n = d.pages.length;
  zip.file(
    '[Content_Types].xml',
    `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/><Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>${d.pages.map((_, i) => `<Override PartName="/visio/pages/page${i + 1}.xml" ContentType="application/vnd.ms-visio.page+xml"/>`).join('')}</Types>`,
  );
  zip.file('_rels/.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/></Relationships>`);
  zip.file('visio/document.xml', `${HEAD}<VisioDocument xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve"><DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0"/><Colors/><FaceNames/><StyleSheets><StyleSheet ID="0" NameU="No Style" Name="No Style"><Cell N="LineWeight" V="0.01041666666666667"/><Cell N="LineColor" V="0"/><Cell N="LinePattern" V="1"/><Cell N="FillForegnd" V="1"/><Cell N="FillPattern" V="1"/></StyleSheet></StyleSheets></VisioDocument>`);
  zip.file('visio/_rels/document.xml.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/></Relationships>`);
  zip.file(
    'visio/pages/pages.xml',
    `${HEAD}<Pages xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">${d.pages
      .map((p, i) => `<Page ID="${i}" NameU="${escXml(p.name)}" Name="${escXml(p.name)}"><PageSheet>${cell('PageWidth', inch(p.width))}${cell('PageHeight', inch(p.height))}${cell('PageScale', 1)}${cell('DrawingScale', 1)}</PageSheet><Rel r:id="rId${i + 1}"/></Page>`)
      .join('')}</Pages>`,
  );
  zip.file('visio/pages/_rels/pages.xml.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${d.pages.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page${i + 1}.xml"/>`).join('')}</Relationships>`);
  d.pages.forEach((full, i) => {
    const p = printablePage(full);
    let id = 0;
    const shapes = p.shapes.map((s) => shapeXml(s, ++id, p.height));
    const conns = p.connectors.map((c) => connectorXml(c, ++id, p));
    zip.file(`visio/pages/page${i + 1}.xml`, `${HEAD}<PageContents xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve"><Shapes>${shapes.join('')}${conns.join('')}</Shapes></PageContents>`);
  });
  void n;
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.ms-visio.drawing' });
}

// ------------------------------------------------------------ import

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) => ['Shape', 'Section', 'Row', 'Cell', 'Page', 'Master', 'Relationship', 'Connect', 'Rel'].includes(name),
});

type Node = any;
type Cells = Map<string, string>;

function cellsOf(node: Node): Cells {
  const m: Cells = new Map();
  for (const c of node?.Cell ?? []) if (typeof c['@_N'] === 'string' && c['@_V'] !== undefined) m.set(c['@_N'], String(c['@_V']));
  return m;
}
const n = (m: Cells, k: string, d = 0): number => {
  const v = m.get(k);
  if (v === undefined) return d;
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};

const INDEX_COLORS = ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#800000', '#008000', '#000080', '#808000', '#800080', '#008080', '#C0C0C0', '#808080', '#9999FF', '#993366', '#FFFFCC', '#CCFFFF', '#660066', '#FF8080', '#0066CC', '#CCCCFF'];
function colorOf(v: string | undefined, d: string): string {
  if (!v) return d;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^\d+$/.test(v) && Number(v) < INDEX_COLORS.length) return INDEX_COLORS[Number(v)]!.toLowerCase();
  return d;
}

function textOf(node: Node): string {
  const t = node?.Text;
  if (t === undefined || t === null) return '';
  const first = Array.isArray(t) ? t[0] : t;
  if (typeof first === 'string') return first.replace(/\r\n?/g, '\n');
  const parts = first?.['#text'];
  const joined = Array.isArray(parts) ? parts.join('') : (parts ?? '');
  return String(joined).replace(/\r\n?/g, '\n');
}

function sectionRow(node: Node, name: string): Cells {
  const sec = (node?.Section ?? []).find((s: Node) => s['@_N'] === name);
  const row = sec?.Row?.[0];
  return row ? cellsOf(row) : new Map();
}

const userRow = (node: Node, name: string): Node | undefined => (node.Section ?? []).find((x: Node) => x['@_N'] === 'User')?.Row?.find((r: Node) => r['@_N'] === name);

interface Geo {
  outlines: Outline[];
  approximated: boolean;
}

/** Visio geometry sections to outlines in 0–1 coordinates of the shape box. */
function geometryOf(node: Node, W: number, H: number): Geo {
  const outlines: Outline[] = [];
  let approximated = false;
  const nx = (x: number) => (W > 0 ? x / W : 0);
  const ny = (y: number) => (H > 0 ? 1 - y / H : 0);
  for (const sec of node?.Section ?? []) {
    if (sec['@_N'] !== 'Geometry') continue;
    const sc = cellsOf(sec);
    if (n(sc, 'NoShow') === 1) continue;
    const fill = n(sc, 'NoFill') !== 1;
    const stroke = n(sc, 'NoLine') !== 1;
    let cur: Pt[] = [];
    let x = 0;
    let y = 0;
    const flush = () => {
      if (cur.length > 1) {
        const closed = cur.length > 2 && Math.hypot(cur[0]![0] - cur[cur.length - 1]![0], cur[0]![1] - cur[cur.length - 1]![1]) < 1e-6;
        outlines.push({ pts: (closed ? cur.slice(0, -1) : cur).map(([a, b]) => [nx(a), ny(b)] as [number, number]), closed: closed || fill, fill, stroke });
      }
      cur = [];
    };
    const line = (px: number, py: number) => {
      x = px;
      y = py;
      cur.push([x, y]);
    };
    const quad = (cx: number, cy: number, ex: number, ey: number) => {
      const sx = x;
      const sy = y;
      for (let k = 1; k <= 12; k++) {
        const t = k / 12;
        const u = 1 - t;
        cur.push([u * u * sx + 2 * u * t * cx + t * t * ex, u * u * sy + 2 * u * t * cy + t * t * ey]);
      }
      x = ex;
      y = ey;
    };
    const cubic = (x1: number, y1: number, x2: number, y2: number, ex: number, ey: number) => {
      const sx = x;
      const sy = y;
      for (let k = 1; k <= 14; k++) {
        const t = k / 14;
        const u = 1 - t;
        cur.push([u * u * u * sx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex, u * u * u * sy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey]);
      }
      x = ex;
      y = ey;
    };
    for (const row of sec.Row ?? []) {
      const t = row['@_T'];
      const c = cellsOf(row);
      const X = n(c, 'X');
      const Y = n(c, 'Y');
      switch (t) {
        case 'MoveTo': flush(); line(X, Y); break;
        case 'RelMoveTo': flush(); line(X * W, Y * H); break;
        case 'LineTo': line(X, Y); break;
        case 'RelLineTo': line(X * W, Y * H); break;
        case 'ArcTo': {
          // A is the distance from the chord to the arc: a parabola with that height is a good stand-in
          const bulge = n(c, 'A');
          const dx = X - x;
          const dy = Y - y;
          const len = Math.hypot(dx, dy) || 1;
          quad((x + X) / 2 - (dy / len) * bulge * 2, (y + Y) / 2 + (dx / len) * bulge * 2, X, Y);
          approximated = true;
          break;
        }
        case 'EllipticalArcTo': quad(n(c, 'A'), n(c, 'B'), X, Y); approximated = true; break;
        case 'QuadBezTo': quad(n(c, 'A'), n(c, 'B'), X, Y); break;
        case 'CubBezTo': cubic(n(c, 'A'), n(c, 'B'), n(c, 'C'), n(c, 'D'), X, Y); break;
        case 'RelCubBezTo': cubic(n(c, 'A') * W, n(c, 'B') * H, n(c, 'C') * W, n(c, 'D') * H, X * W, Y * H); break;
        case 'RelQuadBezTo': quad(n(c, 'A') * W, n(c, 'B') * H, X * W, Y * H); break;
        case 'Ellipse': {
          flush();
          const ax = n(c, 'A') - X;
          const ay = n(c, 'B') - Y;
          const rx = Math.hypot(ax, ay);
          const ry = Math.hypot(n(c, 'C') - X, n(c, 'D') - Y);
          const rot = Math.atan2(ay, ax);
          for (let k = 0; k < 36; k++) {
            const a = (k * 2 * Math.PI) / 36;
            cur.push([X + rx * Math.cos(a) * Math.cos(rot) - ry * Math.sin(a) * Math.sin(rot), Y + rx * Math.cos(a) * Math.sin(rot) + ry * Math.sin(a) * Math.cos(rot)]);
          }
          cur.push(cur[0]!);
          flush();
          break;
        }
        case 'InfiniteLine': break;
        default:
          // NURBS, splines, polylines with formulas: keep the end point
          if (c.has('X') && c.has('Y')) {
            line(X, Y);
            approximated = true;
          }
      }
    }
    flush();
  }
  return { outlines, approximated };
}

/** A rectangle or an ellipse drawn as geometry is turned back into the stencil of the same name. */
function recogniseStencil(o: Outline[]): string | null {
  if (o.length !== 1 || !o[0]!.fill) return null;
  const pts = o[0]!.pts;
  const eps = 0.02;
  if (pts.length === 4 && pts.every(([x, y]) => (x < eps || x > 1 - eps) && (y < eps || y > 1 - eps))) return 'rect';
  if (pts.length >= 24 && pts.every(([x, y]) => Math.abs(Math.hypot((x - 0.5) / 0.5, (y - 0.5) / 0.5) - 1) < 0.03)) return 'ellipse';
  return null;
}

const resolvePath = (base: string, target: string): string => {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
};

async function relsOf(zip: JSZip, part: string): Promise<Map<string, { type: string; target: string }>> {
  const dir = part.split('/').slice(0, -1).join('/');
  const file = part.split('/').pop()!;
  const raw = await zip.file(`${dir ? dir + '/' : ''}_rels/${file}.rels`)?.async('string');
  const map = new Map<string, { type: string; target: string }>();
  if (!raw) return map;
  for (const r of parser.parse(raw)?.Relationships?.Relationship ?? []) map.set(r['@_Id'], { type: String(r['@_Type']), target: resolvePath(part, String(r['@_Target'])) });
  return map;
}

export interface VsdxResult {
  diagram: Diagram;
  warnings: string[];
}

export async function importVsdx(data: Uint8Array): Promise<VsdxResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error('El archivo no es un .vsdx válido (los .vsd antiguos no se pueden abrir: guárdalo como .vsdx en Visio).');
  }
  if (!zip.file('visio/document.xml')) throw new Error('El archivo no es un dibujo de Visio (.vsdx).');
  const warnings: string[] = [];
  const docRels = await relsOf(zip, 'visio/document.xml');
  const pagesPart = [...docRels.values()].find((r) => r.type.endsWith('/pages'))?.target ?? 'visio/pages/pages.xml';
  const pagesXml = await zip.file(pagesPart)?.async('string');
  if (!pagesXml) throw new Error('El dibujo no tiene páginas.');
  const pageRels = await relsOf(zip, pagesPart);

  // masters (the shapes that page shapes are instances of)
  const masters = new Map<string, Node>();
  const mastersPart = [...docRels.values()].find((r) => r.type.endsWith('/masters'))?.target;
  if (mastersPart) {
    const mx = await zip.file(mastersPart)?.async('string');
    if (mx) {
      const mrels = await relsOf(zip, mastersPart);
      for (const m of parser.parse(mx)?.Masters?.Master ?? []) {
        const rid = m?.Rel?.[0]?.['@_id'];
        const target = rid ? mrels.get(rid)?.target : undefined;
        const body = target ? await zip.file(target)?.async('string') : undefined;
        if (body) masters.set(String(m['@_ID']), parser.parse(body)?.MasterContents?.Shapes?.Shape?.[0]);
      }
    }
  }

  const diagram = newDiagram('Dibujo importado');
  diagram.pages = [];
  let skipped = 0;
  let approximated = 0;
  let backgrounds = 0;

  for (const pg of parser.parse(pagesXml)?.Pages?.Page ?? []) {
    if (pg['@_Background'] === '1') {
      backgrounds++;
      continue;
    }
    const sheet = cellsOf(pg.PageSheet);
    const W = n(sheet, 'PageWidth', 11.69);
    const H = n(sheet, 'PageHeight', 8.27);
    const rid = pg?.Rel?.[0]?.['@_id'];
    const part = rid ? pageRels.get(rid)?.target : undefined;
    const xml = part ? await zip.file(part)?.async('string') : undefined;
    const page: Page = { id: newId('pg'), name: String(pg['@_Name'] ?? pg['@_NameU'] ?? `Página ${diagram.pages.length + 1}`), width: Math.round(W * PX), height: Math.round(H * PX), grid: 8, background: '#ffffff', shapes: [], connectors: [] };
    diagram.pages.push(page);
    if (!xml) continue;
    const contents = parser.parse(xml)?.PageContents;
    const sheetToShape = new Map<string, string>();
    const pending: { id: string; node: Node; cells: Cells; frame: Frame; text: string }[] = [];

    interface Frame {
      left: number;
      bottom: number;
      sx: number;
      sy: number;
    }

    const visit = (node: Node, frame: Frame, master: Node | null) => {
      const own = cellsOf(node);
      const mnode: Node | null = node['@_Master'] !== undefined ? masters.get(String(node['@_Master'])) ?? master : master;
      const isInstance = node['@_Master'] !== undefined && mnode;
      const base = isInstance ? cellsOf(mnode) : new Map<string, string>();
      const cells: Cells = new Map([...base, ...own]);
      const w = n(cells, 'Width');
      const h = n(cells, 'Height');
      const pinX = n(cells, 'PinX');
      const pinY = n(cells, 'PinY');
      const locX = n(cells, 'LocPinX', w / 2);
      const locY = n(cells, 'LocPinY', h / 2);
      const left = frame.left + (pinX - locX) * frame.sx;
      const bottom = frame.bottom + (pinY - locY) * frame.sy;
      const geoNode = (node.Section ?? []).some((s: Node) => s['@_N'] === 'Geometry') ? node : isInstance ? mnode : node;
      const baseW = isInstance ? n(cellsOf(mnode), 'Width', w) : w;
      const baseH = isInstance ? n(cellsOf(mnode), 'Height', h) : h;
      const kids: Node[] = node.Shapes?.Shape ?? (isInstance ? mnode.Shapes?.Shape : undefined) ?? [];
      const isGroup = node['@_Type'] === 'Group' || kids.length > 0;
      const hasGeo = (geoNode?.Section ?? []).some((s: Node) => s['@_N'] === 'Geometry');
      if (isGroup) {
        const kframe: Frame = { left, bottom, sx: frame.sx * (isInstance && !node.Shapes ? w / (baseW || 1) : 1), sy: frame.sy * (isInstance && !node.Shapes ? h / (baseH || 1) : 1) };
        for (const k of kids) visit(k, kframe, null);
      }
      if (!hasGeo && !cells.has('BeginX')) {
        if (!isGroup && node['@_Type'] === 'Foreign') skipped++;
        else if (!isGroup && !textOf(node)) return;
        if (isGroup && !textOf(node)) return;
      }
      pending.push({ id: String(node['@_ID']), node: { ...node, __geo: geoNode, __bw: baseW, __bh: baseH }, cells, frame: { left, bottom, sx: frame.sx, sy: frame.sy }, text: textOf(node) || (isInstance ? textOf(mnode) : '') });
    };
    for (const s of contents?.Shapes?.Shape ?? []) visit(s, { left: 0, bottom: 0, sx: 1, sy: 1 }, null);

    const toX = (v: number) => Math.round(v * PX * 100) / 100;
    const toY = (v: number) => Math.round((H - v) * PX * 100) / 100;

    // first the shapes (so connectors can be glued to them), then the connectors
    for (const p of pending) {
      const c = p.cells;
      if (c.has('BeginX') || userRow(p.node, 'NovaConnector')) continue;
      const w = n(c, 'Width');
      const h = n(c, 'Height');
      const f = p.frame;
      const sw = w * f.sx;
      const sh = h * f.sy;
      if (sw <= 0 && sh <= 0 && !p.text) continue;
      const cx = f.left + sw / 2;
      const cy = f.bottom + sh / 2;
      const geo = geometryOf(p.node.__geo, p.node.__bw ?? w, p.node.__bh ?? h);
      if (geo.approximated) approximated++;
      const user = sectionRow({ Section: (p.node.Section ?? []).filter((s: Node) => s['@_N'] === 'User') }, 'User');
      void user;
      const novaStencil = (p.node.Section ?? []).find((s: Node) => s['@_N'] === 'User')?.Row?.find((r: Node) => r['@_N'] === 'NovaStencil');
      const stencilId = novaStencil ? String(cellsOf(novaStencil).get('Value') ?? '') : '';
      const recognised = stencilId && hasStencil(stencilId) ? stencilId : recogniseStencil(geo.outlines);
      const style: Style = {
        ...defaultStyle(),
        fill: n(c, 'FillPattern', 1) === 0 ? 'none' : colorOf(c.get('FillForegnd'), '#ffffff'),
        stroke: n(c, 'LinePattern', 1) === 0 ? 'none' : colorOf(c.get('LineColor'), '#000000'),
        strokeWidth: Math.max(0.5, n(c, 'LineWeight', 1 / 96) * PX),
        dash: ({ 2: 'dash', 3: 'dot', 4: 'dashdot' } as Record<number, Style['dash']>)[n(c, 'LinePattern', 1)] ?? 'solid',
        shadow: n(c, 'ShdwPattern', 0) > 0,
      };
      const ch = sectionRow(p.node, 'Character');
      const pa = sectionRow(p.node, 'Paragraph');
      const bits = n(ch, 'Style', 0);
      const font: Font = {
        ...defaultFont(),
        size: Math.max(6, Math.min(96, ch.has('Size') ? n(ch, 'Size') * PX : 10.67)),
        color: colorOf(ch.get('Color'), '#000000'),
        bold: !!(bits & 1),
        italic: !!(bits & 2),
        underline: !!(bits & 4),
        align: n(pa, 'HorzAlign', 1) === 0 ? 'left' : n(pa, 'HorzAlign', 1) === 2 ? 'right' : 'center',
        valign: n(c, 'VerticalAlign', 1) === 0 ? 'top' : n(c, 'VerticalAlign', 1) === 2 ? 'bottom' : 'middle',
      };
      const id = newId('s');
      sheetToShape.set(p.id, id);
      const shape: Shape = {
        id,
        stencil: recognised ?? 'rect',
        x: toX(cx - sw / 2),
        y: toY(cy + sh / 2),
        w: Math.max(1, Math.round(sw * PX * 100) / 100),
        h: Math.max(1, Math.round(sh * PX * 100) / 100),
        rot: (((-n(c, 'Angle') * 180) / Math.PI) % 360 + 360) % 360,
        text: p.text,
        style,
        font,
        locked: false,
        ...(!recognised && geo.outlines.length ? { geometry: geo.outlines } : {}),
      };
      if (!recognised && !geo.outlines.length) {
        // text-only or empty shapes
        shape.style = { ...style, fill: 'none', stroke: 'none' };
        shape.stencil = 'text';
      }
      page.shapes.push(shape);
    }

    // connections (glue)
    const glue = new Map<string, { begin?: string; end?: string }>();
    for (const cn of contents?.Connects?.Connect ?? []) {
      const g = glue.get(String(cn['@_FromSheet'])) ?? {};
      if (cn['@_FromCell'] === 'BeginX') g.begin = String(cn['@_ToSheet']);
      if (cn['@_FromCell'] === 'EndX') g.end = String(cn['@_ToSheet']);
      glue.set(String(cn['@_FromSheet']), g);
    }
    for (const p of pending) {
      const c = p.cells;
      const ours = userRow(p.node, 'NovaConnector');
      if (!ours && (!c.has('BeginX') || !c.has('EndX'))) continue;
      const g = glue.get(p.id);
      const own = ours ? geometryOf(p.node.__geo, p.node.__bw ?? 1, p.node.__bh ?? 1).outlines[0]?.pts : undefined;
      const at = (k: 0 | 1): End => {
        if (own && own.length) {
          const [nx, ny] = k === 0 ? own[0]! : own[own.length - 1]!;
          return { x: toX(p.frame.left + nx * n(c, 'Width') * p.frame.sx), y: toY(p.frame.bottom + (1 - ny) * n(c, 'Height') * p.frame.sy) };
        }
        return k === 0 ? { x: toX(n(c, 'BeginX')), y: toY(n(c, 'BeginY')) } : { x: toX(n(c, 'EndX')), y: toY(n(c, 'EndY')) };
      };
      const point = (xk: string, _yk: string): End => at(xk === 'BeginX' ? 0 : 1);
      const glued = (sheet: string | undefined, fallback: End): End => (sheet && sheetToShape.has(sheet) ? { shape: sheetToShape.get(sheet)!, port: 'auto' } : fallback);
      const geo = geometryOf(p.node.__geo, p.node.__bw ?? 1, p.node.__bh ?? 1);
      const bends = geo.outlines[0]?.pts.length ?? 2;
      const ch = sectionRow(p.node, 'Character');
      const arrow = (k: string) => (n(c, k, 0) > 0 ? 'arrow' : 'none');
      page.connectors.push({
        id: newId('c'),
        from: glued(g?.begin, point('BeginX', 'BeginY')),
        to: glued(g?.end, point('EndX', 'EndY')),
        routing: ours ? (cellsOf(ours).get('Value') as Connector['routing']) ?? 'straight' : bends > 2 ? 'elbow' : 'straight',
        stroke: colorOf(c.get('LineColor'), '#000000'),
        strokeWidth: Math.max(0.5, n(c, 'LineWeight', 1 / 96) * PX),
        dash: ({ 2: 'dash', 3: 'dot', 4: 'dashdot' } as Record<number, Connector['dash']>)[n(c, 'LinePattern', 1)] ?? 'solid',
        startArrow: arrow('BeginArrow'),
        endArrow: arrow('EndArrow'),
        text: p.text,
        font: { ...defaultFont(), size: ch.has('Size') ? Math.max(6, n(ch, 'Size') * PX) : 12 },
      });
    }
  }
  if (!diagram.pages.length) diagram.pages.push(newDiagram().pages[0]!);
  if (skipped) warnings.push(`${skipped} imagen(es) u objetos incrustados no se importaron.`);
  if (approximated) warnings.push(`${approximated} forma(s) con arcos o curvas especiales se aproximaron con segmentos.`);
  if (backgrounds) warnings.push(`${backgrounds} página(s) de fondo no se importaron.`);
  void rotatePoint;
  return { diagram, warnings };
}
