import { XMLParser } from 'fast-xml-parser';

const ARRAY_TAGS = new Set([
  'sheet', 'definedName', 'si', 't', 'r', 'row', 'c', 'col', 'mergeCell', 'numFmt', 'font', 'fill', 'border', 'xf',
  'Relationship', 'Override', 'cfRule', 'conditionalFormatting', 'dataValidation', 'formula', 'formula1', 'formula2',
  'dxf', 'tablePart', 'ser', 'pt', 'item', 'sheetView', 'pane', 'twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor',
]);

export const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) => ARRAY_TAGS.has(name),
  processEntities: true,
  removeNSPrefix: true,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type XNode = any;

export const asArray = <T = XNode>(v: T | T[] | undefined): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/** Text of a <t>/<v> style node (string, or object with #text and attributes). */
export function textOf(n: XNode): string {
  if (n === undefined || n === null) return '';
  if (typeof n === 'string') return n;
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (typeof n === 'object') return n['#text'] !== undefined ? String(n['#text']) : '';
  return String(n);
}

/** Boolean toggle element such as <b/> or <b val="0"/>. */
export function toggle(n: XNode): boolean {
  if (n === undefined || n === null) return false;
  if (typeof n === 'object' && !Array.isArray(n)) {
    const v = n['@_val'];
    return !(v === '0' || v === 'false');
  }
  return true;
}

export const attr = (n: XNode, name: string): string | undefined => (n && typeof n === 'object' ? n[`@_${name}`] : undefined);

export function escapeXml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;')).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}
