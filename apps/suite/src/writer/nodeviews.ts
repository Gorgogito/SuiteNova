import { adjustHandles, dragAdjust, isLineKind, resolveKind, shapeSvg } from '@suitenova/shapes-core';
import { parseMath, scaleGroupContent, toMathML } from '@suitenova/writer-core';
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, TextSelection, type Transaction } from 'prosemirror-state';
import type { Decoration, EditorView, NodeView } from 'prosemirror-view';
import { outerGroupPos, placeCaretFromClick, selectShapeOnly, toggleShapeSelection } from './shape-selection';
import type { WordArtFx } from '@suitenova/wordart-core';
import { renderWordArt, type WordArtSpec } from '../wordart/engine';

let waCounter = 0;

/** `setNodeMarkup` turns a node selection into a text selection; the gestures that change a shape in several steps keep it selected. */
function keepNodeSelected(tr: Transaction, pos: number): Transaction {
  return tr.setSelection(NodeSelection.create(tr.doc, pos));
}

export interface NodeViewHost {
  /** Open a dialog of the application (equation editor, shape format…). */
  openDialog(kind: string, arg?: unknown): void;
  /** Open the pop-up of a drop-down, combo box or date control at this position. */
  openControl(pos: number): void;
  readOnly(): boolean;
  /** Whether the document accepts typing inside controls even when read only (form filling). */
  canFill(): boolean;
}

// ------------------------------------------------------------------------------------------------ equations

export class MathView implements NodeView {
  dom: HTMLElement;
  constructor(private node: PMNode, _view: EditorView, private getPos: () => number | undefined, private host: NodeViewHost) {
    this.dom = document.createElement('span');
    this.dom.className = 'nw-math';
    this.dom.contentEditable = 'false';
    this.render();
    this.dom.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const pos = this.getPos();
      if (pos !== undefined && !this.host.readOnly()) this.host.openDialog('equation', { pos });
    });
  }
  private render() {
    const { tex, display } = this.node.attrs;
    this.dom.dataset.tex = tex;
    this.dom.dataset.display = display ? '1' : '0';
    this.dom.title = tex;
    this.dom.innerHTML = tex.trim() ? toMathML(parseMath(tex), !!display) : '<span style="color:#888">[ecuación]</span>';
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }
  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode');
  }
  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode');
  }
  stopEvent(e: Event) {
    return e.type === 'dblclick';
  }
  ignoreMutation() {
    return true;
  }
}

// ------------------------------------------------------------------------------------------------ shapes

const SVG_NS = 'http://www.w3.org/2000/svg';

export function shapeCss(a: Record<string, any>): string {
  const css = [`width:${a.width}px`, `height:${a.height}px`];
  if (a.wrap === 'left') css.push('float:left', 'margin:0 10px 6px 0');
  else if (a.wrap === 'right') css.push('float:right', 'margin:0 0 6px 10px');
  else if (a.wrap === 'front' || a.wrap === 'behind') css.push('position:absolute', `left:${a.x}px`, `top:${a.y}px`, `z-index:${a.wrap === 'behind' ? 0 : 3}`);
  else if (a.wrap === 'topBottom') css.push('display:block', 'margin:6px auto');
  if (a.rotation) css.push(`transform:rotate(${a.rotation}deg)`);
  return css.join(';');
}

export class ShapeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private svg: SVGSVGElement;
  private paths: SVGGElement;
  private warpSvg: SVGSVGElement;
  private waKey = '';
  private waToken = 0;
  private waSeq = 0;
  private handles: HTMLElement[] = [];
  private adjEls: HTMLElement[] = [];
  private selected = false;
  private grip: HTMLElement;
  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined, private host: NodeViewHost) {
    this.dom = document.createElement('span');
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'nw-shape-bg');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.setAttribute('contenteditable', 'false');
    this.paths = document.createElementNS(SVG_NS, 'g');
    this.svg.appendChild(this.paths);
    this.dom.appendChild(this.svg);
    this.warpSvg = document.createElementNS(SVG_NS, 'svg');
    this.warpSvg.setAttribute('class', 'nw-wordart');
    this.warpSvg.setAttribute('contenteditable', 'false');
    this.warpSvg.setAttribute('aria-hidden', 'true');
    this.dom.appendChild(this.warpSvg);
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'nw-shape-text';
    this.dom.appendChild(this.contentDOM);
    this.grip = document.createElement('span');
    this.grip.className = 'nw-handle nw-grip';
    this.grip.contentEditable = 'false';
    this.grip.title = 'Mover';
    this.grip.style.cssText = 'left:-5px;top:-5px;cursor:move;display:none';
    this.dom.appendChild(this.grip);
    const corners: [string, string, string][] = [['se', 'right:-5px;bottom:-5px', 'nwse-resize'], ['e', 'right:-5px;top:calc(50% - 4px)', 'ew-resize'], ['s', 'left:calc(50% - 4px);bottom:-5px', 'ns-resize']];
    for (const [id, pos, cursor] of corners) {
      const h = document.createElement('span');
      h.className = 'nw-handle';
      h.contentEditable = 'false';
      h.dataset.handle = id;
      h.style.cssText = `${pos};cursor:${cursor};display:none`;
      this.dom.appendChild(h);
      this.handles.push(h);
    }
    this.apply();
    this.bind();
  }
  private apply() {
    const a = this.node.attrs;
    this.dom.className = `nw-shape nw-shape-${a.kind}`;
    this.dom.dataset.kind = a.kind;
    this.dom.dataset.wrap = a.wrap;
    this.dom.setAttribute('style', shapeCss(a));
    // the drawing comes from the common shape catalog, in pixels (the view box is the size of the shape)
    this.svg.setAttribute('viewBox', `0 0 ${a.width} ${a.height}`);
    const invisible = resolveKind(a.kind) === 'textbox' && a.strokeWidth === 0 && a.fill === '#ffffff';
    this.paths.innerHTML = shapeSvg(a.kind, a.width, a.height, { fill: invisible ? null : a.fill, stroke: a.strokeWidth > 0 ? a.stroke : null, strokeWidth: a.strokeWidth, adj: a.adj ?? undefined });
    this.dom.title = a.alt || '';
    this.updateWordArt();
    this.renderAdjust();
  }
  /** The WordArt of the shape: its text drawn with the style and the transform, over the (hidden) plain text. */
  private updateWordArt() {
    const a = this.node.attrs;
    const wa = a.wordart as { fx: WordArtFx; warp: { prst: string; adj?: Record<string, number> } | null } | null;
    const off = () => {
      this.dom.removeAttribute('data-wordart');
      this.warpSvg.innerHTML = '';
      this.waKey = '';
    };
    if (!wa) return off();
    const lines: string[] = [];
    const first: { family?: string; size?: number; bold: boolean; italic: boolean; set: boolean } = { bold: false, italic: false, set: false };
    let align: 'left' | 'center' | 'right' = 'center';
    this.node.forEach((par, _o, i) => {
      lines.push(par.textContent);
      if (i === 0 && (par.attrs.align === 'left' || par.attrs.align === 'right' || par.attrs.align === 'center')) align = par.attrs.align;
      if (!first.set) {
        par.forEach((c) => {
          if (first.set || !c.isText) return;
          for (const m of c.marks) {
            if (m.type.name === 'fontFamily') first.family = String(m.attrs.value);
            else if (m.type.name === 'fontSize') first.size = Number(m.attrs.value);
            else if (m.type.name === 'strong') first.bold = true;
            else if (m.type.name === 'em') first.italic = true;
          }
          first.set = true;
        });
      }
    });
    const spec: WordArtSpec = {
      text: lines.join('\n'),
      family: first.family ?? 'Calibri',
      bold: first.bold,
      italic: first.italic,
      sizePx: ((first.size ?? 36) * 96) / 72,
      align,
      fx: wa.fx,
      warp: wa.warp,
      width: a.width,
      height: a.height,
      id: `nwa${(this.waSeq = this.waSeq || ++waCounter)}`,
    };
    const key = JSON.stringify(spec);
    if (key === this.waKey) return;
    this.waKey = key;
    const token = ++this.waToken;
    void renderWordArt(spec).then((svg) => {
      if (token !== this.waToken) return;
      if (svg === null) return off();
      this.warpSvg.setAttribute('viewBox', `0 0 ${spec.width} ${spec.height}`);
      this.warpSvg.innerHTML = svg;
      this.dom.setAttribute('data-wordart', '1');
    });
  }
  /** The yellow adjust handles of the selected shape (only the shapes of the catalog that have them). */
  private renderAdjust() {
    for (const e of this.adjEls) e.remove();
    this.adjEls = [];
    const a = this.node.attrs;
    if (!this.selected || isLineKind(a.kind)) return;
    adjustHandles(a.kind, a.width, a.height, a.adj ?? {}).forEach((p, i) => {
      const e = document.createElement('span');
      e.className = 'nw-handle nw-adj';
      e.contentEditable = 'false';
      e.dataset.adj = String(i);
      e.title = 'Ajustar la forma';
      e.style.cssText = `left:${p.x - 5}px;top:${p.y - 5}px;cursor:grab`;
      e.addEventListener('pointerdown', (ev) => this.dragAdjust(ev, i));
      this.dom.appendChild(e);
      this.adjEls.push(e);
    });
  }
  private dragAdjust(e: PointerEvent, index: number) {
    e.preventDefault();
    e.stopPropagation();
    const a0 = this.node.attrs;
    const rot = ((a0.rotation || 0) * Math.PI) / 180;
    const move = (ev: PointerEvent) => {
      const p = this.getPos();
      if (p === undefined) return;
      // pointer relative to the centre of the shape, undoing its rotation and the zoom
      const r = this.dom.getBoundingClientRect();
      const scale = this.dom.offsetWidth ? r.width / (Math.abs(Math.cos(rot)) * this.dom.offsetWidth + Math.abs(Math.sin(rot)) * this.dom.offsetHeight) : 1;
      const dx = (ev.clientX - (r.left + r.width / 2)) / scale;
      const dy = (ev.clientY - (r.top + r.height / 2)) / scale;
      const x = dx * Math.cos(rot) + dy * Math.sin(rot) + a0.width / 2;
      const y = -dx * Math.sin(rot) + dy * Math.cos(rot) + a0.height / 2;
      const adj = dragAdjust(a0.kind, a0.width, a0.height, a0.adj ?? {}, index, x, y) ?? null;
      this.view.dispatch(keepNodeSelected(this.view.state.tr.setNodeMarkup(p, undefined, { ...this.node.attrs, adj }), p).setMeta('nw-no-track', true));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  /** Position of the outermost group this shape is inside (`null` when it is not in a group). */
  private groupPos(): number | null {
    const p = this.getPos();
    return p === undefined ? null : outerGroupPos(this.view.state, p);
  }
  private setSelected(on0: boolean) {
    // a shape inside a group has no frame of its own: the group is what gets selected
    const on = on0 && this.groupPos() === null;
    this.dom.classList.toggle('is-selected', on);
    this.selected = on;
    this.renderAdjust();
    const movable = this.node.attrs.wrap === 'front' || this.node.attrs.wrap === 'behind';
    for (const h of this.handles) h.style.display = on ? 'block' : 'none';
    this.grip.style.display = on && movable ? 'block' : 'none';
  }
  private bind() {
    // a click on the frame (not on the text) selects the shape; clicking its text puts the caret inside
    this.dom.addEventListener('mousedown', (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset?.handle || t.dataset?.adj !== undefined || t.classList?.contains('nw-grip')) return;
      const pos = this.getPos();
      if (pos === undefined) return;
      // inside a group the whole group is picked; Ctrl/Shift+click adds or removes it from the selection
      const target = this.groupPos() ?? pos;
      if (e.ctrlKey || e.shiftKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        toggleShapeSelection(this.view, target);
        return;
      }
      if (t === this.dom || t === this.contentDOM || t.closest('svg')) {
        const rect = this.dom.getBoundingClientRect();
        const edge = 8;
        const onEdge = e.clientX - rect.left < edge || rect.right - e.clientX < edge || e.clientY - rect.top < edge || rect.bottom - e.clientY < edge;
        if (onEdge || t.closest('svg')) {
          e.preventDefault();
          if (target !== pos) e.stopPropagation();
          selectShapeOnly(this.view, target);
        }
      }
    });
    // a click in the text of a text box while an object is selected puts the caret there (ProseMirror would leave it outside)
    this.dom.addEventListener('mousedown', (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (!this.contentDOM.contains(t) || !(this.view.state.selection instanceof NodeSelection)) return;
      const at = this.getPos();
      if (at !== undefined && placeCaretFromClick(this.view, e, at, this.node)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    this.dom.addEventListener('dblclick', (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset?.handle) return;
      const pos = this.getPos();
      if (pos !== undefined && this.groupPos() === null && (e.target === this.dom || (e.target as HTMLElement).closest('svg')) && !this.host.readOnly()) this.host.openDialog('shape', { pos });
    });
    const drag = (e: PointerEvent, mode: string) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = this.getPos();
      if (pos === undefined) return;
      const start = { x: e.clientX, y: e.clientY, w: this.node.attrs.width, h: this.node.attrs.height, px: this.node.attrs.x, py: this.node.attrs.y };
      const scale = this.dom.offsetWidth ? this.dom.getBoundingClientRect().width / this.dom.offsetWidth : 1;
      const move = (ev: PointerEvent) => {
        const dx = (ev.clientX - start.x) / scale;
        const dy = (ev.clientY - start.y) / scale;
        const p = this.getPos();
        if (p === undefined) return;
        const patch: Record<string, number> = {};
        if (mode === 'move') {
          patch.x = Math.round(start.px + dx);
          patch.y = Math.round(start.py + dy);
        } else {
          if (mode.includes('e')) patch.width = Math.max(16, Math.round(start.w + dx));
          if (mode.includes('s')) patch.height = Math.max(16, Math.round(start.h + dy));
        }
        this.view.dispatch(keepNodeSelected(this.view.state.tr.setNodeMarkup(p, undefined, { ...this.node.attrs, ...patch }), p).setMeta('nw-no-track', true));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    this.grip.addEventListener('pointerdown', (e) => drag(e, 'move'));
    for (const h of this.handles) h.addEventListener('pointerdown', (e) => drag(e, h.dataset.handle!));
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.apply();
    return true;
  }
  selectNode() {
    this.setSelected(true);
  }
  deselectNode() {
    this.setSelected(false);
  }
  stopEvent(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    if (t.dataset?.handle || t.dataset?.adj !== undefined || t.classList?.contains('nw-grip')) return true;
    if (e.type === 'dblclick' && (t === this.dom || t.closest('svg'))) return true;
    return false;
  }
  ignoreMutation(m: MutationRecord | { type: 'selection' }): boolean {
    if (m.type === 'selection') return false;
    const target = (m as MutationRecord).target as Node;
    return !this.contentDOM.contains(target) || target === this.contentDOM && false;
  }
}

// ------------------------------------------------------------------------------------------------ groups of shapes

/**
 * A group of shapes: one object with a frame (resize, move if it floats, turn) whose children are ordinary shapes drawn inside it.
 * Clicking a child picks the group; the text of a child text box stays editable. Resizing rewrites the children in proportion.
 */
export class GroupView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private handles: HTMLElement[] = [];
  private grip: HTMLElement;
  private rot: HTMLElement;
  private selected = false;
  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined, private host: NodeViewHost) {
    this.dom = document.createElement('span');
    this.contentDOM = document.createElement('span');
    this.contentDOM.className = 'nw-group-content';
    this.dom.appendChild(this.contentDOM);
    this.grip = document.createElement('span');
    this.grip.className = 'nw-handle nw-grip';
    this.grip.contentEditable = 'false';
    this.grip.title = 'Mover';
    this.grip.style.cssText = 'left:-5px;top:-5px;cursor:move;display:none';
    this.dom.appendChild(this.grip);
    const corners: [string, string, string][] = [['se', 'right:-5px;bottom:-5px', 'nwse-resize'], ['e', 'right:-5px;top:calc(50% - 4px)', 'ew-resize'], ['s', 'left:calc(50% - 4px);bottom:-5px', 'ns-resize']];
    for (const [id, pos, cursor] of corners) {
      const h = document.createElement('span');
      h.className = 'nw-handle';
      h.contentEditable = 'false';
      h.dataset.handle = id;
      h.style.cssText = `${pos};cursor:${cursor};display:none`;
      this.dom.appendChild(h);
      this.handles.push(h);
    }
    this.rot = document.createElement('span');
    this.rot.className = 'nw-handle nw-rot';
    this.rot.contentEditable = 'false';
    this.rot.title = 'Girar';
    this.rot.style.cssText = 'left:calc(50% - 5px);top:-26px;cursor:grab;display:none';
    this.dom.appendChild(this.rot);
    this.apply();
    this.bind();
  }
  private apply() {
    const a = this.node.attrs;
    this.dom.className = `nw-shape nw-shape-group${this.selected ? ' is-selected' : ''}`;
    this.dom.dataset.wrap = a.wrap;
    this.dom.setAttribute('style', shapeCss(a));
    this.dom.title = a.alt || '';
  }
  private setSelected(on: boolean) {
    this.selected = on;
    this.dom.classList.toggle('is-selected', on);
    const movable = this.node.attrs.wrap === 'front' || this.node.attrs.wrap === 'behind';
    for (const h of this.handles) h.style.display = on ? 'block' : 'none';
    this.grip.style.display = on && movable ? 'block' : 'none';
    this.rot.style.display = on ? 'block' : 'none';
  }
  private isOwn(t: HTMLElement): boolean {
    return !!(t.dataset?.handle || t.classList?.contains('nw-grip') || t.classList?.contains('nw-rot'));
  }
  private bind() {
    this.dom.addEventListener('mousedown', (e) => {
      const t = e.target as HTMLElement;
      if (this.isOwn(t)) return;
      const pos = this.getPos();
      if (pos === undefined) return;
      // dentro de otro grupo se elige el grupo más externo
      const top = outerGroupPos(this.view.state, pos) ?? pos;
      if (e.ctrlKey || e.shiftKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        toggleShapeSelection(this.view, top);
        return;
      }
      if (t === this.dom) {
        e.preventDefault();
        if (top !== pos) e.stopPropagation();
        selectShapeOnly(this.view, top);
      }
    });
    this.dom.addEventListener('dblclick', (e) => {
      const pos = this.getPos();
      if (pos !== undefined && e.target === this.dom && outerGroupPos(this.view.state, pos) === null && !this.host.readOnly()) this.host.openDialog('shape', { pos });
    });
    const drag = (e: PointerEvent, mode: string) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = this.getPos();
      if (pos === undefined) return;
      const startNode = this.node;
      const start = { x: e.clientX, y: e.clientY, w: startNode.attrs.width as number, h: startNode.attrs.height as number, px: startNode.attrs.x as number, py: startNode.attrs.y as number };
      const scale = this.dom.offsetWidth ? this.dom.getBoundingClientRect().width / this.dom.offsetWidth : 1;
      const move = (ev: PointerEvent) => {
        const p = this.getPos();
        if (p === undefined) return;
        const dx = (ev.clientX - start.x) / scale;
        const dy = (ev.clientY - start.y) / scale;
        if (mode === 'move') {
          this.view.dispatch(keepNodeSelected(this.view.state.tr.setNodeMarkup(p, undefined, { ...this.node.attrs, x: Math.round(start.px + dx), y: Math.round(start.py + dy) }), p).setMeta('nw-no-track', true));
          return;
        }
        const w = mode.includes('e') ? Math.max(16, Math.round(start.w + dx)) : start.w;
        const h = mode.includes('s') ? Math.max(16, Math.round(start.h + dy)) : start.h;
        // siempre se escala desde el grupo del principio del gesto, para no acumular redondeos
        const next = scaleGroupContent(startNode, w, h);
        const tr = this.view.state.tr.replaceWith(p, p + this.node.nodeSize, next);
        tr.setSelection(NodeSelection.create(tr.doc, p)).setMeta('nw-no-track', true);
        this.view.dispatch(tr);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    this.grip.addEventListener('pointerdown', (e) => drag(e, 'move'));
    for (const h of this.handles) h.addEventListener('pointerdown', (e) => drag(e, h.dataset.handle!));
    this.rot.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = this.dom.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const move = (ev: PointerEvent) => {
        const p = this.getPos();
        if (p === undefined) return;
        let a = (Math.atan2(ev.clientX - cx, -(ev.clientY - cy)) * 180) / Math.PI;
        if (ev.shiftKey) a = Math.round(a / 15) * 15;
        const rotation = Math.round((((a % 360) + 360) % 360) * 10) / 10;
        this.view.dispatch(keepNodeSelected(this.view.state.tr.setNodeMarkup(p, undefined, { ...this.node.attrs, rotation }), p).setMeta('nw-no-track', true));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.apply();
    return true;
  }
  selectNode() {
    this.setSelected(true);
  }
  deselectNode() {
    this.setSelected(false);
  }
  stopEvent(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    if (this.isOwn(t)) return true;
    if (e.type === 'dblclick' && t === this.dom) return true;
    return false;
  }
  ignoreMutation(m: MutationRecord | { type: 'selection' }): boolean {
    if (m.type === 'selection') return false;
    return !this.contentDOM.contains((m as MutationRecord).target as Node);
  }
}

// ------------------------------------------------------------------------------------------------ content controls

export class ControlView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined, private host: NodeViewHost) {
    this.dom = document.createElement('span');
    this.contentDOM = this.dom;
    this.apply();
    this.dom.addEventListener('mousedown', (e) => {
      const a = this.node.attrs;
      const pos = this.getPos();
      if (pos === undefined) return;
      if (a.type === 'checkbox') {
        e.preventDefault();
        if (this.host.readOnly() && !this.host.canFill()) return;
        const checked = !a.checked;
        const tr = this.view.state.tr;
        // the symbol inside is the visible state of the box
        tr.replaceWith(pos + 1, pos + 1 + this.node.content.size, this.view.state.schema.text(checked ? '☒' : '☐'));
        tr.setNodeMarkup(pos, undefined, { ...a, checked, showing: false });
        this.view.dispatch(tr.setMeta('nw-form', true).setMeta('nw-no-track', true));
      } else if (a.type === 'dropdown' || a.type === 'combo' || a.type === 'date') {
        if (a.type === 'dropdown' || a.type === 'date') e.preventDefault();
        if (this.host.readOnly() && !this.host.canFill()) return;
        this.host.openControl(pos);
      } else if (a.showing) {
        // the first click on a placeholder selects all of it, so that typing replaces it
        e.preventDefault();
        const from = pos + 1;
        const to = pos + 1 + this.node.content.size;
        this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, from, to)));
        this.view.focus();
      }
    });
  }
  private apply() {
    const a = this.node.attrs;
    this.dom.className = `nw-cc nw-cc-${a.type}${a.showing ? ' nw-cc-empty' : ''}`;
    this.dom.dataset.type = a.type;
    this.dom.dataset.tag = a.tag;
    this.dom.title = a.title;
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.apply();
    return true;
  }
  stopEvent(e: Event): boolean {
    return e.type === 'mousedown' && (this.node.attrs.type === 'checkbox' || this.node.attrs.type === 'dropdown' || this.node.attrs.type === 'date');
  }
}

// ------------------------------------------------------------------------------------------------ fields

/**
 * A field drawn from its spec, except that merge fields show the value of the record being previewed when the mail merge
 * preview is on (the value comes in a node decoration, so the document itself is never touched).
 */
export class FieldView implements NodeView {
  dom: HTMLElement;
  private node: PMNode;
  constructor(node: PMNode, decos: readonly Decoration[]) {
    this.node = node;
    this.dom = document.createElement('span');
    this.draw(decos);
  }
  private draw(decos: readonly Decoration[]) {
    const pv = (decos.map((d) => (d.spec as { pv?: string } | undefined)?.pv).find((v) => v !== undefined) as string | undefined) ?? null;
    const spec = this.node.type.spec.toDOM!(this.node) as [string, Record<string, string>, ...unknown[]];
    const attrs = spec[1] ?? {};
    for (const a of [...this.dom.attributes]) if (a.name !== 'class' || !attrs.class) this.dom.removeAttribute(a.name);
    for (const [k, v] of Object.entries(attrs)) this.dom.setAttribute(k, v);
    this.dom.classList.toggle('nw-merge-pv', pv !== null);
    this.dom.textContent = pv ?? String(spec[2] ?? '');
  }
  update(node: PMNode, decos: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.draw(decos);
    return true;
  }
  ignoreMutation(): boolean {
    return true;
  }
}
