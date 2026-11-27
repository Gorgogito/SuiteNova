/**
 * Signatures and message templates. Like Outlook's, they belong to the program and not to a mail file, so they are kept in
 * its settings.
 */
import { writerSchema } from '@suitenova/writer-core';
import { Fragment, type Node as PMNode } from 'prosemirror-model';

export interface Signature {
  id: string;
  name: string;
  /** The editor's document. */
  doc: unknown;
}
export type SignatureUse = 'new' | 'reply';
export interface Signatures {
  list: Signature[];
  /** The signature put in by itself, for each account (`''`: any account without its own choice, or none). */
  defaults: Record<string, Partial<Record<SignatureUse, string>>>;
}
export interface Template {
  id: string;
  name: string;
  subject: string;
  doc: unknown;
}

const SIGNATURES = 'novamail.signatures';
const TEMPLATES = 'novamail.templates';

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

/** Saving fails when the storage is full (pictures weigh): it is said, not lost silently. */
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error('No se pudo guardar: no queda espacio. Quita imágenes grandes o plantillas que no uses.');
  }
}

const named = (x: unknown): x is { id: string; name: string; doc: unknown } => !!x && typeof (x as Signature).id === 'string' && typeof (x as Signature).name === 'string' && !!(x as Signature).doc;

export function loadSignatures(): Signatures {
  const v = read(SIGNATURES) as Partial<Signatures> | null;
  const list = Array.isArray(v?.list) ? v!.list.filter(named) : [];
  const defaults: Signatures['defaults'] = {};
  for (const [account, d] of Object.entries(v?.defaults ?? {})) {
    const out: Partial<Record<SignatureUse, string>> = {};
    for (const use of ['new', 'reply'] as const) if (typeof d?.[use] === 'string') out[use] = d[use];
    defaults[account] = out;
  }
  return { list, defaults };
}
export const saveSignatures = (s: Signatures): void => write(SIGNATURES, s);

export function loadTemplates(): Template[] {
  const v = read(TEMPLATES);
  return Array.isArray(v) ? v.filter(named).map((t) => ({ ...(t as Template), subject: String((t as Template).subject ?? '') })) : [];
}
export const saveTemplates = (t: Template[]): void => write(TEMPLATES, t);

export const newLibraryId = (): string => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** The signature that goes by itself into a message of an account. */
export function signatureFor(account: string | undefined, use: SignatureUse, s: Signatures = loadSignatures()): Signature | null {
  const own = account ? s.defaults[account] : undefined;
  // an account with its own choice (even «none», the empty text) does not take the general one
  const id = own && use in own ? own[use] : s.defaults['']?.[use];
  return s.list.find((x) => x.id === id) ?? null;
}

export const isSignature = (node: PMNode): boolean => node.type.name === 'generated' && node.attrs.kind === 'signature';

/** The signature as a block of the message. */
export function signatureBlock(sig: Signature): PMNode | null {
  try {
    const doc = writerSchema.nodeFromJSON(sig.doc);
    return writerSchema.node('generated', { kind: 'signature', opts: { id: sig.id }, title: null }, doc.content);
  } catch {
    return null;
  }
}

/** The document with that signature (or none) instead of the one it had, after what is written and a blank line. */
export function withSignature(doc: PMNode, sig: Signature | null): PMNode {
  const blocks: PMNode[] = [];
  let at = -1;
  doc.forEach((node) => {
    if (isSignature(node)) at = blocks.length;
    else blocks.push(node);
  });
  const block = sig ? signatureBlock(sig) : null;
  if (block) {
    if (at >= 0) blocks.splice(at, 0, block);
    else {
      const empty = (n: PMNode | undefined) => n?.type.name === 'paragraph' && !n.content.size;
      // an empty message keeps a line to write in; in every case there is a line of air before the signature
      if (blocks.every(empty)) blocks.splice(0, blocks.length, writerSchema.node('paragraph'), writerSchema.node('paragraph'));
      else if (!empty(blocks[blocks.length - 1])) blocks.push(writerSchema.node('paragraph'));
      blocks.push(block);
    }
  }
  return doc.type.create(doc.attrs, Fragment.fromArray(blocks.length ? blocks : [writerSchema.node('paragraph')]));
}
