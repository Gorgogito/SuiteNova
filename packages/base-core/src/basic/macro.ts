import { ExprError, evalExpr, parseExpr, type Row, type Value } from '../expr';
import { q } from '../design';
import { translateCriteria, type DbHostApi, type FormLike, type TempVars } from './host';
import type { BVal } from './values';

/** Macros are lists of steps (an action with arguments and an optional condition), like Access macros. Blocks (If, Group, Submacro, record loops) hold steps of their own. */
export type MacroActionId =
  | 'OpenForm' | 'OpenReport' | 'OpenTable' | 'OpenQuery' | 'RunSQL' | 'RunMacro' | 'RunCode' | 'MessageBox' | 'SetValue' | 'GoToRecord' | 'Requery' | 'SetTempVar' | 'RemoveTempVar' | 'CloseWindow' | 'StopMacro'
  // blocks and control
  | 'If' | 'Group' | 'Submacro' | 'Comment' | 'OnError' | 'SetLocalVar' | 'RaiseError' | 'StopAllMacros' | 'CancelEvent'
  // forms
  | 'ApplyFilter' | 'ShowAllRecords' | 'SearchForRecord' | 'SelectObject'
  // data (the actions of data macros; they also work in any macro)
  | 'CreateRecord' | 'EditRecord' | 'LookupRecord' | 'ForEachRecord' | 'DeleteRecord' | 'SetField';

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
  /** The step holds other steps (`children`; an If also has Else If and Else). */
  block?: boolean;
  /** Group of the action in the list of the editor. */
  group?: 'control' | 'forms' | 'objects' | 'data' | 'variables';
}

const TEXT_HINT = 'Texto fijo, o una expresión si empieza por =  (por ejemplo: ="Hola " & [Nombre])';
const WHERE_HINT = 'Condición con los campos de la tabla entre corchetes; los valores de otros registros y variables también: [id] = [Pedidos.cliente]';
const record = (extra: ArgSpec[] = []): ArgSpec[] => [{ name: 'table', label: 'Tabla', kind: 'table' }, { name: 'where', label: 'Condición', kind: 'text', optional: true, hint: WHERE_HINT }, ...extra];

export const MACRO_ACTIONS: ActionSpec[] = [
  { id: 'OpenForm', group: 'objects', label: 'Abrir formulario', description: 'Abre un formulario, con un filtro opcional.', args: [{ name: 'form', label: 'Formulario', kind: 'form' }, { name: 'where', label: 'Condición WHERE', kind: 'text', optional: true, hint: 'Filtro SQL, por ejemplo id = 3' }] },
  { id: 'OpenReport', group: 'objects', label: 'Abrir informe', description: 'Abre un informe.', args: [{ name: 'report', label: 'Informe', kind: 'report' }] },
  { id: 'OpenTable', group: 'objects', label: 'Abrir tabla', description: 'Abre una tabla en hoja de datos.', args: [{ name: 'table', label: 'Tabla', kind: 'table' }] },
  { id: 'OpenQuery', group: 'objects', label: 'Abrir consulta', description: 'Abre una consulta guardada.', args: [{ name: 'query', label: 'Consulta', kind: 'query' }] },
  { id: 'SelectObject', group: 'objects', label: 'Seleccionar objeto', description: 'Abre y lleva al frente un objeto.', args: [{ name: 'kind', label: 'Tipo', kind: 'choice', choices: [{ value: 'form', label: 'Formulario' }, { value: 'report', label: 'Informe' }, { value: 'table', label: 'Tabla' }, { value: 'query', label: 'Consulta' }] }, { name: 'name', label: 'Nombre', kind: 'text' }] },
  { id: 'RunSQL', group: 'data', label: 'Ejecutar SQL', description: 'Ejecuta una instrucción SQL (de acción). Se puede deshacer.', writes: true, args: [{ name: 'sql', label: 'Instrucción SQL', kind: 'text', hint: TEXT_HINT }] },
  { id: 'RunMacro', group: 'control', label: 'Ejecutar macro', description: 'Ejecuta otra macro, o una submacro (Macro.Submacro; .Submacro es una de esta misma macro).', args: [{ name: 'macro', label: 'Macro', kind: 'macro', hint: 'Macro, Macro.Submacro o .Submacro' }] },
  { id: 'RunCode', group: 'control', label: 'Ejecutar código', description: 'Llama a un procedimiento de un módulo, con argumentos opcionales: Nombre(1, "a").', args: [{ name: 'proc', label: 'Procedimiento', kind: 'proc', hint: 'Nombre o Nombre(argumento1, argumento2)' }] },
  {
    id: 'MessageBox',
    group: 'control',
    label: 'Cuadro de mensaje',
    description: 'Muestra un mensaje.',
    args: [
      { name: 'message', label: 'Mensaje', kind: 'text', hint: TEXT_HINT },
      { name: 'title', label: 'Título', kind: 'text', optional: true },
      { name: 'type', label: 'Tipo', kind: 'choice', optional: true, choices: [{ value: 'info', label: 'Información' }, { value: 'warning', label: 'Advertencia' }, { value: 'error', label: 'Error' }, { value: 'question', label: 'Pregunta (Sí/No)' }] },
    ],
  },
  { id: 'SetValue', group: 'forms', label: 'Establecer valor', description: 'Asigna el resultado de una expresión a un campo del formulario.', writes: true, args: [{ name: 'item', label: 'Elemento', kind: 'text', hint: 'Campo, Me!Campo o Forms!Formulario!Campo' }, { name: 'expression', label: 'Expresión', kind: 'expr', hint: 'Por ejemplo [Precio] * 1,21  ·  Date()  ·  "texto"' }] },
  { id: 'GoToRecord', group: 'forms', label: 'Ir al registro', description: 'Se mueve por los registros de un formulario.', args: [{ name: 'record', label: 'Registro', kind: 'choice', choices: [{ value: 'next', label: 'Siguiente' }, { value: 'previous', label: 'Anterior' }, { value: 'first', label: 'Primero' }, { value: 'last', label: 'Último' }, { value: 'new', label: 'Nuevo' }] }, { name: 'form', label: 'Formulario', kind: 'form', optional: true, hint: 'En blanco: el formulario actual' }] },
  { id: 'SearchForRecord', group: 'forms', label: 'Buscar registro', description: 'Va al primer registro del formulario en el que un campo vale lo que dice la expresión.', args: [{ name: 'field', label: 'Campo', kind: 'text' }, { name: 'value', label: 'Valor', kind: 'expr', hint: 'Por ejemplo [Buscado]  ·  3  ·  "Ana"' }, { name: 'form', label: 'Formulario', kind: 'form', optional: true, hint: 'En blanco: el formulario actual' }] },
  { id: 'ApplyFilter', group: 'forms', label: 'Aplicar filtro', description: 'Filtra los registros de un formulario abierto.', args: [{ name: 'where', label: 'Condición', kind: 'text', hint: '[Saldo] > 0 Y [Zona] = "Sur"' }, { name: 'form', label: 'Formulario', kind: 'form', optional: true, hint: 'En blanco: el formulario actual' }] },
  { id: 'ShowAllRecords', group: 'forms', label: 'Mostrar todos los registros', description: 'Quita el filtro de un formulario abierto.', args: [{ name: 'form', label: 'Formulario', kind: 'form', optional: true, hint: 'En blanco: el formulario actual' }] },
  { id: 'Requery', group: 'forms', label: 'Actualizar datos', description: 'Vuelve a leer los datos del formulario actual.', args: [] },
  { id: 'SetTempVar', group: 'variables', label: 'Establecer variable temporal', description: 'Guarda un valor para usarlo en otras macros y en el código (TempVars!nombre).', args: [{ name: 'name', label: 'Nombre', kind: 'text' }, { name: 'expression', label: 'Expresión', kind: 'expr' }] },
  { id: 'RemoveTempVar', group: 'variables', label: 'Quitar variable temporal', description: 'Borra una variable temporal (* las borra todas).', args: [{ name: 'name', label: 'Nombre', kind: 'text' }] },
  { id: 'SetLocalVar', group: 'variables', label: 'Establecer variable local', description: 'Guarda un valor solo mientras corre la macro (y las que ella llama). Se usa como [nombre].', args: [{ name: 'name', label: 'Nombre', kind: 'text' }, { name: 'expression', label: 'Expresión', kind: 'expr' }] },
  { id: 'CloseWindow', group: 'objects', label: 'Cerrar ventana', description: 'Cierra un objeto abierto.', args: [{ name: 'kind', label: 'Tipo', kind: 'choice', optional: true, choices: [{ value: 'form', label: 'Formulario' }, { value: 'report', label: 'Informe' }, { value: 'table', label: 'Tabla' }, { value: 'query', label: 'Consulta' }] }, { name: 'name', label: 'Nombre', kind: 'text', optional: true }] },
  { id: 'StopMacro', group: 'control', label: 'Detener macro', description: 'Termina la macro (útil con una condición).', args: [] },
  { id: 'StopAllMacros', group: 'control', label: 'Detener todas las macros', description: 'Termina esta macro y las que la llamaron.', args: [] },
  { id: 'If', group: 'control', block: true, label: 'Si… (If)', description: 'Ejecuta sus pasos si la condición es verdadera; admite Si no, si… y Si no.', args: [] },
  { id: 'Group', group: 'control', block: true, label: 'Grupo', description: 'Agrupa pasos con un nombre (se pueden plegar).', args: [{ name: 'name', label: 'Nombre', kind: 'text' }] },
  { id: 'Submacro', group: 'control', block: true, label: 'Submacro', description: 'Un conjunto de pasos con nombre que se ejecuta con RunMacro Macro.Submacro. Solo al nivel superior.', args: [{ name: 'name', label: 'Nombre', kind: 'text' }] },
  { id: 'Comment', group: 'control', label: 'Comentario', description: 'Una nota; no hace nada.', args: [{ name: 'text', label: 'Texto', kind: 'text' }] },
  { id: 'OnError', group: 'control', label: 'Al producirse un error', description: 'Dice qué hacer si un paso posterior falla: seguir, ejecutar una macro o submacro de error, o detenerse (lo habitual).', args: [{ name: 'mode', label: 'Hacer', kind: 'choice', choices: [{ value: 'fail', label: 'Detener la macro con el error' }, { value: 'next', label: 'Seguir con el paso siguiente' }, { value: 'macro', label: 'Ejecutar una macro y detenerse' }] }, { name: 'macro', label: 'Macro de error', kind: 'macro', optional: true, hint: 'Macro, Macro.Submacro o .Submacro. Dentro se usa [MacroError.Description]' }] },
  { id: 'RaiseError', group: 'control', label: 'Provocar un error', description: 'Detiene la macro con un error (en una macro de datos, cancela el cambio).', args: [{ name: 'message', label: 'Mensaje', kind: 'text', hint: TEXT_HINT }, { name: 'number', label: 'Número', kind: 'text', optional: true }] },
  { id: 'CancelEvent', group: 'control', label: 'Cancelar el evento', description: 'En «Antes de actualizar» de un formulario: deshace el cambio.', args: [] },
  { id: 'CreateRecord', group: 'data', block: true, writes: true, label: 'Crear registro', description: 'Agrega un registro a una tabla; los pasos Establecer campo de dentro dan sus valores.', args: [{ name: 'table', label: 'Tabla', kind: 'table' }] },
  { id: 'EditRecord', group: 'data', block: true, writes: true, label: 'Modificar registros', description: 'Cambia los registros de una tabla que cumplen la condición; los pasos Establecer campo de dentro dan los valores.', args: record() },
  { id: 'LookupRecord', group: 'data', block: true, label: 'Buscar un registro', description: 'Busca el primer registro que cumple la condición: si lo halla, sus campos se leen como [Alias.campo] dentro; si no, se ejecuta el Si no.', args: record([{ name: 'alias', label: 'Alias', kind: 'text', optional: true, hint: 'En blanco: el nombre de la tabla' }]) },
  { id: 'ForEachRecord', group: 'data', block: true, label: 'Para cada registro', description: 'Repite sus pasos con cada registro que cumple la condición, leído como [Alias.campo].', args: record([{ name: 'alias', label: 'Alias', kind: 'text', optional: true, hint: 'En blanco: el nombre de la tabla' }]) },
  { id: 'DeleteRecord', group: 'data', writes: true, label: 'Eliminar registros', description: 'Elimina los registros de una tabla que cumplen la condición (sin condición, todos).', args: record() },
  { id: 'SetField', group: 'data', writes: true, label: 'Establecer campo', description: 'Da el valor de un campo en Crear registro o Modificar registros; en «Antes de cambiar» de una macro de datos, cambia el registro que se guarda.', args: [{ name: 'name', label: 'Campo', kind: 'text' }, { name: 'expression', label: 'Valor', kind: 'expr' }] },
];

export const actionSpec = (id: string): ActionSpec | undefined => MACRO_ACTIONS.find((a) => a.id === id);

export interface MacroStep {
  action: MacroActionId;
  args: Record<string, string>;
  /** The step runs only when this expression is true (the test of an If). */
  condition?: string;
  comment?: string;
  /** Switched off steps are skipped. */
  disabled?: boolean;
  /** Steps inside a block (If, Group, Submacro, CreateRecord, EditRecord, LookupRecord, ForEachRecord). */
  children?: MacroStep[];
  /** If: the `Else If` branches. */
  elseIfs?: { condition: string; steps: MacroStep[] }[];
  /** If and LookupRecord: the `Else` steps. */
  elseSteps?: MacroStep[];
}

export interface MacroDef {
  steps: MacroStep[];
  description?: string;
}

export const newStep = (action: MacroActionId = 'MessageBox'): MacroStep => ({ action, args: {}, ...(actionSpec(action)?.block ? { children: [] } : {}) });

/** What a data macro sees of the row that fired it, and how it changes it. */
export interface DataContext {
  table: string;
  /** `afterInsert`, `afterUpdate`, `afterDelete`, `beforeChange`, `beforeDelete`. */
  event: string;
  /** The values of the row (the new ones; the deleted ones for a delete). */
  row: Record<string, Value>;
  /** The values before the change (updates and deletes). */
  old: Record<string, Value> | null;
  /** Fields set by SetField on the row itself (applied by the host after the macro). */
  pending: Record<string, Value>;
}

export interface MacroHost extends DbHostApi {
  tempVars: TempVars;
  /** A saved macro, or null. */
  macro(name: string): MacroDef | null;
  /** Call a procedure of a module. */
  runProc(name: string, args: BVal[]): void;
  msgBox(prompt: string, buttons: number, title: string): number;
  /** Set when the macro is a data macro of a table. */
  dataContext?: DataContext;
}

export interface MacroResult {
  ok: boolean;
  /** What stopped the macro (the step and the reason). */
  error?: string;
  /** Number of steps that ran. */
  ran: number;
  /** `CancelEvent` ran: the event that started the macro should be undone. */
  cancel?: boolean;
  /** `StopAllMacros` ran. */
  stopped?: boolean;
}

const MAX_DEPTH = 10;
const MAX_STEPS = 100_000;
const MAX_RECORDS = 100_000;

const toValue = (v: BVal): Value => (v === undefined ? null : typeof v === 'object' && v !== null && !(v instanceof Date) ? String(v) : v instanceof Date ? v.toISOString().slice(0, 10) : (v as Value));

interface Ctx {
  host: MacroHost;
  root: MacroDef;
  rootName: string;
  counter: { steps: number };
  ran: number;
  locals: Map<string, Value>;
  onError: { mode: 'fail' | 'next' | 'macro'; macro?: string };
  lastError: { number: number; description: string } | null;
  targets: { kind: 'create' | 'edit'; table: string; where: string; values: Record<string, Value> }[];
  cancel: boolean;
}

/** Thrown to unwind a macro that stops early. */
class Stop extends Error {
  constructor(readonly all: boolean) {
    super('stop');
  }
}
/** A step that failed; `full` says where. */
class StepError extends Error {
  constructor(
    readonly full: string,
    readonly detail: string,
    readonly number = 0,
  ) {
    super(full);
  }
}

/** The data an expression sees: tempVars, then the form's current record, then the row of a data macro, then local variables. */
function rowOf(c: Ctx): Row {
  const h = c.host;
  const row: Row = {};
  for (const [k, v] of h.tempVars.values) row[k] = toValue(v);
  const me = h.me() as (FormLike & { record?: () => Record<string, BVal> }) | null;
  if (me?.record) for (const [k, v] of Object.entries(me.record())) row[k] = toValue(v);
  const d = h.dataContext;
  if (d) {
    for (const [k, v] of Object.entries(d.row)) row[k] = v;
    if (d.old) for (const [k, v] of Object.entries(d.old)) row[`Old.${k}`] = v;
  }
  for (const [k, v] of c.locals) row[k] = v;
  if (c.lastError) {
    row['MacroError.Number'] = c.lastError.number;
    row['MacroError.Description'] = c.lastError.description;
  }
  return row;
}

const isFormula = (s: string) => s.trimStart().startsWith('=');
const isTrue = (v: Value | undefined): boolean => !(v === null || v === undefined || v === false || v === 0 || v === '');

/** A text argument: literal text, or an expression when it starts with `=`. */
function textArg(s: string | undefined, c: Ctx): string {
  if (s === undefined) return '';
  if (!isFormula(s)) return s;
  const v = evalExpr(s, { row: rowOf(c) });
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

/** The Access literal of a value, for putting the value of a variable inside a condition. */
const accessLiteral = (v: Value | undefined): string => (v === null || v === undefined ? 'Null' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'True' : 'False') : `"${v.replace(/"/g, '""')}"`);

/** A condition of a data step as SQL: `[Campo]` of the table stays a column; any other `[nombre]` is replaced by the value it has in the macro. */
export function whereSql(host: MacroHost, table: string, text: string, row: Row): string {
  if (!text.trim()) return '';
  if (!host.db.tableNames().includes(table)) throw new Error(`No existe la tabla "${table}".`);
  const cols = new Set(host.db.columns(table).map((x) => x.name.toLowerCase()));
  const keys = Object.keys(row);
  const text2 = text.replace(/\[([^\]]+)\]/g, (m, name: string) => {
    if (cols.has(name.toLowerCase())) return m;
    const k = keys.find((x) => x.toLowerCase() === name.toLowerCase());
    return k === undefined ? m : accessLiteral(row[k]);
  });
  return translateCriteria(text2);
}

function tableOf(host: MacroHost, name: string | undefined): string {
  const n = (name ?? '').trim();
  const t = host.db.tableNames().find((x) => x.toLowerCase() === n.toLowerCase());
  if (!t) throw new Error(n ? `No existe la tabla "${n}".` : 'Falta la tabla.');
  return t;
}

/** The submacro of a macro by name (top level only). */
const findSub = (def: MacroDef, name: string): MacroStep | undefined => def.steps.find((s) => s.action === 'Submacro' && (s.args.name ?? '').trim().toLowerCase() === name.trim().toLowerCase());

/** Run a macro. A step that fails stops the macro with a message that names the step. */
export function runMacro(def: MacroDef, host: MacroHost, name = 'Macro', depth = 0, counter = { steps: 0 }, shared?: Pick<Ctx, 'locals'>): MacroResult {
  const c: Ctx = { host, root: def, rootName: name, counter, ran: 0, locals: shared?.locals ?? new Map(), onError: { mode: 'fail' }, lastError: null, targets: [], cancel: false };
  return runSteps(def.steps.filter((s) => s.action !== 'Submacro'), c, name, depth);
}

function runSteps(steps: MacroStep[], c: Ctx, name: string, depth: number): MacroResult {
  try {
    exec(steps, c, name, depth, '');
    return { ok: true, ran: c.ran, ...(c.cancel ? { cancel: true } : {}) };
  } catch (e) {
    if (e instanceof Stop) return { ok: true, ran: c.ran, ...(c.cancel ? { cancel: true } : {}), ...(e.all ? { stopped: true } : {}) };
    if (e instanceof StepError) return { ok: false, ran: c.ran, error: e.full, ...(c.cancel ? { cancel: true } : {}) };
    return { ok: false, ran: c.ran, error: (e as Error).message };
  }
}

/** Run the steps of a macro or submacro that another one calls. */
function runCalled(target: string, c: Ctx, depth: number, from: string): MacroResult {
  if (depth >= MAX_DEPTH) throw new Error('Demasiadas macros anidadas.');
  const dot = target.indexOf('.');
  const macroName = dot >= 0 ? target.slice(0, dot).trim() : target.trim();
  const sub = dot >= 0 ? target.slice(dot + 1).trim() : '';
  const def = macroName ? c.host.macro(macroName) : c.root;
  const label = macroName || c.rootName;
  if (!def) throw new Error(`No existe la macro "${macroName}".`);
  let steps: MacroStep[];
  if (sub) {
    const s = findSub(def, sub);
    if (!s) throw new Error(`No existe la submacro "${sub}" en la macro "${label}".`);
    steps = s.children ?? [];
  } else steps = def.steps.filter((s) => s.action !== 'Submacro');
  void from;
  const inner: Ctx = { ...c, root: def, rootName: label, ran: 0, targets: [], locals: c.locals, onError: { mode: 'fail' }, cancel: false };
  const r = runSteps(steps, inner, sub ? `${label}.${sub}` : label, depth + 1);
  c.ran += r.ran;
  if (inner.cancel) c.cancel = true;
  return r;
}

function exec(steps: MacroStep[], c: Ctx, name: string, depth: number, path: string): void {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (s.disabled) continue;
    if (++c.counter.steps > MAX_STEPS) throw new StepError(`${name}: se superó el límite de pasos (¿una macro que se llama a sí misma?).`, 'límite de pasos');
    const at = `${path}${i + 1}`;
    const label = actionSpec(s.action)?.label ?? s.action;
    const where = `${name}, paso ${at} (${label})`;
    try {
      step(s, c, name, depth, `${at}.`, where);
    } catch (e) {
      if (e instanceof Stop) throw e;
      const err = e instanceof StepError ? e : new StepError(`${where}: ${(e as Error).message}`, (e as Error).message, (e as { number?: number }).number ?? 0);
      if (c.onError.mode === 'next') {
        c.lastError = { number: err.number, description: err.detail };
        continue;
      }
      if (c.onError.mode === 'macro' && c.onError.macro) {
        c.lastError = { number: err.number, description: err.detail };
        const target = c.onError.macro;
        c.onError = { mode: 'fail' };
        try {
          runCalled(target, c, depth, name);
        } catch (e2) {
          if (e2 instanceof Stop) throw e2;
          throw new StepError(`${name}, error en la macro de error: ${(e2 as Error).message}`, (e2 as Error).message);
        }
        throw new Stop(false);
      }
      throw err;
    }
  }
}

function step(s: MacroStep, c: Ctx, name: string, depth: number, path: string, where: string): void {
  const host = c.host;
  const a = s.args;
  const row = () => rowOf(c);
  if (s.action === 'If') {
    const test = (cond: string | undefined) => isTrue(evalExpr(cond ?? '', { row: row() }));
    if (test(s.condition)) return exec(s.children ?? [], c, name, depth, `${path}`);
    for (const [k, b] of (s.elseIfs ?? []).entries()) if (test(b.condition)) return exec(b.steps, c, name, depth, `${path}${k + 1}e.`);
    return exec(s.elseSteps ?? [], c, name, depth, `${path}e.`);
  }
  if (s.condition?.trim()) {
    const v = evalExpr(s.condition, { row: row() });
    if (!isTrue(v)) return;
  }
  const kids = () => exec(s.children ?? [], c, name, depth, path);
  switch (s.action) {
    case 'Group':
      return kids();
    case 'Submacro':
      return; // only runs when called
    case 'Comment':
      return;
    case 'OnError': {
      const mode = (a.mode || 'fail') as 'fail' | 'next' | 'macro';
      if (mode === 'macro' && !(a.macro ?? '').trim()) throw new Error('Falta la macro de error.');
      c.onError = { mode, ...(mode === 'macro' ? { macro: a.macro!.trim() } : {}) };
      return;
    }
    case 'StopMacro':
      c.ran++;
      throw new Stop(false);
    case 'StopAllMacros':
      c.ran++;
      throw new Stop(true);
    case 'CancelEvent':
      c.ran++;
      c.cancel = true;
      return;
    case 'RaiseError': {
      c.ran++;
      const err = new Error(textArg(a.message, c) || 'Error');
      (err as { number?: number }).number = Math.trunc(Number(a.number)) || 0;
      throw err;
    }
    case 'SetLocalVar': {
      c.ran++;
      const n = (a.name ?? '').trim();
      if (!n) throw new Error('Falta el nombre de la variable.');
      c.locals.set(n, evalExpr(a.expression ?? '', { row: row() }));
      return;
    }
    case 'CreateRecord':
    case 'EditRecord': {
      c.ran++;
      const table = tableOf(host, a.table);
      const target = { kind: s.action === 'CreateRecord' ? ('create' as const) : ('edit' as const), table, where: s.action === 'EditRecord' ? whereSql(host, table, a.where ?? '', row()) : '', values: {} as Record<string, Value> };
      c.targets.push(target);
      try {
        kids();
      } finally {
        c.targets.pop();
      }
      if (target.kind === 'create') host.db.insertRow(table, target.values);
      else if (Object.keys(target.values).length) {
        const sets = Object.keys(target.values).map((k, i) => `${q(k)} = :v${i}`).join(', ');
        const params = Object.fromEntries(Object.keys(target.values).map((k, i) => [`v${i}`, target.values[k]]));
        host.db.execute(`UPDATE ${q(table)} SET ${sets}${target.where ? ` WHERE ${target.where}` : ''}`, 1, params);
      }
      host.refresh();
      return;
    }
    case 'SetField': {
      c.ran++;
      const field = (a.name ?? '').trim();
      if (!field) throw new Error('Falta el campo.');
      const v = evalExpr(a.expression ?? '', { row: row() });
      const t = c.targets[c.targets.length - 1];
      if (t) {
        const col = host.db.columns(t.table).find((x) => x.name.toLowerCase() === field.toLowerCase());
        if (!col) throw new Error(`La tabla "${t.table}" no tiene el campo "${field}".`);
        t.values[col.name] = v;
      } else if (host.dataContext) {
        const d = host.dataContext;
        const col = host.db.columns(d.table).find((x) => x.name.toLowerCase() === field.toLowerCase());
        if (!col) throw new Error(`La tabla "${d.table}" no tiene el campo "${field}".`);
        d.pending[col.name] = v;
        d.row[col.name] = v;
      } else throw new Error('Establecer campo solo se puede usar dentro de Crear registro o Modificar registros (o en una macro de datos).');
      return;
    }
    case 'LookupRecord':
    case 'ForEachRecord': {
      c.ran++;
      const table = tableOf(host, a.table);
      const alias = (a.alias ?? '').trim() || table;
      const where = whereSql(host, table, a.where ?? '', row());
      const cols = host.db.columns(table).map((x) => x.name);
      const limit = s.action === 'LookupRecord' ? 1 : MAX_RECORDS;
      const r = host.db.execute(`SELECT ${cols.map(q).join(', ')} FROM ${q(table)}${where ? ` WHERE ${where}` : ''} ORDER BY rowid LIMIT ${limit}`, limit);
      const load = (rowv: unknown[]) => cols.forEach((col, k) => c.locals.set(`${alias}.${col}`, (rowv[k] instanceof Uint8Array ? null : rowv[k]) as Value));
      if (s.action === 'LookupRecord') {
        if (r.rows[0]) {
          load(r.rows[0]);
          kids();
        } else exec(s.elseSteps ?? [], c, name, depth, `${path}e.`);
        return;
      }
      for (const rowv of r.rows) {
        load(rowv);
        kids();
      }
      return;
    }
    case 'DeleteRecord': {
      c.ran++;
      const table = tableOf(host, a.table);
      const where = whereSql(host, table, a.where ?? '', row());
      host.db.execute(`DELETE FROM ${q(table)}${where ? ` WHERE ${where}` : ''}`);
      host.refresh();
      return;
    }
  }
  // the rest are plain actions: they count as a step that ran
  c.ran++;
  switch (s.action) {
    case 'OpenForm':
      host.openForm(a.form ?? '', a.where?.trim() ? textArg(a.where, c) : undefined);
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
    case 'SelectObject': {
      const n = textArg(a.name, c);
      if (a.kind === 'report') host.openReport(n);
      else if (a.kind === 'table') host.openTable(n);
      else if (a.kind === 'query') host.openQuery(n);
      else host.openForm(n);
      break;
    }
    case 'RunSQL': {
      const sql = textArg(a.sql, c);
      if (!sql.trim()) throw new Error('Falta la instrucción SQL.');
      host.db.execute(sql);
      host.refresh();
      break;
    }
    case 'RunMacro': {
      const target = (a.macro ?? '').trim();
      if (!target) throw new Error('No existe la macro "".');
      const r = runCalled(target, c, depth, name);
      if (!r.ok) throw new StepError(r.error ?? where, r.error ?? '');
      if (r.stopped) throw new Stop(true);
      break;
    }
    case 'RunCode': {
      const call = parseProcCall(a.proc ?? '', row());
      host.runProc(call.name, call.args as BVal[]);
      break;
    }
    case 'MessageBox': {
      const kind = a.type || 'info';
      const buttons = kind === 'question' ? 4 + 32 : kind === 'error' ? 16 : kind === 'warning' ? 48 : 64;
      host.msgBox(textArg(a.message, c), buttons, textArg(a.title, c) || 'Nova Base');
      break;
    }
    case 'SetValue': {
      const m = /^\s*(?:(?:forms!\s*([^!]+?)\s*!)|(?:me\s*!))?\s*\[?([^\]]+?)\]?\s*$/i.exec(a.item ?? '');
      if (!m) throw new Error(`Elemento no válido: ${a.item ?? ''}`);
      const form = m[1] ? host.form(m[1].replace(/^\[|\]$/g, '')) : host.me();
      if (!form) throw new Error(m[1] ? `El formulario "${m[1]}" no está abierto.` : 'No hay un formulario actual.');
      const v = evalExpr(a.expression ?? '', { row: row() });
      form.set(m[2]!, v);
      break;
    }
    case 'GoToRecord': {
      const f = a.form?.trim() ? host.form(a.form) : host.me();
      if (!f) throw new Error('No hay un formulario abierto al que moverse.');
      f.goto((a.record || 'next') as 'next');
      break;
    }
    case 'SearchForRecord': {
      const f = a.form?.trim() ? host.form(a.form) : host.me();
      if (!f) throw new Error('No hay un formulario abierto en el que buscar.');
      const find = (f as FormLike & { find?: (field: string, value: BVal) => boolean }).find;
      if (!find) throw new Error('Este formulario no admite buscar registros.');
      const v = evalExpr(a.value ?? '', { row: row() });
      const found = find.call(f, (a.field ?? '').trim(), v as BVal);
      c.locals.set('RecordFound', found);
      break;
    }
    case 'ApplyFilter':
    case 'ShowAllRecords': {
      const f = a.form?.trim() ? host.form(a.form) : host.me();
      if (!f) throw new Error('No hay un formulario abierto al que aplicar el filtro.');
      if (!host.applyFilter) throw new Error('Este entorno no admite filtros de formulario.');
      host.applyFilter(f.name, s.action === 'ApplyFilter' ? textArg(a.where, c) : '');
      break;
    }
    case 'Requery':
      host.me()?.requery();
      host.refresh();
      break;
    case 'SetTempVar': {
      const n = (a.name ?? '').trim();
      if (!n) throw new Error('Falta el nombre de la variable.');
      host.tempVars.values.set(n.toLowerCase(), evalExpr(a.expression ?? '', { row: row() }) as BVal);
      break;
    }
    case 'RemoveTempVar':
      if ((a.name ?? '').trim() === '*') host.tempVars.values.clear();
      else host.tempVars.values.delete((a.name ?? '').trim().toLowerCase());
      break;
    case 'CloseWindow':
      host.close((a.kind as 'form') || 'any', a.name?.trim() || undefined);
      break;
    default:
      throw new Error(`Acción desconocida: ${String(s.action)}`);
  }
}

export interface MacroContext {
  forms: string[];
  reports: string[];
  tables: string[];
  queries: string[];
  macros: string[];
  procs: string[];
  /** Submacros of each macro by name (lower case), to check `Macro.Submacro`. */
  subs?: Record<string, string[]>;
}

/** Problems of a macro against the objects of the database (a form that was deleted, a bad expression…). */
export function validateMacro(def: MacroDef, ctx: MacroContext, self?: string, opts: { data?: boolean } = {}): string[] {
  const out: string[] = [];
  const lower = (l: string[]) => new Set(l.map((x) => x.toLowerCase()));
  const sets = { form: lower(ctx.forms), report: lower(ctx.reports), table: lower(ctx.tables), query: lower(ctx.queries), macro: lower(ctx.macros), proc: lower(ctx.procs) };
  const ownSubs = def.steps.filter((s) => s.action === 'Submacro').map((s) => (s.args.name ?? '').trim().toLowerCase());
  /** `Macro.Sub`, `.Sub` or `Macro`: check it names something that exists. */
  const checkTarget = (at: string, label: string, v: string) => {
    const dot = v.indexOf('.');
    const m = (dot >= 0 ? v.slice(0, dot) : v).trim();
    const sub = dot >= 0 ? v.slice(dot + 1).trim().toLowerCase() : '';
    if (m && !sets.macro.has(m.toLowerCase())) return void out.push(`${at} (${label}): macro "${m}" no existe.`);
    if (!m && !sub) return void out.push(`${at} (${label}): falta la macro.`);
    if (m && self && m.toLowerCase() === self.toLowerCase() && !sub) out.push(`${at}: la macro se llama a sí misma.`);
    if (sub) {
      const known = m ? (m.toLowerCase() === (self ?? '').toLowerCase() ? ownSubs : ctx.subs?.[m.toLowerCase()]) : ownSubs;
      if (known && !known.includes(sub)) out.push(`${at} (${label}): la submacro "${sub}" no existe${m ? ` en "${m}"` : ' en esta macro'}.`);
    }
  };
  const walk = (steps: MacroStep[], prefix: string, inRecord: boolean, top: boolean) => {
    steps.forEach((s, i) => {
      if (s.disabled) return;
      const spec = actionSpec(s.action);
      const at = `Paso ${prefix}${i + 1}`;
      if (!spec) return void out.push(`${at}: acción desconocida (${String(s.action)}).`);
      for (const arg of spec.args) {
        const v = (s.args[arg.name] ?? '').trim();
        if (!v) {
          const needs = s.action === 'OnError' && arg.name === 'macro' ? s.args.mode === 'macro' : !arg.optional;
          if (needs) out.push(`${at} (${spec.label}): falta "${arg.label}".`);
          continue;
        }
        if (s.action === 'RunMacro' && arg.name === 'macro') checkTarget(at, spec.label, v);
        else if (s.action === 'OnError' && arg.name === 'macro') {
          if (s.args.mode === 'macro') checkTarget(at, spec.label, v);
        } else if (arg.kind === 'form' || arg.kind === 'report' || arg.kind === 'table' || arg.kind === 'query' || arg.kind === 'macro') {
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
      if (s.action === 'If' && !s.condition?.trim()) out.push(`${at} (${spec.label}): falta la condición.`);
      for (const [k, b] of (s.elseIfs ?? []).entries()) {
        try {
          parseExpr(b.condition);
        } catch (e) {
          out.push(`${at}: la condición del «Si no, si» ${k + 1} no es válida: ${(e as Error).message}`);
        }
      }
      if (s.action === 'Submacro' && !top) out.push(`${at}: una submacro solo puede estar al nivel superior de la macro.`);
      if (s.action === 'SetField' && !inRecord && !opts.data) out.push(`${at}: Establecer campo solo se puede usar dentro de Crear registro o Modificar registros (o en una macro de datos).`);
      if (s.action === 'CancelEvent' && opts.data) out.push(`${at}: Cancelar el evento no vale en una macro de datos (use Provocar un error).`);
      const rec = s.action === 'CreateRecord' || s.action === 'EditRecord';
      if (s.children?.length) walk(s.children, `${prefix}${i + 1}.`, rec || inRecord, false);
      for (const [k, b] of (s.elseIfs ?? []).entries()) walk(b.steps, `${prefix}${i + 1}.${k + 1}e.`, inRecord, false);
      if (s.elseSteps?.length) walk(s.elseSteps, `${prefix}${i + 1}e.`, inRecord, false);
    });
  };
  walk(def.steps, '', false, true);
  return out;
}
