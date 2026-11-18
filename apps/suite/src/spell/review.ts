import { checkGrammar, grammarOptionsOf, type IssueCategory, type ReviewOptions, type SpellLang } from '@suitenova/spell-core';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { skipWordWith, findWords } from '@suitenova/spell-core';
import { blockText, offsetToPos, type DocSpellEngine } from './engine';
import { isIgnoredOnce, reviewOptionsKey } from './options';

/** Ortografía, o la categoría de la regla de gramática, puntuación o estilo. */
export type IssueKind = 'spelling' | IssueCategory;

export interface ReviewFix {
  /** Lo que se muestra en el menú. */
  label: string;
  from: number;
  to: number;
  text: string;
}

/** Un problema del texto, ya situado en el documento. La ortografía no trae las correcciones: se piden con `fixesOf` (tardan). */
export interface Issue {
  kind: IssueKind;
  /** `spelling` o el identificador de la regla (`double-space`…). */
  rule: string;
  from: number;
  to: number;
  /** Lo subrayado. */
  text: string;
  message: string;
  fixes: ReviewFix[];
  /** Identifica el problema sin depender de su posición (para «Ignorar una vez»). */
  key: string;
}

export interface ReviewCtx {
  engine: DocSpellEngine | null;
  lang: SpellLang;
  options: ReviewOptions;
}

const engineIds = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object) => engineIds.get(o) ?? (engineIds.set(o, nextId), nextId++);

// Las comprobaciones de un bloque se guardan en el bloque (ProseMirror reutiliza los que no cambian): al escribir solo se vuelve a
// revisar el párrafo que cambió. Las posiciones se guardan relativas al bloque.
const cache = new WeakMap<PMNode, { sig: string; issues: Issue[] }>();

const keyOf = (rule: string, text: string, block: string, start: number) => `${rule}|${text}|${block.slice(Math.max(0, start - 24), start)}`;

function reviewBlock(block: PMNode, ctx: ReviewCtx): Issue[] {
  const sig = `${ctx.engine ? `${idOf(ctx.engine)}:${ctx.engine.ignored.size}` : 'x'}|${ctx.lang}|${reviewOptionsKey(ctx.options)}`;
  const hit = cache.get(block);
  if (hit && hit.sig === sig) return hit.issues;
  const issues: Issue[] = [];
  if (block.textContent.trim()) {
    const { text, segs } = blockText(block, -1);
    if (ctx.engine) {
      for (const w of findWords(text)) {
        if (skipWordWith(text, w, ctx.options)) continue;
        const a = offsetToPos(segs, w.start);
        if (a.noCheck || ctx.engine.isCorrect(w.word)) continue;
        issues.push({ kind: 'spelling', rule: 'spelling', from: a.pos, to: a.pos + (w.end - w.start), text: w.word, message: 'No está en el diccionario.', fixes: [], key: keyOf('spelling', w.word, text, w.start) });
      }
    }
    if (ctx.options.grammar) {
      const range = (s: number, e: number): { from: number; to: number } | null => {
        if (text.slice(s, e).includes('\n')) return null; // atraviesa un objeto (imagen, campo…): no se toca
        const a = offsetToPos(segs, s);
        if (a.noCheck) return null;
        return { from: a.pos, to: e > s ? offsetToPos(segs, e - 1).pos + 1 : a.pos };
      };
      for (const g of checkGrammar(text, grammarOptionsOf(ctx.options, ctx.lang))) {
        const r = range(g.start, g.end);
        if (!r) continue;
        const fixes: ReviewFix[] = [];
        for (const f of g.fixes) {
          const fr = range(f.start, f.end);
          if (fr) fixes.push({ label: f.label ?? f.text, from: fr.from, to: fr.to, text: f.text });
        }
        issues.push({ kind: g.category, rule: g.rule, from: r.from, to: r.to, text: text.slice(g.start, g.end), message: g.message, fixes, key: keyOf(g.rule, text.slice(g.start, g.end), text, g.start) });
      }
      issues.sort((a, b) => a.from - b.from || a.to - b.to);
    }
  }
  cache.set(block, { sig, issues });
  return issues;
}

/** Todos los problemas de un documento, en orden (sin los que la persona pasó por alto una vez). */
export function reviewDoc(doc: PMNode, ctx: ReviewCtx): Issue[] {
  const out: Issue[] = [];
  doc.descendants((n, pos) => {
    if (!n.isTextblock) return true;
    for (const i of reviewBlock(n, ctx)) if (!isIgnoredOnce(i.key)) out.push({ ...i, from: i.from + pos + 1, to: i.to + pos + 1, fixes: i.fixes.map((f) => ({ ...f, from: f.from + pos + 1, to: f.to + pos + 1 })) });
    return false;
  });
  return out;
}

/** Las correcciones de un problema: las sugerencias del diccionario (ortografía) o las de la regla. */
export function fixesOf(issue: Issue, engine: DocSpellEngine | null): ReviewFix[] {
  if (issue.kind !== 'spelling') return issue.fixes;
  return (engine?.suggest(issue.text) ?? []).map((s) => ({ label: s, from: issue.from, to: issue.to, text: s }));
}

/** Aplica una corrección conservando el formato del texto que sustituye. */
export function applyFix(view: EditorView, fix: ReviewFix): void {
  const marks = view.state.doc.resolve(Math.min(fix.from, view.state.doc.content.size)).marks();
  const tr = fix.text === '' ? view.state.tr.delete(fix.from, fix.to) : view.state.tr.replaceWith(fix.from, fix.to, view.state.schema.text(fix.text, marks));
  view.dispatch(tr.scrollIntoView());
}

export const KIND_LABEL: Record<IssueKind, string> = { spelling: 'Ortografía', grammar: 'Gramática', punctuation: 'Puntuación', style: 'Estilo' };
