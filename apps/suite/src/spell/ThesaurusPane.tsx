import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { type SpellLang } from '@suitenova/spell-core';
import { matchCase, type Pos } from '@suitenova/thesaurus-core';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { useEffect, useRef, useState } from 'react';
import type { ReviewHost } from './ui';
import { langAtPos, useSynonyms, wordAtSelection } from './thesaurus';
import './messages';
import './spell.css';

/** Cómo ve el panel «Sinónimos» a cada producto: el idioma, la palabra del cursor y cómo se reemplaza. */
export interface ThesaurusHost {
  /** Idioma de revisión (el tesauro se elige por él); `off` si está desactivado. */
  lang: SpellLang | 'off';
  readOnly?: boolean;
  /** La palabra bajo el cursor o la selección y, si el texto tiene idioma propio, ese idioma; o `null`. */
  current(): { word: string; lang?: SpellLang } | null;
  /** Reemplaza la palabra actual por otra (conserva la mayúscula inicial o sostenida). */
  insert(text: string): void;
  focus(): void;
}

/** Adapta un `ReviewHost` de ProseMirror (Writer, Notes…) al panel: usa la vista con el foco o, si el foco está en el panel, la última usada. */
export function pmThesaurusHost(host: ReviewHost): ThesaurusHost {
  let last: EditorView | null = null;
  const pick = (): EditorView | null => {
    const vs = host.views().map((v) => v.view);
    const focused = vs.find((v) => v.hasFocus());
    if (focused) last = focused;
    else if (!last || !vs.includes(last)) last = vs[0] ?? null;
    return last;
  };
  return {
    get lang() {
      return host.lang;
    },
    get readOnly() {
      return host.readOnly;
    },
    current: () => {
      const v = pick();
      const w = v ? wordAtSelection(v) : null;
      if (!v || !w) return null;
      const lang = langAtPos(v, w.from, host.markInfo);
      return lang ? { word: w.word, lang } : { word: w.word };
    },
    insert: (text) => {
      const v = pick();
      const w = v ? wordAtSelection(v) : null;
      if (!v || !w || host.readOnly) return;
      const next = matchCase(w.word, text);
      const tr = v.state.tr.insertText(next, w.from, w.to);
      v.dispatch(tr.setSelection(TextSelection.create(tr.doc, w.from, w.from + next.length)).scrollIntoView());
    },
    focus: () => host.focus(),
  };
}

const POS_LABEL: Record<Pos, string> = { noun: 'Sustantivo', verb: 'Verbo', adj: 'Adjetivo', adv: 'Adverbio' };

/** El panel «Sinónimos» (Mayús+F7): los significados de la palabra por categoría, con «Insertar», «Copiar» y «Buscar» para seguir de palabra en palabra. */
export function ThesaurusPane({ host, onClose, initialWord }: { host: ThesaurusHost; onClose: () => void; initialWord?: string }) {
  const [word, setWord] = useState(initialWord ?? host.current()?.word ?? '');
  const [textLang, setTextLang] = useState<SpellLang | undefined>(() => (initialWord ? undefined : host.current()?.lang));
  const lang = textLang ?? host.lang;
  const [typed, setTyped] = useState(word);
  const [history, setHistory] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const seen = useRef(word);
  const { result, loading, error } = useSynonyms(word, lang);

  // si el cursor pasa a otra palabra del documento, el panel la sigue (como en Office); lo que se busca desde el panel se queda
  useEffect(() => {
    const id = setInterval(() => {
      const cur = host.current();
      const w = cur?.word ?? '';
      if (w && (w !== seen.current || cur?.lang !== textLang)) {
        seen.current = w;
        setTextLang(cur?.lang);
        setWord(w);
        setTyped(w);
        setHistory([]);
        setPicked(null);
      }
    }, 500);
    return () => clearInterval(id);
  }, [host, textLang]);

  const go = (w: string, push = true) => {
    const x = w.trim();
    if (!x) return;
    if (push && word && x !== word) setHistory((h) => [...h, word]);
    setWord(x);
    setTyped(x);
    setPicked(null);
  };
  const back = () => {
    const h = [...history];
    const w = h.pop();
    if (w === undefined) return;
    setHistory(h);
    go(w, false);
  };
  const lookup = result?.lookup ?? null;
  const off = lang === 'off';

  const words = (list: string[], kind: string) => (
    <ul className="nv-th-words" aria-label={t(kind)}>
      {list.map((w) => (
        <li key={w}>
          <button type="button" className="nv-th-word" aria-pressed={picked === w} onClick={() => setPicked(picked === w ? null : w)}>
            {w}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <aside className="nv-ed nv-th" aria-label={t('Sinónimos')}>
      <header>
        <strong>{t('Sinónimos')}</strong>
        <span style={{ flex: 1 }} />
        <button type="button" className="nv-btn nv-btn--small" onClick={onClose} aria-label={t('Cerrar')} title={t('Cerrar')}>
          ✕
        </button>
      </header>
      <form
        className="nv-th-search"
        onSubmit={(e) => {
          e.preventDefault();
          go(typed);
        }}
      >
        <input aria-label={t('Palabra a buscar')} value={typed} onChange={(e) => setTyped(e.target.value)} />
        <Button type="submit" size="small" disabled={off || !typed.trim()}>
          {t('Buscar sinónimos')}
        </Button>
        <Button type="button" size="small" disabled={history.length === 0} onClick={back}>
          {t('Anterior')}
        </Button>
      </form>
      <div className="nv-ed-body">
        {off && <p role="alert">{t('La revisión está desactivada. Elija un idioma en Revisar > Idioma.')}</p>}
        {error && <p role="alert">{error}</p>}
        {loading && <p>{t('Cargando el diccionario de sinónimos…')}</p>}
        {!off && !word.trim() && !loading && <p role="status">{t('Ponga el cursor en una palabra o escríbala arriba.')}</p>}
        {result && !lookup && (
          <div role="status" data-testid="th-none">
            <p>{t('No se encontró «{w}» en el diccionario de sinónimos.', { w: word })}</p>
            {result.similar.length > 0 && (
              <>
                <p>{t('Palabras parecidas:')}</p>
                <ul className="nv-th-words">
                  {result.similar.map((w) => (
                    <li key={w}>
                      <button type="button" className="nv-th-word" onClick={() => go(w)}>
                        {w}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {lookup && (
          <div data-testid="th-result">
            <h3 className="nv-th-head">
              {lookup.entry}
              {lookup.lemma && <small> {t('(de «{w}»)', { w: lookup.word })}</small>}
            </h3>
            {lookup.senses.map((s, n) => (
              <section key={n} className="nv-th-sense">
                {s.pos && <h4>{t(POS_LABEL[s.pos])}</h4>}
                {s.synonyms.length > 0 && words(s.synonyms, 'Sinónimos')}
                {s.related.length > 0 && (
                  <>
                    <h5>{t('Términos relacionados')}</h5>
                    {words(s.related, 'Términos relacionados')}
                  </>
                )}
                {s.antonyms.length > 0 && (
                  <>
                    <h5>{t('Antónimos')}</h5>
                    {words(s.antonyms, 'Antónimos')}
                  </>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
      {picked && (
        <footer className="nv-th-actions" role="group" aria-label={picked}>
          <strong>{picked}</strong>
          <Button
            size="small"
            appearance="primary"
            disabled={host.readOnly || !host.current()}
            title={host.current() ? undefined : t('Ponga el cursor en la palabra que quiere reemplazar.')}
            onClick={() => {
              host.insert(picked);
              seen.current = host.current()?.word ?? seen.current;
            }}
          >
            {t('Insertar')}
          </Button>
          <Button size="small" onClick={() => void navigator.clipboard?.writeText(picked).catch(() => {})}>
            {t('Copiar')}
          </Button>
          <Button size="small" onClick={() => go(picked)}>
            {t('Buscar sinónimos')}
          </Button>
        </footer>
      )}
    </aside>
  );
}
