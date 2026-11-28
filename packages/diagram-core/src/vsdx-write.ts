import { containerParts, laneBoxes } from './container';
import { boundsOf, centerOf, rotatePoint, unionRects, type Rect } from './geometry';
import { layerIdOf, layersOf } from './layers';
import { isGlued, type Connector, type DataField, type Font, type Page, type Shape, type ShapeImage, type Style } from './model';
import { connectorRender, resolveText } from './render';
import { stencilOf, type PathDef } from './stencils';
import { escXml } from './svg';
import { NOVA, VISIO_ARROW, compartments } from './vsdx-nova';
import { mix } from './vsdx-theme';

/*
 * The shapes and connectors of one page as Visio writes them: groups with their parts tied to their size, connectors
 * glued to shapes and connection points (so that they follow them), shape data, hyperlinks, layers, and containers and
 * swimlanes with their members. A Nova shape that Visio cannot hold in one sheet (several colours, a picture, the
 * compartments of a class) is written as a group.
 */

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

// ------------------------------------------------------------ pictures

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

// ------------------------------------------------------------ cells

export const inch = (px: number): string => String(Math.round((px / PX) * 1e6) / 1e6);
const ratio = (v: number): string => String(Math.round(v * 1e12) / 1e12);
const hex = (c: string, d = '#000000'): string => {
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toUpperCase();
  return d;
};

/** Control characters are not allowed in XML. */
const clean = (s: string): string => s.replace(/\p{Cc}/gu, (c) => (c === '\n' || c === '\t' || c === '\r' ? c : ''));
/** An attribute cannot keep line breaks. */
export const attr = (s: string): string => escXml(clean(s).replace(/[\r\n\t]+/g, ' '));
export const cell = (n: string, v: string | number, f?: string, u?: string): string => `<Cell N="${n}" V="${attr(String(v))}"${u ? ` U="${u}"` : ''}${f ? ` F="${attr(f)}"` : ''}/>`;
const section = (name: string, rows: string[]): string => `<Section N="${name}">${rows.join('')}</Section>`;

const PATTERN = { solid: 1, dash: 2, dot: 3, dashdot: 4 } as const;

// ------------------------------------------------------------ sheets

interface Sheet {
  id: number;
  prefix: 'Sheet' | 'Picture' | 'Connector';
  type: 'Shape' | 'Group' | 'Foreign';
  cells: string[];
  sections: string[];
  /** Rows of the `User` section: name and value. */
  user: [string, string | number][];
  /** Inside of `<Text>`. */
  text?: string;
  foreign?: string;
  kids: Sheet[];
}

function sheetXml(s: Sheet): string {
  const user = s.user.length ? section('User', s.user.map(([n, v]) => `<Row N="${n}">${cell('Value', v, undefined, typeof v === 'string' ? 'STR' : undefined)}</Row>`)) : '';
  const text = s.text === undefined ? '' : `<Text>${s.text}</Text>`;
  const kids = s.kids.length ? `<Shapes>${s.kids.map(sheetXml).join('')}</Shapes>` : '';
  return `<Shape ID="${s.id}" NameU="${s.prefix}.${s.id}" Name="${s.prefix}.${s.id}" Type="${s.type}">${s.cells.join('')}${user}${s.sections.join('')}${text}${s.foreign ?? ''}${kids}</Shape>`;
}

/** Where the sheets of a list are placed: the page, or the group (`id`) whose box starts at (x, y). */
interface Frame {
  id?: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Position, size and turn of a box inside a frame; inside a group they follow the size of the group. */
function xform(box: Rect & { rot?: number; flipH?: boolean; flipV?: boolean }, f: Frame): string[] {
  const px = box.x + box.w / 2 - f.x;
  const py = f.y + f.h - (box.y + box.h / 2);
  const rot = box.rot ?? 0;
  const tied = (axis: 'Width' | 'Height', v: number) => (f.id === undefined ? undefined : `Sheet.${f.id}!${axis}*${ratio(v / Math.max(1e-6, axis === 'Width' ? f.w : f.h))}`);
  // a part that is turned within its group is only moved with it
  const upright = rot % 180 === 0;
  return [
    cell('PinX', inch(px), tied('Width', px)),
    cell('PinY', inch(py), tied('Height', py)),
    cell('Width', inch(box.w), upright ? tied('Width', box.w) : undefined),
    cell('Height', inch(box.h), upright ? tied('Height', box.h) : undefined),
    cell('LocPinX', inch(box.w / 2), 'Width*0.5'),
    cell('LocPinY', inch(box.h / 2), 'Height*0.5'),
    cell('Angle', (-rot * Math.PI) / 180),
    ...(box.flipH ? [cell('FlipX', 1)] : []),
    ...(box.flipV ? [cell('FlipY', 1)] : []),
  ];
}

// ------------------------------------------------------------ drawing

interface Outline_ {
  pts: Pt[];
  closed: boolean;
  fill: boolean;
  stroke: boolean;
}

/** What one Visio sheet can paint: one fill colour and one line. */
interface Paint {
  /** Null while it holds only lines. */
  color: string | null;
  main: boolean;
  width: number;
  dashed: boolean;
  outlines: Outline_[];
}

const lighter = (fill: string): string => (fill === 'none' ? 'none' : mix(hex(fill, '#ffffff'), '#ffffff', 0.55));

function boundsOfPts(pts: Pt[]): [number, number, number, number] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Would some filled outline of one cover part of one of the other? (Visio leaves a hole there.) */
function overlap(a: Outline_[], b: Outline_[]): boolean {
  return a.some((p) => {
    if (!p.fill) return false;
    const [x0, y0, x1, y1] = boundsOfPts(p.pts);
    return b.some((q) => {
      if (!q.fill) return false;
      const [u0, v0, u1, v1] = boundsOfPts(q.pts);
      return Math.min(x1, u1) - Math.max(x0, u0) > 0.5 && Math.min(y1, v1) - Math.max(y0, v0) > 0.5;
    });
  });
}

/** The drawing of a shape split into what each sheet can hold, back to front. */
function paintsOf(s: Shape): Paint[] {
  const fill = s.style.fill;
  if (s.geometry?.length) {
    // free-form outlines are one sheet: where they overlap there is a hole, as on screen
    const outlines = s.geometry.filter((o) => o.pts.length > 1).map((o) => ({ pts: o.pts.map(([x, y]): Pt => [x * s.w, y * s.h]), closed: o.closed, fill: o.fill, stroke: o.stroke }));
    return [{ color: fill, main: true, width: 1, dashed: false, outlines }];
  }
  // a pool is only its frame here: each lane is a container of its own
  const defs: PathDef[] = s.container?.kind === 'pool' ? stencilOf('pool').paths(s.w, s.h) : s.container ? containerParts(s).paths : stencilOf(s.stencil).paths(s.w, s.h);
  const out: Paint[] = [];
  for (const def of defs) {
    const outlines = flattenPath(def.d).filter((p) => p.pts.length > 1).map((p) => ({ pts: p.pts, closed: p.closed, fill: def.fill !== 'none', stroke: def.stroke !== false }));
    if (!outlines.length) continue;
    const color = def.fill === 'main' ? fill : def.fill === 'stroke' ? (s.style.stroke === 'none' ? fill : s.style.stroke) : def.fill === 'light' ? lighter(fill) : null;
    const width = def.width ?? 1;
    const dashed = !!def.dashed;
    const last = out[out.length - 1];
    const same = !!last && last.width === width && last.dashed === dashed;
    if (same && (color === null || ((last.color === null || last.color === color) && !overlap(last.outlines, outlines)))) {
      last.color ??= color;
      last.main ||= def.fill === 'main';
      last.outlines.push(...outlines);
    } else out.push({ color, main: def.fill === 'main', width, dashed, outlines });
  }
  return out;
}

/** Outlines in coordinates relative to the box, so that they stretch with the shape. */
function geometryXml(outlines: Outline_[], w: number, h: number): string {
  return outlines
    .map((p, ix) => {
      const pts = p.closed ? [...p.pts, p.pts[0]!] : p.pts;
      const rows = pts.map(([x, y], k) => `<Row T="${k === 0 ? 'RelMoveTo' : 'RelLineTo'}" IX="${k + 1}">${cell('X', ratio(x / Math.max(1e-6, w)))}${cell('Y', ratio(1 - y / Math.max(1e-6, h)))}</Row>`);
      return `<Section N="Geometry" IX="${ix}">${cell('NoFill', p.fill ? 0 : 1)}${cell('NoLine', p.stroke ? 0 : 1)}${cell('NoShow', 0)}${rows.join('')}</Section>`;
    })
    .join('');
}

function paintCells(color: string, st: Style, width: number, dashed: boolean): string[] {
  return [
    cell('FillForegnd', hex(color === 'none' ? '#FFFFFF' : color, '#FFFFFF')),
    cell('FillPattern', color === 'none' ? 0 : 1),
    cell('LineColor', hex(st.stroke)),
    cell('LinePattern', st.stroke === 'none' ? 0 : dashed ? PATTERN.dash : PATTERN[st.dash]),
    cell('LineWeight', inch(st.strokeWidth * width)),
    cell('ShdwPattern', st.shadow ? 1 : 0),
  ];
}

// ------------------------------------------------------------ data, links, text

/** The names Visio gives the rows of the shape data: letters, digits and `_`. */
function dataRows(data: DataField[]): { row: string; field: DataField }[] {
  const used = new Set<string>();
  return data.map((field, i) => {
    let row = field.name.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 60);
    if (!/^[A-Za-z]/.test(row)) row = `Row_${i + 1}`;
    const base = row;
    for (let n = 2; used.has(row.toLowerCase()); n++) row = `${base}_${n}`;
    used.add(row.toLowerCase());
    return { row, field };
  });
}

function dataXml(data: DataField[]): string {
  return section(
    'Property',
    dataRows(data).map(({ row, field }, i) => {
      const v = field.value;
      let value = cell('Value', v, undefined, 'STR');
      let type = 0;
      if (field.type === 'number' && (v === '' || Number.isFinite(Number(v)))) {
        type = 2;
        value = v === '' ? cell('Value', '', 'No Formula') : cell('Value', Number(v));
      } else if (field.type === 'bool' && (v === '' || v === 'Sí' || v === 'No')) {
        type = 3;
        value = v === '' ? cell('Value', '', 'No Formula') : cell('Value', v === 'Sí' ? 1 : 0, undefined, 'BOOL');
      } else if (field.type === 'date' && (v === '' || /^\d{4}-\d\d-\d\d$/.test(v))) {
        type = 5;
        value = v === '' ? cell('Value', '', 'No Formula') : cell('Value', `${v}T00:00:00`, undefined, 'DATE');
      }
      return `<Row N="${row}">${value}${cell('Label', field.name, undefined, 'STR')}${cell('Type', type)}${cell('SortKey', String(i).padStart(3, '0'), undefined, 'STR')}${cell('Invisible', 0)}</Row>`;
    }),
  );
}

/**
 * The text of a sheet with its format. Where it shows a datum (`{{name}}`) of text or number, Visio gets a field tied
 * to that datum, so that it changes with it there too. `owner` is the sheet that holds the data when it is another one.
 */
function textXml(raw: string, font: Font, data: DataField[] | undefined, owner = ''): { sections: string[]; inner: string } {
  const rows = dataRows(data ?? []);
  const fields: string[] = [];
  let inner = '';
  let from = 0;
  for (const m of raw.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    const found = rows.find((r) => r.field.name.toLowerCase() === m[1]!.toLowerCase());
    if (!found) continue;
    inner += escXml(clean(raw.slice(from, m.index)));
    from = m.index + m[0].length;
    const { value, type } = found.field;
    const numeric = type === 'number' && value !== '' && Number.isFinite(Number(value));
    if (value !== '' && (numeric || !type || type === 'text')) {
      inner += `<fld IX="${fields.length}">${escXml(clean(value))}</fld>`;
      // the format is the one Visio gives a field it inserts: the value as it is
      fields.push(`<Row IX="${fields.length}">${cell('Value', value, `${owner}Prop.${found.row}`, numeric ? undefined : 'STR')}${cell('Format', 'esc(0)', 'FIELDPICTURE(0)', 'STR')}${cell('Type', 0)}${cell('UICat', 0)}${cell('UICod', 255)}${cell('UIFmt', 0)}${cell('Calendar', 0)}${cell('ObjectKind', 0)}</Row>`);
    } else inner += escXml(clean(value));
  }
  inner += escXml(clean(raw.slice(from)));
  const style = (font.bold ? 1 : 0) | (font.italic ? 2 : 0) | (font.underline ? 4 : 0);
  return {
    sections: [
      section('Character', [`<Row IX="0">${cell('Font', font.family)}${cell('Color', hex(font.color))}${cell('Style', style)}${cell('Size', inch(font.size))}</Row>`]),
      section('Paragraph', [`<Row IX="0">${cell('HorzAlign', font.align === 'left' ? 0 : font.align === 'center' ? 1 : 2)}</Row>`]),
      ...(fields.length ? [section('Field', fields)] : []),
    ],
    inner,
  };
}

const VALIGN = { top: 0, middle: 1, bottom: 2 } as const;

/** The rectangle of the text inside the shape, tied to its size. */
function textBlockCells(rect: Rect, w: number, h: number, valign: Font['valign']): string[] {
  const rw = Math.max(1, rect.w);
  const rh = Math.max(1, rect.h);
  const px = rect.x + rect.w / 2;
  const py = h - (rect.y + rect.h / 2);
  return [
    cell('TxtWidth', inch(rw), `Width*${ratio(rw / w)}`),
    cell('TxtHeight', inch(rh), `Height*${ratio(rh / h)}`),
    cell('TxtPinX', inch(px), `Width*${ratio(px / w)}`),
    cell('TxtPinY', inch(py), `Height*${ratio(py / h)}`),
    cell('TxtLocPinX', inch(rw / 2), 'TxtWidth*0.5'),
    cell('TxtLocPinY', inch(rh / 2), 'TxtHeight*0.5'),
    cell('VerticalAlign', VALIGN[valign]),
  ];
}

function connectionXml(s: Shape): string {
  return section(
    'Connection',
    stencilOf(s.stencil).ports.map((p, i) => `<Row T="Connection" IX="${i}">${cell('X', inch(p.x * s.w), `Width*${ratio(p.x)}`)}${cell('Y', inch((1 - p.y) * s.h), `Height*${ratio(1 - p.y)}`)}</Row>`),
  );
}

// ------------------------------------------------------------ one page

export interface PageXml {
  shapes: string;
  connects: string;
  /** Visio's id of each shape of Nova (the comments point at them). */
  sheetIds: Map<string, number>;
}

export interface PageContext {
  /** Name of each page in the file, by id (links to pages go by name). */
  pageNames: Map<string, string>;
  /** Adds a picture to the file and returns the id of its relationship from this page. */
  picture(info: PictureInfo): string;
}

type Item = { shape: Shape } | { items: Item[] };

/** The shapes of the page as a tree of groups; a group sits where its first member is. */
function treeOf(page: Page): Item[] {
  const parent = new Map((page.groups ?? []).map((g) => [g.id, g.parent]));
  const root: Item[] = [];
  const lists = new Map<string, Item[]>();
  for (const shape of page.shapes) {
    const path: string[] = [];
    for (let g = shape.group; g && parent.has(g) && !path.includes(g); g = parent.get(g)) path.unshift(g);
    let list = root;
    for (const g of path) {
      let inner = lists.get(g);
      if (!inner) {
        inner = [];
        lists.set(g, inner);
        list.push({ items: inner });
      }
      list = inner;
    }
    list.push({ shape });
  }
  return root;
}

const shapesIn = (items: Item[]): Shape[] => items.flatMap((i) => ('shape' in i ? [i.shape] : shapesIn(i.items)));

export function pageXml(page: Page, ctx: PageContext): PageXml {
  let count = 0;
  const sheet = (type: Sheet['type'] = 'Shape', prefix: Sheet['prefix'] = 'Sheet'): Sheet => ({ id: ++count, prefix, type, cells: [], sections: [], user: [], kids: [] });
  const layers = page.layers?.length ? layersOf(page) : [];
  const member = (item: { layer?: string }): string[] => (layers.length ? [cell('LayerMember', layers.findIndex((l) => l.id === layerIdOf(page, item)))] : []);
  const targets = new Map<string, Sheet>();
  /** The sheets of the lanes, by pool and lane id. */
  const lanes: Lanes = new Map();

  /** What makes a sheet a container of Visio. */
  const asContainer = (t: Sheet, margin: number, resize: number) => {
    t.user.push(['msvStructureType', 'Container'], ['msvSDContainerMargin', Number(inch(margin))], ['msvSDContainerResize', resize]);
  };

  const picture = (s: Shape, image: ShapeImage, info: PictureInfo, frame: Frame): Sheet => {
    const fit = image.fit;
    const k = fit === 'contain' ? Math.min(s.w / info.w, s.h / info.h) : fit === 'cover' ? Math.max(s.w / info.w, s.h / info.h) : 0;
    // the box of the picture itself (contain shrinks it; stretch and cover fill the shape)
    const w = fit === 'contain' ? info.w * k : s.w;
    const h = fit === 'contain' ? info.h * k : s.h;
    const p = sheet('Foreign', 'Picture');
    p.cells = [
      ...xform({ x: (s.w - w) / 2, y: (s.h - h) / 2, w, h }, frame),
      // the picture inside the shape: the whole of it, or (cover) bigger than the shape and centred, which Visio clips
      ...(fit === 'cover' ? [cell('ImgOffsetX', inch((s.w - info.w * k) / 2)), cell('ImgOffsetY', inch((s.h - info.h * k) / 2)), cell('ImgWidth', inch(info.w * k)), cell('ImgHeight', inch(info.h * k))] : [cell('ImgOffsetX', 0), cell('ImgOffsetY', 0), cell('ImgWidth', inch(w), 'Width*1'), cell('ImgHeight', inch(h), 'Height*1')]),
      ...member(s),
    ];
    // the outline of the picture, which is what Visio selects and what the picture is drawn in
    p.sections.push('<Section N="Geometry" IX="0"><Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row><Row T="RelLineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="0"/></Row><Row T="RelLineTo" IX="3"><Cell N="X" V="1"/><Cell N="Y" V="1"/></Row><Row T="RelLineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="1"/></Row><Row T="RelLineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row></Section>');
    p.user.push([NOVA.part, 'picture'], [NOVA.fit, fit], ...(image.alt ? [[NOVA.alt, JSON.stringify(image.alt)] as [string, string]] : []));
    const compression = info.ext === 'png' ? 'PNG' : info.ext === 'jpeg' ? 'JPEG' : 'GIF';
    p.foreign = `<ForeignData ForeignType="Bitmap" CompressionType="${compression}"><Rel r:id="${ctx.picture(info)}"/></ForeignData>`;
    return p;
  };

  /** A shape of Nova, and the lanes that follow it when it is a pool. */
  const build = (s: Shape, frame: Frame): Sheet[] => {
    const st = stencilOf(s.stencil);
    const free = !!s.geometry?.length;
    const isClass = !free && !!st.sections;
    const info = s.image ? pictureInfo(s.image.src) : null;
    const paints = paintsOf(s);
    const composite = !!info || isClass || paints.length > 1;
    const t = sheet(composite ? 'Group' : 'Shape');
    targets.set(s.id, t);
    t.cells = [...xform(s, frame), ...member(s)];
    if (!free) t.user.push([NOVA.stencil, s.stencil]);
    const whole = { x: 0, y: 0, w: s.w, h: s.h };

    if (composite) {
      t.user.push([NOVA.composite, '1']);
      // a click selects the shape as a whole
      t.cells.push(cell('SelectMode', 0));
      const inner: Frame = { id: t.id, ...whole };
      if (info) t.kids.push(picture(s, s.image!, info, inner));
      const body = Math.max(0, paints.findIndex((p) => p.main));
      paints.forEach((p, i) => {
        const k = sheet();
        k.cells = [...xform(whole, inner), ...paintCells(p.color ?? s.style.fill, s.style, p.width, p.dashed), ...member(s)];
        k.sections.push(geometryXml(p.outlines, s.w, s.h));
        k.user.push([NOVA.part, i === body ? 'body' : 'extra'], ...(p.width !== 1 ? [[NOVA.width, String(p.width)] as [string, string]] : []));
        t.kids.push(k);
      });
    } else {
      const p = paints[0] ?? { color: null, main: true, width: 1, dashed: false, outlines: [] };
      t.cells.push(...paintCells(p.color ?? s.style.fill, s.style, p.width, p.dashed));
      t.sections.push(geometryXml(p.outlines, s.w, s.h));
      if (p.color !== null && p.color !== s.style.fill) t.user.push([NOVA.fill, s.style.fill]);
      if (p.width !== 1) t.user.push([NOVA.width, String(p.width)]);
    }

    t.sections.push(connectionXml(s));
    if (s.data?.length) t.sections.push(dataXml(s.data));
    const link = s.link;
    const linked = link?.page ? ctx.pageNames.get(link.page) : undefined;
    if (link && (link.url || linked)) {
      t.sections.push(section('Hyperlink', [`<Row N="Row_1">${cell('Description', link.tip ?? '', undefined, 'STR')}${cell('Address', link.url ?? '', undefined, 'STR')}${cell('SubAddress', link.url ? '' : (linked ?? ''), undefined, 'STR')}${cell('Default', 1)}${cell('Invisible', 0)}</Row>`]));
    }
    if (s.showData) t.user.push([NOVA.showData, '1']);

    // the text
    const spec = st.text?.(s.w, s.h) ?? whole;
    const shown = isClass || (spec.w > 0 && spec.h > 0);
    const visible = resolveText(s.text, s.data);
    if (s.text && (isClass || !shown || visible !== s.text)) t.user.push([NOVA.text, JSON.stringify(s.text)]);
    if (isClass) {
      // each compartment is a text of its own, as Nova draws it
      const head = 30;
      const rest = Math.max(1, (s.h - head) / 2);
      const rects = [{ x: 0, y: 0, w: s.w, h: head }, { x: 0, y: head, w: s.w, h: rest }, { x: 0, y: head + rest, w: s.w, h: rest }];
      const parts = compartments(s.text);
      rects.forEach((rect, i) => {
        const font: Font = i === 0 ? { ...s.font, bold: true, align: 'center', valign: 'middle' } : { ...s.font, align: 'left', valign: 'top' };
        const k = sheet();
        const text = textXml(parts[i] ?? '', font, s.data, `Sheet.${t.id}!`);
        k.cells = [...xform(rect, { id: t.id, ...whole }), cell('FillPattern', 0), cell('LinePattern', 0), cell('VerticalAlign', VALIGN[font.valign]), ...member(s)];
        k.user.push([NOVA.part, 'text']);
        k.sections.push(...text.sections);
        k.text = text.inner;
        t.kids.push(k);
      });
    } else {
      // the format is kept even where no text shows
      const text = textXml(shown ? s.text : '', s.font, s.data);
      t.cells.push(...(shown ? textBlockCells(spec, s.w, s.h, s.font.valign) : [cell('VerticalAlign', VALIGN[s.font.valign])]));
      t.sections.push(...text.sections);
      if (shown && s.text) t.text = text.inner;
    }

    const c = s.container;
    if (!c) return [t];
    t.user.push([NOVA.container, JSON.stringify(c)]);
    asContainer(t, c.margin, c.autoSize === 'never' ? 0 : c.autoSize === 'grow' ? 1 : 2);
    const out = [t];
    const horizontal = (c.dir ?? 'h') === 'h';
    const mine = new Map<string, Sheet>();
    if (c.kind === 'pool') lanes.set(s.id, mine);
    for (const lane of laneBoxes(s)) {
      const l = sheet();
      mine.set(lane.lane.id, l);
      const { w, h } = lane.rect;
      const rectOf = (rw: number, rh: number): Pt[] => [[0, 0], [rw, 0], [rw, rh], [0, rh]];
      const font: Font = { ...s.font, align: 'center', valign: 'middle', bold: true };
      const text = textXml(lane.lane.title, font, undefined);
      // the title runs along its band: upwards when the lanes are horizontal
      const tw = horizontal ? h : w;
      const th = Math.max(1, c.header);
      const tx = horizontal ? c.header / 2 : w / 2;
      const ty = horizontal ? h / 2 : h - c.header / 2;
      l.cells = [
        // a turned pool turns its lanes around its own centre
        ...xform(turned(lane.rect, s), frame),
        ...paintCells(lighter(s.style.fill), s.style, 1, false),
        cell('TxtWidth', inch(tw), horizontal ? 'Height*1' : 'Width*1'),
        cell('TxtHeight', inch(th)),
        cell('TxtPinX', inch(tx), horizontal ? undefined : 'Width*0.5'),
        cell('TxtPinY', inch(ty), horizontal ? 'Height*0.5' : `Height-${inch(c.header / 2)} in`),
        cell('TxtLocPinX', inch(tw / 2), 'TxtWidth*0.5'),
        cell('TxtLocPinY', inch(th / 2), 'TxtHeight*0.5'),
        cell('TxtAngle', horizontal ? Math.PI / 2 : 0),
        cell('VerticalAlign', 1),
        ...member(s),
      ];
      l.sections.push(
        geometryXml(
          [
            { pts: rectOf(horizontal ? c.header : w, horizontal ? h : c.header), closed: true, fill: true, stroke: true },
            { pts: rectOf(w, h), closed: true, fill: false, stroke: true },
          ],
          w,
          h,
        ),
        ...text.sections,
      );
      l.text = text.inner;
      l.user.push([NOVA.lane, lane.lane.id]);
      asContainer(l, c.margin, 0);
      out.push(l);
    }
    return out;
  };

  const place = (items: Item[], frame: Frame): Sheet[] =>
    items.flatMap((item) => {
      if ('shape' in item) return build(item.shape, frame);
      const box = unionRects(shapesIn(item.items).map(boundsOf))!;
      const g = sheet('Group');
      g.cells = xform(box, frame);
      g.kids = place(item.items, { id: g.id, ...box });
      return [g];
    });

  const sheets = place(treeOf(page), { x: 0, y: 0, w: page.width, h: page.height });
  relate(page, targets, lanes);
  const sheetIds = new Map([...targets].map(([id, t]) => [id, t.id]));

  const connects: string[] = [];
  const lines = page.connectors.map((c) => {
    const k = sheet('Shape', 'Connector');
    connector(k, c, page, sheetIds, connects);
    k.cells.push(...member(c));
    return k;
  });
  return { shapes: [...sheets, ...lines].map(sheetXml).join(''), connects: connects.join(''), sheetIds };
}

/** Where a part of a turned shape ends up: moved around the centre of the shape, and turned with it. */
function turned(rect: Rect, s: Shape): Rect & { rot: number } {
  const c = rotatePoint(centerOf(rect), centerOf(s), s.rot);
  return { x: c.x - rect.w / 2, y: c.y - rect.h / 2, w: rect.w, h: rect.h, rot: s.rot };
}

type Lanes = Map<string, Map<string, Sheet>>;

/**
 * Says to Visio what is inside each container: a container names everything it holds, at any depth, and each member
 * names every container around it.
 */
function relate(page: Page, targets: Map<string, Sheet>, lanes: Lanes): void {
  const byId = new Map(page.shapes.map((s) => [s.id, s]));
  const around = (s: Shape): Sheet[] => {
    const out: Sheet[] = [];
    const seen = new Set([s.id]);
    let cur = s;
    while (cur.parent && !seen.has(cur.parent)) {
      seen.add(cur.parent);
      const box = byId.get(cur.parent);
      if (!box?.container) break;
      const lane = cur.lane ? lanes.get(box.id)?.get(cur.lane) : undefined;
      if (lane) out.push(lane);
      out.push(targets.get(box.id)!);
      cur = box;
    }
    return out;
  };
  const members: [Sheet, Sheet[]][] = page.shapes.map((s) => [targets.get(s.id)!, around(s)]);
  for (const [id, own] of lanes) {
    const pool = byId.get(id)!;
    for (const lane of own.values()) members.push([lane, [targets.get(id)!, ...around(pool)]]);
  }
  const held = new Map<Sheet, Sheet[]>();
  for (const [m, boxes] of members) {
    for (const b of boxes) {
      const list = held.get(b);
      if (list) list.push(m);
      else held.set(b, [m]);
    }
  }
  const refs = (list: Sheet[]) => list.map((x) => `Sheet.${x.id}!SheetRef()`).join(',');
  for (const [m, boxes] of members) {
    const inside = held.get(m);
    const parts = [...(boxes.length ? [`DEPENDSON(4,${refs(boxes)})`] : []), ...(inside ? [`DEPENDSON(1,${refs(inside)})`] : [])];
    if (parts.length) m.cells.push(cell('Relationships', 0, `SUM(${parts.join(',')})`));
  }
}

/** A connector as a routable line of Visio, glued to the shapes (or connection points) it joins. */
function connector(k: Sheet, c: Connector, page: Page, sheetIds: Map<string, number>, connects: string[]): void {
  const r = connectorRender(c, page);
  const pts = r.route.points;
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  const H = page.height;
  // the local coordinates of a line of Visio start at its beginning
  const w = b.x - a.x;
  const h = a.y - b.y;
  const ends: Record<'Begin' | 'End', string[]> = { Begin: [], End: [] };
  for (const which of ['Begin', 'End'] as const) {
    const end = which === 'Begin' ? c.from : c.to;
    const at = which === 'Begin' ? a : b;
    const target = isGlued(end) ? sheetIds.get(end.shape) : undefined;
    const trigger = which === 'Begin' ? 'BegTrigger' : 'EndTrigger';
    let formula: string | undefined;
    if (isGlued(end) && target !== undefined) {
      const count = stencilOf(page.shapes.find((s) => s.id === end.shape)!.stencil).ports.length;
      const port = end.port === 'auto' ? null : end.port >= 0 && end.port < count ? end.port : 0;
      formula =
        port === null
          ? `_WALKGLUE(${trigger},${which === 'Begin' ? 'EndTrigger' : 'BegTrigger'},WalkPreference)`
          : `PAR(PNT(Sheet.${target}!Connections.X${port + 1},Sheet.${target}!Connections.Y${port + 1}))`;
      ends[which].push(cell(trigger, 2, `_XFTRIGGER(Sheet.${target}!EventXFMod)`));
      connects.push(`<Connect FromSheet="${k.id}" FromCell="${which}X" FromPart="${which === 'Begin' ? 9 : 12}" ToSheet="${target}" ToCell="${port === null ? 'PinX' : `Connections.X${port + 1}`}" ToPart="${port === null ? 3 : 100 + port}"/>`);
    }
    ends[which].unshift(cell(`${which}X`, inch(at.x), formula), cell(`${which}Y`, inch(H - at.y), formula));
  }
  k.cells = [
    cell('PinX', inch((a.x + b.x) / 2), 'GUARD((BeginX+EndX)/2)'),
    cell('PinY', inch(H - (a.y + b.y) / 2), 'GUARD((BeginY+EndY)/2)'),
    cell('Width', inch(w), 'GUARD(EndX-BeginX)'),
    cell('Height', inch(h), 'GUARD(EndY-BeginY)'),
    cell('LocPinX', inch(w / 2), 'GUARD(Width*0.5)'),
    cell('LocPinY', inch(h / 2), 'GUARD(Height*0.5)'),
    cell('Angle', 0, 'GUARD(0DA)'),
    ...ends.Begin,
    ...ends.End,
    cell('ObjType', 2),
    cell('GlueType', 2),
    cell('ShapeRouteStyle', c.routing === 'straight' ? 2 : 1),
    cell('ConLineRouteExt', c.routing === 'curve' ? 2 : 1),
    cell('LineColor', hex(c.stroke)),
    cell('LinePattern', c.stroke === 'none' ? 0 : PATTERN[c.dash]),
    cell('LineWeight', inch(c.strokeWidth)),
    cell('FillPattern', 0),
    cell('BeginArrow', VISIO_ARROW[c.startArrow]),
    cell('EndArrow', VISIO_ARROW[c.endArrow]),
  ];
  // a straight line stretches with its ends; the other routes are drawn as they are until Visio routes them again
  const straight = pts.length === 2;
  const rows = pts.map((p, i) => `<Row T="${i === 0 ? 'MoveTo' : 'LineTo'}" IX="${i + 1}">${cell('X', inch(p.x - a.x), straight && i ? 'Width*1' : undefined)}${cell('Y', inch(a.y - p.y), straight && i ? 'Height*1' : undefined)}</Row>`);
  k.sections.push(`<Section N="Geometry" IX="0">${cell('NoFill', 1)}${cell('NoLine', 0)}${cell('NoShow', 0)}${rows.join('')}</Section>`);
  const text = textXml(c.text, { ...c.font, align: 'center' }, undefined);
  k.sections.push(...text.sections);
  if (c.text) {
    const box = r.label?.box ?? { x: r.route.mid.x - 40, y: r.route.mid.y - 10, w: 80, h: 20 };
    k.cells.push(
      cell('TxtWidth', inch(box.w)),
      cell('TxtHeight', inch(box.h)),
      cell('TxtPinX', inch(r.route.mid.x - a.x)),
      cell('TxtPinY', inch(a.y - r.route.mid.y)),
      cell('TxtLocPinX', inch(box.w / 2), 'TxtWidth*0.5'),
      cell('TxtLocPinY', inch(box.h / 2), 'TxtHeight*0.5'),
      cell('VerticalAlign', 1),
      // a white background, as the label has on screen
      cell('TextBkgnd', 2),
    );
    k.text = text.inner;
  }
  k.user.push([NOVA.connector, c.routing], [NOVA.arrows, `${c.startArrow},${c.endArrow}`]);
}
