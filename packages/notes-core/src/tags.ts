/** Una etiqueta de nota: marca un párrafo con un símbolo (o una casilla que se puede marcar). */
export interface TagDef {
  id: string;
  label: string;
  /** Un carácter (o dos) que se dibuja delante del párrafo. */
  symbol: string;
  color: string;
  /** Con casilla: se puede marcar como hecha (como «Para hacer»). */
  checkbox?: boolean;
  custom?: boolean;
}

/** Las etiquetas que trae Nova Notes. `done` no se elige: es el estado «hecho» de una etiqueta con casilla. */
export const BUILTIN_TAGS: TagDef[] = [
  { id: 'todo', label: 'Para hacer', symbol: '☐', color: '#0f6cbd', checkbox: true },
  { id: 'todo1', label: 'Para hacer: prioridad 1', symbol: '☐', color: '#c50f1f', checkbox: true },
  { id: 'todo2', label: 'Para hacer: prioridad 2', symbol: '☐', color: '#ca5010', checkbox: true },
  { id: 'important', label: 'Importante', symbol: '★', color: '#c19c00' },
  { id: 'question', label: 'Pregunta', symbol: '?', color: '#0f6cbd' },
  { id: 'remember', label: 'Recordar para más tarde', symbol: '⚑', color: '#5c2d91' },
  { id: 'definition', label: 'Definición', symbol: '◆', color: '#107c10' },
  { id: 'highlight', label: 'Resaltar', symbol: '✎', color: '#ca5010' },
  { id: 'idea', label: 'Idea', symbol: '☀', color: '#c19c00' },
  { id: 'critical', label: 'Crítico', symbol: '⚠', color: '#c50f1f' },
  { id: 'contact', label: 'Contacto', symbol: '☺', color: '#0b7a75' },
  { id: 'address', label: 'Dirección', symbol: '⌂', color: '#0b7a75' },
  { id: 'phone', label: 'Número de teléfono', symbol: '☎', color: '#0b7a75' },
  { id: 'website', label: 'Sitio web que visitar', symbol: '➤', color: '#0f6cbd' },
  { id: 'password', label: 'Contraseña', symbol: '✱', color: '#8a8886' },
  { id: 'projectA', label: 'Proyecto A', symbol: '■', color: '#0f6cbd' },
  { id: 'projectB', label: 'Proyecto B', symbol: '▲', color: '#107c10' },
  { id: 'client', label: 'Petición de un cliente', symbol: '◈', color: '#b4009e' },
  { id: 'movie', label: 'Película por ver', symbol: '▶', color: '#8a8886' },
  { id: 'book', label: 'Libro por leer', symbol: '☰', color: '#8a8886' },
  { id: 'music', label: 'Música para escuchar', symbol: '♪', color: '#8a8886' },
  { id: 'source', label: 'Fuente para un artículo', symbol: '❝', color: '#5c2d91' },
  { id: 'blog', label: 'Recordar para el blog', symbol: '✐', color: '#5c2d91' },
  { id: 'discuss1', label: 'Hablar con la persona 1', symbol: '☍', color: '#ca5010' },
  { id: 'discuss2', label: 'Hablar con la persona 2', symbol: '☍', color: '#107c10' },
  { id: 'manager', label: 'Hablar con el responsable', symbol: '☍', color: '#c50f1f' },
  { id: 'email', label: 'Enviar por correo', symbol: '✉', color: '#0f6cbd' },
  { id: 'meeting', label: 'Programar una reunión', symbol: '☷', color: '#0b7a75' },
  { id: 'callback', label: 'Devolver la llamada', symbol: '✆', color: '#107c10' },
];

/** El estado «hecho» de una etiqueta con casilla (se guarda en el párrafo como `etiqueta:done`). */
export const DONE_SUFFIX = ':done';

export const isDone = (tag: string | null | undefined): boolean => !!tag && tag.endsWith(DONE_SUFFIX);
export const baseTag = (tag: string | null | undefined): string | null => (tag ? (isDone(tag) ? tag.slice(0, -DONE_SUFFIX.length) : tag) : null);
/** El antiguo `done` (de una versión anterior) es «Para hacer» marcada. */
export function normalizeTag(tag: string | null | undefined): string | null {
  if (!tag) return null;
  if (tag === 'done') return `todo${DONE_SUFFIX}`;
  return tag;
}

export function tagDefs(custom: TagDef[] = []): TagDef[] {
  return [...BUILTIN_TAGS, ...custom.map((c) => ({ ...c, custom: true }))];
}

export function findTag(id: string | null | undefined, custom: TagDef[] = []): TagDef | undefined {
  const b = baseTag(normalizeTag(id));
  return b ? tagDefs(custom).find((t) => t.id === b) : undefined;
}

const CSS_ID = /^[A-Za-z0-9_-]+$/;
const cssEsc = (s: string) => s.replace(/[^A-Za-z0-9 _-]/g, '');

/** Reglas de CSS para dibujar todas las etiquetas (propias incluidas) delante de los párrafos. */
export function tagCss(custom: TagDef[] = []): string {
  const rules: string[] = [];
  for (const t of tagDefs(custom)) {
    if (!CSS_ID.test(t.id)) continue;
    const sym = JSON.stringify(t.checkbox ? '☐' : t.symbol.slice(0, 2));
    rules.push(`.nn-doc p[data-tag='${t.id}']::before{content:${sym};color:${/^#[0-9a-fA-F]{3,8}$/.test(t.color) ? t.color : '#555'}}`);
    if (t.checkbox) rules.push(`.nn-doc p[data-tag='${t.id}${DONE_SUFFIX}']::before{content:"☑";color:#107c10}.nn-doc p[data-tag='${t.id}${DONE_SUFFIX}']{color:#797775;text-decoration:line-through}`);
  }
  void cssEsc;
  return rules.join('\n');
}

export function newCustomTag(label: string, symbol: string, color: string, checkbox = false): TagDef {
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { id, label: label.trim().slice(0, 60) || 'Etiqueta', symbol: Array.from(symbol.trim() || '●').slice(0, 2).join(''), color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0f6cbd', checkbox, custom: true };
}
