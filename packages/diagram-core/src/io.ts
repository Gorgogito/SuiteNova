import type { ContainerProps, DataField, Group, Lane, Layer, ShapeImage, ShapeLink } from './model';
import { defaultFont, defaultStyle, newId, type Outline, type Arrow, type Connector, type Dash, type Diagram, type End, type Font, type Page, type Routing, type Shape, type Style } from './model';
import { hasStencil } from './stencils';

export function serializeDiagram(d: Diagram): string {
  return JSON.stringify({ format: 'novadiagram', ...d }, null, 1);
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d);
const color = (v: unknown, d: string): string => (typeof v === 'string' && /^(none|#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}|rgba?\([\d\s.,%]+\))$/.test(v) ? v : d);

const DASH = ['solid', 'dash', 'dot', 'dashdot'] as const satisfies readonly Dash[];
const ARROWS = ['none', 'arrow', 'open', 'diamond', 'diamondOpen', 'oval', 'bar'] as const satisfies readonly Arrow[];
const ROUTING = ['straight', 'elbow', 'curve'] as const satisfies readonly Routing[];

function readStyle(r: any): Style {
  const d = defaultStyle();
  return {
    fill: color(r?.fill, d.fill),
    stroke: color(r?.stroke, d.stroke),
    strokeWidth: Math.min(40, Math.max(0, num(r?.strokeWidth, d.strokeWidth))),
    dash: oneOf(r?.dash, DASH, 'solid'),
    opacity: Math.min(1, Math.max(0, num(r?.opacity, 1))),
    shadow: bool(r?.shadow),
  };
}

function readFont(r: any): Font {
  const d = defaultFont();
  return {
    family: str(r?.family, d.family).slice(0, 80),
    size: Math.min(200, Math.max(4, num(r?.size, d.size))),
    color: color(r?.color, d.color),
    bold: bool(r?.bold),
    italic: bool(r?.italic),
    underline: bool(r?.underline),
    align: oneOf(r?.align, ['left', 'center', 'right'] as const, 'center'),
    valign: oneOf(r?.valign, ['top', 'middle', 'bottom'] as const, 'middle'),
  };
}

function readOutlines(raw: any[]): Outline[] {
  return raw.slice(0, 200).map((o: any): Outline => ({
    pts: (Array.isArray(o?.pts) ? o.pts : []).slice(0, 5000).map((p: any): [number, number] => [num(p?.[0]), num(p?.[1])]),
    closed: bool(o?.closed),
    fill: bool(o?.fill, true),
    stroke: bool(o?.stroke, true),
  }));
}

/** A container or pool, checked. */
function readContainer(r: any): ContainerProps | undefined {
  if (!r || typeof r !== 'object') return undefined;
  const kind = oneOf(r.kind, ['box', 'pool'] as const, 'box');
  const lanes: Lane[] = [];
  if (kind === 'pool') {
    for (const l of Array.isArray(r.lanes) ? r.lanes.slice(0, 100) : []) {
      let id = str(l?.id).slice(0, 60) || newId('ln');
      while (lanes.some((x) => x.id === id)) id = newId('ln');
      lanes.push({ id, title: str(l?.title).slice(0, 200), size: Math.min(10000, Math.max(20, num(l?.size, 100))) });
    }
    if (!lanes.length) return undefined;
  }
  return {
    kind,
    autoSize: oneOf(r.autoSize, ['never', 'grow', 'fit'] as const, 'grow'),
    margin: Math.min(200, Math.max(0, num(r.margin, 16))),
    header: Math.min(200, Math.max(0, num(r.header, 28))),
    ...(kind === 'pool' ? { dir: oneOf(r.dir, ['h', 'v'] as const, 'h'), lanes } : {}),
  };
}

const FIELD_TYPES = ['text', 'number', 'date', 'bool'] as const;

/** Picture, link and data of a shape, checked: a damaged file cannot put odd values into the editor. */
function readExtras(s: any): { image?: ShapeImage; link?: ShapeLink; data?: DataField[]; showData?: boolean } {
  const out: { image?: ShapeImage; link?: ShapeLink; data?: DataField[]; showData?: boolean } = {};
  if (s?.image && typeof s.image.src === 'string' && /^data:image\/(png|jpeg|gif|webp|svg\+xml|bmp);/.test(s.image.src) && s.image.src.length < 12_000_000) {
    out.image = { src: s.image.src, fit: oneOf(s.image.fit, ['stretch', 'contain', 'cover'] as const, 'contain') };
  }
  if (s?.link && typeof s.link === 'object') {
    const url = str(s.link.url).slice(0, 2000);
    const page = str(s.link.page).slice(0, 100);
    const tip = str(s.link.tip).slice(0, 300);
    // only web, mail and file addresses are followed; anything else (javascript:, data:) is dropped
    const safeUrl = /^(https?:|mailto:|file:|\/\/|#)/i.test(url) ? url : '';
    if (safeUrl || page) out.link = { ...(safeUrl ? { url: safeUrl } : {}), ...(page ? { page } : {}), ...(tip ? { tip } : {}) };
  }
  if (Array.isArray(s?.data)) {
    const data = s.data.slice(0, 200).map((d: any): DataField => ({ name: str(d?.name).slice(0, 80), value: str(d?.value).slice(0, 2000), type: oneOf(d?.type, FIELD_TYPES, 'text') })).filter((d: DataField) => d.name);
    if (data.length) out.data = data;
  }
  if (bool(s?.showData)) out.showData = true;
  return out;
}

export interface ParseResult {
  diagram: Diagram;
  warnings: string[];
}

/** Read a .novadiagram file. Values are checked and repaired so a damaged file cannot break the editor. */
export function parseDiagram(text: string): ParseResult {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un diagrama de Nova Diagram (JSON no válido).');
  }
  if (!raw || raw.format !== 'novadiagram' || !Array.isArray(raw.pages) || raw.pages.length === 0) throw new Error('El archivo no es un diagrama de Nova Diagram.');
  const warnings: string[] = [];
  const pageIds = new Set<string>();
  const pages: Page[] = raw.pages.map((rp: any, pi: number): Page => {
    let pid = str(rp?.id) || newId('pg');
    while (pageIds.has(pid)) pid = newId('pg');
    pageIds.add(pid);
    const ids = new Set<string>();
    const unique = (v: unknown, prefix: string) => {
      let id = str(v) || newId(prefix);
      while (ids.has(id)) id = newId(prefix);
      ids.add(id);
      return id;
    };
    const shapes: Shape[] = (Array.isArray(rp?.shapes) ? rp.shapes : []).map((s: any): Shape => {
      const stencil = str(s?.stencil);
      if (!hasStencil(stencil)) warnings.push(`Página ${pi + 1}: la forma "${stencil}" no existe y se dibuja como rectángulo.`);
      return {
        id: unique(s?.id, 's'),
        stencil: hasStencil(stencil) ? stencil : 'rect',
        x: num(s?.x),
        y: num(s?.y),
        w: Math.min(20000, Math.max(1, num(s?.w, 100))),
        h: Math.min(20000, Math.max(1, num(s?.h, 60))),
        rot: ((num(s?.rot) % 360) + 360) % 360,
        text: str(s?.text).slice(0, 5000),
        style: readStyle(s?.style),
        font: readFont(s?.font),
        locked: bool(s?.locked),
        ...(Array.isArray(s?.geometry) && s.geometry.length ? { geometry: readOutlines(s.geometry) } : {}),
        ...(s?.flipH === true ? { flipH: true } : {}),
        ...(s?.flipV === true ? { flipV: true } : {}),
        ...readExtras(s),
      };
    });
    const layers: Layer[] = [];
    for (const l of Array.isArray(rp?.layers) ? rp.layers.slice(0, 100) : []) {
      let id = str(l?.id).slice(0, 60) || newId('ly');
      while (layers.some((x) => x.id === id)) id = newId('ly');
      layers.push({ id, name: str(l?.name, 'Capa').slice(0, 80) || 'Capa', visible: bool(l?.visible, true), locked: bool(l?.locked), printable: bool(l?.printable, true) });
    }
    const layerSet = new Set(layers.map((l) => l.id));
    const groups: Group[] = [];
    for (const g of Array.isArray(rp?.groups) ? rp.groups.slice(0, 5000) : []) {
      const id = str(g?.id).slice(0, 60);
      if (id && !groups.some((x) => x.id === id)) groups.push({ id, ...(typeof g?.parent === 'string' && g.parent !== id ? { parent: g.parent } : {}) });
    }
    // a group that sits inside itself (a damaged file) is cut loose
    for (const g of groups) {
      let p = g.parent;
      for (let i = 0; p && i < 60; i++) p = groups.find((x) => x.id === p)?.parent;
      if (p) delete g.parent;
      else if (g.parent && !groups.some((x) => x.id === g.parent)) delete g.parent;
    }
    const groupSet = new Set(groups.map((g) => g.id));
    for (const sh of shapes) {
      const raw = (Array.isArray(rp?.shapes) ? rp.shapes : []).find((x: any) => x?.id === sh.id);
      if (layers.length && typeof raw?.layer === 'string' && layerSet.has(raw.layer)) sh.layer = raw.layer;
      if (typeof raw?.group === 'string' && groupSet.has(raw.group)) sh.group = raw.group;
      const cont = readContainer(raw?.container);
      if (cont) sh.container = cont;
      if (typeof raw?.parent === 'string' && raw.parent !== sh.id) sh.parent = raw.parent.slice(0, 80);
      if (typeof raw?.lane === 'string') sh.lane = raw.lane.slice(0, 80);
    }
    // a parent that is not a container of this page (a damaged file) is dropped
    const containerIds = new Set(shapes.filter((s) => s.container).map((s) => s.id));
    for (const sh of shapes) {
      if (sh.parent && !containerIds.has(sh.parent)) {
        delete sh.parent;
        delete sh.lane;
      }
    }
    const shapeIds = new Set(shapes.map((s) => s.id));
    const end = (e: any): End | null => {
      if (e && typeof e.shape === 'string') {
        if (!shapeIds.has(e.shape)) return null;
        return { shape: e.shape, port: e.port === 'auto' ? 'auto' : Math.max(0, Math.round(num(e.port))) };
      }
      if (e && typeof e.x === 'number' && typeof e.y === 'number') return { x: e.x, y: e.y };
      return null;
    };
    const connectors: Connector[] = [];
    for (const c of Array.isArray(rp?.connectors) ? rp.connectors : []) {
      const from = end(c?.from);
      const to = end(c?.to);
      if (!from || !to) {
        warnings.push(`Página ${pi + 1}: se omitió un conector que apuntaba a una forma que no existe.`);
        continue;
      }
      connectors.push({
        id: unique(c?.id, 'c'),
        from,
        to,
        routing: oneOf(c?.routing, ROUTING, 'elbow'),
        stroke: color(c?.stroke, '#2f4f6f'),
        strokeWidth: Math.min(40, Math.max(0.25, num(c?.strokeWidth, 1.5))),
        dash: oneOf(c?.dash, DASH, 'solid'),
        startArrow: oneOf(c?.startArrow, ARROWS, 'none'),
        endArrow: oneOf(c?.endArrow, ARROWS, 'arrow'),
        text: str(c?.text).slice(0, 1000),
        font: readFont(c?.font ?? { size: 12 }),
        ...(layers.length && typeof c?.layer === 'string' && layerSet.has(c.layer) ? { layer: c.layer } : {}),
      });
    }
    return {
      id: pid,
      name: str(rp?.name, `Página ${pi + 1}`).slice(0, 100) || `Página ${pi + 1}`,
      width: Math.min(50000, Math.max(100, num(rp?.width, 1123))),
      height: Math.min(50000, Math.max(100, num(rp?.height, 794))),
      grid: Math.min(200, Math.max(0, num(rp?.grid, 8))),
      background: color(rp?.background, '#ffffff'),
      shapes,
      connectors,
      ...(layers.length ? { layers, ...(typeof rp?.activeLayer === 'string' && layerSet.has(rp.activeLayer) ? { activeLayer: rp.activeLayer } : {}) } : {}),
      ...(groups.length ? { groups } : {}),
      ...(typeof rp?.spread === 'number' && Number.isFinite(rp.spread) ? { spread: Math.min(60, Math.max(0, rp.spread)) } : {}),
    };
  });
  return { diagram: { version: 1, name: str(raw.name, 'Diagrama').slice(0, 200), pages }, warnings };
}
