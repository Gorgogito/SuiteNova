import { Schema, type Node as PMNode } from 'prosemirror-model';
import type { ParaProps, RunProps, TextBody } from './types';

/*
 * The text of a shape is a ProseMirror document. A paragraph carries a:pPr (level, alignment, bullet, tabs, spacing…); text carries
 * a single `run` mark with the a:rPr properties; fields (slide number, date) are inline atoms.
 */

export const slidesSchema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      attrs: { lvl: { default: 0 }, p: { default: {} }, end: { default: {} } },
      toDOM: () => ['p', 0],
    },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline', selectable: false, attrs: { r: { default: {} } }, toDOM: () => ['br'] },
    field: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { ftype: { default: 'slidenum' }, r: { default: {} }, text: { default: '‹#›' } },
      toDOM: (n) => ['span', { 'data-field': n.attrs.ftype }, n.attrs.text],
    },
  },
  marks: {
    run: { attrs: { r: { default: {} } }, toDOM: () => ['span', 0] },
  },
});

export const textNodeTypes = slidesSchema.nodes;

export interface RunSpec {
  text?: string;
  r?: RunProps;
  br?: boolean;
  field?: { ftype: string; text?: string };
}
export interface ParaSpec {
  runs?: RunSpec[];
  text?: string;
  lvl?: number;
  p?: ParaProps;
  end?: RunProps;
}

const hasKeys = (o: object | undefined) => !!o && Object.keys(o).length > 0;

export function makeParagraph(spec: ParaSpec): PMNode {
  const kids: PMNode[] = [];
  const runs = spec.runs ?? (spec.text !== undefined ? [{ text: spec.text }] : []);
  for (const r of runs) {
    const marks = hasKeys(r.r) ? [slidesSchema.marks.run!.create({ r: r.r })] : [];
    if (r.br) kids.push(textNodeTypes.hard_break!.create({ r: r.r ?? {} }));
    else if (r.field) kids.push(textNodeTypes.field!.create({ ftype: r.field.ftype, r: r.r ?? {}, text: r.field.text ?? '‹#›' }));
    else if (r.text) kids.push(slidesSchema.text(r.text, marks));
  }
  return textNodeTypes.paragraph!.create({ lvl: spec.lvl ?? 0, p: spec.p ?? {}, end: spec.end ?? {} }, kids);
}

export function makeDoc(paras: ParaSpec[]): PMNode {
  const nodes = paras.map(makeParagraph);
  return textNodeTypes.doc!.create(null, nodes.length ? nodes : [makeParagraph({})]);
}

export const emptyDocJson = (): unknown => makeDoc([{}]).toJSON();

/** A plain-text document: one paragraph per line. */
export const docFromText = (text: string, p?: ParaProps, r?: RunProps): unknown => makeDoc(text.split('\n').map((t) => ({ text: t, p, r: undefined, runs: t ? [{ text: t, r }] : [], end: r }))).toJSON();

export function docNode(doc: unknown): PMNode {
  try {
    const n = slidesSchema.nodeFromJSON(doc);
    n.check();
    return n;
  } catch {
    return makeDoc([{}]);
  }
}

export function docText(doc: unknown): string {
  const n = docNode(doc);
  const lines: string[] = [];
  n.forEach((p) => {
    let s = '';
    p.forEach((c) => {
      if (c.type.name === 'hard_break') s += '\v';
      else if (c.type.name === 'field') s += c.attrs.text;
      else s += c.text ?? '';
    });
    lines.push(s);
  });
  return lines.join('\n');
}

export const isEmptyDoc = (doc: unknown): boolean => docText(doc).replace(/[\n\v]/g, '').length === 0;

export const textBody = (doc: unknown, body: TextBody['body'] = {}): TextBody => ({ body, doc });

/** Paragraph nodes of a document with their start positions. */
export function paragraphs(doc: PMNode): { node: PMNode; pos: number; index: number }[] {
  const out: { node: PMNode; pos: number; index: number }[] = [];
  doc.forEach((node, pos, index) => out.push({ node, pos, index }));
  return out;
}

/** Applies a transformation to every paragraph/run of a document and returns new JSON. */
export function mapDoc(doc: unknown, fp?: (attrs: { lvl: number; p: ParaProps; end: RunProps }) => { lvl: number; p: ParaProps; end: RunProps }, fr?: (r: RunProps) => RunProps): unknown {
  const n = docNode(doc);
  const paras: PMNode[] = [];
  n.forEach((para) => {
    const kids: PMNode[] = [];
    para.forEach((c) => {
      if (c.type.name === 'text') {
        const cur = (c.marks.find((m) => m.type.name === 'run')?.attrs.r ?? {}) as RunProps;
        const next = fr ? fr(cur) : cur;
        kids.push(slidesSchema.text(c.text!, hasKeys(next) ? [slidesSchema.marks.run!.create({ r: next })] : []));
      } else if (fr && (c.type.name === 'field' || c.type.name === 'hard_break')) kids.push(c.type.create({ ...c.attrs, r: fr(c.attrs.r as RunProps) }));
      else kids.push(c);
    });
    const a = fp ? fp({ lvl: para.attrs.lvl, p: para.attrs.p, end: para.attrs.end }) : { lvl: para.attrs.lvl, p: para.attrs.p, end: para.attrs.end };
    paras.push(textNodeTypes.paragraph!.create({ lvl: a.lvl, p: a.p, end: fr ? fr(a.end) : a.end }, kids));
  });
  return textNodeTypes.doc!.create(null, paras).toJSON();
}
