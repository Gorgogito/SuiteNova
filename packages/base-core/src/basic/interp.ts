import { BUILTIN_NAMES, builtin, createObject, type BuiltinCtx } from './builtins';
import { BasicSyntaxError } from './lexer';
import { parseModule, parseStatements, type Arg, type CaseTest, type Decl, type Expr, type ModuleAst, type Param, type Proc, type Stmt } from './parser';
import { BasicError, ERR, NOTHING, VArray, binaryOp, coerceTo, compareValues, defaultFor, isNothing, isObject, negate, not, toNum, toStr, truthy, type BObject, type BVal } from './values';

/** What the program can reach in the host application. */
export interface HostHooks {
  print(text: string): void;
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

/** Thrown when the program has to stop for good (limits): scripts cannot catch it. */
export class AbortRun extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbortRun';
  }
}

interface Ref {
  v: BVal;
  type?: string;
  isConst?: boolean;
}

type Signal = undefined | 'exitsub' | 'exitfunction' | 'exitfor' | 'exitdo' | { goto: string } | { resume: 'next' | 'here' | { label: string } };

interface Frame {
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
  kind: 'sub' | 'function';
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

export class Interpreter {
  private modules = new Map<string, ModuleAst>();
  private procs = new Map<string, Proc>();
  private globals = new Map<string, Ref>();
  private explicitModules = new Set<string>();
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
  load(sources: { name: string; source: string }[]): (BasicSyntaxError & { module: string })[] {
    this.modules.clear();
    this.procs.clear();
    this.globals.clear();
    this.explicitModules.clear();
    const errors: (BasicSyntaxError & { module: string })[] = [];
    for (const s of sources) {
      try {
        const ast = parseModule(s.name, s.source);
        this.modules.set(s.name, ast);
      } catch (e) {
        if (e instanceof BasicSyntaxError) errors.push(Object.assign(e, { module: s.name }));
        else throw e;
      }
    }
    for (const m of this.modules.values()) {
      if (m.explicit) this.explicitModules.add(m.name);
      for (const p of m.procs) {
        const key = lc(p.name);
        const prev = this.procs.get(key);
        if (prev) {
          errors.push(Object.assign(new BasicSyntaxError(`El procedimiento "${p.name}" ya está definido en ${prev.module}.`, p.line), { module: m.name }));
          continue;
        }
        this.procs.set(key, p);
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
    try {
      return this.callProc(p, args.map((v) => ({ value: v })), null);
    } catch (e) {
      throw this.finish(e);
    }
  }

  /** Run one or more statements typed in the immediate window. A line that starts with `?` prints the value of an expression. */
  immediate(src: string): void {
    const body = parseStatements(src);
    this.begin();
    const frame = this.newFrame(null, 'Inmediato');
    try {
      this.execList(body, frame, true);
    } catch (e) {
      throw this.finish(e);
    }
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
    if (++this.steps > this.limits.maxSteps) throw new AbortRun(`Se superó el límite de ${this.limits.maxSteps.toLocaleString('es-ES')} instrucciones: ¿hay un bucle sin fin?`);
    if ((this.steps & 4095) === 0 && Date.now() - this.startedAt > this.limits.maxMillis) throw new AbortRun(`El programa tardó más de ${Math.round(this.limits.maxMillis / 1000)} segundos y se detuvo: ¿hay un bucle sin fin?`);
  }

  private newFrame(proc: Proc | null, module: string): Frame {
    return { proc, module, vars: new Map(), withs: [], handler: { mode: 'none' }, inHandler: false, top: 0, errTop: 0, line: 0 };
  }

  private callProc(p: Proc, args: { name?: string; value?: BVal; ref?: Ref }[], caller: Frame | null): BVal {
    if (++this.depth > this.limits.maxDepth) throw new BasicError(28, 'Espacio de pila agotado');
    try {
      const frame = this.newFrame(p, p.module);
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
          frame.vars.set(key, { v: VArray.of(positional.slice(i).map((a) => a.ref?.v ?? a.value)) });
          return;
        }
        const given = named.get(key) ?? positional[i];
        const supplied = given !== undefined && !(given.value === undefined && given.ref === undefined && (given as { omitted?: boolean }).omitted);
        if (!supplied) {
          if (!prm.optional) throw new BasicError(449, `El argumento no es opcional: ${prm.name}`);
          frame.vars.set(key, { v: prm.def ? this.evalIn(prm.def, frame) : defaultFor(prm.type), type: prm.type });
        } else if (given!.ref && prm.byRef) {
          frame.vars.set(key, given!.ref); // an alias of the caller's variable
        } else {
          const raw = given!.ref ? given!.ref.v : given!.value;
          frame.vars.set(key, { v: prm.isArray ? raw : coerceTo(prm.type, raw), type: prm.type });
        }
      });
      if (positional.length > p.params.length && !p.params.some((x) => x.paramArray)) throw new BasicError(450, 'Número de argumentos incorrecto o asignación de propiedad no válida');
      if (p.kind === 'function') {
        frame.retRef = { v: defaultFor(p.returns), type: p.returns };
        frame.vars.set(lc(p.name), frame.retRef);
      }
      // execute, with the error handler of the procedure
      let start = 0;
      for (;;) {
        try {
          const sig = this.execList(p.body, frame, true, start);
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
      return p.kind === 'function' ? frame.retRef!.v : undefined;
    } finally {
      this.depth--;
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
    let i = from;
    while (i < list.length) {
      const s = list[i]!;
      if (top) frame.top = i;
      let sig: Signal;
      try {
        sig = this.exec(s, frame);
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
      case 'if': {
        for (const b of s.branches) {
          if (truthy(this.evalIn(b.cond, f))) return this.execList(b.body, f);
        }
        return s.else ? this.execList(s.else, f) : undefined;
      }
      case 'select': {
        const v = this.evalIn(s.expr, f);
        for (const c of s.cases) {
          if (c.tests === 'else' || c.tests.some((t) => this.caseMatches(t, v, f))) return this.execList(c.body, f);
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
          const sig = this.execList(s.body, f);
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
          const sig = this.execList(s.body, f);
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
          const sig = this.execList(s.body, f);
          if (sig === 'exitdo') break;
          if (sig) return sig;
          if (s.post && !test(s.post)) break;
        }
        return undefined;
      }
      case 'with': {
        const o = this.evalIn(s.obj, f);
        f.withs.push(o);
        try {
          return this.execList(s.body, f);
        } finally {
          f.withs.pop();
        }
      }
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
    }
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
    return f.vars.get(k) ?? this.globals.get(k);
  }

  private declare(decls: Decl[], isConst: boolean, f: Frame, into: Map<string, Ref>): void {
    for (const d of decls) {
      const key = lc(d.name);
      if (into.has(key) && !isConst && into === f.vars) throw new BasicError(10, `Esta variable ya está declarada: ${d.name}`);
      if (d.dims) {
        const dims = d.dims.length ? d.dims.map((x) => ({ lo: x.lo ? Math.trunc(toNum(this.evalIn(x.lo, f))) : 0, hi: Math.trunc(toNum(this.evalIn(x.hi!, f))) })) : [{ lo: 0, hi: -1 }];
        into.set(key, { v: new VArray(dims, defaultFor(d.type)), type: d.type });
      } else if (isConst) {
        into.set(key, { v: this.evalIn(d.init!, f), type: d.type, isConst: true });
      } else {
        const obj = d.isNew && d.type ? createObject(d.type) : null;
        into.set(key, { v: obj ?? defaultFor(d.type), type: d.type });
      }
    }
  }

  private redim(d: Decl, preserve: boolean, f: Frame): void {
    const ref = this.findRef(d.name, f);
    const dims = (d.dims ?? []).map((x) => ({ lo: x.lo ? Math.trunc(toNum(this.evalIn(x.lo, f))) : 0, hi: Math.trunc(toNum(this.evalIn(x.hi!, f))) }));
    const fresh = new VArray(dims, defaultFor(d.type ?? ref?.type));
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
          ref.v = ref.type ? coerceTo(ref.type, value) : value;
          return;
        }
        if (this.explicitModules.has(f.module)) throw new BasicError(35, `Variable no definida: ${target.name}`);
        f.vars.set(lc(target.name), { v: value });
        return;
      }
      case 'call': {
        const args = target.args.map((a) => (a ? this.evalIn(a.value, f) : undefined));
        if (target.fn.k === 'id') {
          const ref = this.findRef(target.fn.name, f);
          if (ref?.v instanceof VArray) {
            ref.v.set(args.map((a) => Math.trunc(toNum(a))), ref.type ? coerceTo(ref.type, value) : value);
            return;
          }
          if (ref && isObject(ref.v) && ref.v.setIndex) return ref.v.setIndex(args, value);
          const g = this.objects[lc(target.fn.name)];
          if (isObject(g) && g.setIndex) return g.setIndex(args, value);
          throw ERR.undefinedName(target.fn.name);
        }
        if (target.fn.k === 'member') {
          const obj = this.evalObject(target.fn.obj, f, target.fn.name);
          obj.set(target.fn.name, args, value);
          return;
        }
        const base = this.evalIn(target.fn, f);
        if (base instanceof VArray) return base.set(args.map((a) => Math.trunc(toNum(a))), value);
        if (isObject(base) && base.setIndex) return base.setIndex(args, value);
        throw ERR.objectRequired();
      }
      case 'member': {
        const obj = this.evalObject(target.obj, f, target.name);
        obj.set(target.name, [], value);
        return;
      }
      case 'bang': {
        const obj = this.evalObject(target.obj, f, target.name);
        if (!obj.setIndex) throw ERR.notSupported(target.name);
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
    const local = f.vars.get(key) ?? this.globals.get(key);
    if (local && local !== f.retRef) {
      const v = local.v;
      const a = this.argValues(args, f);
      if (v instanceof VArray) return v.get(a.positional.map((x) => Math.trunc(toNum(x))));
      if (isObject(v) && v.index) return v.index(a.positional);
      throw ERR.typeMismatch(`"${name}" no es un procedimiento ni una matriz`);
    }
    const proc = this.procs.get(key);
    if (proc) {
      const a = this.argValues(args, f);
      return this.callProc(proc, a.list, f);
    }
    const hostFn = own(this.host.functions, key);
    if (hostFn) {
      const a = this.argValues(args, f);
      return hostFn(a.positional, a.named);
    }
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
      case 'new': {
        const o = createObject(e.cls);
        if (!o) throw new BasicError(429, `No se puede crear el objeto: ${e.cls}. Solo se admiten Collection y Scripting.Dictionary.`);
        return o;
      }
    }
  }

  private evalId(name: string, f: Frame, asStatement: boolean): BVal {
    const key = lc(name);
    const ref = f.vars.get(key) ?? this.globals.get(key);
    if (ref) return ref.v;
    const proc = this.procs.get(key);
    if (proc) return this.callProc(proc, [], f);
    if (CONSTANTS.has(key)) return CONSTANTS.get(key);
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
