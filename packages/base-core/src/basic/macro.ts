import { ExprError, evalExpr, parseExpr, type Row, type Value } from '../expr';
import type { DbHostApi, FormLike, TempVars } from './host';
import type { BVal } from './values';

/** Macros are lists of steps (an action with arguments and an optional condition), like Access macros. */
export type MacroActionId = 'OpenForm' | 'OpenReport' | 'OpenTable' | 'OpenQuery' | 'RunSQL' | 'RunMacro' | 'RunCode' | 'MessageBox' | 'SetValue' | 'GoToRecord' | 'Requery' | 'SetTempVar' | 'RemoveTempVar' | 'CloseWindow' | 'StopMacro';

export type ArgKind = 'text' | 'expr' | 'form' | 'report' | 'table' | 'query' | 'macro' | 'proc' | 'choice';

export interface ArgSpec {
  name: string;
  label: string;
  kind: ArgKind;
  choices?: { value: string; label: string }[];
  optional?: boolean;
  /** Shown under the box. */
  hint?: string;
}

export interface ActionSpec {
  id: MacroActionId;
  label: string;
  description: string;
  args: ArgSpec[];
  /** Changes the data (shown with a warning icon in the editor). */
  writes?: boolean;
}

const TEXT_HINT = 'Texto fijo, o una expresión si empieza por =  (por ejemplo: ="Hola " & [Nombre])';

export const MACRO_ACTIONS: ActionSpec[] = [
  { id: 'OpenForm', label: 'Abrir formulario', description: 'Abre un formulario, con un filtro opcional.', args: [{ name: 'form', label: 'Formulario', kind: 'form' }, { name: 'where', label: 'Condición WHERE', kind: 'text', optional: true, hint: 'Filtro SQL, por ejemplo id = 3' }] },
  { id: 'OpenReport', label: 'Abrir informe', description: 'Abre un informe.', args: [{ name: 'report', label: 'Informe', kind: 'report' }] },
  { id: 'OpenTable', label: 'Abrir tabla', description: 'Abre una tabla en hoja de datos.', args: [{ name: 'table', label: 'Tabla', kind: 'table' }] },
  { id: 'OpenQuery', label: 'Abrir consulta', description: 'Abre una consulta guardada.', args: [{ name: 'query', label: 'Consulta', kind: 'query' }] },
  { id: 'RunSQL', label: 'Ejecutar SQL', description: 'Ejecuta una instrucción SQL (de acción). Se puede deshacer.', writes: true, args: [{ name: 'sql', label: 'Instrucción SQL', kind: 'text', hint: TEXT_HINT }] },
  { id: 'RunMacro', label: 'Ejecutar macro', description: 'Ejecuta otra macro.', args: [{ name: 'macro', label: 'Macro', kind: 'macro' }] },
  { id: 'RunCode', label: 'Ejecutar código', description: 'Llama a un procedimiento de un módulo, con argumentos opcionales: Nombre(1, "a").', args: [{ name: 'proc', label: 'Procedimiento', kind: 'proc', hint: 'Nombre o Nombre(argumento1, argumento2)' }] },
  {
    id: 'MessageBox',
    label: 'Cuadro de mensaje',
    description: 'Muestra un mensaje.',
    args: [
      { name: 'message', label: 'Mensaje', kind: 'text', hint: TEXT_HINT },
      { name: 'title', label: 'Título', kind: 'text', optional: true },
      { name: 'type', label: 'Tipo', kind: 'choice', optional: true, choices: [{ value: 'info', label: 'Información' }, { value: 'warning', label: 'Advertencia' }, { value: 'error', label: 'Error' }, { value: 'question', label: 'Pregunta (Sí/No)' }] },
    ],
  },
  { id: 'SetValue', label: 'Establecer valor', description: 'Asigna el resultado de una expresión a un campo del formulario.', writes: true, args: [{ name: 'item', label: 'Elemento', kind: 'text', hint: 'Campo, Me!Campo o Forms!Formulario!Campo' }, { name: 'expression', label: 'Expresión', kind: 'expr', hint: 'Por ejemplo [Precio] * 1,21  ·  Date()  ·  "texto"' }] },
  { id: 'GoToRecord', label: 'Ir al registro', description: 'Se mueve por los registros de un formulario.', args: [{ name: 'record', label: 'Registro', kind: 'choice', choices: [{ value: 'next', label: 'Siguiente' }, { value: 'previous', label: 'Anterior' }, { value: 'first', label: 'Primero' }, { value: 'last', label: 'Último' }, { value: 'new', label: 'Nuevo' }] }, { name: 'form', label: 'Formulario', kind: 'form', optional: true, hint: 'En blanco: el formulario actual' }] },
  { id: 'Requery', label: 'Actualizar datos', description: 'Vuelve a leer los datos del formulario actual.', args: [] },
  { id: 'SetTempVar', label: 'Establecer variable temporal', description: 'Guarda un valor para usarlo en otras macros y en el código (TempVars!nombre).', args: [{ name: 'name', label: 'Nombre', kind: 'text' }, { name: 'expression', label: 'Expresión', kind: 'expr' }] },
  { id: 'RemoveTempVar', label: 'Quitar variable temporal', description: 'Borra una variable temporal (* las borra todas).', args: [{ name: 'name', label: 'Nombre', kind: 'text' }] },
  { id: 'CloseWindow', label: 'Cerrar ventana', description: 'Cierra un objeto abierto.', args: [{ name: 'kind', label: 'Tipo', kind: 'choice', optional: true, choices: [{ value: 'form', label: 'Formulario' }, { value: 'report', label: 'Informe' }, { value: 'table', label: 'Tabla' }, { value: 'query', label: 'Consulta' }] }, { name: 'name', label: 'Nombre', kind: 'text', optional: true }] },
  { id: 'StopMacro', label: 'Detener macro', description: 'Termina la macro (útil con una condición).', args: [] },
];

export const actionSpec = (id: string): ActionSpec | undefined => MACRO_ACTIONS.find((a) => a.id === id);

export interface MacroStep {
  action: MacroActionId;
  args: Record<string, string>;
  /** The step runs only when this expression is true. */
  condition?: string;
  comment?: string;
  /** Switched off steps are skipped. */
  disabled?: boolean;
}

export interface MacroDef {
  steps: MacroStep[];
  description?: string;
}

export const newStep = (action: MacroActionId = 'MessageBox'): MacroStep => ({ action, args: {} });

export interface MacroHost extends DbHostApi {
  tempVars: TempVars;
  /** A saved macro, or null. */
  macro(name: string): MacroDef | null;
  /** Call a procedure of a module. */
  runProc(name: string, args: BVal[]): void;
  msgBox(prompt: string, buttons: number, title: string): number;
}

export interface MacroResult {
  ok: boolean;
  /** What stopped the macro (the step and the reason). */
  error?: string;
  /** Number of steps that ran. */
  ran: number;
}

const MAX_DEPTH = 10;
const MAX_STEPS = 100_000;

const toValue = (v: BVal): Value => (v === undefined ? null : typeof v === 'object' && v !== null && !(v instanceof Date) ? String(v) : v instanceof Date ? v.toISOString().slice(0, 10) : (v as Value));

/** The data an expression sees: the fields of the form's current record, over the temporary variables. */
function rowOf(h: MacroHost): Row {
  const row: Row = {};
  for (const [k, v] of h.tempVars.values) row[k] = toValue(v);
  const me = h.me() as (FormLike & { record?: () => Record<string, BVal> }) | null;
  if (me?.record) for (const [k, v] of Object.entries(me.record())) row[k] = toValue(v);
  return row;
}

const isFormula = (s: string) => s.trimStart().startsWith('=');

/** A text argument: literal text, or an expression when it starts with `=`. */
function textArg(s: string | undefined, h: MacroHost): string {
  if (s === undefined) return '';
  if (!isFormula(s)) return s;
  const v = evalExpr(s, { row: rowOf(h) });
  return v === null ? '' : String(v);
}

/** `Name` or `Name(arg, arg)` → name and the values of the arguments. */
export function parseProcCall(text: string, row: Row): { name: string; args: Value[] } {
  const m = /^\s*([\p{L}_][\p{L}\p{N}_]*)\s*(?:\(([\s\S]*)\))?\s*$/u.exec(text);
  if (!m) throw new ExprError(`No es una llamada válida: ${text}`);
  const args: Value[] = [];
  const inner = m[2]?.trim();
  if (inner) {
    // split on commas outside quotes, brackets and parentheses
    let depth = 0;
    let quote = '';
    let cur = '';
    const parts: string[] = [];
    for (const ch of inner) {
      if (quote) {
        cur += ch;
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        cur += ch;
      } else if (ch === '(' || ch === '[') {
        depth++;
        cur += ch;
      } else if (ch === ')' || ch === ']') {
        depth--;
        cur += ch;
      } else if (ch === ',' && depth === 0) {
        parts.push(cur);
        cur = '';
      } else cur += ch;
    }
    parts.push(cur);
    for (const p of parts) args.push(evalExpr(p, { row }));
  }
  return { name: m[1]!, args };
}

/** Run a macro. A step that fails stops the macro with a message that names the step. */
export function runMacro(def: MacroDef, host: MacroHost, name = 'Macro', depth = 0, counter = { steps: 0 }): MacroResult {
  let ran = 0;
  for (let i = 0; i < def.steps.length; i++) {
    const s = def.steps[i]!;
    if (s.disabled) continue;
    if (++counter.steps > MAX_STEPS) return { ok: false, ran, error: `${name}: se superó el límite de pasos (¿una macro que se llama a sí misma?).` };
    const where = `${name}, paso ${i + 1} (${actionSpec(s.action)?.label ?? s.action})`;
    try {
      if (s.condition?.trim()) {
        const c = evalExpr(s.condition, { row: rowOf(host) });
        if (c === null || c === false || c === 0 || c === '') continue;
      }
      ran++;
      const a = s.args;
      switch (s.action) {
        case 'OpenForm':
          host.openForm(a.form ?? '', a.where?.trim() ? textArg(a.where, host) : undefined);
          break;
        case 'OpenReport':
          host.openReport(a.report ?? '');
          break;
        case 'OpenTable':
          host.openTable(a.table ?? '');
          break;
        case 'OpenQuery':
          host.openQuery(a.query ?? '');
          break;
        case 'RunSQL': {
          const sql = textArg(a.sql, host);
          if (!sql.trim()) throw new Error('Falta la instrucción SQL.');
          host.db.execute(sql);
          host.refresh();
          break;
        }
        case 'RunMacro': {
          if (depth >= MAX_DEPTH) throw new Error('Demasiadas macros anidadas.');
          const inner = host.macro(a.macro ?? '');
          if (!inner) throw new Error(`No existe la macro "${a.macro ?? ''}".`);
          const r = runMacro(inner, host, a.macro!, depth + 1, counter);
          ran += r.ran;
          if (!r.ok) return { ok: false, ran, error: r.error };
          break;
        }
        case 'RunCode': {
          const call = parseProcCall(a.proc ?? '', rowOf(host));
          host.runProc(call.name, call.args as BVal[]);
          break;
        }
        case 'MessageBox': {
          const kind = a.type || 'info';
          const buttons = kind === 'question' ? 4 + 32 : kind === 'error' ? 16 : kind === 'warning' ? 48 : 64;
          host.msgBox(textArg(a.message, host), buttons, textArg(a.title, host) || 'Nova Base');
          break;
        }
        case 'SetValue': {
          const m = /^\s*(?:(?:forms!\s*([^!]+?)\s*!)|(?:me\s*!))?\s*\[?([^\]]+?)\]?\s*$/i.exec(a.item ?? '');
          if (!m) throw new Error(`Elemento no válido: ${a.item ?? ''}`);
          const form = m[1] ? host.form(m[1].replace(/^\[|\]$/g, '')) : host.me();
          if (!form) throw new Error(m[1] ? `El formulario "${m[1]}" no está abierto.` : 'No hay un formulario actual.');
          const v = evalExpr(a.expression ?? '', { row: rowOf(host) });
          form.set(m[2]!, v);
          break;
        }
        case 'GoToRecord': {
          const f = a.form?.trim() ? host.form(a.form) : host.me();
          if (!f) throw new Error('No hay un formulario abierto al que moverse.');
          f.goto((a.record || 'next') as 'next');
          break;
        }
        case 'Requery':
          host.me()?.requery();
          host.refresh();
          break;
        case 'SetTempVar': {
          const n = (a.name ?? '').trim();
          if (!n) throw new Error('Falta el nombre de la variable.');
          host.tempVars.values.set(n.toLowerCase(), evalExpr(a.expression ?? '', { row: rowOf(host) }) as BVal);
          break;
        }
        case 'RemoveTempVar':
          if ((a.name ?? '').trim() === '*') host.tempVars.values.clear();
          else host.tempVars.values.delete((a.name ?? '').trim().toLowerCase());
          break;
        case 'CloseWindow':
          host.close((a.kind as 'form') || 'any', a.name?.trim() || undefined);
          break;
        case 'StopMacro':
          return { ok: true, ran };
        default:
          throw new Error(`Acción desconocida: ${String(s.action)}`);
      }
    } catch (e) {
      return { ok: false, ran, error: `${where}: ${(e as Error).message}` };
    }
  }
  return { ok: true, ran };
}

export interface MacroContext {
  forms: string[];
  reports: string[];
  tables: string[];
  queries: string[];
  macros: string[];
  procs: string[];
}

/** Problems of a macro against the objects of the database (a form that was deleted, a bad expression…). */
export function validateMacro(def: MacroDef, ctx: MacroContext, self?: string): string[] {
  const out: string[] = [];
  const lower = (l: string[]) => new Set(l.map((x) => x.toLowerCase()));
  const sets = { form: lower(ctx.forms), report: lower(ctx.reports), table: lower(ctx.tables), query: lower(ctx.queries), macro: lower(ctx.macros), proc: lower(ctx.procs) };
  def.steps.forEach((s, i) => {
    if (s.disabled) return;
    const spec = actionSpec(s.action);
    const at = `Paso ${i + 1}`;
    if (!spec) return void out.push(`${at}: acción desconocida (${String(s.action)}).`);
    for (const arg of spec.args) {
      const v = (s.args[arg.name] ?? '').trim();
      if (!v) {
        if (!arg.optional) out.push(`${at} (${spec.label}): falta "${arg.label}".`);
        continue;
      }
      if (arg.kind === 'form' || arg.kind === 'report' || arg.kind === 'table' || arg.kind === 'query' || arg.kind === 'macro') {
        if (!sets[arg.kind].has(v.toLowerCase())) out.push(`${at} (${spec.label}): ${arg.label.toLowerCase()} "${v}" no existe.`);
        if (arg.kind === 'macro' && self && v.toLowerCase() === self.toLowerCase()) out.push(`${at}: la macro se llama a sí misma.`);
      } else if (arg.kind === 'proc') {
        const m = /^\s*([\p{L}_][\p{L}\p{N}_]*)/u.exec(v);
        if (!m || !sets.proc.has(m[1]!.toLowerCase())) out.push(`${at} (${spec.label}): el procedimiento "${m?.[1] ?? v}" no existe.`);
        else {
          try {
            parseProcCall(v, {}); // arguments that need record fields are checked when they run
          } catch (e) {
            if (!(e instanceof ExprError && /No existe el campo/.test(e.message))) out.push(`${at} (${spec.label}): ${(e as Error).message}`);
          }
        }
      } else if (arg.kind === 'expr' || (arg.kind === 'text' && isFormula(v))) {
        try {
          parseExpr(v);
        } catch (e) {
          out.push(`${at} (${spec.label}): ${(e as Error).message}`);
        }
      }
    }
    if (s.condition?.trim()) {
      try {
        parseExpr(s.condition);
      } catch (e) {
        out.push(`${at}: la condición no es válida: ${(e as Error).message}`);
      }
    }
  });
  return out;
}
