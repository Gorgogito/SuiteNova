import { isSpellLang, type SpellLang } from '@suitenova/spell-core';
import type { RunProps } from '@suitenova/slides-core';
import type { EditorState } from 'prosemirror-state';
import { loadSpeller, pmThesaurusHost, setSpell, type MarkInfo, type ReviewHost, type ThesaurusHost } from '../spell';
import type { SlidesCtl } from './ctl';
import type { EditorView } from 'prosemirror-view';

/** En una diapositiva el idioma y el «no revisar» van en las propiedades del tramo (`a:rPr lang`, `noProof`); los vínculos no se revisan. */
export const slidesMarkInfo: MarkInfo = (n) => {
  const r = n.marks.find((m) => m.type.name === 'run')?.attrs.r as RunProps | undefined;
  return { noCheck: !!r?.noProof || !!r?.hlink, lang: r?.lang ?? null };
};

const KEY = 'nova.slides.spellLang';

/** El idioma de la presentación (el de los textos que no dicen otro). */
export function slidesLang(): SpellLang {
  try {
    const v = localStorage.getItem(KEY) ?? localStorage.getItem('nova.writer.spellLangLast');
    return isSpellLang(v) ? v : 'es';
  } catch {
    return 'es';
  }
}

export function setSlidesLang(l: SpellLang): void {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* sin almacenamiento */
  }
}

/** Activa el subrayado en un editor de texto cuando llega el diccionario. */
export async function enableSpell(view: EditorView): Promise<void> {
  const lang = slidesLang();
  try {
    const engine = await loadSpeller(lang);
    if (!view.isDestroyed) setSpell(view, { engine, on: true, lang });
  } catch {
    /* sin diccionario no se subraya */
  }
}

/** Cómo ve el corrector compartido el texto que se está editando. */
export const slidesHost = (view: EditorView): ReviewHost => ({
  get lang() {
    return slidesLang();
  },
  views: () => [{ id: 'edit', view }],
  focus: () => view.focus(),
  markInfo: slidesMarkInfo,
});

/** El idioma del texto seleccionado: la etiqueta, `null` (el de la presentación) o `'mixed'`. */
export function runLangOf(state: EditorState): string | null | 'mixed' {
  const { from, to, empty, $from } = state.selection;
  const vals = new Set<string | null>();
  const read = (marks: readonly import('prosemirror-model').Mark[]) => vals.add(((marks.find((m) => m.type.name === 'run')?.attrs.r as RunProps | undefined)?.lang as string | undefined) ?? null);
  if (empty) read(state.storedMarks ?? $from.marks());
  else state.doc.nodesBetween(from, to, (n) => (n.isText && read(n.marks), true));
  return vals.size > 1 ? 'mixed' : ([...vals][0] ?? null);
}

export function runNoProofOf(state: EditorState): boolean {
  const { from, to, empty, $from } = state.selection;
  if (empty) return !!((state.storedMarks ?? $from.marks()).find((m) => m.type.name === 'run')?.attrs.r as RunProps | undefined)?.noProof;
  let any = false;
  let all = true;
  state.doc.nodesBetween(from, to, (n) => {
    if (n.isText) {
      any = true;
      if (!(n.marks.find((m) => m.type.name === 'run')?.attrs.r as RunProps | undefined)?.noProof) all = false;
    }
    return true;
  });
  return any && all;
}

const thHosts = new WeakMap<SlidesCtl, ThesaurusHost>();

/** El panel «Sinónimos» sobre el texto que se está editando en la diapositiva (si no se edita ninguno, el panel espera). */
export function slidesThesaurusHost(ctl: SlidesCtl): ThesaurusHost {
  let h = thHosts.get(ctl);
  if (!h) {
    h = pmThesaurusHost({
      get lang() {
        return slidesLang();
      },
      views: () => (ctl.editor && !ctl.editor.isDestroyed ? [{ id: 'edit', view: ctl.editor }] : []),
      focus: () => ctl.editor?.focus(),
      markInfo: slidesMarkInfo,
    });
    thHosts.set(ctl, h);
  }
  return h;
}
