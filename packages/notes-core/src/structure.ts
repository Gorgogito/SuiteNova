import { MAX_LEVEL, TRASH_DAYS, newId, newPage, newSection, type Notebook, type Page, type Section, type SectionGroup, type TrashItem } from './model';

/*
 * Estructura de la libreta: subpáginas, grupos de secciones, papelera y plantillas de usuario. Son funciones puras: reciben una
 * libreta y devuelven otra (la original no se toca), para poder deshacer y para probarlas sin interfaz.
 */

const withSection = (nb: Notebook, id: string, fn: (s: Section) => Section): Notebook => {
  let changed = false;
  const sections = nb.sections.map((s) => {
    if (s.id !== id) return s;
    const n = fn(s);
    if (n !== s) changed = true;
    return n;
  });
  return changed ? { ...nb, sections } : nb;
};

// ------------------------------------------------------------------ subpáginas

export interface PageRow {
  page: Page;
  depth: number;
  hasChildren: boolean;
}

/** Las páginas de una sección en orden, sin las subpáginas de las páginas plegadas. */
export function pageRows(section: Section, collapsed: Set<string> = new Set()): PageRow[] {
  const out: PageRow[] = [];
  let hideBelow = -1;
  section.pages.forEach((p, i) => {
    if (hideBelow >= 0 && p.level > hideBelow) return;
    hideBelow = -1;
    const next = section.pages[i + 1];
    const hasChildren = !!next && next.level > p.level;
    out.push({ page: p, depth: p.level, hasChildren });
    if (hasChildren && collapsed.has(p.id)) hideBelow = p.level;
  });
  return out;
}

/** Las páginas que cuelgan de una (sus subpáginas, a cualquier nivel). */
export function subpagesOf(section: Section, pageId: string): Page[] {
  const i = section.pages.findIndex((p) => p.id === pageId);
  if (i < 0) return [];
  const base = section.pages[i]!.level;
  const out: Page[] = [];
  for (let k = i + 1; k < section.pages.length && section.pages[k]!.level > base; k++) out.push(section.pages[k]!);
  return out;
}

/**
 * Cambia el nivel de una página con sus subpáginas. Una página no puede ser subpágina de nada si es la primera, ni quedar dos
 * niveles por debajo de la anterior.
 */
export function setPageLevel(nb: Notebook, sectionId: string, pageId: string, delta: 1 | -1): Notebook {
  return withSection(nb, sectionId, (s) => {
    const i = s.pages.findIndex((p) => p.id === pageId);
    if (i < 0) return s;
    const group = [s.pages[i]!, ...subpagesOf(s, pageId)];
    const cur = s.pages[i]!.level;
    const prev = s.pages[i - 1];
    const level = cur + delta;
    if (level < 0 || level > MAX_LEVEL) return s;
    if (delta > 0 && (!prev || level > prev.level + 1)) return s;
    if (group.some((p) => p.level + delta > MAX_LEVEL)) return s;
    const ids = new Set(group.map((p) => p.id));
    return { ...s, pages: s.pages.map((p) => (ids.has(p.id) ? { ...p, level: (p.level + delta) as Page['level'] } : p)) };
  });
}

/** Mueve una página con sus subpáginas una posición hacia arriba o abajo (por encima o por debajo de la página vecina del mismo nivel). */
export function movePageGroup(nb: Notebook, sectionId: string, pageId: string, dir: -1 | 1): Notebook {
  return withSection(nb, sectionId, (s) => {
    const i = s.pages.findIndex((p) => p.id === pageId);
    if (i < 0) return s;
    const group = [s.pages[i]!, ...subpagesOf(s, pageId)];
    const lvl = s.pages[i]!.level;
    if (dir < 0) {
      // salta la página anterior de este nivel con sus subpáginas
      let j = i - 1;
      while (j >= 0 && s.pages[j]!.level > lvl) j--;
      if (j < 0 || s.pages[j]!.level < lvl) return s;
      const pages = [...s.pages.slice(0, j), ...group, ...s.pages.slice(j, i), ...s.pages.slice(i + group.length)];
      return { ...s, pages };
    }
    const after = i + group.length;
    const nextPage = s.pages[after];
    if (!nextPage || nextPage.level !== lvl) return s;
    const nextGroup = [nextPage, ...subpagesOf(s, nextPage.id)];
    const pages = [...s.pages.slice(0, i), ...nextGroup, ...group, ...s.pages.slice(after + nextGroup.length)];
    return { ...s, pages };
  });
}

// ------------------------------------------------------------------ grupos de secciones

/** Los grupos y secciones que están directamente dentro de un grupo (o en el nivel superior si `groupId` es null). */
export function groupContents(nb: Notebook, groupId: string | null): { groups: SectionGroup[]; sections: Section[] } {
  return { groups: nb.groups.filter((g) => (g.parent ?? null) === groupId), sections: nb.sections.filter((s) => (s.group ?? null) === groupId) };
}

export function groupPath(nb: Notebook, groupId: string | null): SectionGroup[] {
  const out: SectionGroup[] = [];
  for (let g = nb.groups.find((x) => x.id === groupId); g && out.length < 20; g = nb.groups.find((x) => x.id === g!.parent)) out.unshift(g);
  return out;
}

export function addGroup(nb: Notebook, name: string, parent: string | null): { nb: Notebook; group: SectionGroup } {
  const group: SectionGroup = { id: newId('g'), name: name.trim() || 'Grupo de secciones', color: '#69797e', parent: parent ?? undefined };
  if (!group.parent) delete group.parent;
  return { nb: { ...nb, groups: [...nb.groups, group] }, group };
}

export function renameGroup(nb: Notebook, id: string, name: string): Notebook {
  const n = name.trim();
  return n ? { ...nb, groups: nb.groups.map((g) => (g.id === id ? { ...g, name: n } : g)) } : nb;
}

/** Mueve una sección a un grupo (o al nivel superior). */
export function moveSectionToGroup(nb: Notebook, sectionId: string, groupId: string | null): Notebook {
  return withSection(nb, sectionId, (s) => {
    const { group: _g, ...rest } = s;
    void _g;
    return groupId ? { ...rest, group: groupId } : rest;
  });
}

/** Quita un grupo: sus secciones y subgrupos suben un nivel. */
export function ungroup(nb: Notebook, groupId: string): Notebook {
  const g = nb.groups.find((x) => x.id === groupId);
  if (!g) return nb;
  return {
    ...nb,
    groups: nb.groups.filter((x) => x.id !== groupId).map((x) => (x.parent === groupId ? (g.parent ? { ...x, parent: g.parent } : (({ parent: _p, ...r }) => (void _p, r))(x)) : x)),
    sections: nb.sections.map((s) => (s.group === groupId ? (g.parent ? { ...s, group: g.parent } : (({ group: _x, ...r }) => (void _x, r))(s)) : s)),
  };
}

/** ¿Es `candidate` el propio grupo o uno de sus descendientes? (para no meter un grupo dentro de sí mismo) */
export function isInsideGroup(nb: Notebook, candidate: string | null, groupId: string): boolean {
  for (let g = nb.groups.find((x) => x.id === candidate), n = 0; g && n < 50; g = nb.groups.find((x) => x.id === g!.parent), n++) if (g.id === groupId) return true;
  return false;
}

// ------------------------------------------------------------------ papelera

export function trashPage(nb: Notebook, sectionId: string, pageId: string, now = Date.now()): Notebook {
  const s = nb.sections.find((x) => x.id === sectionId);
  const i = s?.pages.findIndex((p) => p.id === pageId) ?? -1;
  if (!s || i < 0) return nb;
  const page = s.pages[i]!;
  const item: TrashItem = { id: newId('t'), kind: 'page', at: now, from: sectionId, index: i, page };
  const rest = s.pages.filter((p) => p.id !== pageId);
  return { ...withSection(nb, sectionId, (x) => ({ ...x, pages: rest.length ? rest : [newPage()] })), trash: [...nb.trash, item] };
}

export function trashSection(nb: Notebook, sectionId: string, now = Date.now()): Notebook {
  const i = nb.sections.findIndex((s) => s.id === sectionId);
  if (i < 0 || nb.sections.length <= 1) return nb;
  const item: TrashItem = { id: newId('t'), kind: 'section', at: now, from: sectionId, index: i, section: nb.sections[i]! };
  return { ...nb, sections: nb.sections.filter((s) => s.id !== sectionId), trash: [...nb.trash, item] };
}

/** Saca algo de la papelera. Una página vuelve a su sección (o a una nueva si esa ya no está). Devuelve dónde quedó. */
export function restoreTrash(nb: Notebook, id: string): { nb: Notebook; sectionId: string; pageId?: string } | null {
  const item = nb.trash.find((t) => t.id === id);
  if (!item) return null;
  const trash = nb.trash.filter((t) => t.id !== id);
  if (item.kind === 'section' && item.section) {
    const sections = [...nb.sections];
    sections.splice(Math.min(item.index, sections.length), 0, item.section);
    return { nb: { ...nb, sections, trash }, sectionId: item.section.id };
  }
  if (item.kind === 'page' && item.page) {
    let n: Notebook = { ...nb, trash };
    let target = n.sections.find((s) => s.id === item.from);
    if (!target) {
      const s = newSection('Páginas restauradas', n.sections.length);
      s.pages = [];
      n = { ...n, sections: [...n.sections, s] };
      target = s;
    }
    const pageId = item.page.id;
    // la página que se creó vacía al quitar la última de una sección sobra
    n = withSection(n, target.id, (s) => {
      const pages = s.pages.length === 1 && s.pages[0]!.versions.length === 0 && s.pages[0]!.ink.length === 0 && !s.pages[0]!.title && s.pages[0]!.containers.length === 1 && s.pages[0]!.created > item.at - 5 && s.pages[0]!.modified === s.pages[0]!.created ? [] : [...s.pages];
      pages.splice(Math.min(item.index, pages.length), 0, item.page!);
      return { ...s, pages };
    });
    return { nb: n, sectionId: target.id, pageId };
  }
  return null;
}

export function purgeTrash(nb: Notebook, id?: string): Notebook {
  return { ...nb, trash: id ? nb.trash.filter((t) => t.id !== id) : [] };
}

/** Quita de la papelera lo que lleva más de 60 días. */
export function expireTrash(nb: Notebook, now = Date.now()): Notebook {
  const limit = now - TRASH_DAYS * 86400000;
  const keep = nb.trash.filter((t) => t.at >= limit);
  return keep.length === nb.trash.length ? nb : { ...nb, trash: keep };
}

export const trashTitle = (t: TrashItem): string => (t.kind === 'section' ? (t.section?.name ?? 'Sección') : t.page && !t.page.vault ? t.page.title || 'Página sin título' : 'Página');
