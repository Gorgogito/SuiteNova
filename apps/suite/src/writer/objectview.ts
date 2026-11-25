import { CHART_COLORS, chart3dFor, chartAreaCss, chartData, chartOption, echarts, gridSource, is3D, type ChartGrid, type ChartSpec } from '@suitenova/chart-core';
import { DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import { seriesColors, type DocTheme } from '@suitenova/theme-core';
import { NodeSelection, Plugin, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView, type NodeView } from 'prosemirror-view';

/*
 * Los gráficos y los SmartArt de Writer como objetos: se eligen con un clic, se cambian de tamaño con ocho tiradores y, si flotan
 * (delante o detrás del texto), se mueven arrastrándolos. El gráfico se dibuja vivo (con la información emergente al pasar el ratón);
 * el SmartArt es la imagen de su dibujo. El `toDOM` del esquema sigue siendo la fuente del aspecto (tamaño, ajuste y posición).
 */

const HANDLES: [string, string, string][] = [
  ['nw', 'left:-5px;top:-5px', 'nwse-resize'],
  ['n', 'left:calc(50% - 4px);top:-5px', 'ns-resize'],
  ['ne', 'right:-5px;top:-5px', 'nesw-resize'],
  ['e', 'right:-5px;top:calc(50% - 4px)', 'ew-resize'],
  ['se', 'right:-5px;bottom:-5px', 'nwse-resize'],
  ['s', 'left:calc(50% - 4px);bottom:-5px', 'ns-resize'],
  ['sw', 'left:-5px;bottom:-5px', 'nesw-resize'],
  ['w', 'left:-5px;top:calc(50% - 4px)', 'ew-resize'],
];
const MIN = 40;
/** The charts follow the theme of the document: the series without a colour of their own take its accents (this plugin makes the chart views paint again when the theme changes). */
export function chartThemePlugin(): Plugin {
  return new Plugin({
    props: {
      decorations: (state) => {
        const th = state.doc.attrs.theme as DocTheme | null;
        if (!th) return null;
        const decos: Decoration[] = [];
        state.doc.descendants((n, pos) => {
          if (n.type.name === 'chart') decos.push(Decoration.node(pos, pos + n.nodeSize, { 'data-theme': seriesColors(th, 6).join('') }));
          return true;
        });
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

const PALETTE = { text: '#333333', grid: '#dddddd', bg: '#ffffff' };

const keepSelected = (tr: Transaction, pos: number): Transaction => tr.setSelection(NodeSelection.create(tr.doc, pos)).setMeta('nw-no-track', true);

export class ObjectView implements NodeView {
  dom: HTMLElement;
  private handles: HTMLElement[] = [];
  private live: HTMLElement | null = null;
  private inst: echarts.ECharts | null = null;
  private liveKey = '';
  private selected = false;

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    this.dom = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node)).dom as HTMLElement;
    this.dom.contentEditable = 'false';
    for (const [id, pos, cursor] of HANDLES) {
      const h = document.createElement('span');
      h.className = 'nw-handle';
      h.contentEditable = 'false';
      h.dataset.handle = id;
      h.style.cssText = `${pos};cursor:${cursor};display:none`;
      this.dom.appendChild(h);
      this.handles.push(h);
      h.addEventListener('pointerdown', (e) => this.drag(e, id));
    }
    // un objeto que flota se mueve arrastrándolo
    this.dom.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset?.handle || e.button !== 0) return;
      const w = this.node.attrs.wrap;
      if ((w === 'front' || w === 'behind') && this.selected) this.drag(e, 'move');
    });
    this.paint();
  }

  /** Vuelve a poner el aspecto del esquema y, en un gráfico, lo dibuja vivo. */
  private paint() {
    const fresh = DOMSerializer.renderSpec(document, this.node.type.spec.toDOM!(this.node)).dom as HTMLElement;
    this.dom.className = fresh.className;
    this.dom.setAttribute('style', fresh.getAttribute('style') ?? '');
    this.dom.setAttribute('data-wrap', fresh.getAttribute('data-wrap') ?? '');
    this.dom.title = fresh.title;
    if (this.node.type.name === 'chart') this.paintChart();
    else {
      const img = this.dom.querySelector('img');
      const next = fresh.querySelector('img');
      if (img && next) {
        img.src = next.src;
        img.alt = next.alt;
      } else if (next) this.dom.insertBefore(next, this.dom.firstChild);
    }
  }

  private paintChart() {
    const a = this.node.attrs;
    const spec = a.chart as ChartSpec | null;
    const grid = a.grid as ChartGrid | null;
    const w = Number(a.width) || 480;
    const h = Number(a.height) || 288;
    this.dom.querySelector('img')?.remove();
    if (!spec || !grid) return;
    Object.assign(this.dom.style, chartAreaCss(spec));
    if (!this.live) {
      this.live = document.createElement('div');
      this.live.className = 'nw-chart__live';
      this.live.style.cssText = 'width:100%;height:100%';
      this.live.contentEditable = 'false';
      this.dom.insertBefore(this.live, this.dom.firstChild);
    }
    const theme = this.view.state.doc.attrs.theme as DocTheme | null;
    const accents = theme ? seriesColors(theme) : CHART_COLORS;
    const key = JSON.stringify([spec, grid, w, h, accents]);
    if (key === this.liveKey) return;
    this.liveKey = key;
    const colored: ChartSpec = { ...spec, series: spec.series.map((s, i) => ({ ...s, color: s.color ?? accents[i % accents.length] })) };
    const data = chartData(colored, gridSource(grid), 'es');
    if (is3D(colored)) {
      this.inst?.dispose();
      this.inst = null;
      this.live.innerHTML = chart3dFor(colored, data, PALETTE, w, h);
      return;
    }
    if (!this.inst) {
      this.live.innerHTML = '';
      this.inst = echarts.init(this.live, undefined, { renderer: 'canvas', width: w, height: h });
    }
    this.inst.resize({ width: w, height: h });
    this.inst.setOption(chartOption(colored, data, 'es', PALETTE), true);
  }

  private drag(e: PointerEvent, mode: string) {
    e.preventDefault();
    e.stopPropagation();
    const pos = this.getPos();
    if (pos === undefined) return;
    const a0 = this.node.attrs;
    const start = { x: e.clientX, y: e.clientY, w: Number(a0.width), h: Number(a0.height), px: Number(a0.x ?? 0), py: Number(a0.y ?? 0) };
    const scale = this.dom.offsetWidth ? this.dom.getBoundingClientRect().width / this.dom.offsetWidth : 1;
    const floats = a0.wrap === 'front' || a0.wrap === 'behind';
    let moved = mode !== 'move';
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / scale;
      const dy = (ev.clientY - start.y) / scale;
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
      moved = true;
      const p = this.getPos();
      if (p === undefined) return;
      const patch: Record<string, number> = {};
      if (mode === 'move') {
        patch.x = Math.round(start.px + dx);
        patch.y = Math.round(start.py + dy);
      } else {
        if (mode.includes('e')) patch.width = Math.max(MIN, Math.round(start.w + dx));
        if (mode.includes('w')) {
          patch.width = Math.max(MIN, Math.round(start.w - dx));
          if (floats) patch.x = Math.round(start.px + (start.w - patch.width));
        }
        if (mode.includes('s')) patch.height = Math.max(MIN, Math.round(start.h + dy));
        if (mode.includes('n')) {
          patch.height = Math.max(MIN, Math.round(start.h - dy));
          if (floats) patch.y = Math.round(start.py + (start.h - patch.height));
        }
      }
      this.view.dispatch(keepSelected(this.view.state.tr.setNodeMarkup(p, undefined, { ...this.node.attrs, ...patch }), p));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.paint();
    return true;
  }
  selectNode() {
    this.selected = true;
    this.dom.classList.add('ProseMirror-selectednode');
    for (const h of this.handles) h.style.display = 'block';
  }
  deselectNode() {
    this.selected = false;
    this.dom.classList.remove('ProseMirror-selectednode');
    for (const h of this.handles) h.style.display = 'none';
  }
  stopEvent(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t?.dataset?.handle;
  }
  ignoreMutation(): boolean {
    return true;
  }
  destroy() {
    this.inst?.dispose();
    this.inst = null;
  }
}
