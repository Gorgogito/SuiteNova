import { Fragment, type Node as PMNode } from 'prosemirror-model';
import type { DocDefaults, StyleTable } from '../styles';
import { defaultPage, type PageSetup } from '../page';
import { nodeTypes } from '../schema';
import { defaultSection, newSectionId, noRefs, oneColumn, type SectionProps } from '../sections';

/** A comment (or a reply to one) as stored with the document. The anchor is the `comment` mark with the same id. */
export interface CommentData {
  id: string;
  author: string;
  initials: string;
  /** ISO date. */
  date: string;
  /** Plain text; paragraphs are separated by newlines. */
  text: string;
  /** The comment this one answers. */
  parent: string | null;
  done: boolean;
}

/** Editing restriction of the document (Word's "Restrict Editing"). */
export interface Protection {
  /** Only reading, only filling in content controls, only commenting or only tracked changes. */
  mode: 'readOnly' | 'forms' | 'comments' | 'trackedChanges';
  /** Password check data (spun SHA-512 hash); absent when the protection has no password. */
  hash?: { algorithm: 'SHA-512'; salt: string; hash: string; spin: number };
}

export interface Watermark {
  text: string | null;
  /** Data URI of a picture watermark. */
  image: string | null;
  font: string;
  color: string;
  /** Font size in pt; 0 = automatic. */
  size: number;
  semitransparent: boolean;
  layout: 'diagonal' | 'horizontal';
  /** Picture scale in percent. */
  scale: number;
}

export interface Source {
  tag: string;
  type: 'book' | 'bookSection' | 'article' | 'conference' | 'report' | 'web' | 'website' | 'film' | 'interview' | 'other';
  authors: string[];
  title: string;
  year: string;
  publisher: string;
  city: string;
  journal: string;
  volume: string;
  issue: string;
  pages: string;
  url: string;
  accessed: string;
  doi: string;
  edition: string;
}

export type CiteStyle = 'apa' | 'mla' | 'chicago' | 'ieee' | 'iso690';

export interface MacroModule {
  name: string;
  code: string;
}

/** Data source and settings of a mail merge. */
export interface MailMergeData {
  kind: 'letters' | 'labels' | 'envelopes' | 'directory';
  fields: string[];
  records: string[][];
  /** Where the data came from (file name), for display. */
  source: string;
}

/** A digital signature stored with the document (see `sign.ts`). */
export interface SignatureData {
  signer: string;
  /** ISO date. */
  date: string;
  /** Base64 of the ECDSA (P-256, SHA-256) signature over the digest and the signing details. */
  value: string;
  /** Base64 of the JSON certificate: name, e-mail, public key and fingerprint of the identity that signed. */
  certificate: string;
  /** Base64 SHA-256 of the signed content. */
  digest: string;
  /** Why the document was signed (optional). */
  comment?: string;
}

export interface NotesOptions {
  footnoteFormat: 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman' | 'symbols';
  footnoteRestart: 'continuous' | 'section';
  endnoteFormat: 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman' | 'symbols';
}

export const defaultNotesOptions = (): NotesOptions => ({ footnoteFormat: 'decimal', footnoteRestart: 'continuous', endnoteFormat: 'lowerRoman' });

/** A Nova Writer document as exchanged with the file layer. */
export interface WriterDoc {
  /** `doc(section+)`. */
  body: PMNode;
  /** Headers and footers by id; sections point at them. */
  parts: Record<string, PMNode>;
  /** Different headers and footers for even and odd pages. */
  evenAndOdd: boolean;
  defaults: DocDefaults;
  /** Paragraph styles of the document (built-in ones may be modified). */
  styles?: StyleTable;
  title?: string;
  author?: string;
  comments: CommentData[];
  trackChanges: boolean;
  protection: Protection | null;
  watermark: Watermark | null;
  sources: Source[];
  citeStyle: CiteStyle;
  notes: NotesOptions;
  macros: MacroModule[];
  mailMerge: MailMergeData | null;
  signature: SignatureData | null;
  /** A template (.dotx) rather than a document. */
  isTemplate: boolean;
}

export interface ReadResult {
  doc: WriterDoc;
  warnings: string[];
}

export interface WriteResult {
  data: Uint8Array;
  warnings: string[];
}

export const EMU_PER_PX = 9525;
export const twipsToPt = (t: number): number => t / 20;
export const ptToTwips = (pt: number): number => Math.round(pt * 20);

/** The section attributes as a plain attrs object. */
export function sectionAttrs(p: SectionProps): Record<string, unknown> {
  return { id: p.id, start: p.start, page: p.page, cols: p.cols, titlePg: p.titlePg, header: p.header, footer: p.footer, pgNumStart: p.pgNumStart, pgNumFmt: p.pgNumFmt };
}

export function sectionPropsOf(node: PMNode): SectionProps {
  const a = node.attrs;
  return {
    id: a.id || newSectionId(),
    start: a.start,
    page: a.page ?? defaultPage(),
    cols: a.cols ?? oneColumn(),
    titlePg: !!a.titlePg,
    header: a.header ?? noRefs(),
    footer: a.footer ?? noRefs(),
    pgNumStart: a.pgNumStart ?? null,
    pgNumFmt: a.pgNumFmt ?? 'decimal',
  };
}

/** Wrap blocks in one section with the given properties. */
export function makeSection(blocks: PMNode[] | Fragment, props: SectionProps): PMNode {
  const content = blocks instanceof Fragment ? blocks : Fragment.fromArray(blocks);
  return nodeTypes.section!.create(sectionAttrs(props), content.childCount ? content : [nodeTypes.paragraph!.create()]);
}

/**
 * Make sure a document is `section+`: blocks outside a section are gathered into a section (the first one found keeps
 * its position; stray blocks after a section join the section before them).
 */
export function ensureSections(doc: PMNode, fallback: SectionProps = defaultSection()): PMNode {
  if (doc.childCount && doc.content.content.every((n) => n.type.name === 'section')) return doc;
  const out: PMNode[] = [];
  let loose: PMNode[] = [];
  const flush = () => {
    if (!loose.length) return;
    const last = out[out.length - 1];
    if (last) out[out.length - 1] = last.copy(last.content.append(Fragment.fromArray(loose)));
    else out.push(makeSection(loose, { ...fallback }));
    loose = [];
  };
  doc.forEach((n) => {
    if (n.type.name === 'section') {
      flush();
      out.push(n);
    } else loose.push(n);
  });
  flush();
  if (!out.length) out.push(makeSection([], { ...fallback }));
  return nodeTypes.doc!.create(null, out);
}

/** A document with one section holding `blocks`. */
export function docOf(blocks: PMNode[] | Fragment, props?: Partial<SectionProps>): PMNode {
  return nodeTypes.doc!.create(null, [makeSection(blocks, { ...defaultSection(), ...props })]);
}

export const emptyWriterDoc = (defaults: DocDefaults): WriterDoc => ({
  body: docOf([]),
  parts: {},
  evenAndOdd: false,
  defaults,
  comments: [],
  trackChanges: false,
  protection: null,
  watermark: null,
  sources: [],
  citeStyle: 'apa',
  notes: defaultNotesOptions(),
  macros: [],
  mailMerge: null,
  signature: null,
  isTemplate: false,
});

export type { PageSetup };

/** The blocks of every section as one plain document (for editors that do not know sections). */
export function flattenSections(doc: PMNode): PMNode {
  const blocks: PMNode[] = [];
  doc.forEach((n) => {
    if (n.type.name === 'section') n.forEach((b) => blocks.push(b));
    else blocks.push(n);
  });
  return nodeTypes.doc!.create(null, blocks.length ? blocks : [nodeTypes.paragraph!.create()]);
}
