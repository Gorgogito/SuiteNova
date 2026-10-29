import { autoLayout, resetPorts, type LayoutDir, type LayoutKind } from '@suitenova/diagram-core';
import { addLane, layersOf as layersOfPage, removeLane, renameLane, resizeLane, setContainerProps, settleContainers, withMembers, wrapInContainer } from '@suitenova/diagram-core';
import {
  addConnector, addDataField, addItems, addLayer, addPage, assignLayer, expandSelection, groupShapes, isItemLocked, isItemVisible, moveLayer, removeLayer, setActiveLayer, ungroupShapes, updateLayer, flipShapes, setShapeData, setShapeImage, setShapeLink, addShape, alignShapes, cloneItems, deleteItems, deletePage, distributeShapes, duplicatePage, fontShapes, isGlued, matchSize, moveConnectorEnds, moveShapes, movePage, newConnector, newDiagram, reorder, rotateBy,
  styleShapes, updateConnectors, updatePage, updateShapes, type AlignMode, type Arrow, type Group, type Layer, type DataField, type ShapeImage, type ShapeLink, type Connector, type Diagram, type Dash, type End, type Font, type Page, type Routing, type Shape, type Style,
} from '@suitenova/diagram-core';

const MAX_UNDO = 100;

export type Tool = 'select' | 'connector';

export interface Clip {
  shapes: Shape[];
  connectors: Connector[];
  groups?: Group[];
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
  pane: 'none' | 'data' | 'layers' = 'none';
  private pasteCount = 0;
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
    return `${this.fileName ?? this.diagram.name}${this.dirty ? ' •' : ''}`;
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
  undo(): void {
    const d = this.past.pop();
    if (!d) return;
    this.future.push(this.diagram);
    this.restore(d);
  }
  redo(): void {
    const d = this.future.pop();
    if (!d) return;
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

  load(d: Diagram, name: string | null, path: string | null): void {
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
    this.message = '';
    this.touch();
  }
  reset(): void {
    this.load(newDiagram(), null, null);
  }
  markSaved(name: string, path: string | null): void {
    this.fileName = name;
    this.filePath = path;
    this.dirty = false;
    this.touch();
  }

  // ---------- selection

  setSelection(shapes: string[], connectors: string[] = []): void {
    this.selShapes = shapes;
    this.selConnectors = connectors;
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
    this.pasteCount = 0;
    this.touch();
  }
  cut(): void {
    this.copy();
    this.deleteSelection();
  }
  get canPaste(): boolean {
    return !!this.clip && this.clip.shapes.length + this.clip.connectors.length > 0;
  }
  paste(): void {
    if (!this.clip) return;
    this.pasteCount++;
    const off = 24 * this.pasteCount;
    // re-clone so that each paste has fresh ids
    const tmp: Page = { ...this.basePage, shapes: this.clip.shapes, connectors: this.clip.connectors, groups: this.clip.groups };
    const copy = cloneItems(tmp, this.clip.shapes.map((s) => s.id), this.clip.connectors.map((c) => c.id), off, off);
    this.edit((p) => addItems(p, copy.shapes, copy.connectors, copy.groups));
    this.setSelection(copy.shapes.map((s) => s.id), copy.connectors.map((c) => c.id));
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
  startEditing(id: string | null): void {
    this.editing = id;
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
      for (const s of p.shapes) if (ids.includes(s.id)) q = setShapeImage(q, [s.id], { src: s.image!.src, fit });
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
  togglePane(p: 'data' | 'layers'): void {
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
