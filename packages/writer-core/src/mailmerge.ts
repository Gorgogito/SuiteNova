import { Fragment, type Node as PMNode } from 'prosemirror-model';
import type { MailMergeData } from './docx/model';
import type { PageSetup } from './page';
import { newSectionId } from './sections';
import { nodeTypes, writerSchema } from './schema';

// ------------------------------------------------------------------------------------------------ data sources

/** Split delimited text (CSV, TSV, `;`): quoted fields, doubled quotes, line breaks inside quotes. The delimiter is guessed from the header. */
export function parseDelimited(text: string, delimiter?: string): { fields: string[]; records: string[][] } {
  const src = text.replace(/^﻿/, '');
  const head = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = delimiter ?? ([';', '\t', ',', '|'].map((d) => [d, head.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0]);
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"' && cur === '') quoted = true;
    else if (c === delim) {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  const clean = rows.filter((r) => r.some((c) => c.trim() !== ''));
  const fields = (clean.shift() ?? []).map((f) => f.trim());
  return { fields, records: clean.map((r) => fields.map((_f, i) => r[i] ?? '')) };
}

export function mergeDataFromRows(rows: string[][], source: string, kind: MailMergeData['kind'] = 'letters'): MailMergeData {
  const fields = (rows[0] ?? []).map((f, i) => String(f ?? '').trim() || `Columna${i + 1}`);
  const records = rows.slice(1).filter((r) => r.some((c) => String(c ?? '').trim() !== '')).map((r) => fields.map((_f, i) => String(r[i] ?? '')));
  return { kind, fields, records, source };
}

// ------------------------------------------------------------------------------------------------ rules

const norm = (s: string) => s.trim().toLowerCase();

export function recordValue(data: MailMergeData, rec: number, name: string): string {
  const i = data.fields.findIndex((f) => norm(f) === norm(name));
  return i < 0 ? '' : (data.records[rec]?.[i] ?? '');
}

/** `Campo operador "valor"` — the condition of IF, SKIPIF and NEXTIF. Returns the rest of the text after the condition too. */
export function parseCondition(src: string): { field: string; op: string; value: string; rest: string } | null {
  const m = /^\s*("[^"]*"|[^\s=<>]+)\s*(<>|<=|>=|=|<|>)\s*("(?:[^"\\]|\\.)*"|\S+)\s*(.*)$/s.exec(src);
  if (!m) return null;
  const unq = (s: string) => (s.startsWith('"') ? s.slice(1, -1).replace(/\\"/g, '"') : s);
  return { field: unq(m[1]!), op: m[2]!, value: unq(m[3]!), rest: m[4]! };
}

export function compareValues(a: string, op: string, b: string): boolean {
  const na = Number(a.replace(',', '.'));
  const nb = Number(b.replace(',', '.'));
  const numeric = a.trim() !== '' && b.trim() !== '' && Number.isFinite(na) && Number.isFinite(nb);
  const c = numeric ? na - nb : norm(a) < norm(b) ? -1 : norm(a) > norm(b) ? 1 : 0;
  switch (op) {
    case '=': return c === 0;
    case '<>': return c !== 0;
    case '<': return c < 0;
    case '>': return c > 0;
    case '<=': return c <= 0;
    default: return c >= 0;
  }
}

/** The two quoted strings that follow the condition of an IF. */
function thenElse(rest: string): [string, string] {
  const parts = [...rest.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((m) => (m[1] ?? m[2] ?? '').replace(/\\"/g, '"'));
  return [parts[0] ?? '', parts[1] ?? ''];
}

/** Text of a merge field, with its `\b` (before) and `\f` (after) texts, which only appear when the value is not empty. */
export function fieldText(value: string, switches: string | null): string {
  if (!value) return '';
  const b = /\\b\s+"([^"]*)"/.exec(switches ?? '')?.[1] ?? '';
  const f = /\\f\s+"([^"]*)"/.exec(switches ?? '')?.[1] ?? '';
  return b + value + f;
}

// ------------------------------------------------------------------------------------------------ merging

interface Ctx {
  data: MailMergeData;
  rec: number;
  skip: boolean;
}

function mapNode(node: PMNode, ctx: Ctx): PMNode | PMNode[] {
  if (node.type.name === 'field') {
    const a = node.attrs;
    if (a.kind === 'mergefield') {
      const txt = fieldText(recordValue(ctx.data, ctx.rec, a.arg ?? ''), a.switches);
      return txt ? node.type.schema.text(txt, node.marks) : [];
    }
    if (a.kind === 'merge-rule') {
      const rule = String(a.arg);
      if (rule === 'NEXT') {
        ctx.rec++;
        return [];
      }
      const cond = parseCondition(String(a.switches ?? ''));
      if (!cond) return [];
      const hit = compareValues(recordValue(ctx.data, ctx.rec, cond.field), cond.op, cond.value);
      if (rule === 'IF') {
        const [yes, no] = thenElse(cond.rest);
        const txt = hit ? yes : no;
        return txt ? node.type.schema.text(txt, node.marks) : [];
      }
      if (rule === 'SKIPIF' && hit) ctx.skip = true;
      if (rule === 'NEXTIF' && hit) ctx.rec++;
      return [];
    }
  }
  if (node.isLeaf) return node;
  const kids: PMNode[] = [];
  node.content.forEach((c) => {
    const m = mapNode(c, ctx);
    if (Array.isArray(m)) kids.push(...m);
    else kids.push(m);
  });
  return node.copy(Fragment.from(kids));
}

/** Does the template use this rule? */
export function usesRule(body: PMNode, rule: string): boolean {
  let found = false;
  body.descendants((n) => {
    if (n.type.name === 'field' && n.attrs.kind === 'merge-rule' && n.attrs.arg === rule) found = true;
    return !found;
  });
  return found;
}

/** The text of one record with every merge field replaced (for the on-screen preview). */
export function previewText(node: PMNode, data: MailMergeData, rec: number): string {
  const a = node.attrs;
  if (a.kind === 'merge-rule') {
    if (a.arg !== 'IF') return '';
    const cond = parseCondition(String(a.switches ?? ''));
    if (!cond) return '';
    const [yes, no] = thenElse(cond.rest);
    return compareValues(recordValue(data, rec, cond.field), cond.op, cond.value) ? yes : no;
  }
  return fieldText(recordValue(data, rec, a.arg ?? ''), a.switches);
}

export interface MergeResult {
  /** `doc(section+)` with all the merged records. */
  body: PMNode;
  /** How many records ended up in the result (records skipped by a rule are not counted). */
  count: number;
}

/**
 * Merge the document with the records `from..to` (inclusive, 0-based). For letters each record is a copy of the document
 * that starts on a new page. `directory` keeps the records one after another without page breaks.
 */
export function mergeDocument(body: PMNode, data: MailMergeData, from = 0, to = data.records.length - 1, kind: MailMergeData['kind'] = data.kind): MergeResult {
  const outSections: PMNode[] = [];
  let count = 0;
  const ctx: Ctx = { data, rec: from, skip: false };
    while (ctx.rec <= Math.min(to, data.records.length - 1)) {
    ctx.skip = false;
    const copy: PMNode[] = [];
    body.forEach((section) => {
      const m = mapNode(section, ctx) as PMNode;
      copy.push(m);
    });
    // a merged copy is a whole record (or several when the template advances by itself)
    if (!ctx.skip) {
      copy.forEach((s, i) => {
        const first = outSections.length === 0;
        const attrs: Record<string, unknown> = { ...s.attrs, id: first && i === 0 ? s.attrs.id : newSectionId() };
        if (kind === 'directory' && !first && i === 0) attrs.start = 'continuous';
        outSections.push(s.type.create(attrs, s.content, s.marks));
      });
      count++;
    }
    ctx.rec++;
  }
  if (!outSections.length) return { body, count: 0 };
  return { body: nodeTypes.doc!.create(null, outSections), count };
}

// ------------------------------------------------------------------------------------------------ envelopes and labels

export interface EnvelopeSize {
  id: string;
  label: string;
  /** Points. */
  width: number;
  height: number;
}

const mm = (v: number) => (v * 72) / 25.4;
const inch = (v: number) => v * 72;

export const ENVELOPE_SIZES: EnvelopeSize[] = [
  { id: 'dl', label: 'DL (110 × 220 mm)', width: mm(220), height: mm(110) },
  { id: 'c5', label: 'C5 (162 × 229 mm)', width: mm(229), height: mm(162) },
  { id: 'c6', label: 'C6 (114 × 162 mm)', width: mm(162), height: mm(114) },
  { id: 'b5', label: 'B5 (176 × 250 mm)', width: mm(250), height: mm(176) },
  { id: 'no10', label: 'Nº 10 (4 1/8 × 9 1/2 pulg.)', width: inch(9.5), height: inch(4.125) },
  { id: 'monarch', label: 'Monarch (3 7/8 × 7 1/2 pulg.)', width: inch(7.5), height: inch(3.875) },
];

const px = (pt: number) => Math.round((pt * 96) / 72);

/** One envelope as a section: a sender text box at the top left and the recipient box in the lower middle. */
export function envelopeSection(size: EnvelopeSize, sender: PMNode[] | string, recipient: PMNode[] | string): PMNode {
  const T = nodeTypes;
  const paras = (text: string) => text.split(/\r?\n/).map((l) => T.paragraph!.create(null, l ? writerSchema.text(l) : []));
  const box = (kind: string, x: number, y: number, w: number, h: number, content: PMNode[], extra: Record<string, unknown> = {}) =>
    T.shape!.create({ kind: 'textbox', width: px(w), height: px(h), fill: '#ffffff', stroke: '#ffffff', strokeWidth: 0, wrap: 'front', x: px(x), y: px(y), alt: kind, ...extra }, content.length ? content : [T.paragraph!.create()]);
  const page: PageSetup = { width: size.width, height: size.height, marginTop: 28, marginRight: 28, marginBottom: 28, marginLeft: 28, headerDistance: 14, footerDistance: 14 };
  const senderContent = typeof sender === 'string' ? (sender ? paras(sender) : []) : sender;
  const senderBox = box('Remitente', 0, 0, size.width * 0.4, size.height * 0.3, senderContent);
  const recipientContent = typeof recipient === 'string' ? paras(recipient) : recipient;
  const recipientBox = box('Destinatario', size.width * 0.35 - 28, size.height * 0.4 - 28, size.width * 0.5, size.height * 0.35, recipientContent);
  const anchor = T.paragraph!.create(null, [senderBox, recipientBox]);
  return T.section!.create({ id: newSectionId(), start: 'nextPage', page }, [anchor]);
}

export interface LabelSheet {
  id: string;
  label: string;
  /** Points. */
  pageWidth: number;
  pageHeight: number;
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  marginTop: number;
  marginLeft: number;
}

export const LABEL_SHEETS: LabelSheet[] = [
  { id: 'a4-3x7', label: 'A4, 3 × 7 (63,5 × 38,1 mm)', pageWidth: 595.3, pageHeight: 841.9, cols: 3, rows: 7, cellWidth: mm(63.5), cellHeight: mm(38.1), marginTop: mm(15.1), marginLeft: mm(7.2) },
  { id: 'a4-2x7', label: 'A4, 2 × 7 (99,1 × 38,1 mm)', pageWidth: 595.3, pageHeight: 841.9, cols: 2, rows: 7, cellWidth: mm(99.1), cellHeight: mm(38.1), marginTop: mm(15.1), marginLeft: mm(4.6) },
  { id: 'a4-2x4', label: 'A4, 2 × 4 (99,1 × 67,7 mm)', pageWidth: 595.3, pageHeight: 841.9, cols: 2, rows: 4, cellWidth: mm(99.1), cellHeight: mm(67.7), marginTop: mm(13), marginLeft: mm(4.6) },
  { id: 'letter-3x10', label: 'Carta, 3 × 10 (2 5/8 × 1 pulg.)', pageWidth: inch(8.5), pageHeight: inch(11), cols: 3, rows: 10, cellWidth: inch(2.625), cellHeight: inch(1), marginTop: inch(0.5), marginLeft: inch(0.19) },
  { id: 'letter-2x5', label: 'Carta, 2 × 5 (4 × 2 pulg.)', pageWidth: inch(8.5), pageHeight: inch(11), cols: 2, rows: 5, cellWidth: inch(4), cellHeight: inch(2), marginTop: inch(0.5), marginLeft: inch(0.16) },
];

/** `pages` pages of a label sheet: a table whose cells are the labels, each filled with `fill(index)` (or empty). */
export function labelSections(sheet: LabelSheet, total: number, fill: (index: number) => PMNode[]): PMNode {
  const T = nodeTypes;
  const per = sheet.cols * sheet.rows;
  const pages = Math.max(1, Math.ceil(total / per));
  const sections: PMNode[] = [];
  for (let p = 0; p < pages; p++) {
    const rows: PMNode[] = [];
    for (let r = 0; r < sheet.rows; r++) {
      const cells: PMNode[] = [];
      for (let c = 0; c < sheet.cols; c++) {
        const i = p * per + r * sheet.cols + c;
        const content = i < total ? fill(i) : [];
        cells.push(T.table_cell!.create({ colwidth: [px(sheet.cellWidth)] }, content.length ? content : [T.paragraph!.create()]));
      }
      rows.push(T.table_row!.create(null, cells));
    }
    const page: PageSetup = { width: sheet.pageWidth, height: sheet.pageHeight, marginTop: sheet.marginTop, marginLeft: sheet.marginLeft, marginRight: 0, marginBottom: 0, headerDistance: 0, footerDistance: 0 };
    sections.push(T.section!.create({ id: newSectionId(), start: 'nextPage', page }, [T.table!.create({ borders: false }, rows)]));
  }
  return T.doc!.create(null, sections);
}

/** Fill the labels of a sheet with merged copies of `template` (a single label's paragraphs), one per record. */
export function mergeLabels(template: PMNode[], data: MailMergeData, sheet: LabelSheet): PMNode {
  const total = data.records.length;
  return labelSections(sheet, total, (i) => {
    const ctx: Ctx = { data, rec: i, skip: false };
    return template.map((n) => mapNode(n, ctx) as PMNode).filter(Boolean);
  });
}

// ------------------------------------------------------------------------------------------------ templates of blocks

/** Text with `{Campo}` placeholders as inline content: text, merge fields and line breaks. */
export function templateInline(text: string): PMNode[] {
  const out: PMNode[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, li) => {
    if (li > 0) out.push(nodeTypes.hard_break!.create());
    let last = 0;
    for (const m of line.matchAll(/\{([^{}]+)\}/g)) {
      if (m.index! > last) out.push(writerSchema.text(line.slice(last, m.index)));
      out.push(nodeTypes.field!.create({ kind: 'mergefield', arg: m[1]!.trim(), switches: null }));
      last = m.index! + m[0].length;
    }
    if (last < line.length) out.push(writerSchema.text(line.slice(last)));
  });
  return out;
}

/** The same, one paragraph per line (labels and envelopes). */
export function templateParagraphs(text: string): PMNode[] {
  return text.split(/\r?\n/).map((l) => nodeTypes.paragraph!.create(null, templateInline(l)));
}

/** A plain guess of the address block from the names of the fields. */
export function guessAddressTemplate(fields: string[]): string {
  const find = (...names: string[]) => fields.find((f) => names.some((n) => norm(f).includes(n)));
  const name = find('nombre', 'name');
  const last = find('apellido', 'surname', 'last');
  const street = find('direcci', 'calle', 'address', 'domicilio');
  const zip = find('postal', 'cp', 'zip', 'código');
  const city = find('ciudad', 'localidad', 'city', 'municipio');
  const lines = [[name, last], [street], [zip, city]].map((l) => l.filter(Boolean).map((f) => `{${f}}`).join(' ')).filter(Boolean);
  return lines.join('\n') || fields.slice(0, 3).map((f) => `{${f}}`).join('\n');
}

/** What a merge rule looks like in the text of the document, like Word's «Si… entonces… si no…». */
export function ruleLabel(rule: string, switches: string | null): string {
  const cond = parseCondition(switches ?? '');
  const c = cond ? `${cond.field} ${cond.op} "${cond.value}"` : '';
  switch (rule) {
    case 'IF': return `«Si ${c}»`;
    case 'SKIPIF': return `«Saltar registro si ${c}»`;
    case 'NEXTIF': return `«Siguiente registro si ${c}»`;
    case 'NEXT': return '«Siguiente registro»';
    default: return `«${rule}»`;
  }
}
