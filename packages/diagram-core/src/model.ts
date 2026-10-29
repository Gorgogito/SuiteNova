/** Units are CSS pixels (96 per inch). The y axis points down. */

export type Dash = 'solid' | 'dash' | 'dot' | 'dashdot';
export type Arrow = 'none' | 'arrow' | 'open' | 'diamond' | 'diamondOpen' | 'oval' | 'bar';
export type Routing = 'straight' | 'elbow' | 'curve';

export interface Style {
  /** Colour or "none". */
  fill: string;
  stroke: string;
  strokeWidth: number;
  dash: Dash;
  /** 0–1. */
  opacity: number;
  shadow: boolean;
}

export interface Font {
  family: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
}

/** One outline of a free-form shape: points in 0–1 coordinates of the shape box (y down). Used by imported shapes. */
export interface Outline {
  pts: [number, number][];
  closed: boolean;
  fill: boolean;
  stroke: boolean;
}

/** A hyperlink of a shape: an address, or another page of the diagram. */
export interface ShapeLink {
  url?: string;
  /** Id of a page of the same diagram. */
  page?: string;
  tip?: string;
}

/** One piece of data carried by a shape ("shape data"). */
export interface DataField {
  name: string;
  value: string;
  type?: 'text' | 'number' | 'date' | 'bool';
}

/** A picture placed on a shape (the stencil "image"); `src` is a data: URL. */
export interface ShapeImage {
  src: string;
  fit: 'stretch' | 'contain' | 'cover';
}

/** A lane of a swimlane: its title and its size across the lanes' axis (height of a horizontal lane, width of a vertical one). */
export interface Lane {
  id: string;
  title: string;
  size: number;
}

/**
 * A shape that holds other shapes. Members point to it with `parent`; the container follows them when it moves and, with
 * `autoSize`, grows (or fits) around them. A pool is a container divided into lanes.
 */
export interface ContainerProps {
  kind: 'box' | 'pool';
  /** never: the size is yours; grow: as needed, never smaller than it is; fit: always exactly around the members. */
  autoSize: 'never' | 'grow' | 'fit';
  /** Space kept between the members and the edge. */
  margin: number;
  /** Height (or width, for vertical lanes) of the title band. */
  header: number;
  /** Pools: "h" lays the lanes one below the other (each lane runs left to right), "v" side by side. */
  dir?: 'h' | 'v';
  lanes?: Lane[];
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  /** Shapes of a locked layer cannot be selected or changed. */
  locked: boolean;
  /** Printed and exported when true. */
  printable: boolean;
}

/** A group: shapes with the same `group` id move, resize and rotate together. Groups can be nested through `parent`. */
export interface Group {
  id: string;
  parent?: string;
}

export interface Shape {
  id: string;
  /** Stencil id, see `stencils.ts`. */
  stencil: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise, around the centre. */
  rot: number;
  text: string;
  style: Style;
  font: Font;
  locked: boolean;
  /** Free-form outlines; when present they are drawn instead of the stencil. */
  geometry?: Outline[];
  /** Mirrored left-right / top-bottom (the text is never mirrored). */
  flipH?: boolean;
  flipV?: boolean;
  image?: ShapeImage;
  link?: ShapeLink;
  data?: DataField[];
  /** Show the shape data under the shape. */
  showData?: boolean;
  layer?: string;
  group?: string;
  /** Present on containers and pools. */
  container?: ContainerProps;
  /** The container (or pool) this shape is inside, and its lane when that is a pool. */
  parent?: string;
  lane?: string;
}

/** An end of a connector: glued to a connection point of a shape, or free on the page. */
export type End = { shape: string; port: number | 'auto' } | { x: number; y: number };

export interface Connector {
  id: string;
  from: End;
  to: End;
  routing: Routing;
  stroke: string;
  strokeWidth: number;
  dash: Dash;
  startArrow: Arrow;
  endArrow: Arrow;
  text: string;
  font: Font;
  layer?: string;
}

export interface Page {
  id: string;
  name: string;
  width: number;
  height: number;
  grid: number;
  background: string;
  /** Back to front. */
  shapes: Shape[];
  connectors: Connector[];
  layers?: Layer[];
  /** Layer that new shapes go to. */
  activeLayer?: string;
  groups?: Group[];
  /** Distance between connectors that end at the same connection point; 0 makes them meet at the point. */
  spread?: number;
}

export interface Diagram {
  version: 1;
  name: string;
  pages: Page[];
}

let counter = 0;
export const newId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const isGlued = (e: End): e is { shape: string; port: number | 'auto' } => 'shape' in e;

export const defaultStyle = (): Style => ({ fill: '#ffffff', stroke: '#2f4f6f', strokeWidth: 1.5, dash: 'solid', opacity: 1, shadow: false });
export const defaultFont = (): Font => ({ family: 'Segoe UI', size: 13, color: '#1b1b1b', bold: false, italic: false, underline: false, align: 'center', valign: 'middle' });

export const PAGE_SIZES: Record<string, [number, number]> = {
  A4: [794, 1123],
  A3: [1123, 1587],
  A5: [559, 794],
  Letter: [816, 1056],
  Legal: [816, 1344],
  '16:9': [1280, 720],
  '4:3': [1024, 768],
};

export function newPage(name = 'Página 1'): Page {
  // landscape A4 by default
  return { id: newId('pg'), name, width: 1123, height: 794, grid: 8, background: '#ffffff', shapes: [], connectors: [] };
}

export function newDiagram(name = 'Diagrama nuevo'): Diagram {
  return { version: 1, name, pages: [newPage()] };
}

export function pageById(d: Diagram, id: string): Page | undefined {
  return d.pages.find((p) => p.id === id);
}
