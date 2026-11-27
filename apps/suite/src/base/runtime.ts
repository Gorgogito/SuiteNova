import { basic, type DataEvent, type Handler } from '@suitenova/base-core';
import { DebugRun } from '../macros/debug';

type MacroDef = basic.MacroDef;
import type { BaseCtl, FormHandle } from './ctl';
import { VERSION } from '../version';

type BVal = basic.BVal;

export interface ModuleDef {
  code: string;
  /** A class module: its procedures belong to the objects made from it with `New`. */
  kind?: 'class';
}

export interface RunReport {
  ok: boolean;
  /** Text of the error, with the module, line and procedure when there is one. */
  error?: string;
  /** Module and line of a program error (to place the cursor). */
  at?: { module: string; line: number };
  value?: BVal;
  /** The macro ran `CancelEvent`. */
  cancel?: boolean;
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
  /** Connect the data macros of the open database: every change of a record calls here (see the triggers of `setMeta`). */
  attach(): void {
    const db = this.ctl.db;
    if (db) db.dataMacroHook = (table, event, rowid, row, old) => this.runDataMacro(table, event, rowid, row, old);
  }

  /** Cells changed by `SetField` of a macro on the row itself must not fire `beforeChange` again. */
  private fixing = new Set<string>();

  private runDataMacro(table: string, event: string, rowid: number, row: Record<string, unknown>, old: Record<string, unknown> | null): void {
    const ctl = this.ctl;
    if (!ctl.contentEnabled) return; // a file that carries macros starts with them off
    const name = event.startsWith('beforeChange') ? 'beforeChange' : event;
    const key = `${table}:${rowid}`;
    if (name === 'beforeChange' && this.fixing.has(key)) return;
    const def = ctl.db!.getMeta(table).dataMacros?.[name as DataEvent] as MacroDef | undefined;
    if (!def?.steps.length) return;
    const ctxData: basic.DataContext = { table, event: name, row: row as basic.DataContext['row'], old: old as basic.DataContext['old'], pending: {} };
    const host: basic.MacroHost = {
      ...this.api(),
      me: () => null,
      form: () => null,
      tempVars: this.tempVars,
      macro: (n) => ctl.db!.getObject<MacroDef>('macro', n),
      runProc: (n, args) => {
        const r = this.runProc(n, args as BVal[]);
        if (!r.ok) throw new Error(r.error);
      },
      msgBox: (p, b, t) => msgBox(p, b, t),
      dataContext: ctxData,
    };
    const r = basic.runMacro(def, host, `${table}, ${name}`);
    if (!r.ok) throw new Error(r.error ?? 'La macro de datos falló.');
    const cols = Object.keys(ctxData.pending);
    if (cols.length && name === 'beforeChange') {
      this.fixing.add(key);
      try {
        const sets = cols.map((c, i) => `"${c.replace(/"/g, '""')}" = :v${i}`).join(', ');
        ctl.db!.execute(`UPDATE "${table.replace(/"/g, '""')}" SET ${sets} WHERE rowid = ${Math.trunc(rowid)}`, 1, Object.fromEntries(cols.map((c, i) => [`v${i}`, ctxData.pending[c]])));
      } finally {
        this.fixing.delete(key);
      }
    }
  }

  /** A different database was opened: forget everything. */
  reset(): void {
    this.console = [];
    this.tempVars.values.clear();
    this.interp?.dispose(false); // another database: nothing may run against it
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
    const closeTab = (kind: string, name: string) => {
      const t = ctl.tabs.find((x) => x.kind === kind && x.name === name);
      if (t) ctl.close(t.id);
    };
    const asLike = (h: FormHandle | undefined): basic.FormLike | null => (h ? { ...h, record: h.record } : null);
    return {
      db: ctl.db!,
      appVersion: () => VERSION,
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
      projectName: () => ctl.fileName ?? 'Base de datos1',
      applyFilter: (form, where) => {
        ctl.setFormFilter(form, where ? basic.translateCriteria(where) : '');
        ctl.touch();
      },
      deleteObject: (kind, name) => {
        if (kind === 'table') ctl.db!.execute(`DROP TABLE "${name.replace(/"/g, '""')}"`);
        else {
          closeTab(kind, name);
          ctl.db!.deleteObject(kind, name);
        }
      },
      renameObject: (kind, from, to) => {
        if (kind === 'table') ctl.db!.execute(`ALTER TABLE "${from.replace(/"/g, '""')}" RENAME TO "${to.replace(/"/g, '""')}"`);
        else {
          closeTab(kind, from);
          ctl.db!.renameObject(kind, from, to);
        }
      },
      copyObject: (kind, from, to) => {
        const def = ctl.db!.getObject(kind, from);
        if (!def) throw new basic.BasicError(2102, `No existe el objeto "${from}".`);
        if (ctl.db!.objects(kind).includes(to)) throw new basic.BasicError(2501, `Ya existe un objeto llamado "${to}".`);
        ctl.db!.saveObject(kind, to, def);
      },
    };
  }

  /** The files a program can use: text kept inside the database (never the disk). Names compare without regard to case. */
  private vfs(): basic.Vfs {
    const db = this.ctl.db!;
    const find = (p: string) => db.objects('file').find((n) => n.toLowerCase() === p.toLowerCase());
    return {
      read: (p) => {
        const n = find(p);
        return n === undefined ? null : (db.getObject<{ text: string }>('file', n)?.text ?? '');
      },
      write: (p, text) => db.saveObject('file', find(p) ?? p, { text }),
      remove: (p) => {
        const n = find(p);
        if (n !== undefined) db.deleteObject('file', n);
      },
      list: () => db.objects('file'),
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
      vfs: this.vfs(),
    };
  }

  // ---- modules

  private sources(): { name: string; source: string; kind?: 'class' }[] {
    const db = this.ctl.db!;
    return db.objects('module').map((name) => {
      const d = db.getObject<ModuleDef>('module', name);
      return { name, source: d?.code ?? '', ...(d?.kind === 'class' ? { kind: 'class' as const } : {}) };
    });
  }

  /** (Re)load the modules from the database when they changed. Returns the syntax errors. */
  load(force = false): { module: string; line: number; message: string }[] {
    const src = this.sources();
    const key = JSON.stringify(src);
    if (!force && this.interp && key === this.loadedKey) return this.lastErrors;
    try {
      this.interp?.dispose(); // objects that are still alive get their Class_Terminate before the code is replaced
    } catch {
      /* the old program is gone anyway */
    }
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

  // ---- debugging

  /** Where the breakpoints are, by module (they last as long as the database is open). */
  readonly breakpoints = new Map<string, Set<number>>();
  /** The run that is stopped at a statement, if any (it outlives the editor: stepping into another module opens that module's tab). */
  session: DebugRun | null = null;
  sessionName = '';

  guardedStep(fn: () => void): void {
    this.guarded(undefined, () => {
      fn();
      return { ok: true };
    });
  }

  breakpointKeys(): string[] {
    return [...this.breakpoints].flatMap(([m, set]) => [...set].map((l) => `${m}:${l}`));
  }

  /** Starts a procedure under the debugger (it stops at the breakpoints and, with `stopAtStart`, at its first statement). */
  debug(name: string, stopAtStart: boolean): { run: DebugRun } | { error: RunReport } {
    this.lastAt = undefined;
    const errors = this.load();
    if (errors.length) return { error: this.syntaxFail(errors) };
    if (!this.ctl.contentEnabled) return { error: { ok: false, error: 'El contenido activo está deshabilitado en este archivo.' } };
    if (!this.interp!.hasProcedure(name)) return { error: { ok: false, error: `No existe el procedimiento "${name}".` } };
    let session: basic.DebugSession | undefined;
    const r = this.guarded(undefined, () => {
      session = this.interp!.debug(name, [], { breakpoints: this.breakpointKeys(), stopAtStart });
      return { ok: true };
    });
    if (!session) return { error: r };
    const run = new DebugRun(this, session);
    this.session = run;
    this.sessionName = name;
    if (session.state === 'error') this.lastAt = this.failReport(session.error).at;
    return { run };
  }

  /** Ends the stopped run, if there is one. */
  stopDebug(): void {
    const r = this.session;
    this.session = null;
    if (r?.state === 'paused') r.stop();
    this.ctl.touch();
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
    const def = this.ctl.db!.getObject<MacroDef>('macro', name);
    if (!def) return { ok: false, error: `No existe la macro "${name}".` };
    return this.runMacroDef(def, name, form);
  }

  /** Run a macro that is not a saved one (an embedded macro of a form). */
  runMacroDef(def: MacroDef, name: string, form?: string): RunReport {
    const db = this.ctl.db!;
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
      return { ok: r.ok, error: r.error, ...(r.cancel ? { cancel: true } : {}) };
    });
  }

  /** Run what an event is bound to. */
  run(h: Handler, form?: string): RunReport {
    if (h.kind === 'embedded') return this.runMacroDef(h.macro ?? { steps: [] }, h.name || 'Macro incrustada', form);
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
