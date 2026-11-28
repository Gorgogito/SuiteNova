import { XMLParser } from 'fast-xml-parser';
import type JSZip from 'jszip';

/*
 * The parts of a .vsdx as plain objects: shapes with their cells and sections, the style sheets and the masters. A Visio
 * shape only stores what differs from its master and its style sheets; `Cascade` looks a cell up through that chain.
 */

export type Node = any;

export const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) => ['Shape', 'Section', 'Row', 'Cell', 'Page', 'Master', 'Relationship', 'Connect', 'AuthorEntry', 'CommentEntry', 'Rel', 'StyleSheet', 'ColorEntry', 'Text'].includes(name),
});

/**
 * The text of a shape mixes characters with marks that say which formatting row applies (`<cp IX="1"/>`), which a
 * general XML reader would put out of order. Before parsing, each `<Text>` is reduced to its characters, with the row
 * most of them use (`cp`) and how many rows are used (`runs`).
 */
export function flattenText(xml: string): string {
  return xml.replace(/<Text>([\s\S]*?)<\/Text>/g, (_m, inner: string) => {
    const count = new Map<string, number>();
    let row = '0';
    let plain = '';
    for (const part of inner.split(/(<[^>]*>)/)) {
      if (!part.startsWith('<')) {
        plain += part;
        const n = part.replace(/\s+/g, '').length;
        if (n) count.set(row, (count.get(row) ?? 0) + n);
        continue;
      }
      const cp = /^<cp\s+IX=['"](\d+)['"]/.exec(part);
      if (cp) row = cp[1]!;
    }
    const main = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '0';
    return `<Text cp="${main}" runs="${count.size}">${plain}</Text>`;
  });
}

export const parseXml = (xml: string): Node => parser.parse(flattenText(xml));

export interface Cell {
  v: string | undefined;
  f: string;
}
export interface Row {
  key: string;
  t: string | undefined;
  del: boolean;
  cells: Map<string, Cell>;
}
export interface Section {
  del: boolean;
  cells: Map<string, Cell>;
  rows: Map<string, Row>;
}
export interface Raw {
  attrs: Record<string, string>;
  cells: Map<string, Cell>;
  /** By name, plus the index for geometry (`Geometry0`, `Geometry1`…). */
  sections: Map<string, Section>;
  text?: { value: string; row: string; runs: number };
  kids: Raw[];
  /** Relationship id of the embedded picture or object. */
  foreign?: { type: string; rel: string };
}

function cellMap(node: Node): Map<string, Cell> {
  const m = new Map<string, Cell>();
  for (const c of node?.Cell ?? []) if (typeof c['@_N'] === 'string') m.set(c['@_N'], { v: c['@_V'] === undefined ? undefined : String(c['@_V']), f: String(c['@_F'] ?? '') });
  return m;
}

export function readShape(node: Node, depth = 0): Raw {
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(node ?? {})) if (k.startsWith('@_')) attrs[k.slice(2)] = String(v);
  const sections = new Map<string, Section>();
  for (const s of node?.Section ?? []) {
    const name = String(s['@_N']);
    const rows = new Map<string, Row>();
    (s.Row ?? []).forEach((r: Node, i: number) => {
      const key = String(r['@_N'] ?? r['@_IX'] ?? i);
      rows.set(key, { key, t: r['@_T'] === undefined ? undefined : String(r['@_T']), del: r['@_Del'] === '1', cells: cellMap(r) });
    });
    sections.set(name === 'Geometry' ? `Geometry${s['@_IX'] ?? 0}` : name, { del: s['@_Del'] === '1', cells: cellMap(s), rows });
  }
  const t = node?.Text?.[0];
  const text = t === undefined ? undefined : typeof t === 'string' ? { value: t, row: '0', runs: 1 } : { value: String(t['#text'] ?? ''), row: String(t['@_cp'] ?? '0'), runs: Number(t['@_runs'] ?? 1) };
  const fd = node?.ForeignData;
  const rel = fd?.Rel?.[0]?.['@_id'];
  return {
    attrs,
    cells: cellMap(node),
    sections,
    ...(text ? { text } : {}),
    kids: depth < 30 ? (node?.Shapes?.Shape ?? []).map((k: Node) => readShape(k, depth + 1)) : [],
    ...(fd ? { foreign: { type: String(fd['@_ForeignType'] ?? ''), rel: rel === undefined ? '' : String(rel) } } : {}),
  };
}

export interface Master {
  name: string;
  tops: Raw[];
  byId: Map<string, Raw>;
  /** The part of the master: its pictures are linked from it. */
  part: string;
}

export function indexShapes(shapes: Raw[], into = new Map<string, Raw>()): Map<string, Raw> {
  for (const s of shapes) {
    into.set(s.attrs.ID ?? '', s);
    indexShapes(s.kids, into);
  }
  return into;
}

export const resolvePath = (base: string, target: string): string => {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
};

export async function relsOf(zip: JSZip, part: string): Promise<Map<string, { type: string; target: string }>> {
  const dir = part.split('/').slice(0, -1).join('/');
  const file = part.split('/').pop()!;
  const raw = await zip.file(`${dir ? dir + '/' : ''}_rels/${file}.rels`)?.async('string');
  const map = new Map<string, { type: string; target: string }>();
  if (!raw) return map;
  for (const r of parser.parse(raw)?.Relationships?.Relationship ?? []) map.set(r['@_Id'], { type: String(r['@_Type']), target: resolvePath(part, String(r['@_Target'])) });
  return map;
}

// ------------------------------------------------------------ looking cells up

export type Category = 'LineStyle' | 'FillStyle' | 'TextStyle';
/** The value of a cell that the theme of the page decides. */
export const THEMED = Symbol('themed');
export type Value = string | typeof THEMED | undefined;

/** A shape of a page with the master shape it comes from. */
export interface Eff {
  own: Raw;
  master?: Raw;
}

export class Cascade {
  /** The page being read has a theme: `THEMEVAL(…)` then asks the theme, else its cached value stands. */
  themed = true;

  constructor(readonly sheets: Map<string, Raw>) {}

  private asked(c: Cell): boolean {
    return c.v === 'Themed' || (this.themed && c.f.startsWith('THEMEVAL'));
  }

  /** Through the style sheets of a category, starting at the one the shape (or its master) names. */
  private styled(e: Eff, cat: Category, pick: (s: Raw) => Cell | undefined): Value {
    let id: string | undefined = e.own.attrs[cat] ?? e.master?.attrs[cat] ?? '0';
    for (let guard = 0; id !== undefined && guard < 20; guard++) {
      const sheet = this.sheets.get(id);
      if (!sheet) return undefined;
      const c = pick(sheet);
      if (c && c.v !== undefined && c.f !== 'Inh') return this.asked(c) ? THEMED : c.v;
      const parent: string | undefined = sheet.attrs[cat];
      if (parent === undefined || parent === id) return c?.v === 'Themed' ? THEMED : c?.v;
      id = parent;
    }
    return undefined;
  }

  private chain(e: Eff, cat: Category, own: Cell | undefined, master: Cell | undefined, sheet: (s: Raw) => Cell | undefined): Value {
    // what the shape itself stores is what Visio calculated for it
    if (own && own.v !== undefined) return own.v === 'Themed' ? THEMED : own.v;
    // a master caches what the style sheets gave it in its own context: those are looked up again
    if (master && master.v !== undefined && master.f !== 'Inh') return this.asked(master) ? THEMED : master.v;
    return this.styled(e, cat, sheet);
  }

  cell(e: Eff, name: string, cat: Category): Value {
    return this.chain(e, cat, e.own.cells.get(name), e.master?.cells.get(name), (s) => s.cells.get(name));
  }

  /** A cell of a row of a section (formatting of characters and paragraphs); style sheets answer with their row 0. */
  rowCell(e: Eff, section: string, row: string, name: string, cat: Category): Value {
    const pick = (r: Raw | undefined, key: string) => r?.sections.get(section)?.rows.get(key)?.cells.get(name);
    return this.chain(e, cat, pick(e.own, row), pick(e.master, row), (s) => pick(s, '0'));
  }
}

export const num = (v: Value, d: number): number => {
  if (typeof v !== 'string' || v === '') return d;
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};

/** The rows of a section as the shape sees them: those of the master with the changes of the shape on top. */
export function mergedRows(e: Eff, section: string): { key: string; t: string | undefined; own?: Row; master?: Row }[] {
  const o = e.own.sections.get(section);
  const m = e.master?.sections.get(section);
  const keys = [...new Set([...(m?.rows.keys() ?? []), ...(o?.rows.keys() ?? [])])];
  if (keys.every((k) => /^\d+$/.test(k))) keys.sort((a, b) => Number(a) - Number(b));
  return keys.flatMap((key) => {
    const own = o?.rows.get(key);
    const master = m?.rows.get(key);
    return own?.del || (!own && master?.del) ? [] : [{ key, t: own?.t ?? master?.t, own, master }];
  });
}

export const sectionNames = (e: Eff, prefix: string): string[] =>
  [...new Set([...(e.master?.sections.keys() ?? []), ...e.own.sections.keys()])].filter((n) => n.startsWith(prefix)).sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)));
