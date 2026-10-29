import { bakeFormulas } from './formulas';
import { contentNode, displayTitle, nodeText, textContainers, type Notebook, type Page } from './model';
import { findTag, normalizeTag } from './tags';

/** Una huella corta de una imagen incrustada en un texto (para guardar su OCR sin repetir la imagen entera). */
export function imageKey(src: string): string {
  let h = 0x811c9dc5;
  const sample = src.length > 4000 ? src.slice(0, 2000) + src.slice(-2000) : src;
  for (let i = 0; i < sample.length; i++) h = Math.imul(h ^ sample.charCodeAt(i), 0x01000193) >>> 0;
  return `h:${src.length.toString(36)}-${h.toString(16)}`;
}

export interface SearchHit {
  sectionId: string;
  sectionName: string;
  pageId: string;
  title: string;
  snippet: string;
  inTitle: boolean;
  /** Dónde se encontró: en el título, en el texto, en una imagen (reconocida con OCR), en una etiqueta o en una grabación. */
  where: 'title' | 'text' | 'image' | 'tag' | 'media';
}

const fold = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

interface Source {
  where: SearchHit['where'];
  text: string;
}

/** Todo el texto buscable de una página, por origen. Las fórmulas de las tablas cuentan con su resultado. */
export function searchSources(nb: Notebook, p: Page): Source[] {
  const out: Source[] = [{ where: 'title', text: p.title }];
  for (const c of textContainers(p)) {
    const doc = contentNode(bakeFormulas(c.content));
    out.push({ where: 'text', text: nodeText(doc) });
    const tags = new Set<string>();
    doc.descendants((n) => {
      if (n.type.name === 'paragraph' && n.attrs.tag) {
        const t = findTag(normalizeTag(n.attrs.tag as string), nb.tagDefs);
        if (t) tags.add(t.label);
      } else if (n.type.name === 'image') {
        const src = String(n.attrs.src ?? '');
        out.push({ where: 'image', text: `${n.attrs.alt ?? ''}\n${nb.ocr[imageKey(src)]?.text ?? ''}` });
      }
      return true;
    });
    if (tags.size) out.push({ where: 'tag', text: [...tags].join('\n') });
  }
  for (const c of p.containers) {
    if (c.kind === 'image') out.push({ where: 'image', text: `${c.alt}\n${nb.assets[c.asset]?.name ?? ''}\n${nb.ocr[c.asset]?.text ?? ''}` });
    else if (c.kind === 'media') out.push({ where: 'media', text: c.name });
  }
  return out;
}

/**
 * Search every page that is not locked. Case and accents are ignored; all the words must appear (in any order) somewhere in the page:
 * title, text, tables (with the result of their formulas), tags, and the text found in images by OCR.
 */
export function searchNotebook(nb: Notebook, query: string, limit = 100): SearchHit[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  for (const s of nb.sections) {
    if (s.vault) continue;
    for (const p of s.pages) {
      if (p.vault) continue;
      const sources = searchSources(nb, p);
      const hay = fold(sources.map((x) => x.text).join('\n'));
      if (!words.every((w) => hay.includes(w))) continue;
      const first = words[0]!;
      const src = sources.find((x) => fold(x.text).includes(first)) ?? sources[0]!;
      const full = src.text.replace(/\s+/g, ' ');
      const at = Math.max(0, fold(full).indexOf(first));
      const start = Math.max(0, at - 30);
      hits.push({
        sectionId: s.id,
        sectionName: s.name,
        pageId: p.id,
        title: displayTitle(p),
        snippet: (start > 0 ? '…' : '') + full.slice(start, start + 90),
        inTitle: words.every((w) => fold(p.title).includes(w)),
        where: src.where,
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits.sort((a, b) => Number(b.inTitle) - Number(a.inTitle));
}

export interface OcrTarget {
  key: string;
  /** La imagen como dirección `data:`. */
  src: string;
}

/** Las imágenes de la libreta que todavía no se han reconocido con OCR (de las páginas no bloqueadas). */
export function pendingOcr(nb: Notebook, max = 1000): OcrTarget[] {
  const out: OcrTarget[] = [];
  const seen = new Set<string>();
  const add = (key: string, src: string) => {
    if (!nb.ocr[key] && !seen.has(key) && out.length < max) {
      seen.add(key);
      out.push({ key, src });
    }
  };
  for (const s of nb.sections) {
    if (s.vault) continue;
    for (const p of s.pages) {
      if (p.vault) continue;
      for (const c of p.containers) {
        if (c.kind === 'image') {
          const a = nb.assets[c.asset];
          if (a && a.mime.startsWith('image/') && !a.mime.includes('svg')) add(c.asset, `data:${a.mime};base64,${a.data}`);
        } else if (c.kind === 'text')
          contentNode(c.content).descendants((n) => {
            if (n.type.name === 'image' && typeof n.attrs.src === 'string' && n.attrs.src.startsWith('data:image/') && !n.attrs.src.startsWith('data:image/svg')) add(imageKey(n.attrs.src), n.attrs.src);
            return true;
          });
      }
    }
  }
  return out;
}
