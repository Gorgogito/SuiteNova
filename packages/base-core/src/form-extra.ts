import type { BaseDb, ColumnDef } from './db';
import { q } from './design';
import type { SortKey } from './datasheet';
import { evalSafe, parseExpr, type Row, type Value } from './expr';
import { defaultFormLayout, type FormControl, type FormLayout } from './form';
import { ruleToSql, type FieldMeta } from './tableprops';

// ------------------------------------------------------------------------------------------------ filter and order

/** The SQL condition of an Access condition (`[Saldo] > 0 And [Zona] = "Sur"`). Throws when it cannot be understood. */
export function conditionToSql(rule: string): string {
  const sql = ruleToSql(rule, null, (n) => q(n));
  if (!sql) throw new Error(`No se entiende la condición «${rule}».`);
  return sql;
}

/** The records the form shows: its own filter and the one the user typed, both must hold. */
export function formFilterSql(layout: FormLayout, user?: string, macro?: string): string | undefined {
  const parts = [macro, layout.filter?.trim() ? conditionToSql(layout.filter) : '', user?.trim() ? conditionToSql(user) : ''].filter((x): x is string => !!x);
  return parts.length ? parts.map((p) => `(${p})`).join(' AND ') : undefined;
}

/** The sort keys of the form (the user's key first when there is one). */
export function formSorts(layout: FormLayout, user?: SortKey | null): SortKey[] {
  const own = (layout.orderBy ?? []).filter((o) => o.field).map((o) => ({ col: o.field, desc: !!o.desc }));
  return user ? [user, ...own.filter((o) => o.col !== user.col)] : own;
}

// ------------------------------------------------------------------------------------------------ defaults

/** The values a new record gets from the default value of its controls (an expression that fails is left out). */
export function newRecordDefaults(layout: FormLayout, columns: ColumnDef[], now?: Date): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const c of layout.controls) {
    const field = c.type === 'hyperlink' ? undefined : (c as { field?: string }).field;
    if (!field || !c.defaultValue?.trim()) continue;
    const col = columns.find((x) => x.name.toLowerCase() === field.toLowerCase());
    if (!col) continue;
    const d = c.defaultValue.trim();
    let v: Value;
    if (d.startsWith('=')) {
      v = evalSafe(d, { row: null, now });
      if (v === '#Error') continue;
    } else v = d;
    if (typeof v === 'boolean') v = v ? 1 : 0;
    out[col.name] = v;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ keys

const MODS = ['ctrl', 'shift', 'alt'];
/** `Ctrl+Shift+N` → a normal form (`ctrl+shift+n`), or null when it is not a shortcut. */
export function normalizeKey(spec: string): string | null {
  const parts = spec.split('+').map((p) => p.trim().toLowerCase());
  if (parts.some((p) => !p)) return null;
  const key = parts[parts.length - 1]!;
  const mods = parts.slice(0, -1);
  if (mods.some((m) => !MODS.includes(m)) || new Set(mods).size !== mods.length) return null;
  if (MODS.includes(key)) return null;
  if (!/^(f([1-9]|1[0-2])|[a-z0-9]|enter|escape|insert|delete|home|end|pageup|pagedown|arrowup|arrowdown|arrowleft|arrowright)$/.test(key)) return null;
  return [...MODS.filter((m) => mods.includes(m)), key].join('+');
}
export function keyMatches(spec: string, e: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  const n = normalizeKey(spec);
  if (!n) return false;
  return normalizeKey([e.ctrlKey && 'ctrl', e.shiftKey && 'shift', e.altKey && 'alt', e.key.length === 1 ? e.key : e.key].filter(Boolean).join('+')) === n;
}

// ------------------------------------------------------------------------------------------------ settings checks

/** Problems of the settings of the form as a whole (filter, order, shortcuts, timer). */
export function validateFormSettings(layout: FormLayout, db: BaseDb, table: string): string[] {
  const out: string[] = [];
  const cols = db.tableNames().includes(table) ? db.columns(table).map((c) => c.name.toLowerCase()) : [];
  if (layout.filter?.trim()) {
    try {
      conditionToSql(layout.filter);
    } catch (e) {
      out.push(`Filtro del formulario: ${(e as Error).message}`);
    }
  }
  for (const o of layout.orderBy ?? []) if (!cols.includes(o.field.toLowerCase())) out.push(`Orden del formulario: el campo "${o.field}" no existe en "${table}".`);
  const seen = new Set<string>();
  for (const k of layout.keys ?? []) {
    const n = normalizeKey(k.key);
    if (!n) out.push(`Tecla «${k.key}»: no es un atajo válido (por ejemplo F5 o Ctrl+S).`);
    else if (seen.has(n)) out.push(`La tecla «${k.key}» está repetida.`);
    else seen.add(n);
    if (!k.handler?.name) out.push(`Tecla «${k.key}»: no tiene macro ni procedimiento.`);
  }
  if (layout.events?.onTimer && !(layout.timerInterval && layout.timerInterval >= 250)) out.push('El temporizador necesita un intervalo de al menos 250 ms.');
  return out;
}

// ------------------------------------------------------------------------------------------------ wizard and tab order

export type FormStyle = 'columnar' | 'tabular' | 'datasheet' | 'split';
export const FORM_STYLES: FormStyle[] = ['columnar', 'tabular', 'datasheet', 'split'];

/** What the form wizard builds: the chosen fields as a column, as cards one under the other, as a datasheet, or split. */
export function buildFormLayout(cols: ColumnDef[], fields: string[], style: FormStyle, db?: BaseDb, caption?: string): FormLayout {
  const chosen = fields.map((f) => cols.find((c) => c.name === f)).filter((c): c is ColumnDef => !!c);
  const base = defaultFormLayout(chosen, db);
  const out: FormLayout = { ...base, ...(caption ? { caption } : {}) };
  if (style === 'datasheet') return { ...out, view: 'datasheet' };
  if (style === 'split') return { ...out, view: 'split' };
  if (style !== 'tabular') return out;
  // cards: each field is a small label over its control, in rows of two, and every record is one card
  const controls: FormControl[] = [];
  const pairs: [FormControl, FormControl][] = [];
  for (let i = 0; i + 1 < base.controls.length; i += 2) pairs.push([base.controls[i]!, base.controls[i + 1]!]);
  pairs.forEach(([label, control], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 16 + col * 280;
    const y = 8 + row * 56;
    controls.push({ ...label, x, y, w: 264, h: 20 }, { ...control, x, y: y + 22, w: 264, h: 28 } as FormControl);
  });
  const height = Math.max(64, 8 + Math.ceil(pairs.length / 2) * 56 + 8);
  return { ...out, controls, width: 568, height, view: 'continuous' };
}

/** The controls of a new form for fields of a special kind: an attachment field gets the attachments button instead of a text box. */
export function applyFieldKinds(layout: FormLayout, fields: Record<string, FieldMeta | undefined>): FormLayout {
  const controls = layout.controls.map((c) => {
    const f = c.type === 'text' ? fields[c.field]?.kind : undefined;
    return c.type === 'text' && f === 'attachment' ? ({ ...c, type: 'attachment', caption: 'Datos adjuntos' } as FormControl) : c;
  });
  return { ...layout, controls };
}

/** Move a control one place earlier or later in the Tab order (the order of the list). */
export function moveInTabOrder(layout: FormLayout, id: string, delta: -1 | 1): FormLayout {
  const i = layout.controls.findIndex((c) => c.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= layout.controls.length) return layout;
  const controls = [...layout.controls];
  [controls[i], controls[j]] = [controls[j]!, controls[i]!];
  return { ...layout, controls };
}
/** The controls Tab visits, in order. */
export const tabOrder = (layout: FormLayout): FormControl[] => layout.controls.filter((c) => c.tabStop !== false && c.enabled !== false && !['label', 'line', 'rect', 'image', 'tabs'].includes(c.type));

/** Check that an expression of a control can be read (used by the property panel). */
export function expressionError(expr: string): string | null {
  try {
    parseExpr(expr);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** The second level of a subform: the rows of `nested.table` linked to one row of the subform (rowid first, then the columns). */
export function nestedData(db: BaseDb, c: Extract<FormControl, { type: 'subform' }>, subRow: Row): { columns: string[]; rows: unknown[][] } {
  const n = c.nested;
  if (!n || !db.tableNames().includes(n.table)) return { columns: [], rows: [] };
  const columns = db.columns(n.table).map((x) => x.name);
  const key = Object.keys(subRow).find((k) => k.toLowerCase() === n.parentField.toLowerCase());
  const v = key === undefined ? null : subRow[key];
  if (v === null || v === undefined) return { columns, rows: [] };
  const r = db.execute(`SELECT rowid, ${columns.map(q).join(', ')} FROM ${q(n.table)} WHERE ${q(n.childField)} = :p ORDER BY rowid LIMIT 200`, 200, { p: v });
  return { columns, rows: r.rows };
}
