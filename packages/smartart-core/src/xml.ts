import { XMLParser } from 'fast-xml-parser';

/*
 * Un árbol XML ordenado y sin pérdidas para las partes de SmartArt. El orden de los hijos importa (en un `layoutDef` el orden de
 * `forEach`, `choose` y `layoutNode` es el de ejecución) y los prefijos de espacio de nombres se conservan para volver a escribirlos.
 */

export interface El {
  /** Nombre cualificado tal cual está en el archivo (`dgm:pt`, `a:p`). `#text` es un nodo de texto. */
  name: string;
  attrs: Record<string, string>;
  kids: El[];
  /** Solo en `#text`. */
  text?: string;
}

/** El nombre sin prefijo. */
export const local = (name: string): string => name.slice(name.indexOf(':') + 1);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  trimValues: false,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

type Raw = Record<string, unknown>;

function convert(node: Raw, inText: boolean): El | null {
  for (const key of Object.keys(node)) {
    if (key === ':@') continue;
    if (key === '#text') {
      const text = String(node[key] ?? '');
      // el espacio entre etiquetas no cuenta; el de dentro de `a:t` sí
      return !inText && text.trim() === '' ? null : { name: '#text', attrs: {}, kids: [], text };
    }
    const raw = (node[':@'] ?? {}) as Record<string, string>;
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) attrs[k.replace(/^@_/, '')] = String(v);
    const childRaw = node[key] as Raw[];
    const kids: El[] = [];
    for (const c of childRaw ?? []) {
      const e = convert(c, key === 'a:t');
      if (e) kids.push(e);
    }
    return { name: key, attrs, kids };
  }
  return null;
}

/** Lee un documento XML. */
export function parseXml(xml: string): El {
  const arr = parser.parse(xml) as Raw[];
  for (const n of arr) {
    const e = convert(n, false);
    if (e) return e;
  }
  throw new Error('XML vacío');
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string): string => esc(s).replace(/"/g, '&quot;');

/** Escribe un árbol (sin la declaración XML). */
export function serializeXml(e: El): string {
  if (e.name === '#text') return esc(e.text ?? '');
  const attrs = Object.entries(e.attrs)
    .map(([k, v]) => ` ${k}="${escAttr(v)}"`)
    .join('');
  if (!e.kids.length) return `<${e.name}${attrs}/>`;
  return `<${e.name}${attrs}>${e.kids.map(serializeXml).join('')}</${e.name}>`;
}

/** Declaración y árbol listos para guardar como parte del paquete. */
export const xmlDocument = (e: El): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${serializeXml(e)}`;

// ---- consulta
/** Los hijos con ese nombre local. */
export const kidsOf = (e: El | undefined, name: string): El[] => (e ? e.kids.filter((k) => local(k.name) === name) : []);
/** El primer hijo con ese nombre local. */
export const kid = (e: El | undefined, name: string): El | undefined => (e ? e.kids.find((k) => local(k.name) === name) : undefined);
/** El texto de un elemento. */
export const textOf = (e: El | undefined): string => (e ? e.kids.map((k) => (k.name === '#text' ? (k.text ?? '') : textOf(k))).join('') : '');
export const attr = (e: El | undefined, name: string): string | undefined => e?.attrs[name];
export const num = (v: string | undefined, d: number): number => {
  if (v === undefined || v === '') return d;
  const n = Number(v);
  return Number.isNaN(n) && v !== 'NaN' ? d : n;
};
export const bool = (v: string | undefined, d: boolean): boolean => (v === undefined ? d : v === '1' || v === 'true');

/** Un elemento nuevo. */
export const el = (name: string, attrs: Record<string, string> = {}, kids: El[] = []): El => ({ name, attrs, kids });
export const txt = (text: string): El => ({ name: '#text', attrs: {}, kids: [], text });
