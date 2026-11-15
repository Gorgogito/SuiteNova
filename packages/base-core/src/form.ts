import type { MacroDef } from './basic/macro';
import type { BaseDb, ColumnDef } from './db';
import { q } from './design';
import { evalExpr, evalSafe, parseExpr, type Row, type Value } from './expr';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ComboSource = { kind: 'values'; values: string[] } | { kind: 'table'; table: string; valueField: string; displayField: string };

export type FormAction = 'new' | 'delete' | 'first' | 'previous' | 'next' | 'last' | 'run';
export const FORM_ACTIONS: FormAction[] = ['new', 'delete', 'first', 'previous', 'next', 'last', 'run'];

/** What runs on an event: a saved macro, a procedure (`Sub`) of a module, or a macro that lives inside the form (`embedded`). */
export interface Handler {
  kind: 'macro' | 'proc' | 'embedded';
  name: string;
  /** An embedded macro: it travels with the form (copy it, rename it, save it as another file). */
  macro?: MacroDef;
}

/** A conditional format: when the expression is true for the record the control takes this look. */
export interface CondRule {
  /** an expression over the fields: `[Saldo] < 0`, `[Estado] = "Cerrado"` */
  expr: string;
  bg?: string;
  color?: string;
  bold?: boolean;
  /** the control is hidden / cannot be edited while the rule holds */
  hide?: boolean;
  disable?: boolean;
}

/** Events of one control (all optional). */
export interface ControlEvents {
  click?: Handler;
  dblClick?: Handler;
  gotFocus?: Handler;
  lostFocus?: Handler;
  /** Fires on every change of the value, before the control loses the focus. */
  change?: Handler;
}

interface Common extends Box {
  id: string;
  /** Unique name of the control (macros and expressions refer to it). */
  name: string;
  /** Only shown on this page of a tab control (the id of the `tabs` control). */
  tab?: { id: string; page: number };
  /** Conditional formats, applied in order (a later true rule wins where they overlap). */
  cond?: CondRule[];
  /** Shown while the form is open (default yes). */
  visible?: boolean;
  /** Help text shown when the pointer rests on the control. */
  tip?: string;
  /** The value can be seen and selected but not changed. */
  locked?: boolean;
  /** `false`: the control is dimmed and cannot be used (default yes). */
  enabled?: boolean;
  /** `false`: Tab skips the control (default yes). */
  tabStop?: boolean;
  /** Bound controls: the value a new record gets. A literal, or an expression that starts with `=` (`=Date()`). */
  defaultValue?: string;
  on?: ControlEvents;
}

export type FormControl = Common &
  (
    | { type: 'label'; text: string; bold?: boolean; size?: number }
    /** A text box: bound to `field`, or a calculated box when `calc` holds an expression (read only). */
    | { type: 'text'; field: string; calc?: string; readOnly?: boolean; afterUpdate?: Handler; multiline?: boolean }
    | { type: 'check'; field: string; caption?: string; afterUpdate?: Handler }
    | { type: 'combo'; field: string; source: ComboSource; limitToList?: boolean; afterUpdate?: Handler }
    /** `run` executes `handler`; the other actions move through the records. */
    | { type: 'button'; caption: string; action: FormAction; handler?: Handler }
    /** The records of another table whose `childField` equals this record's `parentField`. */
    | {
        type: 'subform';
        table: string;
        childField: string;
        parentField: string;
        columns?: string[];
        /** More pairs of linked fields: all of them must match. */
        extraLinks?: { child: string; parent: string }[];
        /** A second level: the records of another table linked to each row of this subform (`parentField` is a field of `table`). */
        nested?: { table: string; childField: string; parentField: string };
      }
    /** An option group: one radio button per option, bound to a field that stores the value of the chosen one. */
    | { type: 'option'; field: string; caption?: string; options: { label: string; value: string }[]; afterUpdate?: Handler }
    /** A list box: all the choices are shown, and one is chosen. */
    | { type: 'list'; field: string; source: ComboSource; afterUpdate?: Handler }
    /** A picture that is part of the form (stored in it, as a data address). */
    | { type: 'image'; src: string; mode: 'fit' | 'stretch' | 'clip'; alt?: string }
    | { type: 'line'; color?: string; thickness?: number }
    | { type: 'rect'; fill?: string; border?: string }
    /** A link: the text, and the address (fixed, or the value of a field). */
    | { type: 'hyperlink'; text: string; url?: string; field?: string }
    /** A tab control: the pages; other controls say which page they are on. */
    | { type: 'tabs'; pages: string[] }
    /** The files kept in an attachment field of the record: a button that shows how many and opens their window. */
    | { type: 'attachment'; field: string; caption?: string }
  );

export type ControlType = FormControl['type'];
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** What distinguishes a control from the box every control has. */
export type ControlBody = DistOmit<FormControl, keyof Common>;
export const CONTROL_TYPES: ControlType[] = ['label', 'text', 'check', 'combo', 'list', 'option', 'button', 'subform', 'tabs', 'image', 'attachment', 'hyperlink', 'line', 'rect'];

export interface FormLayout {
  width: number;
  height: number;
  controls: FormControl[];
  /** Events of the form itself: when it opens and whenever the current record changes. */
  events?: { onOpen?: Handler; onCurrent?: Handler; beforeUpdate?: Handler; onClose?: Handler; onTimer?: Handler };
  /** Milliseconds between two `onTimer` events (at least 250). */
  timerInterval?: number;
  /** Shortcuts of the form: `F5`, `Ctrl+S`, `Ctrl+Shift+N`… each runs a macro or a procedure. */
  keys?: { key: string; handler: Handler }[];
  /** Only the records for which this Access condition holds (`[Saldo] > 0 And [Zona] = "Sur"`). */
  filter?: string;
  /** Order of the records. */
  orderBy?: { field: string; desc?: boolean }[];
  /**
   * How the records show: one at a time (default), all of them one under the other, as a datasheet, or one record
   * with the datasheet under it (`split`).
   */
  view?: 'single' | 'continuous' | 'datasheet' | 'split';
  /** Title of the form in the toolbar. */
  caption?: string;
  allowEdits?: boolean;
  allowAdditions?: boolean;
  allowDeletions?: boolean;
  /** The bar to move between records (default yes). */
  navButtons?: boolean;
  /** Colour of the background of the form. */
  background?: string;
}

export const GRID = 8;
export const MIN_W = 16;
export const MIN_H = 16;
export const snap = (v: number, g = GRID): number => Math.round(v / g) * g;

const DEFAULT_SIZE: Record<ControlType, { w: number; h: number }> = {
  label: { w: 144, h: 24 },
  text: { w: 256, h: 28 },
  check: { w: 160, h: 24 },
  combo: { w: 256, h: 28 },
  button: { w: 120, h: 32 },
  subform: { w: 480, h: 160 },
  option: { w: 200, h: 96 },
  list: { w: 256, h: 112 },
  image: { w: 160, h: 120 },
  line: { w: 240, h: 8 },
  rect: { w: 200, h: 80 },
  hyperlink: { w: 200, h: 24 },
  tabs: { w: 480, h: 240 },
  attachment: { w: 200, h: 28 },
};
const PREFIX: Record<ControlType, string> = { label: 'Etiqueta', text: 'Texto', check: 'Casilla', combo: 'Lista', button: 'Boton', subform: 'Subformulario', option: 'Grupo', list: 'Cuadro', image: 'Imagen', line: 'Linea', rect: 'Rectangulo', hyperlink: 'Vinculo', tabs: 'Pestanas', attachment: 'Adjuntos' };

/** A free name: Texto1, Texto2… */
export function freeControlName(layout: FormLayout, type: ControlType): string {
  const taken = new Set(layout.controls.map((c) => c.name.toLowerCase()));
  for (let i = 1; ; i++) if (!taken.has(`${PREFIX[type]}${i}`.toLowerCase())) return `${PREFIX[type]}${i}`;
}

let counter = 0;
const newId = () => `c${Date.now().toString(36)}${(counter++).toString(36)}`;


/** The control that edits a column: a check box for Yes/No, a drop-down for a column related to another table, a text box otherwise. */
export function controlForColumn(col: ColumnDef, db?: BaseDb): ControlBody {
  if (/BOOL/i.test(col.type)) return { type: 'check', field: col.name, caption: '' };
  if (col.references && db) {
    const p = col.references;
    const pcols = db.tableNames().includes(p.table) ? db.columns(p.table) : [];
    const display = pcols.find((c) => !c.primaryKey && /TEXT|CHAR|CLOB/i.test(c.type))?.name ?? p.column;
    return { type: 'combo', field: col.name, source: { kind: 'table', table: p.table, valueField: p.column || pcols.find((c) => c.primaryKey)?.name || '', displayField: display }, limitToList: true };
  }
  return { type: 'text', field: col.name, readOnly: (col.primaryKey && col.autoIncrement) || !!col.generated };
}

/** Labels on the left, one control per column on the right: what Access's "Form" button generates. */
export function defaultFormLayout(cols: ColumnDef[], db?: BaseDb): FormLayout {
  const controls: FormControl[] = [];
  const layout: FormLayout = { width: 560, height: 0, controls };
  cols.forEach((c, i) => {
    const y = 16 + i * 40;
    controls.push({ id: newId(), name: `Etiqueta${i + 1}`, type: 'label', x: 16, y, w: 136, h: 28, text: c.name });
    const base = controlForColumn(c, db);
    const size = DEFAULT_SIZE[base.type];
    controls.push({ id: newId(), name: `${PREFIX[base.type]}${i + 1}`, x: 160, y, w: size.w + 32, h: size.h, ...base } as FormControl);
  });
  layout.height = Math.max(240, 16 + cols.length * 40 + 24);
  return layout;
}

/** A new control of the given type, placed below the others (or at `at`). */
export function newControl(layout: FormLayout, type: ControlType, init: Record<string, unknown> = {}, at?: { x: number; y: number }): FormControl {
  const size = DEFAULT_SIZE[type];
  const bottom = layout.controls.reduce((m, c) => Math.max(m, c.y + c.h), 0);
  const base: Common = { id: newId(), name: freeControlName(layout, type), x: snap(at?.x ?? 16), y: snap(at?.y ?? (layout.controls.length ? bottom + 8 : 16)), w: size.w, h: size.h };
  const extra: Record<ControlType, Record<string, unknown>> = {
    label: { text: 'Etiqueta' },
    text: { field: '' },
    check: { field: '', caption: '' },
    combo: { field: '', source: { kind: 'values', values: ['Opción 1', 'Opción 2'] }, limitToList: true },
    button: { caption: 'Botón', action: 'next' },
    subform: { table: '', childField: '', parentField: '', columns: undefined },
    option: { field: '', caption: 'Opciones', options: [{ label: 'Opción 1', value: '1' }, { label: 'Opción 2', value: '2' }] },
    list: { field: '', source: { kind: 'values', values: ['Opción 1', 'Opción 2', 'Opción 3'] } },
    image: { src: '', mode: 'fit' },
    line: { color: '#808080', thickness: 1 },
    rect: { fill: '', border: '#808080' },
    hyperlink: { text: 'Vínculo', url: 'https://' },
    tabs: { pages: ['Página 1', 'Página 2'] },
    attachment: { field: '', caption: 'Datos adjuntos' },
  };
  return { ...base, type, ...extra[type], ...init } as FormControl;
}

export function addControl(layout: FormLayout, c: FormControl): FormLayout {
  return fitLayout({ ...layout, controls: [...layout.controls, c] });
}
export function updateControl(layout: FormLayout, id: string, patch: object): FormLayout {
  return fitLayout({ ...layout, controls: layout.controls.map((c) => (c.id === id ? ({ ...c, ...patch } as FormControl) : c)) });
}
export function removeControl(layout: FormLayout, id: string): FormLayout {
  return { ...layout, controls: layout.controls.filter((c) => c.id !== id) };
}
/** Draw the control on top of the others (the order of the list is the order of drawing and of Tab). */
export function bringToFront(layout: FormLayout, id: string): FormLayout {
  const c = layout.controls.find((x) => x.id === id);
  return c ? { ...layout, controls: [...layout.controls.filter((x) => x.id !== id), c] } : layout;
}
export function sendToBack(layout: FormLayout, id: string): FormLayout {
  const c = layout.controls.find((x) => x.id === id);
  return c ? { ...layout, controls: [c, ...layout.controls.filter((x) => x.id !== id)] } : layout;
}

/** Move and resize with snapping, a minimum size and the page edges (x and y never go negative). */
export function normalizeBox(b: Box, opts: { grid?: number; maxW?: number } = {}): Box {
  const g = opts.grid ?? GRID;
  const w = Math.max(MIN_W, g ? snap(b.w, g) : b.w);
  const h = Math.max(MIN_H, g ? snap(b.h, g) : b.h);
  let x = Math.max(0, g ? snap(b.x, g) : b.x);
  const y = Math.max(0, g ? snap(b.y, g) : b.y);
  if (opts.maxW !== undefined && x + w > opts.maxW) x = Math.max(0, opts.maxW - w);
  return { x, y, w, h };
}

/** The form grows to hold its controls (it never shrinks below 560 × 240). */
export function fitLayout(l: FormLayout): FormLayout {
  const w = Math.max(560, ...l.controls.map((c) => c.x + c.w + 16));
  const h = Math.max(240, ...l.controls.map((c) => c.y + c.h + 16));
  return w === l.width && h === l.height ? l : { ...l, width: w, height: h };
}

// ------------------------------------------------------------------------------------------------ checks

/** Problems of a layout against the database (a field that no longer exists, a missing lookup table…). */
export function validateLayout(layout: FormLayout, db: BaseDb, table: string): string[] {
  const out: string[] = [];
  const tables = db.tableNames();
  const cols = tables.includes(table) ? db.columns(table).map((c) => c.name.toLowerCase()) : [];
  const names = new Set<string>();
  for (const c of layout.controls) {
    if (names.has(c.name.toLowerCase())) out.push(`El nombre "${c.name}" está repetido.`);
    names.add(c.name.toLowerCase());
    if (c.tab && !layout.controls.some((x) => x.id === c.tab!.id && x.type === 'tabs')) out.push(`${c.name}: la pestaña a la que pertenece ya no existe.`);
    for (const r of c.cond ?? []) {
      try {
        parseExpr(r.expr);
      } catch (e) {
        out.push(`${c.name}: la condición «${r.expr}» no es válida (${(e as Error).message}).`);
      }
    }
    if (c.type === 'image' && !c.src) out.push(`${c.name}: no tiene imagen.`);
    if (c.type === 'option' && !c.options.length) out.push(`${c.name}: no tiene opciones.`);
    if (c.type === 'hyperlink' && !c.url && !c.field) out.push(`${c.name}: no tiene dirección.`);
    if ((c.type === 'text' && !c.calc) || c.type === 'check' || c.type === 'combo' || c.type === 'option' || c.type === 'list' || c.type === 'attachment') {
      if (!c.field) out.push(`${c.name}: no tiene campo asignado.`);
      else if (!cols.includes(c.field.toLowerCase())) out.push(`${c.name}: el campo "${c.field}" no existe en "${table}".`);
    }
    if ((c.type === 'combo' || c.type === 'list') && c.source.kind === 'table') {
      const s = c.source;
      if (!tables.includes(s.table)) out.push(`${c.name}: la tabla "${s.table}" no existe.`);
      else {
        const pc = db.columns(s.table).map((x) => x.name.toLowerCase());
        for (const f of [s.valueField, s.displayField]) if (!pc.includes(f.toLowerCase())) out.push(`${c.name}: el campo "${f}" no existe en "${s.table}".`);
      }
    }
    if (c.defaultValue?.startsWith('=')) {
      try {
        parseExpr(c.defaultValue);
      } catch (e) {
        out.push(`${c.name}: el valor predeterminado no es válido (${(e as Error).message}).`);
      }
    }
    if (c.type === 'subform') {
      if (!tables.includes(c.table)) out.push(`${c.name}: la tabla "${c.table}" no existe.`);
      else {
        const sc = db.columns(c.table).map((x) => x.name.toLowerCase());
        if (!sc.includes(c.childField.toLowerCase())) out.push(`${c.name}: el campo "${c.childField}" no existe en "${c.table}".`);
        if (!cols.includes(c.parentField.toLowerCase())) out.push(`${c.name}: el campo "${c.parentField}" no existe en "${table}".`);
        for (const l of c.extraLinks ?? []) {
          if (!sc.includes(l.child.toLowerCase())) out.push(`${c.name}: el campo "${l.child}" no existe en "${c.table}".`);
          if (!cols.includes(l.parent.toLowerCase())) out.push(`${c.name}: el campo "${l.parent}" no existe en "${table}".`);
        }
        const n = c.nested;
        if (n) {
          if (!tables.includes(n.table)) out.push(`${c.name}: la tabla del segundo nivel "${n.table}" no existe.`);
          else {
            if (!db.columns(n.table).some((x) => x.name.toLowerCase() === n.childField.toLowerCase())) out.push(`${c.name}: el campo "${n.childField}" no existe en "${n.table}".`);
            if (!sc.includes(n.parentField.toLowerCase())) out.push(`${c.name}: el campo "${n.parentField}" no existe en "${c.table}".`);
          }
        }
      }
    }
  }
  return [...new Set(out)];
}

// ------------------------------------------------------------------------------------------------ data

export interface Option {
  value: Value;
  label: string;
}

export function comboOptions(db: BaseDb, src: ComboSource): Option[] {
  if (src.kind === 'values') return src.values.map((v) => ({ value: v, label: v }));
  const r = db.execute(`SELECT ${q(src.valueField)}, ${q(src.displayField)} FROM ${q(src.table)} ORDER BY 2 COLLATE NOCASE, 1`, 5000);
  return r.rows.map((row) => ({ value: row[0] as Value, label: row[1] === null || row[1] === undefined ? '' : String(row[1]) }));
}

/** A record as an object by column name (what expressions read). */
export function recordObject(columns: string[], row: unknown[]): Row {
  const o: Row = {};
  columns.forEach((c, i) => {
    const v = row[i];
    o[c] = v === undefined || v instanceof Uint8Array ? null : (v as Value);
  });
  return o;
}

/** Value of a calculated text box for a record. */
export function calcValue(expr: string, record: Row): Value {
  return evalSafe(expr, { row: record });
}

/** Rows of a subform for the current record: the rowid first, then the shown columns. */
export function subformData(db: BaseDb, c: Extract<FormControl, { type: 'subform' }>, parent: Row | null): { columns: string[]; rows: unknown[][] } {
  if (!parent || !db.tableNames().includes(c.table)) return { columns: [], rows: [] };
  const all = db.columns(c.table).map((x) => x.name);
  const columns = c.columns?.length ? c.columns.filter((x) => all.includes(x)) : all;
  const links = [{ child: c.childField, parent: c.parentField }, ...(c.extraLinks ?? [])];
  const params: Record<string, Value> = {};
  const where: string[] = [];
  for (const [i, l] of links.entries()) {
    const key = Object.keys(parent).find((k) => k.toLowerCase() === l.parent.toLowerCase());
    const v = key === undefined ? null : parent[key];
    if (v === null || v === undefined) return { columns, rows: [] };
    params[`p${i}`] = v;
    where.push(`${q(l.child)} = :p${i}`);
  }
  const r = db.execute(`SELECT rowid, ${columns.map(q).join(', ')} FROM ${q(c.table)} WHERE ${where.join(' AND ')} ORDER BY rowid LIMIT 500`, 500, params);
  return { columns, rows: r.rows };
}

// ------------------------------------------------------------------------------------------------ conditional formats

export interface CondLook {
  bg?: string;
  color?: string;
  bold?: boolean;
  hide?: boolean;
  disable?: boolean;
}

/** The look a control takes for a record: every rule whose condition is true applies, in order. An invalid condition counts as false. */
export function condLook(c: { cond?: CondRule[] }, record: Row | null): CondLook {
  const out: CondLook = {};
  if (!record) return out;
  for (const r of c.cond ?? []) {
    let on = false;
    try {
      const v = evalExpr(r.expr, { row: record });
      on = v === true || (typeof v === 'number' && v !== 0) || (typeof v === 'string' && /^(true|verdadero)$/i.test(v));
    } catch {
      on = false;
    }
    if (!on) continue;
    if (r.bg) out.bg = r.bg;
    if (r.color) out.color = r.color;
    if (r.bold) out.bold = true;
    if (r.hide) out.hide = true;
    if (r.disable) out.disable = true;
  }
  return out;
}
