import { cloneItems, readClip, writeClip } from '@suitenova/diagram-core';
import type { Clip, DiagramCtl } from './ctl';

/*
 * Copy and paste through the system clipboard: between windows of Nova Diagram the shapes travel as they are (in a type
 * of our own and, for readers that only see the standard types, inside the HTML); other programs get their text. What
 * comes from outside goes in as shapes, pictures or a text box.
 */

export const CLIP_TYPE = 'application/x-nova-diagram';
const ATTR = 'data-nova-diagram';

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const fromBase64 = (s: string): string => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface Copied {
  text: string;
  html: string;
  payload: string;
}

/** What the selection puts on the clipboard (and keeps it for the window); null when there is nothing to copy. */
export function copySelection(ctl: DiagramCtl): Copied | null {
  if (!ctl.hasSelection) return null;
  ctl.flushTyping();
  const copy = cloneItems(ctl.basePage, ctl.selShapes, ctl.selConnectors);
  if (!copy.shapes.length && !copy.connectors.length) return null;
  ctl.clip = copy;
  const payload = writeClip(copy);
  const text = [...copy.shapes, ...copy.connectors].map((x) => x.text).filter(Boolean).join('\n');
  return { payload, text, html: `<div ${ATTR}="${toBase64(payload)}">${escapeHtml(text).replace(/\n/g, '<br>')}</div>` };
}

/** The shapes of Nova in what the clipboard holds, if any. */
export function shapesIn(custom: string, html: string): Clip | null {
  if (custom) {
    const c = readClip(custom);
    if (c) return c;
  }
  const m = new RegExp(`${ATTR}="([A-Za-z0-9+/=]+)"`).exec(html);
  if (!m) return null;
  try {
    return readClip(fromBase64(m[1]!));
  } catch {
    return null;
  }
}

export interface Incoming {
  custom: string;
  html: string;
  text: string;
  images: File[];
}

/**
 * Pastes what the clipboard holds: shapes of Nova; else text as a text box; else pictures (an image copied from another
 * program carries no text, while a piece of a document carries both and is wanted as text). False when it holds nothing.
 */
export function pasteIncoming(ctl: DiagramCtl, inc: Incoming, at: { x: number; y: number } | undefined, centre: { x: number; y: number }, insert: (files: File[], at: { x: number; y: number }) => void): boolean {
  const shapes = shapesIn(inc.custom, inc.html);
  if (shapes) {
    ctl.pasteContent(shapes, at);
    return true;
  }
  if (inc.text.trim()) {
    ctl.pasteText(inc.text, at ?? centre);
    return true;
  }
  if (inc.images.length) {
    insert(inc.images, at ?? centre);
    return true;
  }
  return false;
}

/** Reads the clipboard without a paste event (the buttons and menus); null when the system does not allow it. */
export async function readSystem(): Promise<Incoming | null> {
  try {
    const items = await navigator.clipboard.read();
    const inc: Incoming = { custom: '', html: '', text: '', images: [] };
    for (const item of items) {
      for (const type of item.types) {
        if (type === 'text/html') inc.html = await (await item.getType(type)).text();
        else if (type === 'text/plain') inc.text = await (await item.getType(type)).text();
        else if (/^image\/(png|jpeg|gif|webp|bmp)$/.test(type)) inc.images.push(new File([await item.getType(type)], `imagen.${type.slice(6)}`, { type }));
      }
    }
    return inc;
  } catch {
    return null;
  }
}
