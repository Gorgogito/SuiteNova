import type { LibraryId } from '../macros/security';
import { basic } from '@suitenova/base-core';
import {
  addElements,
  addSlide,
  chainFor,
  cloneElement,
  deleteSlides,
  docFromText,
  docNode,
  docText,
  duplicateSlides,
  effectiveXfrm,
  findElement,
  moveSlides,
  newId,
  newShape,
  newTextBox,
  removeElements,
  reorderElements,
  slidesSchema,
  textNodeTypes,
  updateElement,
  type Deck,
  type ParaProps,
  type RunProps,
  type ShapeEl,
  type Slide,
  type SlideElement,
  type Xfrm,
  type ZMove,
} from '@suitenova/slides-core';
import type { Node as PMNode } from 'prosemirror-model';
import { collection, makeObject, noMember, type ParamTable } from '../macros/objects';
import { MacroRuntime, type MacroRun } from '../macros/runtime';
import type { SlidesCtl } from './ctl';

type BVal = basic.BVal;
type BObject = basic.BObject;
const { BasicError, toNum, toStr, toBool } = basic;

export type { MacroRun };

/** The constants of the PowerPoint object model that macros use, by lower-case name. */
export const PP_CONSTANTS: Record<string, number> = {
  ppalignleft: 1, ppaligncenter: 2, ppalignright: 3, ppalignjustify: 4,
  pplayouttitle: 1, pplayouttext: 2, pplayouttwocolumntext: 3, pplayouttitleonly: 11, pplayoutblank: 12, pplayoutobject: 16,
  msotrue: -1, msofalse: 0, msotriststatetoggle: -3,
  msoautoshape: 1, msochart: 3, msogroup: 6, msopicture: 13, msoplaceholder: 14, msotextbox: 17, msotable: 19,
  msotextorientationhorizontal: 1,
  msobringtofront: 0, msosendtoback: 1, msobringforward: 2, msosendbackward: 3,
  msoshaperectangle: 1, msoshapeparallelogram: 2, msoshapetrapezoid: 3, msoshapediamond: 4, msoshaperoundedrectangle: 5, msoshapeoctagon: 6,
  msoshapeisoscelestriangle: 7, msoshaperighttriangle: 8, msoshapeoval: 9, msoshapehexagon: 10, msoshapecross: 11, msoshapepentagon: 51, msoshapechevron: 52,
  msoshaperightarrow: 33, msoshapeleftarrow: 34, msoshapeuparrow: 35, msoshapedownarrow: 36, msoshapeheart: 21, msoshapelightningbolt: 22, msoshapesun: 23, msoshapemoon: 24,
  msoshape5pointstar: 92, msoshapecloud: 179,
  vbblack: 0, vbred: 255, vbgreen: 65280, vbblue: 16711680, vbyellow: 65535, vbwhite: 16777215, vbmagenta: 16711935, vbcyan: 16776960,
};

/** `msoShape…` number → the preset geometry of the shape. */
const AUTO_SHAPE: Record<number, string> = {
  1: 'rect', 2: 'parallelogram', 3: 'trapezoid', 4: 'diamond', 5: 'roundRect', 6: 'octagon', 7: 'triangle', 8: 'rtTriangle', 9: 'ellipse', 10: 'hexagon', 11: 'plus',
  21: 'heart', 22: 'lightningBolt', 23: 'sun', 24: 'moon', 33: 'rightArrow', 34: 'leftArrow', 35: 'upArrow', 36: 'downArrow', 51: 'homePlate', 52: 'chevron', 92: 'star5', 179: 'cloud',
};
/** The kinds of layout `Slides.Add` can ask for (`ppLayout…`) and the layout types of the file they match. */
const LAYOUT_TYPE: Record<number, string> = { 1: 'title', 2: 'obj', 3: 'twoObj', 11: 'titleOnly', 12: 'blank', 16: 'obj' };

const PARAMS: ParamTable = {
  add: ['index', 'layout'],
  addtextbox: ['orientation', 'left', 'top', 'width', 'height'],
  addshape: ['type', 'left', 'top', 'width', 'height'],
  zorder: ['zorderCmd'],
  gotoslide: ['index'],
};

const bgrToHex = (n: number): string => {
  const v = Math.max(0, Math.trunc(n)) & 0xffffff;
  return '#' + [v & 255, (v >> 8) & 255, (v >> 16) & 255].map((x) => x.toString(16).padStart(2, '0')).join('');
};
const hexToBgr = (hex: string | undefined): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return 0;
  const n = parseInt(m[1]!, 16);
  return ((n >> 16) & 255) | (n & 0xff00) | ((n & 255) << 16);
};

const ALIGN = ['l', 'ctr', 'r', 'just'] as const;

/** The elements that have a fill and an outline of their own. */
const canStyle = (e: SlideElement): e is Extract<SlideElement, { kind: 'shape' | 'pic' }> => e.kind === 'shape' || e.kind === 'pic';
const canLine = (e: SlideElement): e is Extract<SlideElement, { kind: 'shape' | 'pic' | 'cxn' }> => e.kind === 'shape' || e.kind === 'pic' || e.kind === 'cxn';

/** Applies `fr` to the characters of one paragraph (1-based) or of all of them, and `fp` to the paragraph settings. */
function mapScope(doc: unknown, scope: number | null, fr: ((r: RunProps) => RunProps) | null, fp: ((p: ParaProps) => ParaProps) | null): unknown {
  const n = docNode(doc);
  const paras: PMNode[] = [];
  n.forEach((para, _o, i) => {
    if (scope !== null && i + 1 !== scope) return void paras.push(para);
    const kids: PMNode[] = [];
    para.forEach((c) => {
      if (c.type.name === 'text' && fr) {
        const cur = (c.marks.find((m) => m.type.name === 'run')?.attrs.r ?? {}) as RunProps;
        const next = fr(cur);
        kids.push(slidesSchema.text(c.text!, Object.keys(next).length ? [slidesSchema.marks.run!.create({ r: next })] : []));
      } else kids.push(c);
    });
    paras.push(textNodeTypes.paragraph!.create({ lvl: para.attrs.lvl, p: fp ? fp(para.attrs.p as ParaProps) : para.attrs.p, end: fr ? fr(para.attrs.end as RunProps) : para.attrs.end }, kids));
  });
  return textNodeTypes.doc!.create(null, paras).toJSON();
}

const runMarks = (r: RunProps) => (Object.keys(r).length ? [slidesSchema.marks.run!.create({ r })] : []);
const runOf = (para: PMNode): RunProps => {
  let out: RunProps = {};
  let found = false;
  para.forEach((c) => {
    if (found || c.type.name !== 'text') return;
    out = (c.marks.find((m) => m.type.name === 'run')?.attrs.r ?? {}) as RunProps;
    found = true;
  });
  return found ? out : ((para.attrs.end ?? {}) as RunProps);
};

/** Replaces the text of one paragraph (1-based) keeping its settings and the format of its first characters. */
function replaceParagraph(doc: unknown, index: number, value: string): unknown {
  const paras: PMNode[] = [];
  docNode(doc).forEach((para, _o, i) => {
    if (i + 1 !== index) return void paras.push(para);
    const r = runOf(para);
    for (const line of value.split('\n')) paras.push(textNodeTypes.paragraph!.create(para.attrs, line ? [slidesSchema.text(line, runMarks(r))] : []));
  });
  return textNodeTypes.doc!.create(null, paras).toJSON();
}

/** Adds text at the end, in the format of the last characters; a line break starts a new paragraph with the settings of the last one. */
function appendText(doc: unknown, value: string): unknown {
  const n = docNode(doc);
  const paras: PMNode[] = [];
  const parts = value.split('\n');
  n.forEach((para, _o, i) => {
    if (i < n.childCount - 1) return void paras.push(para);
    const r = runOf(para);
    const kids: PMNode[] = [];
    para.forEach((c) => kids.push(c));
    if (parts[0]) kids.push(slidesSchema.text(parts[0], runMarks(r)));
    paras.push(para.type.create(para.attrs, kids));
    for (const line of parts.slice(1)) paras.push(textNodeTypes.paragraph!.create(para.attrs, line ? [slidesSchema.text(line, runMarks(r))] : []));
  });
  return textNodeTypes.doc!.create(null, paras).toJSON();
}

const firstRun = (doc: unknown, scope: number | null): RunProps => {
  let out: RunProps = {};
  let found = false;
  docNode(doc).forEach((para, _o, i) => {
    if (found || (scope !== null && i + 1 !== scope)) return;
    para.forEach((c) => {
      if (found || c.type.name !== 'text') return;
      out = (c.marks.find((m) => m.type.name === 'run')?.attrs.r ?? {}) as RunProps;
      found = true;
    });
  });
  return out;
};

/** Runs the macros of a presentation: Nova Basic with the objects of PowerPoint (Presentation, Slide, Shape, TextRange…). */
export class SlidesRuntime extends MacroRuntime {
  constructor(readonly ctl: SlidesCtl) {
    super();
  }
  get libraryId(): LibraryId | undefined {
    return 'slides';
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
    return { ...PP_CONSTANTS, ...this.objects() };
  }

  /** Everything a macro does is one step of the history. */
  protected guarded(fn: () => MacroRun): MacroRun {
    if (++this.depth > 20) {
      this.depth--;
      return { ok: false, error: 'Demasiadas llamadas anidadas.' };
    }
    let result: MacroRun = { ok: true };
    try {
      if (this.ctl.inMaster) throw new BasicError(91, 'Salga de la vista Patrón para ejecutar macros.');
      this.ctl.endEdit();
      const outer = this.depth === 1;
      if (outer) this.ctl.undoGroup('Ejecutar macro', () => (result = fn()));
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

  // ------------------------------------------------------------------------------------------------ the object model

  private get deck(): Deck {
    return this.ctl.realDeck;
  }
  private slideById(id: string): Slide {
    const s = this.deck.slides.find((x) => x.id === id);
    if (!s) throw new BasicError(91, 'La diapositiva ya no existe.');
    return s;
  }
  private elOf(slideId: string, elId: string): SlideElement {
    const hit = findElement(this.slideById(slideId).shapes, elId);
    if (!hit) throw new BasicError(91, 'La forma ya no existe.');
    return hit.el;
  }
  private edit(label: string, fn: (d: Deck) => Deck): void {
    this.ctl.apply(label, fn);
  }
  private xfrm(slideId: string, el: SlideElement): Xfrm {
    return effectiveXfrm(chainFor(this.deck, this.slideById(slideId)), el, true);
  }

  private objects(): Record<string, BVal> {
    const rt = this;
    const ctl = this.ctl;
    const make = (def: Parameters<typeof makeObject>[0]) => makeObject(def, PARAMS);

    // ---- text
    const textRange = (slideId: string, elId: string, scope: number | null): BObject => {
      const body = () => {
        const el = rt.elOf(slideId, elId);
        if (el.kind !== 'shape' || !el.text) throw new BasicError(438, 'Esta forma no tiene texto.');
        return el;
      };
      const setDoc = (label: string, doc: unknown) => rt.edit(label, (d) => updateElement(d, slideId, elId, (e) => (e.kind === 'shape' && e.text ? { ...e, text: { ...e.text, doc } } : e)));
      const lines = () => docText(body().text!.doc).split('\n');
      const edit = (fr: ((r: RunProps) => RunProps) | null, fp: ((p: ParaProps) => ParaProps) | null) => setDoc('Formato de texto', mapScope(body().text!.doc, scope, fr, fp));
      const flag = (key: 'b' | 'i') => ({ get: () => (firstRun(body().text!.doc, scope)[key] ? -1 : 0), set: (v: BVal) => edit((r) => ({ ...r, [key]: toBool(v) || undefined }), null) });
      const font = make({
        type: 'Font',
        props: {
          bold: flag('b'),
          italic: flag('i'),
          underline: { get: () => (firstRun(body().text!.doc, scope).u && firstRun(body().text!.doc, scope).u !== 'none' ? -1 : 0), set: (v) => edit((r) => ({ ...r, u: toBool(v) ? 'sng' : undefined }), null) },
          size: { get: () => firstRun(body().text!.doc, scope).sz ?? 18, set: (v) => edit((r) => ({ ...r, sz: toNum(v) }), null) },
          name: { get: () => firstRun(body().text!.doc, scope).latin ?? 'Calibri', set: (v) => edit((r) => ({ ...r, latin: toStr(v) }), null) },
          color: {
            get: () =>
              make({
                type: 'ColorFormat',
                props: {
                  rgb: {
                    get: () => hexToBgr(firstRun(body().text!.doc, scope).color?.rgb),
                    set: (v) => edit((r) => ({ ...r, color: { rgb: bgrToHex(toNum(v)) } }), null),
                  },
                },
              }),
          },
        },
      });
      const paraFormat = make({
        type: 'ParagraphFormat',
        props: {
          alignment: {
            get: () => {
              let a = 'l';
              docNode(body().text!.doc).forEach((p, _o, i) => {
                if (i === (scope ?? 1) - 1) a = (p.attrs.p as ParaProps).algn ?? 'l';
              });
              return Math.max(0, ALIGN.indexOf(a as (typeof ALIGN)[number])) + 1;
            },
            set: (v) => edit(null, (p) => ({ ...p, algn: ALIGN[Math.trunc(toNum(v)) - 1] ?? 'l' })),
          },
        },
      });
      const text = (): string => (scope === null ? lines().join('\r') : (lines()[scope - 1] ?? ''));
      const paragraphs = (): BObject[] => lines().map((_l, i) => textRange(slideId, elId, i + 1));
      return make({
        type: 'TextRange',
        props: {
          text: {
            get: text,
            set: (v) => {
              const el = body();
              const run = firstRun(el.text!.doc, scope);
              const value = toStr(v).replace(/\r\n|\r/g, '\n');
              if (scope === null) {
                const p = (docNode(el.text!.doc).firstChild?.attrs.p ?? undefined) as ParaProps | undefined;
                setDoc('Texto', docFromText(value, p, run));
              } else {
                if (scope > lines().length) throw new BasicError(9, 'El subíndice está fuera del intervalo.');
                setDoc('Texto', replaceParagraph(el.text!.doc, scope, value));
              }
            },
          },
          font: { get: () => font },
          paragraphformat: { get: () => paraFormat },
          paragraphs: { get: () => collection('TextRanges', paragraphs) },
          length: { get: () => text().length },
        },
        methods: {
          insertafter: (a) => {
            setDoc('Texto', appendText(body().text!.doc, toStr(a[0]).replace(/\r\n|\r/g, '\n')));
            return textRange(slideId, elId, null);
          },
          delete: () => {
            setDoc('Texto', docFromText('', undefined, firstRun(body().text!.doc, scope)));
            return undefined;
          },
        },
      });
    };

    // ---- shapes
    const shape = (slideId: string, elId: string): BObject => {
      const el = () => rt.elOf(slideId, elId);
      const setX = (patch: Partial<Xfrm>) => rt.edit('Mover o cambiar el tamaño', (d) => updateElement(d, slideId, elId, (e) => ({ ...e, xfrm: { ...rt.xfrm(slideId, e), ...patch } })));
      const fillObj = make({
        type: 'FillFormat',
        props: {
          visible: {
            get: () => {
              const e = el();
              return canStyle(e) && e.fill && e.fill.t !== 'none' ? -1 : e.kind === 'shape' && e.style?.fill ? -1 : 0;
            },
            set: (v) => rt.edit('Relleno', (d) => updateElement(d, slideId, elId, (e) => (canStyle(e) ? ({ ...e, fill: toBool(v) ? (e.fill && e.fill.t !== 'none' ? e.fill : { t: 'solid', c: { scheme: 'accent1' } }) : { t: 'none' } } as SlideElement) : e))),
          },
          forecolor: {
            get: () =>
              make({
                type: 'ColorFormat',
                props: {
                  rgb: {
                    get: () => {
                      const e = el();
                      return hexToBgr(canStyle(e) && e.fill && e.fill.t === 'solid' ? e.fill.c.rgb : undefined);
                    },
                    set: (v) => rt.edit('Relleno', (d) => updateElement(d, slideId, elId, (e) => (canStyle(e) ? ({ ...e, fill: { t: 'solid', c: { rgb: bgrToHex(toNum(v)) } } } as SlideElement) : e))),
                  },
                },
              }),
          },
        },
      });
      const lineObj = make({
        type: 'LineFormat',
        props: {
          visible: {
            get: () => {
              const e = el();
              return canLine(e) && e.ln && e.ln.fill?.t === 'none' ? 0 : -1;
            },
            set: (v) => rt.edit('Línea', (d) => updateElement(d, slideId, elId, (e) => (canLine(e) ? ({ ...e, ln: { ...(e.ln ?? {}), fill: toBool(v) ? (e.ln?.fill && e.ln.fill.t !== 'none' ? e.ln.fill : { t: 'solid', c: { scheme: 'accent1' } }) : { t: 'none' } } } as SlideElement) : e))),
          },
          weight: {
            get: () => {
              const e = el();
              return canLine(e) ? (e.ln?.w ?? 1) : 1;
            },
            set: (v) => rt.edit('Línea', (d) => updateElement(d, slideId, elId, (e) => (canLine(e) ? ({ ...e, ln: { ...(e.ln ?? {}), w: toNum(v) } } as SlideElement) : e))),
          },
          forecolor: {
            get: () =>
              make({
                type: 'ColorFormat',
                props: {
                  rgb: {
                    get: () => {
                      const e = el();
                      return hexToBgr(canLine(e) && e.ln?.fill?.t === 'solid' ? e.ln.fill.c.rgb : undefined);
                    },
                    set: (v) => rt.edit('Línea', (d) => updateElement(d, slideId, elId, (e) => (canLine(e) ? ({ ...e, ln: { ...(e.ln ?? {}), fill: { t: 'solid', c: { rgb: bgrToHex(toNum(v)) } } } } as SlideElement) : e))),
                  },
                },
              }),
          },
        },
      });
      const textFrame = make({
        type: 'TextFrame',
        props: { textrange: { get: () => textRange(slideId, elId, null) }, hastext: { get: () => (el().kind === 'shape' && docText((el() as ShapeEl).text?.doc ?? '').length > 0 ? -1 : 0) } },
      });
      const zorder = (a: BVal[]) => {
        const how: ZMove[] = ['front', 'back', 'forward', 'backward'];
        const m = how[Math.trunc(toNum(a[0]))];
        if (!m) throw new BasicError(5, 'Argumento no válido.');
        rt.edit('Orden', (d) => reorderElements(d, slideId, [elId], m));
        return undefined;
      };
      return make({
        type: 'Shape',
        props: {
          name: { get: () => el().name ?? el().id, set: (v) => rt.edit('Nombre', (d) => updateElement(d, slideId, elId, (e) => ({ ...e, name: toStr(v) }))) },
          id: { get: () => el().srcId ?? 0 },
          left: { get: () => rt.xfrm(slideId, el()).x, set: (v) => setX({ x: toNum(v) }) },
          top: { get: () => rt.xfrm(slideId, el()).y, set: (v) => setX({ y: toNum(v) }) },
          width: { get: () => rt.xfrm(slideId, el()).w, set: (v) => setX({ w: toNum(v) }) },
          height: { get: () => rt.xfrm(slideId, el()).h, set: (v) => setX({ h: toNum(v) }) },
          rotation: { get: () => rt.xfrm(slideId, el()).rot ?? 0, set: (v) => setX({ rot: toNum(v) }) },
          visible: { get: () => (el().hidden ? 0 : -1), set: (v) => rt.edit('Visibilidad', (d) => updateElement(d, slideId, elId, (e) => ({ ...e, hidden: !toBool(v) || undefined }))) },
          alternativetext: { get: () => el().descr ?? '', set: (v) => rt.edit('Texto alternativo', (d) => updateElement(d, slideId, elId, (e) => ({ ...e, descr: toStr(v) }))) },
          type: {
            get: () => {
              const e = el();
              return e.kind === 'pic' ? 13 : e.kind === 'group' ? 6 : e.kind === 'table' ? 19 : e.kind === 'chart' ? 3 : e.kind === 'shape' && e.ph ? 14 : e.kind === 'shape' && e.isTextBox ? 17 : 1;
            },
          },
          hastextframe: { get: () => (el().kind === 'shape' && (el() as ShapeEl).text ? -1 : 0) },
          textframe: { get: () => textFrame },
          fill: { get: () => fillObj },
          line: { get: () => lineObj },
          zorderposition: { get: () => rt.slideById(slideId).shapes.findIndex((x) => x.id === elId) + 1 },
        },
        methods: {
          delete: () => {
            rt.edit('Eliminar forma', (d) => removeElements(d, slideId, [elId]));
            return undefined;
          },
          duplicate: () => {
            const copy = cloneElement(el());
            const x = rt.xfrm(slideId, el());
            copy.xfrm = { ...x, x: x.x + 10, y: x.y + 10 };
            rt.edit('Duplicar forma', (d) => addElements(d, slideId, [copy]));
            return shape(slideId, copy.id);
          },
          zorder,
          select: () => {
            const index = rt.deck.slides.findIndex((s) => s.id === slideId);
            ctl.index = index;
            ctl.selection = [elId];
            return undefined;
          },
        },
      });
    };

    const shapes = (slideId: string): BObject => {
      const list = () => rt.slideById(slideId).shapes.map((e) => shape(slideId, e.id));
      const base = collection('Shapes', list, (o) => toStr(o.get('name', [])));
      const added = (e: SlideElement): BObject => {
        rt.edit('Agregar forma', (d) => addElements(d, slideId, [e]));
        return shape(slideId, e.id);
      };
      const num = (a: BVal[], i: number, def: number) => (a[i] === undefined ? def : toNum(a[i]));
      return make({
        type: 'Shapes',
        props: {
          count: { get: () => list().length },
          hastitle: { get: () => (rt.slideById(slideId).shapes.some((e) => e.kind === 'shape' && (e.ph?.type === 'title' || e.ph?.type === 'ctrTitle')) ? -1 : 0) },
          title: {
            get: () => {
              const t = rt.slideById(slideId).shapes.find((e) => e.kind === 'shape' && (e.ph?.type === 'title' || e.ph?.type === 'ctrTitle'));
              if (!t) throw new BasicError(5, 'Esta diapositiva no tiene título.');
              return shape(slideId, t.id);
            },
          },
        },
        methods: {
          addtextbox: (a) => added(newTextBox(num(a, 1, 0), num(a, 2, 0), num(a, 3, 200), num(a, 4, 50))),
          addshape: (a) => {
            const prst = AUTO_SHAPE[Math.trunc(num(a, 0, 1))];
            if (!prst) throw new BasicError(5, `Forma automática no admitida: ${toStr(a[0])}`);
            return added(newShape(prst, num(a, 1, 0), num(a, 2, 0), num(a, 3, 100), num(a, 4, 100)));
          },
        },
        index: base.index,
        items: base.items,
      });
    };

    // ---- slides
    const slide = (id: string): BObject => {
      const at = () => {
        const i = rt.deck.slides.findIndex((s) => s.id === id);
        if (i < 0) throw new BasicError(91, 'La diapositiva ya no existe.');
        return i;
      };
      return make({
        type: 'Slide',
        props: {
          slideindex: { get: () => at() + 1 },
          slidenumber: { get: () => at() + (rt.deck.firstSlideNum ?? 1) },
          name: { get: () => `Slide${at() + 1}` },
          shapes: { get: () => shapes(id) },
          hidden: { get: () => (rt.slideById(id).hidden ? -1 : 0), set: (v) => rt.edit('Ocultar diapositiva', (d) => ({ ...d, slides: d.slides.map((s) => (s.id === id ? { ...s, hidden: toBool(v) || undefined } : s)) })) },
        },
        methods: {
          delete: () => {
            if (rt.deck.slides.length <= 1) throw new BasicError(5, 'La presentación necesita al menos una diapositiva.');
            rt.edit('Eliminar diapositiva', (d) => deleteSlides(d, [id]));
            return undefined;
          },
          duplicate: () => {
            let created = '';
            rt.edit('Duplicar diapositiva', (d) => {
              const r = duplicateSlides(d, [id]);
              created = r.ids[0] ?? '';
              return r.deck;
            });
            return slide(created);
          },
          moveto: (a) => {
            const to = Math.max(1, Math.min(Math.trunc(toNum(a[0])), rt.deck.slides.length)) - 1;
            rt.edit('Mover diapositiva', (d) => moveSlides(d, [id], to));
            return undefined;
          },
          select: () => {
            ctl.index = at();
            ctl.selSlides = [id];
            return undefined;
          },
        },
      });
    };

    const slides = (): BObject => {
      const list = () => rt.deck.slides.map((s) => slide(s.id));
      const base = collection('Slides', list);
      return make({
        type: 'Slides',
        props: { count: { get: () => rt.deck.slides.length } },
        methods: {
          add: (a) => {
            const where = a[0] === undefined ? rt.deck.slides.length + 1 : Math.trunc(toNum(a[0]));
            if (where < 1 || where > rt.deck.slides.length + 1) throw new BasicError(5, 'La posición de la diapositiva está fuera del intervalo.');
            const type = LAYOUT_TYPE[Math.trunc(a[1] === undefined ? 12 : toNum(a[1]))];
            const layout = rt.deck.layouts.find((l) => l.type === type) ?? rt.deck.layouts[0]!;
            let id = '';
            rt.edit('Agregar diapositiva', (d) => {
              const r = addSlide(d, layout.id, where - 1);
              id = r.slide.id;
              return r.deck;
            });
            return slide(id);
          },
        },
        index: base.index,
        items: base.items,
      });
    };

    const presentation = make({
      type: 'Presentation',
      props: {
        name: { get: () => ctl.fileName ?? 'Presentación' },
        slides: { get: () => slides() },
        pagesetup: {
          get: () =>
            make({
              type: 'PageSetup',
              props: {
                slidewidth: { get: () => rt.deck.size.w },
                slideheight: { get: () => rt.deck.size.h },
              },
            }),
        },
      },
    });
    const win = make({
      type: 'DocumentWindow',
      props: {
        view: {
          get: () =>
            make({
              type: 'View',
              props: { slide: { get: () => slide(rt.deck.slides[Math.min(ctl.index, rt.deck.slides.length - 1)]!.id) } },
              methods: {
                gotoslide: (a) => {
                  const n = Math.trunc(toNum(a[0]));
                  if (n < 1 || n > rt.deck.slides.length) throw new BasicError(5, 'El número de diapositiva está fuera del intervalo.');
                  ctl.index = n - 1;
                  ctl.selSlides = [rt.deck.slides[n - 1]!.id];
                  return undefined;
                },
              },
            }),
        },
      },
    });
    const app = make({
      type: 'Application',
      props: {
        name: { get: () => 'Nova Slides' },
        version: { get: () => '16.0' },
        activepresentation: { get: () => presentation },
        presentations: { get: () => collection('Presentations', () => [presentation]) },
        activewindow: { get: () => win },
      },
      methods: { quit: () => undefined },
    });
    void noMember;
    void newId;
    return { application: app, activepresentation: presentation, activewindow: win, presentations: collection('Presentations', () => [presentation]) };
  }
}
