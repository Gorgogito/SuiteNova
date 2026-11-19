import { applyPixelEdits, isCropped, normalizePixelEdits, type Crop, type FrameEdits, type PixelEdits, type Pixels } from '@suitenova/image-core';
import { NodeSelection } from 'prosemirror-state';
import { canvasFromPixels, decodePixels, encode } from '../images/canvas';
import type { PictureHost } from '../images/host';
import type { WriterUI } from './commands';
import { selectedImage } from './commands-image';

/*
 * Writer's side of the shared picture tools. An `image` node keeps the picture it shows in `src` and, when its pixels were edited, the
 * original in `orig` and the edits in `edits`: `src` is always the original with those edits made (Word has no place for most of them, so
 * everything is made in the picture; the .docx keeps the original and the edits in a part of its own). Crop and border are the node's own.
 */

const dataUri = (mime: string, bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(s)}`;
};
const parseUri = (uri: string): { mime: string; data: Uint8Array } | null => {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(uri);
  if (!m) return null;
  const bin = atob(m[2]!);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  return { mime: m[1]!, data };
};

/** The pixels of a data URI (null when it is not a picture the browser can read). */
export async function pixelsOfUri(uri: string): Promise<Pixels | null> {
  const p = parseUri(uri);
  return p ? decodePixels(p.data, p.mime) : null;
}

/** The picture the node shows: the original with the edits made, as a PNG data URI. */
export async function bakeUri(orig: string, edits: PixelEdits): Promise<string | null> {
  const px = await pixelsOfUri(orig);
  if (!px) return null;
  return dataUri('image/png', await encode(canvasFromPixels(applyPixelEdits(px, edits)), 'image/png'));
}

/** The attributes an image gets with these pixel edits (the picture is made here, from the original). */
export async function editedAttrs(a: Record<string, any>, next: PixelEdits): Promise<Record<string, unknown> | null> {
  const orig: string = a.orig ?? a.src;
  const edits = normalizePixelEdits(next);
  if (!edits) return { src: orig, orig: null, edits: null };
  const src = await bakeUri(orig, edits);
  return src ? { src, orig, edits } : null;
}

// image-core crops are in thousandths of a percent (as in DrawingML); Writer keeps the fraction of each side (0–0.95)
const UNIT = 100000;
const toCore = (c: Crop): Crop => ({ l: Math.round(c.l * UNIT), t: Math.round(c.t * UNIT), r: Math.round(c.r * UNIT), b: Math.round(c.b * UNIT) });
const fromCore = (c: Crop): Crop => ({ l: c.l / UNIT, t: c.t / UNIT, r: c.r / UNIT, b: c.b / UNIT });

/** The size a picture has when its crop changes: the scale stays, so the visible part grows or shrinks (it is not stretched). */
export function sizeForCrop(a: Record<string, any>, to: Crop | undefined): { width: number | null; height: number | null } {
  const from = (a.crop as Crop | null) ?? { l: 0, t: 0, r: 0, b: 0 };
  const kx0 = 1 - from.l - from.r;
  const ky0 = 1 - from.t - from.b;
  const c = to ?? { l: 0, t: 0, r: 0, b: 0 };
  return { width: a.width ? Math.max(8, Math.round((a.width / kx0) * (1 - c.l - c.r))) : null, height: a.height ? Math.max(8, Math.round((a.height / ky0) * (1 - c.t - c.b))) : null };
}

/** The picture tools' view of Writer: the selected picture (Writer selects one picture at a time). */
export function writerPictureHost(ui: WriterUI): PictureHost {
  const sel = () => selectedImage(ui.ctl.mainState);
  const patch = (pos: number, attrs: Record<string, unknown>) => {
    const v = ui.ctl.mainView;
    if (!v) return;
    const node = v.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'image') return;
    const tr = v.state.tr.setNodeMarkup(pos, null, { ...node.attrs, ...attrs });
    v.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
  };
  return {
    count: () => (sel() ? 1 : 0),
    pixelEdits: () => (sel()?.attrs.edits as PixelEdits | null) ?? {},
    setPixelEdits: async (next) => {
      const s = sel();
      if (!s) return;
      const at = await editedAttrs(s.attrs, next);
      if (!at) return;
      // the picture may have been changed or deleted while it was being made
      const now = ui.ctl.mainView?.state.doc.nodeAt(s.pos);
      if (now?.type.name === 'image' && now.attrs.src === s.attrs.src) patch(s.pos, at);
    },
    frame: () => {
      const a = sel()?.attrs ?? {};
      const f: FrameEdits = {};
      if (a.crop) f.crop = toCore(a.crop as Crop);
      if (a.border) f.border = { color: a.border.color, width: a.border.width };
      return f;
    },
    setFrame: (next) => {
      const s = sel();
      if (!s) return;
      const crop = next.crop && isCropped(next.crop) ? fromCore(next.crop) : undefined;
      patch(s.pos, { crop: crop ?? null, border: next.border ? { color: next.border.color, width: next.border.width } : null, ...sizeForCrop(s.attrs, crop) });
    },
    original: async () => {
      const s = sel();
      return s ? pixelsOfUri(s.attrs.orig ?? s.attrs.src) : null;
    },
    naturalSize: async () => {
      const px = await (async () => {
        const s = sel();
        return s ? pixelsOfUri(s.attrs.orig ?? s.attrs.src) : null;
      })();
      return px ? { w: px.w, h: px.h } : null;
    },
    accent: () => '#4472c4',
  };
}
