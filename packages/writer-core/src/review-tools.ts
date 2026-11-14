import { Fragment, type Mark, type Node as PMNode } from 'prosemirror-model';
import { writerSchema } from './schema';

// ------------------------------------------------------------------------------------------------ recuento

export interface DocStats {
  words: number;
  charsWithSpaces: number;
  charsNoSpaces: number;
  /** Párrafos con texto. */
  paragraphs: number;
}

/** Texto visible de un nodo: no cuenta lo borrado con control de cambios (aún sin aceptar). */
function visibleText(node: PMNode): string {
  let out = '';
  node.descendants((n) => {
    if (n.isText && !n.marks.some((m) => m.type.name === 'del')) out += n.text;
    return true;
  });
  return out;
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/** Estadísticas de un documento (o de un texto suelto). El texto borrado con cambios sin aceptar no cuenta. */
export function docStats(doc: PMNode | string): DocStats {
  const paras: string[] = [];
  if (typeof doc === 'string') paras.push(...doc.replace(/\r\n?/g, '\n').split('\n'));
  else doc.descendants((n) => {
    if (n.isTextblock) {
      paras.push(visibleText(n));
      return false;
    }
    return true;
  });
  let words = 0;
  let withSpaces = 0;
  let noSpaces = 0;
  let paragraphs = 0;
  for (const p of paras) {
    words += p.match(WORD_RE)?.length ?? 0;
    withSpaces += [...p].length;
    noSpaces += [...p.replace(/\s/gu, '')].length;
    if (p.trim()) paragraphs++;
  }
  return { words, charsWithSpaces: withSpaces, charsNoSpaces: noSpaces, paragraphs };
}

// ------------------------------------------------------------------------------------------------ accesibilidad

export interface A11yIssue {
  kind: 'imageAlt' | 'tableHeader' | 'mergedCells' | 'headingSkip' | 'headingEmpty' | 'emptyParas' | 'linkText' | 'noTitle' | 'smallText' | 'contrast' | 'noHeadings';
  severity: 'error' | 'warning' | 'tip';
  /** Posición en el documento donde está el problema (null = todo el documento). */
  pos: number | null;
  /** Texto corto para reconocer el lugar. */
  excerpt: string;
}

const GENERIC_LINK = /^(aquí|aqui|clic aquí|clic aqui|haz clic aquí|haga clic aquí|pulsa aquí|pulse aquí|más|mas|leer más|ver más|enlace|vínculo|vinculo|link|here|click here|read more|more)$/i;

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return NaN;
  const v = parseInt(m[1]!, 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** Relación de contraste WCAG entre dos colores `#rrggbb` (NaN si alguno no se entiende). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const clip = (s: string): string => (s.length > 40 ? `${s.slice(0, 39)}…` : s);

/** Problemas de accesibilidad del documento, en orden de aparición. */
export function checkAccessibility(doc: PMNode, opts: { title?: string; pageColor?: string | null } = {}): A11yIssue[] {
  const issues: A11yIssue[] = [];
  const add = (kind: A11yIssue['kind'], severity: A11yIssue['severity'], pos: number | null, excerpt: string) => issues.push({ kind, severity, pos, excerpt });
  const bg = opts.pageColor || '#ffffff';
  let lastHeading = 0;
  let headings = 0;
  let emptyRun = 0;
  let emptyRunPos = 0;
  let inTable = 0;
  let words = 0;
  const flushEmpty = () => {
    if (emptyRun >= 2) add('emptyParas', 'warning', emptyRunPos, `${emptyRun} párrafos vacíos seguidos`);
    emptyRun = 0;
  };

  doc.descendants((node, pos) => {
    if (node.type.name === 'table') {
      flushEmpty();
      if (!node.attrs.headerRow) add('tableHeader', 'error', pos, clip(node.textContent) || 'Tabla');
      let merged = false;
      node.descendants((c) => {
        if ((c.attrs.colspan ?? 1) > 1 || (c.attrs.rowspan ?? 1) > 1) merged = true;
        return true;
      });
      if (merged) add('mergedCells', 'warning', pos, clip(node.textContent) || 'Tabla');
      inTable++;
      return true;
    }
    if (node.type.name === 'paragraph') {
      const text = visibleText(node);
      const hasObj = node.childCount > 0 && node.content.content.some((n) => !n.isText);
      const level = /^Heading([1-6])$/.exec(String(node.attrs.style ?? ''))?.[1];
      if (level) {
        const lv = Number(level);
        headings++;
        if (!text.trim() && !hasObj) add('headingEmpty', 'warning', pos, `Título ${lv} vacío`);
        else if (lastHeading && lv > lastHeading + 1) add('headingSkip', 'warning', pos, `${clip(text)} (Título ${lv} tras Título ${lastHeading})`);
        lastHeading = lv;
      }
      if (!inTable || node.attrs.style) {
        if (!text.trim() && !hasObj && !level && !node.attrs.pageBreakBefore) {
          if (!emptyRun) emptyRunPos = pos;
          emptyRun++;
        } else flushEmpty();
      }
      words += text.match(WORD_RE)?.length ?? 0;
      // marcas del texto
      node.forEach((child, off) => {
        if (child.type.name === 'image') {
          if (!String(child.attrs.alt ?? '').trim()) add('imageAlt', 'error', pos + 1 + off, 'Imagen');
          return;
        }
        if (!child.isText || child.marks.some((m) => m.type.name === 'del')) return;
        const at = pos + 1 + off;
        const link = child.marks.find((m) => m.type.name === 'link');
        if (link) {
          const t = child.text!.trim();
          if (GENERIC_LINK.test(t)) add('linkText', 'warning', at, `«${t}» no dice a dónde lleva`);
          else if (/^(https?:\/\/|www\.)/i.test(t) && t.length > 40) add('linkText', 'tip', at, clip(t));
        }
        const fs = child.marks.find((m) => m.type.name === 'fontSize');
        if (fs && Number(fs.attrs.value) < 8 && child.text!.trim()) add('smallText', 'warning', at, `${clip(child.text!)} (${fs.attrs.value} pt)`);
        const col = child.marks.find((m) => m.type.name === 'color');
        if (col && child.text!.trim()) {
          const hl = child.marks.find((m) => m.type.name === 'highlight');
          const r = contrastRatio(String(col.attrs.value), String(hl?.attrs.value ?? bg));
          if (Number.isFinite(r) && r < 3) add('contrast', 'warning', at, `${clip(child.text!)} (contraste ${r.toFixed(1)}:1)`);
        }
      });
      return false;
    }
    return true;
  });
  flushEmpty();
  if (!headings && words > 1500) add('noHeadings', 'tip', null, `${words} palabras sin ningún título`);
  if (!opts.title?.trim()) add('noTitle', 'tip', null, 'El documento no tiene título en sus propiedades');
  // los errores primero; dentro de cada gravedad, el orden del documento
  const rank = { error: 0, warning: 1, tip: 2 } as const;
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.pos ?? Infinity) - (b.pos ?? Infinity));
}

// ------------------------------------------------------------------------------------------------ comparar

export interface CompareOptions {
  author: string;
  date: string;
  /** Un identificador nuevo por cada cambio. */
  makeId: () => string;
}

type Op = { type: 'eq' | 'del' | 'ins'; aFrom: number; aTo: number; bFrom: number; bTo: number };

/** Texto de un párrafo con un carácter por posición del documento (lo que no es texto cuenta como `￼`). */
function flat(p: PMNode): string {
  let s = '';
  p.forEach((c) => {
    s += c.isText ? c.text! : '￼'.repeat(c.nodeSize);
  });
  return s;
}

const TOKEN_RE = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

function tokens(s: string): { text: string; from: number; to: number }[] {
  const out: { text: string; from: number; to: number }[] = [];
  for (const m of s.matchAll(TOKEN_RE)) out.push({ text: m[0], from: m.index!, to: m.index! + m[0].length });
  return out;
}

/** Subsecuencia común más larga entre dos listas de enteros; devuelve los pares [i, j] de coincidencias. */
function lcs(a: number[], b: number[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = a[i] === b[j] ? t[(i + 1) * w + j + 1]! + 1 : Math.max(t[(i + 1) * w + j]!, t[i * w + j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (t[(i + 1) * w + j]! >= t[i * w + j + 1]!) i++;
    else j++;
  }
  return pairs;
}

const MAX_CELLS = 4_000_000;

/** Diferencias palabra a palabra entre dos textos, en posiciones de carácter. */
export function diffWords(a: string, b: string): Op[] {
  const ta = tokens(a);
  const tb = tokens(b);
  const ids = new Map<string, number>();
  const id = (s: string) => ids.get(s) ?? (ids.set(s, ids.size), ids.size - 1);
  const ia = ta.map((x) => id(x.text));
  const ib = tb.map((x) => id(x.text));
  // lo común del principio y del final no entra en la tabla
  let pre = 0;
  while (pre < ia.length && pre < ib.length && ia[pre] === ib[pre]) pre++;
  let suf = 0;
  while (suf < ia.length - pre && suf < ib.length - pre && ia[ia.length - 1 - suf] === ib[ib.length - 1 - suf]) suf++;
  const midA = ia.slice(pre, ia.length - suf);
  const midB = ib.slice(pre, ib.length - suf);
  const pairs: [number, number][] = [];
  for (let k = 0; k < pre; k++) pairs.push([k, k]);
  if (midA.length && midB.length && (midA.length + 1) * (midB.length + 1) <= MAX_CELLS) for (const [i, j] of lcs(midA, midB)) pairs.push([pre + i, pre + j]);
  for (let k = 0; k < suf; k++) pairs.push([ia.length - suf + k, ib.length - suf + k]);

  const ops: Op[] = [];
  const push = (op: Op) => {
    const last = ops[ops.length - 1];
    if (last && last.type === op.type && last.aTo === op.aFrom && last.bTo === op.bFrom) {
      last.aTo = op.aTo;
      last.bTo = op.bTo;
    } else ops.push(op);
  };
  let i = 0;
  let j = 0;
  const posA = (k: number) => (k < ta.length ? ta[k]!.from : a.length);
  const posB = (k: number) => (k < tb.length ? tb[k]!.from : b.length);
  const gap = (ni: number, nj: number) => {
    if (ni > i) push({ type: 'del', aFrom: posA(i), aTo: posA(ni), bFrom: posB(j), bTo: posB(j) });
    if (nj > j) push({ type: 'ins', aFrom: posA(ni), aTo: posA(ni), bFrom: posB(j), bTo: posB(nj) });
  };
  for (const [pi, pj] of pairs) {
    gap(pi, pj);
    push({ type: 'eq', aFrom: posA(pi), aTo: posA(pi + 1), bFrom: posB(pj), bTo: posB(pj + 1) });
    i = pi + 1;
    j = pj + 1;
  }
  gap(ta.length, tb.length);
  return ops;
}

const wordSet = (s: string): Set<string> => new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));

/** Parecido (0–1) entre dos textos: coeficiente de Dice sobre sus palabras. */
export function similarity(a: string, b: string): number {
  const sa = wordSet(a);
  const sb = wordSet(b);
  if (!sa.size && !sb.size) return a === b ? 1 : 0;
  let common = 0;
  for (const w of sa) if (sb.has(w)) common++;
  return (2 * common) / (sa.size + sb.size);
}

const MIN_SIM = 0.4;

/**
 * Empareja los párrafos del original con los del revisado. Devuelve, para cada párrafo revisado, el índice del original
 * con el que se corresponde (o -1), y por cada hueco los originales sin pareja que quedaron antes del siguiente revisado.
 */
function align(A: string[], B: string[]): { match: number[]; deleted: Map<number, number[]> } {
  const match: number[] = new Array(B.length).fill(-1);
  const anchors: [number, number][] = [];
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) anchors.push([pre, pre++]);
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const ids = new Map<string, number>();
  const id = (s: string) => ids.get(s) ?? (ids.set(s, ids.size), ids.size - 1);
  const midA = A.slice(pre, A.length - suf).map(id);
  const midB = B.slice(pre, B.length - suf).map(id);
  if (midA.length && midB.length && (midA.length + 1) * (midB.length + 1) <= MAX_CELLS) for (const [i, j] of lcs(midA, midB)) anchors.push([pre + i, pre + j]);
  for (let k = 0; k < suf; k++) anchors.push([A.length - suf + k, B.length - suf + k]);
  anchors.sort((x, y) => x[0] - y[0]);

  const deleted = new Map<number, number[]>();
  const del = (before: number, a: number) => deleted.set(before, [...(deleted.get(before) ?? []), a]);
  let ai = 0;
  let bi = 0;
  const gap = (aEnd: number, bEnd: number) => {
    const x = aEnd - ai;
    const y = bEnd - bi;
    // pareja por parecido dentro del hueco, sin cruzarse (programación dinámica; solo si el hueco es razonable)
    const pair: [number, number][] = [];
    if (x > 0 && y > 0 && x * y <= 250_000) {
      const sim = (i: number, j: number) => similarity(A[ai + i]!, B[bi + j]!);
      const w = y + 1;
      const best = new Float64Array((x + 1) * w);
      const s: number[] = new Array(x * y);
      for (let i = x - 1; i >= 0; i--) {
        for (let j = y - 1; j >= 0; j--) {
          const v = sim(i, j);
          s[i * y + j] = v;
          const take = v >= MIN_SIM ? v + best[(i + 1) * w + j + 1]! : -1;
          best[i * w + j] = Math.max(best[(i + 1) * w + j]!, best[i * w + j + 1]!, take);
        }
      }
      let i = 0;
      let j = 0;
      while (i < x && j < y) {
        const v = s[i * y + j]!;
        if (v >= MIN_SIM && best[i * w + j] === v + best[(i + 1) * w + j + 1]!) {
          pair.push([i, j]);
          i++;
          j++;
        } else if (best[(i + 1) * w + j]! >= best[i * w + j + 1]!) i++;
        else j++;
      }
    }
    let pi = 0;
    for (const [i, j] of [...pair, [x, y] as [number, number]]) {
      for (; pi < i; pi++) del(bi + j, ai + pi);
      if (j < y) match[bi + j] = ai + i;
      pi = i + 1;
    }
  };
  for (const [a, b] of anchors) {
    gap(a, b);
    match[b] = a;
    ai = a + 1;
    bi = b + 1;
  }
  gap(A.length, B.length);
  return { match, deleted };
}

function markFrag(f: Fragment, mark: Mark): Fragment {
  const out: PMNode[] = [];
  f.forEach((n) => out.push(n.mark(mark.addToSet(n.marks))));
  return Fragment.fromArray(out);
}

export interface CompareResult {
  doc: PMNode;
  /** Cambios marcados: palabras o trozos insertados o borrados, y párrafos enteros. */
  changes: number;
  /** Párrafos revisados que no existían en el original, y viceversa. */
  insertedParagraphs: number;
  deletedParagraphs: number;
}

/**
 * Compara dos documentos y devuelve el revisado con las diferencias de **texto** marcadas como cambios con control de
 * cambios (inserciones y borrados con el autor y la fecha dados). Solo se comparan los párrafos (también dentro de tablas);
 * los cambios de formato no se marcan, y un párrafo borrado se coloca antes del siguiente párrafo que se conserva.
 */
export function compareDocs(original: PMNode, revised: PMNode, opts: CompareOptions): CompareResult {
  const paras = (d: PMNode): PMNode[] => {
    const out: PMNode[] = [];
    d.descendants((n) => {
      if (n.type.name === 'paragraph') {
        out.push(n);
        return false;
      }
      return true;
    });
    return out;
  };
  const PA = paras(original);
  const PB = paras(revised);
  const { match, deleted } = align(PA.map(flat), PB.map(flat));
  const attrs = () => ({ id: opts.makeId(), author: opts.author, date: opts.date });
  const mk = (type: 'ins' | 'del') => writerSchema.mark(type, attrs());
  let changes = 0;
  let insertedParagraphs = 0;
  let deletedParagraphs = 0;

  const deletedPara = (a: PMNode): PMNode => {
    changes++;
    deletedParagraphs++;
    const content = a.content.size ? markFrag(a.content, mk('del')) : a.content;
    return a.type.create({ ...a.attrs, ins: null, del: attrs() }, content, a.marks);
  };
  const rebuild = (b: PMNode, a: PMNode | null): PMNode => {
    if (!a) {
      if (!b.content.size && !flat(b)) return b;
      changes++;
      insertedParagraphs++;
      return b.type.create({ ...b.attrs, del: null, ins: attrs() }, b.content.size ? markFrag(b.content, mk('ins')) : b.content, b.marks);
    }
    const ta = flat(a);
    const tb = flat(b);
    if (ta === tb) return b;
    const parts: PMNode[] = [];
    for (const op of diffWords(ta, tb)) {
      if (op.type === 'eq') b.content.cut(op.bFrom, op.bTo).forEach((n) => parts.push(n));
      else {
        changes++;
        if (op.type === 'ins') markFrag(b.content.cut(op.bFrom, op.bTo), mk('ins')).forEach((n) => parts.push(n));
        else markFrag(a.content.cut(op.aFrom, op.aTo), mk('del')).forEach((n) => parts.push(n));
      }
    }
    return b.type.create(b.attrs, Fragment.fromArray(parts), b.marks);
  };

  let k = 0;
  const walk = (node: PMNode): PMNode[] => {
    if (node.type.name === 'paragraph') {
      const j = k++;
      const pre = (deleted.get(j) ?? []).map((i) => deletedPara(PA[i]!));
      const a = match[j]! >= 0 ? PA[match[j]!]! : null;
      return [...pre, rebuild(node, a)];
    }
    if (node.isLeaf || node.isTextblock) return [node];
    const kids: PMNode[] = [];
    node.forEach((c) => kids.push(...walk(c)));
    return [node.copy(Fragment.fromArray(kids))];
  };
  const kids: PMNode[] = [];
  revised.forEach((c) => kids.push(...walk(c)));
  const tail = (deleted.get(PB.length) ?? []).map((i) => deletedPara(PA[i]!));
  if (tail.length) {
    const last = kids[kids.length - 1]!;
    if (last.type.name === 'section') kids[kids.length - 1] = last.copy(last.content.append(Fragment.fromArray(tail)));
    else kids.push(...tail);
  }
  return { doc: revised.copy(Fragment.fromArray(kids)), changes, insertedParagraphs, deletedParagraphs };
}
