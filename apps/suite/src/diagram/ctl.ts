import { autoLayout, resetPorts, type LayoutDir, type LayoutKind } from '@suitenova/diagram-core';
import { addThread, newId as newCommentId, sortThreads, type Thread } from '@suitenova/comment-core';
import { getUser } from '../comments/identity';
import { fromCore, toCore, type ShapeAnchor } from './comments-ops';
import { addLane, layersOf as layersOfPage, removeLane, renameLane, resizeLane, setContainerProps, settleContainers, withMembers, wrapInContainer } from '@suitenova/diagram-core';
import {
  addConnector, addDataField, addItems, addLayer, addPage, assignLayer, expandSelection, groupShapes, isItemLocked, isItemVisible, moveLayer, removeLayer, setActiveLayer, ungroupShapes, updateLayer, flipShapes, setShapeData, setShapeImage, setShapeLink, addShape, alignShapes, cloneItems, deleteItems, deletePage, distributeShapes, duplicatePage, fontShapes, isGlued, matchSize, moveConnectorEnds, moveShapes, movePage, newConnector, newDiagram, reorder, rotateBy,
  styleShapes, updateConnectors, updatePage, updateShapes, type AlignMode, type Arrow, type Layer, type DataField, type ShapeImage, type ShapeLink, type Connector, type Diagram, type Dash, type End, type Font, type Page, type Routing, type Shape, type Style,
} from '@suitenova/diagram-core';
import { addGuide, applyLook, autoConnect, boundsOf, changeStencil, createShape, lookOf, moveGuide, removeGuide, unionRects, type ClipContent, type Guide, type Look, type Side } from '@suitenova/diagram-core';

import { t } from '@suitenova/core-ui';
import { applyOpenPolicy, type SignatureInfo } from '../macros/security';
import { MacroRecorder } from '../macros/recorder';
import { DiagramRuntime } from './macros';
import { recordChange } from './recorder';
import { DiagramImageOcr } from './ocr-images';

const MAX_UNDO = 100;

export type Tool = 'select' | 'connector';

export type Clip = ClipContent;

/** Where a shape is and how big: the centre, the size and the turn. */
export interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
}

const DRAW_OPTIONS = 'nova.diagram.draw';
/** The aids of the canvas, remembered by this computer. */
export interface DrawOptions {
  rulers: boolean;
  guides: boolean;
  smartGuides: boolean;
  autoConnect: boolean;
}
function readDrawOptions(): DrawOptions {
  const all: DrawOptions = { rulers: true, guides: true, smartGuides: true, autoConnect: true };
  try {
    const saved = JSON.parse(localStorage.getItem(DRAW_OPTIONS) ?? '{}') as Partial<DrawOptions>;
    for (const k of Object.keys(all) as (keyof DrawOptions)[]) if (typeof saved[k] === 'boolean') all[k] = saved[k]!;
  } catch {
    /* no storage: the defaults */
  }
  return all;
}

export class DiagramCtl {
  diagram: Diagram = newDiagram();
  pageId = this.diagram.pages[0]!.id;
  selShapes: string[] = [];
  selConnectors: string[] = [];
  tool: Tool = 'select';
  /** In percent. */
  zoom = 100;
  snapToGrid = true;
  showGrid = true;
  /** Defaults for connectors drawn with the mouse. */
  routing: Routing = 'elbow';
  endArrow: Arrow = 'arrow';
  startArrow: Arrow = 'none';
  fileName: string | null = null;
  filePath: string | null = null;
  dirty = false;
  /** True right after saving, until something changes (the status bar says «Guardado»). */
  justSaved = false;
  /** The inline editor that is open (text of a shape, lane title, layer name) and what has been typed in it. */
  private typing: { value: string; original: string; apply: (v: string) => void } | null = null;
  /** True when an open inline editor holds text that is not in the diagram yet. */
  get hasPendingText(): boolean {
    return !!this.typing && this.typing.value !== this.typing.original;
  }
  /** Something would be lost by closing: unsaved changes, or text still being typed. */
  get unsaved(): boolean {
    return this.dirty || this.hasPendingText;
  }
  /** An inline editor opens. It reports what is typed (`type`) and says when it closes (`done`). */
  startTyping(original: string, apply: (v: string) => void): { type: (v: string) => void; done: () => void } {
    const mine = { value: original, original, apply };
    this.typing = mine;
    return {
      type: (v) => {
        const was = this.hasPendingText;
        mine.value = v;
        if (this.typing === mine && was !== this.hasPendingText) this.touch();
      },
      done: () => {
        if (this.typing !== mine) return;
        const was = this.hasPendingText;
        this.typing = null;
        if (was) this.touch();
      },
    };
  }
  /** Puts the text being typed into the diagram (before saving, printing or exporting); the editor stays open. */
  flushTyping(): void {
    const y = this.typing;
    if (!y || y.value === y.original) return;
    y.original = y.value;
    y.apply(y.value);
  }
  message = '';
  /** Page shown while a gesture is in progress; the diagram changes once, when it ends. */
  preview: Page | null = null;
  /** Id of the shape or connector whose text is being edited. */
  editing: string | null = null;
  clip: Clip | null = null;
  /** Set by the app: follows the link of a shape (Ctrl+click). */
  openLinkHandler?: (shape: Shape) => void;
  /** Set by the app: pictures dropped on the canvas. */
  onImageFiles?: (files: File[], at: { x: number; y: number }) => void;
  /** Pane shown at the right of the canvas. */
  pane: 'none' | 'data' | 'layers' | 'comments' | 'size' = 'none';
  /** The search bar, when it is open: with or without the replace row. */
  finding: { replace: boolean } | null = null;
  options: DrawOptions = readDrawOptions();
  setOption(key: keyof DrawOptions, on: boolean): void {
    this.options = { ...this.options, [key]: on };
    try {
      localStorage.setItem(DRAW_OPTIONS, JSON.stringify(this.options));
    } catch {
      /* not remembered */
    }
    this.touch();
  }
  openFind(replace: boolean): void {
    this.finding = { replace };
    this.touch();
  }
  closeFind(): void {
    this.finding = null;
    this.touch();
  }
  /** Something the canvas should bring into view (a result of a search). */
  reveal: { id: string; n: number } | null = null;
  revealItem(id: string): void {
    this.reveal = { id, n: (this.reveal?.n ?? 0) + 1 };
    this.touch();
  }
  /** The macro modules of the diagram (Nova Basic with the objects of Visio). */
  macros: { name: string; code: string }[] = [];
  /** Active content (macros) may run. A file that arrives with macros starts with it disabled. */
  contentEnabled = true;
  macroSignature?: SignatureInfo;
  private runtime: DiagramRuntime | null = null;
  get macroRt(): DiagramRuntime {
    return (this.runtime ??= new DiagramRuntime(this));
  }
  enableContent(): void {
    this.contentEnabled = true;
    this.touch();
  }
  /** The diagram to save: with its macros. */
  get saved(): Diagram {
    return this.macros.length ? { ...this.diagram, macros: this.macros } : this.diagram;
  }
  /** The macro being recorded, if any: every change of the diagram is translated to code (see `describeChange`). */
  recording: MacroRecorder | null = null;
  startRecording(name: string, description: string): void {
    if (this.recording) return;
    this.recording = new MacroRecorder(name, description, 'Visio');
    this.touch();
  }
  pauseRecording(): void {
    if (!this.recording) return;
    this.recording.paused = !this.recording.paused;
    this.touch();
  }
  /** Ends the recording and writes the macro in the module of recorded macros. */
  stopRecording(): void {
    const r = this.recording;
    if (!r) return;
    this.recording = null;
    const module = r.saveInto(this.macros);
    this.dirty = true;
    this.say(r.isEmpty ? t('No se grabó ninguna acción en «{n}».', { n: r.name }) : t('La macro «{n}» se guardó en el módulo «{m}».', { n: r.name, m: module }));
  }
  private past: Diagram[] = [];
  private future: Diagram[] = [];
  private version = 0;
  private listeners = new Set<() => void>();

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
    this.imageOcr.schedule();
  }

  /** The text read from the pictures (OCR): copy it, find it, read again. */
  readonly imageOcr = new DiagramImageOcr(this);

  /** Keeps a reading in every picture with this source that has none (derived data: not an undoable step, the document is not marked as changed). */
  setImageOcr(src: string, ocr: unknown): void {
    let changed = false;
    const pages = this.diagram.pages.map((p) => ({
      ...p,
      shapes: p.shapes.map((s) => (s.image && s.image.src === src && !s.image.ocr ? ((changed = true), { ...s, image: { ...s.image, ocr } }) : s)),
    }));
    if (!changed) return;
    this.diagram = { ...this.diagram, pages };
    this.touch();
  }

  /** Keeps a new reading of one picture (other language, a zone, a turn). */
  setShapeOcr(id: string, ocr: unknown): void {
    const pages = this.diagram.pages.map((p) => ({ ...p, shapes: p.shapes.map((s) => (s.id === id && s.image ? { ...s, image: { ...s.image, ocr } } : s)) }));
    this.diagram = { ...this.diagram, pages };
    this.touch();
  }

  // ---------- state

  get basePage(): Page {
    return this.diagram.pages.find((p) => p.id === this.pageId) ?? this.diagram.pages[0]!;
  }
  /** What to draw: the live preview during a gesture, else the page. */
  get page(): Page {
    return this.preview ?? this.basePage;
  }
  get docTitle(): string {
    return `${this.fileName ?? this.diagram.name}${this.unsaved ? ' •' : ''}`;
  }
  get hasSelection(): boolean {
    return this.selShapes.length + this.selConnectors.length > 0;
  }
  selectedShapes(): Shape[] {
    return this.basePage.shapes.filter((s) => this.selShapes.includes(s.id));
  }
  selectedConnectors(): Connector[] {
    return this.basePage.connectors.filter((c) => this.selConnectors.includes(c.id));
  }
  say(msg: string): void {
    this.message = msg;
    this.touch();
  }

  // ---------- history

  commit(next: Diagram): void {
    if (next === this.diagram) return;
    if (this.recording && !this.macroRt.running) recordChange(this.recording, this.diagram, next, this.pageId);
    this.past.push(this.diagram);
    if (this.past.length > MAX_UNDO) this.past.shift();
    this.future = [];
    this.diagram = next;
    this.preview = null;
    this.dirty = true;
    this.cleanSelection();
    this.touch();
  }
  /** Replace the current page through a pure function. */
  edit(fn: (p: Page) => Page): void {
    const id = this.pageId;
    this.commit(updatePage(this.diagram, id, (p) => settleContainers(fn(p))));
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  /** Runs `fn` so that everything it changes is one undo step (the macros use it). */
  undoGroup(fn: () => void): void {
    const before = this.past.length;
    try {
      fn();
    } finally {
      if (this.past.length > before) {
        const first = this.past[before]!;
        this.past.splice(before);
        this.past.push(first);
      }
    }
  }
  undo(): void {
    const d = this.past.pop();
    if (!d) return;
    if (this.recording && !this.macroRt.running) this.recording.unsupported('deshacer');
    this.future.push(this.diagram);
    this.restore(d);
  }
  redo(): void {
    const d = this.future.pop();
    if (!d) return;
    if (this.recording && !this.macroRt.running) this.recording.unsupported('rehacer');
    this.past.push(this.diagram);
    this.restore(d);
  }
  private restore(d: Diagram): void {
    this.diagram = d;
    if (!d.pages.some((p) => p.id === this.pageId)) this.pageId = d.pages[0]!.id;
    this.preview = null;
    this.editing = null;
    this.dirty = true;
    this.cleanSelection();
    this.touch();
  }
  private cleanSelection(): void {
    const p = this.basePage;
    this.selShapes = this.selShapes.filter((id) => p.shapes.some((s) => s.id === id));
    this.selConnectors = this.selConnectors.filter((id) => p.connectors.some((c) => c.id === id));
  }

  load(loaded: Diagram, name: string | null, path: string | null): void {
    const { macros, ...d } = loaded;
    this.macros = macros ?? [];
    applyOpenPolicy(this, this.macros, path);
    this.diagram = d;
    this.pageId = d.pages[0]!.id;
    this.past = [];
    this.future = [];
    this.preview = null;
    this.selShapes = [];
    this.selConnectors = [];
    this.editing = null;
    this.fileName = name;
    this.filePath = path;
    this.dirty = false;
    this.justSaved = false;
    this.typing = null;
    this.painter = null;
    this.selGuide = null;
    this.message = '';
    this.imageOcr.resetBaseline();
    this.touch();
  }
  reset(): void {
    this.load(newDiagram(), null, null);
  }
  markSaved(name: string, path: string | null): void {
    this.fileName = name;
    this.filePath = path;
    this.dirty = false;
    this.justSaved = true;
    this.touch();
  }

  // ---------- selection

  setSelection(shapes: string[], connectors: string[] = []): void {
    this.selShapes = shapes;
    this.selConnectors = connectors;
    if (shapes.length || connectors.length) this.selGuide = null;
    this.touch();
  }
  clearSelection(): void {
    this.setSelection([], []);
  }
  toggle(kind: 'shape' | 'connector', id: string): void {
    const list = kind === 'shape' ? this.selShapes : this.selConnectors;
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    if (kind === 'shape') this.setSelection(next, this.selConnectors);
    else this.setSelection(this.selShapes, next);
  }
  selectAll(): void {
    const p = this.basePage;
    this.setSelection(p.shapes.filter((s) => this.canSelect(s)).map((s) => s.id), p.connectors.filter((c) => this.canSelect(c)).map((c) => c.id));
  }
  /** Items on a hidden or locked layer cannot be selected. */
  canSelect(item: { layer?: string }): boolean {
    const p = this.basePage;
    return isItemVisible(p, item) && !isItemLocked(p, item);
  }
  /** Shapes whose layer allows changing them (and that are not locked themselves). */
  isFrozen(s: Shape): boolean {
    return s.locked || isItemLocked(this.basePage, s);
  }
  /** Selects a shape together with the rest of its group. */
  selectWithGroup(id: string): void {
    this.setSelection(expandSelection(this.basePage, [id]).filter((x) => this.canSelect(this.basePage.shapes.find((s) => s.id === x)!)), []);
  }
  group(): void {
    const r = groupShapes(this.basePage, this.selShapes);
    if (!r) return;
    this.edit(() => r.page);
    this.setSelection(expandSelection(r.page, this.selShapes), this.selConnectors);
  }
  ungroup(): void {
    this.edit((p) => ungroupShapes(p, this.selShapes));
  }
  get canGroup(): boolean {
    return groupShapes(this.basePage, this.selShapes) !== null;
  }
  get canUngroup(): boolean {
    const p = this.basePage;
    return this.selectedShapes().some((s) => !!s.group && p.groups?.some((g) => g.id === s.group));
  }

  // ---------- automatic layout

  layoutOptions: { dir: LayoutDir; gapX: number; gapY: number; releasePorts: boolean } = { dir: 'TB', gapX: 40, gapY: 70, releasePorts: true };

  /** Lays out the selected shapes (two or more), or the whole page, as one undo step. */
  applyLayout(kind: LayoutKind): void {
    const o = this.layoutOptions;
    const ids = this.selShapes.length >= 2 ? this.selShapes : undefined;
    this.edit((p) => {
      const q = autoLayout(p, { kind, dir: o.dir, gapX: o.gapX, gapY: o.gapY, ids });
      return q === p ? p : o.releasePorts ? resetPorts(q, ids) : q;
    });
  }
  setLayoutDir(dir: LayoutDir): void {
    this.layoutOptions = { ...this.layoutOptions, dir };
    this.touch();
  }

  // ---------- containers and lanes

  /** The lane of a pool that the next lane command acts on (the one last clicked). */
  activeLane: { pool: string; lane: string } | null = null;
  /** A lane title being edited. */
  editingLane: { pool: string; lane: string } | null = null;

  selectedContainers(): Shape[] {
    return this.selectedShapes().filter((s) => s.container);
  }
  selectedPool(): Shape | null {
    return this.selectedShapes().find((s) => s.container?.kind === 'pool') ?? null;
  }
  wrapSelection(): void {
    const r = wrapInContainer(this.basePage, this.selShapes);
    if (!r) return;
    this.edit(() => r.page);
    this.setSelection([r.id], []);
  }
  setAutoSize(mode: 'never' | 'grow' | 'fit'): void {
    const ids = this.selectedContainers().map((s) => s.id);
    if (ids.length) this.edit((p) => setContainerProps(p, ids, { autoSize: mode }));
  }
  private laneTarget(): { pool: Shape; laneId: string } | null {
    const pool = this.selectedPool();
    if (!pool?.container?.lanes) return null;
    const lanes = pool.container.lanes;
    const a = this.activeLane && this.activeLane.pool === pool.id && lanes.some((l) => l.id === this.activeLane!.lane) ? this.activeLane.lane : lanes[lanes.length - 1]!.id;
    return { pool, laneId: a };
  }
  /** A new lane after the active one (or at the end). */
  addLaneAfter(): void {
    const t = this.laneTarget();
    if (!t) return;
    const i = t.pool.container!.lanes!.findIndex((l) => l.id === t.laneId);
    this.edit((p) => addLane(p, t.pool.id, i + 1));
  }
  removeActiveLane(): void {
    const t = this.laneTarget();
    if (t) this.edit((p) => removeLane(p, t.pool.id, t.laneId));
  }
  renameLaneTo(pool: string, lane: string, title: string): void {
    this.edit((p) => renameLane(p, pool, lane, title));
  }
  setLaneSize(pool: string, lane: string, size: number, preview = false): void {
    if (preview) this.previewWith((p) => resizeLane(p, pool, lane, size));
    else this.edit((p) => resizeLane(p, pool, lane, size));
  }
  startLaneEdit(pool: string, lane: string): void {
    this.editingLane = { pool, lane };
    this.touch();
  }

  // ---------- layers

  get layers(): Layer[] {
    return layersOfPage(this.basePage);
  }
  addLayerNamed(name?: string): void {
    const r = addLayer(this.basePage, name);
    this.edit(() => r.page);
  }
  setLayerProps(id: string, patch: Partial<Omit<Layer, 'id'>>): void {
    this.edit((p) => updateLayer(p, id, patch));
    // what is on a layer that was just hidden or locked cannot stay selected
    this.setSelection(this.selShapes.filter((x) => this.canSelect(this.basePage.shapes.find((s) => s.id === x)!)), this.selConnectors.filter((x) => this.canSelect(this.basePage.connectors.find((c) => c.id === x)!)));
  }
  removeLayerById(id: string): void {
    this.edit((p) => removeLayer(p, id));
  }
  moveLayerBy(id: string, dir: -1 | 1): void {
    this.edit((p) => moveLayer(p, id, dir));
  }
  setActive(id: string): void {
    this.edit((p) => setActiveLayer(p, id));
  }
  assignSelectionToLayer(id: string): void {
    if (this.hasSelection) this.edit((p) => assignLayer(p, this.selShapes, this.selConnectors, id));
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.painter = null;
    this.touch();
  }
  setZoom(z: number): void {
    this.zoom = Math.max(10, Math.min(400, Math.round(z)));
    this.touch();
  }

  // ---------- creating and deleting

  addStencil(id: string, at?: { x: number; y: number }): Shape {
    const p = this.basePage;
    // without a position, new shapes go near the middle of the page and fan out so they do not hide each other
    const n = p.shapes.length % 8;
    const cx = at?.x ?? p.width / 2 + n * 24 - 80;
    const cy = at?.y ?? p.height / 2 + n * 24 - 80;
    const r = addShape(p, id, cx, cy);
    this.commit(updatePage(this.diagram, this.pageId, () => settleContainers(r.page)));
    this.selShapes = [r.shape.id];
    this.selConnectors = [];
    this.touch();
    return r.shape;
  }

  deleteSelection(): void {
    if (!this.hasSelection) return;
    // locked shapes stay (and stay selected)
    const shapes = this.selShapes.filter((id) => !this.isFrozen(this.basePage.shapes.find((s) => s.id === id)!));
    if (!shapes.length && !this.selConnectors.length) return;
    const conns = this.selConnectors;
    this.edit((p) => deleteItems(p, shapes, conns));
    this.selShapes = this.selShapes.filter((id) => !shapes.includes(id));
    this.selConnectors = [];
    this.touch();
  }

  /** Connect two shapes (the first selected to the second) with the current connector defaults. */
  connectSelected(): string | null {
    if (this.selShapes.length !== 2) return 'Selecciona exactamente dos formas para conectarlas.';
    const [a, b] = this.selShapes;
    const c = newConnector({ shape: a!, port: 'auto' }, { shape: b!, port: 'auto' }, { routing: this.routing, startArrow: this.startArrow, endArrow: this.endArrow });
    this.edit((p) => addConnector(p, c));
    this.setSelection([], [c.id]);
    return null;
  }

  addConnectorBetween(from: End, to: End): void {
    const c = newConnector(from, to, { routing: this.routing, startArrow: this.startArrow, endArrow: this.endArrow });
    this.edit((p) => addConnector(p, c));
    this.setSelection([], [c.id]);
  }

  // ---------- clipboard

  copy(): void {
    if (!this.hasSelection) return;
    const p = this.basePage;
    this.clip = cloneItems(p, this.selShapes, this.selConnectors);
    this.touch();
  }
  cut(): void {
    this.copy();
    this.deleteSelection();
  }
  get canPaste(): boolean {
    return !!this.clip && this.clip.shapes.length + this.clip.connectors.length > 0;
  }
  paste(at?: { x: number; y: number }): void {
    if (this.clip) this.pasteContent(this.clip, at);
  }
  /**
   * Puts copied shapes on the page: at a point when one is given; else where they were, moved aside as many times as
   * it takes not to cover a shape that sits exactly there.
   */
  pasteContent(content: Clip, at?: { x: number; y: number }): void {
    if (!content.shapes.length && !content.connectors.length) return;
    const page = this.basePage;
    let dx = 0;
    let dy = 0;
    const first = content.shapes[0];
    const ends = content.connectors.flatMap((c) => [c.from, c.to]).filter((e): e is { x: number; y: number } => !isGlued(e));
    if (at) {
      const box = unionRects([...content.shapes.map(boundsOf), ...ends.map((e) => ({ x: e.x, y: e.y, w: 0, h: 0 }))]);
      if (box) {
        dx = Math.round(at.x - box.x);
        dy = Math.round(at.y - box.y);
      }
    } else {
      const taken = (off: number) =>
        first
          ? page.shapes.some((s) => Math.abs(s.x - first.x - off) < 1 && Math.abs(s.y - first.y - off) < 1)
          : page.connectors.some((c) => !isGlued(c.from) && !!ends[0] && Math.abs(c.from.x - ends[0].x - off) < 1 && Math.abs(c.from.y - ends[0].y - off) < 1);
      for (let i = 0; i < 500 && taken(dx); i++) dx = dy = dx + 24;
    }
    // re-clone so that each paste has fresh ids
    const tmp: Page = { ...page, shapes: content.shapes, connectors: content.connectors, groups: content.groups };
    const copy = cloneItems(tmp, content.shapes.map((s) => s.id), content.connectors.map((c) => c.id), dx, dy);
    // they go to the active layer of this page
    const layer = page.activeLayer;
    const placed = <T extends { layer?: string }>(i: T): T => (layer && !(i.layer && page.layers?.some((l) => l.id === i.layer)) ? { ...i, layer } : i);
    const shapes = copy.shapes.map(placed);
    const connectors = copy.connectors.map(placed);
    this.edit((p) => addItems(p, shapes, connectors, copy.groups));
    this.setSelection(shapes.map((s) => s.id), connectors.map((c) => c.id));
  }
  /** Text from another program: a text box with it. */
  pasteText(text: string, at: { x: number; y: number }): void {
    const clean = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/\n+$/, '').slice(0, 5000);
    if (!clean.trim()) return;
    const lines = clean.split('\n');
    const longest = Math.max(...lines.map((l) => l.length));
    const w = Math.min(480, Math.max(120, longest * 7 + 24));
    const wrapped = lines.reduce((n, l) => n + Math.max(1, Math.ceil((l.length * 7) / (w - 16))), 0);
    const base = createShape('text', 0, 0);
    const h = Math.min(800, Math.max(32, wrapped * 17 + 12));
    this.pasteContent({ shapes: [{ ...base, w, h, x: 0, y: 0, text: clean, font: { ...base.font, align: 'left', valign: 'top' } }], connectors: [] }, { x: at.x - w / 2, y: at.y - h / 2 });
  }

  // ---------- drawing aids

  /** Connects a shape to the one on a side of it, adding it when there is none (or when a shape is chosen). */
  autoConnectFrom(shapeId: string, side: Side, stencil: string | null): void {
    const r = autoConnect(this.basePage, shapeId, side, stencil, { routing: this.routing, startArrow: this.startArrow, endArrow: this.endArrow });
    if (!r) return this.say('Esas dos formas ya están conectadas.');
    this.edit(() => r.page);
    this.setSelection([r.shapeId], []);
    this.revealItem(r.shapeId);
  }
  changeShape(stencil: string): void {
    if (this.selShapes.length) this.edit((p) => changeStencil(p, this.selShapes, stencil));
  }

  /** The format being copied with the format painter. `sticky` keeps it after the first use. */
  painter: { look: Look; sticky: boolean; armed: number } | null = null;
  /** The format kept by «Copiar el formato» for «Pegar el formato». */
  keptLook: Look | null = null;
  private selectedLook(): Look | null {
    const id = this.selShapes[0] ?? this.selConnectors[0];
    return id ? lookOf(this.basePage, id) : null;
  }
  /** Takes the format of the selection; pressed twice in a row it stays until Esc; pressed again it stops. */
  togglePainter(now = Date.now()): void {
    if (this.painter) {
      if (!this.painter.sticky && now - this.painter.armed < 700) this.painter = { ...this.painter, sticky: true };
      else this.painter = null;
    } else {
      const look = this.selectedLook();
      if (!look) return;
      this.painter = { look, sticky: false, armed: now };
      this.tool = 'select';
    }
    this.touch();
  }
  stopPainter(): void {
    if (!this.painter) return;
    this.painter = null;
    this.touch();
  }
  /** Gives the copied format to what was clicked. */
  paint(shapes: string[], connectors: string[]): void {
    const p = this.painter;
    if (!p) return;
    if (!p.sticky) this.painter = null;
    this.edit((q) => applyLook(q, shapes, connectors, p.look));
    this.setSelection(shapes, connectors);
  }
  keepLook(): void {
    this.keptLook = this.selectedLook();
    this.touch();
  }
  pasteLook(): void {
    const look = this.keptLook;
    if (look && this.hasSelection) this.edit((p) => applyLook(p, this.selShapes, this.selConnectors, look));
  }

  // ---------- guides

  selGuide: string | null = null;
  addGuideAt(axis: Guide['axis'], pos: number): string {
    const r = addGuide(this.basePage, axis, pos);
    this.edit(() => r.page);
    return r.guide.id;
  }
  moveGuideTo(id: string, pos: number): void {
    this.edit((p) => moveGuide(p, id, pos));
  }
  removeGuideById(id: string): void {
    if (this.selGuide === id) this.selGuide = null;
    this.edit((p) => removeGuide(p, id));
  }
  clearGuides(): void {
    this.selGuide = null;
    this.edit(({ guides: _g, ...p }) => p);
  }

  // ---------- size and position

  /** Moves, resizes or turns shapes by their centre and size. */
  setBox(ids: string[], patch: Partial<Box>): void {
    this.edit((p) =>
      updateShapes(p, ids.filter((id) => !this.isFrozen(p.shapes.find((s) => s.id === id)!)), (s) => {
        const w = Math.min(20000, Math.max(8, patch.w ?? s.w));
        const h = Math.min(20000, Math.max(8, patch.h ?? s.h));
        const cx = patch.cx ?? s.x + s.w / 2;
        const cy = patch.cy ?? s.y + s.h / 2;
        const rot = patch.rot === undefined ? s.rot : (((patch.rot % 360) + 360) % 360);
        return { x: cx - w / 2, y: cy - h / 2, w, h, rot };
      }),
    );
  }
  duplicate(): void {
    if (!this.hasSelection) return;
    const copy = cloneItems(this.basePage, this.selShapes, this.selConnectors, 24, 24);
    this.edit((p) => addItems(p, copy.shapes, copy.connectors, copy.groups));
    this.setSelection(copy.shapes.map((s) => s.id), copy.connectors.map((c) => c.id));
  }

  // ---------- formatting

  setStyle(patch: Partial<Style>): void {
    const conn: Partial<Connector> = {};
    if (patch.stroke !== undefined && patch.stroke !== 'none') conn.stroke = patch.stroke;
    if (patch.strokeWidth !== undefined && patch.strokeWidth > 0) conn.strokeWidth = patch.strokeWidth;
    if (patch.dash !== undefined) conn.dash = patch.dash;
    this.edit((p) => {
      let q = this.selShapes.length ? styleShapes(p, this.selShapes, patch) : p;
      if (this.selConnectors.length && Object.keys(conn).length) q = updateConnectors(q, this.selConnectors, conn);
      return q;
    });
  }
  setFont(patch: Partial<Font>): void {
    this.edit((p) => {
      let q = this.selShapes.length ? fontShapes(p, this.selShapes, patch) : p;
      if (this.selConnectors.length) q = updateConnectors(q, this.selConnectors, (c) => ({ font: { ...c.font, ...patch } }));
      return q;
    });
  }
  setDash(d: Dash): void {
    this.setStyle({ dash: d });
  }
  setRoutingOf(r: Routing): void {
    this.routing = r;
    if (this.selConnectors.length) this.edit((p) => updateConnectors(p, this.selConnectors, { routing: r }));
    else this.touch();
  }
  setArrow(which: 'start' | 'end', a: Arrow): void {
    if (which === 'start') this.startArrow = a;
    else this.endArrow = a;
    if (this.selConnectors.length) this.edit((p) => updateConnectors(p, this.selConnectors, which === 'start' ? { startArrow: a } : { endArrow: a }));
    else this.touch();
  }
  setText(id: string, text: string): void {
    const p = this.basePage;
    if (p.shapes.some((s) => s.id === id)) {
      if (p.shapes.find((s) => s.id === id)!.text !== text) this.edit((q) => updateShapes(q, [id], { text }));
    } else if (p.connectors.some((c) => c.id === id)) {
      if (p.connectors.find((c) => c.id === id)!.text !== text) this.edit((q) => updateConnectors(q, [id], { text }));
    }
  }
  /** What was typed on a selected shape before its editor opened: it takes the place of the text. */
  editSeed: string | null = null;
  startEditing(id: string | null, seed: string | null = null): void {
    this.editing = id;
    this.editSeed = seed;
    this.touch();
  }
  setLocked(on: boolean): void {
    if (this.selShapes.length) this.edit((p) => updateShapes(p, this.selShapes, { locked: on }));
  }

  // ---------- mirror, link, data, picture

  flip(axis: 'h' | 'v'): void {
    if (this.selShapes.length) this.edit((p) => flipShapes(p, this.selShapes, axis));
  }
  setLink(link: ShapeLink | null): void {
    if (this.selShapes.length) this.edit((p) => setShapeLink(p, this.selShapes, link));
  }
  setData(id: string, data: DataField[]): void {
    this.edit((p) => setShapeData(p, id, data));
  }
  /** Gives every selected shape a data field of that name (those that have it keep their value). */
  addField(field: DataField): void {
    if (this.selShapes.length) this.edit((p) => addDataField(p, this.selShapes, field));
  }
  setImageFit(fit: ShapeImage['fit']): void {
    const ids = this.selectedShapes().filter((s) => s.image).map((s) => s.id);
    if (!ids.length) return;
    this.edit((p) => {
      let q = p;
      for (const s of p.shapes) if (ids.includes(s.id)) q = setShapeImage(q, [s.id], { ...s.image!, fit });
      return q;
    });
  }
  setShowData(on: boolean): void {
    if (this.selShapes.length) this.edit((p) => updateShapes(p, this.selShapes, { showData: on || undefined }));
  }
  /** Puts a picture on the page as a shape of its own, or replaces the picture of the selected image shapes. */
  insertImage(src: string, w: number, h: number, at?: { x: number; y: number }): void {
    const sel = this.selectedShapes().filter((s) => s.stencil === 'image' && !s.locked);
    if (sel.length && !at) {
      this.edit((p) => setShapeImage(p, sel.map((s) => s.id), { src, fit: sel[0]!.image?.fit ?? 'contain' }));
      return;
    }
    const k = Math.min(1, 360 / Math.max(w, h));
    const p0 = this.basePage;
    const n = p0.shapes.length % 8;
    const r = addShape(p0, 'image', at?.x ?? p0.width / 2 + n * 24 - 80, at?.y ?? p0.height / 2 + n * 24 - 80, { w: Math.max(8, Math.round(w * k)), h: Math.max(8, Math.round(h * k)), image: { src, fit: 'contain' } });
    this.commit(updatePage(this.diagram, this.pageId, () => settleContainers(r.page)));
    this.selShapes = [r.shape.id];
    this.selConnectors = [];
    this.touch();
  }
  // ---------- comments

  /** The comment (thread) chosen in the pane, and the message being written there. */
  selComment: string | null = null;
  editingComment: string | null = null;

  /** The comments of the page as shared threads, in the order of the shapes (those on the page itself first). */
  threadList(): Thread<ShapeAnchor>[] {
    const p = this.basePage;
    const order = new Map(p.shapes.map((s, i) => [s.id, i]));
    return sortThreads(toCore(p.threads), (a, b) => (a.shape ? (order.get(a.shape) ?? 1e9) : -1) - (b.shape ? (order.get(b.shape) ?? 1e9) : -1));
  }

  changeThreads(f: (l: Thread<ShapeAnchor>[]) => Thread<ShapeAnchor>[]): void {
    this.edit((p) => {
      const threads = fromCore(f(toCore(p.threads)));
      const { threads: _old, ...rest } = p;
      return threads.length ? { ...rest, threads } : rest;
    });
  }

  /** «Nuevo comentario»: an empty comment on the selected shape (or on the page when none is), written in the pane; sent empty, it is dropped. */
  newComment(): void {
    const shape = this.selectedShapes()[0]?.id;
    const id = newCommentId('c');
    this.changeThreads((l) => addThread(l, { id, anchor: shape ? { shape } : {}, author: getUser(), text: '' }).list);
    this.selComment = id;
    this.editingComment = id;
    this.pane = 'comments';
    this.touch();
  }

  /** The last two changes become one step of undo (an empty comment and the text written in it). */
  mergeLastUndo(): void {
    this.past.splice(this.past.length - 1, 1);
  }

  togglePane(p: 'data' | 'layers' | 'comments' | 'size'): void {
    this.pane = this.pane === p ? 'none' : p;
    this.touch();
  }

  // ---------- arranging

  align(mode: AlignMode): void {
    this.edit((p) => alignShapes(p, this.selShapes, mode));
  }
  distribute(axis: 'h' | 'v'): void {
    this.edit((p) => distributeShapes(p, this.selShapes, axis));
  }
  match(dim: 'w' | 'h' | 'both'): void {
    this.edit((p) => matchSize(p, this.selShapes, dim));
  }
  order(mode: 'front' | 'back' | 'forward' | 'backward'): void {
    this.edit((p) => reorder(p, this.selShapes, mode));
  }
  rotate(deg: number): void {
    this.edit((p) => rotateBy(p, this.selShapes, deg));
  }
  nudge(dx: number, dy: number): void {
    if (!this.hasSelection) return;
    this.edit((p) => moveConnectorEnds(moveShapes(p, withMembers(p, this.selShapes).filter((id) => !this.isFrozen(p.shapes.find((s) => s.id === id)!)), dx, dy), this.selConnectors, dx, dy));
  }

  // ---------- gestures

  /** Show `fn(basePage)` without recording history. */
  previewWith(fn: (p: Page) => Page): void {
    this.preview = fn(this.basePage);
    this.touch();
  }
  endGesture(apply: boolean): void {
    const pv = this.preview;
    this.preview = null;
    if (apply && pv && pv !== this.basePage) this.commit(updatePage(this.diagram, this.pageId, () => settleContainers(pv)));
    else this.touch();
  }

  // ---------- pages

  goToPage(id: string): void {
    if (!this.diagram.pages.some((p) => p.id === id)) return;
    this.pageId = id;
    this.selShapes = [];
    this.selConnectors = [];
    this.selGuide = null;
    this.editing = null;
    this.touch();
  }
  newPage(): void {
    const r = addPage(this.diagram, this.pageId);
    this.commit(r.diagram);
    this.goToPage(r.page.id);
  }
  duplicateCurrentPage(): void {
    const r = duplicatePage(this.diagram, this.pageId);
    if (!r) return;
    this.commit(r.diagram);
    this.goToPage(r.page.id);
  }
  deleteCurrentPage(): void {
    if (this.diagram.pages.length <= 1) return;
    const i = this.diagram.pages.findIndex((p) => p.id === this.pageId);
    const next = this.diagram.pages[i + 1] ?? this.diagram.pages[i - 1]!;
    this.commit(deletePage(this.diagram, this.pageId));
    this.goToPage(next.id);
  }
  moveCurrentPage(dir: -1 | 1): void {
    this.commit(movePage(this.diagram, this.pageId, dir));
  }
  renamePage(id: string, name: string): void {
    const n = name.trim();
    if (!n) return;
    this.commit({ ...this.diagram, pages: this.diagram.pages.map((p) => (p.id === id ? { ...p, name: n } : p)) });
  }
  setPageProps(patch: Partial<Pick<Page, 'name' | 'width' | 'height' | 'grid' | 'background' | 'spread'>>): void {
    this.edit((p) => ({ ...p, ...patch }));
  }
}

export { isGlued };
