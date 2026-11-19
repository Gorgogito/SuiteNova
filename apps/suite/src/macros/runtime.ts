import { basic } from '@suitenova/base-core';
import { msgBox } from '../base/runtime';
import { codeModules, levelAllows, libraryForInterpreter, LIBRARY_PREFIX, type LibraryId } from './security';
import { DebugRun, reportError, type MacroModule, type MacroRun, type SyntaxProblem } from './debug';

export { DebugRun, reportError, type MacroModule, type MacroRun, type RunGuard, type SyntaxProblem } from './debug';

type BVal = basic.BVal;
const { toNum } = basic;

/** `rgb(r, g, b)`: the colour function every product of Nova Basic has. */
export const rgbFunction = (a: BVal[]): number => (Math.trunc(toNum(a[0])) & 255) | ((Math.trunc(toNum(a[1])) & 255) << 8) | ((Math.trunc(toNum(a[2])) & 255) << 16);

/** Syntax check of a module: the first error with its line, or none. */
export function checkModule(name: string, code: string): SyntaxProblem[] {
  try {
    basic.parseModule(name, code);
    return [];
  } catch (e) {
    if (e instanceof basic.BasicSyntaxError) return [{ line: e.line, message: e.message }];
    throw e;
  }
}

/**
 * What Writer, Calc (and the other products with macros) share: the interpreter loaded from the modules, the procedures, running with the
 * product's undo grouping, the immediate window, the console and the debugger. The product supplies its modules, its objects and its guard.
 */
export abstract class MacroRuntime {
  console: string[] = [];
  limits: Partial<basic.Limits> = {};
  protected interp: basic.Interpreter | null = null;
  protected key = '';
  protected errors: { module: string; line: number; message: string }[] = [];
  protected depth = 0;
  lastAt: { module: string; line: number } | undefined;

  /** A macro is running (what it does to the document is not what the user does: it is not recorded). */
  get running(): boolean {
    return this.depth > 0;
  }

  abstract get modules(): MacroModule[];
  /** The global library of the product (its modules are loaded with the ones of the file), or none. */
  get libraryId(): LibraryId | undefined {
    return undefined;
  }
  /** The modules the interpreter loads: the library (as `Global_Name`) and then the code of the file. */
  protected sources(): MacroModule[] {
    return [...(this.libraryId ? libraryForInterpreter(this.libraryId) : []), ...codeModules(this.modules)];
  }
  /** Active content is enabled (a file that carries macros opens with them off). */
  protected abstract enabled(): boolean;
  /** Something the screen shows changed (the console…). */
  protected abstract changed(): void;
  /** The objects and constants of the product, by name. */
  protected abstract hostObjects(): Record<string, BVal>;
  /** Runs `fn` as one step of the product's history. */
  protected abstract guarded(fn: () => MacroRun): MacroRun;

  static check = checkModule;

  print = (text: string): void => {
    this.console.push(text);
    if (this.console.length > 2000) this.console.splice(0, this.console.length - 2000);
    this.changed();
  };
  clearConsole(): void {
    this.console = [];
    this.changed();
  }

  protected hooks(): basic.HostHooks {
    return {
      print: this.print,
      msgBox: (p, b, t) => msgBox(p, b, t),
      inputBox: (p, t, d) => (typeof window.prompt === 'function' ? window.prompt(`${t}\n\n${p}`, d) : null),
      objects: this.hostObjects(),
      functions: { rgb: rgbFunction },
      compareText: false, // Word, Excel, PowerPoint and Outlook compare text exactly (Option Compare Binary); only Access ignores case
    };
  }

  load(force = false): { module: string; line: number; message: string }[] {
    let src = this.sources();
    const key = JSON.stringify(src);
    if (!force && this.interp && key === this.key) return this.errors;
    const attempt = () => {
      this.interp = new basic.Interpreter(this.hooks(), this.limits);
      this.errors = this.interp.load(src.map((m) => ({ name: m.name, source: m.code }))).map((e) => ({ module: e.module, line: e.line, message: e.message }));
    };
    attempt();
    // a procedure of the file with the name of one of the library wins (as the project of a document does over Normal): the module of the library is left out
    const clash = new Set<string>();
    for (const e of this.errors) {
      const m = /ya está definido en (\S+?)\.$/.exec(e.message);
      if (!m) continue;
      // the library module that was loaded first, or (two library modules that clash) the one that came second
      if (m[1]!.startsWith(LIBRARY_PREFIX)) clash.add(m[1]!);
      else if (e.module.startsWith(LIBRARY_PREFIX)) clash.add(e.module);
    }
    if (clash.size) {
      src = src.filter((m) => !clash.has(m.name));
      attempt();
      // said once in the console (without redrawing: this runs while the dialogs draw)
      for (const m of clash) this.console.push(`⚠ ${m.slice(LIBRARY_PREFIX.length)} (biblioteca): no se cargó, un procedimiento suyo tiene el mismo nombre que otro del archivo.`);
    }
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

  protected report(e: unknown): MacroRun {
    return reportError(e);
  }

  /** The reason a procedure cannot start, or null. */
  protected cannotStart(name: string): MacroRun | null {
    this.lastAt = undefined;
    if (!this.enabled()) return { ok: false, error: 'El contenido activo está deshabilitado en este archivo.' };
    const level = levelAllows(this.modules);
    if (!level.ok) return { ok: false, error: level.reason };
    const errors = this.load();
    if (errors.length) {
      this.lastAt = { module: errors[0]!.module, line: errors[0]!.line };
      return { ok: false, error: `Hay errores de sintaxis: ${errors.map((e) => `${e.module}, línea ${e.line}: ${e.message}`).join(' · ')}`, at: this.lastAt };
    }
    if (!this.interp!.hasProcedure(name)) return { ok: false, error: `No existe el procedimiento "${name}".` };
    return null;
  }

  run(name: string, args: BVal[] = []): MacroRun {
    const no = this.cannotStart(name);
    if (no) return no;
    return this.guarded(() => ({ ok: true, value: this.interp!.call(name, args) }));
  }

  immediate(src: string): MacroRun {
    if (!this.enabled()) return { ok: false, error: 'El contenido activo está deshabilitado en este archivo.' };
    const level = levelAllows(this.modules);
    if (!level.ok) return { ok: false, error: level.reason };
    this.load();
    return this.guarded(() => {
      this.interp!.immediate(src);
      return { ok: true };
    });
  }

  /** Runs a piece of a debug session under the guard. */
  guardedStep(fn: () => void): void {
    this.guarded(() => {
      fn();
      return { ok: true };
    });
  }

  /** Starts a procedure under the debugger: it stops at the breakpoints (`module:line`) and, with `stopAtStart`, at its first statement. */
  debug(name: string, opts: { breakpoints?: Iterable<string>; stopAtStart?: boolean } = {}): { run: DebugRun } | { error: MacroRun } {
    const no = this.cannotStart(name);
    if (no) return { error: no };
    let session: basic.DebugSession | undefined;
    const r = this.guarded(() => {
      session = this.interp!.debug(name, [], opts);
      return { ok: true };
    });
    if (!session) return { error: r };
    const run = new DebugRun(this, session);
    if (session.state === 'error') this.lastAt = reportError(session.error).at;
    return { run };
  }
}
