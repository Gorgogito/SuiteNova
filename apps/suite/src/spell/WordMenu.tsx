import { t } from '@suitenova/core-ui';
import type { SpellLang } from '@suitenova/spell-core';
import { matchCase } from '@suitenova/thesaurus-core';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { useEffect, useRef, type ReactNode } from 'react';
import { langAtPos, useSynonyms, wordAround } from './thesaurus';
import type { ReviewHost } from './ui';
import './messages';
import './spell.css';

export interface WordTarget {
  word: string;
  from: number;
  to: number;
}

/** La palabra que hay bajo el puntero en un clic derecho, o `null` si no hay ninguna (entonces sigue el menú del navegador). */
export function wordUnderPointer(view: EditorView, event: MouseEvent): WordTarget | null {
  const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
  return at ? wordAround(view.state.doc, at.pos) : null;
}

/** Pega lo que haya en el portapapeles (con formato si lo trae, y si no, texto). */
async function paste(view: EditorView): Promise<void> {
  try {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes('text/html')) {
        view.pasteHTML(await (await item.getType('text/html')).text());
        return;
      }
    }
  } catch {
    /* sin permiso o sin formato: se prueba con el texto */
  }
  const text = await navigator.clipboard.readText().catch(() => '');
  if (text) view.pasteText(text);
}

/** Lo que el menú de palabra necesita de cada tipo de campo (ProseMirror o campo de texto). */
export interface WordMenuActions {
  word: string;
  lang: SpellLang | 'off';
  readOnly?: boolean;
  hasSelection: boolean;
  cut(): void;
  copy(): void;
  paste(): void;
  /** Reemplaza la palabra por otra (ya con la mayúscula de la original). */
  replace(text: string): void;
  /** Abre el panel o cuadro de sinónimos sobre esta palabra. */
  openThesaurus(): void;
  /** Devuelve el foco al campo. */
  focus(): void;
  /** Abre «Opciones de autocorrección» (solo donde el campo corrige al escribir). */
  openAutoCorrect?(): void;
}

/**
 * El menú del botón derecho sobre una palabra que el corrector no marca (como el de Office): Cortar, Copiar, Pegar y, si el tesauro la
 * conoce, unos pocos sinónimos y «Sinónimos…». Las palabras subrayadas siguen teniendo su propio menú (`ReviewMenu`).
 */
export function WordMenuView({ a, x, y, onClose }: { a: WordMenuActions; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { result } = useSynonyms(a.word, a.lang);
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [onClose]);
  const editable = !a.readOnly;
  const done = (fn: () => void) => () => {
    onClose();
    a.focus();
    fn();
  };
  const item = (label: ReactNode, run: () => void, enabled = true, key?: string) => (
    <div key={key} role="menuitem" tabIndex={0} aria-disabled={!enabled} className="nv-sp-item" style={enabled ? undefined : { opacity: 0.45, pointerEvents: 'none' }} onClick={enabled ? run : undefined} onKeyDown={(e) => enabled && e.key === 'Enter' && run()}>
      {label}
    </div>
  );
  const lookup = result?.lookup;
  const list = lookup ? [...new Set(lookup.senses.flatMap((s) => s.synonyms))].slice(0, 5) : [];
  return (
    <div ref={ref} className="nv-sp-menu" style={{ left: Math.min(x, window.innerWidth - 280), top: Math.min(y, window.innerHeight - 300) }} role="menu" aria-label={a.word}>
      {item(t('Cortar'), done(a.cut), editable && a.hasSelection)}
      {item(t('Copiar'), done(a.copy), a.hasSelection)}
      {item(t('Pegar'), done(a.paste), editable)}
      {lookup && (
        <>
          <hr />
          <div className="nv-sp-note">{t('Sinónimos')}</div>
          {editable && list.map((w) => item(<span className="nv-sp-syn">{w}</span>, done(() => a.replace(matchCase(a.word, w))), true, `syn-${w}`))}
          {item(t('Sinónimos…'), done(a.openThesaurus))}
        </>
      )}
      {a.openAutoCorrect && (
        <>
          <hr />
          {item(t('Opciones de autocorrección…'), done(a.openAutoCorrect))}
        </>
      )}
    </div>
  );
}

/** El menú de palabra de un editor de ProseMirror. */
export function WordMenu({ host, view, target, x, y, onClose, onThesaurus }: { host: ReviewHost; view: EditorView; target: WordTarget; x: number; y: number; onClose: () => void; onThesaurus: () => void }) {
  const select = (from: number, to: number) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  const actions: WordMenuActions = {
    word: target.word,
    lang: langAtPos(view, target.from, host.markInfo) ?? host.lang,
    readOnly: host.readOnly,
    hasSelection: !view.state.selection.empty,
    cut: () => void document.execCommand('cut'),
    copy: () => void document.execCommand('copy'),
    paste: () => void paste(view),
    replace: (next) => {
      const tr = view.state.tr.insertText(next, target.from, target.to);
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, target.from, target.from + next.length)));
    },
    openThesaurus: () => {
      select(target.from, target.to);
      onThesaurus();
    },
    focus: () => view.focus(),
  };
  return <WordMenuView a={actions} x={x} y={y} onClose={onClose} />;
}
