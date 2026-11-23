// The catalog of icons: names (Spanish and English), categories and the outlines. Built by `scripts/icons/build.mjs` from the Fluent System Icons (MIT).
// The names and the categories are small and the outlines are big, so they live in two files and the outlines are only loaded when an icon is drawn.
export type IconStyle = 'regular' | 'filled';

export interface IconInfo {
  id: string;
  /** Spanish name, as shown. */
  name: string;
  /** English name (the words of the id), also searched. */
  en: string;
  category: string;
  /** Side of the square the outlines are drawn in (24 for most). */
  size: number;
  styles: IconStyle[];
}

export interface IconCategory {
  id: string;
  name: string;
  count: number;
}

export interface Catalog {
  categories: IconCategory[];
  icons: IconInfo[];
  get(id: string): IconInfo | undefined;
}

type CatalogFile = { categories: [string, string][]; icons: [string, string, string, number, number, number][] };
/** Outlines of an icon: the `d` of each path, per style (0 when the style does not exist). */
export type PathsFile = Record<string, [string[] | 0, string[] | 0]>;

export function makeCatalog(file: CatalogFile): Catalog {
  const icons: IconInfo[] = file.icons.map(([id, name, en, ci, size, flags]) => ({
    id,
    name,
    en,
    category: file.categories[ci]?.[0] ?? 'simbolos',
    size,
    styles: [...(flags & 1 ? (['regular'] as const) : []), ...(flags & 2 ? (['filled'] as const) : [])],
  }));
  const byId = new Map(icons.map((i) => [i.id, i]));
  const categories = file.categories.map(([id, name]) => ({ id, name, count: icons.filter((i) => i.category === id).length })).filter((c) => c.count > 0);
  return { categories, icons, get: (id) => byId.get(id) };
}

let catalogP: Promise<Catalog> | null = null;
let pathsP: Promise<PathsFile> | null = null;

/** The names and the categories (about 180 kB; loaded once). */
export function loadCatalog(): Promise<Catalog> {
  return (catalogP ??= import('./data/catalog.json').then((m) => makeCatalog(m.default as unknown as CatalogFile)));
}

/** The outlines of every icon (about 2,5 MB; loaded once, only when an icon is drawn). */
export function loadPaths(): Promise<PathsFile> {
  return (pathsP ??= import('./data/paths.json').then((m) => m.default as unknown as PathsFile));
}

/** The outline of one icon in a style (falls back to the other style when it has only one), or null when the id is unknown. */
export function iconPaths(paths: PathsFile, info: IconInfo, style: IconStyle): { d: string[]; style: IconStyle } | null {
  const e = paths[info.id];
  if (!e) return null;
  const want = style === 'regular' ? e[0] : e[1];
  if (want) return { d: want, style };
  const other = style === 'regular' ? e[1] : e[0];
  return other ? { d: other, style: style === 'regular' ? 'filled' : 'regular' } : null;
}
