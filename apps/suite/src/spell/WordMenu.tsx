import { t } from '@suitenova/core-ui';
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

/**
 * El menú del botón derecho sobre una palabra que el corrector no marca (como el de Office): Cortar, Copiar, Pegar y, si el tesauro la
 * conoce, unos pocos sinónimos y «Sinónimos…» para abrir el panel. Las palabras subrayadas siguen teniendo su propio menú (`ReviewMenu`).
 */
export function WordMenu({ host, view, target, x, y, onClose, onThesaurus }: { host: ReviewHost; view: EditorView; target: WordTarget; x: number; y: number; onClose: () => void; onThesaurus: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const lang = langAtPos(view, target.from, host.markInfo) ?? host.lang;
  const { result } = useSynonyms(target.word, lang);
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
  const hasSel = !view.state.selection.empty;
  const editable = !host.readOnly;
  const done = (fn: () => void) => () => {
    onClose();
    view.focus();
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
    <div ref={ref} className="nv-sp-menu" style={{ left: Math.min(x, window.innerWidth - 280), top: Math.min(y, window.innerHeight - 300) }} role="menu" aria-label={target.word}>
      {item(t('Cortar'), done(() => void document.execCommand('cut')), editable && hasSel)}
      {item(t('Copiar'), done(() => void document.execCommand('copy')), hasSel)}
      {item(t('Pegar'), done(() => void paste(view)), editable)}
      {lookup && (
        <>
          <hr />
          <div className="nv-sp-note">{t('Sinónimos')}</div>
          {editable &&
            list.map((w) =>
              item(
                <span className="nv-sp-syn">{w}</span>,
                done(() => {
                  const next = matchCase(target.word, w);
                  const tr = view.state.tr.insertText(next, target.from, target.to);
                  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, target.from, target.from + next.length)));
                }),
                true,
                `syn-${w}`,
              ),
            )}
          {item(t('Sinónimos…'), done(() => {
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target.from, target.to)));
            onThesaurus();
          }))}
        </>
      )}
    </div>
  );
}
