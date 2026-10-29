import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { TextSelection } from 'prosemirror-state';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WriterCtl } from './doc';
import { Modal, field, focusDocSoon } from './dialogs';
import type { WriterUI } from './commands';
import { addToUserDictionary, loadSpeller, misspellings, removeFromUserDictionary, setSpell, userDictionaryWords, type SpellLang } from './spell';
import type { Misspelling } from './spell-core';

async function engineOf(ctl: WriterCtl) {
  if (ctl.spellLang === 'off') return null;
  return loadSpeller(ctl.spellLang as SpellLang);
}

/** The right-click menu on a misspelled word: suggestions, ignore, add to the dictionary. */
export function SpellMenu({ ctl, target, onClose }: { ctl: WriterCtl; target: { from: number; to: number; word: string; x: number; y: number }; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  useEffect(() => {
    void engineOf(ctl).then((e) => setSuggestions(e ? e.suggest(target.word) : []));
  }, [ctl, target.word]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [onClose]);
  const v = ctl.mainView;
  const replace = (text: string) => {
    if (!v) return;
    const marks = v.state.doc.resolve(target.from).marks();
    v.dispatch(v.state.tr.replaceWith(target.from, target.to, v.state.schema.text(text, marks)).scrollIntoView());
    onClose();
    v.focus();
  };
  const refresh = () => v && setSpell(v, {});
  const left = Math.min(target.x, window.innerWidth - 230);
  const top = Math.min(target.y, window.innerHeight - 260);
  return (
    <div ref={ref} className="nw-ctl-popup" style={{ left, top, minWidth: 200 }} role="menu" aria-label={t('Ortografía')}>
      {suggestions === null && <div className="nw-ctl-item" style={{ color: '#888' }}>{t('Buscando sugerencias…')}</div>}
      {suggestions?.length === 0 && <div className="nw-ctl-item" style={{ color: '#888' }}>{t('(sin sugerencias)')}</div>}
      {suggestions?.slice(0, 6).map((s) => (
        <div key={s} role="menuitem" tabIndex={0} className="nw-ctl-item" style={{ fontWeight: 600 }} onClick={() => replace(s)} onKeyDown={(e) => e.key === 'Enter' && replace(s)}>
          {s}
        </div>
      ))}
      <hr style={{ margin: '2px 0' }} />
      <div
        role="menuitem"
        tabIndex={0}
        className="nw-ctl-item"
        onClick={async () => {
          (await engineOf(ctl))?.ignore(target.word);
          refresh();
          onClose();
        }}
      >
        {t('Omitir todo')}
      </div>
      <div
        role="menuitem"
        tabIndex={0}
        className="nw-ctl-item"
        onClick={async () => {
          const e = await engineOf(ctl);
          if (e) addToUserDictionary(e, target.word);
          refresh();
          onClose();
        }}
      >
        {t('Agregar al diccionario')}
      </div>
    </div>
  );
}

/** Spelling pane (F7): goes through the mistakes one by one. */
export function SpellDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const ctl = ui.ctl;
  const [, setTick] = useState(0);
  const [current, setCurrent] = useState<Misspelling | null>(null);
  const [choice, setChoice] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [loading, setLoading] = useState(true);
  const engineRef = useRef<Awaited<ReturnType<typeof engineOf>>>(null);
  const skippedFrom = useRef<number[]>([]);

  const select = (m: Misspelling | null) => {
    const v = ctl.mainView;
    setCurrent(m);
    if (!m || !v) {
      setDone(true);
      return;
    }
    const sg = engineRef.current?.suggest(m.word) ?? [];
    setSuggestions(sg);
    setChoice(sg[0] ?? '');
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, m.from, m.to)).scrollIntoView());
  };
  /** The next mistake at or after `from`, skipping those the person passed over (once). */
  const nextFrom = (from: number): Misspelling | null => {
    const v = ctl.mainView;
    if (!v) return null;
    const list = misspellings(v).filter((m) => !skippedFrom.current.includes(m.from));
    return list.find((m) => m.from >= from) ?? list[0] ?? null;
  };
  useEffect(() => {
    let alive = true;
    void engineOf(ctl).then((e) => {
      if (!alive) return;
      engineRef.current = e;
      setLoading(false);
      const v = ctl.mainView;
      select(nextFrom(v?.state.selection.from ?? 0));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const replaceWord = (all: boolean) => {
    const v = ctl.mainView;
    if (!v || !current || !choice) return;
    const targets = all ? misspellings(v).filter((m) => m.word === current.word).sort((a, b) => b.from - a.from) : [current];
    const tr = v.state.tr;
    for (const m of targets) tr.replaceWith(m.from, m.to, v.state.schema.text(choice, v.state.doc.resolve(m.from).marks()));
    v.dispatch(tr);
    select(nextFrom(current.from));
    setTick((x) => x + 1);
  };
  const after = () => {
    const v = ctl.mainView;
    if (!v) return;
    queueMicrotask(() => select(nextFrom(current ? current.from : 0)));
    setTick((x) => x + 1);
  };
  const noEngine = !loading && !engineRef.current;
  return (
    <Modal
      title={t('Ortografía')}
      onClose={onClose}
      actions={<Button onClick={() => { onClose(); focusDocSoon(ui); }}>{t('Cerrar')}</Button>}
    >
      {loading && <p>{t('Cargando el diccionario…')}</p>}
      {noEngine && <p role="alert">{t('La revisión ortográfica está desactivada. Elija un idioma en Revisar > Idioma.')}</p>}
      {!loading && !noEngine && done && (
        <p role="status" style={{ fontWeight: 600 }}>
          {t('La revisión ortográfica ha terminado.')}
          {skipped > 0 ? ` ${t('Se omitieron {n}.', { n: skipped })}` : ''}
        </p>
      )}
      {!loading && !noEngine && !done && current && (
        <>
          <div style={field}>
            <label>{t('No está en el diccionario')}</label>
            <div className="nw-eq-preview" style={{ justifyContent: 'flex-start', fontSize: '1em', minHeight: 40 }} data-testid="spell-word">
              {current.word}
            </div>
          </div>
          <div style={field}>
            <label htmlFor="nw-sp-sug">{t('Sugerencias')}</label>
            <select id="nw-sp-sug" size={6} value={choice} onChange={(e) => setChoice(e.target.value)} style={{ width: '100%' }}>
              {suggestions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {suggestions.length === 0 && <span style={{ opacity: 0.7 }}>{t('(sin sugerencias)')}</span>}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button disabled={!choice} onClick={() => replaceWord(false)}>
              {t('Cambiar')}
            </Button>
            <Button disabled={!choice} onClick={() => replaceWord(true)}>
              {t('Cambiar todas')}
            </Button>
            <Button
              onClick={() => {
                skippedFrom.current.push(current.from);
                setSkipped((n) => n + 1);
                select(nextFrom(current.to));
              }}
            >
              {t('Omitir una vez')}
            </Button>
            <Button
              onClick={() => {
                engineRef.current?.ignore(current.word);
                const v = ctl.mainView;
                if (v) setSpell(v, {});
                after();
              }}
            >
              {t('Omitir todo')}
            </Button>
            <Button
              onClick={() => {
                if (engineRef.current) addToUserDictionary(engineRef.current, current.word);
                const v = ctl.mainView;
                if (v) setSpell(v, {});
                after();
              }}
            >
              {t('Agregar al diccionario')}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** The personal dictionary: the words added from the spelling menu. */
export function UserDictionaryDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const [words, setWords] = useState(userDictionaryWords);
  const sorted = useMemo(() => [...words].sort((a, b) => a.localeCompare(b)), [words]);
  return (
    <Modal title={t('Diccionario personalizado')} onClose={onClose} actions={<Button appearance="primary" onClick={() => { onClose(); focusDocSoon(ui); }}>{t('Cerrar')}</Button>}>
      {sorted.length === 0 && <p>{t('Todavía no ha agregado palabras. Use «Agregar al diccionario» en el menú de una palabra subrayada.')}</p>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 280, overflow: 'auto' }}>
        {sorted.map((w) => (
          <li key={w} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
            <span>{w}</span>
            <Button
              size="small"
              aria-label={t('Quitar {w}', { w })}
              onClick={() => {
                removeFromUserDictionary(w);
                setWords(userDictionaryWords());
              }}
            >
              {t('Quitar')}
            </Button>
          </li>
        ))}
      </ul>
      {sorted.length > 0 && <p style={{ opacity: 0.8 }}>{t('Una palabra quitada deja de estar en la lista, pero se sigue aceptando hasta que se reinicie la aplicación.')}</p>}
    </Modal>
  );
}

