import { BUILTIN_NAMES, builtin, createObject, type BuiltinCtx } from './builtins';
import { BasicSyntaxError } from './lexer';
import { parseExpression, parseModule, parseStatements, type Arg, type CaseTest, type Decl, type EnumDef, type Expr, type ModuleAst, type Param, type Proc, type Stmt, type TypeDef } from './parser';
import { BasicError, ERR, NOTHING, VArray, binaryOp, coerceTo, compareValues, dateToText, defaultFor, isNothing, isObject, negate, not, toNum, toStr, truthy, type BObject, type BVal } from './values';

/** What the program can reach in the host application. */
/** The files a program can use: a flat store of text files that lives inside the database (it never touches the disk). */
export interface Vfs {
  read(path: string): string | null;
  write(path: string, text: string): void;
  remove(path: string): void;
  list(): string[];
}

export interface HostHooks {
  print(text: string): void;
  /** Files for `Open`, `Print #`, `Kill`, `Dir`… */
  vfs?: Vfs;
  msgBox(prompt: string, buttons: number, title: string): number;
  inputBox(prompt: string, title: string, def: string): string | null;
  /** Objects by name: CurrentDb, DoCmd, Forms, Me, TempVars… */
  objects?: Record<string, BVal>;
  /** Functions by name that are not in the standard library: DLookup, DCount… (lower case). */
  functions?: Record<string, (args: BVal[], named: Record<string, BVal>) => BVal>;
  /** Replaces the clock (tests). */
  now?: () => Date;
}

export interface Limits {
  /** Statements executed before the program is stopped. */
  maxSteps: number;
  maxMillis: number;
  maxDepth: number;
}
const DEFAULT_LIMITS: Limits = { maxSteps: 20_000_000, maxMillis: 20_000, maxDepth: 100 };

/** Where a debug session stopped. `depth` is the number of procedures being run (1 = the one that was started). */
export interface DebugPause {
  module: string;
  line: number;
  proc: string;
  depth: number;
}

export type DebugStep = 'into' | 'over' | 'out' | 'continue';

export interface DebugVar {
  name: string;
  type: string;
  value: string;
}

/** A program run that can stop at breakpoints and be stepped. Created by `Interpreter.debug`. */
export interface DebugSession {
  readonly state: 'paused' | 'done' | 'error';
  /** Where it is stopped (state `paused`). */
  readonly pause: DebugPause | null;
  /** What the procedure returned (state `done`). */
  readonly value: BVal;
  /** What stopped it (state `error`). */
  readonly error: unknown;
  /** Goes on: `into` and `over` stop at the next statement (`over` skips what the procedures it calls do), `out` when the procedure ends, `continue` at the next breakpoint. */
  step(mode: DebugStep): void;
  /** The procedures being run, the innermost first. */
  stack(): { proc: string; module: string; line: number }[];
  /** The variables of a procedure of the stack (0 = the innermost) and the module-level ones. */
  locals(frame?: number): DebugVar[];
  /** Evaluates an expression or runs statements in the frame where it is stopped, and returns the text of the value. */
  evaluate(src: string, frame?: number): string;
  /** Changes the breakpoints (`module:line`) while it is stopped. */
  setBreakpoints(list: Iterable<string>): void;
  /** Ends the run (the procedures' cleanup still happens). */
  stop(): void;
}

/** The text a debugger shows for a value. */
export function describeValue(v: BVal): string {
  if (v === null) return 'Null';
  if (v === undefined) return 'Empty';
  if (typeof v === 'string') return `"${v.length > 200 ? v.slice(0, 200) + '…' : v}"`;
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return `#${dateToText(v)}#`;
  if (v instanceof VArray) return `Matriz(${v.dims.map((d) => `${d.lo} a ${d.hi}`).join(', ')})`;
  if (v === NOTHING) return 'Nothing';
  return 'Objeto';
}

/** Thrown when the program has to stop for good (limits): scripts cannot catch it. */
export class AbortRun extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbortRun';
  }
}

interface Ref {
  v: BVal;
  /** The name as written (for the variables window). */
  name?: string;
  type?: string;
  isConst?: boolean;
  /** A `WithEvents` field of a class: the object it holds is wired to the `field_Event` procedures of `owner`. */
  withEvents?: string;
  owner?: ClassInstance;
}

type Signal = undefined | 'exitsub' | 'exitfunction' | 'exitfor' | 'exitdo' | { goto: string } | { resume: 'next' | 'here' | { label: string } };

/** A class module: its fields, and its methods and properties by name. */
export interface ClassDef {
  name: string;
  ast: ModuleAst;
  methods: Map<string, { call?: Proc; get?: Proc; let?: Proc; set?: Proc }>;
}

interface OpenFile {
  path: string;
  mode: 'input' | 'output' | 'append';
  text: string;
  pos: number;
}

/** A value of a user-defined `Type`: assigning it makes a copy. */
export class TypeInstance implements BObject {
  constructor(
    readonly def: TypeDef,
    readonly fields: Map<string, Ref>,
  ) {}
  get typeName(): string {
    return this.def.name;
  }
  private ref(member: string): Ref {
    const r = this.fields.get(lc(member));
    if (!r) throw ERR.notSupported(member);
    return r;
  }
  get(member: string, args: BVal[]): BVal {
    const r = this.ref(member);
    if (args.length && r.v instanceof VArray) return r.v.get(args.map((a) => Math.trunc(toNum(a))));
    return r.v;
  }
  set(member: string, args: BVal[], value: BVal): void {
    const r = this.ref(member);
    if (args.length && r.v instanceof VArray) {
      r.v.set(args.map((a) => Math.trunc(toNum(a))), r.type ? coerceTo(r.type, value) : value);
      return;
    }
    r.v = r.type ? coerceTo(r.type, value) : value;
    escapeValue(r.v);
    if (r.v instanceof TypeInstance) r.v = r.v.clone();
  }
  clone(): TypeInstance {
    const fields = new Map<string, Ref>();
    for (const [k, r] of this.fields) {
      let v = r.v;
      if (v instanceof TypeInstance) v = v.clone();
      else if (v instanceof VArray) {
        const a = new VArray(v.dims);
        a.data = v.data.map((x) => (x instanceof TypeInstance ? x.clone() : x));
        v = a;
      }
      fields.set(k, { ...r, v });
    }
    return new TypeInstance(this.def, fields);
  }
}

/** An object made from a class module with `New`. */
export class ClassInstance implements BObject {
  readonly fields = new Map<string, Ref>();
  readonly vis = new Map<string, 'public' | 'private'>();
  /** Procedures of other objects that listen to the events of this one, by event name (lower case). */
  readonly handlers = new Map<string, { target: ClassInstance; proc: Proc; field: string }[]>();
  /** How many variables and fields hold the object (for `Class_Terminate`). */
  refs = 0;
  /** Stored where it cannot be followed (a collection, an array…): it is only terminated when the interpreter is discarded. */
  escaped = false;
  terminated = false;
  constructor(
    readonly interp: Interpreter,
    readonly cls: ClassDef,
  ) {}
  get typeName(): string {
    return this.cls.name;
  }
  ifaceMember(k: string, _what: string): { call?: Proc; get?: Proc; let?: Proc; set?: Proc } | undefined {
    for (const im of this.cls.ast.implements) {
      const m = this.cls.methods.get(`${lc(im.name)}_${k}`);
      if (m) return m;
    }
    return undefined;
  }
  private named(args: BVal[]): { name?: string; value: BVal }[] {
    const nm = (args as unknown as { named?: Record<string, BVal> }).named ?? {};
    return [...args.map((value) => ({ value })), ...Object.entries(nm).map(([name, value]) => ({ name, value }))];
  }
  get(member: string, args: BVal[]): BVal {
    const k = lc(member);
    const f = this.fields.get(k);
    if (f && this.vis.get(k) === 'public') return args.length && f.v instanceof VArray ? f.v.get(args.map((a) => Math.trunc(toNum(a)))) : f.v;
    const m = this.cls.methods.get(k);
    const p = m?.call ?? m?.get;
    if (p && p.isPublic) return this.interp.callMethod(p, this.named(args), this);
    // a member of an interface the class implements: `IForma_Area` answers to `Area`
    for (const im of this.cls.ast.implements) {
      const im2 = this.cls.methods.get(`${lc(im.name)}_${k}`);
      const ip = im2?.call ?? im2?.get;
      if (ip) return this.interp.callMethod(ip, this.named(args), this);
    }
    throw ERR.notSupported(member);
  }
  set(member: string, args: BVal[], value: BVal): void {
    const k = lc(member);
    const f = this.fields.get(k);
    if (f && this.vis.get(k) === 'public') {
      if (args.length && f.v instanceof VArray) {
        escapeValue(value);
        f.v.set(args.map((a) => Math.trunc(toNum(a))), value);
      } else this.interp.storeRef(f, f.type ? coerceTo(f.type, value) : value instanceof TypeInstance ? value.clone() : value);
      return;
    }
    const m = this.cls.methods.get(k) ?? this.ifaceMember(k, 'let');
    const objectLike = isObject(value) || isNothing(value);
    const p = objectLike ? (m?.set ?? m?.let) : (m?.let ?? m?.set);
    if (p && (p.isPublic || p.name.includes('_'))) {
      this.interp.callMethod(p, [...this.named(args), { value }], this);
      return;
    }
    throw ERR.notSupported(member);
  }
}

const escapeValue = (v: BVal): void => {
  if (v instanceof ClassInstance) v.escaped = true;
};

interface Frame {
  self?: ClassInstance;
  proc: Proc | null;
  module: string;
  vars: Map<string, Ref>;
  withs: BVal[];
  handler: { mode: 'none' | 'next' | 'label'; label?: string };
  inHandler: boolean;
  /** Index of the top-level statement that was running when an error was raised (for Resume). */
  top: number;
  /** The top-level statement that raised the error being handled. */
  errTop: number;
  line: number;
  retRef?: Ref;
}

export interface ProcInfo {
  name: string;
  module: string;
  kind: Proc['kind'];
  params: Param[];
  isPublic: boolean;
  line: number;
}

const CONSTANT_LIST: Record<string, BVal> = {
  vbcrlf: '\r\n', vbcr: '\r', vblf: '\n', vbtab: '\t', vbnewline: '\r\n', vbnullstring: '', vbnullchar: '\0', vbback: '\b', vbformfeed: '\f', vbverticaltab: '\v',
  vbokonly: 0, vbokcancel: 1, vbabortretryignore: 2, vbyesnocancel: 3, vbyesno: 4, vbretrycancel: 5,
  vbcritical: 16, vbquestion: 32, vbexclamation: 48, vbinformation: 64, vbdefaultbutton1: 0, vbdefaultbutton2: 256, vbdefaultbutton3: 512,
  vbok: 1, vbcancel: 2, vbabort: 3, vbretry: 4, vbignore: 5, vbyes: 6, vbno: 7,
  acnext: 1, acprevious: 0, acfirst: 2, aclast: 3, acgoto: 4, acnewrec: 5,
  vbbinarycompare: 0, vbtextcompare: 1, vbdatabasecompare: 2,
  vbuppercase: 1, vblowercase: 2, vbpropercase: 3,
  vbsunday: 1, vbmonday: 2, vbtuesday: 3, vbwednesday: 4, vbthursday: 5, vbfriday: 6, vbsaturday: 7,
  dbopentable: 1, dbopendynaset: 2, dbopensnapshot: 4, dbopenforwardonly: 8, dbfailonerror: 128, dbseechanges: 512,
  acnormal: 0, acviewnormal: 0, acviewdesign: 1, acviewpreview: 2, acdialog: 3, acwindownormal: 0, acform: 2, acreport: 3, actable: 0, acquery: 1, acmacro: 4, acmodule: 5,
  vbempty: 0, vbnull: 1, vbinteger: 2, vblong: 3, vbdouble: 5, vbdate: 7, vbstring: 8, vbobject: 9, vbboolean: 11, vbvariant: 12,
  pi: Math.PI,
};

const CONSTANTS = new Map<string, BVal>(Object.entries(CONSTANT_LIST));
/** Own properties only: a name such as "constructor" must not reach the JavaScript runtime. */
const own = <T>(o: Record<string, T> | undefined, k: string): T | undefined => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const lc = (s: string) => s.toLowerCase().replace(/\$$/, '');

const isLvalue = (e: Expr): boolean => e.k === 'id';
const COMPOUND = new Set(['if', 'select', 'for', 'foreach', 'do', 'with']);
const FILE_FNS = new Set(['eof', 'lof', 'freefile', 'dir', 'kill', 'filecopy', 'filelen']);

export class Interpreter {
  private modules = new Map<string, ModuleAst>();
  private procs = new Map<string, Proc>();
  private globals = new Map<string, Ref>();
  private explicitModules = new Set<string>();
  private types = new Map<string, TypeDef>();
  private classes = new Map<string, ClassDef>();
  private setters = new Map<string, Proc>();
  private userConsts = new Map<string, BVal>();
  private enumObjs = new Map<string, BObject>();
  private files = new Map<number, OpenFile>();
  private dirQueue: string[] = [];
  private live = new Set<ClassInstance>();
  private pending = new Set<ClassInstance>();
  private running = 0;
  private sync = 0;
  private stack: Frame[] = [];
  private dbg: { breaks: Set<string>; mode: 'run' | 'into' | 'over' | 'out'; depth: number } | null = null;
  private limits: Limits;
  private steps = 0;
  private startedAt = 0;
  private depth = 0;
  private seed = 1;
  private lastLine = 0;
  private lastModule = '';
  private lastProc = '';
  /** Err object contents. */
  err = { number: 0, description: '', source: '' };
  private objects: Record<string, BVal>;
  private ctx: BuiltinCtx;

  constructor(
    readonly host: HostHooks,
    limits: Partial<Limits> = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.objects = Object.assign(Object.create(null) as Record<string, BVal>, host.objects ?? {});
    this.ctx = {
      now: () => (this.host.now ? this.host.now() : new Date()),
      random: () => this.random(),
      reseed: (s) => {
        this.seed = (Math.floor(Math.abs(s)) % 2147483647) + 1;
      },
      msgBox: (p, b, t) => this.host.msgBox(p, b, t),
      inputBox: (p, t, d) => this.host.inputBox(p, t, d),
    };
  }

  private random(): number {
    // mulberry32: deterministic once seeded
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Make an object available to the program under a name (for example `Me`). */
  setObject(name: string, v: BVal): void {
    this.objects[lc(name)] = v;
  }
  clearObject(name: string): void {
    delete this.objects[lc(name)];
  }

  // ---------------------------------------------------------------------------------------- loading

  /** Parse the modules. Returns the syntax errors found (the modules without errors are loaded). */
  load(sources: { name: string; source: string; kind?: 'module' | 'class' }[]): (BasicSyntaxError & { module: string })[] {
    this.modules.clear();
    this.procs.clear();
    this.globals.clear();
    this.explicitModules.clear();
    this.types.clear();
    this.classes.clear();
    this.setters.clear();
    this.userConsts.clear();
    this.enumObjs.clear();
    this.files.clear();
    this.dispose();
    const errors: (BasicSyntaxError & { module: string })[] = [];
    const all: ModuleAst[] = [];
    for (const s of sources) {
      try {
        const ast = parseModule(s.name, s.source);
        all.push(ast);
        if (s.kind === 'class') {
          const cd: ClassDef = { name: s.name, ast, methods: new Map() };
          for (const p of ast.procs) {
            const m = cd.methods.get(lc(p.name)) ?? {};
            if (p.kind === 'sub' || p.kind === 'function') m.call = p;
            else m[p.kind] = p;
            cd.methods.set(lc(p.name), m);
          }
          this.classes.set(lc(s.name), cd);
        } else this.modules.set(s.name, ast);
      } catch (e) {
        if (e instanceof BasicSyntaxError) errors.push(Object.assign(e, { module: s.name }));
        else throw e;
      }
    }
    for (const m of this.modules.values()) {
      if (m.explicit) this.explicitModules.add(m.name);
      for (const p of m.procs) {
        const key = lc(p.name);
        if (p.kind === 'let' || p.kind === 'set') {
          this.setters.set(key, p);
          continue;
        }
        const prev = this.procs.get(key);
        if (prev) {
          errors.push(Object.assign(new BasicSyntaxError(`El procedimiento "${p.name}" ya está definido en ${prev.module}.`, p.line), { module: m.name }));
          continue;
        }
        this.procs.set(key, p);
      }
    }
    // a class that implements an interface has to answer for every public member of it
    for (const cd of this.classes.values()) {
      for (const im of cd.ast.implements) {
        const iface = this.classes.get(lc(im.name));
        if (!iface) {
          errors.push(Object.assign(new BasicSyntaxError(`Implements: no existe la clase "${im.name}".`, im.line), { module: cd.name }));
          continue;
        }
        for (const pr of iface.ast.procs) {
          if (!pr.isPublic || /^class_(initialize|terminate)$/i.test(pr.name)) continue;
          const slot = pr.kind === 'sub' || pr.kind === 'function' ? 'call' : pr.kind;
          const mine = cd.methods.get(`${lc(im.name)}_${lc(pr.name)}`);
          if (!mine || !mine[slot === 'call' ? 'call' : slot]) errors.push(Object.assign(new BasicSyntaxError(`La clase ${cd.name} implementa ${iface.name} pero le falta ${im.name}_${pr.name}.`, im.line), { module: cd.name }));
        }
      }
    }
    // types and enumerations (they can be used from every module)
    for (const ast of all) for (const t of ast.types) this.types.set(lc(t.name), t);
    const frame0 = this.newFrame(null, '');
    for (const ast of all) {
      for (const e of ast.enums as EnumDef[]) {
        let nextVal = 0;
        const members = new Map<string, BVal>();
        try {
          for (const m of e.members) {
            const v = m.value ? Math.trunc(toNum(this.evalIn(m.value, frame0))) : nextVal;
            nextVal = v + 1;
            this.userConsts.set(lc(m.name), v);
            members.set(lc(m.name), v);
          }
        } catch (err) {
          errors.push(Object.assign(new BasicSyntaxError(`Enum ${e.name}: ${(err as Error).message}`, e.line), { module: ast.name }));
        }
        this.enumObjs.set(lc(e.name), {
          typeName: e.name,
          get: (member) => {
            const v = members.get(lc(member));
            if (v === undefined) throw ERR.notSupported(member);
            return v;
          },
          set: (member) => {
            throw ERR.notSupported(member);
          },
        });
      }
    }
    // module-level variables and constants
    for (const m of this.modules.values()) {
      const frame = this.newFrame(null, m.name);
      for (const d of m.decls) {
        if (d.k === 'dim') this.declare(d.decls, d.isConst, frame, this.globals);
      }
    }
    return errors;
  }

  procedures(): ProcInfo[] {
    return [...this.procs.values()].map((p) => ({ name: p.name, module: p.module, kind: p.kind, params: p.params, isPublic: p.isPublic, line: p.line }));
  }
  hasProcedure(name: string): boolean {
    return this.procs.has(lc(name));
  }
  classNames(): string[] {
    return [...this.classes.values()].map((c) => c.name);
  }

  /** Call a method or property of a class instance (used by the instance itself). */
  callMethod(p: Proc, args: { name?: string; value: BVal }[], self: ClassInstance): BVal {
    return this.callProc(p, args, null, self);
  }

  /** A new object of a class module: fields set up, then `Class_Initialize`. */
  private instantiate(cd: ClassDef): ClassInstance {
    const inst = new ClassInstance(this, cd);
    this.live.add(inst);
    this.pending.add(inst);
    const frame = this.newFrame(null, cd.name);
    frame.self = inst;
    for (const d of cd.ast.decls) {
      if (d.k !== 'dim') continue;
      this.declare(d.decls, d.isConst, frame, inst.fields);
      for (const x of d.decls) {
        inst.vis.set(lc(x.name), d.vis === 'public' ? 'public' : 'private');
        const ref = inst.fields.get(lc(x.name));
        if (ref && d.withEvents) {
          ref.withEvents = x.type ?? '';
          ref.owner = inst;
        }
      }
    }
    const init = cd.methods.get('class_initialize')?.call;
    if (init) this.callProc(init, [], null, inst);
    return inst;
  }

  // ---------------------------------------------------------------------------------------- object lifetime

  /** A variable or field now holds the value. */
  retain(v: BVal): void {
    if (v instanceof ClassInstance) v.refs++;
  }
  /** A variable or field stopped holding the value: at zero the object is terminated at the next statement. */
  release(v: BVal): void {
    if (v instanceof ClassInstance && --v.refs <= 0) this.pending.add(v);
  }
  /** Put a value in a variable or field, keeping the counts. */
  storeRef(r: Ref, value: BVal): void {
    const old = r.v;
    this.retain(value);
    r.v = value;
    this.release(old);
    if (r.withEvents && r.owner) this.rewire(r, old, value);
  }
  private rewire(r: Ref, old: BVal, now: BVal): void {
    const field = [...r.owner!.fields].find(([, x]) => x === r)?.[0];
    if (!field) return;
    if (old instanceof ClassInstance) for (const [ev, hs] of old.handlers) old.handlers.set(ev, hs.filter((h) => !(h.target === r.owner && h.field === field)));
    if (!(now instanceof ClassInstance)) return;
    for (const ev of now.cls.ast.events) {
      const proc = r.owner!.cls.methods.get(`${field}_${lc(ev.name)}`)?.call;
      if (!proc) continue;
      const list = now.handlers.get(lc(ev.name)) ?? [];
      list.push({ target: r.owner!, proc, field });
      now.handlers.set(lc(ev.name), list);
    }
  }
  private flushPending(): void {
    while (this.pending.size) {
      const next = this.pending.values().next().value as ClassInstance;
      this.pending.delete(next);
      if (next.refs <= 0 && !next.escaped && !next.terminated) this.terminate(next);
    }
  }
  private terminate(inst: ClassInstance): void {
    if (inst.terminated) return;
    inst.terminated = true;
    this.live.delete(inst);
    const t = inst.cls.methods.get('class_terminate')?.call;
    try {
      if (t) this.callProc(t, [], null, inst);
    } finally {
      for (const r of inst.fields.values()) this.release(r.v);
    }
  }
  /** Terminate every object that is still alive (the interpreter is being discarded). Errors of `Class_Terminate` are ignored. */
  dispose(runHandlers = true): void {
    if (!runHandlers) {
      this.live.clear();
      this.pending.clear();
      return;
    }
    this.running++;
    try {
      this.flushPendingSafe();
      for (const inst of [...this.live]) {
        try {
          this.terminate(inst);
        } catch {
          /* ignored: the program is over */
        }
      }
    } finally {
      this.running--;
      this.live.clear();
      this.pending.clear();
    }
  }
  private flushPendingSafe(): void {
    try {
      this.flushPending();
    } catch {
      /* ignored */
    }
  }

  private defaultOf(type?: string): BVal {
    if (type) {
      const k = lc(type);
      const td = this.types.get(k);
      if (td) return this.newType(td);
      if (this.classes.has(k)) return NOTHING;
      if (this.enumObjs.has(k)) return 0;
    }
    return defaultFor(type);
  }
  private newType(td: TypeDef): TypeInstance {
    const fields = new Map<string, Ref>();
    this.declare(td.fields, false, this.newFrame(null, ''), fields);
    return new TypeInstance(td, fields);
  }
  private newArray(dims: { lo: number; hi: number }[], type?: string): VArray {
    const a = new VArray(dims, defaultFor(type));
    if (type && this.types.has(lc(type))) for (let i = 0; i < a.data.length; i++) a.data[i] = this.defaultOf(type);
    return a;
  }

  // ---------------------------------------------------------------------------------------- running

  private begin(): void {
    this.steps = 0;
    this.depth = 0;
    this.startedAt = Date.now();
  }

  /** Run a procedure by name. A function returns its value. Errors that no handler caught are thrown as BasicError. */
  call(name: string, args: BVal[] = []): BVal {
    const p = this.procs.get(lc(name));
    if (!p) throw ERR.undefinedName(name);
    this.begin();
    this.running++;
    try {
      const v = this.callProc(p, args.map((v) => ({ value: v })), null);
      this.flushPending();
      return v;
    } catch (e) {
      throw this.finish(e);
    } finally {
      if (--this.running === 0) {
        this.closeAllFiles();
        this.flushPendingSafe();
      }
    }
  }

  /** Run one or more statements typed in the immediate window. A line that starts with `?` prints the value of an expression. */
  immediate(src: string): void {
    const body = parseStatements(src);
    this.begin();
    const frame = this.newFrame(null, 'Inmediato');
    this.running++;
    try {
      this.execList(body, frame, true);
      this.flushPending();
    } catch (e) {
      throw this.finish(e);
    } finally {
      if (--this.running === 0) {
        this.closeAllFiles();
        this.flushPendingSafe();
      }
    }
  }

  // ---------------------------------------------------------------------------------------- debugging

  private pauseCheck(f: Frame, s: Stmt): DebugPause | null {
    const d = this.dbg!;
    const depth = this.stack.length;
    const hit = d.breaks.has(`${f.module}:${s.line}`);
    const step = d.mode === 'into' || (d.mode === 'over' && depth <= d.depth) || (d.mode === 'out' && depth < d.depth);
    if (!hit && !step) return null;
    d.mode = 'run';
    f.line = s.line;
    return { module: f.module, line: s.line, proc: f.proc?.name ?? '', depth };
  }

  private *debugRun(p: Proc, args: BVal[]): Generator<DebugPause, BVal, void> {
    try {
      const v = yield* this.callProcG(p, args.map((value) => ({ value })), null);
      this.flushPending();
      return v;
    } catch (e) {
      throw this.finish(e);
    } finally {
      this.dbg = null;
      this.stack = [];
      if (--this.running === 0) {
        this.closeAllFiles();
        this.flushPendingSafe();
      }
    }
  }

  /**
   * Runs a procedure under a debugger. It stops at the first statement when `stopAtStart` is set, at the breakpoints (`module:line`) and as
   * the steps ask. It only stops at the statements of the procedures: what a function does when it is called inside an expression
   * (`x = F(2)`) runs without stopping; a procedure called as a statement (`Call F`, `F 2`) can be stepped into.
   */
  debug(name: string, args: BVal[] = [], opts: { breakpoints?: Iterable<string>; stopAtStart?: boolean } = {}): DebugSession {
    const p = this.procs.get(lc(name));
    if (!p) throw ERR.undefinedName(name);
    if (this.running > 0) throw new BasicError(5, 'Ya hay un programa en ejecución.');
    this.begin();
    this.running++;
    this.stack = [];
    this.dbg = { breaks: new Set(opts.breakpoints ?? []), mode: opts.stopAtStart ? 'into' : 'run', depth: 0 };
    const gen = this.debugRun(p, args);
    const me = this;
    let pausedAt = 0;
    const session: { state: 'paused' | 'done' | 'error'; pause: DebugPause | null; value: BVal; error: unknown } & DebugSession = {
      state: 'paused',
      pause: null,
      value: undefined,
      error: undefined,
      step(mode) {
        if (session.state !== 'paused') return;
        const d = me.dbg!;
        d.mode = mode === 'continue' ? 'run' : mode;
        d.depth = session.pause?.depth ?? 0;
        me.startedAt += Date.now() - pausedAt; // the time spent looking is not the program's
        advance();
      },
      stack: () => me.stack.map((f) => ({ proc: f.proc?.name ?? '', module: f.module, line: f.line })).reverse(),
      locals(frame = 0) {
        const f = me.stack[me.stack.length - 1 - frame];
        if (!f) return [];
        const out: DebugVar[] = [];
        // a ByRef parameter is the caller's variable: it is shown with the name the procedure gives it
        for (const [k, r] of f.vars) out.push({ name: f.proc?.params.find((x) => lc(x.name) === k)?.name ?? (r.name !== undefined && lc(r.name) === k ? r.name : k), type: r.type ?? 'Variant', value: describeValue(r.v) });
        for (const [k, r] of me.globals) if (r.name !== undefined || !f.vars.has(k)) out.push({ name: r.name ?? k, type: r.type ?? 'Variant', value: describeValue(r.v) });
        return out;
      },
      evaluate(src, frame = 0) {
        const f = me.stack[me.stack.length - 1 - frame];
        if (!f) throw new BasicError(5, 'El programa no está detenido.');
        const trimmed = src.trim();
        const asValue = trimmed.startsWith('?');
        const text = asValue ? trimmed.slice(1).trim() : trimmed;
        me.sync++;
        try {
          if (!asValue) {
            // like the immediate window: statements run (`a = 100`); what is not a statement is an expression whose value is shown
            let body: Stmt[] | null = null;
            try {
              body = parseStatements(text);
            } catch (e) {
              if (!(e instanceof BasicSyntaxError)) throw e;
            }
            if (body) {
              me.execList(body, f, true);
              return '';
            }
          }
          return describeValue(me.evalText(text, f));
        } finally {
          me.sync--;
        }
      },
      setBreakpoints(list) {
        if (me.dbg) me.dbg.breaks = new Set(list);
      },
      stop() {
        if (session.state === 'paused') {
          session.state = 'done';
          session.pause = null;
          gen.return(undefined);
        }
      },
    };
    const advance = () => {
      try {
        const r = gen.next();
        if (r.done) {
          session.state = 'done';
          session.pause = null;
          session.value = r.value;
        } else {
          session.state = 'paused';
          session.pause = r.value;
          pausedAt = Date.now();
        }
      } catch (e) {
        session.state = 'error';
        session.pause = null;
        session.error = e;
      }
    };
    advance();
    return session;
  }

  private finish(raw: unknown): unknown {
    const e = this.asBasic(raw);
    if (e instanceof BasicError) {
      e.line ??= this.lastLine || undefined;
      e.module ??= this.lastModule || undefined;
      e.proc ??= this.lastProc || undefined;
    }
    return e;
  }

  private tick(frame: Frame, line: number): void {
    frame.line = line;
    this.lastLine = line;
    this.lastModule = frame.module;
    this.lastProc = frame.proc?.name ?? '';
    if (this.pending.size) this.flushPending();
    if (++this.steps > this.limits.maxSteps) throw new AbortRun(`Se superó el límite de ${this.limits.maxSteps.toLocaleString('es-ES')} instrucciones: ¿hay un bucle sin fin?`);
    if ((this.steps & 4095) === 0 && Date.now() - this.startedAt > this.limits.maxMillis) throw new AbortRun(`El programa tardó más de ${Math.round(this.limits.maxMillis / 1000)} segundos y se detuvo: ¿hay un bucle sin fin?`);
  }

  private newFrame(proc: Proc | null, module: string): Frame {
    return { proc, module, vars: new Map(), withs: [], handler: { mode: 'none' }, inHandler: false, top: 0, errTop: 0, line: 0 };
  }

  /** Runs a generator to the end without ever pausing (breakpoints and steps only work in a debug session, at the statements of the procedures). */
  private drive<T>(g: Generator<DebugPause, T, void>): T {
    this.sync++;
    try {
      let r = g.next();
      while (!r.done) r = g.next();
      return r.value;
    } finally {
      this.sync--;
    }
  }

  private callProc(p: Proc, args: { name?: string; value?: BVal; ref?: Ref }[], caller: Frame | null, self?: ClassInstance): BVal {
    return this.drive(this.callProcG(p, args, caller, self));
  }

  private *callProcG(p: Proc, args: { name?: string; value?: BVal; ref?: Ref }[], caller: Frame | null, self?: ClassInstance): Generator<DebugPause, BVal, void> {
    if (++this.depth > this.limits.maxDepth) throw new BasicError(28, 'Espacio de pila agotado');
    let live: Frame | undefined;
    let pushed = false;
    const aliased = new Set<Ref>();
    if (self) this.retain(self);
    try {
      const frame = this.newFrame(p, p.module);
      live = frame;
      this.stack.push(frame);
      pushed = true;
      if (self) frame.self = self;
      // bind the arguments
      const named = new Map<string, (typeof args)[number]>();
      const positional: (typeof args)[number][] = [];
      for (const a of args) {
        if (a.name) named.set(lc(a.name), a);
        else positional.push(a);
      }
      p.params.forEach((prm, i) => {
        const key = lc(prm.name);
        if (prm.paramArray) {
          const rest = positional.slice(i).map((a) => a.ref?.v ?? a.value);
          rest.forEach(escapeValue);
          frame.vars.set(key, { v: VArray.of(rest), name: prm.name });
          return;
        }
        const given = named.get(key) ?? positional[i];
        const supplied = given !== undefined && !(given.value === undefined && given.ref === undefined && (given as { omitted?: boolean }).omitted);
        if (!supplied) {
          if (!prm.optional) throw new BasicError(449, `El argumento no es opcional: ${prm.name}`);
          frame.vars.set(key, { v: prm.def ? this.evalIn(prm.def, frame) : this.defaultOf(prm.type), type: prm.type, name: prm.name });
        } else if (given!.ref && prm.byRef) {
          frame.vars.set(key, given!.ref); // an alias of the caller's variable
          aliased.add(given!.ref);
        } else {
          let raw = given!.ref ? given!.ref.v : given!.value;
          if (raw instanceof TypeInstance) raw = raw.clone();
          const bound = prm.isArray ? raw : coerceTo(prm.type, raw);
          this.retain(bound);
          frame.vars.set(key, { v: bound, type: prm.type, name: prm.name });
        }
      });
      if (positional.length > p.params.length && !p.params.some((x) => x.paramArray)) throw new BasicError(450, 'Número de argumentos incorrecto o asignación de propiedad no válida');
      if (p.kind === 'function' || p.kind === 'get') {
        frame.retRef = { v: this.defaultOf(p.returns), type: p.returns };
        frame.vars.set(lc(p.name), frame.retRef);
      }
      // execute, with the error handler of the procedure
      let start = 0;
      for (;;) {
        try {
          const sig = yield* this.execListG(p.body, frame, true, start);
          if (sig && typeof sig === 'object' && 'resume' in sig) {
            frame.inHandler = false;
            const r = sig.resume;
            start = r === 'next' ? frame.errTop + 1 : r === 'here' ? frame.errTop : this.labelIndex(p.body, r.label);
            continue;
          }
          break;
        } catch (raw) {
          const e = this.asBasic(raw);
          if (e instanceof BasicError && frame.handler.mode === 'label' && !frame.inHandler) {
            e.line ??= frame.line;
            e.module ??= frame.module;
            e.proc ??= p.name;
            this.setErr(e);
            frame.errTop = frame.top;
            frame.inHandler = true;
            start = this.labelIndex(p.body, frame.handler.label!);
            continue;
          }
          throw e;
        }
      }
      void caller;
      return p.kind === 'function' || p.kind === 'get' ? frame.retRef!.v : undefined;
    } finally {
      this.depth--;
      if (pushed) this.stack.pop();
      // what the variables of this call held is released (the ones that alias a variable of the caller are not theirs)
      if (live) for (const r of live.vars.values()) if (!aliased.has(r)) this.release(r.v);
      if (self) this.release(self);
    }
  }

  private labelIdx = new WeakMap<Stmt[], Map<string, number>>();
  private labelIndex(list: Stmt[], name: string): number {
    let m = this.labelIdx.get(list);
    if (!m) {
      m = new Map();
      list.forEach((s, i) => s.k === 'label' && m!.set(lc(s.name), i));
      this.labelIdx.set(list, m);
    }
    const i = m.get(lc(name));
    if (i === undefined) throw new BasicError(35, `No se encontró la etiqueta: ${name}`);
    return i;
  }

  /** Errors of the host (a failing SQL statement…) become errors the program can handle; the limits and our own bugs do not. */
  private asBasic(e: unknown): unknown {
    if (e instanceof BasicError || e instanceof AbortRun) return e;
    if (e instanceof RangeError) return new BasicError(28, 'Espacio de pila agotado');
    if (e instanceof Error && !(e instanceof BasicSyntaxError)) return new BasicError(3000, e.message);
    return e;
  }

  private setErr(e: BasicError): void {
    this.err = { number: e.number, description: e.description, source: e.module ?? '' };
  }

  // ---------------------------------------------------------------------------------------- statements

  private execList(list: Stmt[], frame: Frame, top = false, from = 0): Signal {
    return this.drive(this.execListG(list, frame, top, from));
  }

  private *execListG(list: Stmt[], frame: Frame, top = false, from = 0): Generator<DebugPause, Signal, void> {
    let i = from;
    while (i < list.length) {
      const s = list[i]!;
      if (top) frame.top = i;
      let sig: Signal;
      try {
        if (this.dbg && !this.sync && s.k !== 'label' && s.k !== 'dim') {
          const pz = this.pauseCheck(frame, s);
          if (pz) yield pz;
        }
        if (COMPOUND.has(s.k)) sig = yield* this.execCompound(s, frame);
        else if (s.k === 'call' && this.dbg && !this.sync) sig = yield* this.execCallG(s, frame);
        else sig = this.exec(s, frame);
      } catch (raw) {
        const e = this.asBasic(raw);
        if (e instanceof BasicError && frame.handler.mode === 'next') {
          e.line ??= s.line;
          e.module ??= frame.module;
          this.setErr(e);
          i++;
          continue;
        }
        throw e;
      }
      if (sig) {
        if (typeof sig === 'object' && 'goto' in sig) {
          const m = this.labelIdx.get(list) ?? (this.labelIndexSafe(list), this.labelIdx.get(list)!);
          const to = m.get(lc(sig.goto));
          if (to !== undefined) {
            i = to;
            continue;
          }
        }
        return sig;
      }
      i++;
    }
    return undefined;
  }

  private labelIndexSafe(list: Stmt[]): void {
    const m = new Map<string, number>();
    list.forEach((s, i) => s.k === 'label' && m.set(lc(s.name), i));
    this.labelIdx.set(list, m);
  }

  /** The statements that hold other statements: they run as generators so that a pause can happen inside them. */
  private *execCompound(s: Stmt, f: Frame): Generator<DebugPause, Signal, void> {
    this.tick(f, s.line);
    switch (s.k) {
      case 'if': {
        for (const b of s.branches) {
          if (truthy(this.evalIn(b.cond, f))) return yield* this.execListG(b.body, f);
        }
        return s.else ? yield* this.execListG(s.else, f) : undefined;
      }
      case 'select': {
        const v = this.evalIn(s.expr, f);
        for (const c of s.cases) {
          if (c.tests === 'else' || c.tests.some((t) => this.caseMatches(t, v, f))) return yield* this.execListG(c.body, f);
        }
        return undefined;
      }
      case 'for': {
        const from = toNum(this.evalIn(s.from, f));
        const to = toNum(this.evalIn(s.to, f));
        const step = s.step ? toNum(this.evalIn(s.step, f)) : 1;
        if (step === 0) throw ERR.invalidCall('El paso de For no puede ser cero');
        this.assign(s.v, from, f);
        for (;;) {
          const i = toNum(this.evalIn(s.v, f));
          if (step > 0 ? i > to : i < to) break;
          this.tick(f, s.line);
          const sig = yield* this.execListG(s.body, f);
          if (sig === 'exitfor') break;
          if (sig) return sig;
          // the variable is read back: the body may have changed it
          this.assign(s.v, toNum(this.evalIn(s.v, f)) + step, f);
        }
        return undefined;
      }
      case 'foreach': {
        const coll = this.evalIn(s.coll, f);
        const items = coll instanceof VArray ? [...coll.data] : isObject(coll) && coll.items ? coll.items() : null;
        if (!items) throw ERR.objectRequired();
        for (const it of items) {
          this.assign(s.v, it, f);
          this.tick(f, s.line);
          const sig = yield* this.execListG(s.body, f);
          if (sig === 'exitfor') break;
          if (sig) return sig;
        }
        return undefined;
      }
      case 'do': {
        const test = (t: { until: boolean; cond: Expr }) => truthy(this.evalIn(t.cond, f)) !== t.until;
        for (;;) {
          if (s.pre && !test(s.pre)) break;
          this.tick(f, s.line);
          const sig = yield* this.execListG(s.body, f);
          if (sig === 'exitdo') break;
          if (sig) return sig;
          if (s.post && !test(s.post)) break;
        }
        return undefined;
      }
      case 'with': {
        const o = this.evalIn(s.obj, f);
        f.withs.push(o);
        this.retain(o);
        try {
          return yield* this.execListG(s.body, f);
        } finally {
          f.withs.pop();
          this.release(o);
        }
      }
      default:
        return this.exec(s, f);
    }
  }

  /** A call to a procedure of the program written as a statement: in a debug session it can be stepped into. */
  private *execCallG(s: Stmt & { k: 'call' }, f: Frame): Generator<DebugPause, Signal, void> {
    const e = s.expr;
    const name = e.k === 'id' ? e.name : e.k === 'call' && e.fn.k === 'id' ? e.fn.name : null;
    const key = name ? lc(name) : '';
    if (name && !f.vars.has(key) && !f.self?.fields.has(key) && !f.self?.cls.methods.has(key) && !this.globals.has(key)) {
      const proc = this.procs.get(key);
      if (proc) {
        this.tick(f, s.line);
        const a = this.argValues(e.k === 'call' ? e.args : [], f);
        yield* this.callProcG(proc, a.list, f);
        return undefined;
      }
    }
    return this.exec(s, f);
  }

  private exec(s: Stmt, f: Frame): Signal {
    this.tick(f, s.line);
    switch (s.k) {
      case 'dim':
        this.declare(s.decls, s.isConst, f, f.vars);
        return undefined;
      case 'redim':
        for (const d of s.decls) this.redim(d, s.preserve, f);
        return undefined;
      case 'erase':
        for (const n of s.names) {
          const r = this.findRef(n, f);
          if (r?.v instanceof VArray) r.v = new VArray(r.v.dims, defaultFor(r.type));
        }
        return undefined;
      case 'assign':
        this.assign(s.target, this.evalIn(s.value, f), f);
        return undefined;
      case 'call':
        this.execCall(s.expr, f);
        return undefined;
      case 'exit':
        return s.what === 'sub' ? 'exitsub' : s.what === 'function' ? 'exitfunction' : s.what === 'for' ? 'exitfor' : 'exitdo';
      case 'goto':
        return { goto: s.label };
      case 'label':
        return undefined;
      case 'onerror':
        f.handler = s.mode === 'zero' ? { mode: 'none' } : s.mode === 'next' ? { mode: 'next' } : { mode: 'label', label: s.label };
        if (s.mode === 'zero') f.inHandler = false;
        return undefined;
      case 'resume':
        return { resume: s.mode === 'label' ? { label: s.label! } : s.mode };
      case 'raiseevent': {
        const self = f.self;
        if (!self) throw new BasicError(5, 'RaiseEvent solo puede usarse dentro de un módulo de clase.');
        const ev = self.cls.ast.events.find((x) => lc(x.name) === lc(s.name));
        if (!ev) throw new BasicError(5, `El evento "${s.name}" no está declarado en la clase ${self.cls.name}.`);
        const vals = this.argValues(s.args, f).positional;
        for (const h of [...(self.handlers.get(lc(ev.name)) ?? [])]) {
          if (h.target.terminated) continue;
          this.callProc(h.proc, vals.map((value) => ({ value })), f, h.target);
        }
        return undefined;
      }
      case 'fopen': {
        const n = Math.trunc(toNum(this.evalIn(s.num, f)));
        if (this.files.has(n)) throw new BasicError(55, 'El archivo ya está abierto');
        const path = toStr(this.evalIn(s.path, f));
        const vfs = this.vfs();
        if (s.mode === 'input') {
          const text = vfs.read(path);
          if (text === null) throw new BasicError(53, `No se encuentra el archivo: ${path}`);
          this.files.set(n, { path, mode: 'input', text, pos: 0 });
        } else this.files.set(n, { path, mode: s.mode, text: s.mode === 'append' ? (vfs.read(path) ?? '') : '', pos: 0 });
        if (s.mode !== 'input') vfs.write(path, this.files.get(n)!.text);
        return undefined;
      }
      case 'fclose': {
        if (!s.nums.length) this.closeAllFiles();
        else for (const e of s.nums) this.closeFile(Math.trunc(toNum(this.evalIn(e, f))));
        return undefined;
      }
      case 'fprint': {
        const file = this.outFile(Math.trunc(toNum(this.evalIn(s.num, f))));
        let out = '';
        s.items.forEach((a, i) => {
          out += toStr(this.evalIn(a.value, f));
          if (i < s.seps.length && s.seps[i] === ',') out += '\t';
        });
        file.text += out + (s.seps.length >= s.items.length && s.items.length > 0 ? '' : '\n');
        return undefined;
      }
      case 'fwrite': {
        const file = this.outFile(Math.trunc(toNum(this.evalIn(s.num, f))));
        file.text += s.items.map((a) => this.writeField(this.evalIn(a.value, f))).join(',') + '\n';
        return undefined;
      }
      case 'finput': {
        const file = this.inFile(Math.trunc(toNum(this.evalIn(s.num, f))));
        for (const t of s.targets) this.assign(t, this.readField(file), f);
        return undefined;
      }
      case 'flineinput': {
        const file = this.inFile(Math.trunc(toNum(this.evalIn(s.num, f))));
        if (file.pos >= file.text.length) throw new BasicError(62, 'Entrada después del final del archivo');
        let end = file.text.indexOf('\n', file.pos);
        if (end < 0) end = file.text.length;
        const line = file.text.slice(file.pos, end).replace(/\r$/, '');
        file.pos = Math.min(file.text.length, end + 1);
        this.assign(s.target, line, f);
        return undefined;
      }
    }
  }

  // ---------------------------------------------------------------------------------------- files

  private vfs(): Vfs {
    if (!this.host.vfs) throw new BasicError(75, 'Este entorno no tiene archivos disponibles.');
    return this.host.vfs;
  }
  private outFile(n: number): OpenFile {
    const f = this.files.get(n);
    if (!f) throw new BasicError(52, 'Nombre o número de archivo incorrecto');
    if (f.mode === 'input') throw new BasicError(54, 'Modo de archivo incorrecto: está abierto para lectura');
    return f;
  }
  private inFile(n: number): OpenFile {
    const f = this.files.get(n);
    if (!f) throw new BasicError(52, 'Nombre o número de archivo incorrecto');
    if (f.mode !== 'input') throw new BasicError(54, 'Modo de archivo incorrecto: está abierto para escritura');
    return f;
  }
  private closeFile(n: number): void {
    const f = this.files.get(n);
    if (!f) return;
    this.files.delete(n);
    if (f.mode !== 'input' && this.host.vfs) this.host.vfs.write(f.path, f.text);
  }
  private closeAllFiles(): void {
    for (const n of [...this.files.keys()]) this.closeFile(n);
  }
  private writeField(v: BVal): string {
    if (v === null) return '#NULL#';
    if (typeof v === 'boolean') return v ? '#TRUE#' : '#FALSE#';
    if (typeof v === 'number') return toStr(v);
    if (v instanceof Date) return `#${toStr(v)}#`;
    return `"${toStr(v).replace(/"/g, '""')}"`;
  }
  /** The next field of `Input #`: separated by a comma or a line end; text may be quoted. */
  private readField(f: OpenFile): BVal {
    const t = f.text;
    while (f.pos < t.length && (t[f.pos] === ' ' || t[f.pos] === '\t' || t[f.pos] === '\r' || t[f.pos] === '\n')) f.pos++;
    if (f.pos >= t.length) throw new BasicError(62, 'Entrada después del final del archivo');
    if (t[f.pos] === '"') {
      let out = '';
      f.pos++;
      while (f.pos < t.length) {
        if (t[f.pos] === '"') {
          if (t[f.pos + 1] === '"') {
            out += '"';
            f.pos += 2;
            continue;
          }
          f.pos++;
          break;
        }
        out += t[f.pos++];
      }
      while (f.pos < t.length && t[f.pos] === ' ') f.pos++;
      if (t[f.pos] === ',') f.pos++;
      return out;
    }
    let end = f.pos;
    while (end < t.length && t[end] !== ',' && t[end] !== '\n') end++;
    const raw = t.slice(f.pos, end).replace(/\r$/, '').trim();
    f.pos = Math.min(t.length, end + 1);
    if (raw === '#NULL#') return null;
    if (raw === '#TRUE#') return true;
    if (raw === '#FALSE#') return false;
    if (raw !== '' && Number.isFinite(Number(raw))) return Number(raw);
    return raw;
  }
  private normPath(p: string): string {
    return p.replace(/\\/g, '/').replace(/^[a-z]:/i, '').replace(/^\/+/, '');
  }
  private glob(pattern: string): RegExp {
    const re = this.normPath(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${re}$`, 'i');
  }
  /** `EOF`, `LOF`, `FreeFile`, `Dir`, `Kill`, `FileCopy`, `FileLen`: the file functions (they need the state of the run). */
  private fileFn(key: string, a: BVal[]): { v: BVal } | null {
    switch (key) {
      case 'eof': {
        const f = this.files.get(Math.trunc(toNum(a[0])));
        if (!f) throw new BasicError(52, 'Nombre o número de archivo incorrecto');
        return { v: f.mode !== 'input' || f.pos >= f.text.length };
      }
      case 'lof': {
        const f = this.files.get(Math.trunc(toNum(a[0])));
        if (!f) throw new BasicError(52, 'Nombre o número de archivo incorrecto');
        return { v: f.text.length };
      }
      case 'freefile': {
        let n = 1;
        while (this.files.has(n)) n++;
        return { v: n };
      }
      case 'dir': {
        if (a.length && a[0] !== undefined) {
          const re = this.glob(toStr(a[0]));
          this.dirQueue = this.vfs().list().filter((x) => re.test(this.normPath(x)));
        }
        return { v: this.dirQueue.shift() ?? '' };
      }
      case 'kill': {
        const re = this.glob(toStr(a[0]));
        const hits = this.vfs().list().filter((x) => re.test(this.normPath(x)));
        if (!hits.length) throw new BasicError(53, `No se encuentra el archivo: ${toStr(a[0])}`);
        for (const h of hits) this.vfs().remove(h);
        return { v: undefined };
      }
      case 'filecopy': {
        const src = this.vfs().read(toStr(a[0]));
        if (src === null) throw new BasicError(53, `No se encuentra el archivo: ${toStr(a[0])}`);
        this.vfs().write(toStr(a[1]), src);
        return { v: undefined };
      }
      case 'filelen': {
        const src = this.vfs().read(toStr(a[0]));
        if (src === null) throw new BasicError(53, `No se encuentra el archivo: ${toStr(a[0])}`);
        return { v: src.length };
      }
    }
    return null;
  }

  private caseMatches(t: CaseTest, v: BVal, f: Frame): boolean {
    if (t.kind === 'value') return truthy(binaryOp('=', v, this.evalIn(t.v, f)));
    if (t.kind === 'range') {
      const lo = compareValues(v, this.evalIn(t.lo, f));
      const hi = compareValues(v, this.evalIn(t.hi, f));
      return lo !== null && hi !== null && lo >= 0 && hi <= 0;
    }
    return truthy(binaryOp(t.op, v, this.evalIn(t.v, f)));
  }

  // ---------------------------------------------------------------------------------------- variables

  private findRef(name: string, f: Frame): Ref | undefined {
    const k = lc(name);
    return f.vars.get(k) ?? f.self?.fields.get(k) ?? this.globals.get(k);
  }

  private declare(decls: Decl[], isConst: boolean, f: Frame, into: Map<string, Ref>): void {
    for (const d of decls) {
      const key = lc(d.name);
      if (into.has(key) && !isConst && into === f.vars) throw new BasicError(10, `Esta variable ya está declarada: ${d.name}`);
      if (d.dims) {
        const dims = d.dims.length ? d.dims.map((x) => ({ lo: x.lo ? Math.trunc(toNum(this.evalIn(x.lo, f))) : 0, hi: Math.trunc(toNum(this.evalIn(x.hi!, f))) })) : [{ lo: 0, hi: -1 }];
        into.set(key, { v: this.newArray(dims, d.type), type: d.type, name: d.name });
      } else if (isConst) {
        into.set(key, { v: this.evalIn(d.init!, f), type: d.type, isConst: true, name: d.name });
      } else {
        const cls = d.isNew && d.type ? this.classes.get(lc(d.type)) : undefined;
        const prior = into.get(key);
        const obj = cls ? this.instantiate(cls) : d.isNew && d.type ? createObject(d.type) : null;
        if (d.isNew && d.type && !obj) throw new BasicError(429, `No se puede crear el objeto: ${d.type}. Solo se admiten módulos de clase, Collection y Scripting.Dictionary.`);
        const made: Ref = { v: obj ?? this.defaultOf(d.type), type: d.type, name: d.name };
        into.set(key, made);
        this.retain(made.v);
        if (prior) this.release(prior.v);
      }
    }
  }

  private redim(d: Decl, preserve: boolean, f: Frame): void {
    const ref = this.findRef(d.name, f);
    const dims = (d.dims ?? []).map((x) => ({ lo: x.lo ? Math.trunc(toNum(this.evalIn(x.lo, f))) : 0, hi: Math.trunc(toNum(this.evalIn(x.hi!, f))) }));
    const fresh = this.newArray(dims, d.type ?? ref?.type);
    if (preserve && ref?.v instanceof VArray && ref.v.dims.length === 1 && dims.length === 1) {
      const old = ref.v;
      for (let i = Math.max(old.dims[0]!.lo, dims[0]!.lo); i <= Math.min(old.dims[0]!.hi, dims[0]!.hi); i++) fresh.set([i], old.get([i]));
    }
    if (ref) ref.v = fresh;
    else f.vars.set(lc(d.name), { v: fresh, type: d.type });
  }

  private assign(target: Expr, value: BVal, f: Frame): void {
    switch (target.k) {
      case 'id': {
        const ref = this.findRef(target.name, f);
        if (ref) {
          if (ref.isConst) throw new BasicError(5, `No se puede asignar a una constante: ${target.name}`);
          if (ref.v instanceof VArray && !(value instanceof VArray)) throw new BasicError(10, 'Esta matriz está fija o bloqueada temporalmente');
          let nv = ref.type ? coerceTo(ref.type, value) : value;
          if (nv instanceof TypeInstance) nv = nv.clone();
          this.storeRef(ref, nv);
          return;
        }
        const own = f.self?.cls.methods.get(lc(target.name));
        const setter = own ? (isObject(value) || isNothing(value) ? (own.set ?? own.let) : (own.let ?? own.set)) : this.setters.get(lc(target.name));
        if (setter) {
          this.callProc(setter, [{ value }], f, own ? f.self : undefined);
          return;
        }
        if (this.explicitModules.has(f.module)) throw new BasicError(35, `Variable no definida: ${target.name}`);
        f.vars.set(lc(target.name), { v: value });
        this.retain(value);
        return;
      }
      case 'call': {
        const args = target.args.map((a) => (a ? this.evalIn(a.value, f) : undefined));
        if (target.fn.k === 'id') {
          const ref = this.findRef(target.fn.name, f);
          if (ref?.v instanceof VArray) {
            escapeValue(value);
            ref.v.set(args.map((a) => Math.trunc(toNum(a))), ref.type ? coerceTo(ref.type, value) : value);
            return;
          }
          escapeValue(value);
          if (ref && isObject(ref.v) && ref.v.setIndex) return ref.v.setIndex(args, value);
          const g = this.objects[lc(target.fn.name)];
          if (isObject(g) && g.setIndex) return g.setIndex(args, value);
          throw ERR.undefinedName(target.fn.name);
        }
        if (target.fn.k === 'member') {
          const obj = this.evalObject(target.fn.obj, f, target.fn.name);
          if (!(obj instanceof ClassInstance)) escapeValue(value);
          obj.set(target.fn.name, args, value);
          return;
        }
        const base = this.evalIn(target.fn, f);
        escapeValue(value);
        if (base instanceof VArray) return base.set(args.map((a) => Math.trunc(toNum(a))), value);
        if (isObject(base) && base.setIndex) return base.setIndex(args, value);
        throw ERR.objectRequired();
      }
      case 'member': {
        const obj = this.evalObject(target.obj, f, target.name);
        if (!(obj instanceof ClassInstance)) escapeValue(value);
        obj.set(target.name, [], value);
        return;
      }
      case 'bang': {
        const obj = this.evalObject(target.obj, f, target.name);
        if (!obj.setIndex) throw ERR.notSupported(target.name);
        escapeValue(value);
        obj.setIndex([target.name], value);
        return;
      }
      default:
        throw new BasicError(5, 'No se puede asignar a esta expresión');
    }
  }

  private evalObject(e: Expr | null, f: Frame, member: string): BObject {
    const v = e === null ? f.withs[f.withs.length - 1] : this.evalIn(e, f);
    if (isNothing(v) || v === undefined || v === null) throw ERR.noObject();
    if (!isObject(v)) throw ERR.notSupported(member);
    return v;
  }

  // ---------------------------------------------------------------------------------------- calls

  /** A statement that is an expression: a call (its value is dropped), or just a name. */
  private execCall(e: Expr, f: Frame): void {
    if (e.k === 'null') return; // Option statements
    if (e.k === 'call' && e.fn.k === 'member' && e.fn.name.toLowerCase() === 'print' && e.fn.obj?.k === 'id' && lc(e.fn.obj.name) === 'debug') {
      let out = '';
      e.args.forEach((a, i) => {
        if (a) out += toStr(this.evalIn(a.value, f));
        if (i < (e.seps?.length ?? 0) && e.seps![i] === ',') out += '\t';
      });
      this.host.print(out);
      return;
    }
    this.evalIn(e, f, true);
  }

  private argValues(args: (Arg | null)[], f: Frame): { positional: BVal[]; named: Record<string, BVal>; refs: (Ref | undefined)[]; list: { name?: string; value?: BVal; ref?: Ref; omitted?: boolean }[] } {
    const positional: BVal[] = [];
    const named: Record<string, BVal> = Object.create(null);
    const refs: (Ref | undefined)[] = [];
    const list: { name?: string; value?: BVal; ref?: Ref; omitted?: boolean }[] = [];
    for (const a of args) {
      if (!a) {
        positional.push(undefined);
        refs.push(undefined);
        list.push({ omitted: true });
        continue;
      }
      const ref = isLvalue(a.value) ? this.findRef((a.value as { name: string }).name, f) : undefined;
      const value = ref ? ref.v : this.evalIn(a.value, f);
      if (a.name) {
        named[lc(a.name)] = value;
        list.push({ name: a.name, value });
      } else {
        positional.push(value);
        refs.push(ref);
        list.push({ value, ref });
      }
    }
    return { positional, named, refs, list };
  }

  private callNamed(name: string, args: (Arg | null)[], f: Frame): BVal {
    const key = lc(name);
    // inside a function, its own name is the return value: with arguments it is a (recursive) call
    const local = f.vars.get(key) ?? f.self?.fields.get(key) ?? this.globals.get(key);
    if (local && local !== f.retRef) {
      const v = local.v;
      const a = this.argValues(args, f);
      if (v instanceof VArray) return v.get(a.positional.map((x) => Math.trunc(toNum(x))));
      if (isObject(v) && v.index) return v.index(a.positional);
      throw ERR.typeMismatch(`"${name}" no es un procedimiento ni una matriz`);
    }
    const sm = f.self?.cls.methods.get(key);
    if (sm && (sm.call || sm.get)) return this.callProc((sm.call ?? sm.get)!, this.argValues(args, f).list, f, f.self);
    const proc = this.procs.get(key);
    if (proc) {
      const a = this.argValues(args, f);
      return this.callProc(proc, a.list, f);
    }
    if (key === 'eval') return this.evalText(toStr(this.argValues(args, f).positional[0]), f);
    if (key === 'run') {
      const a = this.argValues(args, f).positional;
      const target = this.procs.get(lc(toStr(a[0])));
      if (!target) throw ERR.undefinedName(toStr(a[0]));
      return this.callProc(target, a.slice(1).map((value) => ({ value })), f);
    }
    const hostFn = own(this.host.functions, key);
    if (hostFn) {
      const a = this.argValues(args, f);
      return hostFn(a.positional, a.named);
    }
    if (FILE_FNS.has(key)) return this.fileFn(key, this.argValues(args, f).positional)!.v;
    const fn = builtin(key);
    if (fn) {
      const a = this.argValues(args, f);
      let positional = a.positional;
      // named arguments of the standard functions are matched by position in the usual order
      if (Object.keys(a.named).length) positional = this.placeNamed(key, a.positional, a.named);
      return fn(positional, this.ctx);
    }
    const obj = this.objects[key];
    if (isObject(obj) && obj.index) return obj.index(this.argValues(args, f).positional);
    if (CONSTANTS.has(key)) throw ERR.typeMismatch(`"${name}" es una constante`);
    throw ERR.undefinedName(name);
  }

  /**
   * `Eval("texto")`: an expression of Nova Basic (its functions, the procedures of the modules, the variables of the caller) or, when
   * it is not one, one or more statements (`x = x + 1: Debug.Print x`). Fields of the current record are written `[Campo]`. What
   * Nova Basic does not know (`Sum([x])`…) is tried with the expression language of Nova Base.
   */
  private evalText(text: string, f: Frame): BVal {
    const src = text.replace(/"(?:[^"]|"")*"|\[([^\]]+)\]/g, (m, field?: string) => (field === undefined ? m : `__campo("${field.replace(/"/g, '""')}")`)).trim();
    if (!src) return null;
    let expression: Expr | null = null;
    try {
      expression = parseExpression(src);
    } catch (e) {
      if (!(e instanceof BasicSyntaxError)) throw e;
    }
    const fallback = (original: unknown): BVal => {
      const nova = own(this.host.functions, 'novaeval');
      if (!nova) throw original;
      try {
        return nova([text], {});
      } catch {
        throw original;
      }
    };
    if (expression) {
      try {
        return this.evalIn(expression, f);
      } catch (e) {
        const b = this.asBasic(e);
        if (b instanceof BasicError && b.number === 35) return fallback(b);
        throw b;
      }
    }
    let body: Stmt[];
    try {
      body = parseStatements(src);
    } catch (e) {
      if (!(e instanceof BasicSyntaxError)) throw e;
      return fallback(new BasicError(2482, `Eval: ${e.message}`));
    }
    this.execList(body, f);
    return undefined;
  }

  private placeNamed(fn: string, pos: BVal[], named: Record<string, BVal>): BVal[] {
    const order: Record<string, string[]> = {
      msgbox: ['prompt', 'buttons', 'title'],
      inputbox: ['prompt', 'title', 'default'],
      format: ['expression', 'format'],
      replace: ['expression', 'find', 'replace', 'start', 'count', 'compare'],
      instr: ['start', 'string1', 'string2', 'compare'],
      split: ['expression', 'delimiter', 'limit'],
    };
    const names = order[fn];
    if (!names) return pos;
    const out = [...pos];
    for (const [k, v] of Object.entries(named)) {
      const i = names.indexOf(k);
      if (i >= 0) out[i] = v;
    }
    return out;
  }

  private evalMemberCall(obj: BVal, name: string, args: BVal[]): BVal {
    if (isNothing(obj) || obj === undefined || obj === null) throw ERR.noObject();
    if (!isObject(obj)) throw ERR.notSupported(name);
    if (!(obj instanceof ClassInstance) && !(obj instanceof TypeInstance)) args.forEach(escapeValue);
    return obj.get(name, args);
  }

  /** Evaluate an expression. `asStatement` is true for call statements (a bare procedure name is a call). */
  private evalIn(e: Expr, f: Frame, asStatement = false): BVal {
    switch (e.k) {
      case 'num':
      case 'str':
      case 'bool':
        return e.v;
      case 'date':
        return new Date(e.v.getTime());
      case 'null':
        return null;
      case 'empty':
        return undefined;
      case 'nothing':
        return NOTHING;
      case 'id':
        return this.evalId(e.name, f, asStatement);
      case 'member': {
        const obj = e.obj === null ? f.withs[f.withs.length - 1] : this.evalIn(e.obj, f);
        return this.evalMemberCall(obj, e.name, []);
      }
      case 'bang': {
        const obj = e.obj === null ? f.withs[f.withs.length - 1] : this.evalIn(e.obj, f);
        if (!isObject(obj) || !obj.index) throw ERR.notSupported(e.name);
        return obj.index([e.name]);
      }
      case 'call': {
        if (e.fn.k === 'id') return this.callNamed(e.fn.name, e.args, f);
        if (e.fn.k === 'member') {
          const obj = e.fn.obj === null ? f.withs[f.withs.length - 1] : this.evalIn(e.fn.obj, f);
          const a = this.argValues(e.args, f);
          // named arguments (Execute Replace:=2) travel with the positional ones for hosts that know their parameter names
          return this.evalMemberCall(obj, e.fn.name, Object.assign(a.positional, { named: a.named }));
        }
        const base = this.evalIn(e.fn, f);
        const a = this.argValues(e.args, f);
        if (base instanceof VArray) return base.get(a.positional.map((x) => Math.trunc(toNum(x))));
        if (isObject(base) && base.index) return base.index(a.positional);
        throw ERR.typeMismatch();
      }
      case 'un': {
        const v = this.evalIn(e.a, f);
        return e.op === 'neg' ? negate(v) : not(v);
      }
      case 'bin': {
        if (e.op === 'and' || e.op === 'or') {
          // VBA evaluates both sides; so do we (side effects of the right side still happen)
          const a = this.evalIn(e.a, f);
          const b = this.evalIn(e.b, f);
          return binaryOp(e.op, a, b);
        }
        return binaryOp(e.op, this.evalIn(e.a, f), this.evalIn(e.b, f));
      }
      case 'typeof': {
        const v = this.evalIn(e.obj, f);
        if (!isObject(v)) return false;
        const n = lc(e.cls);
        if (lc(v.typeName) === n) return true;
        return v instanceof ClassInstance && v.cls.ast.implements.some((i) => lc(i.name) === n);
      }
      case 'new': {
        const cd = this.classes.get(lc(e.cls));
        if (cd) return this.instantiate(cd);
        const o = createObject(e.cls);
        if (!o) throw new BasicError(429, `No se puede crear el objeto: ${e.cls}. Solo se admiten módulos de clase, Collection y Scripting.Dictionary.`);
        return o;
      }
    }
  }

  private evalId(name: string, f: Frame, asStatement: boolean): BVal {
    const key = lc(name);
    if (key === 'me' && f.self) return f.self;
    const ref = f.vars.get(key) ?? f.self?.fields.get(key) ?? this.globals.get(key);
    if (ref) return ref.v;
    const sm = f.self?.cls.methods.get(key);
    if (sm && (sm.call || sm.get)) return this.callProc((sm.call ?? sm.get)!, [], f, f.self);
    const proc = this.procs.get(key);
    if (proc) return this.callProc(proc, [], f);
    if (CONSTANTS.has(key)) return CONSTANTS.get(key);
    if (this.userConsts.has(key)) return this.userConsts.get(key);
    const eo = this.enumObjs.get(key);
    if (eo) return eo;
    if (FILE_FNS.has(key) && !own(this.host.functions, key)) return this.fileFn(key, [])!.v;
    const o = this.objects[key];
    if (o !== undefined) return o;
    const hostFn = own(this.host.functions, key);
    if (hostFn) return hostFn([], {});
    if (BUILTIN_NAMES.has(key)) return builtin(key)!([], this.ctx);
    if (key === 'err') return this.errObject();
    if (key === 'debug') return this.debugObject();
    if (asStatement && key === 'end') return undefined;
    if (this.explicitModules.has(f.module)) throw new BasicError(35, `Variable no definida: ${name}`);
    return undefined;
  }

  private errObject(): BObject {
    const interp = this;
    return {
      typeName: 'ErrObject',
      get(member, args) {
        switch (member.toLowerCase()) {
          case 'number':
            return interp.err.number;
          case 'description':
            return interp.err.description;
          case 'source':
            return interp.err.source;
          case 'clear':
            interp.err = { number: 0, description: '', source: '' };
            return undefined;
          case 'raise':
            throw new BasicError(Math.trunc(toNum(args[0])), args[2] === undefined ? 'Error definido por la aplicación o el objeto' : toStr(args[2]));
        }
        throw ERR.notSupported(member);
      },
      set(member, _args, value) {
        if (member.toLowerCase() === 'number') interp.err.number = toNum(value);
        else if (member.toLowerCase() === 'description') interp.err.description = toStr(value);
        else throw ERR.notSupported(member);
      },
    };
  }

  private debugObject(): BObject {
    return {
      typeName: 'Debug',
      get: (member, args) => {
        if (member.toLowerCase() === 'print') {
          this.host.print(args.map(toStr).join(''));
          return undefined;
        }
        if (member.toLowerCase() === 'assert') {
          if (!truthy(args[0])) throw new BasicError(1004, 'Falló Debug.Assert');
          return undefined;
        }
        throw ERR.notSupported(member);
      },
      set: (member) => {
        throw ERR.notSupported(member);
      },
    };
  }
}
