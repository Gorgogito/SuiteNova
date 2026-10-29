import type { Deck, Slide } from '@suitenova/slides-core';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { AssetUrls } from '../render/assets';
import { SlideCanvas } from '../render/SlideCanvas';

/*
 * Slides as pictures. The slide is drawn by the same component as on screen, copied with every style written out, and handed to the
 * engine as an SVG picture that is painted on a canvas. What the engine cannot draw inside such a picture (video, some effects)
 * is left out.
 */

const dataCache = new Map<string, string>();

async function blobToData(url: string): Promise<string> {
  const hit = dataCache.get(url);
  if (hit) return hit;
  const blob = await (await fetch(url)).blob();
  const data = await new Promise<string>((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => bad(r.error);
    r.readAsDataURL(blob);
  });
  dataCache.set(url, data);
  return data;
}

async function inlineBlobs(text: string): Promise<string> {
  const urls = [...new Set(text.match(/blob:[^"')\s]+/g) ?? [])];
  let out = text;
  for (const u of urls) out = out.split(u).join(await blobToData(u));
  return out;
}

const SKIP = new Set(['SCRIPT', 'STYLE']);

/** Copies the computed style of every element of `from` into the matching element of `to`. */
function inlineStyles(from: Element, to: Element): void {
  const cs = getComputedStyle(from);
  let css = '';
  for (let i = 0; i < cs.length; i++) {
    const p = cs[i]!;
    css += `${p}:${cs.getPropertyValue(p)};`;
  }
  (to as HTMLElement).setAttribute('style', css);
  const a = [...from.children];
  const b = [...to.children];
  a.forEach((c, i) => {
    if (b[i] && !SKIP.has(c.tagName)) inlineStyles(c, b[i]!);
  });
}

const frame = () => new Promise<void>((ok) => requestAnimationFrame(() => ok()));

/** A slide drawn on a canvas `width` pixels wide. */
export async function slideToCanvas(deck: Deck, slide: Slide, urls: AssetUrls, index: number, width: number): Promise<HTMLCanvasElement> {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${deck.size.w}px;height:${deck.size.h}px;overflow:hidden;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<SlideCanvas deck={deck} slide={slide} urls={urls} slideNumber={index + 1} mode="show" prompts={false} />));
    await frame();
    await document.fonts?.ready;
    // pictures decode before the copy is made
    await Promise.all([...host.querySelectorAll('image, img')].map((n) => {
      const href = n.getAttribute('href') ?? n.getAttribute('src');
      if (!href) return undefined;
      const im = new Image();
      im.src = href;
      return im.decode().catch(() => undefined);
    }));
    await frame();
    await frame();
    const node = host.firstElementChild as HTMLElement;
    const clone = node.cloneNode(true) as HTMLElement;
    inlineStyles(node, clone);
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    for (const v of clone.querySelectorAll('video, audio')) v.remove();
    let xhtml = new XMLSerializer().serializeToString(clone);
    xhtml = await inlineBlobs(xhtml);
    const w = deck.size.w;
    const h = deck.size.h;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><foreignObject width="${w}" height="${h}">${xhtml}</foreignObject></svg>`;
    const img = new Image();
    const loaded = new Promise<void>((ok, bad) => {
      img.onload = () => ok();
      img.onerror = () => bad(new Error('No se pudo dibujar la diapositiva.'));
    });
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await loaded;
    const cv = document.createElement('canvas');
    cv.width = Math.round(width);
    cv.height = Math.round((width * h) / w);
    const g = cv.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(img, 0, 0, cv.width, cv.height);
    return cv;
  } finally {
    root.unmount();
    host.remove();
  }
}

export const canvasBlob = (cv: HTMLCanvasElement, type: 'image/png' | 'image/jpeg'): Promise<Uint8Array> =>
  new Promise((ok, bad) => cv.toBlob(async (b) => (b ? ok(new Uint8Array(await b.arrayBuffer())) : bad(new Error('No se pudo crear la imagen.'))), type, 0.92));
