/**
 * Edición estructurada de una ecuación: el estado es el árbol (`MNode`) más un cursor. El cursor es una ruta por las
 * casillas (numerador, denominador, base, índice...) y una posición dentro de la fila de esa casilla. Todas las
 * operaciones son funciones puras (devuelven un estado nuevo), así que deshacer es guardar estados y se prueban sin
 * navegador.
 */
import { ACCENTS, FUNCS, GREEK, NARY, SYMBOLS } from './tables';
import type { MNode } from './math';
import { STRUCTURES } from './structures';

/** Un paso de la ruta: el hijo `i` de la fila actual, entrando por su casilla `k`. */
export interface Step {
  i: number;
  k: string;
}

export interface EditState {
  root: MNode;
  path: Step[];
  /** Posición del cursor en la fila de la ruta. */
  at: number;
  /** Extremo fijo de la selección (en la misma fila que el cursor). */
  anchor?: number;
  /** Texto de una escritura `\nombre` en curso. */
  esc?: string;
}

export const emptyRow = (): MNode => ({ t: 'row', c: [] });
export const mkRow = (c: MNode[]): MNode => ({ t: 'row', c });
export const asList = (n: MNode): MNode[] => (n.t === 'row' ? n.c : [n]);
export const isEmptyRow = (n: MNode): boolean => asList(n).length === 0;

// ------------------------------------------------------------------------------------------------- casillas

/** Las casillas de un nodo, en el orden en que se recorren con las flechas. */
export function slotsOf(n: MNode): string[] {
  switch (n.t) {
    case 'frac': return ['n', 'd'];
    case 'sup':
    case 'sub': return ['b', 's'];
    case 'subsup': return ['b', 'sub', 'sup'];
    case 'pre': return ['sub', 'sup', 'b'];
    case 'sqrt': return n.deg ? ['deg', 'c'] : ['c'];
    case 'nary': return [...(n.sub ? ['sub'] : []), ...(n.sup ? ['sup'] : []), 'c'];
    case 'fenced': return n.c.map((_, i) => `c${i}`);
    case 'func': return n.sub ? ['sub', 'c'] : ['c'];
    case 'acc':
    case 'bar':
    case 'box': return ['c'];
    case 'limit': return ['b', 'lim'];
    case 'matrix': return n.rows.flatMap((r, ri) => r.map((_, ci) => `${ri}:${ci}`));
    case 'eqarr': return n.rows.map((_, i) => `r${i}`);
    default: return [];
  }
}

export function getSlot(n: MNode, k: string): MNode {
  switch (n.t) {
    case 'frac': return k === 'n' ? n.n : n.d;
    case 'sup':
    case 'sub': return k === 'b' ? n.b : n.s;
    case 'subsup':
    case 'pre': return k === 'b' ? n.b : k === 'sub' ? n.sub : n.sup;
    case 'sqrt': return k === 'deg' ? n.deg ?? emptyRow() : n.c;
    case 'nary': return k === 'sub' ? n.sub ?? emptyRow() : k === 'sup' ? n.sup ?? emptyRow() : n.c;
    case 'fenced': return n.c[+k.slice(1)] ?? emptyRow();
    case 'func': return k === 'sub' ? n.sub ?? emptyRow() : n.c;
    case 'acc':
    case 'bar':
    case 'box': return n.c;
    case 'limit': return k === 'b' ? n.b : n.lim;
    case 'matrix': {
      const [r, c] = k.split(':').map(Number);
      return n.rows[r!]?.[c!] ?? emptyRow();
    }
    case 'eqarr': return n.rows[+k.slice(1)] ?? emptyRow();
    default: return emptyRow();
  }
}

export function setSlot(n: MNode, k: string, v: MNode): MNode {
  switch (n.t) {
    case 'frac': return k === 'n' ? { ...n, n: v } : { ...n, d: v };
    case 'sup': return k === 'b' ? { ...n, b: v } : { ...n, s: v };
    case 'sub': return k === 'b' ? { ...n, b: v } : { ...n, s: v };
    case 'subsup': return k === 'b' ? { ...n, b: v } : k === 'sub' ? { ...n, sub: v } : { ...n, sup: v };
    case 'pre': return k === 'b' ? { ...n, b: v } : k === 'sub' ? { ...n, sub: v } : { ...n, sup: v };
    case 'sqrt': return k === 'deg' ? { ...n, deg: v } : { ...n, c: v };
    case 'nary': return k === 'sub' ? { ...n, sub: v } : k === 'sup' ? { ...n, sup: v } : { ...n, c: v };
    case 'fenced': return { ...n, c: n.c.map((x, i) => (i === +k.slice(1) ? v : x)) };
    case 'func': return k === 'sub' ? { ...n, sub: v } : { ...n, c: v };
    case 'acc':
    case 'bar':
    case 'box': return { ...n, c: v };
    case 'limit': return k === 'b' ? { ...n, b: v } : { ...n, lim: v };
    case 'matrix': {
      const [r, c] = k.split(':').map(Number);
      return { ...n, rows: n.rows.map((rw, ri) => (ri === r ? rw.map((x, ci) => (ci === c ? v : x)) : rw)) };
    }
    case 'eqarr': return { ...n, rows: n.rows.map((x, i) => (i === +k.slice(1) ? v : x)) };
    default: return n;
  }
}

/** ¿Todas las casillas del nodo están vacías? */
export const isEmptyNode = (n: MNode): boolean => slotsOf(n).every((k) => isEmptyRow(getSlot(n, k)));

/** Cambia la fila a la que apunta `path` con `fn`, sin tocar el resto del árbol. */
export function updateRow(rootRow: MNode, path: Step[], fn: (list: MNode[]) => MNode[]): MNode {
  const list = asList(rootRow);
  if (!path.length) return mkRow(fn(list));
  const [s, ...rest] = path as [Step, ...Step[]];
  const child = list[s.i];
  if (!child) return mkRow(list);
  const next = setSlot(child, s.k, updateRow(getSlot(child, s.k), rest, fn));
  return mkRow(list.map((x, j) => (j === s.i ? next : x)));
}

/** La fila donde está el cursor. */
export function rowAt(root: MNode, path: Step[]): MNode[] {
  let list = asList(root);
  for (const s of path) {
    const child = list[s.i];
    if (!child) return [];
    list = asList(getSlot(child, s.k));
  }
  return list;
}

export const currentRow = (st: EditState): MNode[] => rowAt(st.root, st.path);

// ------------------------------------------------------------------------------------------------- estado

export function fromTree(tree: MNode, atEnd = true): EditState {
  const list = asList(tree);
  return { root: mkRow(list), path: [], at: atEnd ? list.length : 0 };
}
/** El árbol listo para usar: las casillas con un solo elemento dejan de ser filas (como lo deja `parseMath`). */
export function cleanTree(n: MNode): MNode {
  if (n.t === 'row') return { t: 'row', c: n.c.map(cleanTree) };
  let out: MNode = n;
  for (const k of slotsOf(n)) {
    const v = cleanTree(getSlot(n, k));
    out = setSlot(out, k, v.t === 'row' && v.c.length === 1 ? v.c[0]! : v);
  }
  return out;
}
export const toTree = (st: EditState): MNode => cleanTree(st.root);

const clone = (st: EditState, patch: Partial<EditState>): EditState => ({ ...st, ...patch });

/** Cambia la fila actual y el cursor. */
function edit(st: EditState, fn: (list: MNode[], at: number) => { list: MNode[]; at: number; path?: Step[] }): EditState {
  const cur = currentRow(st);
  const r = fn(cur, st.at);
  return { root: updateRow(st.root, st.path, () => r.list), path: r.path ?? st.path, at: r.at };
}

export const hasSelection = (st: EditState): boolean => st.anchor !== undefined && st.anchor !== st.at;
export const selectionRange = (st: EditState): [number, number] => (st.anchor === undefined ? [st.at, st.at] : [Math.min(st.anchor, st.at), Math.max(st.anchor, st.at)]);
export const selectedNodes = (st: EditState): MNode[] => {
  const [a, b] = selectionRange(st);
  return currentRow(st).slice(a, b);
};

/** Borra lo seleccionado (si hay algo). */
export function deleteSelection(st: EditState): EditState {
  if (!hasSelection(st)) return clone(st, { anchor: undefined });
  const [a, b] = selectionRange(st);
  const out = edit(st, (list) => ({ list: [...list.slice(0, a), ...list.slice(b)], at: a }));
  return { ...out, anchor: undefined, esc: undefined };
}

// ------------------------------------------------------------------------------------------------- insertar

const simple = (n: MNode) => n.t === 'id' || n.t === 'num' || ((n.t === 'sup' || n.t === 'sub' || n.t === 'subsup') && (n.b.t === 'id' || n.b.t === 'num'));

/** Inserta un nodo en el cursor. */
export function insertNode(st: EditState, node: MNode): EditState {
  const s = deleteSelection(st);
  return { ...edit(s, (list, at) => ({ list: [...list.slice(0, at), node, ...list.slice(at)], at: at + 1 })), anchor: undefined, esc: undefined };
}

/** Inserta varios nodos (lo pegado) en el cursor. */
export const insertNodes = (st: EditState, nodes: MNode[]): EditState => nodes.reduce((s, n) => insertNode(s, n), deleteSelection(st));

/** Inserta un nodo con casillas: con una selección, esta pasa a la casilla `fill`; si no, el cursor entra en la casilla `focus`. */
export function insertWithSlots(st: EditState, node: MNode, focus: string, fill?: string): EditState {
  if (hasSelection(st) && fill) {
    const [a, b] = selectionRange(st);
    const sel = selectedNodes(st);
    const filled = setSlot(node, fill, mkRow(sel));
    const out = edit(st, (list) => ({ list: [...list.slice(0, a), filled, ...list.slice(b)], at: a + 1 }));
    return { ...out, anchor: undefined, esc: undefined };
  }
  const s = deleteSelection(st);
  const idx = s.at;
  const out = edit(s, (list, at) => ({ list: [...list.slice(0, at), node, ...list.slice(at)], at: 0, path: [...s.path, { i: idx, k: focus }] }));
  return { ...out, anchor: undefined, esc: undefined };
}

/** Lo que precede al cursor y hace de operando (de `/`, `^`, `_`): sin paréntesis si es un grupo, o la racha de letras y cifras. */
function takeBack(list: MNode[], at: number, run: boolean): { from: number; nodes: MNode[] } {
  if (at === 0) return { from: 0, nodes: [] };
  const prev = list[at - 1]!;
  if (run && prev.t === 'fenced' && prev.open === '(' && prev.close === ')' && prev.c.length === 1) return { from: at - 1, nodes: asList(prev.c[0]!) };
  if (!run || !simple(prev)) return { from: at - 1, nodes: [prev] };
  let from = at - 1;
  while (from > 0 && simple(list[from - 1]!)) from--;
  return { from, nodes: list.slice(from, at) };
}

/** Construye una fracción con lo que precede como numerador; el cursor pasa al denominador. */
export function buildFraction(st: EditState, kind: 'bar' | 'noBar' | 'lin' | 'skw' = 'bar'): EditState {
  const s = deleteSelection(st);
  const list = currentRow(s);
  const { from, nodes } = takeBack(list, s.at, true);
  const frac: MNode = { t: 'frac', n: mkRow(nodes), d: emptyRow(), bar: kind !== 'noBar', ...(kind === 'lin' || kind === 'skw' ? { kind } : {}) };
  const out = edit(s, (l) => ({ list: [...l.slice(0, from), frac, ...l.slice(s.at)], at: 0, path: [...s.path, { i: from, k: nodes.length ? 'd' : 'n' }] }));
  return { ...out, anchor: undefined, esc: undefined };
}

/** Superíndice o subíndice del elemento que precede al cursor. */
export function buildScript(st: EditState, kind: 'sup' | 'sub'): EditState {
  const s = deleteSelection(st);
  // `x_i^2`: un superíndice escrito dentro de un subíndice (o al revés) es del mismo elemento
  const last = s.path[s.path.length - 1];
  if (last && last.k === 's' && s.at > 0 && s.at === currentRow(s).length) {
    const parentPath = s.path.slice(0, -1);
    const node = rowAt(s.root, parentPath)[last.i];
    if (node && ((node.t === 'sub' && kind === 'sup') || (node.t === 'sup' && kind === 'sub'))) {
      const both: MNode = node.t === 'sub' ? { t: 'subsup', b: node.b, sub: node.s, sup: emptyRow() } : { t: 'subsup', b: node.b, sub: emptyRow(), sup: node.s };
      const root = updateRow(s.root, parentPath, (l) => l.map((x, i) => (i === last.i ? both : x)));
      return { root, path: [...parentPath, { i: last.i, k: kind }], at: 0 };
    }
  }
  const list = currentRow(s);
  const prev = s.at > 0 ? list[s.at - 1] : undefined;
  let node: MNode;
  let key: string;
  let from = s.at - 1;
  if (prev && kind === 'sup' && prev.t === 'sub') {
    node = { t: 'subsup', b: prev.b, sub: prev.s, sup: emptyRow() };
    key = 'sup';
  } else if (prev && kind === 'sub' && prev.t === 'sup') {
    node = { t: 'subsup', b: prev.b, sub: emptyRow(), sup: prev.s };
    key = 'sub';
  } else if (prev) {
    node = kind === 'sup' ? { t: 'sup', b: mkRow([prev]), s: emptyRow() } : { t: 'sub', b: mkRow([prev]), s: emptyRow() };
    key = 's';
  } else {
    from = s.at;
    node = kind === 'sup' ? { t: 'sup', b: emptyRow(), s: emptyRow() } : { t: 'sub', b: emptyRow(), s: emptyRow() };
    key = 'b';
  }
  const out = edit(s, (l) => ({ list: [...l.slice(0, from), node, ...l.slice(s.at)], at: 0, path: [...s.path, { i: from, k: key }] }));
  return { ...out, anchor: undefined, esc: undefined };
}

/** Una estructura de la galería (fracción, raíz, matriz...). */
export function insertStructure(st: EditState, id: string): EditState {
  const def = STRUCTURES.find((x) => x.id === id);
  if (!def) return st;
  if (def.script) return buildScript(st, def.script);
  if (def.fraction) return buildFraction(st, def.fraction);
  if (!def.make) return st;
  const m = def.make();
  return insertWithSlots(st, m.node, m.focus, m.fill);
}

// ------------------------------------------------------------------------------------------------- escritura

const ESC_STRUCT: Record<string, string> = {
  frac: 'frac', dfrac: 'frac', binom: 'binom', sqrt: 'sqrt', matrix: 'matrix', pmatrix: 'matrix-p', bmatrix: 'matrix-b', vmatrix: 'matrix-v', cases: 'cases', aligned: 'eqarr', boxed: 'box',
  overline: 'overline', underline: 'underline', sum: 'nary-∑', prod: 'nary-∏', int: 'nary-∫', iint: 'nary-∬', iiint: 'nary-∭', oint: 'nary-∮',
};

/** Pone en el cursor lo que significa `\nombre`. */
function resolveEscape(st: EditState): EditState {
  const name = st.esc ?? '';
  const base: EditState = { ...st, esc: undefined };
  if (!name) return base;
  if (GREEK[name]) return insertNode(base, { t: 'id', v: GREEK[name]! });
  if (SYMBOLS[name]) return insertNode(base, { t: 'op', v: SYMBOLS[name]! });
  if (ESC_STRUCT[name]) return insertStructure(base, ESC_STRUCT[name]!);
  if (NARY[name]) return typeChar(base, NARY[name]!);
  if (FUNCS.has(name)) return insertStructure(base, `fn-${name}`);
  if (ACCENTS[name]) return insertStructure(base, `acc-${name.replace(/^wide/, '')}`);
  return insertNode(base, { t: 'text', v: `\\${name}` });
}

/** Si lo que precede es el nombre de una función (`sin`, `lim`...), la convierte; el cursor entra en su argumento. */
function autoFunction(st: EditState, sub: boolean): EditState | null {
  const list = currentRow(st);
  let from = st.at;
  let word = '';
  while (from > 0) {
    const n = list[from - 1]!;
    if (n.t !== 'id' || n.sty || n.scr || !/^[A-Za-z]$/.test(n.v)) break;
    word = n.v + word;
    from--;
  }
  if (!word || !FUNCS.has(word)) return null;
  const f: MNode = sub ? { t: 'func', name: word, c: emptyRow(), sub: emptyRow() } : { t: 'func', name: word, c: emptyRow() };
  const out = edit(st, (l) => ({ list: [...l.slice(0, from), f, ...l.slice(st.at)], at: 0, path: [...st.path, { i: from, k: sub ? 'sub' : 'c' }] }));
  return { ...out, anchor: undefined };
}

/** Casillas que Word cierra al escribir un operador: el denominador, los índices y el argumento de una función. */
const operandSlot = (n: MNode, k: string): boolean => (n.t === 'frac' && k === 'd') || ((n.t === 'sup' || n.t === 'sub') && k === 's') || ((n.t === 'subsup' || n.t === 'pre') && (k === 'sub' || k === 'sup')) || (n.t === 'func' && k === 'c');
const TERMINATORS = new Set(['+', '-', '−', '=', '<', '>', '≤', '≥', '≠', '≈', ',', ';', ':', '*', '×', '÷', '·', ')', ']', '}', '⟩', '⌋', '⌉', ' ']);

/** Mientras el cursor esté al final de una casilla de operando con algo escrito, sale de ella. */
function exitOperands(st: EditState): EditState {
  let cur = st;
  for (;;) {
    const last = cur.path[cur.path.length - 1];
    if (!last) return cur;
    const row = currentRow(cur);
    if (!row.length || cur.at !== row.length) return cur;
    const parentPath = cur.path.slice(0, -1);
    const node = rowAt(cur.root, parentPath)[last.i];
    if (!node || !operandSlot(node, last.k)) return cur;
    cur = { ...cur, path: parentPath, at: last.i + 1, anchor: undefined };
  }
}

const OPENERS: Record<string, [string, string]> = { '(': ['(', ')'], '[': ['[', ']'], '{': ['{', '}'], '⟨': ['⟨', '⟩'], '⌊': ['⌊', '⌋'], '⌈': ['⌈', '⌉'] };
const CLOSERS = new Set([')', ']', '}', '⟩', '⌋', '⌉']);

/** Escribe un carácter como lo hace Word: `/` hace una fracción, `^` y `_` escrituras, `\nombre` + espacio un símbolo... */
export function typeChar(st: EditState, ch: string): EditState {
  // escritura `\nombre` en curso
  if (st.esc !== undefined) {
    if (/^[A-Za-z]$/.test(ch)) return { ...st, esc: st.esc + ch };
    const done = resolveEscape(st);
    return ch === ' ' ? done : typeChar(done, ch);
  }
  if (ch === '\\') return { ...deleteSelection(st), esc: '' };
  // un nombre de función seguido de otra cosa
  if (!/^\p{L}$/u.test(ch) && ch !== '^') {
    const f = autoFunction(st, ch === '_');
    if (f) return ch === ' ' || ch === '_' ? f : typeChar(f, ch);
  }
  if (TERMINATORS.has(ch) && !hasSelection(st)) st = exitOperands(st);
  if (ch === ' ') return st;
  if (ch === '/') return buildFraction(st);
  if (ch === '^') return buildScript(st, 'sup');
  if (ch === '_') return buildScript(st, 'sub');
  if (ch === '√') return insertStructure(st, 'sqrt');
  if (ch === '∛') return insertStructure(st, 'sqrt3');
  if (OPENERS[ch]) {
    const [open, close] = OPENERS[ch]!;
    return insertWithSlots(st, { t: 'fenced', open, close, sep: '', c: [emptyRow()] }, 'c0', 'c0');
  }
  if (CLOSERS.has(ch)) {
    const last = st.path[st.path.length - 1];
    if (last && st.at === currentRow(st).length) {
      const parent = rowAt(st.root, st.path.slice(0, -1))[last.i];
      if (parent && parent.t === 'fenced' && parent.close === ch) return { ...st, path: st.path.slice(0, -1), at: last.i + 1, anchor: undefined };
    }
  }
  const nary = Object.values(NARY).includes(ch);
  if (nary) return insertStructure(st, `nary-${ch}`);
  const s = deleteSelection(st);
  const list = currentRow(s);
  const prev = s.at > 0 ? list[s.at - 1] : undefined;
  if ((/[0-9]/.test(ch) || ch === '.') && prev && prev.t === 'num' && !prev.sty && !prev.scr && !(ch === '.' && prev.v.includes('.'))) {
    return edit(s, (l, at) => ({ list: l.map((x, i) => (i === at - 1 && x.t === 'num' ? { ...x, v: x.v + ch } : x)), at }));
  }
  if (/[0-9]/.test(ch)) return insertNode(s, { t: 'num', v: ch });
  if (/^\p{L}$/u.test(ch)) return insertNode(s, { t: 'id', v: ch });
  return insertNode(s, { t: 'op', v: ch });
}

/** Escribe un texto (pegado): cada carácter como si se tecleara. */
export const typeText = (st: EditState, text: string): EditState => [...text].reduce((s, c) => (c === '\n' ? s : typeChar(s, c)), st);

// ------------------------------------------------------------------------------------------------- borrar

/** Quita lo que precede al cursor (Retroceso). */
export function backspace(st: EditState): EditState {
  if (st.esc !== undefined) return st.esc ? { ...st, esc: st.esc.slice(0, -1) } : { ...st, esc: undefined };
  if (hasSelection(st)) return deleteSelection(st);
  const list = currentRow(st);
  if (st.at > 0) {
    const node = list[st.at - 1]!;
    const slots = slotsOf(node);
    if (!slots.length || isEmptyNode(node)) return edit(st, (l, at) => ({ list: [...l.slice(0, at - 1), ...l.slice(at)], at: at - 1 }));
    return moveLeft(st);
  }
  const last = st.path[st.path.length - 1];
  if (!last) return st;
  const parentPath = st.path.slice(0, -1);
  const node = rowAt(st.root, parentPath)[last.i]!;
  // una estructura con todas las casillas vacías se quita de golpe
  if (isEmptyNode(node)) {
    const out = updateRow(st.root, parentPath, (l) => [...l.slice(0, last.i), ...l.slice(last.i + 1)]);
    return { root: out, path: parentPath, at: last.i };
  }
  // una casilla de escritura que queda vacía quita la escritura
  if (isEmptyRow(getSlot(node, last.k)) && (node.t === 'sup' || node.t === 'sub') && last.k === 's') {
    const base = asList(node.b);
    const out = updateRow(st.root, parentPath, (l) => [...l.slice(0, last.i), ...base, ...l.slice(last.i + 1)]);
    return { root: out, path: parentPath, at: last.i + base.length };
  }
  // un paréntesis con una sola casilla se disuelve en su contenido
  if (node.t === 'fenced' && node.c.length === 1) {
    const inner = asList(node.c[0]!);
    const out = updateRow(st.root, parentPath, (l) => [...l.slice(0, last.i), ...inner, ...l.slice(last.i + 1)]);
    return { root: out, path: parentPath, at: last.i };
  }
  return moveLeft(st);
}

/** Quita lo que sigue al cursor (Supr). */
export function del(st: EditState): EditState {
  if (st.esc !== undefined) return st;
  if (hasSelection(st)) return deleteSelection(st);
  const list = currentRow(st);
  if (st.at >= list.length) return st;
  const node = list[st.at]!;
  if (!slotsOf(node).length || isEmptyNode(node)) return edit(st, (l, at) => ({ list: [...l.slice(0, at), ...l.slice(at + 1)], at }));
  return moveRight(st);
}

// ------------------------------------------------------------------------------------------------- mover

const stay = (st: EditState): EditState => ({ ...st, anchor: undefined });

export function moveRight(st: EditState, extend = false): EditState {
  const list = currentRow(st);
  if (extend) {
    if (st.at >= list.length) return st;
    return { ...st, anchor: st.anchor ?? st.at, at: st.at + 1 };
  }
  const base = stay({ ...st, esc: undefined });
  if (st.at < list.length) {
    const node = list[st.at]!;
    const slots = slotsOf(node);
    if (slots.length) return { ...base, path: [...st.path, { i: st.at, k: slots[0]! }], at: 0 };
    return { ...base, at: st.at + 1 };
  }
  const last = st.path[st.path.length - 1];
  if (!last) return base;
  const parentPath = st.path.slice(0, -1);
  const slots = slotsOf(rowAt(st.root, parentPath)[last.i]!);
  const idx = slots.indexOf(last.k);
  if (idx < slots.length - 1) return { ...base, path: [...parentPath, { i: last.i, k: slots[idx + 1]! }], at: 0 };
  return { ...base, path: parentPath, at: last.i + 1 };
}

export function moveLeft(st: EditState, extend = false): EditState {
  if (extend) {
    if (st.at <= 0) return st;
    return { ...st, anchor: st.anchor ?? st.at, at: st.at - 1 };
  }
  const base = stay({ ...st, esc: undefined });
  const list = currentRow(st);
  if (st.at > 0) {
    const node = list[st.at - 1]!;
    const slots = slotsOf(node);
    if (slots.length) {
      const k = slots[slots.length - 1]!;
      const path = [...st.path, { i: st.at - 1, k }];
      return { ...base, path, at: rowAt(st.root, path).length };
    }
    return { ...base, at: st.at - 1 };
  }
  const last = st.path[st.path.length - 1];
  if (!last) return base;
  const parentPath = st.path.slice(0, -1);
  const slots = slotsOf(rowAt(st.root, parentPath)[last.i]!);
  const idx = slots.indexOf(last.k);
  if (idx > 0) {
    const path = [...parentPath, { i: last.i, k: slots[idx - 1]! }];
    return { ...base, path, at: rowAt(st.root, path).length };
  }
  return { ...base, path: parentPath, at: last.i };
}

/** Inicio y fin de la fila actual. */
export const home = (st: EditState, extend = false): EditState => (extend ? { ...st, anchor: st.anchor ?? st.at, at: 0 } : { ...stay(st), at: 0 });
export const end = (st: EditState, extend = false): EditState => (extend ? { ...st, anchor: st.anchor ?? st.at, at: currentRow(st).length } : { ...stay(st), at: currentRow(st).length });

/** Selecciona toda la ecuación (la fila de más afuera). */
export const selectAll = (st: EditState): EditState => ({ ...st, path: [], anchor: 0, at: asList(st.root).length, esc: undefined });

/** Tabulador: a la casilla siguiente (o fuera de la estructura si era la última). */
export function nextSlot(st: EditState): EditState {
  const last = st.path[st.path.length - 1];
  if (!last) return end(st);
  const parentPath = st.path.slice(0, -1);
  const slots = slotsOf(rowAt(st.root, parentPath)[last.i]!);
  const idx = slots.indexOf(last.k);
  if (idx < slots.length - 1) return { ...stay(st), path: [...parentPath, { i: last.i, k: slots[idx + 1]! }], at: 0 };
  return { ...stay(st), path: parentPath, at: last.i + 1 };
}

/** Flechas arriba y abajo: de una casilla a la de arriba o la de abajo (numerador/denominador, límites, índices). */
export function moveVertical(st: EditState, dir: 'up' | 'down'): EditState {
  for (let depth = st.path.length; depth > 0; depth--) {
    const last = st.path[depth - 1]!;
    const parentPath = st.path.slice(0, depth - 1);
    const node = rowAt(st.root, parentPath)[last.i]!;
    let k: string | undefined;
    const up = dir === 'up';
    if (node.t === 'frac') k = up ? (last.k === 'd' ? 'n' : undefined) : last.k === 'n' ? 'd' : undefined;
    else if (node.t === 'sup' || node.t === 'sub') {
      const hi = node.t === 'sup' ? 's' : 'b';
      const lo = node.t === 'sup' ? 'b' : 's';
      k = up ? (last.k === lo ? hi : undefined) : last.k === hi ? lo : undefined;
    } else if (node.t === 'subsup') k = up ? (last.k === 'sub' ? 'sup' : last.k === 'b' ? 'sup' : undefined) : last.k === 'sup' ? 'sub' : last.k === 'b' ? 'sub' : undefined;
    else if (node.t === 'nary') k = up ? (last.k === 'sub' ? (node.sup ? 'sup' : undefined) : last.k === 'c' ? (node.sup ? 'sup' : undefined) : undefined) : last.k === 'sup' ? (node.sub ? 'sub' : 'c') : last.k === 'c' && node.sub ? 'sub' : undefined;
    else if (node.t === 'limit') k = up ? (last.k === 'b' && !node.top ? undefined : last.k === 'b' ? 'lim' : 'b') : last.k === 'lim' && node.top ? 'b' : last.k === 'b' && !node.top ? 'lim' : undefined;
    else if (node.t === 'matrix') {
      const [r, c] = last.k.split(':').map(Number);
      const rr = (r ?? 0) + (up ? -1 : 1);
      if (rr >= 0 && rr < node.rows.length && node.rows[rr]![c ?? 0]) k = `${rr}:${c}`;
    } else if (node.t === 'eqarr') {
      const r = +last.k.slice(1) + (up ? -1 : 1);
      if (r >= 0 && r < node.rows.length) k = `r${r}`;
    }
    if (k !== undefined) {
      const path = [...parentPath, { i: last.i, k }];
      return { ...stay(st), path, at: Math.min(st.at, rowAt(st.root, path).length) };
    }
  }
  return st;
}

/** Va a una posición: la fila `path` y el sitio `at` (clic del ratón). Con `extend` mantiene el extremo fijo si sigue en la misma fila. */
export function placeCursor(st: EditState, path: Step[], at: number, extend = false): EditState {
  const same = path.length === st.path.length && path.every((s, i) => s.i === st.path[i]!.i && s.k === st.path[i]!.k);
  const len = rowAt(st.root, path).length;
  const to = Math.max(0, Math.min(len, at));
  if (extend && same) return { ...st, anchor: st.anchor ?? st.at, at: to, esc: undefined };
  return { ...st, path, at: to, anchor: undefined, esc: undefined };
}

