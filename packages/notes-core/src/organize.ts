import { addContainer } from './canvas';
import { bodyOf, displayTitle, newId, newPage, nodeText, contentNode, pageText, textContainers, type Container, type FileContainer, type Notebook, type Page, type Section } from './model';
import { subpagesOf } from './structure';

/*
 * Organizar la libreta como en OneNote: mover y copiar páginas entre secciones, copiar y combinar secciones, ordenar las páginas,
 * ediciones recientes, «insertar espacio» y recuentos. Funciones puras: reciben una libreta y devuelven otra.
 */

const freshIds = (cs: Container[]): Container[] => cs.map((c) => ({ ...c, id: newId('c') }));

/** Una copia profunda de una página con identificadores nuevos (sin versiones ni protección: una página protegida no se copia en claro). */
export function clonePage(p: Page, titleSuffix = ''): Page {
  const b = bodyOf(p);
  return { ...newPage(titleSuffix && b.title ? `${b.title}${titleSuffix}` : b.title), containers: freshIds(b.containers), ink: b.ink.map((s) => ({ ...s, id: newId('k') })), style: b.style, level: p.level };
}

const mapSection = (nb: Notebook, id: string, fn: (s: Section) => Section): Notebook => ({ ...nb, sections: nb.sections.map((s) => (s.id === id ? fn(s) : s)) });

export interface MoveResult {
  nb: Notebook;
  /** Páginas movidas o copiadas (la página con sus subpáginas). */
  pageIds: string[];
}

/** ¿Se puede llevar la página a esa sección? No si alguna de las dos está bloqueada, ni si la página está bloqueada o es la última de su sección. */
export function canTransferPage(nb: Notebook, fromId: string, pageId: string, toId: string, copy: boolean): boolean {
  const from = nb.sections.find((s) => s.id === fromId);
  const to = nb.sections.find((s) => s.id === toId);
  const page = from?.pages.find((p) => p.id === pageId);
  if (!from || !to || !page) return false;
  if (to.vault || page.vault || from.vault) return false;
  if (!copy && fromId === toId) return false;
  if (!copy && from.pages.length - (1 + subpagesOf(from, pageId).length) < 1) return false;
  return true;
}

/**
 * Mueve (`copy` = false) o copia una página con sus subpáginas al final de otra sección. Las imágenes y grabaciones no se duplican:
 * son de la libreta, no de la sección. Una página movida conserva su identificador, sus versiones y su protección.
 */
export function transferPage(nb: Notebook, fromId: string, pageId: string, toId: string, copy: boolean): MoveResult | null {
  if (!canTransferPage(nb, fromId, pageId, toId, copy)) return null;
  const from = nb.sections.find((s) => s.id === fromId)!;
  const group = [from.pages.find((p) => p.id === pageId)!, ...subpagesOf(from, pageId)];
  const base = group[0]!.level;
  const moved = copy ? group.map((p) => ({ ...clonePage(p, p.id === pageId ? ' (copia)' : ''), level: p.level - base }) as Page) : group.map((p) => ({ ...p, level: (p.level - base) as Page['level'] }));
  const ids = new Set(group.map((p) => p.id));
  let out = nb;
  if (!copy) out = mapSection(out, fromId, (s) => ({ ...s, pages: s.pages.filter((p) => !ids.has(p.id)) }));
  out = mapSection(out, toId, (s) => ({ ...s, pages: [...s.pages, ...moved] }));
  return { nb: out, pageIds: moved.map((p) => p.id) };
}

/** Copia una sección entera (con sus páginas) a continuación de la original. */
export function copySection(nb: Notebook, sectionId: string): { nb: Notebook; sectionId: string } | null {
  const s = nb.sections.find((x) => x.id === sectionId);
  if (!s || s.vault) return null;
  const copy: Section = { ...s, id: newId('s'), name: `${s.name} (copia)`, pages: s.pages.map((p) => (p.vault ? { ...p, id: newId('p') } : { ...clonePage(p), level: p.level })) };
  delete copy.protect;
  const i = nb.sections.findIndex((x) => x.id === sectionId);
  const sections = [...nb.sections];
  sections.splice(i + 1, 0, copy);
  return { nb: { ...nb, sections }, sectionId: copy.id };
}

/** Vuelca las páginas de una sección al final de otra y elimina la primera (sin pasar por la papelera: no se pierde nada). */
export function mergeSections(nb: Notebook, srcId: string, dstId: string): Notebook | null {
  const src = nb.sections.find((s) => s.id === srcId);
  const dst = nb.sections.find((s) => s.id === dstId);
  if (!src || !dst || srcId === dstId || src.vault || dst.vault || nb.sections.length < 2) return null;
  const merged = mapSection(nb, dstId, (s) => ({ ...s, pages: [...s.pages, ...src.pages] }));
  return { ...merged, sections: merged.sections.filter((s) => s.id !== srcId) };
}

// ------------------------------------------------------------------ ordenar

export type PageSort = 'title' | 'created' | 'modified' | 'created-desc' | 'modified-desc';

/** Los «bloques» de la sección: cada página de nivel 0 con sus subpáginas. */
function blocks(s: Section): Page[][] {
  const out: Page[][] = [];
  for (const p of s.pages) {
    if (p.level === 0 || !out.length) out.push([p]);
    else out[out.length - 1]!.push(p);
  }
  return out;
}

/** Ordena las páginas de una sección (cada página con sus subpáginas, que mantienen su orden). */
export function sortPages(nb: Notebook, sectionId: string, by: PageSort): Notebook {
  const s = nb.sections.find((x) => x.id === sectionId);
  if (!s || s.vault) return nb;
  const key = (b: Page[]): string | number => {
    const p = b[0]!;
    if (by === 'title') return displayTitle(p).toLocaleLowerCase('es');
    if (by.startsWith('created')) return p.created;
    return p.modified;
  };
  const dir = by.endsWith('-desc') ? -1 : 1;
  const sorted = [...blocks(s)].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const c = typeof ka === 'string' ? (ka as string).localeCompare(kb as string, 'es') : (ka as number) - (kb as number);
    return c * dir;
  });
  const pages = sorted.flat();
  return pages.every((p, i) => p === s.pages[i]) ? nb : mapSection(nb, sectionId, (x) => ({ ...x, pages }));
}

// ------------------------------------------------------------------ recientes y no leídas

export interface RecentPage {
  sectionId: string;
  sectionName: string;
  pageId: string;
  title: string;
  modified: number;
}

/** Las páginas editadas en los últimos `days` días (o todas si `days` es 0), de la más reciente a la más antigua. Las bloqueadas no se listan. */
export function recentPages(nb: Notebook, days = 7, now = Date.now(), limit = 200): RecentPage[] {
  const since = days > 0 ? now - days * 86400000 : 0;
  const out: RecentPage[] = [];
  for (const s of nb.sections) {
    if (s.vault) continue;
    for (const p of s.pages) {
      if (p.vault || p.modified < since) continue;
      out.push({ sectionId: s.id, sectionName: s.name, pageId: p.id, title: displayTitle(p), modified: p.modified });
    }
  }
  return out.sort((a, b) => b.modified - a.modified).slice(0, limit);
}

/** Lo último que se vio de cada página: una página cuya fecha de modificación es posterior (o que no se ha visto) está «sin leer». */
export type SeenMap = Record<string, number>;

export function unreadPages(nb: Notebook, seen: SeenMap): RecentPage[] {
  return recentPages(nb, 0).filter((r) => (seen[r.pageId] ?? 0) < r.modified);
}

// ------------------------------------------------------------------ insertar espacio

/**
 * «Insertar espacio»: empuja hacia abajo todo lo que está por debajo de la línea `y` (cuadros y tinta). Con `amount` negativo
 * se quita espacio, sin que nada pase por encima de `y`.
 */
export function insertSpace<P extends { containers: Container[]; ink: { pts: number[] }[] }>(p: P, y: number, amount: number, heights: Record<string, number> = {}): P {
  let dy = Math.round(amount);
  if (!dy) return p;
  if (dy < 0) {
    // lo más que se puede subir: hasta la parte baja de lo que queda por encima de la línea
    const bottoms = [
      ...p.containers.filter((c) => c.y < y).map((c) => c.y + ('h' in c ? c.h : (heights[c.id] ?? 40))),
      ...p.ink.flatMap((s) => s.pts.filter((_, i) => i % 2 === 1).filter((v) => v < y)),
    ];
    const floor = bottoms.length ? Math.max(...bottoms) : 0;
    const top = Math.min(...[...p.containers.filter((c) => c.y >= y).map((c) => c.y), ...p.ink.flatMap((s) => s.pts.filter((_, i) => i % 2 === 1).filter((v) => v >= y))], Infinity);
    if (top === Infinity) return p;
    dy = -Math.min(-dy, Math.max(0, top - Math.max(y, floor)));
    if (!dy) return p;
  }
  const containers = p.containers.map((c) => (c.y >= y ? { ...c, y: c.y + dy } : c));
  const ink = p.ink.map((s) => {
    return Math.min(...s.pts.filter((_, i) => i % 2 === 1)) >= y ?{ ...s, pts: s.pts.map((v, i) => (i % 2 === 1 ? v + dy : v)) } : s;
  });
  return { ...p, containers, ink };
}

// ------------------------------------------------------------------ recuento

export interface PageCount {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  boxes: number;
  images: number;
  recordings: number;
  files: number;
  strokes: number;
}

/** Lo que se cuenta de una página (palabras y caracteres del texto de todos los cuadros, y cuántos objetos hay). */
export function countPage(p: Page): PageCount {
  const text = textContainers(p)
    .map((c) => nodeText(contentNode(c.content)))
    .join('\n');
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  return {
    words,
    characters: text.replace(/\n/g, '').length,
    charactersNoSpaces: text.replace(/\s/g, '').length,
    boxes: textContainers(p).length,
    images: p.containers.filter((c) => c.kind === 'image').length,
    recordings: p.containers.filter((c) => c.kind === 'media').length,
    files: p.containers.filter((c) => c.kind === 'file').length,
    strokes: p.ink.length,
  };
}

/** Un cuadro de archivo adjunto. */
export function newFileContainer(asset: string, name: string, size: number, x = 48, y = 24): FileContainer {
  return { kind: 'file', id: newId('c'), x, y, w: 300, h: 64, z: 1, asset, name, size };
}

/** Añade un adjunto a una página. */
export const addFile = <P extends { containers: Container[] }>(p: P, f: FileContainer): P => addContainer(p as never, f) as P;

/** El texto plano de una página (para leerlo en voz alta o copiarlo): el título y el de cada cuadro de arriba abajo. */
export function readableText(p: Page): string {
  return [p.title.trim(), pageText(p)].filter(Boolean).join('\n');
}

/**
 * The runs of `readableText(p)` that are marked with a language (offsets into that text): to read them with a voice of their language. Runs without a
 * mark have the language of the notebook and are not listed.
 */
export function readableLangs(p: Page): { start: number; end: number; lang: string }[] {
  const out: { start: number; end: number; lang: string }[] = [];
  const title = p.title.trim();
  // the title, then one line break, then the text of each box that has any (the same pieces and separators as `readableText`)
  let base = title ? title.length + 1 : 0;
  for (const c of textContainers(p)) {
    const doc = contentNode(c.content);
    const text = nodeText(doc);
    if (!text.trim()) continue;
    doc.descendants((n, pos) => {
      if (n.isText) {
        const m = n.marks.find((x) => x.type.name === 'lang');
        const lang = m ? String(m.attrs.value ?? '') : '';
        if (lang) {
          const start = base + doc.textBetween(0, pos, '\n', ' ').length;
          out.push({ start, end: start + n.text!.length, lang });
        }
      }
      return true;
    });
    base += text.length + 1;
  }
  return out;
}
