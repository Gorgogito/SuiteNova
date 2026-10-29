import { newId, newPage, type Notebook, type Page, type Section, type TrashItem } from './model';

/*
 * Libretas compartidas. Nova Notes no tiene servidor: una libreta se comparte guardando el archivo en una carpeta que otro
 * programa sincroniza (OneDrive, Dropbox, Syncthing, una carpeta de red…). Cada persona abre el mismo archivo; al guardar y cada
 * cierto tiempo se combina lo que cambió fuera con lo de aquí, por páginas:
 *
 * - una página que solo cambió en un lado se queda con ese cambio;
 * - una que cambió en los dos lados desde la última combinación se conserva entera en ambas versiones (la más reciente es la
 *   página y la otra queda justo debajo como «conflicto»), nunca se mezclan los textos;
 * - lo borrado en un lado (está en la papelera) se borra también en el otro salvo que se haya modificado después.
 */

export interface MergeResult {
  nb: Notebook;
  /** Páginas o secciones que llegaron de la otra copia. */
  added: number;
  /** Páginas que se actualizaron con la versión de la otra copia. */
  updated: number;
  /** Páginas que cambiaron en los dos lados: se conservaron las dos. */
  conflicts: number;
  /** Páginas o secciones que se quitaron porque se borraron en la otra copia. */
  removed: number;
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const fmtDate = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

function mergePage(local: Page, remote: Page, since: number, stats: MergeResult): Page[] {
  if (local.vault || remote.vault) {
    // cifrado: no se puede comparar por dentro
    if (sameJson(local.vault, remote.vault) && sameJson(local.protect, remote.protect)) return [local];
    if (local.modified === remote.modified) return [local];
    if (remote.modified > local.modified && local.modified <= since) {
      stats.updated++;
      return [remote];
    }
    if (local.modified >= remote.modified && remote.modified <= since) return [local];
    stats.conflicts++;
    return [local, { ...remote, id: newId('p'), level: local.level }];
  }
  if (local.modified === remote.modified && sameJson({ ...local, versions: 0 }, { ...remote, versions: 0 })) return [local];
  const localChanged = local.modified > since;
  const remoteChanged = remote.modified > since;
  if (remoteChanged && !localChanged) {
    stats.updated++;
    return [remote];
  }
  if (localChanged && !remoteChanged) return [local];
  if (sameJson(bodyKey(local), bodyKey(remote))) return [local.modified >= remote.modified ? local : remote];
  stats.conflicts++;
  const newer = local.modified >= remote.modified ? local : remote;
  const older = newer === local ? remote : local;
  const copy: Page = { ...older, id: newId('p'), title: `${older.title || 'Página sin título'} (conflicto, ${fmtDate(older.modified)})`, level: newer.level };
  return [newer, copy];
}

const bodyKey = (p: Page) => ({ title: p.title, containers: p.containers, ink: p.ink, style: p.style, level: p.level });

function mergeSection(local: Section, remote: Section, since: number, stats: MergeResult): Section {
  if (local.vault || remote.vault) {
    if (sameJson(local.vault, remote.vault)) return local;
    if (local.vault && remote.vault) return local;
    return local.vault ? local : local;
  }
  const out: Page[] = [];
  const rById = new Map(remote.pages.map((p) => [p.id, p]));
  const lIds = new Set(local.pages.map((p) => p.id));
  for (const p of local.pages) {
    const r = rById.get(p.id);
    if (!r) {
      out.push(p);
      continue;
    }
    out.push(...mergePage(p, r, since, stats));
  }
  // páginas que solo existen en la otra copia, cerca de donde estaban allí
  remote.pages.forEach((p, i) => {
    if (lIds.has(p.id)) return;
    stats.added++;
    const before = remote.pages[i - 1];
    const at = before ? out.findIndex((x) => x.id === before.id) : -1;
    out.splice(at >= 0 ? at + 1 : out.length, 0, p);
  });
  return { ...local, pages: out };
}

/** Combina la libreta de aquí con otra copia de la misma libreta. `since` es el momento de la última combinación. */
export function mergeNotebooks(local: Notebook, remote: Notebook, now = Date.now()): MergeResult {
  const since = local.syncedAt ?? 0;
  const stats: MergeResult = { nb: local, added: 0, updated: 0, conflicts: 0, removed: 0 };
  const assets = { ...remote.assets, ...local.assets };
  const ocr = { ...remote.ocr };
  for (const [k, v] of Object.entries(local.ocr)) if (!ocr[k] || ocr[k]!.at < v.at) ocr[k] = v;

  const rSections = new Map(remote.sections.map((s) => [s.id, s]));
  const lIds = new Set(local.sections.map((s) => s.id));
  let sections: Section[] = local.sections.map((s) => {
    const r = rSections.get(s.id);
    return r ? mergeSection(s, r, since, stats) : s;
  });
  remote.sections.forEach((s, i) => {
    if (lIds.has(s.id)) return;
    stats.added++;
    const before = remote.sections[i - 1];
    const at = before ? sections.findIndex((x) => x.id === before.id) : -1;
    sections.splice(at >= 0 ? at + 1 : sections.length, 0, s);
  });

  // papelera: la unión de las dos; lo que se borró en un lado se borra en el otro si no se tocó después
  const trashById = new Map<string, TrashItem>();
  for (const t of [...local.trash, ...remote.trash]) if (!trashById.has(t.id)) trashById.set(t.id, t);
  let trash = [...trashById.values()];
  const removedPages = new Map<string, number>();
  const removedSections = new Map<string, number>();
  for (const t of trash) {
    if (t.kind === 'page' && t.page) removedPages.set(t.page.id, Math.max(removedPages.get(t.page.id) ?? 0, t.at));
    if (t.kind === 'section' && t.section) removedSections.set(t.section.id, Math.max(removedSections.get(t.section.id) ?? 0, t.at));
  }
  sections = sections.filter((s) => {
    const at = removedSections.get(s.id);
    if (at === undefined) return true;
    const touched = s.vault ? false : s.pages.some((p) => p.modified > at);
    if (touched) {
      trash = trash.filter((t) => !(t.kind === 'section' && t.section?.id === s.id));
      return true;
    }
    stats.removed++;
    return false;
  });
  sections = sections.map((s) => {
    if (s.vault) return s;
    const pages = s.pages.filter((p) => {
      const at = removedPages.get(p.id);
      if (at === undefined) return true;
      if (p.modified > at) {
        trash = trash.filter((t) => !(t.kind === 'page' && t.page?.id === p.id));
        return true;
      }
      stats.removed++;
      return false;
    });
    return { ...s, pages: pages.length ? pages : [newPage()] };
  });
  if (!sections.length) sections = local.sections;

  const groups = [...local.groups];
  for (const g of remote.groups) if (!groups.some((x) => x.id === g.id)) groups.push(g);
  const templates = [...local.templates];
  for (const t of remote.templates) if (!templates.some((x) => x.id === t.id)) templates.push(t);
  const tagDefs = [...local.tagDefs];
  for (const t of remote.tagDefs) if (!tagDefs.some((x) => x.id === t.id)) tagDefs.push(t);

  stats.nb = { ...local, sections, groups, assets, ocr, trash, templates, tagDefs, syncedAt: now, shared: true, title: local.title };
  return stats;
}
