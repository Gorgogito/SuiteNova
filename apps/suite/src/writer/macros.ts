import { basic } from '@suitenova/base-core';
import { nodeTypes, writerSchema } from '@suitenova/writer-core';
import { closeHistory } from 'prosemirror-history';
import { TextSelection, type Transaction } from 'prosemirror-state';
import { msgBox } from '../base/runtime';
import type { WriterCtl } from './doc';
import { addCommentMark, applyChanges, getUser, listChanges } from './review';
import { blocksIn, buildStory, offsetToPos, posToOffset, type Story } from './story';

type BVal = basic.BVal;
type BObject = basic.BObject;
const { BasicError, VArray, toStr, toNum, toBool } = basic;

export interface MacroRun {
  ok: boolean;
  error?: string;
  at?: { module: string; line: number };
  value?: BVal;
}

const noMember = (m: string): never => {
  throw new BasicError(438, `El objeto no admite la propiedad o el método: ${m}`);
};

export const WORD_CONSTANTS: Record<string, number> = {
  wdalignparagraphleft: 0, wdalignparagraphcenter: 1, wdalignparagraphright: 2, wdalignparagraphjustify: 3,
  wdcollapsestart: 1, wdcollapseend: 0,
  wdcharacter: 1, wdword: 2, wdsentence: 3, wdparagraph: 4, wdline: 5, wdstory: 6,
  wdmove: 0, wdextend: 1,
  wdunderlinenone: 0, wdunderlinesingle: 1, wdtoggle: 9999998, wdundefined: 9999999,
  wdreplacenone: 0, wdreplaceone: 1, wdreplaceall: 2,
  wdfindcontinue: 1, wdfindstop: 0, wdfindask: 2,
  wdcolorautomatic: -16777216, wdcolorblack: 0, wdcolorred: 255, wdcolorgreen: 32768, wdcolorblue: 16711680, wdcolorwhite: 16777215, wdcoloryellow: 65535,
  wdorientportrait: 0, wdorientlandscape: 1,
  wdline1: 5,
  vbblack: 0, vbred: 255, vbgreen: 65280, vbblue: 16711680, vbyellow: 65535, vbwhite: 16777215, vbmagenta: 16711935, vbcyan: 16776960,
};

const STYLE_BY_NAME: Record<string, string> = {
  normal: 'Normal', 'título': 'Title', titulo: 'Title', title: 'Title', 'subtítulo': 'Subtitle', subtitle: 'Subtitle', cita: 'Quote', quote: 'Quote',
  'título 1': 'Heading1', 'título 2': 'Heading2', 'título 3': 'Heading3', 'título 4': 'Heading4', 'título 5': 'Heading5', 'título 6': 'Heading6',
  'heading 1': 'Heading1', 'heading 2': 'Heading2', 'heading 3': 'Heading3', 'heading 4': 'Heading4', 'heading 5': 'Heading5', 'heading 6': 'Heading6',
  'leyenda': 'Caption', caption: 'Caption',
};
const STYLE_LABEL: Record<string, string> = { Normal: 'Normal', Title: 'Título', Subtitle: 'Subtítulo', Quote: 'Cita', Caption: 'Leyenda', Heading1: 'Título 1', Heading2: 'Título 2', Heading3: 'Título 3', Heading4: 'Título 4', Heading5: 'Título 5', Heading6: 'Título 6' };

const bgrToHex = (n: number): string => {
  const v = Math.max(0, Math.trunc(n)) & 0xffffff;
  return '#' + [v & 255, (v >> 8) & 255, (v >> 16) & 255].map((x) => x.toString(16).padStart(2, '0')).join('');
};
const hexToBgr = (hex: string): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return -16777216;
  const n = parseInt(m[1]!, 16);
  return ((n >> 16) & 255) | (n & 0xff00) | ((n & 255) << 16);
};

/** Parameter names of the methods that take named arguments (Execute Replace:=wdReplaceAll). */
const PARAMS: Record<string, string[]> = {
  execute: ['findtext', 'matchcase', 'matchwholeword', 'matchwildcards', 'matchsoundslike', 'matchallwordforms', 'forward', 'wrap', 'format', 'replacewith', 'replace'],
  add: ['name', 'range', 'text'],
  moveright: ['unit', 'count', 'extend'],
  moveleft: ['unit', 'count', 'extend'],
  homekey: ['unit', 'extend'],
  endkey: ['unit', 'extend'],
  collapse: ['direction'],
  typetext: ['text'],
  insertafter: ['text'],
  insertbefore: ['text'],
};
function withNamed(method: string, args: BVal[]): BVal[] {
  const named = (args as BVal[] & { named?: Record<string, BVal> }).named;
  const order = PARAMS[method];
  if (!named || !order || !Object.keys(named).length) return args;
  const out = [...args];
  for (const [k, v] of Object.entries(named)) {
    const i = order.indexOf(k.toLowerCase());
    if (i >= 0) out[i] = v;
  }
  return out;
}

interface Def {
  type: string;
  props?: Record<string, { get: () => BVal; set?: (v: BVal) => void }>;
  methods?: Record<string, (a: BVal[]) => BVal>;
  index?: (a: BVal[]) => BVal;
  items?: () => BVal[];
}
/** Build an object of the macro language from property and method tables (names are case-insensitive). */
function make(def: Def): BObject {
  return {
    typeName: def.type,
    get(member, args) {
      const m = member.toLowerCase();
      const fn = def.methods?.[m];
      if (fn) return fn(withNamed(m, args));
      const p = def.props?.[m];
      if (p) {
        const v = p.get();
        // Paragraphs(2), Tables(1)…: the property is a collection and the arguments pick an item
        if (args.length && v && typeof v === 'object' && 'typeName' in v && (v as BObject).index) return (v as BObject).index!(args);
        return v;
      }
      if (m === 'item' && def.index) return def.index(args);
      return noMember(member);
    },
    set(member, _args, v) {
      const p = def.props?.[member.toLowerCase()];
      if (!p || !p.set) return noMember(member);
      p.set(v);
    },
    index: def.index,
    items: def.items,
  };
}

/** Runs the macros of a document: Nova Basic with the objects of a word processor (Document, Selection, Range…). */
export class WriterRuntime {
  console: string[] = [];
  limits: Partial<basic.Limits> = {};
  private interp: basic.Interpreter | null = null;
  private key = '';
  private errors: { module: string; line: number; message: string }[] = [];
  private depth = 0;
  lastAt: { module: string; line: number } | undefined;

  constructor(readonly ctl: WriterCtl) {}

  print = (text: string): void => {
    this.console.push(text);
    if (this.console.length > 2000) this.console.splice(0, this.console.length - 2000);
    this.ctl.touch();
  };
  clearConsole(): void {
    this.console = [];
    this.ctl.touch();
  }
  get modules(): { name: string; code: string }[] {
    return this.ctl.macros;
  }

  static check(name: string, code: string): { line: number; message: string }[] {
    try {
      basic.parseModule(name, code);
      return [];
    } catch (e) {
      if (e instanceof basic.BasicSyntaxError) return [{ line: e.line, message: e.message }];
      throw e;
    }
  }

  private hooks(): basic.HostHooks {
    return {
      print: this.print,
      msgBox: (p, b, t) => msgBox(p, b, t),
      inputBox: (p, t, d) => (typeof window.prompt === 'function' ? window.prompt(`${t}\n\n${p}`, d) : null),
      objects: { ...WORD_CONSTANTS, ...this.objects() },
      functions: {
        rgb: (a) => (Math.trunc(toNum(a[0])) & 255) | ((Math.trunc(toNum(a[1])) & 255) << 8) | ((Math.trunc(toNum(a[2])) & 255) << 16),
      },
    };
  }

  load(force = false): { module: string; line: number; message: string }[] {
    const key = JSON.stringify(this.modules);
    if (!force && this.interp && key === this.key) return this.errors;
    this.interp = new basic.Interpreter(this.hooks(), this.limits);
    this.errors = this.interp.load(this.modules.map((m) => ({ name: m.name, source: m.code }))).map((e) => ({ module: e.module, line: e.line, message: e.message }));
    this.key = key;
    return this.errors;
  }

  procedures(): basic.ProcInfo[] {
    this.load();
    return this.interp?.procedures() ?? [];
  }
  hasProcedure(name: string): boolean {
    this.load();
    return !this.errors.length && !!this.interp?.hasProcedure(name);
  }

  private report(e: unknown): MacroRun {
    if (e instanceof basic.BasicError) return { ok: false, error: e.full, at: e.module && e.line ? { module: e.module, line: e.line } : undefined };
    if (e instanceof basic.AbortRun) return { ok: false, error: e.message };
    if (e instanceof basic.BasicSyntaxError) return { ok: false, error: `Error de sintaxis, línea ${e.line}: ${e.message}`, at: { module: 'Inmediato', line: e.line } };
    return { ok: false, error: (e as Error).message };
  }

  run(name: string, args: BVal[] = []): MacroRun {
    this.lastAt = undefined;
    if (!this.ctl.contentEnabled) return { ok: false, error: 'El contenido activo está deshabilitado en este archivo.' };
    const errors = this.load();
    if (errors.length) {
      this.lastAt = { module: errors[0]!.module, line: errors[0]!.line };
      return { ok: false, error: `Hay errores de sintaxis: ${errors.map((e) => `${e.module}, línea ${e.line}: ${e.message}`).join(' · ')}`, at: this.lastAt };
    }
    if (!this.interp!.hasProcedure(name)) return { ok: false, error: `No existe el procedimiento "${name}".` };
    return this.guarded(() => ({ ok: true, value: this.interp!.call(name, args) }));
  }

  immediate(src: string): MacroRun {
    if (!this.ctl.contentEnabled) return { ok: false, error: 'El contenido activo está deshabilitado en este archivo.' };
    this.load();
    return this.guarded(() => {
      this.interp!.immediate(src);
      return { ok: true };
    });
  }

  private guarded(fn: () => MacroRun): MacroRun {
    if (++this.depth > 20) {
      this.depth--;
      return { ok: false, error: 'Demasiadas llamadas anidadas.' };
    }
    let result: MacroRun;
    const v = this.ctl.mainView;
    // everything a macro does is one step of the history: the first change starts a group and the rest are appended to it
    let root: Transaction | null = null;
    const original = v?.dispatch;
    if (v && this.depth === 1) {
      v.dispatch(closeHistory(v.state.tr));
      const orig = original!.bind(v);
      v.dispatch = (tr: Transaction) => {
        if (root) tr.setMeta('appendedTransaction', root);
        else if (tr.docChanged) root = tr;
        orig(tr);
      };
    }
    try {
      result = fn();
    } catch (e) {
      result = this.report(e);
      this.lastAt = result.at;
    } finally {
      if (v && original && this.depth === 1) v.dispatch = original;
      this.depth--;
    }
    this.ctl.touch();
    return result;
  }

  /** Document_Open / AutoOpen, after the document opens with active content enabled. */
  runOpenHandlers(): void {
    if (!this.ctl.contentEnabled || !this.modules.length) return;
    for (const name of ['AutoOpen', 'Document_Open']) {
      if (this.hasProcedure(name)) {
        const r = this.run(name);
        if (!r.ok) this.print(`⚠ ${name}: ${r.error}`);
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ objects
  private objects(): Record<string, BVal> {
    const rt = this;
    const ctl = this.ctl;
    const view = () => {
      const v = ctl.mainView;
      if (!v) throw new BasicError(91, 'No hay un documento abierto.');
      return v;
    };
    const story = (): Story => buildStory(view().state.doc);
    const rangeObj = (start: number, end: number): BObject => new RangeImpl(rt, start, end).obj();
    const selection = () => {
      const v = view();
      const s = story();
      return { s, start: posToOffset(s, v.state.selection.from), end: posToOffset(s, v.state.selection.to) };
    };

    const paragraphs = () =>
      make({
        type: 'Paragraphs',
        props: { count: { get: () => story().blocks.length }, first: { get: () => paragraphObj(0) }, last: { get: () => paragraphObj(story().blocks.length - 1) } },
        methods: { add: () => { const s = story(); const v = view(); const at = s.blocks.length ? offsetToPos(s, s.text.length - 1) : 1; v.dispatch(v.state.tr.split(at)); return paragraphObj(story().blocks.length - 1); } },
        index: (a) => paragraphObj(toNum(a[0]) - 1),
        items: () => story().blocks.map((_b, i) => paragraphObj(i)),
      });
    const paragraphObj = (i: number): BObject => {
      const s = story();
      if (i < 0 || i >= s.blocks.length) throw new BasicError(5, 'El número del párrafo está fuera del intervalo.');
      const b = s.blocks[i]!;
      const end = (s.blocks[i + 1]?.off ?? s.text.length + 1) - 1;
      const r = new RangeImpl(rt, b.off, end + 1);
      return make({
        type: 'Paragraph',
        props: {
          range: { get: () => r.obj() },
          format: { get: () => r.paragraphFormat() },
          alignment: { get: () => r.paragraphFormat().get('alignment', []), set: (v) => r.paragraphFormat().set('alignment', [], v) },
          style: { get: () => r.get('style'), set: (v) => r.setProp('style', v) },
          next: { get: () => (i + 1 < story().blocks.length ? paragraphObj(i + 1) : null) },
        },
        methods: { delete: () => r.delete() },
      });
    };

    const tables = () => {
      const list = () => {
        const out: { pos: number; node: import('prosemirror-model').Node }[] = [];
        view().state.doc.descendants((n, pos) => {
          if (n.type.name === 'table') {
            out.push({ pos, node: n });
            return false;
          }
          return true;
        });
        return out;
      };
      const tableObj = (i: number): BObject => {
        const t = list()[i];
        if (!t) throw new BasicError(5, 'La tabla no existe.');
        const cellRange = (r: number, c: number): BObject => {
          const cur = list()[i]!;
          const row = cur.node.maybeChild(r - 1);
          const cell = row?.maybeChild(c - 1);
          if (!row || !cell) throw new BasicError(5, 'La celda no existe.');
          let pos = cur.pos + 1;
          for (let k = 0; k < r - 1; k++) pos += cur.node.child(k).nodeSize;
          pos += 1;
          for (let k = 0; k < c - 1; k++) pos += row.child(k).nodeSize;
          // the cell content starts one position inside
          const s = story();
          const start = posToOffset(s, pos + 1);
          const end = posToOffset(s, pos + cell.nodeSize - 1) - 1;
          return new RangeImpl(rt, start, Math.max(start, end)).obj();
        };
        return make({
          type: 'Table',
          props: {
            rows: { get: () => make({ type: 'Rows', props: { count: { get: () => list()[i]!.node.childCount } }, methods: { add: () => { const cur = list()[i]!; const v = view(); const last = cur.node.lastChild!; v.dispatch(v.state.tr.insert(cur.pos + cur.node.nodeSize - 1, last.type.create(null, last.content.content.map((c) => c.type.create(c.attrs, nodeTypes.paragraph!.create()))))); return undefined; } } }) },
            columns: { get: () => make({ type: 'Columns', props: { count: { get: () => list()[i]!.node.firstChild?.childCount ?? 0 } } }) },
            range: { get: () => { const cur = list()[i]!; const s = story(); return rangeObj(posToOffset(s, cur.pos + 1), posToOffset(s, cur.pos + cur.node.nodeSize - 1)); } },
          },
          methods: { cell: (a) => make({ type: 'Cell', props: { range: { get: () => cellRange(toNum(a[0]), toNum(a[1])) } } }), delete: () => { const cur = list()[i]!; view().dispatch(view().state.tr.delete(cur.pos, cur.pos + cur.node.nodeSize)); return undefined; } },
        });
      };
      return make({
        type: 'Tables',
        props: { count: { get: () => list().length } },
        methods: {
          add: (a) => {
            const v = view();
            const rows = Math.max(1, Math.trunc(toNum(a[1])));
            const cols = Math.max(1, Math.trunc(toNum(a[2])));
            const at = a[0] instanceof Object && 'typeName' in (a[0] as object) ? offsetToPos(story(), toNum((a[0] as BObject).get('start', []))) : v.state.selection.from;
            const $p = v.state.doc.resolve(at);
            const rowsN = Array.from({ length: rows }, () => nodeTypes.table_row!.create(null, Array.from({ length: cols }, () => nodeTypes.table_cell!.create({ colwidth: [100] }, nodeTypes.paragraph!.create()))));
            const after = $p.after($p.depth);
            v.dispatch(v.state.tr.insert(after, nodeTypes.table!.create({ borders: true }, rowsN)));
            return tableObj(list().findIndex((t) => t.pos === after));
          },
        },
        index: (a) => tableObj(toNum(a[0]) - 1),
        items: () => list().map((_t, i) => tableObj(i)),
      });
    };

    const bookmarks = () => {
      const find = () => {
        const out: { name: string; pos: number }[] = [];
        view().state.doc.descendants((n, pos) => {
          if (n.type.name === 'bookmark') out.push({ name: String(n.attrs.name), pos });
          return true;
        });
        return out;
      };
      const bm = (name: string): BObject => {
        const f = find().find((b) => b.name.toLowerCase() === name.toLowerCase());
        if (!f) throw new BasicError(5, `No existe el marcador "${name}".`);
        const o = posToOffset(story(), f.pos);
        return make({ type: 'Bookmark', props: { name: { get: () => f.name }, range: { get: () => rangeObj(o, o) }, start: { get: () => o }, end: { get: () => o } }, methods: { delete: () => { const cur = find().find((b) => b.name === f.name); if (cur) view().dispatch(view().state.tr.delete(cur.pos, cur.pos + 1)); return undefined; } } });
      };
      return make({
        type: 'Bookmarks',
        props: { count: { get: () => find().length } },
        methods: {
          add: (a) => {
            const name = toStr(a[0]);
            if (!/^[A-Za-z_][\w]*$/.test(name)) throw new BasicError(5, 'El nombre del marcador no es válido.');
            const s = story();
            const at = a[1] && typeof a[1] === 'object' ? offsetToPos(s, toNum((a[1] as BObject).get('start', []))) : view().state.selection.from;
            const v = view();
            v.dispatch(v.state.tr.insert(at, nodeTypes.bookmark!.create({ name })));
            return bm(name);
          },
          exists: (a) => find().some((b) => b.name.toLowerCase() === toStr(a[0]).toLowerCase()),
        },
        index: (a) => bm(toStr(a[0])),
        items: () => find().map((b) => bm(b.name)),
      });
    };

    const comments = () =>
      make({
        type: 'Comments',
        props: { count: { get: () => ctl.comments.length } },
        methods: {
          add: (a) => {
            const v = view();
            const s = story();
            const r = a[0] && typeof a[0] === 'object' ? (a[0] as BObject) : null;
            const from = r ? offsetToPos(s, toNum(r.get('start', []))) : v.state.selection.from;
            const to = r ? offsetToPos(s, toNum(r.get('end', []))) : v.state.selection.to;
            v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, from, Math.max(from, to))));
            const data = addCommentMark(v, a[1] === undefined ? '' : toStr(a[1]), getUser());
            if (data) {
              ctl.comments = [...ctl.comments, data];
              ctl.touch();
            }
            return undefined;
          },
        },
        index: (a) => {
          const c = ctl.comments[toNum(a[0]) - 1];
          if (!c) throw new BasicError(5, 'El comentario no existe.');
          return make({ type: 'Comment', props: { author: { get: () => c.author }, range: { get: () => rangeObj(0, 0) }, done: { get: () => c.done } } });
        },
      });

    const revisions = () =>
      make({
        type: 'Revisions',
        props: { count: { get: () => listChanges(view().state.doc).length } },
        methods: {
          acceptall: () => { applyChanges(view(), listChanges(view().state.doc), true); return undefined; },
          rejectall: () => { applyChanges(view(), listChanges(view().state.doc), false); return undefined; },
        },
      });

    const sections = (): BObject =>
      make({
        type: 'Sections',
        props: { count: { get: () => ctl.sections().length } },
        index: (a) => {
          const i = toNum(a[0]) - 1;
          const info = ctl.sections()[i];
          if (!info) throw new BasicError(5, 'La sección no existe.');
          const page = () => ctl.sections()[i]!.props.page;
          const setPage = (patch: Partial<typeof info.props.page>) => ctl.setSectionProps(i, { page: { ...page(), ...patch } }, true);
          return make({
            type: 'Section',
            props: {
              pagesetup: {
                get: () =>
                  make({
                    type: 'PageSetup',
                    props: {
                      pagewidth: { get: () => page().width, set: (v) => setPage({ width: toNum(v) }) },
                      pageheight: { get: () => page().height, set: (v) => setPage({ height: toNum(v) }) },
                      leftmargin: { get: () => page().marginLeft, set: (v) => setPage({ marginLeft: toNum(v) }) },
                      rightmargin: { get: () => page().marginRight, set: (v) => setPage({ marginRight: toNum(v) }) },
                      topmargin: { get: () => page().marginTop, set: (v) => setPage({ marginTop: toNum(v) }) },
                      bottommargin: { get: () => page().marginBottom, set: (v) => setPage({ marginBottom: toNum(v) }) },
                      orientation: { get: () => (page().width > page().height ? 1 : 0), set: (v) => { const p = page(); const land = toNum(v) === 1; if ((p.width > p.height) !== land) setPage({ width: p.height, height: p.width }); } },
                    },
                  }),
              },
            },
          });
        },
        items: (): BVal[] => ctl.sections().map((_s, i) => sections().index!([i + 1])),
      });

    const selectionObj = (): BObject => {
      const sel = () => selection();
      const asRange = () => new RangeImpl(rt, sel().start, sel().end);
      const setSel = (a: number, b: number) => {
        const v = view();
        const s = story();
        v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, offsetToPos(s, a), offsetToPos(s, b))).scrollIntoView());
      };
      const unitEnd = (unit: number, from: number, dir: 1 | -1, count: number): number => {
        const s = story();
        let o = from;
        for (let k = 0; k < count; k++) {
          if (unit === 1) o += dir;
          else if (unit === 2) {
            const re = /\S+/g;
            if (dir === 1) {
              re.lastIndex = o;
              const m = re.exec(s.text);
              if (m) o = m.index + m[0].length + (s.text[m.index + m[0].length] === ' ' ? 1 : 0);
              else o = s.text.length;
            } else {
              let i = o - 1;
              while (i > 0 && /\s/.test(s.text[i]!)) i--;
              while (i > 0 && !/\s/.test(s.text[i - 1]!)) i--;
              o = Math.max(0, i);
            }
          } else if (unit === 4 || unit === 5) {
            if (dir === 1) {
              const i = s.text.indexOf('\r', o);
              o = i < 0 ? s.text.length : i + 1;
            } else {
              const i = s.text.lastIndexOf('\r', Math.max(0, o - 2));
              o = i < 0 ? 0 : i + 1;
            }
          } else if (unit === 6) o = dir === 1 ? s.text.length : 0;
        }
        return Math.max(0, Math.min(o, s.text.length));
      };
      const move = (dir: 1 | -1) => (a: BVal[]) => {
        const unit = a[0] === undefined ? 1 : toNum(a[0]);
        const count = a[1] === undefined ? 1 : toNum(a[1]);
        const extend = a[2] !== undefined && toNum(a[2]) === 1;
        const { start, end } = sel();
        const head = dir === 1 ? end : start;
        const moved = unitEnd(unit, head, dir, count);
        if (extend) setSel(Math.min(start, moved), Math.max(end, moved));
        else setSel(moved, moved);
        return undefined;
      };
      return make({
        type: 'Selection',
        props: {
          text: { get: () => asRange().get('text'), set: (v) => asRange().setProp('text', v) },
          start: { get: () => sel().start, set: (v) => setSel(toNum(v), Math.max(toNum(v), sel().end)) },
          end: { get: () => sel().end, set: (v) => setSel(Math.min(sel().start, toNum(v)), toNum(v)) },
          font: { get: () => asRange().font() },
          paragraphformat: { get: () => asRange().paragraphFormat() },
          range: { get: () => asRange().obj() },
          style: { get: () => asRange().get('style'), set: (v) => asRange().setProp('style', v) },
          type: { get: () => (sel().start === sel().end ? 1 : 2) },
          find: { get: () => asRange().find() },
          paragraphs: { get: () => make({ type: 'Paragraphs', props: { count: { get: () => blocksIn(sel().s, sel().start, sel().end).length } } }) },
        },
        methods: {
          typetext: (a) => { const r = asRange(); const { start, end } = sel(); r.replace(toStr(a[0])); const n = start + toStr(a[0]).length; void end; setSel(n, n); return undefined; },
          typeparagraph: () => { const v = view(); v.dispatch(v.state.tr.split(v.state.selection.from)); return undefined; },
          typebackspace: () => { const { start, end } = sel(); if (start !== end) asRange().delete(); else if (start > 0) new RangeImpl(rt, start - 1, start).delete(); return undefined; },
          insertafter: (a) => { asRange().insertAfter(toStr(a[0])); return undefined; },
          insertbefore: (a) => { asRange().insertBefore(toStr(a[0])); return undefined; },
          delete: () => asRange().delete(),
          collapse: (a) => { const { start, end } = sel(); const p = a[0] !== undefined && toNum(a[0]) === 0 ? end : start; setSel(p, p); return undefined; },
          wholestory: () => { setSel(0, story().text.length - 1); return undefined; },
          selectall: () => { setSel(0, story().text.length - 1); return undefined; },
          moveright: move(1),
          moveleft: move(-1),
          moveup: move(-1),
          movedown: move(1),
          homekey: (a) => { const unit = a[0] === undefined ? 6 : toNum(a[0]); const { start } = sel(); const extend = a[1] !== undefined && toNum(a[1]) === 1; const t = unit === 5 || unit === 4 ? Math.max(0, story().text.lastIndexOf('\r', start - 1) + 1) : 0; if (extend) setSel(t, sel().end); else setSel(t, t); return undefined; },
          endkey: (a) => { const unit = a[0] === undefined ? 6 : toNum(a[0]); const { end } = sel(); const extend = a[1] !== undefined && toNum(a[1]) === 1; const s = story(); const i = s.text.indexOf('\r', end); const t = unit === 5 || unit === 4 ? (i < 0 ? s.text.length - 1 : i) : s.text.length - 1; if (extend) setSel(sel().start, t); else setSel(t, t); return undefined; },
          copy: () => { document.execCommand?.('copy'); return undefined; },
        },
      });
    };

    const documentObj = (): BObject =>
      make({
        type: 'Document',
        props: {
          content: { get: () => rangeObj(0, story().text.length - 1) },
          paragraphs: { get: () => paragraphs() },
          tables: { get: () => tables() },
          bookmarks: { get: () => bookmarks() },
          comments: { get: () => comments() },
          revisions: { get: () => revisions() },
          sections: { get: () => sections() },
          footnotes: { get: () => make({ type: 'Footnotes', props: { count: { get: () => ctl.notes().filter((n) => n.kind === 'footnote').length } } }) },
          trackrevisions: { get: () => ctl.trackChanges, set: (v) => { ctl.trackChanges = toBool(v); ctl.touch(); } },
          name: { get: () => ctl.fileName ?? 'Documento1' },
          fullname: { get: () => ctl.filePath ?? ctl.fileName ?? 'Documento1' },
          saved: { get: () => !ctl.dirty },
          characters: { get: () => make({ type: 'Characters', props: { count: { get: () => story().text.length - story().blocks.length + story().blocks.length } } }) },
          words: { get: () => make({ type: 'Words', props: { count: { get: () => ctl.words().total } } }) },
          title: { get: () => ctl.title ?? '', set: (v) => { ctl.title = toStr(v); ctl.dirty = true; } },
          readonly: { get: () => ctl.readOnly },
        },
        methods: {
          range: (a) => { const t = story().text.length - 1; return rangeObj(a[0] === undefined ? 0 : toNum(a[0]), a[1] === undefined ? t : toNum(a[1])); },
          undo: () => { document.execCommand?.('undo'); return true; },
          select: () => { const s = story(); const v = view(); v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, offsetToPos(s, 0), offsetToPos(s, s.text.length - 1)))); return undefined; },
          updatefields: () => { void import('./refs-actions').then((m) => m.updateFields(ctl)); return undefined; },
        },
      });

    const app = make({
      type: 'Application',
      props: {
        name: { get: () => 'Nova Writer' },
        version: { get: () => '0.0.4' },
        activedocument: { get: () => documentObj() },
        selection: { get: () => selectionObj() },
        statusbar: { get: () => '', set: (v) => this.print(`[barra de estado] ${toStr(v)}`) },
        screenupdating: { get: () => true, set: () => undefined },
        displayalerts: { get: () => 0, set: () => undefined },
        username: { get: () => getUser().name },
      },
      methods: { quit: () => undefined, screenrefresh: () => undefined },
    });
    return {
      application: app,
      activedocument: documentObj(),
      thisdocument: documentObj(),
      selection: selectionObj(),
      documents: make({ type: 'Documents', props: { count: { get: () => 1 } }, index: () => documentObj(), items: () => [documentObj()] }),
    };
  }
}

// ---------------------------------------------------------------------------------------------------- Range
class RangeImpl {
  start: number;
  end: number;
  constructor(readonly rt: WriterRuntime, start: number, end: number) {
    this.start = Math.max(0, Math.min(start, end));
    this.end = Math.max(start, end);
  }
  private get view() {
    const v = this.rt.ctl.mainView;
    if (!v) throw new BasicError(91, 'No hay un documento abierto.');
    return v;
  }
  private story() {
    return buildStory(this.view.state.doc);
  }
  private clamp(s: Story) {
    const max = Math.max(0, s.text.length - 1);
    this.start = Math.min(this.start, max);
    this.end = Math.min(this.end, max + (this.end > max ? 1 : 0));
  }
  text(): string {
    const s = this.story();
    this.clamp(s);
    return s.text.slice(this.start, this.end).replace(/￼/g, '');
  }
  replace(text: string): void {
    const s = this.story();
    this.clamp(s);
    const v = this.view;
    const from = offsetToPos(s, this.start);
    const to = offsetToPos(s, this.end);
    const parts = text.split(/\r\n|\r|\n/);
    const tr = v.state.tr;
    const marks = v.state.doc.resolve(from).marks();
    if (to > from) tr.delete(from, to);
    let pos = from;
    parts.forEach((part, i) => {
      if (i > 0) {
        tr.split(pos);
        pos += 2;
      }
      if (part) {
        tr.insert(pos, writerSchema.text(part, marks));
        pos += part.length;
      }
    });
    v.dispatch(tr);
    this.end = this.start + text.length;
  }
  insertAfter(text: string): void {
    const e = this.end;
    new RangeImpl(this.rt, e, e).replace(text);
    this.end = e + text.length;
  }
  insertBefore(text: string): void {
    new RangeImpl(this.rt, this.start, this.start).replace(text);
    this.end += text.length;
  }
  delete(): BVal {
    if (this.end > this.start) {
      const s = this.story();
      const v = this.view;
      v.dispatch(v.state.tr.delete(offsetToPos(s, this.start), offsetToPos(s, this.end)));
    }
    this.end = this.start;
    return undefined;
  }
  private positions() {
    const s = this.story();
    return { from: offsetToPos(s, this.start), to: offsetToPos(s, this.end), s };
  }
  private applyMark(name: string, attrs: Record<string, unknown> | null, on: boolean) {
    const { from, to } = this.positions();
    if (from >= to) return;
    const type = writerSchema.marks[name]!;
    const v = this.view;
    v.dispatch(on ? v.state.tr.addMark(from, to, type.create(attrs ?? undefined)) : v.state.tr.removeMark(from, to, type));
  }
  private hasMark(name: string): boolean {
    const { from, to } = this.positions();
    return from < to && this.view.state.doc.rangeHasMark(from, to, writerSchema.marks[name]!);
  }
  private markAttr(name: string, attr: string): unknown {
    const { from, to } = this.positions();
    let out: unknown;
    this.view.state.doc.nodesBetween(from, to, (n) => {
      const m = n.marks.find((x) => x.type.name === name);
      if (m && out === undefined) out = m.attrs[attr];
    });
    return out;
  }
  font(): BObject {
    const toggle = (name: string) => ({ get: () => (this.hasMark(name) ? -1 : 0) as BVal, set: (v: BVal) => this.applyMark(name, null, toNum(v) !== 0 && v !== false) });
    return make({
      type: 'Font',
      props: {
        bold: toggle('strong'),
        italic: toggle('em'),
        underline: { get: () => (this.hasMark('underline') ? 1 : 0), set: (v) => this.applyMark('underline', null, toNum(v) !== 0) },
        strikethrough: toggle('strike'),
        superscript: toggle('superscript'),
        subscript: toggle('subscript'),
        size: { get: () => (this.markAttr('fontSize', 'value') as number | undefined) ?? 11, set: (v) => this.applyMark('fontSize', { value: toNum(v) }, true) },
        name: { get: () => (this.markAttr('fontFamily', 'value') as string | undefined) ?? 'Calibri', set: (v) => this.applyMark('fontFamily', { value: toStr(v) }, true) },
        color: { get: () => { const c = this.markAttr('color', 'value') as string | undefined; return c ? hexToBgr(c) : -16777216; }, set: (v) => { const n = toNum(v); if (n === -16777216) this.applyMark('color', null, false); else this.applyMark('color', { value: bgrToHex(n) }, true); } },
      },
    });
  }
  paragraphFormat(): BObject {
    const edit = (fn: (attrs: Record<string, unknown>) => Record<string, unknown>) => {
      const s = this.story();
      const v = this.view;
      const tr = v.state.tr;
      for (const b of blocksIn(s, this.start, this.end)) tr.setNodeMarkup(b.pos - 1, undefined, fn({ ...b.node.attrs }));
      v.dispatch(tr);
    };
    const first = () => blocksIn(this.story(), this.start, this.end)[0]?.node.attrs ?? {};
    const AL = ['left', 'center', 'right', 'justify'];
    return make({
      type: 'ParagraphFormat',
      props: {
        alignment: { get: () => Math.max(0, AL.indexOf((first().align as string) ?? 'left')), set: (v) => edit((a) => ({ ...a, align: AL[toNum(v)] === 'left' ? null : AL[toNum(v)] ?? null })) },
        leftindent: { get: () => (first().indentLeft as number) ?? 0, set: (v) => edit((a) => ({ ...a, indentLeft: toNum(v) })) },
        rightindent: { get: () => (first().indentRight as number) ?? 0, set: (v) => edit((a) => ({ ...a, indentRight: toNum(v) })) },
        firstlineindent: { get: () => (first().indentFirst as number) ?? 0, set: (v) => edit((a) => ({ ...a, indentFirst: toNum(v) })) },
        spacebefore: { get: () => (first().spaceBefore as number) ?? 0, set: (v) => edit((a) => ({ ...a, spaceBefore: toNum(v) })) },
        spaceafter: { get: () => (first().spaceAfter as number) ?? 8, set: (v) => edit((a) => ({ ...a, spaceAfter: toNum(v) })) },
        keepwithnext: { get: () => (first().keepNext ? -1 : 0), set: (v) => edit((a) => ({ ...a, keepNext: toBool(v) })) },
        pagebreakbefore: { get: () => (first().pageBreakBefore ? -1 : 0), set: (v) => edit((a) => ({ ...a, pageBreakBefore: toBool(v) })) },
      },
    });
  }
  find(): BObject {
    const state = { text: '', replacement: '', matchCase: false, wholeWord: false };
    const execute = (a: BVal[]): boolean => {
      if (a[0] !== undefined) state.text = toStr(a[0]);
      if (a[1] !== undefined) state.matchCase = toBool(a[1]);
      if (a[2] !== undefined) state.wholeWord = toBool(a[2]);
      const withText = a[9] !== undefined ? toStr(a[9]) : state.replacement;
      const mode = a[10] !== undefined ? toNum(a[10]) : 0;
      if (!state.text) return false;
      const s = this.story();
      const hay = state.matchCase ? s.text : s.text.toLowerCase();
      const needle = state.matchCase ? state.text : state.text.toLowerCase();
      const hits: number[] = [];
      for (let i = hay.indexOf(needle, this.start); i >= 0 && i + needle.length <= this.end; i = hay.indexOf(needle, i + needle.length)) {
        if (state.wholeWord && (/\w/.test(hay[i - 1] ?? '') || /\w/.test(hay[i + needle.length] ?? ''))) continue;
        hits.push(i);
        if (mode !== 2) break;
      }
      if (!hits.length) return false;
      if (mode === 0) {
        this.start = hits[0]!;
        this.end = hits[0]! + needle.length;
        const v = this.view;
        const s2 = this.story();
        v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, offsetToPos(s2, this.start), offsetToPos(s2, this.end))));
        return true;
      }
      for (const h of hits.reverse()) new RangeImpl(this.rt, h, h + needle.length).replace(withText);
      return true;
    };
    return make({
      type: 'Find',
      props: {
        text: { get: () => state.text, set: (v) => { state.text = toStr(v); } },
        matchcase: { get: () => state.matchCase, set: (v) => { state.matchCase = toBool(v); } },
        matchwholeword: { get: () => state.wholeWord, set: (v) => { state.wholeWord = toBool(v); } },
        forward: { get: () => true, set: () => undefined },
        wrap: { get: () => 0, set: () => undefined },
        replacement: { get: () => make({ type: 'Replacement', props: { text: { get: () => state.replacement, set: (v) => { state.replacement = toStr(v); } } } }) },
      },
      methods: { execute, clearformatting: () => undefined },
    });
  }
  get(member: string): BVal {
    switch (member) {
      case 'text': return this.text();
      case 'style': {
        const b = blocksIn(this.story(), this.start, this.end)[0];
        return STYLE_LABEL[(b?.node.attrs.style as string) ?? 'Normal'] ?? 'Normal';
      }
    }
    return undefined;
  }
  setProp(member: string, v: BVal): void {
    if (member === 'text') this.replace(toStr(v));
    else if (member === 'style') {
      const id = STYLE_BY_NAME[toStr(v).toLowerCase()];
      if (!id) throw new BasicError(5, `No existe el estilo "${toStr(v)}".`);
      const s = this.story();
      const view = this.view;
      const tr = view.state.tr;
      for (const b of blocksIn(s, this.start, this.end)) tr.setNodeMarkup(b.pos - 1, undefined, { ...b.node.attrs, style: id === 'Normal' ? null : id });
      view.dispatch(tr);
    }
  }
  obj(): BObject {
    const self = this;
    return make({
      type: 'Range',
      props: {
        text: { get: () => self.text(), set: (v) => self.replace(toStr(v)) },
        start: { get: () => self.start, set: (v) => { self.start = Math.max(0, toNum(v)); if (self.end < self.start) self.end = self.start; } },
        end: { get: () => self.end, set: (v) => { self.end = Math.max(self.start, toNum(v)); } },
        font: { get: () => self.font() },
        paragraphformat: { get: () => self.paragraphFormat() },
        find: { get: () => self.find() },
        style: { get: () => self.get('style'), set: (v) => self.setProp('style', v) },
        bold: { get: () => self.font().get('bold', []), set: (v) => self.font().set('bold', [], v) },
        italic: { get: () => self.font().get('italic', []), set: (v) => self.font().set('italic', [], v) },
        paragraphs: { get: () => make({ type: 'Paragraphs', props: { count: { get: () => blocksIn(self.story(), self.start, self.end).length } } }) },
        words: { get: () => make({ type: 'Words', props: { count: { get: () => (self.text().match(/\S+/g) ?? []).length } } }) },
        characters: { get: () => make({ type: 'Characters', props: { count: { get: () => self.text().length } } }) },
      },
      methods: {
        insertafter: (a) => { self.insertAfter(toStr(a[0])); return undefined; },
        insertbefore: (a) => { self.insertBefore(toStr(a[0])); return undefined; },
        delete: () => self.delete(),
        select: () => {
          const v = self.view;
          const s = self.story();
          v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, offsetToPos(s, self.start), offsetToPos(s, self.end))).scrollIntoView());
          return undefined;
        },
        collapse: (a) => { if (a[0] !== undefined && toNum(a[0]) === 0) self.start = self.end; else self.end = self.start; return undefined; },
        setrange: (a) => { self.start = toNum(a[0]); self.end = Math.max(self.start, toNum(a[1])); return undefined; },
        insertparagraphafter: () => { self.insertAfter('\r'); return undefined; },
      },
    });
  }
}

void VArray;
