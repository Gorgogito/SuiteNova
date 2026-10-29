import { buildMessage } from '@suitenova/mail-core';
import { bakeFormulas, contentNode, displayTitle, pageExtent, strokePath, textContainers, type Notebook, type Page } from '@suitenova/notes-core';
import { DEFAULT_DOC_DEFAULTS, defaultStyles, emptyWriterDoc, ensureSections, nodeTypes, parseMath, styleCss, toMathML, writeDocx, writerSchema } from '@suitenova/writer-core';
import { DOMSerializer, Fragment, type Node as PMNode } from 'prosemirror-model';

const ser = DOMSerializer.fromSchema(writerSchema);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** El texto de un cuadro como HTML (con las fórmulas de las tablas ya calculadas). */
function textHtml(content: unknown, mathml = false): string {
  const node = contentNode(bakeFormulas(content));
  const div = document.createElement('div');
  div.appendChild(ser.serializeFragment(node.content));
  // las ecuaciones se dibujan como MathML en la página web; en el correo (que casi no lo admite) queda el texto LaTeX
  if (mathml)
    div.querySelectorAll<HTMLElement>('span.nw-math').forEach((el) => {
      try {
        el.innerHTML = toMathML(parseMath(el.dataset.tex ?? ''), el.dataset.display === '1');
      } catch {
        /* se deja el texto */
      }
    });
  return div.innerHTML;
}

/** La tinta de la página como un SVG. */
export function inkSvg(page: Page, w: number, h: number): string {
  const paths = page.ink
    .map((s) => `<path d="${strokePath(s)}" fill="none" stroke="${esc(s.color)}" stroke-width="${s.width}" stroke-opacity="${s.opacity}" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${paths}</svg>`;
}

/** La tinta de la página como una imagen PNG (para el correo). Recorta el área que ocupa. */
export async function inkPng(page: Page): Promise<{ data: Uint8Array; w: number; h: number } | null> {
  if (!page.ink.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const s of page.ink)
    for (let i = 0; i < s.pts.length; i += 2) {
      x1 = Math.min(x1, s.pts[i]! - s.width);
      x2 = Math.max(x2, s.pts[i]! + s.width);
      y1 = Math.min(y1, s.pts[i + 1]! - s.width);
      y2 = Math.max(y2, s.pts[i + 1]! + s.width);
    }
  x1 = Math.max(0, Math.floor(x1) - 8);
  y1 = Math.max(0, Math.floor(y1) - 8);
  const w = Math.ceil(x2 + 8 - x1);
  const h = Math.ceil(y2 + 8 - y1);
  const full = inkSvg(page, Math.ceil(x2 + 8), Math.ceil(y2 + 8));
  const img = new Image();
  const url = URL.createObjectURL(new Blob([full], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('No se pudo dibujar la tinta.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(img, -x1, -y1);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) return null;
  return { data: new Uint8Array(await blob.arrayBuffer()), w, h };
}

const CSS = styleCss(defaultStyles(), { ...DEFAULT_DOC_DEFAULTS }) + `body{margin:0;font-family:Calibri,'Segoe UI',sans-serif;font-size:11pt}table{border-collapse:collapse}td,th{border:1px solid #888;padding:2px 6px}p{margin:.2em 0}img{max-width:100%}`;

/** La página como una página web que respeta las posiciones de los cuadros. Audio y vídeo se incluyen con su reproductor. */
export function pageToHtml(nb: Notebook, page: Page): string {
  const { w, h } = pageExtent(page);
  const parts: string[] = [];
  for (const c of page.containers) {
    const pos = `position:absolute;left:${c.x}px;top:${c.y}px;width:${c.w}px`;
    if (c.kind === 'text') parts.push(`<div class="nw-doc" style="${pos}">${textHtml(c.content, true)}</div>`);
    else {
      const a = nb.assets[c.asset];
      if (!a) continue;
      const src = `data:${a.mime};base64,${a.data}`;
      if (c.kind === 'image') parts.push(`<img style="${pos};height:${c.h}px" src="${src}" alt="${esc(c.alt)}">`);
      else if (c.media === 'audio') parts.push(`<audio style="${pos}" controls src="${src}"></audio>`);
      else parts.push(`<video style="${pos};height:${c.h}px" controls src="${src}"></video>`);
    }
  }
  const title = esc(displayTitle(page));
  const ink = page.ink.length ? `<div style="position:absolute;left:0;top:0;pointer-events:none">${inkSvg(page, w, h)}</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body><h1 style="margin:12px">${title}</h1><div style="position:relative;width:${w}px;height:${h}px;background:${esc(page.style.color)}">${parts.join('')}${ink}</div></body></html>`;
}

/** Un documento de Word con el texto de los cuadros (de arriba abajo) y las imágenes; la tinta y el audio/vídeo no caben. */
export async function pageToDocx(nb: Notebook, page: Page): Promise<{ data: Uint8Array; warnings: string[] }> {
  const blocks: PMNode[] = [];
  const warnings: string[] = [];
  const items = [...page.containers].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const c of items) {
    if (c.kind === 'text') {
      const n = contentNode(bakeFormulas(c.content));
      n.forEach((child) => void blocks.push(child));
    } else if (c.kind === 'image') {
      const a = nb.assets[c.asset];
      if (a) blocks.push(writerSchema.nodes.paragraph!.create(null, nodeTypes.image!.create({ src: `data:${a.mime};base64,${a.data}`, alt: c.alt, width: c.w, height: c.h })));
    } else warnings.push(`El ${c.media === 'audio' ? 'audio' : 'vídeo'} «${c.name}» no se incluye en el documento de Word.`);
  }
  if (page.ink.length) warnings.push('La tinta y los dibujos no se incluyen en el documento de Word.');
  const body = writerSchema.nodes.doc!.create(null, Fragment.fromArray(blocks.length ? blocks : [writerSchema.nodes.paragraph!.create()]));
  const r = await writeDocx({ ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: ensureSections(body), title: displayTitle(page) });
  return { data: r.data, warnings: [...warnings, ...r.warnings] };
}

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const bytesOf = (b64s: string) => Uint8Array.from(atob(b64s), (ch) => ch.charCodeAt(0));

/**
 * La página como un mensaje de correo (.eml) sin enviar: el texto y las imágenes en el cuerpo (las imágenes van incrustadas), la
 * tinta como una imagen, y el audio y el vídeo como adjuntos.
 */
export async function pageToEml(nb: Notebook, page: Page, o: { to: string; subject: string }): Promise<string> {
  const attachments: NonNullable<Parameters<typeof buildMessage>[0]['attachments']> = [];
  const html: string[] = [];
  const text: string[] = [];
  const items = [...page.containers].sort((a, b) => a.y - b.y || a.x - b.x);
  let n = 0;
  for (const c of items) {
    if (c.kind === 'text') {
      html.push(textHtml(c.content));
    } else {
      const a = nb.assets[c.asset];
      if (!a) continue;
      if (c.kind === 'image') {
        const cid = `img${++n}@notes.nova`;
        attachments.push({ filename: `${a.name || cid}`, contentType: a.mime, data: bytesOf(a.data), contentId: cid });
        html.push(`<p><img src="cid:${cid}" alt="${esc(c.alt)}" width="${c.w}"></p>`);
      } else attachments.push({ filename: a.name || c.name, contentType: a.mime.split(';')[0]!, data: bytesOf(a.data) });
    }
  }
  const ink = await inkPng(page);
  if (ink) {
    attachments.push({ filename: 'tinta.png', contentType: 'image/png', data: ink.data, contentId: 'ink@notes.nova' });
    html.push(`<p><img src="cid:ink@notes.nova" alt="Tinta" width="${Math.min(ink.w, 600)}"></p>`);
  }
  for (const c of textContainers(page)) text.push(nodeTextOf(c.content));
  const to = o.to
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((email) => ({ name: '', email }));
  const eml = buildMessage({
    from: { name: '', email: 'yo@nova.local' },
    to,
    subject: o.subject,
    text: text.filter(Boolean).join('\n\n') || displayTitle(page),
    html: `<html><body style="font-family:Calibri,sans-serif">${html.join('')}</body></html>`,
    attachments,
  });
  return eml.replace(/^(Date:)/m, 'X-Unsent: 1\r\n$1');
}

function nodeTextOf(content: unknown): string {
  return contentNode(bakeFormulas(content)).textBetween(0, contentNode(bakeFormulas(content)).content.size, '\n', ' ');
}

export { b64 as bytesToBase64 };
