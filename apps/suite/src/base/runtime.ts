import { basic, type Handler } from '@suitenova/base-core';

type MacroDef = basic.MacroDef;
import type { BaseCtl, FormHandle } from './ctl';

type BVal = basic.BVal;

export interface ModuleDef {
  code: string;
}

export interface RunReport {
  ok: boolean;
  /** Text of the error, with the module, line and procedure when there is one. */
  error?: string;
  /** Module and line of a program error (to place the cursor). */
  at?: { module: string; line: number };
  value?: BVal;
}

const MAX_CONSOLE = 2000;

/** Runs macros and module code against the open database. Everything it can touch goes through the host API below. */
export class BaseRuntime {
  readonly tempVars = new basic.TempVars();
  /** Execution limits of the programs (the defaults stop an endless loop after 20 seconds). */
  limits: Partial<basic.Limits> = {};
  /** Output of Debug.Print and of the immediate window. */
  console: string[] = [];
  private interp: basic.Interpreter | null = null;
  private loadedKey = '';
  private form: string | null = null;
  private depth = 0;

  constructor(private ctl: BaseCtl) {}

  print = (text: string): void => {
    this.console.push(text);
    if (this.console.length > MAX_CONSOLE) this.console.splice(0, this.console.length - MAX_CONSOLE);
    this.ctl.touch();
  };
  /** A different database was opened: forget everything. */
  reset(): void {
    this.console = [];
    this.tempVars.values.clear();
    this.interp = null;
    this.loadedKey = '';
    this.lastErrors = [];
    this.form = null;
  }
  clearConsole(): void {
    this.console = [];
    this.ctl.touch();
  }

  // ---- the objects the programs can reach

  private api(): basic.DbHostApi {
    const ctl = this.ctl;
    const asLike = (h: FormHandle | undefined): basic.FormLike | null => (h ? { ...h, record: h.record } : null);
    return {
      db: ctl.db!,
      form: (n) => asLike(ctl.formHandles.get(n)),
      me: () => asLike(this.form ? ctl.formHandles.get(this.form) : undefined),
      openForm: (n, where) => {
        ctl.openForm(n);
        if (where) ctl.setFormFilter(n, where);
        ctl.touch();
      },
      openReport: (n) => ctl.openReport(n),
      openTable: (n) => ctl.openTable(n),
      openQuery: (n) => ctl.openQuery(n),
      runMacro: (n) => {
        const r = this.runMacro(n);
        if (!r.ok) throw new basic.BasicError(2501, r.error ?? 'La macro falló');
      },
      close: (kind, name) => ctl.closeObject(kind, name),
      querySql: (n) => {
        try {
          return ctl.sqlOfQuery(n);
        } catch {
          return null;
        }
      },
      refresh: () => ctl.touch(),
    };
  }

  private hooks(): basic.HostHooks {
    const host = basic.createHost(this.api(), this.tempVars);
    return {
      print: this.print,
      msgBox: (prompt, buttons, title) => msgBox(prompt, buttons, title),
      inputBox: (prompt, title, def) => (typeof window.prompt === 'function' ? window.prompt(`${title}\n\n${prompt}`, def) : null),
      objects: host.objects,
      functions: host.functions,
    };
  }

  // ---- modules

  private sources(): { name: string; source: string }[] {
    const db = this.ctl.db!;
    return db.objects('module').map((name) => ({ name, source: db.getObject<ModuleDef>('module', name)?.code ?? '' }));
  }

  /** (Re)load the modules from the database when they changed. Returns the syntax errors. */
  load(force = false): { module: string; line: number; message: string }[] {
    const src = this.sources();
    const key = JSON.stringify(src);
    if (!force && this.interp && key === this.loadedKey) return this.lastErrors;
    this.interp = new basic.Interpreter(this.hooks(), this.limits);
    this.lastErrors = this.interp.load(src).map((e) => ({ module: e.module, line: e.line, message: e.message }));
    this.loadedKey = key;
    return this.lastErrors;
  }
  private lastErrors: { module: string; line: number; message: string }[] = [];

  /** Check the syntax of a text without saving it. */
  static check(name: string, code: string): { line: number; message: string }[] {
    try {
      basic.parseModule(name, code);
      return [];
    } catch (e) {
      if (e instanceof basic.BasicSyntaxError) return [{ line: e.line, message: e.message }];
      throw e;
    }
  }

  procedures(): basic.ProcInfo[] {
    this.load();
    return this.interp?.procedures() ?? [];
  }

  /** Where the last run stopped, to place the cursor. */
  lastAt: { module: string; line: number } | undefined;

  private fail(e: unknown): RunReport {
    const r = this.failReport(e);
    this.lastAt = r.at;
    return r;
  }

  private failReport(e: unknown): RunReport {
    if (e instanceof basic.BasicError) return { ok: false, error: e.full, at: e.module && e.line ? { module: e.module, line: e.line } : undefined };
    if (e instanceof basic.AbortRun) return { ok: false, error: e.message };
    if (e instanceof basic.BasicSyntaxError) return { ok: false, error: `Error de sintaxis, línea ${e.line}: ${e.message}`, at: { module: 'Inmediato', line: e.line } };
    return { ok: false, error: (e as Error).message };
  }

  /** Run a procedure (a Sub or a Function). */
  runProc(name: string, args: BVal[] = [], form?: string): RunReport {
    this.lastAt = undefined;
    const errors = this.load();
    if (errors.length) return this.syntaxFail(errors);
    if (errors.length) return { ok: false, error: `Hay errores de sintaxis: ${errors.map((e) => `${e.module}, línea ${e.line}: ${e.message}`).join(' · ')}`, at: { module: errors[0]!.module, line: errors[0]!.line } };
    if (!this.interp!.hasProcedure(name)) return { ok: false, error: `No existe el procedimiento "${name}".` };
    return this.guarded(form, () => ({ ok: true, value: this.interp!.call(name, args) }));
  }

  private syntaxFail(errors: { module: string; line: number; message: string }[]): RunReport {
    this.lastAt = { module: errors[0]!.module, line: errors[0]!.line };
    return { ok: false, error: `Hay errores de sintaxis: ${errors.map((e) => `${e.module}, línea ${e.line}: ${e.message}`).join(' · ')}`, at: this.lastAt };
  }

  /** One line of the immediate window. */
  immediate(src: string): RunReport {
    this.load();
    return this.guarded(undefined, () => {
      this.interp!.immediate(src);
      return { ok: true };
    });
  }

  private guarded(form: string | undefined, fn: () => RunReport): RunReport {
    const before = this.form;
    if (form) this.form = form;
    if (++this.depth > 20) {
      this.depth--;
      return { ok: false, error: 'Demasiadas llamadas anidadas entre macros y procedimientos.' };
    }
    try {
      const r = fn();
      this.ctl.touch();
      return r;
    } catch (e) {
      this.ctl.touch();
      return this.fail(e);
    } finally {
      this.depth--;
      this.form = before;
    }
  }

  // ---- macros

  runMacro(name: string, form?: string): RunReport {
    const db = this.ctl.db!;
    const def = db.getObject<MacroDef>('macro', name);
    if (!def) return { ok: false, error: `No existe la macro "${name}".` };
    return this.guarded(form, () => {
      const host: basic.MacroHost = {
        ...this.api(),
        tempVars: this.tempVars,
        macro: (n) => db.getObject<MacroDef>('macro', n),
        runProc: (n, args) => {
          const r = this.runProc(n, args as BVal[], this.form ?? undefined);
          if (!r.ok) throw new Error(r.error);
        },
        msgBox: (p, b, t) => msgBox(p, b, t),
      };
      const r = basic.runMacro(def, host, name);
      return { ok: r.ok, error: r.error };
    });
  }

  /** Run what an event is bound to. */
  run(h: Handler, form?: string): RunReport {
    return h.kind === 'macro' ? this.runMacro(h.name, form) : this.runProc(h.name, [], form);
  }
}

/** MsgBox with the browser's own dialogs: one button, or two (Yes/No, OK/Cancel). */
export function msgBox(prompt: string, buttons: number, title: string): number {
  const kind = buttons & 15;
  const text = title && title !== 'Nova Base' ? `${title}\n\n${prompt}` : prompt;
  if (kind === 0) {
    window.alert(text);
    return 1; // OK
  }
  const yes = window.confirm(text);
  if (kind === 1) return yes ? 1 : 2; // OK / Cancel
  if (kind === 4 || kind === 3) return yes ? 6 : 7; // Yes / No
  if (kind === 5) return yes ? 4 : 2; // Retry / Cancel
  return yes ? 1 : 2;
}
