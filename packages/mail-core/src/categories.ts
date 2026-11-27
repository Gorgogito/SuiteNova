import type { MailData } from './store';

/* Colour categories, like Outlook's: a list of names with a colour, and the names each item carries. */

export interface Category {
  name: string;
  /** One of CATEGORY_COLORS. */
  color: string;
}

export const CATEGORY_COLORS: { id: string; label: string; hex: string }[] = [
  { id: 'red', label: 'Rojo', hex: '#d13438' },
  { id: 'orange', label: 'Naranja', hex: '#f7630c' },
  { id: 'yellow', label: 'Amarillo', hex: '#f2c811' },
  { id: 'green', label: 'Verde', hex: '#13a10e' },
  { id: 'teal', label: 'Verde azulado', hex: '#038387' },
  { id: 'blue', label: 'Azul', hex: '#0078d4' },
  { id: 'purple', label: 'Morado', hex: '#8764b8' },
  { id: 'pink', label: 'Rosa', hex: '#e3008c' },
  { id: 'brown', label: 'Marrón', hex: '#8e562e' },
  { id: 'gray', label: 'Gris', hex: '#69797e' },
];

/** What a mailbox starts with, until the list is changed. */
export const DEFAULT_CATEGORIES: Category[] = [
  { name: 'Categoría azul', color: 'blue' },
  { name: 'Categoría verde', color: 'green' },
  { name: 'Categoría amarilla', color: 'yellow' },
  { name: 'Categoría naranja', color: 'orange' },
  { name: 'Categoría morada', color: 'purple' },
  { name: 'Categoría roja', color: 'red' },
];

export const categoriesOf = (d: MailData): Category[] => d.categories ?? DEFAULT_CATEGORIES;

export const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** A name that is not in the list (it came in a file) is shown in grey. */
export function categoryHex(d: MailData, name: string): string {
  const color = categoriesOf(d).find((c) => sameName(c.name, name))?.color ?? 'gray';
  return (CATEGORY_COLORS.find((c) => c.id === color) ?? CATEGORY_COLORS[CATEGORY_COLORS.length - 1]!).hex;
}

/** The name as it will be kept; says why when it cannot be used. */
export function categoryName(d: MailData, name: string, self?: string): string {
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n) throw new Error('Escribe un nombre para la categoría.');
  if (/[,;"]/.test(n)) throw new Error('El nombre de la categoría no puede llevar comas, puntos y comas ni comillas.');
  if (n.length > 80) throw new Error('El nombre de la categoría es demasiado largo.');
  if (categoriesOf(d).some((c) => sameName(c.name, n) && !(self !== undefined && sameName(c.name, self)))) throw new Error('Ya existe una categoría con ese nombre.');
  return n;
}

const own = (d: MailData): Category[] => (d.categories ??= DEFAULT_CATEGORIES.map((c) => ({ ...c })));

export function addCategory(d: MailData, name: string, color: string): Category {
  const c = { name: categoryName(d, name), color: CATEGORY_COLORS.some((x) => x.id === color) ? color : 'gray' };
  own(d).push(c);
  return c;
}

type Tagged = { categories?: string[] };
const tagged = (d: MailData): Tagged[] => [...d.messages, ...d.events, ...d.tasks, ...d.contacts];

/** The actions of rules and quick steps that name a category. */
const naming = (d: MailData) => [...(d.rules ?? []), ...(d.quickSteps ?? [])].flatMap((r) => r.actions);

/** Changes a category; a new name reaches everything that had the old one. */
export function changeCategory(d: MailData, name: string, patch: { name?: string; color?: string }): void {
  const list = own(d);
  const c = list.find((x) => sameName(x.name, name));
  if (!c) return;
  if (patch.color && CATEGORY_COLORS.some((x) => x.id === patch.color)) c.color = patch.color;
  if (patch.name === undefined || patch.name === c.name) return;
  const next = categoryName(d, patch.name, c.name);
  const old = c.name;
  c.name = next;
  for (const item of tagged(d)) if (item.categories) item.categories = item.categories.map((x) => (sameName(x, old) ? next : x));
  for (const a of naming(d)) if (a.kind === 'category' && sameName(a.name, old)) a.name = next;
}

/** Removes a category from the list and from everything that had it. */
export function removeCategory(d: MailData, name: string): void {
  d.categories = own(d).filter((x) => !sameName(x.name, name));
  for (const item of tagged(d)) if (item.categories?.some((x) => sameName(x, name))) setCategory(item, name, false);
}

export const hasCategory = (item: Tagged, name: string): boolean => !!item.categories?.some((x) => sameName(x, name));

/** Puts a category on an item or takes it off. */
export function setCategory(item: Tagged, name: string, on: boolean): boolean {
  if (hasCategory(item, name) === on) return false;
  const next = on ? [...(item.categories ?? []), name] : (item.categories ?? []).filter((x) => !sameName(x, name));
  if (next.length) item.categories = next;
  else delete item.categories;
  return true;
}

/** Category names read from a saved file or a card: texts, without repetitions. */
export function readNames(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const x of v) {
    const n = typeof x === 'string' ? x.trim() : '';
    if (n && n.length <= 80 && !out.some((y) => sameName(y, n))) out.push(n);
  }
  return out.length ? out.slice(0, 50) : undefined;
}

export function readCategories(v: unknown): Category[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Category[] = [];
  for (const x of v as Partial<Category>[]) {
    const name = typeof x?.name === 'string' ? x.name.trim() : '';
    if (!name || name.length > 80 || out.some((y) => sameName(y.name, name))) continue;
    out.push({ name, color: CATEGORY_COLORS.some((c) => c.id === x.color) ? x.color! : 'gray' });
  }
  return out.slice(0, 200);
}
