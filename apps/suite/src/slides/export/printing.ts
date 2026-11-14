import { docText, outlineOf, type Slide } from '@suitenova/slides-core';
import type { SlidesCtl } from '../ctl';
import { canvasBlob, slideToCanvas } from './raster';

/*
 * Printing. The pages are drawn in a hidden container (`.sl-printroot`) that only shows when printing; the rest of the application is
 * hidden by the print style. Each slide is first drawn on a canvas, so what is printed is what is seen.
 */

export type PrintWhat = 'slides' | 'notes' | 'handout' | 'outline';
export interface PrintOpts {
  what: PrintWhat;
  /** slides per page in handouts: 1, 2, 3, 4, 6 or 9 */
  per: number;
  /** "all", "current" or ranges like "1-3, 5" */
  range: string;
  hidden: boolean;
  gray: boolean;
  frame: boolean;
}

export const DEFAULT_PRINT: PrintOpts = { what: 'slides', per: 6, range: 'all', hidden: false, gray: false, frame: true };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Slide numbers (1-based) of a range such as "1-3, 5". Returns null when it cannot be read. */
export function parseRange(text: string, total: number, current: number): number[] | null {
  const t = text.trim().toLowerCase();
  if (!t || t === 'all' || t === 'todas') return Array.from({ length: total }, (_x, i) => i + 1);
  if (t === 'current' || t === 'actual') return [current + 1];
  const out = new Set<number>();
  for (const part of t.split(/[,;]/)) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || a > total) return null;
    for (let i = a; i <= Math.min(b, total); i++) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}

const STYLE_ID = 'sl-print-style';
const ROOT_CLASS = 'sl-printroot';

export function endPrint(): void {
  document.querySelector(`.${ROOT_CLASS}`)?.remove();
  document.getElementById(STYLE_ID)?.remove();
}

const GRID: Record<number, [number, number]> = { 1: [1, 1], 2: [1, 2], 4: [2, 2], 6: [2, 3], 9: [3, 3] };

/** Builds the pages and their print style. Returns the number of pages (nothing is shown until the browser prints). */
export async function buildPrint(c: SlidesCtl, o: PrintOpts): Promise<{ pages: number; slides: number } | { error: string }> {
  const deck = c.realDeck;
  const nums = parseRange(o.range, deck.slides.length, c.index);
  if (!nums) return { error: 'El intervalo de diapositivas no es válido. Ejemplo: 1-3, 5' };
  const list: { slide: Slide; n: number }[] = nums.map((n) => ({ slide: deck.slides[n - 1]!, n })).filter((x) => o.hidden || !x.slide.hidden);
  if (!list.length) return { error: 'No hay diapositivas que imprimir con esa selección (las ocultas no se imprimen salvo que se marque).' };
  endPrint();
  const width = o.what === 'slides' ? 1600 : o.what === 'handout' && o.per <= 2 ? 1200 : 900;
  const imgs: string[] = [];
  if (o.what !== 'outline') {
    for (const { slide, n } of list) {
      const cv = await slideToCanvas(deck, slide, c.urls, n - 1, width);
      const data = await canvasBlob(cv, 'image/jpeg');
      let bin = '';
      for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
      imgs.push(`data:image/jpeg;base64,${btoa(bin)}`);
    }
  }
  const W = deck.size.w;
  const H = deck.size.h;
  const frame = o.frame ? 'border:1px solid #888;' : '';
  const gray = o.gray ? 'filter:grayscale(1);' : '';
  const img = (i: number, extra = '') => `<img src="${imgs[i]}" alt="" style="width:100%;display:block;${frame}${gray}${extra}">`;
  let pages: string[] = [];
  let pageCss = '';
  if (o.what === 'slides') {
    pageCss = `@page{size:${W}px ${H}px;margin:0}`;
    pages = list.map((_x, i) => `<section class="sl-pg" style="width:${W}px;height:${H}px;"><img src="${imgs[i]}" alt="" style="width:100%;height:100%;display:block;${gray}"></section>`);
  } else if (o.what === 'notes') {
    pageCss = '@page{size:A4 portrait;margin:14mm}';
    pages = list.map(({ slide }, i) => {
      const notes = slide.notes ? docText(slide.notes.doc).replace(/\v/g, '\n') : '';
      return `<section class="sl-pg"><div style="width:78%;margin:0 auto 8mm">${img(i)}</div><div style="font:12pt Calibri,Arial,sans-serif;white-space:pre-wrap;line-height:1.4">${esc(notes)}</div></section>`;
    });
  } else if (o.what === 'handout') {
    pageCss = '@page{size:A4 portrait;margin:14mm}';
    const per = [1, 2, 3, 4, 6, 9].includes(o.per) ? o.per : 6;
    for (let i = 0; i < list.length; i += per) {
      const chunk = list.slice(i, i + per).map((x, k) => ({ x, k: i + k }));
      if (per === 3) {
        pages.push(`<section class="sl-pg"><div style="display:grid;grid-template-rows:repeat(3,1fr);gap:8mm;height:100%">${chunk.map(({ k }) => `<div style="display:grid;grid-template-columns:55% 1fr;gap:10mm;align-items:center">${img(k)}<div style="border-bottom:1px solid #999;height:8mm"></div></div>`).join('')}</div></section>`);
      } else {
        const [cols, rows] = GRID[per]!;
        pages.push(`<section class="sl-pg"><div style="display:grid;grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr);gap:7mm;height:100%;align-content:center">${chunk.map(({ k }) => `<div style="display:flex;align-items:center">${img(k)}</div>`).join('')}</div></section>`);
      }
    }
  } else {
    pageCss = '@page{size:A4 portrait;margin:18mm}';
    const ids = new Set(list.map((x) => x.slide.id));
    const rows = outlineOf(deck).filter((r) => ids.has(r.sid));
    const num = new Map(list.map((x) => [x.slide.id, x.n]));
    const html = rows.map((r) => (r.kind === 'title' ? `<p style="font:bold 14pt Calibri,Arial,sans-serif;margin:10pt 0 3pt"><span style="color:#666;margin-right:8pt">${num.get(r.sid)}</span>${esc(r.text)}</p>` : `<p style="font:11pt Calibri,Arial,sans-serif;margin:0 0 2pt ${20 + r.lvl * 18}pt">${esc(r.text)}</p>`)).join('');
    pages = [`<section class="sl-pg">${html}</section>`];
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `${pageCss}
.${ROOT_CLASS}{display:none}
@media print{
  html,body{background:#fff!important;height:auto!important;overflow:visible!important}
  body > *:not(.${ROOT_CLASS}){display:none!important}
  .${ROOT_CLASS}{display:block!important}
  .sl-pg{break-after:page;page-break-after:always;overflow:hidden;box-sizing:border-box}
  .sl-pg:last-child{break-after:auto;page-break-after:auto}
  ${o.what === 'notes' || o.what === 'handout' ? '.sl-pg{height:calc(297mm - 28mm - 1mm)}' : ''}
  img{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}`;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = ROOT_CLASS;
  root.innerHTML = pages.join('');
  document.body.appendChild(root);
  return { pages: pages.length, slides: list.length };
}

/** Builds the pages and opens the system print dialog; the pages are removed afterwards. */
export async function printWith(c: SlidesCtl, o: PrintOpts): Promise<{ error?: string }> {
  const r = await buildPrint(c, o);
  if ('error' in r) return r;
  window.addEventListener('afterprint', endPrint, { once: true });
  setTimeout(() => window.print(), 50);
  return {};
}
