import { emptyDataModel, type Cxn, type DataModel, type Pt } from './datamodel';
import { el, kid, kidsOf, local, textOf, txt, type El } from './xml';

/*
 * El contenido editable de un SmartArt: un árbol de nodos con texto (lo que muestra el panel de texto) y las operaciones puras que lo
 * cambian. Se convierte de y a `dgm:dataModel`; al volver al modelo de datos se descartan los puntos de presentación (`pres`), que
 * regenera el motor al ejecutar el diseño, y las transiciones y conexiones se rehacen conservando los identificadores que ya había.
 */

export interface SmartNode {
  id: string;
  type: 'node' | 'asst';
  /** Líneas separadas por salto de línea; es lo que se ve y se edita. */
  text: string;
  /** El cuerpo de texto original (`dgm:t`), con su formato; se descarta al cambiar el texto. */
  t?: El;
  /** Marcador de posición («[Texto]»): no tiene texto propio. */
  placeholder?: boolean;
  children: SmartNode[];
}

export interface SmartTree {
  /** Identificador del punto `doc`. */
  docId: string;
  /** Atributos del `dgm:prSet` del punto `doc` (diseño, estilo y colores elegidos). */
  docPr: Record<string, string>;
  roots: SmartNode[];
}

/** Generador de identificadores con el aspecto de los de Office: `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`. */
export const newGuid = (): string => `{${globalThis.crypto.randomUUID().toUpperCase()}}`;

/** Un generador determinista (para pruebas y para guardar sin cambios aleatorios). */
export function counterIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `{${prefix}${String(++n).padStart(6, '0')}}`;
}

// ---- texto
function paragraphsOf(t: El | undefined): string {
  if (!t) return '';
  const out: string[] = [];
  for (const p of kidsOf(t, 'p')) {
    let line = '';
    for (const r of p.kids) {
      const n = local(r.name);
      if (n === 'r' || n === 'fld') line += textOf(kid(r, 't'));
      else if (n === 'br') line += '\n';
    }
    out.push(line);
  }
  // los párrafos vacíos del final no cuentan
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

/** El cuerpo de texto de un punto para este texto (un párrafo por línea). */
export function textBody(text: string, lang = 'es-ES'): El {
  const paras = (text === '' ? [''] : text.split('\n')).map((line) =>
    line === '' ? el('a:p', {}, [el('a:endParaRPr', { lang })]) : el('a:p', {}, [el('a:r', {}, [el('a:rPr', { lang }), el('a:t', {}, [txt(line)])])]),
  );
  return el('dgm:t', {}, [el('a:bodyPr'), el('a:lstStyle'), ...paras]);
}

// ---- modelo de datos <-> árbol
export function dataModelToTree(dm: DataModel): SmartTree {
  const doc = dm.pts.find((p) => p.type === 'doc');
  const docId = doc?.modelId ?? '';
  const byId = new Map<string, Pt>(dm.pts.map((p) => [p.modelId, p]));
  const kidsOfId = new Map<string, Cxn[]>();
  for (const c of dm.cxns) {
    if (c.type !== 'parOf') continue;
    const s = byId.get(c.srcId);
    const d = byId.get(c.destId);
    if (!s || !d || (d.type !== 'node' && d.type !== 'asst')) continue;
    const l = kidsOfId.get(c.srcId) ?? [];
    l.push(c);
    kidsOfId.set(c.srcId, l);
  }
  const seen = new Set<string>();
  const build = (id: string): SmartNode[] =>
    (kidsOfId.get(id) ?? [])
      .slice()
      .sort((a, b) => a.srcOrd - b.srcOrd)
      .flatMap((c) => {
        const p = byId.get(c.destId)!;
        if (seen.has(p.modelId)) return []; // un ciclo en un archivo dañado
        seen.add(p.modelId);
        const node: SmartNode = { id: p.modelId, type: p.type === 'asst' ? 'asst' : 'node', text: paragraphsOf(p.t), children: build(p.modelId) };
        if (p.t) node.t = p.t;
        if (p.prSet?.phldr === '1') node.placeholder = true;
        return [node];
      });
  return { docId, docPr: { ...(doc?.prSet ?? {}) }, roots: build(docId) };
}

export function treeToDataModel(tree: SmartTree, prev?: DataModel, ids: () => string = newGuid): DataModel {
  const dm: DataModel = prev ? { ...emptyDataModel(), rootAttrs: { ...prev.rootAttrs }, bg: prev.bg, whole: prev.whole } : emptyDataModel();
  // identificadores de conexiones y transiciones ya existentes, por pareja origen→destino
  const old = new Map<string, Cxn>();
  for (const c of prev?.cxns ?? []) if (c.type === 'parOf') old.set(`${c.srcId}>${c.destId}`, c);
  const oldPt = new Map<string, Pt>((prev?.pts ?? []).map((p) => [p.modelId, p]));
  const docPrev = prev?.pts.find((p) => p.type === 'doc');
  dm.pts.push({ ...(docPrev ?? {}), modelId: tree.docId, type: 'doc', prSet: { ...tree.docPr }, spPr: docPrev?.spPr, t: docPrev?.t });
  const walk = (parentId: string, list: SmartNode[]) => {
    list.forEach((n, i) => {
      const prevCxn = old.get(`${parentId}>${n.id}`);
      const cxnId = prevCxn?.modelId ?? ids();
      const parTransId = prevCxn?.parTransId ?? ids();
      const sibTransId = prevCxn?.sibTransId ?? ids();
      const before = oldPt.get(n.id);
      const pt: Pt = { modelId: n.id, type: n.type, spPr: before?.spPr, t: n.t ?? textBody(n.text) };
      if (before?.prSet) pt.prSet = { ...before.prSet };
      if (n.placeholder) pt.prSet = { ...(pt.prSet ?? {}), phldr: '1' };
      else if (pt.prSet && n.text !== '') delete pt.prSet.phldr;
      dm.pts.push(pt);
      dm.pts.push({ modelId: parTransId, type: 'parTrans', extra: { cxnId } });
      dm.pts.push({ modelId: sibTransId, type: 'sibTrans', extra: { cxnId } });
      dm.cxns.push({ modelId: cxnId, type: 'parOf', srcId: parentId, destId: n.id, srcOrd: i, destOrd: 0, parTransId, sibTransId });
      walk(n.id, n.children);
    });
  };
  walk(tree.docId, tree.roots);
  return dm;
}

/** Un árbol nuevo con un documento vacío y los identificadores de diseño, estilo y colores. */
export function newTree(o: { layout: string; style: string; colors: string; layoutCat?: string; styleCat?: string; colorsCat?: string }, ids: () => string = newGuid): SmartTree {
  return {
    docId: ids(),
    docPr: { loTypeId: o.layout, loCatId: o.layoutCat ?? '', qsTypeId: o.style, qsCatId: o.styleCat ?? 'simple', csTypeId: o.colors, csCatId: o.colorsCat ?? 'accent1', phldr: '0' },
    roots: [],
  };
}

// ---- operaciones
interface Place {
  list: SmartNode[];
  index: number;
  parent: SmartNode | null;
}

function locate(tree: SmartTree, id: string): Place | null {
  const search = (list: SmartNode[], parent: SmartNode | null): Place | null => {
    for (let i = 0; i < list.length; i++) {
      if (list[i]!.id === id) return { list, index: i, parent };
      const r = search(list[i]!.children, list[i]!);
      if (r) return r;
    }
    return null;
  };
  return search(tree.roots, null);
}

const clone = (tree: SmartTree): SmartTree => structuredClone(tree);

/** Cada nodo en orden de lectura con su profundidad (0 = primer nivel). */
export function flatten(tree: SmartTree): { id: string; text: string; level: number; type: 'node' | 'asst' }[] {
  const out: { id: string; text: string; level: number; type: 'node' | 'asst' }[] = [];
  const walk = (list: SmartNode[], level: number) => {
    for (const n of list) {
      out.push({ id: n.id, text: n.text, level, type: n.type });
      walk(n.children, level + 1);
    }
  };
  walk(tree.roots, 0);
  return out;
}

export function findNode(tree: SmartTree, id: string): SmartNode | undefined {
  const p = locate(tree, id);
  return p ? p.list[p.index] : undefined;
}

export function setText(tree: SmartTree, id: string, text: string): SmartTree {
  const t = clone(tree);
  const p = locate(t, id);
  if (!p) return tree;
  const n = p.list[p.index]!;
  if (n.text === text) return tree;
  n.text = text;
  delete n.t;
  delete n.placeholder;
  return t;
}

const make = (text: string, ids: () => string): SmartNode => ({ id: ids(), type: 'node', text, children: [] });

/** Añade un nodo de primer nivel al final. */
export function addRoot(tree: SmartTree, text = '', ids: () => string = newGuid): { tree: SmartTree; id: string } {
  const t = clone(tree);
  const n = make(text, ids);
  t.roots.push(n);
  return { tree: t, id: n.id };
}

/** Añade un hijo al final de los de `id`. */
export function addChild(tree: SmartTree, id: string, text = '', ids: () => string = newGuid): { tree: SmartTree; id: string } {
  const t = clone(tree);
  const p = locate(t, id);
  if (!p) return { tree, id: '' };
  const n = make(text, ids);
  p.list[p.index]!.children.push(n);
  return { tree: t, id: n.id };
}

/** Añade un hermano justo después (o antes) de `id`. */
export function addSibling(tree: SmartTree, id: string, text = '', after = true, ids: () => string = newGuid): { tree: SmartTree; id: string } {
  const t = clone(tree);
  const p = locate(t, id);
  if (!p) return { tree, id: '' };
  const n = make(text, ids);
  p.list.splice(p.index + (after ? 1 : 0), 0, n);
  return { tree: t, id: n.id };
}

/** Quita un nodo; sus hijos pasan a ocupar su lugar (no se pierden). */
export function removeNode(tree: SmartTree, id: string): SmartTree {
  const t = clone(tree);
  const p = locate(t, id);
  if (!p) return tree;
  const [n] = p.list.splice(p.index, 1);
  p.list.splice(p.index, 0, ...n!.children);
  return t;
}

/** Sube un nivel: pasa a ser hermano del padre, justo detrás (con su subárbol). */
export function promote(tree: SmartTree, id: string): SmartTree {
  const t = clone(tree);
  const p = locate(t, id);
  if (!p || !p.parent) return tree;
  const up = locate(t, p.parent.id)!;
  const [n] = p.list.splice(p.index, 1);
  up.list.splice(up.index + 1, 0, n!);
  return t;
}

/** Baja un nivel: pasa a ser el último hijo de su hermano anterior. */
export function demote(tree: SmartTree, id: string): SmartTree {
  const t = clone(tree);
  const p = locate(t, id);
  if (!p || p.index === 0) return tree;
  const [n] = p.list.splice(p.index, 1);
  p.list[p.index - 1]!.children.push(n!);
  return t;
}

/** Cambia de sitio con el hermano anterior (`-1`) o el siguiente (`1`). */
export function moveNode(tree: SmartTree, id: string, delta: -1 | 1): SmartTree {
  const t = clone(tree);
  const p = locate(t, id);
  if (!p) return tree;
  const j = p.index + delta;
  if (j < 0 || j >= p.list.length) return tree;
  [p.list[p.index], p.list[j]] = [p.list[j]!, p.list[p.index]!];
  return t;
}

// ---- esquema de texto (el panel de texto)
/** Una línea por nodo, con un tabulador por nivel. */
export function treeToOutline(tree: SmartTree): string {
  return flatten(tree)
    .map((n) => `${'\t'.repeat(n.level)}${n.text.replace(/\n/g, ' ')}`)
    .join('\n');
}

/**
 * Un árbol a partir del texto del panel (un nodo por línea; un tabulador o dos espacios por nivel; una viñeta inicial se ignora). Los
 * nodos se casan con los de `prev` por orden de lectura: conservan su identificador, su formato y su tipo si el texto no cambió.
 */
export function outlineToTree(text: string, prev: SmartTree, ids: () => string = newGuid): SmartTree {
  const lines: { level: number; text: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^((?:\t| {2})*)(.*)$/.exec(raw);
    const body = (m?.[2] ?? '').trim().replace(/^[-•*]\s+/, '');
    if (body === '') continue;
    lines.push({ level: ((m?.[1] ?? '').replace(/ {2}/g, '\t').length), text: body });
  }
  const before = flatten(prev);
  const oldNodes = before.map((b) => findNode(prev, b.id)!);
  const out: SmartTree = { docId: prev.docId, docPr: { ...prev.docPr }, roots: [] };
  const stack: SmartNode[] = [];
  lines.forEach((ln, i) => {
    const level = Math.min(ln.level, stack.length);
    const old = oldNodes[i];
    // el panel recorta espacios y junta las líneas de un nodo: si no cambió nada más, el nodo queda como estaba (texto y formato)
    const same = !!old && old.text.replace(/\n/g, ' ').trim() === ln.text;
    const node: SmartNode = old ? { id: old.id, type: old.type, text: same ? old.text : ln.text, children: [] } : { id: ids(), type: 'node', text: ln.text, children: [] };
    if (old && same && old.t) node.t = old.t;
    stack.length = level;
    (level === 0 ? out.roots : stack[level - 1]!.children).push(node);
    stack.push(node);
  });
  return out;
}
