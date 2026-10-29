import {
  SECTION_COLORS,
  TEMPLATES,
  WrongPassword,
  addContainer,
  addGroup as coreAddGroup,
  assetsUsed,
  baseTag,
  bodyOf,
  contentNode,
  deriveKey,
  displayTitle,
  eraseAt,
  expireTrash,
  findTag,
  freeSpot,
  freshBody,
  imageKey,
  isDone,
  isLocked,
  lockPage as coreLockPage,
  lockSection as coreLockSection,
  pageMediaKeys,
  pickMedia,
  publicMediaKeys,
  type Media,
  mergeNotebooks,
  moveContainers,
  movePageGroup,
  moveSectionToGroup,
  moveStrokes,
  newCustomTag,
  newImageContainer,
  newMediaContainer,
  newNotebook,
  newPage,
  newProtection,
  newSection,
  newStroke,
  normalizeTag,
  pageRows,
  pageText,
  pendingOcr,
  purgeTrash,
  recordVersion,
  removeContainers,
  renameGroup as coreRenameGroup,
  reorder,
  resizeContainer,
  restoreTrash,
  restoreVersion,
  searchNotebook,
  serializeNotebook,
  setPageLevel,
  snap,
  textAt,
  trashPage,
  trashSection,
  ungroup as coreUngroup,
  unlockPageFull as coreUnlockPage,
  unlockSectionFull as coreUnlockSection,
  updateContainer,
  versionDue,
  defaultStyle,
  type Asset,
  type Container,
  type MergeResult,
  type NoteTag,
  type Notebook,
  type Page,
  type PageBody,
  type PageStyle,
  type SearchHit,
  type Section,
  type SectionGroup,
  type Stroke,
  type StrokeTool,
  type TagDef,
  type ZMove,
} from '@suitenova/notes-core';
import type { Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';

export { SECTION_COLORS, displayTitle, pageText };

export type Tool = 'select' | 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'line' | 'arrow' | 'rect' | 'ellipse';
export const INK_TOOLS: Tool[] = ['pen', 'highlighter', 'eraser', 'lasso', 'line', 'arrow', 'rect', 'ellipse'];

/** El cuerpo de la página que se guarda para deshacer lo que no es texto (mover, borrar, tinta…). */
type Undo = PageBody;
const MAX_UNDO = 60;

export interface OcrState {
  running: boolean;
  done: number;
  total: number;
  error: string;
}

export class NotesCtl {
  nb: Notebook = newNotebook();
  sectionId = this.nb.sections[0]!.id;
  pageId = this.nb.sections[0]!.pages[0]!.id;
  /** El grupo de secciones que se está viendo (null: el nivel superior). */
  groupId: string | null = null;
  fileName: string | null = null;
  filePath: string | null = null;
  dirty = false;
  query = '';
  results: SearchHit[] = [];
  showResults = false;
  /** Mensaje corto para la barra de estado. */
  message = '';

  // ---- lienzo
  views = new Map<string, EditorView>();
  activeId: string | null = null;
  selected: string | null = null;
  /** Sube cada vez que la página se reemplaza entera (deshacer, restaurar, plantilla…): los cuadros de texto se vuelven a crear. */
  pageEpoch = 0;
  /** Alto medido de los cuadros de texto (no se guarda). */
  heights: Record<string, number> = {};

  // ---- tinta
  tool: Tool = 'select';
  penColor = '#000000';
  penWidth = 3;
  highlightColor = '#ffe34d';
  /** Con esto, un trazo a mano alzada que parece una recta, un rectángulo o una elipse se convierte en esa forma. */
  inkToShape = false;
  selectedStrokes: string[] = [];

  // ---- protección
  keys = new Map<string, CryptoKey>();
  /** Páginas plegadas en la lista (sus subpáginas no se ven). */
  collapsed = new Set<string>();

  ocr: OcrState = { running: false, done: 0, total: 0, error: '' };

  /** Un cuadro de texto recién creado que debe recibir el foco al dibujarse. */
  focusRequest: string | null = null;
  private version = 0;
  private listeners = new Set<() => void>();
  private handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  private undoStack: Undo[] = [];
  private redoStack: Undo[] = [];
  private urls = new Map<string, string>();
  private ocrRun = 0;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = (): number => this.version;
  touch(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }
  on(name: string, fn: (...a: never[]) => void): () => void {
    const set = this.handlers.get(name) ?? new Set();
    set.add(fn as (...a: unknown[]) => void);
    this.handlers.set(name, set);
    return () => set.delete(fn as (...a: unknown[]) => void);
  }
  emit(name: string, ...args: unknown[]): void {
    this.handlers.get(name)?.forEach((f) => f(...args));
  }
  say(msg: string): void {
    this.message = msg;
    this.touch();
  }

  // ------------------------------------------------------------------ acceso

  get section(): Section {
    return this.nb.sections.find((s) => s.id === this.sectionId) ?? this.nb.sections[0]!;
  }
  get page(): Page {
    return this.section.pages.find((p) => p.id === this.pageId) ?? this.section.pages[0]!;
  }
  get docTitle(): string {
    return (this.fileName ?? this.nb.title) + (this.dirty ? ' •' : '');
  }
  get view(): EditorView | null {
    return this.activeId ? (this.views.get(this.activeId) ?? null) : null;
  }
  /** ¿La sección o la página que se ve está bloqueada? */
  get locked(): boolean {
    return isLocked(this.section) || isLocked(this.page);
  }
  get tagDefs(): TagDef[] {
    return this.nb.tagDefs;
  }

  private mark(): void {
    this.dirty = true;
  }

  private setNb(nb: Notebook): void {
    this.nb = nb;
    this.mark();
  }

  /** Cambia la página actual. `undo`: guardar el estado anterior para deshacer. `bump`: volver a crear los cuadros de texto. */
  private editPage(fn: (p: Page) => Page, o: { undo?: boolean; bump?: boolean } = {}): void {
    const cur = this.page;
    if (o.undo) this.pushUndo(cur);
    const next = fn(cur);
    if (next === cur) return;
    this.setNb({ ...this.nb, sections: this.nb.sections.map((s) => (s.id === this.sectionId ? { ...s, pages: s.pages.map((p) => (p.id === cur.id ? { ...next, modified: Date.now() } : p)) } : s)) });
    if (o.bump) this.pageEpoch++;
    this.touch();
  }

  private pushUndo(p: Page): void {
    this.undoStack.push(bodyOf(p));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  // ------------------------------------------------------------------ deshacer lo que no es texto

  get canUndoPage(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedoPage(): boolean {
    return this.redoStack.length > 0;
  }
  undoPage(): void {
    const b = this.undoStack.pop();
    if (!b) return;
    this.redoStack.push(bodyOf(this.page));
    this.editPage((p) => ({ ...p, ...b }), { bump: true });
    this.selected = null;
    this.selectedStrokes = [];
  }
  redoPage(): void {
    const b = this.redoStack.pop();
    if (!b) return;
    this.undoStack.push(bodyOf(this.page));
    this.editPage((p) => ({ ...p, ...b }), { bump: true });
  }
  private resetUndo(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  // ------------------------------------------------------------------ editores de los cuadros de texto

  attachView(id: string, view: EditorView): void {
    this.views.set(id, view);
    if (!this.activeId) this.activeId = id;
  }
  detachView(id: string): void {
    this.views.delete(id);
    if (this.activeId === id) this.activeId = null;
  }
  focusView(id: string): void {
    if (this.activeId === id && this.selected === id) return;
    this.activeId = id;
    this.selected = id;
    this.touch();
  }
  /** Lo que escribe una persona en un cuadro de texto se guarda en la página. */
  updateText(id: string, doc: PMNode): void {
    this.editPage((p) => ({ ...p, containers: p.containers.map((c) => (c.id === id && c.kind === 'text' ? { ...c, content: doc.toJSON() } : c)) }));
  }
  setHeight(id: string, h: number): void {
    if (Math.abs((this.heights[id] ?? 0) - h) < 1) return;
    this.heights[id] = h;
    this.touch();
  }

  // ------------------------------------------------------------------ navegación

  private resetView(): void {
    this.views.clear();
    this.activeId = null;
    this.selected = null;
    this.selectedStrokes = [];
    this.heights = {};
    this.resetUndo();
    this.pageEpoch++;
  }

  goTo(sectionId: string, pageId?: string): void {
    const s = this.nb.sections.find((x) => x.id === sectionId);
    if (!s) return;
    this.sectionId = s.id;
    this.groupId = s.group ?? null;
    const target = pageId && s.pages.some((p) => p.id === pageId) ? pageId : (s.pages[0]?.id ?? '');
    this.pageId = target;
    this.resetView();
    this.touch();
  }
  goToPage(pageId: string): void {
    if (pageId === this.pageId) return;
    this.goTo(this.sectionId, pageId);
  }
  /** Va a una página de cualquier sección por su identificador (vínculos entre páginas). */
  goToAnyPage(pageId: string): boolean {
    for (const s of this.nb.sections) if (s.pages.some((p) => p.id === pageId)) return (this.goTo(s.id, pageId), true);
    return false;
  }
  findPage(pageId: string): { section: Section; page: Page } | null {
    for (const s of this.nb.sections) {
      const page = s.pages.find((p) => p.id === pageId);
      if (page) return { section: s, page };
    }
    return null;
  }
  setGroup(id: string | null): void {
    this.groupId = id;
    this.touch();
  }
  toggleCollapsed(pageId: string): void {
    if (this.collapsed.has(pageId)) this.collapsed.delete(pageId);
    else this.collapsed.add(pageId);
    this.touch();
  }
  pageRows() {
    return pageRows(this.section, this.collapsed);
  }

  // ------------------------------------------------------------------ cuadros del lienzo

  select(id: string | null): void {
    if (this.selected === id) return;
    this.selected = id;
    this.touch();
  }

  /** Un cuadro de texto nuevo en un punto de la página. */
  addTextAt(x: number, y: number, w = 320): string {
    const c = textAt(x, y, w);
    this.editPage((p) => addContainer(p, c), { undo: true });
    this.activeId = c.id;
    this.selected = c.id;
    this.focusRequest = c.id;
    this.touch();
    return c.id;
  }
  /** Un cuadro de texto nuevo en el primer hueco libre de la página. */
  addTextBoxFree(): string {
    const s = freeSpot(this.page, this.heights);
    return this.addTextAt(s.x, s.y);
  }
  /** Un cuadro de texto que se deja vacío (sin texto, tablas ni imágenes) desaparece, siempre que quede algo más en la página. */
  dropIfEmpty(id: string): void {
    const p = this.page;
    const c = p.containers.find((x) => x.id === id);
    if (!c || c.kind !== 'text' || p.containers.length + (p.ink.length ? 1 : 0) < 2) return;
    const doc = contentNode(c.content);
    let only = doc.childCount === 1 && doc.firstChild!.type.name === 'paragraph' && doc.firstChild!.content.size === 0;
    if (!only) return;
    if (this.view && this.activeId === id && this.view.hasFocus()) only = false;
    if (!only) return;
    this.views.delete(id);
    if (this.activeId === id) this.activeId = null;
    this.editPage((q) => removeContainers(q, [id]));
    if (this.selected === id) this.selected = null;
    this.touch();
  }

  /** Al empezar a arrastrar o redimensionar: un solo paso de deshacer para todo el gesto. */
  beginGesture(): void {
    this.pushUndo(this.page);
  }
  liveMove(ids: string[], dx: number, dy: number, snapGrid = false): void {
    this.editPage((p) => {
      const q = moveContainers(p, ids, dx, dy);
      return snapGrid ? { ...q, containers: q.containers.map((c) => (ids.includes(c.id) ? { ...c, x: snap(c.x), y: snap(c.y) } : c)) } : q;
    });
  }
  liveSetPos(id: string, x: number, y: number): void {
    this.editPage((p) => updateContainer(p, id, { x: Math.max(-2000, Math.round(x)), y: Math.max(-2000, Math.round(y)) }));
  }
  liveResize(id: string, w: number, h?: number): void {
    this.editPage((p) => resizeContainer(p, id, w, h, true));
  }
  deleteContainer(id: string): void {
    const c = this.page.containers.find((x) => x.id === id);
    if (!c) return;
    this.views.delete(id);
    if (this.activeId === id) this.activeId = null;
    this.editPage((p) => removeContainers(p, [id]), { undo: true });
    if (this.selected === id) this.selected = null;
    this.touch();
  }
  reorderContainer(id: string, how: ZMove): void {
    this.editPage((p) => reorder(p, id, how), { undo: true });
  }
  get selectedContainer(): Container | null {
    return this.page.containers.find((c) => c.id === this.selected) ?? null;
  }
  setAlt(id: string, alt: string): void {
    this.editPage((p) => updateContainer(p, id, { alt } as Partial<Container>), { undo: true });
  }

  // ------------------------------------------------------------------ imágenes y grabaciones (activos)

  addAsset(a: { mime: string; data: string; name: string; size: number }): Asset {
    const asset: Asset = { id: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, ...a };
    this.setNb({ ...this.nb, assets: { ...this.nb.assets, [asset.id]: asset } });
    return asset;
  }
  /** Una dirección con la que mostrar el activo (se crea una vez y se reutiliza). */
  assetUrl(id: string): string {
    let u = this.urls.get(id);
    if (u) return u;
    const a = this.nb.assets[id];
    if (!a) return '';
    const bin = atob(a.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    u = URL.createObjectURL(new Blob([bytes], { type: a.mime.split(';')[0] }));
    this.urls.set(id, u);
    return u;
  }
  dataUrl(id: string): string {
    const a = this.nb.assets[id];
    return a ? `data:${a.mime};base64,${a.data}` : '';
  }
  addImage(asset: Asset, w: number, h: number, at?: { x: number; y: number }): void {
    const spot = at ?? freeSpot(this.page, this.heights);
    const k = Math.min(1, 560 / Math.max(1, w));
    const c = newImageContainer(asset.id, Math.round(w * k), Math.round(h * k), asset.name.replace(/\.[^.]+$/, ''), snap(spot.x), snap(spot.y));
    this.editPage((p) => addContainer(p, c), { undo: true });
    this.selected = c.id;
    this.touch();
  }
  addMedia(asset: Asset, media: 'audio' | 'video', name: string, seconds: number): void {
    const spot = freeSpot(this.page, this.heights);
    const c = newMediaContainer(asset.id, media, name, seconds, snap(spot.x), snap(spot.y));
    this.editPage((p) => addContainer(p, c), { undo: true });
    this.selected = c.id;
    this.touch();
  }
  /** Quita los activos que ya no usa ninguna página, versión, plantilla ni elemento de la papelera. */
  pruneAssets(): number {
    const used = new Set<string>();
    const body = (b: PageBody) => assetsUsed(b).forEach((a) => used.add(a));
    const page = (p: Page) => {
      body(p);
      p.versions.forEach((v) => body(v.body));
    };
    // lo bloqueado lleva sus propias imágenes y grabaciones dentro del cifrado: aquí solo cuenta lo que está abierto
    for (const s of this.nb.sections) if (!s.vault) s.pages.forEach((p) => !p.vault && page(p));
    for (const t of this.nb.trash) {
      if (t.page && !t.page.vault) page(t.page);
      if (t.section && !t.section.vault) t.section.pages.forEach((p) => !p.vault && page(p));
    }
    this.nb.templates.forEach((t) => body(t.body));
    const ids = Object.keys(this.nb.assets).filter((id) => !used.has(id));
    if (!ids.length) return 0;
    const assets = { ...this.nb.assets };
    const ocr = { ...this.nb.ocr };
    for (const id of ids) {
      delete assets[id];
      delete ocr[id];
      const u = this.urls.get(id);
      if (u) URL.revokeObjectURL(u);
      this.urls.delete(id);
    }
    this.setNb({ ...this.nb, assets, ocr });
    return ids.length;
  }

  // ------------------------------------------------------------------ tinta

  setTool(t: Tool): void {
    this.tool = t;
    if (t !== 'lasso') this.selectedStrokes = [];
    if (t !== 'select') this.selected = null;
    this.touch();
  }
  get strokeStyle(): { color: string; width: number; tool: StrokeTool } {
    return { tool: this.tool === 'highlighter' ? 'highlighter' : (this.tool as StrokeTool), color: this.tool === 'highlighter' ? this.highlightColor : this.penColor, width: this.tool === 'highlighter' ? 18 : this.penWidth };
  }
  addStroke(s: Stroke): void {
    this.editPage((p) => ({ ...p, ink: [...p.ink, s] }), { undo: true });
  }
  newStrokeFrom(pts: number[]): Stroke {
    const st = this.strokeStyle;
    return newStroke(st.tool === 'highlighter' ? 'highlighter' : st.tool, st.color, st.width, pts);
  }
  eraseStrokes(x: number, y: number, r: number): void {
    const ink = eraseAt(this.page.ink, x, y, r);
    if (ink !== this.page.ink) this.editPage((p) => ({ ...p, ink }));
  }
  /** Antes de borrar con la goma o de mover trazos: un paso de deshacer. */
  beginInkGesture(): void {
    this.pushUndo(this.page);
  }
  selectStrokes(ids: string[]): void {
    this.selectedStrokes = ids;
    this.touch();
  }
  moveSelectedStrokes(dx: number, dy: number): void {
    if (!this.selectedStrokes.length) return;
    this.editPage((p) => ({ ...p, ink: moveStrokes(p.ink, this.selectedStrokes, dx, dy) }));
  }
  deleteSelectedStrokes(): void {
    if (!this.selectedStrokes.length) return;
    const ids = this.selectedStrokes;
    this.selectedStrokes = [];
    this.editPage((p) => ({ ...p, ink: p.ink.filter((s) => !ids.includes(s.id)) }), { undo: true });
  }
  clearInk(): void {
    if (!this.page.ink.length) return;
    this.editPage((p) => ({ ...p, ink: [] }), { undo: true });
  }

  // ------------------------------------------------------------------ páginas

  setTitle(title: string): void {
    this.editPage((p) => ({ ...p, title }));
  }
  setStyle(patch: Partial<PageStyle>): void {
    this.editPage((p) => ({ ...p, style: { ...p.style, ...patch } }), { undo: true });
  }

  private insertPage(page: Page, afterId?: string | null): void {
    this.setNb({
      ...this.nb,
      sections: this.nb.sections.map((s) => {
        if (s.id !== this.sectionId) return s;
        const pages = [...s.pages];
        const i = afterId ? pages.findIndex((p) => p.id === afterId) : -1;
        // una página nueva va después de la actual y de sus subpáginas
        let end = i + 1;
        if (i >= 0) while (end < pages.length && pages[end]!.level > pages[i]!.level) end++;
        pages.splice(i >= 0 ? end : pages.length, 0, page);
        return { ...s, pages };
      }),
    });
    this.pageId = page.id;
    this.resetView();
    this.touch();
  }

  addPage(templateId = 'blank'): void {
    const t = TEMPLATES.find((x) => x.id === templateId);
    const page = newPage();
    if (t) {
      const b = freshBody(t.build(new Date()));
      page.title = b.title;
      page.containers = b.containers;
      page.ink = b.ink;
      page.style = b.style;
    }
    this.insertPage(page, this.pageId);
  }
  addPageFromUserTemplate(id: string): void {
    const t = this.nb.templates.find((x) => x.id === id);
    if (!t) return;
    const b = freshBody(t.body);
    this.insertPage({ ...newPage(), title: b.title, containers: b.containers, ink: b.ink, style: b.style }, this.pageId);
  }
  /** Aplica una plantilla a la página actual (sustituye su contenido; se puede deshacer). */
  applyTemplate(templateId: string): void {
    const t = TEMPLATES.find((x) => x.id === templateId);
    if (!t) return;
    const b = freshBody(t.build(new Date()));
    this.editPage((p) => ({ ...p, title: p.title || b.title, containers: b.containers, ink: b.ink, style: b.style }), { undo: true, bump: true });
    this.activeId = null;
    this.selected = null;
  }
  saveAsTemplate(name: string): void {
    const p = this.page;
    const n = name.trim() || displayTitle(p);
    this.setNb({ ...this.nb, templates: [...this.nb.templates, { id: `u${Date.now().toString(36)}`, name: n.slice(0, 120), body: bodyOf(p) }] });
    this.touch();
  }
  deleteTemplate(id: string): void {
    this.setNb({ ...this.nb, templates: this.nb.templates.filter((t) => t.id !== id) });
    this.touch();
  }
  addPageWith(page: Page): void {
    this.insertPage(page, this.pageId);
  }
  duplicatePage(): void {
    const src = this.page;
    const copy: Page = { ...JSON.parse(JSON.stringify(src)), id: newPage().id, title: src.title ? `${src.title} (copia)` : '', created: Date.now(), modified: Date.now(), versions: [] };
    copy.containers = copy.containers.map((c: Container) => ({ ...c, id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }));
    delete (copy as { protect?: unknown }).protect;
    delete (copy as { vault?: unknown }).vault;
    this.insertPage(copy, src.id);
  }
  deletePage(): void {
    const rows = this.section.pages;
    const i = rows.findIndex((p) => p.id === this.pageId);
    if (this.page.protect) this.keys.delete(this.page.id);
    this.setNb(trashPage(this.nb, this.sectionId, this.pageId));
    const next = this.section.pages;
    this.pageId = next[Math.min(i, next.length - 1)]!.id;
    this.resetView();
    this.touch();
  }
  movePage(delta: -1 | 1): void {
    this.setNb(movePageGroup(this.nb, this.sectionId, this.pageId, delta));
    this.touch();
  }
  indentPage(delta: 1 | -1): void {
    this.setNb(setPageLevel(this.nb, this.sectionId, this.pageId, delta));
    this.touch();
  }
  canIndent(delta: 1 | -1): boolean {
    return setPageLevel(this.nb, this.sectionId, this.pageId, delta) !== this.nb;
  }
  canMovePage(delta: -1 | 1): boolean {
    return movePageGroup(this.nb, this.sectionId, this.pageId, delta) !== this.nb;
  }

  // ------------------------------------------------------------------ versiones

  saveVersion(label: string): void {
    const p = recordVersion(this.page, label.trim() || 'Versión guardada', true);
    if (p === this.page) return this.say('No hay cambios desde la última versión.');
    this.editPage(() => p);
    this.say('Versión guardada.');
  }
  restore(versionId: string): void {
    this.editPage((p) => restoreVersion(p, versionId), { bump: true });
    this.activeId = null;
    this.selected = null;
    this.resetUndo();
    this.say('Versión restaurada. Lo que había antes quedó guardado como una versión más.');
  }
  deleteVersion(id: string): void {
    this.editPage((p) => ({ ...p, versions: p.versions.filter((v) => v.id !== id) }));
  }
  /** Guarda una versión automática de la página actual si toca (se llama al guardar el archivo). */
  autoVersion(): void {
    const p = this.page;
    if (versionDue(p)) this.editPage(() => recordVersion(p, '', false));
  }

  // ------------------------------------------------------------------ secciones y grupos

  addSection(): void {
    const s = newSection(`Sección ${this.nb.sections.length + 1}`, this.nb.sections.length);
    if (this.groupId) s.group = this.groupId;
    this.setNb({ ...this.nb, sections: [...this.nb.sections, s] });
    this.goTo(s.id);
  }
  renameSection(id: string, name: string): void {
    const n = name.trim();
    if (!n) return;
    this.setNb({ ...this.nb, sections: this.nb.sections.map((s) => (s.id === id ? { ...s, name: n } : s)) });
    this.touch();
  }
  setSectionColor(id: string, color: string): void {
    this.setNb({ ...this.nb, sections: this.nb.sections.map((s) => (s.id === id ? { ...s, color } : s)) });
    this.touch();
  }
  deleteSection(): void {
    if (this.nb.sections.length <= 1) return;
    const i = this.nb.sections.findIndex((s) => s.id === this.sectionId);
    this.setNb(trashSection(this.nb, this.sectionId));
    const rest = this.nb.sections;
    this.goTo(rest[Math.min(i, rest.length - 1)]!.id);
  }
  moveSection(delta: number): void {
    const secs = [...this.nb.sections];
    const i = secs.findIndex((s) => s.id === this.sectionId);
    const j = i + delta;
    if (j < 0 || j >= secs.length) return;
    [secs[i], secs[j]] = [secs[j]!, secs[i]!];
    this.setNb({ ...this.nb, sections: secs });
    this.touch();
  }
  addGroup(name = 'Grupo de secciones'): SectionGroup {
    const r = coreAddGroup(this.nb, name, this.groupId);
    this.setNb(r.nb);
    this.touch();
    return r.group;
  }
  renameGroup(id: string, name: string): void {
    this.setNb(coreRenameGroup(this.nb, id, name));
    this.touch();
  }
  moveSectionToGroup(groupId: string | null): void {
    this.setNb(moveSectionToGroup(this.nb, this.sectionId, groupId));
    this.groupId = groupId;
    this.touch();
  }
  ungroup(id: string): void {
    const g = this.nb.groups.find((x) => x.id === id);
    this.setNb(coreUngroup(this.nb, id));
    if (this.groupId === id) this.groupId = g?.parent ?? null;
    this.touch();
  }

  // ------------------------------------------------------------------ papelera

  restoreFromTrash(id: string): void {
    const r = restoreTrash(this.nb, id);
    if (!r) return;
    this.setNb(r.nb);
    this.goTo(r.sectionId, r.pageId);
  }
  purgeTrash(id?: string): void {
    this.setNb(purgeTrash(this.nb, id));
    this.touch();
  }

  // ------------------------------------------------------------------ etiquetas

  /**
   * Marca los párrafos seleccionados. Aplicar la etiqueta que ya tienen la quita. Con las etiquetas con casilla, aplicarla de nuevo a
   * un párrafo ya marcado la quita (y la casilla se marca con un clic en ella).
   */
  setTag(tag: NoteTag | null): void {
    const v = this.view;
    if (!v) return;
    const { from, to } = v.state.selection;
    const tr = v.state.tr;
    const targets: { n: PMNode; pos: number }[] = [];
    v.state.doc.nodesBetween(from, to, (n, pos) => {
      if (n.type.name === 'paragraph') targets.push({ n, pos });
      return n.type.name !== 'paragraph';
    });
    const allHave = tag !== null && targets.length > 0 && targets.every((t) => baseTag(normalizeTag(t.n.attrs.tag as string)) === tag);
    for (const { n, pos } of targets) tr.setNodeMarkup(pos, undefined, { ...n.attrs, tag: allHave ? null : tag });
    v.dispatch(tr);
    v.focus();
  }
  currentTag(): string | null {
    const v = this.view;
    if (!v) return null;
    const { $from } = v.state.selection;
    for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'paragraph') return baseTag(normalizeTag($from.node(d).attrs.tag as string | null));
    return null;
  }
  addCustomTag(label: string, symbol: string, color: string, checkbox: boolean): TagDef {
    const t = newCustomTag(label, symbol, color, checkbox);
    this.setNb({ ...this.nb, tagDefs: [...this.nb.tagDefs, t] });
    this.touch();
    return t;
  }
  removeCustomTag(id: string): void {
    this.setNb({ ...this.nb, tagDefs: this.nb.tagDefs.filter((t) => t.id !== id) });
    this.touch();
  }
  isCheckbox(tag: string | null | undefined): boolean {
    return !!findTag(tag, this.nb.tagDefs)?.checkbox;
  }

  // ------------------------------------------------------------------ OCR (texto dentro de las imágenes)

  /** Cuántas imágenes faltan por reconocer. */
  get ocrPending(): number {
    return pendingOcr(this.nb).length;
  }
  /** Reconoce el texto de las imágenes que faltan, de una en una. `engine` devuelve el texto de una imagen (`data:`). */
  async runOcr(engine: (src: string, lang: string) => Promise<string>, lang: string): Promise<void> {
    if (this.ocr.running) return;
    const targets = pendingOcr(this.nb);
    if (!targets.length) return;
    const run = ++this.ocrRun;
    this.ocr = { running: true, done: 0, total: targets.length, error: '' };
    this.touch();
    for (const t of targets) {
      if (run !== this.ocrRun) return;
      try {
        const text = (await engine(t.src, lang)).trim();
        this.nb = { ...this.nb, ocr: { ...this.nb.ocr, [t.key]: { text, lang, at: Date.now() } } };
        this.mark();
      } catch (e) {
        this.ocr = { ...this.ocr, error: (e as Error).message };
        // una imagen que falla se marca como sin texto para no insistir
        this.nb = { ...this.nb, ocr: { ...this.nb.ocr, [t.key]: { text: '', lang, at: Date.now() } } };
      }
      this.ocr = { ...this.ocr, done: this.ocr.done + 1 };
      this.touch();
    }
    this.ocr = { ...this.ocr, running: false };
    this.touch();
  }
  stopOcr(): void {
    this.ocrRun++;
    this.ocr = { ...this.ocr, running: false };
    this.touch();
  }
  ocrTextOf(c: Container): string {
    return c.kind === 'image' ? (this.nb.ocr[c.asset]?.text ?? '') : '';
  }
  inlineOcr(src: string): string {
    return this.nb.ocr[imageKey(src)]?.text ?? '';
  }
  /** Fuerza que se vuelva a reconocer una imagen (por ejemplo con otro idioma). */
  forgetOcr(key: string): void {
    const ocr = { ...this.nb.ocr };
    delete ocr[key];
    this.setNb({ ...this.nb, ocr });
    this.touch();
  }

  // ------------------------------------------------------------------ contraseñas

  /** Pone contraseña a la página actual (queda abierta hasta que se bloquee). */
  async protectPage(password: string, hint: string): Promise<void> {
    const { protect, key } = await newProtection(password, hint);
    this.keys.set(this.page.id, key);
    this.editPage((p) => ({ ...p, protect }));
    this.say('La página tiene contraseña. Bloquéala para ocultar su contenido.');
  }
  async protectSection(password: string, hint: string): Promise<void> {
    const { protect, key } = await newProtection(password, hint);
    this.keys.set(this.section.id, key);
    this.setNb({ ...this.nb, sections: this.nb.sections.map((s) => (s.id === this.sectionId ? { ...s, protect } : s)) });
    this.say('La sección tiene contraseña. Bloquéala para ocultar su contenido.');
  }
  /** Oculta el contenido de la página o sección actual (el archivo se guarda cifrado). */
  async lockCurrent(what: 'page' | 'section'): Promise<void> {
    const wasDirty = this.dirty; // bloquear o desbloquear no cambia lo que hay en el archivo
    try {
      await this.lockCurrentInner(what);
    } finally {
      this.dirty = wasDirty;
    }
  }
  private async lockCurrentInner(what: 'page' | 'section'): Promise<void> {
    if (what === 'page') {
      const p = this.page;
      const key = this.keys.get(p.id);
      if (!p.protect || !key || p.vault) return;
      const { media, drop } = this.mediaToLock(pageMediaKeys(p));
      const locked = await coreLockPage(p, key, media);
      this.replacePage(locked);
      this.dropMedia(drop);
    } else {
      const s = this.section;
      const key = this.keys.get(s.id);
      if (!s.protect || !key || s.vault) return;
      const { media, drop } = this.mediaToLock(s.pages.flatMap(pageMediaKeys));
      const locked = await coreLockSection(s, key, media);
      this.setNb({ ...this.nb, sections: this.nb.sections.map((x) => (x.id === s.id ? locked : x)) });
      this.dropMedia(drop);
      this.pageId = '';
    }
    this.keys.delete(what === 'page' ? this.page.id : this.section.id);
    this.resetView();
    this.say(what === 'page' ? 'Página bloqueada.' : 'Sección bloqueada.');
  }
  /** Bloquea de nuevo lo que sigue abierto (antes de cerrar o a petición). */
  async lockAll(): Promise<void> {
    const wasDirty = this.dirty;
    try {
      await this.lockAllInner();
    } finally {
      this.dirty = wasDirty;
      this.touch();
    }
  }
  private async lockAllInner(): Promise<void> {
    for (const s of [...this.nb.sections]) {
      if (s.protect && !s.vault) {
        const key = this.keys.get(s.id);
        if (!key) continue;
        const { media, drop } = this.mediaToLock(s.pages.flatMap(pageMediaKeys));
        const locked = await coreLockSection(s, key, media);
        this.setNb({ ...this.nb, sections: this.nb.sections.map((x) => (x.id === s.id ? locked : x)) });
        this.dropMedia(drop);
        this.keys.delete(s.id);
      } else if (!s.vault)
        for (const p of s.pages)
          if (p.protect && !p.vault && this.keys.has(p.id)) {
            const { media, drop } = this.mediaToLock(pageMediaKeys(p));
            const locked = await coreLockPage(p, this.keys.get(p.id)!, media);
            this.setNb({ ...this.nb, sections: this.nb.sections.map((x) => (x.id === s.id ? { ...x, pages: x.pages.map((q) => (q.id === p.id ? locked : q)) } : x)) });
            this.dropMedia(drop);
            this.keys.delete(p.id);
          }
    }
    if (!this.nb.sections.some((s) => s.id === this.sectionId) || isLocked(this.section) || !this.section.pages.some((p) => p.id === this.pageId)) {
      const open = this.nb.sections.find((s) => !s.vault) ?? this.nb.sections[0]!;
      this.sectionId = open.id;
      this.pageId = open.pages[0]?.id ?? '';
    }
    this.resetView();
    this.touch();
  }
  /** Las imágenes y grabaciones de lo que se va a bloquear: lo que solo usa eso viaja cifrado y sale de la memoria. */
  private mediaToLock(keys: string[]): { media: Media; drop: string[] } {
    const pub = publicMediaKeys(this.nb);
    return { media: pickMedia(this.nb, keys), drop: keys.filter((k) => !pub.has(k)) };
  }
  private dropMedia(keys: string[]): void {
    if (!keys.length) return;
    const assets = { ...this.nb.assets };
    const ocr = { ...this.nb.ocr };
    for (const k of keys) {
      delete assets[k];
      delete ocr[k];
      const u = this.urls.get(k);
      if (u) URL.revokeObjectURL(u);
      this.urls.delete(k);
    }
    this.nb = { ...this.nb, assets, ocr };
  }
  private restoreMedia(m: Media): void {
    this.nb = { ...this.nb, assets: { ...m.assets, ...this.nb.assets }, ocr: { ...m.ocr, ...this.nb.ocr } };
  }
  private replacePage(page: Page): void {
    this.setNb({ ...this.nb, sections: this.nb.sections.map((s) => (s.id === this.sectionId ? { ...s, pages: s.pages.map((p) => (p.id === page.id ? page : p)) } : s)) });
  }
  /** Abre una página o sección bloqueada con su contraseña. Devuelve false si la contraseña no es correcta. */
  async unlock(what: 'page' | 'section', password: string): Promise<boolean> {
    const wasDirty = this.dirty;
    try {
      return await this.unlockInner(what, password);
    } finally {
      this.dirty = wasDirty;
      this.touch();
    }
  }
  private async unlockInner(what: 'page' | 'section', password: string): Promise<boolean> {
    const target = what === 'page' ? this.page : this.section;
    if (!target.protect || !target.vault) return true;
    try {
      const key = await deriveKey(password, target.protect.salt, target.protect.iter);
      if (what === 'page') {
        const r = await coreUnlockPage(this.page, key);
        const open = r.page;
        this.keys.set(open.id, key);
        this.replacePage(open);
        this.restoreMedia(r);
      } else {
        const r = await coreUnlockSection(this.section, key);
        const open = r.section;
        this.keys.set(open.id, key);
        this.setNb({ ...this.nb, sections: this.nb.sections.map((s) => (s.id === open.id ? open : s)) });
        this.restoreMedia(r);
        this.pageId = open.pages[0]?.id ?? '';
      }
      this.resetView();
      this.touch();
      return true;
    } catch (e) {
      if (e instanceof WrongPassword) return false;
      throw e;
    }
  }
  /** Quita la contraseña de lo que está abierto: vuelve a guardarse sin cifrar. */
  removeProtection(what: 'page' | 'section'): void {
    if (what === 'page') {
      this.keys.delete(this.page.id);
      this.editPage((p) => {
        const { protect: _p, ...rest } = p;
        void _p;
        return rest as Page;
      });
    } else {
      this.keys.delete(this.section.id);
      this.setNb({ ...this.nb, sections: this.nb.sections.map((s) => (s.id === this.sectionId ? (({ protect: _p, ...rest }) => (void _p, rest as Section))(s) : s)) });
    }
    this.say('Se quitó la contraseña.');
  }

  // ------------------------------------------------------------------ libretas compartidas

  /** Combina otra copia de la libreta con esta. */
  mergeFrom(remote: Notebook): MergeResult {
    const r = mergeNotebooks(this.nb, remote);
    const changed = r.added + r.updated + r.conflicts + r.removed > 0;
    this.nb = r.nb;
    if (changed) {
      this.mark();
      const s = this.nb.sections.find((x) => x.id === this.sectionId) ?? this.nb.sections[0]!;
      this.sectionId = s.id;
      if (!s.pages.some((p) => p.id === this.pageId)) this.pageId = s.pages[0]?.id ?? '';
      this.resetView();
    }
    this.touch();
    return r;
  }
  setShared(on: boolean): void {
    this.setNb({ ...this.nb, shared: on });
    this.touch();
  }

  // ------------------------------------------------------------------ búsqueda

  search(query: string): void {
    this.query = query;
    this.results = searchNotebook(this.nb, query);
    this.showResults = query.trim().length > 0;
    this.touch();
  }
  closeSearch(): void {
    this.showResults = false;
    this.touch();
  }

  // ------------------------------------------------------------------ documentos

  load(nb: Notebook, fileName: string | null, filePath: string | null): void {
    this.nb = expireTrash(nb);
    this.keys.clear();
    this.sectionId = this.nb.sections.find((s) => !s.vault)?.id ?? this.nb.sections[0]!.id;
    this.groupId = this.section.group ?? null;
    this.pageId = this.section.pages[0]?.id ?? '';
    this.fileName = fileName;
    this.filePath = filePath;
    this.dirty = false;
    this.query = '';
    this.results = [];
    this.showResults = false;
    this.collapsed.clear();
    this.tool = 'select';
    this.message = '';
    this.resetView();
    this.touch();
  }
  newDoc(): void {
    this.load(newNotebook(), null, null);
  }
  markSaved(name: string, path: string | null): void {
    this.fileName = name;
    this.filePath = path;
    this.dirty = false;
    this.touch();
  }
  /** El texto del archivo: versión automática si toca, activos sobrantes fuera, y lo protegido cifrado. */
  async serialize(): Promise<string> {
    this.autoVersion();
    this.pruneAssets();
    return serializeNotebook(this.nb, this.keys);
  }

  // ------------------------------------------------------------------ comandos de texto

  run(cmd: Command): void {
    const v = this.view;
    if (!v) return;
    cmd(v.state, v.dispatch, v);
    v.focus();
  }
  focusEditor(): void {
    this.view?.focus();
  }
  insertText(text: string): void {
    const v = this.view;
    if (!v) return;
    v.dispatch(v.state.tr.insertText(text).scrollIntoView());
    v.focus();
  }
  selectAllText(): void {
    const v = this.view;
    if (!v) return;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, Math.max(1, v.state.doc.content.size - 1))));
  }
  /** El texto de la página actual, por cuadros. */
  textOfPage(): string {
    return pageText(this.page);
  }
  doneState(tag: string | null | undefined): boolean {
    return isDone(normalizeTag(tag));
  }
  styleOf(): PageStyle {
    return this.page.style ?? defaultStyle();
  }
  dispose(): void {
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
    this.ocrRun++;
  }
  contentOf(c: Container): PMNode | null {
    return c.kind === 'text' ? contentNode(c.content) : null;
  }
}
