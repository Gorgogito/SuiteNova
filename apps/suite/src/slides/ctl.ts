import {
  addElements,
  addSlide,
  alignElements,
  chainFor,
  cloneElement,
  deleteSlides,
  applyTableStyle,
  distributeElements,
  expandRange,
  originOf,
  duplicateSlides,
  effectiveXfrm,
  findElement,
  foldMasterDeck,
  geometryToPaths,
  normalizePaths,
  pathsToCust,
  groupElements,
  masterTargetValid,
  moveElements,
  moveSlides,
  newDeck,
  newId,
  removeElements,
  reorderElements,
  scaleTable,
  resizeSlide,
  setLayout,
  ungroupElements,
  updateElement,
  updateElements,
  updateSlide,
  virtualMasterDeck,
  type AlignHow,
  type CellRange,
  type Clr,
  type Ln,
  type TableStyleDef,
  type Deck,
  type Geometry,
  type Paths,
  type ShapeEl,
  type Layout,
  type MasterTarget,
  type Slide,
  type SlideElement,
  type TableEl,
  type Xfrm,
  type ZMove,
} from '@suitenova/slides-core';
import type { EditorView } from 'prosemirror-view';
import { AssetUrls } from './render/assets';

export type SlidesView = 'normal' | 'sorter' | 'reading' | 'outline' | 'master' | 'notes';
export type Tool = { kind: 'select' } | { kind: 'text' } | { kind: 'shape'; prst: string } | { kind: 'freeform'; mode: 'polygon' | 'curve' | 'scribble' } | { kind: 'line'; prst: string };

interface Snapshot {
  deck: Deck;
  index: number;
  selection: string[];
  label: string;
}

const MAX_UNDO = 200;

/** Copy of the shapes on the clipboard (kept inside the app so formatting survives). */
export interface Clip {
  els: SlideElement[];
  slides?: Slide[];
}

export class SlidesCtl {
  private real: Deck = newDeck();
  private realIndex = 0;
  private vcache: { real: Deck; key: string; deck: Deck } | null = null;
  /** The deck the editor works on: in master view, a one-slide deck holding the master or layout being edited. */
  get deck(): Deck {
    const t = this.masterTarget;
    if (this.view !== 'master' || !masterTargetValid(this.real, t)) return this.real;
    const key = `${t.kind}:${t.id}`;
    if (this.vcache && this.vcache.real === this.real && this.vcache.key === key) return this.vcache.deck;
    const deck = virtualMasterDeck(this.real, t);
    this.vcache = { real: this.real, key, deck };
    return deck;
  }
  set deck(d: Deck) {
    this.real = d;
  }
  /** The real presentation (what is saved, exported and shown). */
  get realDeck(): Deck {
    return this.real;
  }
  get inMaster(): boolean {
    return this.view === 'master' && masterTargetValid(this.real, this.masterTarget);
  }
  get index(): number {
    return this.inMaster ? 0 : this.realIndex;
  }
  set index(v: number) {
    if (!this.inMaster) this.realIndex = v;
  }
  /** Puts an edited deck back: in master view the one-slide deck is folded into the master or layout. */
  private commit(next: Deck): void {
    this.real = this.inMaster ? foldMasterDeck(this.real, next, this.masterTarget!) : next;
  }
  fileName: string | null = null;
  filePath: string | null = null;
  dirty = false;
  /** selected element ids on the current slide */
  selection: string[] = [];
  /** selected slides in the thumbnail pane (always includes the current one) */
  selSlides: string[] = [];
  editing: string | null = null;
  /** the selected cells of a table: anchor and focus */
  private cellSel: { id: string; ar: number; ac: number; fr: number; fc: number } | null = null;
  /** the cell of the table that is being edited, and where the pointer was (to put the caret there) */
  editCellAt: { r: number; c: number } | null = null;
  caretAt: { x: number; y: number } | null = null;
  /** the table whose row heights should be read from the screen on the next draw (after it was changed) */
  syncTable: string | null = null;
  /** the picture whose frame is being cropped */
  cropping: string | null = null;
  get cropPic(): import('@suitenova/slides-core').PicEl | null {
    if (!this.cropping || this.selection.length !== 1 || this.selection[0] !== this.cropping) return null;
    const el = this.element(this.cropping);
    return el?.kind === 'pic' ? el : null;
  }
  /** the pen the table borders are drawn with */
  borderPen: { w: number; clr: Clr; dash?: Ln['dash'] } = { w: 1, clr: { scheme: 'dk1' } };
  /** an element of the master/layout being edited in master view */
  view: SlidesView = 'normal';
  masterTarget: { kind: 'master' | 'layout'; id: string } | null = null;
  tool: Tool = { kind: 'select' };
  zoom = 0; // 0 = fit
  /** the zoom of the stage when it fits the window (percent) */
  fitPercent = 0;
  showGrid = false;
  showGuides = true;
  snap = true;
  showRuler = false;
  showNotes = true;
  pane: 'none' | 'format' | 'animations' | 'comments' | 'selection' = 'none';
  message = '';
  /** the animation selected in the animation pane */
  selEffect: string | null = null;
  /** the comment (thread) selected in the comments pane */
  selComment: string | null = null;
  /** format painter: the copied formatting and whether it stays on */
  painter: { fmt: Partial<SlideElement>; text?: { r: import('@suitenova/slides-core').RunProps; p: import('@suitenova/slides-core').ParaProps }; sticky: boolean } | null = null;
  clip: Clip | null = null;
  /** the text editor being used (for commands) */
  editor: EditorView | null = null;
  urls: AssetUrls;
  warnings: string[] = [];
  /** gives the focus back to the stage (set by the stage) */
  containerFocus?: () => void;
  /** the shape whose points are being edited, and the selected point (path, node) */
  editPoints: string | null = null;
  editPt: { si: number; ni: number } | null = null;
  private pathCache: { id: string; geom: unknown; paths: Paths } | null = null;
  /** show prompts of empty placeholders in the presentation */
  showPromptsInShow = true;

  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private version = 0;
  private listeners = new Set<() => void>();
  private handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  /** the deck at the start of a text editing session */
  private session: { base: Snapshot } | null = null;

  constructor() {
    this.urls = new AssetUrls(() => this.deck);
  }

  // ------------------------------------------------------------------ plumbing

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
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

  // ------------------------------------------------------------------ derived

  get slide(): Slide {
    return this.deck.slides[Math.min(this.index, this.deck.slides.length - 1)]!;
  }
  get layout(): Layout | undefined {
    return this.deck.layouts.find((l) => l.id === this.slide.layoutId);
  }
  get title(): string {
    return (this.fileName ?? this.deck.props.title ?? 'Presentación') + (this.dirty ? ' •' : '');
  }
  chain(slide: Slide = this.slide) {
    return chainFor(this.deck, slide);
  }
  /** the transform an element is drawn with */
  xfrmOf = (el: SlideElement): Xfrm => effectiveXfrm(this.chain(), el, true);
  element(id: string): SlideElement | null {
    return findElement(this.slide.shapes, id)?.el ?? null;
  }
  get selected(): SlideElement[] {
    return this.selection.map((id) => this.element(id)).filter((e): e is SlideElement => !!e);
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0 || !!this.session;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ------------------------------------------------------------------ history

  private snap1(label: string): Snapshot {
    return { deck: this.real, index: this.realIndex, selection: this.selection, label };
  }

  /** Applies an edit as one undo step. `fn` returns the new deck (or the same one for no change). */
  apply(label: string, fn: (d: Deck) => Deck, o: { selection?: string[]; keepSelection?: boolean } = {}): void {
    const next = fn(this.deck);
    if (next === this.deck) return;
    this.endEdit();
    this.undoStack.push(this.snap1(label));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.commit(next);
    if (o.selection) this.selection = o.selection;
    this.realIndex = Math.min(this.realIndex, this.real.slides.length - 1);
    this.dirty = true;
    this.touch();
  }

  undo(): void {
    this.endEdit();
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snap1(s.label));
    this.restore(s);
  }
  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snap1(s.label));
    this.restore(s);
  }
  private restore(s: Snapshot): void {
    this.real = s.deck;
    this.realIndex = Math.min(s.index, s.deck.slides.length - 1);
    if (this.view === 'master' && !masterTargetValid(this.real, this.masterTarget)) this.masterTarget = this.firstTarget();
    this.selection = s.selection.filter((id) => !!findElement(this.slide.shapes, id));
    this.editing = null;
    this.dirty = true;
    this.touch();
  }
  get undoLabel(): string {
    return this.undoStack[this.undoStack.length - 1]?.label ?? '';
  }

  // ------------------------------------------------------------------ gestures (drag, resize…) as one undo step

  /** Starts a gesture: live changes are applied with `liveDeck` and become a single undo step when it ends. */
  beginGesture(label: string): void {
    if (this.session) return;
    this.session = { base: this.snap1(label) };
  }
  endGesture(): void {
    if (this.editing) return;
    const s = this.session;
    this.session = null;
    if (s && s.base.deck !== this.real) {
      this.undoStack.push(s.base);
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      this.redoStack = [];
      this.touch();
    }
  }

  // ------------------------------------------------------------------ text editing sessions

  beginEdit(id: string): void {
    if (this.editing === id) return;
    this.endEdit();
    this.editing = id;
    this.selection = [id];
    this.session = { base: this.snap1('Editar texto') };
    this.touch();
  }
  /** The text of the shape being edited changes (live, one undo step for the whole session). */
  liveDeck(fn: (d: Deck) => Deck): void {
    const next = fn(this.deck);
    if (next === this.deck) return;
    this.commit(next);
    this.dirty = true;
    this.touch();
  }
  endEdit(): void {
    if (this.session) {
      const { base } = this.session;
      this.session = null;
      if (base.deck !== this.real) {
        this.undoStack.push(base);
        if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
        this.redoStack = [];
      }
    }
    if (this.editing) {
      this.editing = null;
      this.editor = null;
      this.editCellAt = null;
      this.caretAt = null;
      this.touch();
    }
  }

  // ------------------------------------------------------------------ navigation and selection

  goTo(i: number): void {
    this.leavePoints();
    const n = Math.max(0, Math.min(this.deck.slides.length - 1, i));
    if (n === this.index && !this.editing) return;
    this.endEdit();
    this.index = n;
    this.selection = [];
    this.selSlides = [this.slide.id];
    this.touch();
  }
  select(ids: string[], additive = false): void {
    if (this.editPoints && !(ids.length === 1 && ids[0] === this.editPoints)) this.leavePoints();
    if (this.editing && !(ids.length === 1 && ids[0] === this.editing)) this.endEdit();
    this.selection = additive ? [...new Set([...this.selection, ...ids])] : ids;
    this.touch();
  }
  toggleSelect(id: string): void {
    this.selection = this.selection.includes(id) ? this.selection.filter((x) => x !== id) : [...this.selection, id];
    this.touch();
  }
  selectAll(): void {
    this.select(this.slide.shapes.filter((s) => !s.hidden && !s.locked).map((s) => s.id));
  }
  selectSlides(ids: string[]): void {
    this.selSlides = ids;
    this.touch();
  }
  setTool(t: Tool): void {
    this.tool = t;
    this.touch();
  }
  setView(v: SlidesView): void {
    this.endEdit();
    const was = this.view;
    const layoutId = this.real.slides[this.realIndex]?.layoutId;
    this.view = v;
    this.selection = was === v ? this.selection : [];
    if (v !== 'master') this.masterTarget = null;
    else if (!masterTargetValid(this.real, this.masterTarget)) this.masterTarget = this.real.layouts.some((l) => l.id === layoutId) ? { kind: 'layout', id: layoutId! } : this.firstTarget();
    this.touch();
  }
  private firstTarget(): MasterTarget {
    const m = this.real.masters[0]!;
    return m.layoutIds[0] ? { kind: 'layout', id: m.layoutIds[0] } : { kind: 'master', id: m.id };
  }
  /** Chooses the master or layout shown in master view. */
  /** An edit of the real presentation (layouts, masters) made from master view, as one undo step. */
  applyReal(label: string, fn: (d: Deck) => Deck, target?: MasterTarget): void {
    const next = fn(this.real);
    if (next === this.real) return;
    this.endEdit();
    this.undoStack.push(this.snap1(label));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.real = next;
    if (target) this.masterTarget = target;
    if (this.view === 'master' && !masterTargetValid(this.real, this.masterTarget)) this.masterTarget = this.firstTarget();
    this.selection = [];
    this.dirty = true;
    this.touch();
  }
  /** The master the master view is showing (the target itself, or the master of the target layout). */
  get masterIdOfTarget(): string | undefined {
    const t = this.masterTarget;
    if (!t) return undefined;
    return t.kind === 'master' ? t.id : this.real.layouts.find((l) => l.id === t.id)?.masterId;
  }
  setMasterTarget(t: MasterTarget): void {
    this.endEdit();
    this.masterTarget = t;
    this.selection = [];
    this.touch();
  }

  // ------------------------------------------------------------------ edit points

  leavePoints(): void {
    this.editPoints = null;
    this.editPt = null;
  }
  /** The nodes of a shape in edit-points mode (kept between edits so corner/smooth kinds are remembered). */
  pointsOf(el: ShapeEl): Paths {
    if (this.pathCache && this.pathCache.id === el.id && this.pathCache.geom === el.geom) return this.pathCache.paths;
    const x = this.xfrmOf(el);
    const paths = geometryToPaths(el.geom, x.w, x.h);
    this.pathCache = { id: el.id, geom: el.geom, paths };
    return paths;
  }
  /** Writes edited nodes into the shape as a custom geometry. `label` null = live (inside a gesture). */
  setPaths(el: ShapeEl, paths: Paths, label: string | null, base?: Xfrm): void {
    const { paths: np, xfrm } = normalizePaths(paths, base ?? this.xfrmOf(el));
    const geom: Geometry = { cust: [pathsToCust(np, xfrm.w, xfrm.h)] };
    this.pathCache = { id: el.id, geom, paths: np };
    const upd = (d: Deck) => updateElement(d, this.slide.id, el.id, (e) => ({ ...e, geom, xfrm }) as SlideElement);
    if (label) this.apply(label, upd);
    else this.liveDeck(upd);
  }
  startPoints(): void {
    const el = this.selected[0];
    if (this.selection.length !== 1 || !el || el.kind !== 'shape') return;
    this.editPoints = el.id;
    this.editPt = null;
    this.tool = { kind: 'select' };
    this.touch();
  }
  /** An edit of the selected node (or the first one) of the shape in edit-points mode. */
  pointOp(label: string, fn: (paths: Paths, sel: { si: number; ni: number }) => { paths: Paths; sel?: { si: number; ni: number } | null }): void {
    const el = this.editPoints ? (this.element(this.editPoints) as ShapeEl | null) : null;
    if (!el) return;
    const r = fn(this.pointsOf(el), this.editPt ?? { si: 0, ni: 0 });
    if (!r.paths.length) {
      this.leavePoints();
      this.apply('Eliminar', (d) => removeElements(d, this.slide.id, [el.id]), { selection: [] });
      return;
    }
    this.setPaths(el, r.paths, label);
    if (r.sel !== undefined) this.editPt = r.sel;
    this.touch();
  }

  // ------------------------------------------------------------------ table cells

  /** The selected table, when exactly one is selected. */
  get table(): TableEl | null {
    if (this.selection.length !== 1) return null;
    const el = this.element(this.selection[0]!);
    return el?.kind === 'table' ? el : null;
  }
  /** The selected cells of the selected table (grown to hold whole merged cells), or null. */
  get cellSelection(): { id: string; ar: number; ac: number; fr: number; fc: number; range: CellRange } | null {
    const t = this.table;
    const s = this.cellSel;
    if (!t || !s || s.id !== t.id) return null;
    const cl = (v: number, m: number) => Math.max(0, Math.min(m, v));
    const R = t.rows.length - 1;
    const C = t.cols.length - 1;
    const ar = cl(s.ar, R);
    const ac = cl(s.ac, C);
    const fr = cl(s.fr, R);
    const fc = cl(s.fc, C);
    return { id: t.id, ar, ac, fr, fc, range: expandRange(t, { r1: ar, c1: ac, r2: fr, c2: fc }) };
  }
  /** The cell whose text is being edited. */
  get editingCell(): { id: string; r: number; c: number } | null {
    if (!this.editing || !this.editCellAt || this.element(this.editing)?.kind !== 'table') return null;
    return { id: this.editing, ...this.editCellAt };
  }
  /** Selects a table as an object (no cells). */
  selectTable(id: string): void {
    this.endEdit();
    this.selection = [id];
    this.cellSel = null;
    this.touch();
  }
  selectCells(id: string, ar: number, ac: number, fr = ar, fc = ac): void {
    this.endEdit();
    this.selection = [id];
    this.cellSel = { id, ar, ac, fr, fc };
    this.touch();
  }
  beginCellEdit(id: string, r: number, c: number, at?: { x: number; y: number }): void {
    const t = this.element(id);
    if (t?.kind !== 'table') return;
    const o = originOf(t, r, c);
    this.endEdit();
    this.editing = id;
    this.editCellAt = { r: o.r, c: o.c };
    this.caretAt = at ?? null;
    this.selection = [id];
    this.cellSel = { id, ar: o.r, ac: o.c, fr: o.r, fc: o.c };
    this.session = { base: this.snap1('Editar texto') };
    this.touch();
  }
  /** Changes the selected table (the whole table when no cells are selected) as one undo step; `null` from `fn` removes it. */
  tableApply(label: string, fn: (t: TableEl, range: CellRange) => TableEl | null | undefined, sel?: (t: TableEl) => [number, number, number, number]): void {
    const t = this.table;
    if (!t) return;
    const range = this.cellSelection?.range ?? { r1: 0, c1: 0, r2: t.rows.length - 1, c2: t.cols.length - 1 };
    let out: TableEl | null | undefined;
    this.apply(label, (d) => {
      out = fn(t, range);
      if (out === undefined || out === t) return d;
      if (out === null) return removeElements(d, this.slide.id, [t.id]);
      const next = out;
      return updateElement(d, this.slide.id, t.id, () => next as SlideElement);
    });
    if (out && out !== t) this.syncTable = t.id;
    if (out === null) {
      this.selection = [];
      this.cellSel = null;
    } else if (out && out !== t && sel) {
      const [ar, ac, fr, fc] = sel(out);
      this.cellSel = { id: t.id, ar, ac, fr, fc };
    }
    this.touch();
  }

  /** Gives the selected table a style (null: none, with or without a grid). The style definition travels with the presentation. */
  setTableStyle(def: TableStyleDef | null, none?: 'grid' | 'none'): void {
    const t = this.table;
    if (!t) return;
    this.apply('Estilo de tabla', (d) => {
      const r = applyTableStyle(d, def, none);
      return updateElement(r.deck, this.slide.id, t.id, (el) => ({ ...el, styleId: r.id }) as SlideElement);
    });
  }

  // ------------------------------------------------------------------ slides

  newSlide(layoutId?: string): void {
    const lid = layoutId ?? this.slide.layoutId;
    const lay = this.deck.layouts.find((l) => l.id === lid);
    // like PowerPoint: a new slide after a title slide uses "Title and content"
    const use = layoutId ?? (lay?.type === 'title' ? (this.deck.layouts.find((l) => l.type === 'obj')?.id ?? lid) : lid);
    const at = this.index;
    this.apply('Nueva diapositiva', (d) => addSlide(d, use, at).deck);
    this.index = at + 1;
    this.selection = [];
    this.selSlides = [this.slide.id];
    this.touch();
  }
  deleteSlides(ids = this.selSlides): void {
    if (this.deck.slides.length <= ids.length) {
      this.say('Una presentación necesita al menos una diapositiva.');
      return;
    }
    const first = Math.min(...ids.map((id) => this.deck.slides.findIndex((s) => s.id === id)));
    this.apply('Eliminar diapositivas', (d) => deleteSlides(d, ids));
    this.index = Math.max(0, Math.min(first, this.deck.slides.length - 1));
    this.selSlides = [this.slide.id];
    this.selection = [];
    this.touch();
  }
  duplicateSlides(ids = this.selSlides): void {
    let created: string[] = [];
    this.apply('Duplicar diapositivas', (d) => {
      const r = duplicateSlides(d, ids);
      created = r.ids;
      return r.deck;
    });
    const i = this.deck.slides.findIndex((s) => s.id === created[0]);
    if (i >= 0) this.index = i;
    this.selSlides = created;
    this.touch();
  }
  moveSlidesTo(ids: string[], toIndex: number): void {
    const cur = this.slide.id;
    this.apply('Mover diapositivas', (d) => moveSlides(d, ids, toIndex));
    this.index = Math.max(0, this.deck.slides.findIndex((s) => s.id === cur));
    this.touch();
  }
  setLayoutOf(layoutId: string, ids = this.selSlides): void {
    this.apply('Cambiar diseño', (d) => ids.reduce((acc, id) => setLayout(acc, id, layoutId), d));
  }
  hideSlides(hidden: boolean, ids = this.selSlides): void {
    this.apply(hidden ? 'Ocultar diapositivas' : 'Mostrar diapositivas', (d) => ids.reduce((acc, id) => updateSlide(acc, id, (s) => ({ ...s, hidden })), d));
  }

  // ------------------------------------------------------------------ elements

  patch(ids: string[], label: string, fn: (el: SlideElement) => SlideElement): void {
    if (!ids.length) return;
    this.apply(label, (d) => updateElements(d, this.slide.id, ids, fn));
  }
  patchSelected(label: string, fn: (el: SlideElement) => SlideElement): void {
    this.patch(this.selection, label, fn);
  }
  addElement(el: SlideElement, o: { select?: boolean } = {}): void {
    this.apply('Insertar', (d) => addElements(d, this.slide.id, [el]));
    if (o.select !== false) this.select([el.id]);
  }
  deleteSelected(): void {
    if (!this.selection.length) return;
    const ids = this.selection;
    this.apply('Eliminar', (d) => removeElements(d, this.slide.id, ids), { selection: [] });
  }
  moveBy(dx: number, dy: number, ids = this.selection): void {
    this.apply('Mover', (d) => moveElements(d, this.slide.id, ids, dx, dy, this.xfrmOf));
  }
  setXfrm(id: string, x: Partial<Xfrm>, label = 'Cambiar posición y tamaño'): void {
    this.apply(label, (d) => updateElement(d, this.slide.id, id, (el) => ({ ...el, xfrm: { ...this.xfrmOf(el), ...x } }) as SlideElement));
  }
  /** Sets the transforms of several elements at once (one step), used by drag, resize and rotate. */
  setXfrms(map: Record<string, Xfrm>, label: string): void {
    this.apply(label, (d) => updateElements(d, this.slide.id, Object.keys(map), (el) => (el.kind === 'table' ? scaleTable({ ...el, xfrm: map[el.id] } as TableEl, map[el.id]!.w, map[el.id]!.h) : { ...el, xfrm: map[el.id] }) as SlideElement));
  }
  order(how: ZMove): void {
    this.apply('Orden', (d) => reorderElements(d, this.slide.id, this.selection, how));
  }
  align(how: AlignHow, to?: 'selection' | 'slide'): void {
    this.apply('Alinear', (d) => alignElements(d, this.slide.id, this.selection, how, this.xfrmOf, to));
  }
  distribute(axis: 'h' | 'v', to?: 'selection' | 'slide'): void {
    this.apply('Distribuir', (d) => distributeElements(d, this.slide.id, this.selection, axis, this.xfrmOf, to));
  }
  group(): void {
    let id: string | null = null;
    this.apply('Agrupar', (d) => {
      const r = groupElements(d, this.slide.id, this.selection, this.xfrmOf);
      id = r.id;
      return r.deck;
    });
    if (id) this.select([id]);
  }
  ungroup(): void {
    let ids: string[] = [];
    this.apply('Desagrupar', (d) => {
      const r = ungroupElements(d, this.slide.id, this.selection);
      ids = r.ids;
      return r.deck;
    });
    if (ids.length) this.select(ids);
  }
  duplicateSelected(): void {
    const els = this.selected.map((e) => {
      const c = cloneElement(e);
      const x = this.xfrmOf(e);
      return { ...c, xfrm: { ...x, x: x.x + 12, y: x.y + 12 } } as SlideElement;
    });
    if (!els.length) return;
    this.apply('Duplicar', (d) => addElements(d, this.slide.id, els), { selection: els.map((e) => e.id) });
  }
  copy(): void {
    if (this.selection.length) this.clip = { els: this.selected };
    else this.clip = { els: [], slides: this.deck.slides.filter((s) => this.selSlides.includes(s.id)) };
    this.touch();
  }
  cut(): void {
    this.copy();
    if (this.selection.length) this.deleteSelected();
    else this.deleteSlides();
  }
  paste(): void {
    const c = this.clip;
    if (!c) return;
    if (c.slides?.length && !c.els.length) {
      const copies = c.slides.map((s) => ({ ...s, id: newId('s'), shapes: s.shapes.map(cloneElement), timing: undefined }));
      const at = this.index;
      this.apply('Pegar diapositivas', (d) => {
        const slides = [...d.slides];
        slides.splice(at + 1, 0, ...copies);
        return { ...d, slides };
      });
      this.index = at + 1;
      this.selSlides = copies.map((s) => s.id);
      this.touch();
      return;
    }
    const els = c.els.map((e) => {
      const n = cloneElement(e);
      const x = (e as { xfrm?: Xfrm }).xfrm;
      return x ? ({ ...n, xfrm: { ...x, x: x.x + 12, y: x.y + 12 } } as SlideElement) : n;
    });
    this.apply('Pegar', (d) => addElements(d, this.slide.id, els), { selection: els.map((e) => e.id) });
  }

  // ------------------------------------------------------------------ slide size

  setSlideSize(w: number, h: number, mode: 'fit' | 'max' | 'stretch', type?: string): void {
    this.apply('Tamaño de la diapositiva', (d) => resizeSlide(d, w, h, mode, type));
  }

  // ------------------------------------------------------------------ documents

  load(deck: Deck, name: string | null, path: string | null, warnings: string[] = []): void {
    this.urls.dispose();
    this.view = 'normal';
    this.masterTarget = null;
    this.real = deck;
    this.fileName = name;
    this.filePath = path;
    this.dirty = false;
    this.index = 0;
    this.selection = [];
    this.selSlides = [deck.slides[0]!.id];
    this.editing = null;
    this.session = null;
    this.undoStack = [];
    this.redoStack = [];
    this.view = 'normal';
    this.masterTarget = null;
    this.warnings = warnings;
    this.touch();
  }
  newDoc(): void {
    this.load(newDeck(), null, null);
  }
  markSaved(name: string, path: string | null): void {
    this.fileName = name;
    this.filePath = path;
    this.dirty = false;
    this.touch();
  }
  dispose(): void {
    this.urls.dispose();
  }
}
