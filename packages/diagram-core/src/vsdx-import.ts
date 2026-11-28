import JSZip from 'jszip';
import { defaultFont, defaultStyle, newDiagram, newId, type Arrow, type CommentThread, type Connector, type DataField, type Diagram, type End, type Font, type Layer, type Outline, type Page, type Shape, type ShapeLink, type Style } from './model';
import { assignMembership } from './container';
import { centerOf, portsOf, rotatePoint } from './geometry';
import { readContainer } from './io';
import { resolveText, textWidth } from './render';
import { hasStencil, stencilOf } from './stencils';
import { geometryPaths, type Pt } from './vsdx-geometry';
import { Cascade, THEMED, indexShapes, mergedRows, num, parseXml, readShape, relsOf, sectionNames, type Category, type Cell, type Eff, type Master, type Node, type Raw, type Value } from './vsdx-read';
import { gradientColor, mix, overWhite, parseTheme, themedLook, type PageTheme, type ThemedLook, type VisioTheme } from './vsdx-theme';
import { NOVA, NOVA_ARROW, VISIO_ARROW, compartments, joinCompartments } from './vsdx-nova';

/*
 * Reading a Visio drawing (.vsdx). Every shape is resolved the way Visio does it (the shape, then its master, then the
 * style sheets, then the theme of the page) and turned into Nova shapes: the common flowchart shapes become Nova's own,
 * the rest keep their outlines. Groups stay groups; pictures, data, links, layers and background pages come along. What
 * cannot be kept is counted and told. Drawings written by Nova carry notes (`vsdx-nova.ts`) that give back its own
 * shapes, containers and swimlanes.
 */

const PX = 96; // pixels per inch

export interface VsdxResult {
  diagram: Diagram;
  warnings: string[];
}

/** Master shapes whose drawing Nova has as a shape of its own. */
const STENCIL_OF: Record<string, string> = {
  Process: 'process',
  Decision: 'decision',
  Document: 'document',
  Data: 'data',
  Subprocess: 'predefined',
  'Start/End': 'terminator',
  'On-page reference': 'flowConnector',
  'Off-page reference': 'offPage',
  Rectangle: 'rect',
  Square: 'rect',
  Ellipse: 'ellipse',
  Circle: 'ellipse',
};

// ------------------------------------------------------------ placing

/**
 * An affine map from the local coordinates of a shape (inches, y up) to those of the page. The last number is how much
 * the text is turned: the sum of the turns, which Visio does not change when it mirrors a shape.
 */
type Matrix = [number, number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0, 0];
const det = (m: Matrix) => m[0] * m[3] - m[1] * m[2];
const mul = (p: Matrix, c: Matrix): Matrix => [p[0] * c[0] + p[2] * c[1], p[1] * c[0] + p[3] * c[1], p[0] * c[2] + p[2] * c[3], p[1] * c[2] + p[3] * c[3], p[0] * c[4] + p[2] * c[5] + p[4], p[1] * c[4] + p[3] * c[5] + p[5], p[6] + (det(p) < 0 ? -c[6] : c[6])];
const apply = (m: Matrix, [x, y]: Pt): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

const degrees = (rad: number) => {
  const d = ((((rad * 180) / Math.PI) % 360) + 360) % 360;
  return d > 359.999 || d < 0.001 ? 0 : Math.round(d * 1000) / 1000;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

// ------------------------------------------------------------ the document

interface Doc {
  zip: JSZip;
  cascade: Cascade;
  masters: Map<string, Master>;
  /** The relationships of each master part (its pictures). */
  masterRels: Map<string, Map<string, { type: string; target: string }>>;
  themes: VisioTheme[];
  palette: Map<number, string>;
  media: Map<string, string | null>;
  notes: Notes;
  /** Shapes still allowed: a broken file whose masters repeat themselves must not go on for ever. */
  budget: number;
}

const MAX_SHAPES = 100_000;

class Notes {
  private counts = new Map<string, number>();
  add(key: Note, n = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + n);
  }
  list(): string[] {
    return (Object.keys(NOTES) as Note[]).flatMap((k) => {
      const n = this.counts.get(k);
      return n ? [NOTES[k](n)] : [];
    });
  }
}

const NOTES = {
  pictures: (n: number) => `${n} imagen(es) u objetos incrustados no se importaron.`,
  curves: (n: number) => `${n} forma(s) con curvas especiales se aproximaron con segmentos.`,
  gradients: (n: number) => `${n} forma(s) con degradado o trama quedaron de un solo color.`,
  richText: (n: number) => `${n} texto(s) con varios formatos quedaron con el que más se usa.`,
  background: (n: number) => `${n} página(s) de fondo se pusieron en sus páginas, en una capa bloqueada «Fondo».`,
  manyLayers: (n: number) => `${n} forma(s) en varias capas quedaron solo en una.`,
  manyLinks: (n: number) => `${n} forma(s) con varios vínculos conservan solo el primero.`,
  badLinks: (n: number) => `${n} vínculo(s) a archivos o direcciones no admitidas no se importaron.`,
};
type Note = keyof typeof NOTES;

const INDEX_COLORS = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#800000', '#008000', '#000080', '#808000', '#800080', '#008080', '#c0c0c0', '#e6e6e6', '#cdcdcd', '#b3b3b3', '#9a9a9a', '#808080', '#666666', '#4d4d4d', '#333333', '#1a1a1a'];

function colorOf(doc: Doc, v: Value): string | undefined {
  if (typeof v !== 'string') return undefined;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^\d+$/.test(v)) return doc.palette.get(Number(v)) ?? INDEX_COLORS[Number(v)];
  const m = /^RGB\((\d+),\s*(\d+),\s*(\d+)\)/i.exec(v);
  return m ? `#${m.slice(1, 4).map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('')}` : undefined;
}

// ------------------------------------------------------------ one shape

/** A shape of the page being read: its cells, its size and the master data that goes down to its parts. */
interface Item extends Eff {
  master?: Raw;
  masterDoc?: Master;
  /** The master itself when the shape is a whole instance of it (not a part). */
  instanceOf?: Master;
  w: number;
  h: number;
  /** How much bigger than its master the shape is: master values without a formula are stretched with it. */
  sx: number;
  sy: number;
}

interface Reading {
  doc: Doc;
  theme: PageTheme | null;
  page: Page;
  /** Page height in inches and the scale of the drawing: where the y axis of Nova starts. */
  height: number;
  /** Part whose relationships hold the pictures of the page. */
  rels: Map<string, { type: string; target: string }>;
  layerOf: (e: Item) => string | undefined;
  /** Visio sheet id → the Nova shape a connector glued to it should reach. */
  sheets: Map<string, { shape: Shape; item: Item; m: Matrix }>;
  connectors: { item: Item; m: Matrix; id: string }[];
  /** Sheet ids of the shapes that are glued to others. */
  glued: Set<string>;
  /** Pictures of shapes that Nova itself wrote, waiting for their shape (which follows). */
  picture?: { src: string; box: { w: number; h: number; offset: boolean } };
  pageNames: Map<string, string>;
  layer?: string; // forced layer (background)
  /** The lanes of the pools Nova wrote, put into their pools once the page is read. */
  lanes: LaneRead[];
}

interface LaneRead {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The lane as a drawing of its own, for one whose pool is gone. */
  alone: () => Shape | null;
}

/** A numeric cell of a shape, following formulas such as `Width*0.5` that its master has. */
function size(r: Reading, e: Item, name: string, def: number): number {
  const own = e.own.cells.get(name);
  if (own?.v !== undefined) return num(own.v, def);
  const m = e.master?.cells.get(name);
  if (m) return masterNumber(m, e, /X|Width/.test(name) ? e.sx : e.sy, def);
  return num(r.doc.cascade.cell(e, name, 'LineStyle'), def);
}

function masterNumber(c: Cell, e: Item, scale: number, def: number): number {
  const f = /^(Width|Height)\*(-?\d+(?:\.\d+)?)$/.exec(c.f);
  if (f) return (f[1] === 'Width' ? e.w : e.h) * Number(f[2]);
  return c.v === undefined ? def : num(c.v, def) * scale;
}

function itemOf(doc: Doc, own: Raw, context: Master | undefined): Item {
  const id = own.attrs.Master;
  const masterDoc = id !== undefined ? doc.masters.get(id) : context;
  const part = own.attrs.MasterShape !== undefined ? masterDoc?.byId.get(own.attrs.MasterShape) : undefined;
  const master = part ?? (id !== undefined ? masterDoc?.tops[0] : undefined);
  const dim = (n: 'Width' | 'Height') => {
    const m = num(master?.cells.get(n)?.v, 0);
    const v = num(own.cells.get(n)?.v, m);
    return { v, k: m && v ? v / m : 1 };
  };
  const w = dim('Width');
  const h = dim('Height');
  return { own, master, masterDoc, ...(id !== undefined && !part && masterDoc ? { instanceOf: masterDoc } : {}), w: w.v, h: h.v, sx: w.k, sy: h.k };
}

/** The map from the local coordinates of a shape to those of its parent. */
function placement(r: Reading, e: Item): Matrix {
  const pinX = size(r, e, 'PinX', 0);
  const pinY = size(r, e, 'PinY', 0);
  const locX = size(r, e, 'LocPinX', e.w / 2);
  const locY = size(r, e, 'LocPinY', e.h / 2);
  const angle = size(r, e, 'Angle', 0) / (e.own.cells.has('Angle') ? 1 : e.sy || 1);
  const fx = num(r.doc.cascade.cell(e, 'FlipX', 'LineStyle'), 0) ? -1 : 1;
  const fy = num(r.doc.cascade.cell(e, 'FlipY', 'LineStyle'), 0) ? -1 : 1;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return mul(mul([1, 0, 0, 1, pinX, pinY, 0], [cos * fx, sin * fx, -sin * fy, cos * fy, 0, 0, angle]), [1, 0, 0, 1, -locX, -locY, 0]);
}

/** The box of a shape on the Nova page. */
function boxOf(r: Reading, m: Matrix, w: number, h: number, at: Pt = [w / 2, h / 2]): { x: number; y: number; w: number; h: number; rot: number; flipH?: boolean; flipV?: boolean } {
  const [cx, cy] = apply(m, at);
  const width = Math.max(1, r2(w * Math.hypot(m[0], m[1]) * PX));
  const height = Math.max(1, r2(h * Math.hypot(m[2], m[3]) * PX));
  // a drawing can be turned and mirrored in two ways: the one whose text (which Nova turns with the shape) is as in Visio
  const along = Math.atan2(m[1], m[0]);
  const against = along + Math.PI;
  const ways: [number, { flipH?: boolean; flipV?: boolean }][] = det(m) < 0 ? [[against, { flipH: true }], [along, { flipV: true }]] : [[along, {}], [against, { flipH: true, flipV: true }]];
  const [angle, flip] = Math.cos(ways[1]![0] - m[6]) > Math.cos(ways[0]![0] - m[6]) + 1e-9 ? ways[1]! : ways[0]!;
  return { x: r2(cx * PX - width / 2), y: r2((r.height - cy) * PX - height / 2), w: width, h: height, rot: degrees(-angle), ...flip };
}

/** The drawing of a shape: its outlines in 0–1 coordinates of `area`, the part of the local plane that holds it. */
interface Drawn {
  outlines: Outline[];
  arcs: boolean;
  /** Left, bottom, width and height in the local units of the shape: its box, enlarged to what is drawn outside it. */
  area: [number, number, number, number];
  /** The same for what is drawn only (null when nothing is). */
  extent: [number, number, number, number] | null;
}

function outlinesOf(r: Reading, e: Item): Drawn {
  const found: { pts: Pt[]; closed: boolean; fill: boolean; stroke: boolean }[] = [];
  let curved = false;
  let approximated = false;
  for (const name of sectionNames(e, 'Geometry')) {
    const own = e.own.sections.get(name);
    const master = e.master?.sections.get(name);
    if (own?.del || (!own && master?.del)) continue;
    const flag = (n: string) => num(own?.cells.get(n)?.v ?? master?.cells.get(n)?.v, 0) === 1;
    if (flag('NoShow')) continue;
    const rows = mergedRows(e, name).flatMap((row) => {
      if (!row.t) return [];
      const rel = row.t.startsWith('Rel');
      const value = (n: string): number => {
        const o = row.own?.cells.get(n);
        if (o?.v !== undefined) return num(o.v, 0);
        const c = row.master?.cells.get(n);
        if (!c) return 0;
        if (rel) return num(c.v, 0);
        // angles and ratios do not stretch; heights of arcs stretch a bit both ways
        if ((n === 'C' || n === 'D') && /EllipticalArcTo|NURBSTo/.test(row.t!)) return num(c.v, 0);
        if (row.t === 'NURBSTo' && (n === 'A' || n === 'B')) return num(c.v, 0);
        const k = row.t === 'ArcTo' && n === 'A' ? (e.sx + e.sy) / 2 : n === 'X' || n === 'A' || n === 'C' ? e.sx : e.sy;
        return masterNumber(c, e, k, 0);
      };
      if (/Arc|Bez|NURBS|Spline|Ellipse/.test(row.t)) curved = true;
      return [{ type: row.t, v: value, has: (n: string) => !!(row.own?.cells.has(n) || row.master?.cells.has(n)), text: (n: string) => row.own?.cells.get(n)?.v ?? row.master?.cells.get(n)?.v ?? '' }];
    });
    const g = geometryPaths(rows, e.w, e.h);
    approximated ||= g.approximated;
    for (const p of g.paths) found.push({ pts: p.pts.filter((q) => q.every(Number.isFinite)), closed: p.closed, fill: !flag('NoFill'), stroke: !flag('NoLine') });
  }
  if (approximated) r.doc.notes.add('curves');
  // a shape may draw outside its box (a block arrow of one dimension has no height at all)
  const xs = found.flatMap((p) => p.pts.map((q) => q[0]));
  const ys = found.flatMap((p) => p.pts.map((q) => q[1]));
  const extent: Drawn['extent'] = xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] : null;
  const left = Math.min(0, e.w, ...xs);
  const bottom = Math.min(0, e.h, ...ys);
  const area: Drawn['area'] = [left, bottom, Math.max(0, e.w, ...xs) - left, Math.max(0, e.h, ...ys) - bottom];
  const nx = (x: number) => (area[2] > 1e-6 ? (x - area[0]) / area[2] : 0.5);
  const ny = (y: number) => (area[3] > 1e-6 ? 1 - (y - area[1]) / area[3] : 0.5);
  // like Visio, what is only a line goes over what is filled, whatever the order of the sections
  const outlines: Outline[] = [...found].sort((a, b) => Number(b.fill) - Number(a.fill)).map((p) => ({ pts: p.pts.map(([x, y]) => [Math.round(nx(x) * 1e5) / 1e5, Math.round(ny(y) * 1e5) / 1e5] as [number, number]), closed: p.closed, fill: p.fill, stroke: p.stroke }));
  return { outlines, arcs: curved, area, extent };
}

const boxOfArea = (r: Reading, m: Matrix, a: [number, number, number, number]) => boxOf(r, m, a[2], a[3], [a[0] + a[2] / 2, a[1] + a[3] / 2]);

/** What the theme gives this shape; null when the page has no theme. */
function look(r: Reading, e: Item): ThemedLook | null {
  if (!r.theme) return null;
  const c = r.doc.cascade;
  const q = (n: string, cat: Category, d: number) => num(c.cell(e, n, cat), d);
  const type = q('QuickStyleType', 'LineStyle', 0);
  return themedLook(r.theme, {
    fillColor: q('QuickStyleFillColor', 'FillStyle', 100),
    fillMatrix: q('QuickStyleFillMatrix', 'FillStyle', 100),
    lineColor: q('QuickStyleLineColor', 'LineStyle', 100),
    lineMatrix: q('QuickStyleLineMatrix', 'LineStyle', 100),
    fontColor: q('QuickStyleFontColor', 'TextStyle', 100),
    fontMatrix: q('QuickStyleFontMatrix', 'TextStyle', 100),
    connector: type === 2 || (type === 0 && (e.own.cells.has('BeginX') || !!e.master?.cells.has('BeginX'))),
  });
}

const DASHES: Record<number, Style['dash']> = { 1: 'solid', 2: 'dash', 3: 'dot', 4: 'dashdot' };
const dashOf = (pattern: number): Style['dash'] => DASHES[pattern] ?? 'dash';

function lineOf(r: Reading, e: Item, t: ThemedLook | null): { stroke: string; strokeWidth: number; dash: Style['dash'] } {
  const c = r.doc.cascade;
  const pv = c.cell(e, 'LinePattern', 'LineStyle');
  const pattern = pv === THEMED ? (t ? (t.line === null ? 0 : t.linePattern) : 1) : num(pv, 1);
  const cv = c.cell(e, 'LineColor', 'LineStyle');
  let stroke = (cv === THEMED ? t?.line : colorOf(r.doc, cv)) ?? '#000000';
  const trans = num(c.cell(e, 'LineColorTrans', 'LineStyle'), 0);
  stroke = overWhite(stroke, Math.max(0, Math.min(1, trans)));
  const wv = c.cell(e, 'LineWeight', 'LineStyle');
  const weight = wv === THEMED ? (t?.lineWidth ?? 1 / PX) : num(wv, 1 / PX);
  return { stroke: pattern === 0 || trans >= 0.99 ? 'none' : stroke, strokeWidth: Math.max(0.75, r2(weight * PX)), dash: pattern === 0 ? 'solid' : dashOf(pattern) };
}

function fillOf(r: Reading, e: Item, t: ThemedLook | null): string {
  const c = r.doc.cascade;
  const pv = c.cell(e, 'FillPattern', 'FillStyle');
  const pattern = pv === THEMED ? (t && t.fill === null ? 0 : 1) : num(pv, 1);
  if (pattern === 0) return 'none';
  const color = (name: string, themed: string | null | undefined, d: string) => {
    const v = c.cell(e, name, 'FillStyle');
    return (v === THEMED ? themed : colorOf(r.doc, v)) ?? d;
  };
  const fore = color('FillForegnd', t?.fill, '#ffffff');
  const gv = c.cell(e, 'FillGradientEnabled', 'FillStyle');
  const gradient = gv === THEMED ? !!t?.gradient : num(gv, 0) === 1;
  let out = fore;
  if (gradient) {
    const stops = mergedRows(e, 'FillGradient').flatMap((row) => {
      const cell = (n: string) => row.own?.cells.get(n)?.v ?? row.master?.cells.get(n)?.v;
      const col = colorOf(r.doc, cell('GradientStopColor'));
      return col ? [{ color: col, pos: num(cell('GradientStopPosition'), -1) }] : [];
    }).map((s, i, all) => ({ ...s, pos: s.pos < 0 ? i / Math.max(1, all.length - 1) : s.pos }));
    const themedFore = c.cell(e, 'FillForegnd', 'FillStyle') === THEMED;
    out = (gv === THEMED || themedFore) && t?.gradient ? t.fillBack : stops.length ? gradientColor(stops) : gradientColor([{ color: fore, pos: 0 }, { color: color('FillBkgnd', t?.fillBack, '#ffffff'), pos: 1 }]);
    r.doc.notes.add('gradients');
  } else if (pattern >= 25) {
    out = gradientColor([{ color: fore, pos: 0 }, { color: color('FillBkgnd', t?.fillBack, '#ffffff'), pos: 1 }]);
    r.doc.notes.add('gradients');
  } else if (pattern > 1) {
    // a hatch: mostly its background, with some of the colour of its lines
    out = mix(color('FillBkgnd', t?.fillBack, '#ffffff'), fore, 0.3);
    r.doc.notes.add('gradients');
  }
  const trans = Math.max(0, Math.min(1, num(c.cell(e, 'FillForegndTrans', 'FillStyle'), 0)));
  return trans >= 0.99 ? 'none' : overWhite(out, trans);
}

const textOf = (e: Item): { value: string; row: string; runs: number } => {
  const t = e.own.text ?? e.master?.text ?? { value: '', row: '0', runs: 1 };
  // Visio also writes the Unicode line separator
  const lines = t.value.split(String.fromCharCode(0x2028)).join('\n').replace(/\r\n?/g, '\n');
  return { ...t, value: lines.replace(/\n$/, '') };
};

const luminance = (c: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * The theme gives light text to shapes with a dark fill. Where there is nothing but the white page behind the text,
 * Visio draws it with the colour of the shape instead.
 */
function readable(r: Reading, e: Item, t: ThemedLook | null, row: string, font: Font): Font {
  if (!t || r.doc.cascade.rowCell(e, 'Character', row, 'Color', 'TextStyle') !== THEMED || luminance(font.color) < 0.85) return font;
  const color = [t.fill, t.line].find((c) => c && luminance(c) < 0.85) ?? '#000000';
  return { ...font, color };
}

function fontOf(r: Reading, e: Item, t: ThemedLook | null, row: string): Font {
  const c = r.doc.cascade;
  const ch = (n: string) => c.rowCell(e, 'Character', row, n, 'TextStyle');
  const sv = ch('Style');
  const bits = num(sv, 0);
  const family = ch('Font');
  const colorValue = ch('Color');
  const align = num(c.rowCell(e, 'Paragraph', '0', 'HorzAlign', 'TextStyle'), 1);
  const valign = num(c.cell(e, 'VerticalAlign', 'TextStyle'), 1);
  const base = defaultFont();
  return {
    family: family === THEMED ? (t?.font ?? base.family) : typeof family === 'string' && family && !/^\d+$/.test(family) ? family : base.family,
    size: r2(Math.max(4, Math.min(200, num(ch('Size'), 1 / 9) * PX))),
    color: (colorValue === THEMED ? t?.text : colorOf(r.doc, colorValue)) ?? '#000000',
    bold: !!(bits & 1),
    italic: !!(bits & 2),
    underline: !!(bits & 4),
    align: align === 0 ? 'left' : align === 2 ? 'right' : 'center',
    valign: valign === 0 ? 'top' : valign === 2 ? 'bottom' : 'middle',
  };
}

// ---- data and links

const userRow = (e: Item, name: string) => e.own.sections.get('User')?.rows.get(name);
const userValue = (e: Item, name: string): string | undefined => userRow(e, name)?.cells.get('Value')?.v;

/** A note that Nova keeps as JSON; undefined when there is none or it is damaged. */
function note(e: Item, name: string): unknown {
  const v = userValue(e, name);
  if (v === undefined) return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

/** The text as it was written in Nova (with its `{{data}}`), unless it has been changed since. */
function novaText(e: Item, shape: Shape, seen: string): string {
  const mine = note(e, NOVA.text);
  if (typeof mine !== 'string') return seen;
  const room = stencilOf(shape.stencil).text?.(shape.w, shape.h);
  const hidden = !!room && (room.w <= 0 || room.h <= 0);
  return (hidden && !seen) || resolveText(mine, shape.data).replace(/\n+$/, '') === seen ? mine : seen;
}

/** What a shape of Nova has that Visio has no cell for. */
function restore(shape: Shape, e: Item): void {
  if (userRow(e, NOVA.showData)) shape.showData = true;
  const container = readContainer(note(e, NOVA.container));
  if (container) shape.container = container;
}

function dataOf(e: Item): DataField[] {
  const out: DataField[] = [];
  for (const row of mergedRows(e, 'Property')) {
    const cell = (n: string) => row.own?.cells.get(n)?.v ?? row.master?.cells.get(n)?.v;
    if (num(cell('Invisible'), 0) === 1) continue;
    const value = cell('Value') ?? '';
    // a field of the master that nobody has filled in says nothing
    const mv = row.master?.cells.get('Value');
    if (!row.own && (!value || mv?.f === 'No Formula')) continue;
    const type = num(cell('Type'), 0);
    const empty = !value || (row.own === undefined && value === '0') || row.own?.cells.get('Value')?.f === 'No Formula';
    const text = empty ? '' : type === 3 ? (/^(1|true)$/i.test(value) ? 'Sí' : 'No') : type === 5 ? value.slice(0, 10) : value;
    out.push({ name: (cell('Label') || row.key).slice(0, 80), value: text.slice(0, 2000), type: type === 2 || type === 7 ? 'number' : type === 3 ? 'bool' : type === 5 ? 'date' : 'text' });
  }
  return out;
}

function linkOf(r: Reading, e: Item): ShapeLink | undefined {
  const links = mergedRows(e, 'Hyperlink').flatMap((row) => {
    const cell = (n: string) => row.own?.cells.get(n)?.v ?? row.master?.cells.get(n)?.v ?? '';
    if (num(cell('Invisible'), 0) === 1) return [];
    const address = cell('Address');
    const sub = cell('SubAddress');
    const tip = cell('Description') || undefined;
    if (!address && !sub) return [];
    const page = !address && sub ? r.pageNames.get(sub.split('/')[0]!) : undefined;
    const url = /^(https?:|mailto:|file:)/i.test(address) ? address : /^www\./i.test(address) ? `https://${address}` : undefined;
    if (!url && !page) {
      r.doc.notes.add('badLinks');
      return [];
    }
    return [{ main: num(cell('Default'), 0) === 1, link: { ...(url ? { url } : {}), ...(page ? { page } : {}), ...(tip ? { tip } : {}) } as ShapeLink }];
  });
  if (links.length > 1) r.doc.notes.add('manyLinks');
  return (links.find((l) => l.main) ?? links[0])?.link;
}

// ---- pictures

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' };

async function loadMedia(doc: Doc, rels: Map<string, { type: string; target: string }>): Promise<void> {
  for (const { target } of rels.values()) {
    const mime = MIME[target.split('.').pop()!.toLowerCase()];
    if (!mime || doc.media.has(target)) continue;
    const data = await doc.zip.file(target)?.async('base64');
    doc.media.set(target, data && data.length < 16_000_000 ? `data:${mime};base64,${data}` : null);
  }
}

// ------------------------------------------------------------ walking the page

/** Is the shape a connector (as opposed to a drawing that merely has two ends)? */
function isConnector(r: Reading, e: Item): boolean {
  if (userRow(e, 'NovaConnector')) return true;
  const has = (n: string) => e.own.cells.has(n) || !!e.master?.cells.has(n);
  if (!has('BeginX') || !has('EndX')) return false;
  if (e.own.kids.length || e.master?.kids.length) return false;
  if (/connector|conector/i.test(e.instanceOf?.name ?? '')) return true;
  if (r.glued.has(e.own.attrs.ID ?? '')) return true;
  // a line glued to nothing is a connector only when it is just that: one straight stretch
  const g = outlinesOf(r, e);
  return !g.arcs && g.outlines.length <= 1 && (g.outlines[0]?.pts.length ?? 2) === 2;
}

/** Visio draws the text of a shape in its own block, which may lie outside the shape (under an icon, say). */
function textBlock(r: Reading, e: Item): { at: Pt; w: number; h: number; outside: boolean } {
  const w = size(r, e, 'TxtWidth', e.w);
  const h = size(r, e, 'TxtHeight', e.h);
  const px = size(r, e, 'TxtPinX', e.w / 2);
  const py = size(r, e, 'TxtPinY', e.h / 2);
  const at: Pt = [px - size(r, e, 'TxtLocPinX', w / 2) + w / 2, py - size(r, e, 'TxtLocPinY', h / 2) + h / 2];
  return { at, w, h, outside: at[0] < -0.02 * e.w || at[0] > 1.02 * e.w || at[1] < -0.02 * e.h || at[1] > 1.02 * e.h };
}

function makeShape(box: ReturnType<typeof boxOf>, stencil: string, style: Style, font: Font, text: string, layer: string | undefined): Shape {
  return { id: newId('s'), stencil, ...box, text, style, font, locked: false, ...(layer ? { layer } : {}) };
}

const invisible: Pick<Style, 'fill' | 'stroke'> = { fill: 'none', stroke: 'none' };

/** The style of a sheet that Nova wrote. */
function novaStyle(r: Reading, e: Item): Style {
  const t = look(r, e);
  const line = lineOf(r, e, t);
  // some stencils draw a part with a thicker or thinner line than the shape has
  const factor = num(userValue(e, NOVA.width), 1) || 1;
  const painted = fillOf(r, e, t);
  // a drawing painted with the line colour keeps the fill the shape had
  const own = userValue(e, NOVA.fill);
  return {
    ...defaultStyle(),
    ...line,
    strokeWidth: r2(line.strokeWidth / factor),
    fill: own !== undefined && painted === line.stroke ? own : painted,
    shadow: num(r.doc.cascade.cell(e, 'ShdwPattern', 'FillStyle'), 0) > 0,
  };
}

/** A group that Nova wrote for one of its shapes: the drawing is in its parts, the rest on the group. */
function composite(r: Reading, e: Item, m: Matrix): Shape {
  const parts = e.own.kids.map((k) => itemOf(r.doc, k, e.masterDoc));
  const of = (kind: string) => parts.filter((p) => userValue(p, NOVA.part) === kind);
  const stored = userValue(e, NOVA.stencil);
  const stencil = stored && hasStencil(stored) ? stored : undefined;
  const [body] = of('body');
  const raw = textOf(e);
  const style: Style = body ? novaStyle(r, body) : { ...defaultStyle(), ...invisible };
  const shape = makeShape(boxOf(r, m, e.w, e.h), stencil ?? 'rect', style, fontOf(r, e, look(r, e), raw.row), '', r.layer ?? r.layerOf(e));
  if (!stencil && body) shape.geometry = outlinesOf(r, body).outlines;

  const [picture] = of('picture');
  if (picture) {
    const target = picture.own.foreign?.rel ? r.rels.get(picture.own.foreign.rel)?.target : undefined;
    const src = target ? r.doc.media.get(target) : null;
    const fit = userValue(picture, NOVA.fit);
    const alt = note(picture, NOVA.alt);
    if (src) shape.image = { src, fit: fit === 'contain' || fit === 'cover' ? fit : 'stretch', ...(typeof alt === 'string' ? { alt } : {}) };
    else r.doc.notes.add('pictures');
  }

  const data = dataOf(e);
  if (data.length) shape.data = data;
  const link = linkOf(r, e);
  if (link) shape.link = link;
  restore(shape, e);

  const texts = of('text');
  if (texts.length) {
    // the compartments of a class
    const seen = joinCompartments(texts.map((p) => textOf(p).value));
    const mine = note(e, NOVA.text);
    shape.text = typeof mine === 'string' && joinCompartments(compartments(resolveText(mine, data))) === seen ? mine : seen;
    const second = texts[1] ?? texts[0]!;
    shape.font = { ...fontOf(r, second, look(r, second), textOf(second).row), align: 'center', valign: 'middle' };
  } else shape.text = novaText(e, shape, raw.value);
  return shape;
}

/** The pools Nova wrote take the titles, sizes and order of their lanes from the lanes of the drawing. */
function settleLanes(page: Page, lanes: LaneRead[]): void {
  const pools = page.shapes.filter((s) => s.container?.kind === 'pool' && s.container.lanes);
  const mine = new Map<Shape, LaneRead[]>();
  for (const lane of lanes) {
    // a copied pool has lanes with the same ids: each goes to the nearest
    const far = (p: Shape) => Math.hypot(centerOf(lane).x - centerOf(p).x, centerOf(lane).y - centerOf(p).y);
    const pool = pools.filter((p) => p.container!.lanes!.some((l) => l.id === lane.id)).sort((a, b) => far(a) - far(b))[0];
    if (pool) mine.set(pool, [...(mine.get(pool) ?? []), lane]);
    else {
      const shape = lane.alone();
      if (shape) page.shapes.push(shape);
    }
  }
  for (const [pool, found] of mine) {
    const c = pool.container!;
    const horizontal = (c.dir ?? 'h') === 'h';
    // the order of the lanes of a turned pool is along its own axes
    const along = (l: LaneRead) => rotatePoint(centerOf(l), centerOf(pool), -pool.rot)[horizontal ? 'y' : 'x'];
    const ids = new Set<string>();
    const sorted = [...found].sort((a, b) => along(a) - along(b)).map((l) => {
      // a lane copied in Visio is one more lane
      const id = ids.has(l.id) ? newId('ln') : l.id;
      ids.add(id);
      return { id, title: l.title.slice(0, 200), size: r2(Math.max(20, horizontal ? l.h : l.w)) };
    });
    pool.container = { ...c, lanes: sorted };
    const total = r2(sorted.reduce((a, l) => a + l.size, 0));
    if (horizontal) pool.h = total;
    else pool.w = total;
  }
}

/** The Nova shape of the drawing of a Visio shape (not of its parts); null when it shows nothing. */
function drawing(r: Reading, e: Item, m: Matrix, text: string, font: Font): Shape | null {
  const t = look(r, e);
  const layer = r.layer ?? r.layerOf(e);
  const line = lineOf(r, e, t);
  const shadow = num(r.doc.cascade.cell(e, 'ShdwPattern', 'FillStyle'), 0) > 0;
  const style: Style = { ...defaultStyle(), ...line, fill: 'none', shadow };
  const box = boxOf(r, m, e.w, e.h);

  const foreign = e.own.foreign ?? e.master?.foreign;
  if (foreign || e.own.attrs.Type === 'Foreign') {
    const rels = e.own.foreign ? r.rels : r.doc.masterRels.get(e.masterDoc?.part ?? '');
    const target = foreign?.rel ? rels?.get(foreign.rel)?.target : undefined;
    const src = target ? r.doc.media.get(target) : null;
    if (!src) {
      // its place is kept, marked, so that nothing disappears without a trace
      r.doc.notes.add('pictures');
      const mark: Style = { ...defaultStyle(), fill: '#f3f3f3', stroke: '#9a9a9a', strokeWidth: 1, dash: 'dash' };
      return makeShape(box, 'rect', mark, { ...font, size: Math.max(6, Math.min(11, box.h / 5)), color: '#666666', align: 'center', valign: 'middle' }, text || 'Imagen no compatible', layer);
    }
    const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
    const whole = near(size(r, e, 'ImgOffsetX', 0), 0) && near(size(r, e, 'ImgOffsetY', 0), 0) && near(size(r, e, 'ImgWidth', e.w), e.w) && near(size(r, e, 'ImgHeight', e.h), e.h);
    return { ...makeShape(box, 'image', { ...style, fill: 'none' }, font, text, layer), image: { src, fit: whole ? 'stretch' : 'cover' } };
  }

  const nova = userValue(e, NOVA.stencil);
  if (nova && hasStencil(nova)) return makeShape(box, nova, novaStyle(r, e), font, text, layer);
  const { outlines, area, extent } = outlinesOf(r, e);
  style.fill = outlines.some((o) => o.fill) ? fillOf(r, e, t) : 'none';

  const known = e.instanceOf && !e.own.kids.length && !e.instanceOf.tops[0]?.kids.length && ![...e.own.sections.keys()].some((k) => k.startsWith('Geometry')) ? STENCIL_OF[e.instanceOf.name.replace(/\.\d+$/, '')] : undefined;
  // the shape of Nova takes the room the drawing of Visio takes
  if (known) return makeShape(extent && extent[2] > 0 && extent[3] > 0 ? boxOfArea(r, m, extent) : box, known, { ...style, fill: fillOf(r, e, t) }, font, text, layer);

  const visible = outlines.filter((o) => (o.fill && style.fill !== 'none') || (o.stroke && style.stroke !== 'none'));
  if (!visible.length) return text ? makeShape(box, 'text', { ...style, ...invisible }, font, text, layer) : null;
  // a rectangle or an ellipse drawn as outlines becomes the shape of the same name
  let simple = recogniseStencil(visible);
  if (simple === 'rect' && num(r.doc.cascade.cell(e, 'Rounding', 'LineStyle'), 0) > 0) simple = 'roundRect';
  const shape = makeShape(boxOfArea(r, m, area), simple ?? 'rect', style, font, text, layer);
  if (!simple) shape.geometry = visible;
  return shape;
}

function recogniseStencil(o: Outline[]): string | null {
  if (o.length !== 1 || !o[0]!.closed || !o[0]!.stroke) return null;
  const pts = o[0]!.pts;
  const eps = 0.02;
  const corner = (x: number, y: number) => (x < eps || x > 1 - eps) && (y < eps || y > 1 - eps);
  if (pts.length === 4 && pts.every(([x, y]) => corner(x, y)) && new Set(pts.map(([x, y]) => `${Math.round(x)}${Math.round(y)}`)).size === 4) return 'rect';
  if (pts.length >= 24 && pts.every(([x, y]) => Math.abs(Math.hypot((x - 0.5) / 0.5, (y - 0.5) / 0.5) - 1) < 0.03)) return 'ellipse';
  return null;
}

/** Adds the shapes of one Visio shape (and of its parts) to the page; returns them. */
function visit(r: Reading, own: Raw, parent: Matrix, context: Master | undefined, group: string | undefined, depth: number): Shape[] {
  if (own.attrs.Type === 'Guide' || depth > 30) return [];
  if (--r.doc.budget < 0) throw new Error('El dibujo tiene demasiadas formas.');
  const e = itemOf(r.doc, own, context);
  // Visio writes the parts of an instance; a file that does not takes those of the master, stretched
  const virtual = !own.kids.length && own.attrs.Master !== undefined ? (e.master?.kids ?? []) : [];
  const kids = own.kids.length ? own.kids : virtual;
  const m = mul(parent, placement(r, e));
  const sheet = own.attrs.ID ?? '';

  const lane = userValue(e, NOVA.lane);
  if (lane !== undefined) {
    const title = textOf(e).value;
    r.lanes.push({ id: lane, title, ...boxOf(r, m, e.w, e.h), alone: () => drawing(r, e, m, title, fontOf(r, e, look(r, e), textOf(e).row)) });
    return [];
  }
  if (userRow(e, NOVA.composite)) {
    const shape = composite(r, e, m);
    if (group) shape.group = group;
    r.page.shapes.push(shape);
    r.sheets.set(sheet, { shape, item: e, m });
    return [shape];
  }
  if (userRow(e, NOVA.imagePart)) {
    const target = own.foreign?.rel ? r.rels.get(own.foreign.rel)?.target : undefined;
    const src = target ? r.doc.media.get(target) : null;
    if (src) r.picture = { src, box: { w: e.w * PX, h: e.h * PX, offset: Math.abs(size(r, e, 'ImgOffsetX', 0)) + Math.abs(size(r, e, 'ImgOffsetY', 0)) > 0.001 } };
    else r.doc.notes.add('pictures');
    return [];
  }
  if (isConnector(r, e)) {
    const id = newId('c');
    r.connectors.push({ item: e, m: parent, id });
    return [];
  }

  const t = look(r, e);
  const hidden = num(r.doc.cascade.cell(e, 'HideText', 'TextStyle'), 0) === 1;
  const raw = textOf(e);
  const text = hidden ? '' : raw.value;
  if (text.trim() && raw.runs > 1) r.doc.notes.add('richText');
  const font = fontOf(r, e, t, raw.row);
  const block = textBlock(r, e);
  const isGroup = kids.length > 0;
  const gid = isGroup ? newId('g') : group;
  const made: Shape[] = [];

  // the drawing of the shape itself goes under its parts; the text of a group, or of a block outside the shape, on top
  const turn = size(r, e, 'TxtAngle', 0) / (e.own.cells.has('TxtAngle') ? 1 : e.sy || 1);
  // Nova draws the text of its own shapes where they say
  const apart = !userRow(e, NOVA.stencil) && !!text.trim() && (isGroup || block.outside || Math.abs(Math.sin(turn / 2)) > 0.01);
  const display = isGroup ? num(r.doc.cascade.cell(e, 'DisplayMode', 'LineStyle'), 2) : 2;
  const main = display === 0 ? null : drawing(r, e, m, apart ? '' : text, font);
  if (main && !apart && main.text && main.style.fill === 'none' && !main.image) main.font = readable(r, e, t, raw.row, main.font);
  const push = (s: Shape) => {
    if (gid) s.group = gid;
    r.page.shapes.push(s);
    made.push(s);
  };
  const behind = !isGroup || display === 1;
  if (main && behind) push(main);

  if (isGroup) {
    // parts of a master used as they are: stretched from the size of the master
    const inner = virtual.length ? mul(m, [e.sx, 0, 0, e.sy, 0, 0, 0]) : m;
    const masterDoc = virtual.length ? undefined : e.masterDoc;
    for (const k of kids) made.push(...visit(r, k, inner, masterDoc, gid, depth + 1));
  }
  if (main && !behind) push(main);
  let label: Shape | undefined;
  if (apart) {
    const box = boxOf(r, m, block.w, block.h, block.at);
    // Nova turns clockwise, Visio the other way
    box.rot = degrees(-(m[6] + turn));
    delete box.flipH;
    delete box.flipV;
    // Nova only estimates how wide text is: the box of a label has room for its longest word
    const room = Math.max(...text.split(/\s+/).map((w) => textWidth(w, font.size, font.bold, font.family))) + 12;
    if (room > box.w) {
      box.x = r2(box.x - (room - box.w) / 2);
      box.w = r2(room);
    }
    const [cx, cy] = [box.x + box.w / 2, box.y + box.h / 2];
    const covered = made.some((s) => (s.style.fill !== 'none' || s.image) && cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h);
    label = makeShape(box, 'text', { ...defaultStyle(), ...invisible }, covered ? font : readable(r, e, t, raw.row, font), text, r.layer ?? r.layerOf(e));
    push(label);
  }

  // data, link and pictures belong to the shape as a whole
  const primary = label ?? main ?? made[0];
  if (primary) {
    const data = dataOf(e);
    if (data.length) primary.data = data;
    const link = linkOf(r, e);
    if (link) primary.link = link;
  }
  if (main) {
    restore(main, e);
    if (!apart && userRow(e, NOVA.text)) main.text = novaText(e, main, text);
  }
  if (r.picture && main && userRow(e, NOVA.stencil)) {
    const p = r.picture;
    const smaller = p.box.w < main.w - 0.5 || p.box.h < main.h - 0.5;
    main.image = { src: p.src, fit: p.box.offset && !smaller ? 'cover' : smaller ? 'contain' : 'stretch' };
    r.picture = undefined;
  }

  if (isGroup) {
    if (made.length >= 2) (r.page.groups ??= []).push({ id: gid!, ...(group ? { parent: group } : {}) });
    else for (const s of made) if (s.group === gid) s.group = group;
  }
  // connectors glued to this sheet reach its biggest drawn shape
  const area = (s: Shape) => s.w * s.h * (s.stencil === 'text' ? 0.001 : 1);
  const target = [...made].sort((a, b) => area(b) - area(a))[0];
  if (target) r.sheets.set(sheet, { shape: target, item: e, m });
  return made;
}

function addConnectors(r: Reading, connects: Node[]): void {
  const glue = new Map<string, { begin?: { sheet: string; cell: string }; end?: { sheet: string; cell: string } }>();
  for (const cn of connects) {
    const g = glue.get(String(cn['@_FromSheet'])) ?? {};
    const to = { sheet: String(cn['@_ToSheet']), cell: String(cn['@_ToCell'] ?? '') };
    if (cn['@_FromCell'] === 'BeginX') g.begin = to;
    if (cn['@_FromCell'] === 'EndX') g.end = to;
    glue.set(String(cn['@_FromSheet']), g);
  }
  const point = (p: Pt) => ({ x: r2(p[0] * PX), y: r2((r.height - p[1]) * PX) });
  for (const { item: e, m, id } of r.connectors) {
    const t = look(r, e);
    const ours = userValue(e, NOVA.connector);
    const g = glue.get(e.own.attrs.ID ?? '');
    const geo = outlinesOf(r, e);
    const first = geo.outlines[0]?.pts;
    // where the ends are: what Nova wrote is in the geometry; Visio keeps them in BeginX… EndY
    const local = placement(r, e);
    const endAt = (k: 0 | 1): End => {
      // files written by earlier versions of Nova have no ends: the line says where they are
      if (ours && !e.own.cells.has('BeginX') && first?.length) {
        const [nx, ny] = k === 0 ? first[0]! : first[first.length - 1]!;
        return point(apply(mul(m, local), [nx * e.w, (1 - ny) * e.h]));
      }
      const n = k === 0 ? 'Begin' : 'End';
      return point(apply(m, [size(r, e, `${n}X`, 0), size(r, e, `${n}Y`, 0)]));
    };
    const glued = (to: { sheet: string; cell: string } | undefined, fallback: End): End => {
      const target = to && r.sheets.get(to.sheet);
      if (!target) return fallback;
      let port: number | 'auto' = 'auto';
      const row = /^Connections\.(?:X(\d+)|([^.]+)\.X)/.exec(to.cell);
      if (row) {
        const rows = mergedRows(target.item, 'Connection');
        const found = row[1] ? rows[Number(row[1]) - 1] : rows.find((x) => x.key === row[2]);
        const cell = (n: string) => found?.own?.cells.get(n) ?? found?.master?.cells.get(n);
        const cx = cell('X');
        const cy = cell('Y');
        if (cx && cy) {
          const at = point(apply(target.m, [masterNumber(cx, target.item, 1, 0), masterNumber(cy, target.item, 1, 0)]));
          const near = portsOf(target.shape).map((p) => ({ i: p.index, d: Math.hypot(p.point.x - at.x, p.point.y - at.y) })).sort((a, b) => a.d - b.d)[0];
          if (near && near.d < 12) port = near.i;
        }
      }
      return { shape: target.shape.id, port };
    };
    const line = lineOf(r, e, t);
    const stored = userValue(e, NOVA.arrows)?.split(',') ?? [];
    const arrow = (n: string, themed: number | undefined, mine: string | undefined): Arrow => {
      const v = r.doc.cascade.cell(e, n, 'LineStyle');
      const index = v === THEMED ? (themed ?? 0) : num(v, 0);
      // the head chosen in Nova stays while Visio shows the one written for it
      return mine && VISIO_ARROW[mine as Arrow] === index ? (mine as Arrow) : (NOVA_ARROW[index] ?? 'arrow');
    };
    const raw = textOf(e);
    const text = num(r.doc.cascade.cell(e, 'HideText', 'TextStyle'), 0) === 1 ? '' : raw.value;
    if (text.trim() && raw.runs > 1) r.doc.notes.add('richText');
    const bends = first?.length ?? 2;
    const layer = r.layer ?? r.layerOf(e);
    r.page.connectors.push({
      id,
      from: glued(g?.begin, endAt(0)),
      to: glued(g?.end, endAt(1)),
      routing: (ours as Connector['routing'] | undefined) ?? (geo.arcs ? 'curve' : bends > 2 ? 'elbow' : 'straight'),
      stroke: line.stroke === 'none' ? '#000000' : line.stroke,
      strokeWidth: line.strokeWidth,
      dash: line.dash,
      startArrow: arrow('BeginArrow', t?.startArrow, stored[0]),
      endArrow: arrow('EndArrow', t?.endArrow, stored[1]),
      text,
      font: { ...fontOf(r, e, t, raw.row), align: 'center', valign: 'middle' },
      ...(layer ? { layer } : {}),
    });
  }
}

// ------------------------------------------------------------ pages

interface RawPage {
  id: string;
  name: string;
  background: boolean;
  back?: string;
  sheet: Raw;
  contents?: Node;
  rels: Map<string, { type: string; target: string }>;
}

function pageTheme(doc: Doc, sheet: Raw): PageTheme | null {
  const n = (k: string) => num(sheet.cells.get(k)?.v, 0);
  const byId = (id: number) => doc.themes.find((t) => t.id === id);
  const colors = byId(n('ColorSchemeIndex')) ?? byId(n('ThemeIndex'));
  // 0 means the page has no theme
  if (!colors || (!n('ColorSchemeIndex') && !n('ThemeIndex'))) return null;
  return { colors, format: byId(n('EffectSchemeIndex')) ?? colors, connectors: byId(n('ConnectorSchemeIndex')) ?? colors, fonts: byId(n('FontSchemeIndex')) ?? colors, variationColor: n('VariationColorIndex'), variationStyle: n('VariationStyleIndex') };
}

export async function importVsdx(data: Uint8Array): Promise<VsdxResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error('El archivo no es un .vsdx válido (los .vsd antiguos no se pueden abrir: guárdalo como .vsdx en Visio).');
  }
  const documentXml = await zip.file('visio/document.xml')?.async('string');
  if (documentXml === undefined) throw new Error('El archivo no es un dibujo de Visio (.vsdx).');
  const docRels = await relsOf(zip, 'visio/document.xml');
  const partOf = (type: string, d: string) => [...docRels.values()].find((x) => x.type.endsWith(type))?.target ?? d;
  const pagesPart = partOf('/pages', 'visio/pages/pages.xml');
  const pagesXml = await zip.file(pagesPart)?.async('string');
  if (!pagesXml) throw new Error('El dibujo no tiene páginas.');
  const pageRels = await relsOf(zip, pagesPart);

  const root = parseXml(documentXml)?.VisioDocument;
  const sheets = new Map<string, Raw>((root?.StyleSheets?.StyleSheet ?? []).map((s: Node) => [String(s['@_ID']), readShape(s)]));
  const palette = new Map<number, string>((root?.Colors?.ColorEntry ?? []).map((c: Node) => [Number(c['@_IX']), String(c['@_RGB']).toLowerCase()]));
  const doc: Doc = { zip, cascade: new Cascade(sheets), masters: new Map(), masterRels: new Map(), themes: [], palette, media: new Map(), notes: new Notes(), budget: MAX_SHAPES };
  for (const rel of docRels.values()) {
    if (!rel.type.endsWith('/theme')) continue;
    const xml = await zip.file(rel.target)?.async('string');
    const theme = xml ? parseTheme(xml) : null;
    if (theme) doc.themes.push(theme);
  }

  // masters (the shapes that page shapes are instances of)
  const mastersPart = partOf('/masters', '');
  const mx = mastersPart ? await zip.file(mastersPart)?.async('string') : undefined;
  if (mx) {
    const mrels = await relsOf(zip, mastersPart);
    for (const m of parseXml(mx)?.Masters?.Master ?? []) {
      const rid = m?.Rel?.[0]?.['@_id'];
      const part = rid ? mrels.get(rid)?.target : undefined;
      const body = part ? await zip.file(part)?.async('string') : undefined;
      if (!part || !body) continue;
      const tops: Raw[] = (parseXml(body)?.MasterContents?.Shapes?.Shape ?? []).map((s: Node) => readShape(s));
      doc.masters.set(String(m['@_ID']), { name: String(m['@_NameU'] ?? m['@_Name'] ?? ''), tops, byId: indexShapes(tops), part });
      const rels = await relsOf(zip, part);
      doc.masterRels.set(part, rels);
      await loadMedia(doc, rels);
    }
  }

  const raw: RawPage[] = [];
  for (const pg of parseXml(pagesXml)?.Pages?.Page ?? []) {
    const rid = pg?.Rel?.[0]?.['@_id'];
    const part = rid ? pageRels.get(rid)?.target : undefined;
    const xml = part ? await zip.file(part)?.async('string') : undefined;
    const rels = part ? await relsOf(zip, part) : new Map();
    await loadMedia(doc, rels);
    raw.push({
      id: String(pg['@_ID']),
      name: String(pg['@_Name'] ?? pg['@_NameU'] ?? `Página ${raw.length + 1}`),
      background: pg['@_Background'] === '1',
      ...(pg['@_BackPage'] !== undefined ? { back: String(pg['@_BackPage']) } : {}),
      sheet: readShape(pg.PageSheet?.[0] ?? pg.PageSheet),
      contents: xml ? parseXml(xml)?.PageContents : undefined,
      rels,
    });
  }

  // a background page used by another page goes into it; one nobody uses stays as a page
  const used = new Set(raw.map((p) => p.back).filter((x): x is string => !!x && raw.some((q) => q.id === x && q.background)));
  const shown = raw.filter((p) => !(p.background && used.has(p.id)));
  if (used.size) doc.notes.add('background', used.size);

  const diagram = newDiagram('Dibujo importado');
  diagram.pages = [];
  const pageNames = new Map<string, string>();
  const ids = shown.map((p) => {
    const id = newId('pg');
    pageNames.set(p.name, id);
    return id;
  });
  const pageByVisioId = new Map<string, { page: Page; sheetToShape: Map<string, string> }>();

  shown.forEach((p, index) => {
    const cell = (k: string, d: number) => num(p.sheet.cells.get(k)?.v, d);
    // a scaled drawing is measured in drawing units: the paper is smaller by this factor
    const scale = cell('PageScale', 1) / (cell('DrawingScale', 1) || 1) || 1;
    const W = cell('PageWidth', 11.69) * scale;
    const H = cell('PageHeight', 8.27) * scale;
    const page: Page = { id: ids[index]!, name: p.name, width: Math.round(W * PX), height: Math.round(H * PX), grid: 8, background: '#ffffff', shapes: [], connectors: [] };
    diagram.pages.push(page);

    // layers
    const rows = [...(p.sheet.sections.get('Layer')?.rows.values() ?? [])];
    const chain: RawPage[] = [];
    for (let b = p.back; b && chain.length < 8; ) {
      const q = raw.find((x) => x.id === b && x.background);
      if (!q || chain.includes(q)) break;
      chain.unshift(q);
      b = q.back;
    }
    const layers: Layer[] = rows.map((row) => {
      const v = (n: string, d: number) => num(row.cells.get(n)?.v, d);
      return { id: newId('ly'), name: row.cells.get('Name')?.v || `Capa ${Number(row.key) + 1}`, visible: v('Visible', 1) === 1, locked: v('Lock', 0) === 1, printable: v('Print', 1) === 1 };
    });
    const layerByIx = new Map(rows.map((row, i) => [row.key, layers[i]!]));
    const lanes: LaneRead[] = [];
    const sheetsOnPage = new Map<string, { shape: Shape; item: Item; m: Matrix }>();
    const back: Layer | undefined = chain.length ? { id: newId('ly'), name: 'Fondo', visible: true, locked: true, printable: true } : undefined;

    const read = (q: RawPage, forced: string | undefined) => {
      const theme = pageTheme(doc, q.sheet);
      doc.cascade.themed = !!theme;
      const r: Reading = {
        doc,
        theme,
        page,
        height: H,
        rels: q.rels,
        pageNames,
        lanes,
        layer: forced,
        sheets: forced ? new Map() : sheetsOnPage,
        connectors: [],
        glued: new Set((q.contents?.Connects?.Connect ?? []).map((c: Node) => String(c['@_FromSheet']))),
        layerOf: (e) => {
          const member = doc.cascade.cell(e, 'LayerMember', 'LineStyle');
          const mine = (typeof member === 'string' ? member.split(';') : []).map((k) => layerByIx.get(k)).filter((l): l is Layer => !!l);
          if (mine.length > 1) doc.notes.add('manyLayers');
          const chosen = mine.find((l) => l.visible) ?? mine[0];
          return chosen?.id;
        },
      };
      const root: Matrix = [scale, 0, 0, scale, 0, 0, 0];
      for (const s of q.contents?.Shapes?.Shape ?? []) visit(r, readShape(s), scale === 1 ? IDENTITY : root, undefined, undefined, 0);
      addConnectors(r, q.contents?.Connects?.Connect ?? []);
    };
    for (const q of chain) read(q, back!.id);
    read(p, undefined);

    settleLanes(page, lanes);

    if (layers.length || back) {
      // what is on no layer of Visio needs one of its own: Nova puts it on the first
      // (a group, which draws nothing of its own, may well be on none)
      const needsDefault = !layers.length || [...page.shapes, ...page.connectors].some((it) => !it.layer);
      const free: Layer | undefined = needsDefault ? { id: newId('ly'), name: layers.length ? 'Sin capa' : 'Capa 1', visible: true, locked: false, printable: true } : undefined;
      if (free) for (const it of [...page.shapes, ...page.connectors]) if (!it.layer) it.layer = free.id;
      page.layers = [...(free ? [free] : []), ...layers, ...(back ? [back] : [])];
      const usable = (l: Layer | undefined) => !!l && l.visible && !l.locked;
      const marked = layers[rows.findIndex((row) => row.cells.get('Active')?.v === '1')];
      page.activeLayer = (usable(marked) ? marked! : (page.layers.find(usable) ?? page.layers[0]!)).id;
    }
    if (page.shapes.some((s) => s.container)) {
      // what is inside each container follows from where it is, as in Nova
      Object.assign(page, assignMembership(page));
    }
    pageByVisioId.set(p.id, { page, sheetToShape: new Map([...sheetsOnPage].map(([k, v]) => [k, v.shape.id])) });
  });

  await readComments(zip, docRels, pageByVisioId);
  if (!diagram.pages.length) diagram.pages.push(newDiagram().pages[0]!);
  return { diagram, warnings: doc.notes.list() };
}

/** Visio keeps the comments flat; those on the same shape (or the same page, if they are about the page) are one conversation. */
async function readComments(zip: JSZip, docRels: Map<string, { type: string; target: string }>, pages: Map<string, { page: Page; sheetToShape: Map<string, string> }>): Promise<void> {
  const path = [...docRels.values()].find((r) => r.type.endsWith('/comments'))?.target;
  const xml = path ? await zip.file(path)?.async('string') : undefined;
  if (!xml) return;
  const doc = parseXml(xml)?.Comments;
  const people = new Map<string, { name: string; initials: string }>();
  for (const a of doc?.AuthorList?.AuthorEntry ?? []) people.set(String(a['@_ID']), { name: String(a['@_Name'] ?? 'Autor'), initials: String(a['@_Initials'] ?? '') });
  const byKey = new Map<string, CommentThread>();
  const entries = [...(doc?.CommentList?.CommentEntry ?? [])].sort((x: Node, y: Node) => Number(x['@_CommentID'] ?? 0) - Number(y['@_CommentID'] ?? 0));
  for (const e of entries) {
    const home = pages.get(String(e['@_PageID']));
    const text = typeof e === 'string' ? e : String(e['#text'] ?? '');
    if (!home || !text) continue;
    const shape = e['@_ShapeID'] !== undefined ? home.sheetToShape.get(String(e['@_ShapeID'])) : undefined;
    const key = `${String(e['@_PageID'])}|${shape ?? ''}`;
    const who = people.get(String(e['@_AuthorID'])) ?? { name: 'Autor', initials: '' };
    const utc = (v: unknown): string => {
      const t = typeof v === 'string' ? Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(v) ? v : `${v}Z`) : NaN;
      return new Date(Number.isNaN(t) ? 0 : t).toISOString();
    };
    const id = newId('m');
    const msg = { id, author: who.name, ...(who.initials ? { initials: who.initials } : {}), date: utc(e['@_Date']), text, ...(e['@_EditDate'] && e['@_EditDate'] !== e['@_Date'] ? { edited: utc(e['@_EditDate']) } : {}) };
    let th = byKey.get(key);
    if (!th) {
      th = { id, ...(shape ? { shape } : {}), messages: [] };
      byKey.set(key, th);
      (home.page.threads ??= []).push(th);
    }
    th.messages.push(msg);
  }
}
