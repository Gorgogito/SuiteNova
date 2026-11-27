/**
 * Pictures of the message being written: images of the editor. The node keeps what is sent in `src`, the original and what
 * was done to it, so the picture tools can change or undo it.
 */
import { encodeBase64 } from '@suitenova/mail-core';
import { writerSchema } from '@suitenova/writer-core';
import { NodeSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { imageSize } from '../../calc/imagePick';
import type { ComposePicture } from '../pictures';
import { dataUrlBytes } from './html';

export const dataUrl = (p: { mime: string; data: Uint8Array }): string => `data:${p.mime};base64,${encodeBase64(p.data)}`;
const newPictureId = (): string => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

interface Kept {
  id?: string;
  name?: string;
  pixel?: ComposePicture['edits'];
  crop?: ComposePicture['crop'];
}

/** A name no other picture of the message has. */
function freeName(doc: PMNode, name: string): string {
  const taken = new Set<string>();
  doc.descendants((n) => void (n.type.name === 'image' && taken.add((n.attrs.edits as Kept | null)?.name ?? '')));
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) if (!taken.has(`${base} (${i})${ext}`)) return `${base} (${i})${ext}`;
}

/** Puts a picture where the cursor is (or at `at`) and selects it. */
export async function insertPictureFile(view: EditorView, file: File, maxWidth = 480, at?: number): Promise<void> {
  const data = new Uint8Array(await file.arrayBuffer());
  const mime = file.type || 'image/png';
  const size = await imageSize(data, mime);
  if (view.isDestroyed) return;
  const node = writerSchema.nodes.image!.create({ src: dataUrl({ mime, data }), alt: '', width: Math.min(size.width, maxWidth), edits: { id: newPictureId(), name: freeName(view.state.doc, file.name || 'imagen.png') } });
  const tr = view.state.tr;
  const sel = tr.selection;
  if (at !== undefined) tr.insert(Math.min(at, tr.doc.content.size), node);
  // with a picture selected (the one just put in), the new one goes after it
  else if (sel instanceof NodeSelection && sel.node.type.name === 'image') tr.insert(sel.to, node);
  else tr.replaceSelectionWith(node, false);
  let where = -1;
  tr.doc.descendants((n, pos) => void (n === node && (where = pos)));
  if (where >= 0) tr.setSelection(NodeSelection.create(tr.doc, where));
  view.dispatch(tr.scrollIntoView());
}

function find(view: EditorView, id: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && (node.attrs.edits as Kept | null)?.id === id) found = { node, pos };
    return !found;
  });
  return found;
}

/** The identifier of the picture that is selected (given one if it had none), or null. */
export function selectedPicture(view: EditorView): string | null {
  const sel = view.state.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'image') return null;
  const kept = sel.node.attrs.edits as Kept | null;
  if (kept?.id) return kept.id;
  const id = newPictureId();
  const tr = view.state.tr.setNodeMarkup(sel.from, undefined, { ...sel.node.attrs, edits: { ...kept, id } });
  view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, sel.from)));
  return id;
}

export function readPicture(view: EditorView | null, id: string | null): ComposePicture | undefined {
  const found = view && id ? find(view, id) : null;
  if (!found) return undefined;
  const a = found.node.attrs as { src: string; orig?: string | null; edits: Kept; width?: number | null; alt?: string; ocr?: unknown };
  const sent = dataUrlBytes(a.src);
  if (!sent) return undefined;
  return { id: id!, name: a.edits.name ?? 'imagen', orig: (a.orig && dataUrlBytes(a.orig)) || sent, sent, edits: a.edits.pixel, crop: a.edits.crop, width: a.width ?? 320, alt: a.alt ?? '', ocr: a.ocr ?? undefined };
}

export function writePicture(view: EditorView | null, p: ComposePicture): void {
  const found = view ? find(view, p.id) : null;
  if (!view || !found) return;
  const src = dataUrl(p.sent);
  const orig = dataUrl(p.orig);
  const attrs = { ...found.node.attrs, src, orig: orig === src ? null : orig, edits: { id: p.id, name: p.name, pixel: p.edits, crop: p.crop }, width: Math.round(p.width), height: null, alt: p.alt, ocr: p.ocr ?? null };
  const selected = view.state.selection instanceof NodeSelection && view.state.selection.from === found.pos;
  const tr = view.state.tr.setNodeMarkup(found.pos, undefined, attrs);
  if (selected) tr.setSelection(NodeSelection.create(tr.doc, found.pos));
  view.dispatch(tr);
}

export function removePicture(view: EditorView | null, id: string): void {
  const found = view ? find(view, id) : null;
  if (view && found) view.dispatch(view.state.tr.delete(found.pos, found.pos + found.node.nodeSize));
}
