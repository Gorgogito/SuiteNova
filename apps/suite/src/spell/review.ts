import { checkGrammar, grammarOptionsOf, langForTag, type IssueCategory, type ReviewOptions, type SpellLang } from '@suitenova/spell-core';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { skipWordWith, findWords } from '@suitenova/spell-core';
import { blockText, offsetToPos, type DocSpellEngine, type MarkInfo, type Seg } from './engine';
import { engineEpoch } from './load';
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
  /** Idioma del texto donde está el problema. */
  lang: SpellLang;
  /** Identifica el problema sin depender de su posición (para «Ignorar una vez»). */
  key: string;
}

export interface ReviewCtx {
  /** Idioma del documento (el de los textos que no dicen otro). */
  lang: SpellLang;
  options: ReviewOptions;
  /** El motor de un idioma si ya está cargado. Si falta se avisa con `onMissing` y ese texto se revisa cuando llegue. */
  engineFor: (lang: SpellLang) => DocSpellEngine | null;
  onMissing?: (lang: SpellLang) => void;
  /** Cómo lee este producto el idioma y el «no revisar» de cada texto. */
  markInfo?: MarkInfo;
}

// Las comprobaciones de un bloque se guardan en el bloque (ProseMirror reutiliza los que no cambian): al escribir solo se vuelve a
// revisar el párrafo que cambió. Las posiciones se guardan relativas al bloque.
const cache = new WeakMap<PMNode, { sig: string; issues: Issue[]; missing: SpellLang[] }>();

const keyOf = (rule: string, text: string, block: string, start: number) => `${rule}|${text}|${block.slice(Math.max(0, start - 24), start)}`;

interface Run {
  lang: SpellLang | null;
  start: number;
  end: number;
}

/** Parte el texto en tramos del mismo idioma. Un idioma sin diccionario (francés…) da `lang: null`: no se revisa. */
function languageRuns(text: string, segs: Seg[], docLang: SpellLang): Run[] {
  const runs: Run[] = [];
  for (const s of segs) {
    const lang = s.lang ? langForTag(s.lang) : docLang;
    const last = runs[runs.length - 1];
    // los objetos (salto, imagen) no cambian de idioma: se pegan al tramo en curso
    if (s.noCheck && s.len === 1 && text[s.from] === '\n' && last) last.end = s.from + s.len;
    else if (last && last.lang === lang) last.end = s.from + s.len;
    else runs.push({ lang, start: s.from, end: s.from + s.len });
  }
  return runs;
}

function reviewBlock(block: PMNode, ctx: ReviewCtx): { issues: Issue[]; missing: SpellLang[] } {
  const sig = `${engineEpoch()}|${ctx.lang}|${reviewOptionsKey(ctx.options)}`;
  const hit = cache.get(block);
  if (hit && hit.sig === sig) return hit;
  const issues: Issue[] = [];
  const missing = new Set<SpellLang>();
  if (block.textContent.trim()) {
    const { text, segs } = blockText(block, -1, ctx.markInfo);
    for (const run of languageRuns(text, segs, ctx.lang)) {
      if (!run.lang) continue;
      const lang = run.lang;
      const engine = ctx.engineFor(lang);
      if (!engine) {
        missing.add(lang);
        continue;
      }
      const part = text.slice(run.start, run.end);
      for (const w of findWords(part)) {
        if (skipWordWith(part, w, ctx.options)) continue;
        const a = offsetToPos(segs, run.start + w.start);
        if (a.noCheck || engine.isCorrect(w.word)) continue;
        issues.push({ kind: 'spelling', rule: 'spelling', lang, from: a.pos, to: a.pos + (w.end - w.start), text: w.word, message: 'No está en el diccionario.', fixes: [], key: keyOf('spelling', w.word, text, run.start + w.start) });
      }
      if (!ctx.options.grammar) continue;
      const range = (s: number, e: number): { from: number; to: number } | null => {
        if (text.slice(s, e).includes('\n')) return null; // atraviesa un objeto (imagen, campo…): no se toca
        const a = offsetToPos(segs, s);
        if (a.noCheck) return null;
        return { from: a.pos, to: e > s ? offsetToPos(segs, e - 1).pos + 1 : a.pos };
      };
      for (const g of checkGrammar(part, grammarOptionsOf(ctx.options, lang, run.start === 0))) {
        const gs = run.start + g.start;
        const ge = run.start + g.end;
        const r = range(gs, ge);
        if (!r) continue;
        const fixes: ReviewFix[] = [];
        for (const f of g.fixes) {
          const fr = range(run.start + f.start, run.start + f.end);
          if (fr) fixes.push({ label: f.label ?? f.text, from: fr.from, to: fr.to, text: f.text });
        }
        issues.push({ kind: g.category, rule: g.rule, lang, from: r.from, to: r.to, text: text.slice(gs, ge), message: g.message, fixes, key: keyOf(g.rule, text.slice(gs, ge), text, gs) });
      }
    }
    issues.sort((a, b) => a.from - b.from || a.to - b.to);
  }
  const out = { sig, issues, missing: [...missing] };
  cache.set(block, out);
  return out;
}

/** Todos los problemas de un documento, en orden (sin los que la persona pasó por alto una vez). */
export function reviewDoc(doc: PMNode, ctx: ReviewCtx): Issue[] {
  const out: Issue[] = [];
  doc.descendants((n, pos) => {
    if (!n.isTextblock) return true;
    const r = reviewBlock(n, ctx);
    for (const l of r.missing) ctx.onMissing?.(l);
    for (const i of r.issues) if (!isIgnoredOnce(i.key)) out.push({ ...i, from: i.from + pos + 1, to: i.to + pos + 1, fixes: i.fixes.map((f) => ({ ...f, from: f.from + pos + 1, to: f.to + pos + 1 })) });
    return false;
  });
  return out;
}

/** Las correcciones de un problema: las sugerencias del diccionario (ortografía) o las de la regla. */
export function fixesOf(issue: Issue, engineFor: (lang: SpellLang) => DocSpellEngine | null): ReviewFix[] {
  if (issue.kind !== 'spelling') return issue.fixes;
  return (engineFor(issue.lang)?.suggest(issue.text) ?? []).map((s) => ({ label: s, from: issue.from, to: issue.to, text: s }));
}

/** Aplica una corrección conservando el formato del texto que sustituye. */
export function applyFix(view: EditorView, fix: ReviewFix): void {
  const marks = view.state.doc.resolve(Math.min(fix.from, view.state.doc.content.size)).marks();
  const tr = fix.text === '' ? view.state.tr.delete(fix.from, fix.to) : view.state.tr.replaceWith(fix.from, fix.to, view.state.schema.text(fix.text, marks));
  view.dispatch(tr.scrollIntoView());
}

export const KIND_LABEL: Record<IssueKind, string> = { spelling: 'Ortografía', grammar: 'Gramática', punctuation: 'Puntuación', style: 'Estilo' };
