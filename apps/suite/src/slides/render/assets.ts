import type { Deck } from '@suitenova/slides-core';

/** Object URLs for the assets of a deck (created once per asset and kept until the deck is closed). */
export class AssetUrls {
  private urls = new Map<string, string>();
  private bytes = new Map<string, Uint8Array>();
  constructor(private deck: () => Deck) {}
  url(id: string | undefined): string {
    if (!id) return '';
    const a = this.deck().assets[id];
    if (!a) return '';
    const hit = this.urls.get(id);
    if (hit && this.bytes.get(id) === a.data) return hit;
    if (hit) URL.revokeObjectURL(hit);
    const copy = new Uint8Array(a.data.byteLength);
    copy.set(a.data);
    const u = URL.createObjectURL(new Blob([copy], { type: a.mime }));
    this.urls.set(id, u);
    this.bytes.set(id, a.data);
    return u;
  }
  dispose(): void {
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
    this.bytes.clear();
  }
}

const dims = new Map<string, { w: number; h: number }>();
const waiting = new Set<string>();
const listeners = new Set<() => void>();

/** Natural size (px) of an image, once it has loaded; 96×96 until then. */
export function imageDims(url: string): { w: number; h: number } {
  const hit = dims.get(url);
  if (hit) return hit;
  if (!waiting.has(url) && typeof Image !== 'undefined') {
    waiting.add(url);
    const img = new Image();
    img.onload = () => {
      dims.set(url, { w: img.naturalWidth || 96, h: img.naturalHeight || 96 });
      listeners.forEach((l) => l());
    };
    img.src = url;
  }
  return { w: 96, h: 96 };
}
export const onImageDims = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
