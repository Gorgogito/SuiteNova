import { esc } from './xml';

export const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  w15: 'http://schemas.microsoft.com/office/word/2012/wordml',
  v: 'urn:schemas-microsoft-com:vml',
  o: 'urn:schemas-microsoft-com:office:office',
  w10: 'urn:schemas-microsoft-com:office:word',
};

/** Namespace declarations for every part we write. */
export const W_NS = Object.entries(NS)
  .map(([k, v]) => `xmlns:${k}="${v}"`)
  .join(' ') + ' mc:Ignorable="w14 w15"';

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export const relsXml = (items: string[]): string => `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`;

export const REL = {
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  numbering: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
  settings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
  comments: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
  commentsExtended: 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended',
  footnotes: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes',
  endnotes: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes',
  customXml: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
};

/** Normalizes CSS colors (#rgb, #rrggbb, rgb(...)) to RRGGBB; falls back to black. */
export function hex(c: string): string {
  const s = String(c).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return m[1]!.toUpperCase();
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m) return (m[1]! + m[1]! + m[2]! + m[2]! + m[3]! + m[3]!).toUpperCase();
  m = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(s);
  if (m) return [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('').toUpperCase();
  return '000000';
}

// ---------------------------------------------------------------------------------------------------- shapes

/** Preset geometry of DrawingML for each shape kind of the editor. */
export const SHAPE_PRST: Record<string, string> = {
  rect: 'rect',
  textbox: 'rect',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
  triangle: 'triangle',
  rightTriangle: 'rtTriangle',
  diamond: 'diamond',
  pentagon: 'pentagon',
  hexagon: 'hexagon',
  star5: 'star5',
  rightArrow: 'rightArrow',
  leftArrow: 'leftArrow',
  upArrow: 'upArrow',
  downArrow: 'downArrow',
  line: 'line',
  callout: 'wedgeRectCallout',
  cloud: 'cloud',
  heart: 'heart',
};
export const PRST_SHAPE: Record<string, string> = Object.fromEntries(Object.entries(SHAPE_PRST).filter(([k]) => k !== 'textbox').map(([k, v]) => [v, k]));

// ---------------------------------------------------------------------------------------------------- fields

export interface FieldSpec {
  kind: string;
  arg: string | null;
  switches: string | null;
}

const quoteArg = (a: string): string => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

/** The instruction text of a field (the text between the field characters). */
export function fieldInstr(f: FieldSpec): string {
  const sw = f.switches ? ` ${f.switches}` : '';
  switch (f.kind) {
    case 'page': return ' PAGE ';
    case 'pages':
    case 'numpages': return ' NUMPAGES ';
    case 'section': return ' SECTION ';
    case 'sectionpages': return ' SECTIONPAGES ';
    case 'date': return ` DATE \\@ "${f.arg || 'dd/MM/yyyy'}" `;
    case 'time': return ` TIME \\@ "${f.arg || 'HH:mm'}" `;
    case 'title': return ' TITLE ';
    case 'author': return ' AUTHOR ';
    case 'filename': return ' FILENAME ';
    case 'seq': return ` SEQ ${quoteArg(f.arg ?? 'Figura')}${f.switches ? ` ${f.switches}` : ' \\* ARABIC'} `;
    case 'ref': return ` REF ${f.arg}${f.switches ? ` ${f.switches}` : ' \\h'} `;
    case 'pageref': return ` PAGEREF ${f.arg} \\h `;
    case 'noteref': return ` NOTEREF ${f.arg} \\h `;
    case 'mergefield': return ` MERGEFIELD ${quoteArg(f.arg ?? '')}${sw} `;
    case 'citation': return ` CITATION ${f.arg}${f.switches ? ` ${f.switches}` : ' \\l 1033'} `;
    case 'merge-rule': return ` ${f.arg ?? ''} ${f.switches ?? ''} `;
    case 'xe': return ` XE "${(f.arg ?? '').replace(/"/g, '\\"')}"${sw} `;
    default: return ` ${(f.switches ?? f.arg ?? f.kind).toString()} `;
  }
}

/** Understand the instruction of a field; `null` when it is one we do not model. */
export function parseFieldInstr(instr: string): FieldSpec | null {
  const m = /^\s*([A-Za-z]+)\s*(.*)$/s.exec(instr);
  if (!m) return null;
  const word = m[1]!.toUpperCase();
  const rest = m[2]!.trim();
  const arg = (s: string): { arg: string; sw: string } => {
    const q = /^"((?:[^"\\]|\\.)*)"\s*(.*)$/s.exec(s);
    if (q) return { arg: q[1]!.replace(/\\"/g, '"'), sw: q[2]!.trim() };
    const p = /^(\S+)\s*(.*)$/s.exec(s);
    return p ? { arg: p[1]!, sw: p[2]!.trim() } : { arg: '', sw: '' };
  };
  switch (word) {
    case 'PAGE': return { kind: 'page', arg: null, switches: null };
    case 'NUMPAGES': return { kind: 'pages', arg: null, switches: null };
    case 'SECTION': return { kind: 'section', arg: null, switches: null };
    case 'SECTIONPAGES': return { kind: 'sectionpages', arg: null, switches: null };
    case 'DATE':
    case 'TIME': {
      const f = /\\@\s*"([^"]*)"/.exec(rest);
      return { kind: word === 'DATE' ? 'date' : 'time', arg: f?.[1] ?? null, switches: null };
    }
    case 'TITLE': return { kind: 'title', arg: null, switches: null };
    case 'AUTHOR': return { kind: 'author', arg: null, switches: null };
    case 'FILENAME': return { kind: 'filename', arg: null, switches: null };
    case 'SEQ': {
      const a = arg(rest);
      return { kind: 'seq', arg: a.arg, switches: a.sw && a.sw !== '\\* ARABIC' ? a.sw : null };
    }
    case 'REF': {
      const a = arg(rest);
      return { kind: 'ref', arg: a.arg, switches: a.sw && a.sw !== '\\h' ? a.sw : null };
    }
    case 'PAGEREF': return { kind: 'pageref', arg: arg(rest).arg, switches: null };
    case 'NOTEREF': return { kind: 'noteref', arg: arg(rest).arg, switches: null };
    case 'MERGEFIELD': {
      const a = arg(rest);
      return { kind: 'mergefield', arg: a.arg, switches: a.sw || null };
    }
    case 'CITATION': {
      const a = arg(rest);
      return { kind: 'citation', arg: a.arg, switches: a.sw && !/^\\l \d+$/.test(a.sw) ? a.sw : null };
    }
    case 'XE': {
      const a = arg(rest);
      return { kind: 'xe', arg: a.arg, switches: a.sw || null };
    }
    case 'IF':
    case 'NEXT':
    case 'NEXTIF':
    case 'SKIPIF':
    case 'SET':
    case 'ASK':
    case 'FILLIN':
      return { kind: 'merge-rule', arg: word, switches: rest };
    default:
      return null;
  }
}

export const attrEsc = esc;

/** Hex of a number, upper case, fixed width. */
export const hex8 = (n: number): string => n.toString(16).toUpperCase().padStart(8, '0');
