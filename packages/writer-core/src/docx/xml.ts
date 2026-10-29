import { XMLParser } from 'fast-xml-parser';

/** Order-preserving node as produced by fast-xml-parser with `preserveOrder`. */
export type XNode = Record<string, any>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  processEntities: true,
});

export const parseXml = (xml: string): XNode[] => parser.parse(xml) as XNode[];

export const tagOf = (n: XNode): string => {
  for (const k of Object.keys(n)) if (k !== ':@') return k;
  return '';
};
export const kidsOf = (n: XNode): XNode[] => {
  const t = tagOf(n);
  const v = n[t];
  return Array.isArray(v) ? v : [];
};
export const attrOf = (n: XNode, name: string): string | undefined => n[':@']?.['@_' + name];
export const findKid = (n: XNode | undefined, tag: string): XNode | undefined => (n ? kidsOf(n).find((k) => tagOf(k) === tag) : undefined);
export const findKids = (n: XNode | undefined, tag: string): XNode[] => (n ? kidsOf(n).filter((k) => tagOf(k) === tag) : []);
export const rootOf = (doc: XNode[], tag: string): XNode | undefined => doc.find((n) => tagOf(n) === tag);
/** Text content of a node (all `#text` descendants). */
export const textOfNode = (n: XNode): string => {
  if (n['#text'] !== undefined) return String(n['#text']);
  return kidsOf(n).map(textOfNode).join('');
};

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Boolean toggle element such as `<w:b/>` or `<w:b w:val="0"/>`. */
export function toggle(n: XNode | undefined): boolean | undefined {
  if (!n) return undefined;
  const v = attrOf(n, 'val');
  if (v === undefined) return true;
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
}
