import { emptyDoc, writerSchema } from '@suitenova/writer-core';
import type { Node as PMNode } from 'prosemirror-model';
import { baseTag, normalizeTag, type TagDef } from './tags';

/** Las etiquetas son identificadores (`todo`, `important`, una propia…); `todo:done` es «Para hacer» ya hecha. */
export type NoteTag = string;

// ------------------------------------------------------------------ lienzo

interface Box {
  id: string;
  /** Posición y ancho en píxeles del lienzo de la página (96 por pulgada). */
  x: number;
  y: number;
  w: number;
  /** Orden de apilado: el mayor queda delante. */
  z: number;
}

/** Un cuadro de texto: su propio documento de texto (con tablas, listas, imágenes en línea, ecuaciones…). El alto lo da el texto. */
export interface TextContainer extends Box {
  kind: 'text';
  /** Documento de ProseMirror (JSON) con el esquema de Nova Writer. */
  content: unknown;
}

export interface ImageContainer extends Box {
  kind: 'image';
  h: number;
  /** Identificador en `Notebook.assets`. */
  asset: string;
  alt: string;
}

export interface MediaContainer extends Box {
  kind: 'media';
  h: number;
  asset: string;
  media: 'audio' | 'video';
  name: string;
  seconds: number;
}

export type Container = TextContainer | ImageContainer | MediaContainer;

export type StrokeTool = 'pen' | 'highlighter' | 'line' | 'rect' | 'ellipse' | 'arrow';

/** Un trazo de tinta o una forma dibujada. `pts` son pares x, y; las formas llevan solo dos puntos (esquinas o extremos). */
export interface Stroke {
  id: string;
  tool: StrokeTool;
  color: string;
  width: number;
  opacity: number;
  pts: number[];
}

export type Ruling = 'none' | 'narrow' | 'standard' | 'wide' | 'grid-small' | 'grid-medium' | 'grid-large';
export const RULINGS: Ruling[] = ['none', 'narrow', 'standard', 'wide', 'grid-small', 'grid-medium', 'grid-large'];

export interface PageStyle {
  ruling: Ruling;
  /** Color del papel. */
  color: string;
  /** Línea de margen roja a la izquierda. */
  margin: boolean;
}

export const defaultStyle = (): PageStyle => ({ ruling: 'none', color: '#ffffff', margin: false });

// ------------------------------------------------------------------ protección con contraseña

/** Lo que se guarda para poder comprobar una contraseña y volver a cifrar; nunca la contraseña ni la clave. */
export interface Protect {
  salt: string;
  iter: number;
  hint?: string;
}

/** Contenido cifrado (AES-256-GCM): solo existe en el archivo y mientras el elemento está bloqueado. */
export interface Vault {
  iv: string;
  data: string;
}

// ------------------------------------------------------------------ páginas, secciones y libreta

/** Lo que se versiona y se cifra de una página. */
export interface PageBody {
  title: string;
  containers: Container[];
  ink: Stroke[];
  style: PageStyle;
}

export interface Version {
  id: string;
  at: number;
  label: string;
  /** Guardada a mano (no se descarta al llegar al límite). */
  manual: boolean;
  body: PageBody;
}

export interface Page extends PageBody {
  id: string;
  created: number;
  modified: number;
  /** 0: página; 1 y 2: subpáginas (sangría en la lista). */
  level: 0 | 1 | 2;
  versions: Version[];
  protect?: Protect;
  vault?: Vault;
}

export interface Section {
  id: string;
  name: string;
  color: string;
  /** Grupo de secciones en el que está. */
  group?: string;
  pages: Page[];
  protect?: Protect;
  vault?: Vault;
}

export interface SectionGroup {
  id: string;
  name: string;
  color: string;
  parent?: string;
}

export interface Asset {
  id: string;
  mime: string;
  /** Base64. */
  data: string;
  name: string;
  size: number;
}

/** Texto reconocido en una imagen (OCR). La clave es el identificador del activo, o `h:…` (una huella) para una imagen dentro de un texto. */
export interface OcrResult {
  text: string;
  lang: string;
  at: number;
}

export interface TrashItem {
  id: string;
  kind: 'page' | 'section';
  /** Cuándo se eliminó. */
  at: number;
  /** Sección de la que salió (para las páginas). */
  from: string;
  index: number;
  page?: Page;
  section?: Section;
}

export interface UserTemplate {
  id: string;
  name: string;
  body: PageBody;
}

export interface Notebook {
  version: 2;
  title: string;
  created: number;
  sections: Section[];
  groups: SectionGroup[];
  assets: Record<string, Asset>;
  ocr: Record<string, OcrResult>;
  trash: TrashItem[];
  templates: UserTemplate[];
  tagDefs: TagDef[];
  /** Identifica a este equipo al combinar libretas. */
  deviceId: string;
  /** Última vez que se combinó con otra copia (libretas compartidas). */
  syncedAt?: number;
  /** La libreta se comparte por una carpeta sincronizada: al guardar y de vez en cuando se combina con los cambios de los demás. */
  shared?: boolean;
}

export const SECTION_COLORS = ['#7719aa', '#0f7b0f', '#c43e1c', '#0063b1', '#b146c2', '#038387', '#ca5010', '#69797e'];
export const MAX_LEVEL = 2;
export const TRASH_DAYS = 60;

let counter = 0;
export const newId = (p: string): string => `${p}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const emptyContent = (): unknown => emptyDoc().toJSON();

export function newTextContainer(x = 48, y = 24, w = 640, content: unknown = emptyContent(), z = 1): TextContainer {
  return { kind: 'text', id: newId('c'), x, y, w, z, content };
}

export function newPage(title = ''): Page {
  const now = Date.now();
  return { id: newId('p'), title, created: now, modified: now, level: 0, containers: [newTextContainer()], ink: [], style: defaultStyle(), versions: [] };
}

export function newSection(name: string, index = 0): Section {
  return { id: newId('s'), name, color: SECTION_COLORS[index % SECTION_COLORS.length]!, pages: [newPage()] };
}

export function newNotebook(title = 'Mi libreta'): Notebook {
  return { version: 2, title, created: Date.now(), sections: [newSection('Sección nueva')], groups: [], assets: {}, ocr: {}, trash: [], templates: [], tagDefs: [], deviceId: newId('d') };
}

export function contentNode(content: unknown): PMNode {
  try {
    return writerSchema.nodeFromJSON(content);
  } catch {
    return emptyDoc();
  }
}

export const nodeText = (n: PMNode): string => n.textBetween(0, n.content.size, '\n', ' ');

/** Los cuadros de texto de una página en el orden de lectura (de arriba abajo; a igual altura, de izquierda a derecha). */
export function textContainers(page: PageBody): TextContainer[] {
  return page.containers.filter((c): c is TextContainer => c.kind === 'text').sort((a, b) => a.y - b.y || a.x - b.x);
}

export const pageText = (page: PageBody): string => textContainers(page).map((c) => nodeText(contentNode(c.content))).filter((t) => t.trim()).join('\n');

/** The title shown in the page list: the page's own title, else the first line of text, else a placeholder. */
export function displayTitle(page: Page): string {
  if (page.vault) return 'Página protegida con contraseña';
  if (page.title.trim()) return page.title.trim();
  const first = pageText(page).split('\n').find((l) => l.trim());
  return first ? first.trim().slice(0, 60) : 'Página sin título';
}

export const isLocked = (x: { vault?: Vault }): boolean => !!x.vault;

/** El cuerpo de una página (lo que se versiona y se copia en una plantilla). */
export function bodyOf(p: PageBody): PageBody {
  return { title: p.title, containers: JSON.parse(JSON.stringify(p.containers)) as Container[], ink: JSON.parse(JSON.stringify(p.ink)) as Stroke[], style: { ...p.style } };
}

/** Los activos que usa un cuerpo de página (imágenes y grabaciones). */
export function assetsUsed(b: PageBody): string[] {
  const out = new Set<string>();
  for (const c of b.containers) {
    if (c.kind === 'image' || c.kind === 'media') out.add(c.asset);
  }
  return [...out];
}

// ------------------------------------------------------------------ etiquetas

export interface TagItem {
  sectionId: string;
  pageId: string;
  page: string;
  tag: string;
  done: boolean;
  text: string;
}

/** Todos los párrafos con etiqueta (de las páginas que no están bloqueadas). Con `tag`, solo esa etiqueta. */
export function tagItems(nb: Notebook, tag?: string): TagItem[] {
  const out: TagItem[] = [];
  for (const s of nb.sections) {
    if (s.vault) continue;
    for (const p of s.pages) {
      if (p.vault) continue;
      for (const c of textContainers(p))
        contentNode(c.content).descendants((n) => {
          if (n.type.name === 'paragraph' && n.attrs.tag) {
            const raw = normalizeTag(n.attrs.tag as string)!;
            const b = baseTag(raw)!;
            if (!tag || b === tag) out.push({ sectionId: s.id, pageId: p.id, page: displayTitle(p), tag: b, done: raw.endsWith(':done'), text: n.textContent });
          }
          return true;
        });
    }
  }
  return out;
}

/** (Compatibilidad) Todas las páginas con una etiqueta. */
export function tagSummary(nb: Notebook, tag: NoteTag): { sectionId: string; pageId: string; page: string; text: string }[] {
  return tagItems(nb, tag).map(({ sectionId, pageId, page, text }) => ({ sectionId, pageId, page, text }));
}

// ------------------------------------------------------------------ archivo

const num = (v: unknown, d: number, lo: number, hi: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
  return Math.min(hi, Math.max(lo, n));
};
const str = (v: unknown, d = '', max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : d);
const color = (v: unknown, d: string): string => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
const MIMES = /^(image\/(png|jpeg|gif|bmp|webp|svg\+xml)|audio\/(webm|ogg|mpeg|mp4|wav|x-wav)|video\/(webm|mp4|ogg))(;.*)?$/;

function readStyle(v: unknown): PageStyle {
  const o = (v ?? {}) as Partial<PageStyle>;
  return { ruling: RULINGS.includes(o.ruling as Ruling) ? (o.ruling as Ruling) : 'none', color: color(o.color, '#ffffff'), margin: o.margin === true };
}

function readStroke(v: unknown): Stroke | null {
  const o = v as Partial<Stroke> | null;
  if (!o || typeof o !== 'object' || !Array.isArray(o.pts)) return null;
  const tools: StrokeTool[] = ['pen', 'highlighter', 'line', 'rect', 'ellipse', 'arrow'];
  const pts = o.pts.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).slice(0, 40000);
  const shape = o.tool === 'line' || o.tool === 'rect' || o.tool === 'ellipse' || o.tool === 'arrow';
  if (pts.length < 2 || pts.length % 2 !== 0 || (shape && pts.length !== 4)) return null;
  return { id: str(o.id, '', 60) || newId('k'), tool: tools.includes(o.tool as StrokeTool) ? (o.tool as StrokeTool) : 'pen', color: color(o.color, '#000000'), width: num(o.width, 2, 0.5, 80), opacity: num(o.opacity, 1, 0.05, 1), pts };
}

function readContainer(v: unknown, assets: Record<string, Asset>): Container | null {
  const o = v as Partial<Container> & { content?: unknown; asset?: unknown; h?: unknown; media?: unknown } | null;
  if (!o || typeof o !== 'object') return null;
  const base = { id: str(o.id, '', 60) || newId('c'), x: num(o.x, 48, -5000, 60000), y: num(o.y, 24, -5000, 60000), w: num(o.w, 640, 40, 6000), z: num(o.z, 1, 0, 100000) };
  if (o.kind === 'image' || o.kind === 'media') {
    const asset = str(o.asset, '', 80);
    if (!assets[asset]) return null;
    const h = num(o.h, 200, 20, 8000);
    if (o.kind === 'image') return { kind: 'image', ...base, h, asset, alt: str((o as ImageContainer).alt, '', 500) };
    return { kind: 'media', ...base, h, asset, media: o.media === 'video' ? 'video' : 'audio', name: str((o as MediaContainer).name, 'Grabación', 200), seconds: num((o as MediaContainer).seconds, 0, 0, 86400 * 2) };
  }
  if (o.kind !== 'text') return null;
  const content = o.content && contentNode(o.content).childCount ? o.content : emptyContent();
  return { kind: 'text', ...base, content };
}

function readBody(o: Partial<PageBody> | undefined, assets: Record<string, Asset>): PageBody {
  const containers = (Array.isArray(o?.containers) ? o!.containers : []).slice(0, 400).map((c) => readContainer(c, assets)).filter((c): c is Container => !!c);
  const ink = (Array.isArray(o?.ink) ? o!.ink : []).slice(0, 6000).map(readStroke).filter((s): s is Stroke => !!s);
  return { title: str(o?.title, '', 500), containers, ink, style: readStyle(o?.style) };
}

function readProtect(v: unknown): Protect | undefined {
  const o = v as Partial<Protect> | undefined;
  if (!o || typeof o.salt !== 'string' || !Number.isInteger(o.iter) || (o.iter as number) < 1000 || (o.iter as number) > 5_000_000) return undefined;
  return { salt: o.salt.slice(0, 100), iter: o.iter as number, hint: typeof o.hint === 'string' ? o.hint.slice(0, 200) : undefined };
}
function readVault(v: unknown): Vault | undefined {
  const o = v as Partial<Vault> | undefined;
  return o && typeof o.iv === 'string' && typeof o.data === 'string' ? { iv: o.iv, data: o.data } : undefined;
}

function readVersions(v: unknown, assets: Record<string, Asset>): Version[] {
  return (Array.isArray(v) ? v : [])
    .slice(0, 100)
    .map((x: Partial<Version>) => ({ id: str(x?.id, '', 60) || newId('v'), at: num(x?.at, Date.now(), 0, 4e12), label: str(x?.label, '', 200), manual: x?.manual === true, body: readBody(x?.body, assets) }));
}

function readPage(p: Partial<Page> & { content?: unknown }, assets: Record<string, Asset>): Page {
  const now = Date.now();
  const locked = readVault(p.vault);
  let body: PageBody;
  if (locked) body = { title: '', containers: [], ink: [], style: readStyle(p.style) };
  else if (Array.isArray(p.containers)) body = readBody(p as Partial<PageBody>, assets);
  else {
    // una libreta de la versión 1: la página era un solo documento de texto continuo
    const content = p.content && contentNode(p.content).childCount ? p.content : emptyContent();
    body = { title: str(p.title, '', 500), containers: [newTextContainer(48, 24, 700, content)], ink: [], style: defaultStyle() };
  }
  if (!locked && !body.containers.length && !body.ink.length) body.containers = [newTextContainer()];
  return {
    id: str(p.id, '', 60) || newId('p'),
    created: num(p.created, now, 0, 4e12),
    modified: num(p.modified, now, 0, 4e12),
    level: p.level === 1 || p.level === 2 ? p.level : 0,
    versions: locked ? [] : readVersions(p.versions, assets),
    protect: readProtect(p.protect),
    vault: locked,
    ...body,
  };
}

function readSection(s: Partial<Section>, i: number, assets: Record<string, Asset>): Section {
  const vault = readVault(s.vault);
  const pages = vault ? [] : (Array.isArray(s.pages) ? s.pages : []).slice(0, 5000).map((p) => readPage(p, assets));
  if (!vault && !pages.length) pages.push(newPage());
  return {
    id: str(s.id, '', 60) || newId('s'),
    name: str(s.name, '', 200) || `Sección ${i + 1}`,
    color: color(s.color, SECTION_COLORS[i % SECTION_COLORS.length]!),
    group: typeof s.group === 'string' && s.group ? s.group.slice(0, 60) : undefined,
    pages,
    protect: readProtect(s.protect),
    vault,
  };
}

function readAssets(v: unknown): Record<string, Asset> {
  const out: Record<string, Asset> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [id, a] of Object.entries(v as Record<string, Partial<Asset>>)) {
    if (!a || typeof a.data !== 'string' || typeof a.mime !== 'string' || !MIMES.test(a.mime)) continue;
    out[id.slice(0, 80)] = { id: id.slice(0, 80), mime: a.mime, data: a.data, name: str(a.name, '', 300), size: num(a.size, 0, 0, 2e9) };
  }
  return out;
}

function readOcr(v: unknown): Record<string, OcrResult> {
  const out: Record<string, OcrResult> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, r] of Object.entries(v as Record<string, Partial<OcrResult>>)) if (r && typeof r.text === 'string') out[k.slice(0, 100)] = { text: r.text.slice(0, 200000), lang: str(r.lang, '', 40), at: num(r.at, 0, 0, 4e12) };
  return out;
}

function readTagDefs(v: unknown): TagDef[] {
  return (Array.isArray(v) ? v : [])
    .slice(0, 100)
    .filter((t: Partial<TagDef>) => t && typeof t.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(t.id) && typeof t.label === 'string')
    .map((t: TagDef) => ({ id: t.id, label: t.label.slice(0, 60), symbol: Array.from(str(t.symbol, '●', 8)).slice(0, 2).join('') || '●', color: color(t.color, '#0f6cbd'), checkbox: t.checkbox === true, custom: true }));
}

/** Read a notebook file (any version), checking its structure so that a damaged or foreign file fails with a clear message. */
export function parseNotebook(text: string): Notebook {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es una libreta de Nova Notes (no es JSON válido).');
  }
  const o = raw as (Omit<Partial<Notebook>, 'version'> & { version?: number }) | null;
  if (!o || typeof o !== 'object' || (o.version !== 1 && o.version !== 2) || !Array.isArray(o.sections)) throw new Error('El archivo no es una libreta de Nova Notes (formato desconocido).');
  const assets = readAssets(o.assets);
  const sections = o.sections.slice(0, 500).map((s, i) => readSection(s, i, assets));
  if (!sections.length) sections.push(newSection('Sección nueva'));
  const groups = (Array.isArray(o.groups) ? o.groups : [])
    .slice(0, 200)
    .filter((g: Partial<SectionGroup>) => g && typeof g.id === 'string')
    .map((g: SectionGroup, i: number): SectionGroup => ({ id: g.id.slice(0, 60), name: str(g.name, '', 200) || `Grupo ${i + 1}`, color: color(g.color, SECTION_COLORS[i % SECTION_COLORS.length]!), parent: typeof g.parent === 'string' && g.parent !== g.id ? g.parent : undefined }));
  const gids = new Set(groups.map((g) => g.id));
  for (const g of groups) if (g.parent && !gids.has(g.parent)) delete g.parent;
  // un ciclo de grupos deja el grupo en el nivel superior
  for (const g of groups) {
    const seen = new Set([g.id]);
    for (let p = g.parent; p; p = groups.find((x) => x.id === p)?.parent) {
      if (seen.has(p)) {
        delete g.parent;
        break;
      }
      seen.add(p);
    }
  }
  for (const s of sections) if (s.group && !gids.has(s.group)) delete s.group;
  const trash: TrashItem[] = (Array.isArray(o.trash) ? o.trash : [])
    .slice(0, 2000)
    .map((t: Partial<TrashItem>) => {
      const kind = t?.kind === 'section' ? 'section' : t?.kind === 'page' ? 'page' : null;
      if (!kind) return null;
      const item: TrashItem = { id: str(t.id, '', 60) || newId('t'), kind, at: num(t.at, Date.now(), 0, 4e12), from: str(t.from, '', 60), index: num(t.index, 0, 0, 100000) };
      if (kind === 'page' && t.page) item.page = readPage(t.page, assets);
      else if (kind === 'section' && t.section) item.section = readSection(t.section, 0, assets);
      else return null;
      return item;
    })
    .filter((t): t is TrashItem => !!t);
  const templates: UserTemplate[] = (Array.isArray(o.templates) ? o.templates : [])
    .slice(0, 200)
    .filter((t: Partial<UserTemplate>) => t && typeof t.id === 'string')
    .map((t: UserTemplate) => ({ id: t.id.slice(0, 60), name: str(t.name, 'Plantilla', 200), body: readBody(t.body, assets) }));
  return {
    version: 2,
    title: str(o.title, 'Mi libreta', 300),
    created: num(o.created, Date.now(), 0, 4e12),
    sections,
    groups,
    assets,
    ocr: readOcr(o.ocr),
    trash,
    templates,
    tagDefs: readTagDefs(o.tagDefs),
    deviceId: str(o.deviceId, '', 60) || newId('d'),
    syncedAt: typeof o.syncedAt === 'number' ? o.syncedAt : undefined,
    shared: o.shared === true,
  };
}
