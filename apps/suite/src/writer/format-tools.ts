/** Herramientas de formato de Writer sin interfaz: cambiar mayúsculas y minúsculas, y Copiar formato. */
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { markTypes } from '@suitenova/writer-core';
import { setMark } from './editing';

export type CaseMode = 'sentence' | 'lower' | 'upper' | 'title' | 'toggle';

const upper = (s: string) => s.toLocaleUpperCase();
const lower = (s: string) => s.toLocaleLowerCase();

/** Aplica el modo al texto; `startOfSentence` dice si el texto empieza una oración (lo arrastra el que llama). */
export function convertCase(text: string, mode: CaseMode, carry: { sentenceStart: boolean; wordStart: boolean }): string {
  let out = '';
  for (const ch of text) {
    const isLetter = lower(ch) !== upper(ch);
    switch (mode) {
      case 'lower':
        out += lower(ch);
        break;
      case 'upper':
        out += upper(ch);
        break;
      case 'toggle':
        out += ch === upper(ch) ? lower(ch) : upper(ch);
        break;
      case 'title':
        out += isLetter ? (carry.wordStart ? upper(ch) : lower(ch)) : ch;
        break;
      default:
        out += isLetter ? (carry.sentenceStart ? upper(ch) : lower(ch)) : ch;
    }
    if (isLetter) {
      carry.sentenceStart = false;
      carry.wordStart = false;
    } else {
      if (/[.!?¡¿]/.test(ch) && /[.!?]/.test(ch)) carry.sentenceStart = true;
      if (/\s|[-–—/()"“”«»]/.test(ch)) carry.wordStart = true;
      if (/\d/.test(ch)) carry.sentenceStart = false;
    }
  }
  return out;
}

/** Cambia mayúsculas y minúsculas del texto seleccionado (o de la palabra bajo el cursor), conservando el formato. */
export function changeCase(mode: CaseMode): Command {
  return (state, dispatch) => {
    let { from, to } = state.selection;
    if (from === to) {
      const $p = state.doc.resolve(from);
      const text = $p.parent.textContent;
      const off = $p.parentOffset;
      let a = off;
      let b = off;
      while (a > 0 && /\S/.test(text[a - 1]!)) a--;
      while (b < text.length && /\S/.test(text[b]!)) b++;
      if (a === b) return false;
      from = $p.start() + a;
      to = $p.start() + b;
    }
    if (!dispatch) return true;
    const edits: { pos: number; len: number; text: string; marks: readonly Mark[] }[] = [];
    let parent: PMNode | null = null;
    const carry = { sentenceStart: true, wordStart: true };
    state.doc.nodesBetween(from, to, (node, pos, par) => {
      if (!node.isText) return true;
      if (par !== parent) {
        parent = par;
        // al empezar un párrafo nuevo, la oración y la palabra también empiezan
        carry.sentenceStart = true;
        carry.wordStart = true;
      }
      const a = Math.max(from, pos) - pos;
      const b = Math.min(to, pos + node.nodeSize) - pos;
      const piece = node.text!.slice(a, b);
      const changed = convertCase(piece, mode, carry);
      if (changed !== piece) edits.push({ pos: pos + a, len: piece.length, text: changed, marks: node.marks });
      return true;
    });
    const tr = state.tr;
    for (const e of edits.reverse()) tr.replaceWith(e.pos, e.pos + e.len, state.schema.text(e.text, e.marks));
    // la selección se conserva aunque cambie el largo de algún carácter
    if (state.selection instanceof TextSelection && state.selection.from !== state.selection.to) tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from), tr.mapping.map(to)));
    dispatch(tr);
    return true;
  };
}

// ---------------------------------------------------------------------------------------------- Copiar formato
/** Marcas que forman parte del «formato» y que Copiar formato traslada. */
const FORMAT_MARKS = ['strong', 'em', 'underline', 'strike', 'dstrike', 'superscript', 'subscript', 'color', 'highlight', 'fontFamily', 'fontSize', 'caps', 'spacing'];
/** Atributos de párrafo que viajan con el formato. */
const FORMAT_PARA = ['align', 'indentLeft', 'indentRight', 'indentFirst', 'spaceBefore', 'spaceAfter', 'lineHeight', 'lineRule', 'style', 'keepNext', 'keepLines', 'pageBreakBefore', 'shade', 'border', 'tabs'];

export interface CopiedFormat {
  marks: Mark[];
  para: Record<string, unknown> | null;
}

/** El formato del punto de inserción o de la selección. */
export function captureFormat(state: EditorState): CopiedFormat {
  const { $from, from, to, empty } = state.selection;
  const marks = empty ? [...(state.storedMarks ?? $from.marks())] : [...(state.doc.resolve(Math.min(from + 1, to)).marks())];
  const keep = marks.filter((m) => FORMAT_MARKS.includes(m.type.name));
  let para: Record<string, unknown> | null = null;
  for (let d = $from.depth; d > 0 && !para; d--) {
    const n = $from.node(d);
    if (n.type.name === 'paragraph') {
      para = {};
      for (const k of FORMAT_PARA) para[k] = n.attrs[k];
    }
  }
  return { marks: keep, para };
}

/** Pone en la selección el formato copiado; con la selección vacía se aplica a la palabra bajo el cursor. */
export function applyFormat(fmt: CopiedFormat, whole: boolean): Command {
  return (state, dispatch) => {
    let { from, to } = state.selection;
    if (from === to) {
      const $p = state.doc.resolve(from);
      const text = $p.parent.textContent;
      const off = $p.parentOffset;
      let a = off;
      let b = off;
      while (a > 0 && /\S/.test(text[a - 1]!)) a--;
      while (b < text.length && /\S/.test(text[b]!)) b++;
      from = $p.start() + a;
      to = $p.start() + b;
    }
    if (from === to) return false;
    if (!dispatch) return true;
    const tr = state.tr;
    for (const name of FORMAT_MARKS) tr.removeMark(from, to, markTypes[name]!);
    for (const m of fmt.marks) tr.addMark(from, to, m);
    if (whole && fmt.para) applyPara(tr, state, from, to, fmt.para);
    dispatch(tr);
    return true;
  };
}

function applyPara(tr: Transaction, state: EditorState, from: number, to: number, para: Record<string, unknown>): void {
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (n.type.name === 'paragraph') {
      tr.setNodeMarkup(tr.mapping.map(pos), undefined, { ...n.attrs, ...para });
      return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------------------------- cuadro Fuente
/** Todo lo que fija el cuadro «Fuente»; `null` quita la marca. */
export interface CharSpec {
  fontFamily: string | null;
  fontSize: number | null;
  bold: boolean;
  italic: boolean;
  color: string | null;
  underline: { style: string; color: string | null } | null;
  strike: boolean;
  dstrike: boolean;
  superscript: boolean;
  subscript: boolean;
  caps: 'all' | 'small' | null;
  spacing: number | null;
}

/** Aplica de una vez el formato de carácter del cuadro «Fuente» a la selección (o al punto de inserción). */
export function applyCharSpec(s: CharSpec): Command {
  return (state, dispatch) => {
    if (!dispatch) return true;
    const steps: [string, Record<string, unknown> | null][] = [
      ['fontFamily', s.fontFamily ? { value: s.fontFamily } : null],
      ['fontSize', s.fontSize ? { value: s.fontSize } : null],
      ['strong', s.bold ? {} : null],
      ['em', s.italic ? {} : null],
      ['color', s.color ? { value: s.color } : null],
      ['underline', s.underline ? { style: s.underline.style, color: s.underline.color } : null],
      ['strike', s.strike ? {} : null],
      ['dstrike', s.dstrike ? {} : null],
      ['superscript', s.superscript ? {} : null],
      ['subscript', s.subscript ? {} : null],
      ['caps', s.caps ? { value: s.caps } : null],
      ['spacing', s.spacing ? { value: s.spacing } : null],
    ];
    let cur = state;
    const d = (tr: Transaction) => {
      cur = cur.apply(tr);
      dispatch(tr);
    };
    for (const [name, attrs] of steps) setMark(markTypes[name]!, attrs)(cur, d);
    return true;
  };
}
