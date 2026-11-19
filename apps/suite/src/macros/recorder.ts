import type { MacroModule } from './debug';

/** A Nova Basic string literal: quotes are doubled and the control characters that cannot sit in a literal are joined with `vbTab`. */
export function vbString(text: string): string {
  return `"${text.replace(/"/g, '""').replace(/\t/g, '" & vbTab & "')}"`;
}

/** `RGB(r, g, b)` for a `#rrggbb` colour. */
export function rgbOf(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 'RGB(0, 0, 0)';
  const n = parseInt(m[1]!, 16);
  return `RGB(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** The first reason a macro name cannot be used, or null. Names follow the rules of procedures: a letter or `_`, then letters, digits or `_`. */
export function macroNameProblem(name: string, taken: string[]): string | null {
  if (!name.trim()) return 'Escriba un nombre para la macro.';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return 'El nombre debe empezar con una letra y tener solo letras, números y guiones bajos (sin espacios).';
  if (name.length > 80) return 'El nombre es demasiado largo.';
  if (taken.some((n) => n.toLowerCase() === name.toLowerCase())) return 'Ya existe un procedimiento con ese nombre.';
  return null;
}

/** The module where recorded macros go (it is created the first time, like `NewMacros` in Word). */
export const RECORDED_MODULE = 'Grabadas';

/** The next free name of the form `Macro1`, `Macro2`… */
export function suggestMacroName(taken: string[]): string {
  let n = 1;
  while (taken.some((x) => x.toLowerCase() === `macro${n}`)) n++;
  return `Macro${n}`;
}

/**
 * What a recording is writing: the lines of code, in the order they happened. The products translate what the user does into lines (`add`);
 * what cannot be translated is left as a comment (`unsupported`) so the macro says honestly that something is missing.
 */
export class MacroRecorder {
  readonly lines: string[] = [];
  paused = false;
  /** Index of the line `typed` is building, so that consecutive typing is one `TypeText`. */
  private typing = -1;

  constructor(
    readonly name: string,
    readonly description = '',
    /** What the recorded lines are written on (`Selection` in Word, for the comments). */
    readonly product = '',
  ) {}

  add(line: string): void {
    if (this.paused) return;
    this.typing = -1;
    this.lines.push(line);
  }

  /** Text typed with the keyboard: it joins the `TypeText` before it when nothing came between. */
  type(text: string): void {
    if (this.paused || !text) return;
    if (this.typing >= 0 && this.typing === this.lines.length - 1) {
      const prev = this.lines[this.typing]!;
      // `Selection.TypeText Text:="abc"` + more text
      this.lines[this.typing] = prev.slice(0, -1) + vbString(text).slice(1);
      return;
    }
    this.lines.push(`Selection.TypeText Text:=${vbString(text)}`);
    this.typing = this.lines.length - 1;
  }

  /** Something the user did that Nova cannot write as code. */
  unsupported(what: string): void {
    if (this.paused) return;
    const line = `' (Nova no puede grabar: ${what.replace(/[\r\n]+/g, ' ')})`;
    if (this.lines[this.lines.length - 1] === line) return;
    this.add(line);
  }

  get isEmpty(): boolean {
    return this.lines.length === 0;
  }

  /** The recorded macro as a `Sub`. */
  code(): string {
    const head = [`Sub ${this.name}()`, `    ' ${this.name} Macro`];
    if (this.description.trim()) for (const l of this.description.trim().split(/\r?\n/)) head.push(`    ' ${l}`);
    const body = this.lines.length ? this.lines.map((l) => `    ${l}`) : ["    ' (no se grabó ninguna acción)"];
    return [...head, ...body, 'End Sub', ''].join('\n');
  }

  /** Writes the macro at the end of the module of recorded macros (created when missing). Returns the module's name. */
  saveInto(modules: MacroModule[]): string {
    const code = this.code();
    const mod = modules.find((m) => m.name === RECORDED_MODULE);
    if (mod) mod.code = `${mod.code.replace(/\s*$/, '')}\n\n${code}`;
    else modules.push({ name: RECORDED_MODULE, code });
    return RECORDED_MODULE;
  }
}
