import { parseMath, toMathML } from '@suitenova/writer-core';
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import type { Decoration, EditorView, NodeView } from 'prosemirror-view';

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

/** The drawing of each kind of shape in a 100 x 100 box (stretched to the size of the shape). */
export const SHAPE_PATHS: Record<string, string> = {
  rect: 'M0 0H100V100H0Z',
  textbox: 'M0 0H100V100H0Z',
  roundRect: 'M14 0H86Q100 0 100 14V86Q100 100 86 100H14Q0 100 0 86V14Q0 0 14 0Z',
  ellipse: 'M50 0A50 50 0 1 1 49.99 0Z',
  triangle: 'M50 0L100 100H0Z',
  rightTriangle: 'M0 0L100 100H0Z',
  diamond: 'M50 0L100 50L50 100L0 50Z',
  pentagon: 'M50 0L100 38L81 100H19L0 38Z',
  hexagon: 'M25 0H75L100 50L75 100H25L0 50Z',
  star5: 'M50 0L61 35H98L68 57L79 92L50 71L21 92L32 57L2 35H39Z',
  rightArrow: 'M0 30H62V0L100 50L62 100V70H0Z',
  leftArrow: 'M100 30H38V0L0 50L38 100V70H100Z',
  upArrow: 'M30 100V38H0L50 0L100 38H70V100Z',
  downArrow: 'M30 0V62H0L50 100L100 62H70V0Z',
  line: 'M0 100L100 0',
  callout: 'M0 0H100V75H40L18 100V75H0Z',
  cloud: 'M25 80Q0 80 5 55Q0 30 25 30Q30 5 55 12Q75 0 85 25Q105 35 92 58Q100 80 75 80Z',
  heart: 'M50 95L8 52Q-8 28 15 12Q35 0 50 22Q65 0 85 12Q108 28 92 52Z',
};

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
  private path: SVGPathElement;
  private handles: HTMLElement[] = [];
  private grip: HTMLElement;
  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined, private host: NodeViewHost) {
    this.dom = document.createElement('span');
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'nw-shape-bg');
    this.svg.setAttribute('viewBox', '0 0 100 100');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.setAttribute('contenteditable', 'false');
    this.path = document.createElementNS(SVG_NS, 'path');
    this.path.setAttribute('vector-effect', 'non-scaling-stroke');
    this.svg.appendChild(this.path);
    this.dom.appendChild(this.svg);
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
    this.path.setAttribute('d', SHAPE_PATHS[a.kind] ?? SHAPE_PATHS.rect!);
    const invisible = a.kind === 'textbox' && a.strokeWidth === 0 && a.fill === '#ffffff';
    this.path.setAttribute('fill', a.kind === 'line' || invisible ? 'none' : a.fill);
    this.path.setAttribute('stroke', a.strokeWidth > 0 ? a.stroke : 'none');
    this.path.setAttribute('stroke-width', String(a.strokeWidth));
    this.dom.title = a.alt || '';
  }
  private setSelected(on: boolean) {
    this.dom.classList.toggle('is-selected', on);
    const movable = this.node.attrs.wrap === 'front' || this.node.attrs.wrap === 'behind';
    for (const h of this.handles) h.style.display = on ? 'block' : 'none';
    this.grip.style.display = on && movable ? 'block' : 'none';
  }
  private bind() {
    // a click on the frame (not on the text) selects the shape; clicking its text puts the caret inside
    this.dom.addEventListener('mousedown', (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset?.handle || t.classList?.contains('nw-grip')) return;
      const pos = this.getPos();
      if (pos === undefined) return;
      if (t === this.dom || t === this.contentDOM || t.closest('svg')) {
        const rect = this.dom.getBoundingClientRect();
        const edge = 8;
        const onEdge = e.clientX - rect.left < edge || rect.right - e.clientX < edge || e.clientY - rect.top < edge || rect.bottom - e.clientY < edge;
        if (onEdge || t.closest('svg')) {
          e.preventDefault();
          this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
          this.view.focus();
        }
      }
    });
    this.dom.addEventListener('dblclick', (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset?.handle) return;
      const pos = this.getPos();
      if (pos !== undefined && (e.target === this.dom || (e.target as HTMLElement).closest('svg')) && !this.host.readOnly()) this.host.openDialog('shape', { pos });
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
        this.view.dispatch(this.view.state.tr.setNodeMarkup(p, undefined, { ...this.node.attrs, ...patch }).setMeta('nw-no-track', true));
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
    if (t.dataset?.handle || t.classList?.contains('nw-grip')) return true;
    if (e.type === 'dblclick' && (t === this.dom || t.closest('svg'))) return true;
    return false;
  }
  ignoreMutation(m: MutationRecord | { type: 'selection' }): boolean {
    if (m.type === 'selection') return false;
    const target = (m as MutationRecord).target as Node;
    return !this.contentDOM.contains(target) || target === this.contentDOM && false;
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
