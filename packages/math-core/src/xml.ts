import { XMLParser } from 'fast-xml-parser';

/** Nodo con el orden conservado (fast-xml-parser con `preserveOrder`). */
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
  const v = n[tagOf(n)];
  return Array.isArray(v) ? v : [];
};
export const attrOf = (n: XNode, name: string): string | undefined => n[':@']?.['@_' + name];
export const textOfNode = (n: XNode): string => (n['#text'] !== undefined ? String(n['#text']) : kidsOf(n).map(textOfNode).join(''));
export const rootOf = (doc: XNode[], tag: string): XNode | undefined => doc.find((n) => tagOf(n) === tag);
