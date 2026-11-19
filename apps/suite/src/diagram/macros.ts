import type { LibraryId } from '../macros/security';
import { basic } from '@suitenova/base-core';
import { STENCILS, addConnector, addPage, addShape, centerOf, deleteItems, deletePage, newConnector, reorder, stencilOf, type Connector, type Page, type Shape } from '@suitenova/diagram-core';
import '../macros/messages';
import { collection, makeObject, type ParamTable } from '../macros/objects';
import { MacroRuntime, type MacroRun } from '../macros/runtime';
import type { DiagramCtl } from './ctl';

type BVal = basic.BVal;
type BObject = basic.BObject;
const { BasicError, toNum, toStr } = basic;

export type { MacroRun };

/** The constants of the Visio object model that macros use, by lower-case name. */
export const VISIO_CONSTANTS: Record<string, number> = {
  visdeselect: 1, visselect: 2, visselectall: 4, vissubselect: 3,
  visautoconnectdirnone: 0, visautoconnectdirdown: 1, visautoconnectdirright: 2,
  vbblack: 0, vbred: 255, vbgreen: 65280, vbblue: 16711680, vbwhite: 16777215,
};

const PARAMS: ParamTable = { drop: ['objecttodrop', 'xpos', 'ypos'], drawrectangle: ['x1', 'y1', 'x2', 'y2'], drawoval: ['x1', 'y1', 'x2', 'y2'], drawline: ['x1', 'y1', 'x2', 'y2'], autoconnect: ['toshape', 'placementdir'], itemu: ['name'], select: ['objecttoselect', 'selectionmode'] };

/** A colour `#rrggbb` ↔ the number of a VBA colour (`RGB(r, g, b)` = r + g·256 + b·65536). */
export const hexToVb = (hex: string): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1]!, 16);
  return ((n >> 16) & 255) + (n & 0xff00) + ((n & 255) << 16);
};
export const vbToHex = (v: number): string => {
  const n = Math.max(0, Math.min(0xffffff, Math.trunc(v)));
  const h = (x: number) => x.toString(16).padStart(2, '0');
  return `#${h(n & 255)}${h((n >> 8) & 255)}${h((n >> 16) & 255)}`;
};
/** What a colour cell accepts: a VBA colour number or the text `RGB(r, g, b)`. */
function parseColour(v: BVal): string {
  if (typeof v === 'number') return vbToHex(v);
  const s = toStr(v).trim();
  const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(s);
  if (m) return vbToHex(Number(m[1]) + Number(m[2]) * 256 + Number(m[3]) * 65536);
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  throw new BasicError(13, `Color no válido: ${s}`);
}

/** Runs the macros of a diagram: Nova Basic with the objects of Visio (Application, Document, Page, Shape, Cells…). */
export class DiagramRuntime extends MacroRuntime {
  constructor(readonly ctl: DiagramCtl) {
    super();
  }
  get libraryId(): LibraryId | undefined {
    return 'diagram';
  }
  get modules(): { name: string; code: string }[] {
    return this.ctl.macros;
  }
  protected enabled(): boolean {
    return this.ctl.contentEnabled;
  }
  protected changed(): void {
    this.ctl.touch();
  }
  protected hostObjects(): Record<string, BVal> {
    return { ...VISIO_CONSTANTS, ...this.objects() };
  }

  /** Everything a macro does is one step of the history. */
  protected guarded(fn: () => MacroRun): MacroRun {
    if (++this.depth > 20) {
      this.depth--;
      return { ok: false, error: 'Demasiadas llamadas anidadas.' };
    }
    let result: MacroRun = { ok: true };
    try {
      if (this.depth === 1) this.ctl.undoGroup(() => (result = fn()));
      else result = fn();
    } catch (e) {
      result = this.report(e);
      this.lastAt = result.at;
    } finally {
      this.depth--;
    }
    this.ctl.touch();
    return result;
  }

  private objects(): Record<string, BVal> {
    const ctl = this.ctl;
    const make = (def: Parameters<typeof makeObject>[0]) => makeObject(def, PARAMS);
    const err = (msg: string, n = 5): never => {
      throw new BasicError(n, msg);
    };
    /** The page a macro works on is the one shown, or the one `ActiveWindow.Page` chose. */
    const pageById = (id: string): Page => ctl.diagram.pages.find((p) => p.id === id) ?? err('La página ya no existe.', 91);
    const edit = (id: string, fn: (p: Page) => Page) => {
      if (id === ctl.pageId) ctl.edit(fn);
      else ctl.commit({ ...ctl.diagram, pages: ctl.diagram.pages.map((p) => (p.id === id ? fn(p) : p)) });
    };

    /** The shapes and then the connectors of a page, in that order: the index of `Shapes(n)`. */
    type Item = { kind: 'shape'; id: string } | { kind: 'conn'; id: string };
    const itemsOf = (pid: string): Item[] => {
      const p = pageById(pid);
      return [...p.shapes.map((s): Item => ({ kind: 'shape', id: s.id })), ...p.connectors.map((c): Item => ({ kind: 'conn', id: c.id }))];
    };
    const nameOfItem = (pid: string, it: Item): string => {
      const i = itemsOf(pid).findIndex((x) => x.id === it.id) + 1;
      if (it.kind === 'conn') return `Conector.${i}`;
      const s = pageById(pid).shapes.find((x) => x.id === it.id);
      return `${s ? stencilOf(s.stencil).name : 'Forma'}.${i}`;
    };

    const cell = (pid: string, it: Item, name: string): BObject => {
      const key = name.toLowerCase();
      const shape = (): Shape => pageById(pid).shapes.find((s) => s.id === it.id) ?? err('La forma ya no existe.', 91);
      const conn = (): Connector => pageById(pid).connectors.find((c) => c.id === it.id) ?? err('El conector ya no existe.', 91);
      const patch = (p: Partial<Shape>) => edit(pid, (pg) => ({ ...pg, shapes: pg.shapes.map((s) => (s.id === it.id ? { ...s, ...p } : s)) }));
      let get: () => BVal;
      let set: ((v: BVal) => void) | undefined;
      let text: (() => string) | undefined;
      const num = (g: () => number, s?: (n: number) => void) => {
        get = g;
        if (s) set = (v) => s(toNum(v));
      };
      const prop = /^prop\.(.+)$/i.exec(name);
      if (prop) {
        const field = prop[1]!;
        if (it.kind !== 'shape') err('Un conector no tiene datos de forma.');
        const find = () => shape().data?.find((d) => d.name.toLowerCase() === field.toLowerCase());
        get = () => find()?.value ?? '';
        text = () => find()?.value ?? '';
        set = (v) =>
          patch({
            data: find()
              ? shape().data!.map((d) => (d.name.toLowerCase() === field.toLowerCase() ? { ...d, value: toStr(v) } : d))
              : [...(shape().data ?? []), { name: field, value: toStr(v) }],
          });
      } else if (it.kind === 'conn') {
        if (key === 'lineweight') num(() => conn().strokeWidth, (n) => edit(pid, (pg) => ({ ...pg, connectors: pg.connectors.map((c) => (c.id === it.id ? { ...c, strokeWidth: Math.max(0, n) } : c)) })));
        else if (key === 'linecolor') {
          get = () => hexToVb(conn().stroke);
          set = (v) => edit(pid, (pg) => ({ ...pg, connectors: pg.connectors.map((c) => (c.id === it.id ? { ...c, stroke: parseColour(v) } : c)) }));
        } else err(`Un conector no admite la celda «${name}».`, 438);
      } else {
        switch (key) {
          case 'pinx':
            num(() => centerOf(shape()).x, (n) => patch({ x: n - shape().w / 2 }));
            break;
          case 'piny':
            num(() => centerOf(shape()).y, (n) => patch({ y: n - shape().h / 2 }));
            break;
          case 'width':
            num(() => shape().w, (n) => patch({ x: centerOf(shape()).x - Math.max(1, n) / 2, w: Math.max(1, n) }));
            break;
          case 'height':
            num(() => shape().h, (n) => patch({ y: centerOf(shape()).y - Math.max(1, n) / 2, h: Math.max(1, n) }));
            break;
          case 'angle':
            num(() => shape().rot, (n) => patch({ rot: ((n % 360) + 360) % 360 }));
            break;
          case 'lineweight':
            num(() => shape().style.strokeWidth, (n) => patch({ style: { ...shape().style, strokeWidth: Math.max(0, n) } }));
            break;
          case 'fillforegnd':
            get = () => (shape().style.fill === 'none' ? -1 : hexToVb(shape().style.fill));
            set = (v) => patch({ style: { ...shape().style, fill: parseColour(v) } });
            break;
          case 'linecolor':
            get = () => (shape().style.stroke === 'none' ? -1 : hexToVb(shape().style.stroke));
            set = (v) => patch({ style: { ...shape().style, stroke: parseColour(v) } });
            break;
          case 'char.size':
            num(() => shape().font.size, (n) => patch({ font: { ...shape().font, size: Math.max(1, n) } }));
            break;
          default:
            err(`La forma no admite la celda «${name}».`, 438);
        }
      }
      const value = (): BVal => get!();
      const setter = (v: BVal) => (set ? set(v) : err(`La celda «${name}» es de solo lectura.`, 424));
      return make({
        type: 'Cell',
        props: {
          resultiu: { get: value, set: setter },
          result: { get: value, set: setter },
          formulau: { get: () => (text ? text() : String(value())), set: setter },
          formula: { get: () => (text ? text() : String(value())), set: setter },
        },
        methods: { resultstr: () => (text ? text() : String(value())) },
        // `Result("")` and `ResultStr("")` take a unit: it is ignored (the units are pixels)
        index: () => value(),
      });
    };

    const item = (pid: string, it: Item): BObject => {
      const shape = (): Shape => pageById(pid).shapes.find((s) => s.id === it.id) ?? err('La forma ya no existe.', 91);
      const conn = (): Connector => pageById(pid).connectors.find((c) => c.id === it.id) ?? err('El conector ya no existe.', 91);
      const exists = () => (it.kind === 'shape' ? pageById(pid).shapes.some((s) => s.id === it.id) : pageById(pid).connectors.some((c) => c.id === it.id));
      const must = () => (exists() ? undefined : err('La forma ya no existe.', 91));
      return make({
        type: it.kind === 'shape' ? 'Shape' : 'Connector',
        props: {
          id: { get: () => (must(), itemsOf(pid).findIndex((x) => x.id === it.id) + 1) },
          name: { get: () => (must(), nameOfItem(pid, it)) },
          master: { get: () => (must(), it.kind === 'shape' ? stencilOf(shape().stencil).name : undefined) },
          text: {
            get: () => (must(), it.kind === 'shape' ? shape().text : conn().text),
            set: (v) =>
              edit(pid, (pg) =>
                it.kind === 'shape' ? { ...pg, shapes: pg.shapes.map((s) => (s.id === it.id ? { ...s, text: toStr(v) } : s)) } : { ...pg, connectors: pg.connectors.map((c) => (c.id === it.id ? { ...c, text: toStr(v) } : c)) },
              ),
          },
          oned: { get: () => (it.kind === 'conn' ? -1 : 0) },
          page: { get: () => pageObject(pid) },
        },
        methods: {
          cells: (a) => (must(), cell(pid, it, toStr(a[0]))),
          cellsu: (a) => (must(), cell(pid, it, toStr(a[0]))),
          delete: () => {
            must();
            edit(pid, (pg) => (it.kind === 'shape' ? deleteItems(pg, [it.id], []) : deleteItems(pg, [], [it.id])));
            return undefined;
          },
          bringtofront: () => {
            if (it.kind === 'shape') edit(pid, (pg) => reorder(pg, [it.id], 'front'));
            return undefined;
          },
          sendtoback: () => {
            if (it.kind === 'shape') edit(pid, (pg) => reorder(pg, [it.id], 'back'));
            return undefined;
          },
          select: () => {
            must();
            if (pid !== ctl.pageId) err('La forma no está en la página que se ve.');
            if (it.kind === 'shape') ctl.selShapes = [it.id];
            else ctl.selConnectors = [it.id];
            if (it.kind === 'shape') ctl.selConnectors = [];
            else ctl.selShapes = [];
            return undefined;
          },
          autoconnect: (a) => {
            if (it.kind !== 'shape') err('Solo una forma se puede conectar.');
            const to = (a[0] as BObject | undefined)?.get('id', []);
            const target = typeof to === 'number' ? itemsOf(pid)[to - 1] : undefined;
            if (!target || target.kind !== 'shape') err('Indica la forma a la que se conecta.');
            edit(pid, (pg) => addConnector(pg, newConnector({ shape: it.id, port: 'auto' }, { shape: target!.id, port: 'auto' }, { routing: ctl.routing, endArrow: ctl.endArrow, startArrow: ctl.startArrow })));
            return undefined;
          },
        },
      });
    };

    const shapesOf = (pid: string): BObject => {
      const list = () => itemsOf(pid).map((it) => item(pid, it));
      const base = collection('Shapes', list, (o) => toStr(o.get('name', [])));
      const dropped = (pg: (p: Page) => { page: Page; shape: Shape }): BObject => {
        let made: Shape | undefined;
        edit(pid, (p) => {
          const r = pg(p);
          made = r.shape;
          return r.page;
        });
        return item(pid, { kind: 'shape', id: made!.id });
      };
      const stencilFor = (v: BVal): string => {
        const name = v && typeof v === 'object' && 'typeName' in v ? toStr((v as BObject).get('name', [])) : toStr(v);
        const hit = STENCILS.find((s) => s.name.toLowerCase() === name.toLowerCase() || s.id.toLowerCase() === name.toLowerCase());
        return hit ? hit.id : err(`No se encuentra la forma «${name}» entre las formas del diagrama.`, 9);
      };
      const drop = (a: BVal[]): BObject => {
        const id = stencilFor(a[0]!);
        const cx = toNum(a[1]!);
        const cy = toNum(a[2]!);
        // a macro puts the shape exactly where it says, not on the nearest grid point
        return dropped((p) => {
          const r = addShape(p, id, cx, cy);
          const s = { ...r.shape, x: cx - r.shape.w / 2, y: cy - r.shape.h / 2 };
          return { page: { ...r.page, shapes: r.page.shapes.map((x) => (x.id === s.id ? s : x)) }, shape: s };
        });
      };
      const draw = (stencil: string) => (a: BVal[]): BObject => {
        const [x1, y1, x2, y2] = [0, 1, 2, 3].map((i) => toNum(a[i]!));
        const w = Math.max(1, Math.abs(x2! - x1!));
        const h = Math.max(1, Math.abs(y2! - y1!));
        return dropped((p) => {
          const r = addShape(p, stencil, (x1! + x2!) / 2, (y1! + y2!) / 2, { w, h });
          // addShape snaps to the grid; a drawn shape goes exactly where it was drawn
          const s = { ...r.shape, x: Math.min(x1!, x2!), y: Math.min(y1!, y2!) };
          return { page: { ...r.page, shapes: r.page.shapes.map((x) => (x.id === s.id ? s : x)) }, shape: s };
        });
      };
      return make({
        type: 'Shapes',
        props: { count: { get: () => itemsOf(pid).length } },
        methods: {
          drop,
          drawrectangle: draw('rect'),
          drawoval: draw('ellipse'),
          drawline: (a) => {
            const [x1, y1, x2, y2] = [0, 1, 2, 3].map((i) => toNum(a[i]!));
            const c = newConnector({ x: x1!, y: y1! }, { x: x2!, y: y2! }, { routing: 'straight', startArrow: 'none', endArrow: 'none' });
            edit(pid, (p) => addConnector(p, c));
            return item(pid, { kind: 'conn', id: c.id });
          },
          itemu: (a) => base.index!([toStr(a[0])]) as BVal,
        },
        index: base.index,
        items: base.items,
      });
    };

    const pageObject = (pid: string): BObject =>
      make({
        type: 'Page',
        props: {
          name: { get: () => pageById(pid).name, set: (v) => edit(pid, (p) => ({ ...p, name: toStr(v) })) },
          index: { get: () => ctl.diagram.pages.findIndex((p) => p.id === pid) + 1 },
          shapes: { get: () => shapesOf(pid) },
          width: { get: () => pageById(pid).width, set: (v) => edit(pid, (p) => ({ ...p, width: Math.max(100, toNum(v)) })) },
          height: { get: () => pageById(pid).height, set: (v) => edit(pid, (p) => ({ ...p, height: Math.max(100, toNum(v)) })) },
        },
        methods: {
          drop: (a) => (shapesOf(pid).get('drop', a) as BVal),
          drawrectangle: (a) => shapesOf(pid).get('drawrectangle', a),
          drawoval: (a) => shapesOf(pid).get('drawoval', a),
          drawline: (a) => shapesOf(pid).get('drawline', a),
          activate: () => {
            ctl.pageId = pid;
            ctl.selShapes = [];
            ctl.selConnectors = [];
            return undefined;
          },
          delete: () => {
            if (ctl.diagram.pages.length <= 1) err('No se puede eliminar la única página del diagrama.');
            ctl.commit(deletePage(ctl.diagram, pid));
            return undefined;
          },
        },
      });

    const pages = (): BObject => {
      const base = collection('Pages', () => ctl.diagram.pages.map((p) => pageObject(p.id)), (o) => toStr(o.get('name', [])));
      return make({
        type: 'Pages',
        props: { count: { get: () => ctl.diagram.pages.length } },
        methods: {
          add: () => {
            const r = addPage(ctl.diagram);
            ctl.commit(r.diagram);
            return pageObject(r.page.id);
          },
          itemu: (a) => base.index!([toStr(a[0])]) as BVal,
        },
        index: base.index,
        items: base.items,
      });
    };

    /** The "masters" are the shapes the stencil panel offers, by name (`Rectángulo`, `Decisión`…). */
    const masters = (): BObject => {
      const master = (id: string): BObject => make({ type: 'Master', props: { name: { get: () => stencilOf(id).name }, id: { get: () => id } } });
      const base = collection('Masters', () => STENCILS.map((s) => master(s.id)), (o) => toStr(o.get('name', [])));
      return make({ type: 'Masters', props: { count: { get: () => STENCILS.length } }, methods: { itemu: (a) => base.index!([toStr(a[0])]) as BVal }, index: base.index, items: base.items });
    };

    const document = make({
      type: 'Document',
      props: {
        name: { get: () => ctl.diagram.name, set: (v) => ctl.commit({ ...ctl.diagram, name: toStr(v) }) },
        fullname: { get: () => ctl.filePath ?? ctl.fileName ?? '' },
        pages: { get: () => pages() },
        masters: { get: () => masters() },
      },
    });

    const selection = (): BObject => {
      const list = () => [...ctl.selShapes.map((id): Item => ({ kind: 'shape', id })), ...ctl.selConnectors.map((id): Item => ({ kind: 'conn', id }))].map((it) => item(ctl.pageId, it));
      return collection('Selection', list);
    };
    const window = make({
      type: 'Window',
      props: {
        page: { get: () => pageObject(ctl.pageId), set: (v) => (v as BObject).get('activate', []) },
        selection: { get: () => selection() },
      },
      methods: {
        select: (a) => {
          const mode = a[1] === undefined ? 2 : Math.trunc(toNum(a[1]));
          const o = a[0] as BObject | undefined;
          if (!o) return err('Indica la forma que se selecciona.');
          if (mode === 1) {
            ctl.selShapes = [];
            ctl.selConnectors = [];
            return undefined;
          }
          return o.get('select', []);
        },
        deselectall: () => {
          ctl.selShapes = [];
          ctl.selConnectors = [];
          return undefined;
        },
      },
    });

    /** `ActivePage` is always the page shown at the moment it is used. */
    const activePage: BObject = {
      typeName: 'Page',
      get: (m, a) => pageObject(ctl.pageId).get(m, a),
      set: (m, a, v) => pageObject(ctl.pageId).set(m, a, v),
      index: (a) => pageObject(ctl.pageId).index?.(a),
      items: () => pageObject(ctl.pageId).items?.() ?? [],
    };
    const app = make({
      type: 'Application',
      props: {
        name: { get: () => 'Nova Diagram' },
        version: { get: () => '16.0' },
        activedocument: { get: () => document },
        activepage: { get: () => activePage },
        activewindow: { get: () => window },
        documents: { get: () => collection('Documents', () => [document]) },
      },
      methods: { quit: () => undefined },
    });
    return { application: app, activedocument: document, activepage: activePage, activewindow: window };
  }
}
