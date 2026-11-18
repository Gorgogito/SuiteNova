import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input } from '@fluentui/react-components';
import { GRAMMAR_RULES, ruleOn, type SpellLang } from '@suitenova/spell-core';
import { t } from '@suitenova/core-ui';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DocSpellEngine } from './engine';
import { addToUserDictionary, ignoreWord, loadSpeller, removeFromUserDictionary, SPELL_LANGS, userDictionaryWords } from './load';
import { getReviewOptions, ignoreOnce, onReviewOptions, resetIgnored, setReviewOptions } from './options';
import { applyFix, fixesOf, KIND_LABEL, reviewDoc, type Issue, type ReviewFix } from './review';
import './messages';
import './spell.css';

/**
 * La interfaz del corrector, compartida por los productos. Cada producto la adapta con un `ReviewHost`: dice en qué idioma se revisa y
 * en qué vistas de ProseMirror está el texto (Writer: una; Notes: una por cuadro de texto).
 */
export interface ReviewHost {
  /** Idioma de revisión; `off` si está desactivada. */
  lang: SpellLang | 'off';
  /** Si se da, los cuadros ofrecen cambiar el idioma. */
  setLang?: (lang: SpellLang) => void;
  /** Las vistas con texto, en orden de lectura. */
  views(): { id: string; view: EditorView }[];
  /** Devuelve el foco al documento. */
  focus(): void;
  readOnly?: boolean;
}

export interface LocatedIssue extends Issue {
  viewId: string;
}

/** Carga el diccionario del idioma del producto y calcula los problemas de todas sus vistas; se vuelve a calcular con `refresh()` o al cambiar las opciones. */
export function useReview(host: ReviewHost): { engine: DocSpellEngine | null; issues: LocatedIssue[]; loading: boolean; error: string; refresh: () => void } {
  const [engine, setEngine] = useState<DocSpellEngine | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const lang = host.lang;
  useEffect(() => {
    let alive = true;
    setEngine(null);
    setError('');
    if (lang === 'off') return;
    loadSpeller(lang).then(
      (e) => alive && setEngine(e),
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [lang]);
  useEffect(() => onReviewOptions(() => setTick((n) => n + 1)), []);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const issues = useMemo(() => {
    if (!engine || lang === 'off') return [];
    const out: LocatedIssue[] = [];
    for (const { id, view } of host.views()) for (const i of reviewDoc(view.state.doc, { engine, lang, options: getReviewOptions() })) out.push({ ...i, viewId: id });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, lang, tick]);
  return { engine, issues, loading: lang !== 'off' && !engine && !error, error, refresh };
}

// ------------------------------------------------------------------------------------------------ ventana modal

function Modal({ title, onClose, children, actions, width = 520 }: { title: string; onClose: () => void; children: ReactNode; actions: ReactNode; width?: number }) {
  // Fluent deja aria-hidden en la página cuando el padre desmonta el diálogo abierto: se devuelve cuando ya no queda ninguno
  useEffect(
    () => () => {
      setTimeout(() => {
        if (document.querySelector('[role=dialog]')) return;
        for (const el of document.querySelectorAll('body > [aria-hidden=true], #root[aria-hidden=true]')) el.removeAttribute('aria-hidden');
        document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
      }, 0);
    },
    [],
  );
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: width, width: '92vw' }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>{children}</DialogContent>
          <DialogActions>{actions}</DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

const field: React.CSSProperties = { display: 'grid', gap: 4, marginBottom: 10 };

/** Selecciona el problema en su vista y lo muestra. */
export function goToIssue(host: ReviewHost, i: LocatedIssue): void {
  const view = host.views().find((v) => v.id === i.viewId)?.view;
  if (!view) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, i.from, i.to)).scrollIntoView());
}

const viewOf = (host: ReviewHost, id: string) => host.views().find((v) => v.id === id)?.view;

/** Quita una regla de gramática de las que se aplican (como «Volver a revisar» al revés: se activa en las opciones). */
const turnOffRule = (rule: string) => setReviewOptions({ rules: { ...getReviewOptions().rules, [rule]: false } });
const ruleLabel = (rule: string) => GRAMMAR_RULES.find((r) => r.id === rule)?.label ?? rule;

// ------------------------------------------------------------------------------------------------ menú contextual

/** El menú del botón derecho sobre algo subrayado: correcciones, omitir, agregar al diccionario, desactivar la regla. */
export function ReviewMenu({ host, issue, viewId, x, y, onClose, onOptions }: { host: ReviewHost; issue: Issue; viewId: string; x: number; y: number; onClose: () => void; onOptions?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<DocSpellEngine | null>(null);
  const [fixes, setFixes] = useState<ReviewFix[] | null>(issue.kind === 'spelling' ? null : issue.fixes);
  const lang = host.lang;
  useEffect(() => {
    if (lang === 'off') return;
    let alive = true;
    void loadSpeller(lang).then((e) => {
      if (!alive) return;
      setEngine(e);
      setFixes(fixesOf(issue, e));
    });
    return () => {
      alive = false;
    };
  }, [lang, issue]);
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
  const view = viewOf(host, viewId);
  const done = (fn: () => void) => () => {
    fn();
    onClose();
    view?.focus();
  };
  const spelling = issue.kind === 'spelling';
  const item = (label: ReactNode, run: () => void, strong = false, key?: string) => (
    <div key={key} role="menuitem" tabIndex={0} className="nv-sp-item" style={strong ? { fontWeight: 600 } : undefined} onClick={run} onKeyDown={(e) => e.key === 'Enter' && run()}>
      {label}
    </div>
  );
  return (
    <div ref={ref} className="nv-sp-menu" style={{ left: Math.min(x, window.innerWidth - 280), top: Math.min(y, window.innerHeight - 300) }} role="menu" aria-label={t(KIND_LABEL[issue.kind])}>
      {!spelling && <div className="nv-sp-note">{t(issue.message)}</div>}
      {fixes === null && <div className="nv-sp-note">{t('Buscando sugerencias…')}</div>}
      {fixes?.length === 0 && <div className="nv-sp-note">{t('(sin sugerencias)')}</div>}
      {fixes?.slice(0, 6).map((f, n) => item(f.label || t('(quitar)'), done(() => view && !host.readOnly && applyFix(view, f)), n === 0 || !spelling, `fix${n}`))}
      <hr />
      {spelling ? (
        <>
          {item(t('Omitir todo'), done(() => (engine ? ignoreWord(engine, issue.text) : ignoreOnce(issue.key))))}
          {item(t('Agregar al diccionario'), done(() => engine && addToUserDictionary(engine, issue.text)))}
        </>
      ) : (
        <>
          {item(t('Omitir una vez'), done(() => ignoreOnce(issue.key)))}
          {item(t('No volver a marcar «{r}»', { r: t(ruleLabel(issue.rule)) }), done(() => turnOffRule(issue.rule)))}
        </>
      )}
      {onOptions && item(t('Opciones de revisión…'), done(onOptions))}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ cuadro F7

/** El cuadro único de «Ortografía y gramática» (F7): recorre los problemas uno a uno. */
export function ReviewDialog({ host, onClose }: { host: ReviewHost; onClose: () => void }) {
  const { engine, issues, loading, error, refresh } = useReview(host);
  const cursor = useRef<{ v: number; pos: number } | null>(null);
  const [choice, setChoice] = useState('');
  const [fixes, setFixes] = useState<ReviewFix[]>([]);
  const order = useMemo(() => host.views().map((v) => v.id), [host]);
  // el primero desde el cursor, y al llegar al final se vuelve al principio
  const current = useMemo(() => {
    if (!issues.length) return null;
    const c = cursor.current ?? firstCursor(host);
    const at = (i: LocatedIssue) => order.indexOf(i.viewId) * 1e9 + i.from;
    const here = c.v * 1e9 + c.pos;
    return issues.find((i) => at(i) >= here) ?? issues[0]!;
  }, [issues, host, order]);
  useEffect(() => {
    if (!current || !engine) return;
    const f = fixesOf(current, engine);
    setFixes(f);
    setChoice(f[0]?.text ?? '');
    goToIssue(host, current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.viewId, current?.from, current?.to, current?.rule, engine]);
  const selectedFix = fixes.find((f) => f.text === choice) ?? fixes[0];
  const mark = (i: LocatedIssue, after: number) => {
    cursor.current = { v: order.indexOf(i.viewId), pos: after };
  };
  const change = () => {
    if (!current || !selectedFix) return;
    const view = viewOf(host, current.viewId);
    if (!view || host.readOnly) return;
    applyFix(view, selectedFix);
    mark(current, selectedFix.from);
    refresh();
  };
  const changeAll = () => {
    if (!current || current.kind !== 'spelling') return;
    const view = viewOf(host, current.viewId);
    if (!view || !choice || host.readOnly) return;
    const tr = view.state.tr;
    for (const i of issues.filter((x) => x.viewId === current.viewId && x.kind === 'spelling' && x.text === current.text).sort((a, b) => b.from - a.from)) tr.replaceWith(i.from, i.to, view.state.schema.text(choice, view.state.doc.resolve(i.from).marks()));
    view.dispatch(tr);
    mark(current, current.from);
    refresh();
  };
  const skip = () => {
    if (!current) return;
    mark(current, current.to);
    ignoreOnce(current.key);
  };
  const close = () => {
    onClose();
    host.focus();
  };
  const off = host.lang === 'off';
  return (
    <Modal
      title={t('Ortografía y gramática')}
      onClose={close}
      actions={
        <>
          <Button onClick={() => (resetIgnored(), (cursor.current = null))}>{t('Volver a revisar')}</Button>
          <Button onClick={close}>{t('Cerrar')}</Button>
        </>
      }
    >
      {host.setLang && !off && (
        <div style={field}>
          <label htmlFor="nv-sp-lang">{t('Idioma')}</label>
          <select id="nv-sp-lang" className="nv-select" value={host.lang} onChange={(e) => host.setLang?.(e.target.value as SpellLang)}>
            {SPELL_LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {t(l.label)}
              </option>
            ))}
          </select>
        </div>
      )}
      {off && <p role="alert">{t('La revisión ortográfica está desactivada. Elija un idioma en Revisar > Idioma.')}</p>}
      {error && <p role="alert">{error}</p>}
      {loading && <p>{t('Cargando el diccionario…')}</p>}
      {engine && !current && (
        <p role="status" style={{ fontWeight: 600 }} data-testid="spell-done">
          {t('La revisión ha terminado: no hay más problemas.')}
        </p>
      )}
      {engine && current && (
        <>
          <p className="nv-sp-count" data-testid="spell-count">
            {t(KIND_LABEL[current.kind])} · {t('quedan {n}', { n: issues.length })}
          </p>
          <div style={field}>
            <label>{current.kind === 'spelling' ? t('No está en el diccionario') : t(current.message)}</label>
            <div className="nv-sp-word" data-testid="spell-word">
              {current.text}
            </div>
            <div className="nv-sp-context">{contextOf(host, current)}</div>
          </div>
          <div style={field}>
            <label htmlFor="nv-sp-sug">{current.kind === 'spelling' ? t('Sugerencias') : t('Correcciones')}</label>
            <select id="nv-sp-sug" size={5} value={choice} onChange={(e) => setChoice(e.target.value)} style={{ width: '100%' }}>
              {fixes.map((f) => (
                <option key={`${f.label}|${f.text}|${f.from}`} value={f.text}>
                  {f.label || t('(quitar)')}
                </option>
              ))}
            </select>
            {fixes.length === 0 && <span style={{ opacity: 0.7 }}>{t('(sin sugerencias)')}</span>}
          </div>
          <div className="nv-sp-actions">
            <Button disabled={!selectedFix || host.readOnly} onClick={change}>
              {t('Cambiar')}
            </Button>
            {current.kind === 'spelling' && (
              <Button disabled={!choice || host.readOnly} onClick={changeAll}>
                {t('Cambiar todas')}
              </Button>
            )}
            <Button onClick={skip}>{t('Omitir una vez')}</Button>
            {current.kind === 'spelling' ? (
              <>
                <Button onClick={() => (mark(current, current.to), ignoreWord(engine, current.text), refresh())}>{t('Omitir todo')}</Button>
                <Button onClick={() => (mark(current, current.to), addToUserDictionary(engine, current.text), refresh())}>{t('Agregar al diccionario')}</Button>
              </>
            ) : (
              <Button onClick={() => (mark(current, current.to), turnOffRule(current.rule))}>{t('No volver a marcar esta regla')}</Button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function firstCursor(host: ReviewHost): { v: number; pos: number } {
  const views = host.views();
  const i = views.findIndex((v) => v.view.hasFocus());
  return { v: Math.max(0, i), pos: i >= 0 ? views[i]!.view.state.selection.from : 0 };
}

/** El párrafo donde está el problema (recortado). */
function contextOf(host: ReviewHost, i: LocatedIssue): string {
  const view = viewOf(host, i.viewId);
  if (!view) return '';
  try {
    const text = view.state.doc.resolve(Math.min(i.from, view.state.doc.content.size)).parent.textContent;
    return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  } catch {
    return '';
  }
}

// ------------------------------------------------------------------------------------------------ panel «Editor»

const SECTIONS: { id: string; label: string; kinds: Issue['kind'][] }[] = [
  { id: 'spelling', label: 'Ortografía', kinds: ['spelling'] },
  { id: 'grammar', label: 'Gramática y puntuación', kinds: ['grammar', 'punctuation'] },
  { id: 'style', label: 'Estilo', kinds: ['style'] },
];

/** El panel lateral «Editor»: todos los problemas del documento por categoría, con su corrección a un clic. */
export function EditorPane({ host, onClose, onOptions }: { host: ReviewHost; onClose: () => void; onOptions?: () => void }) {
  const { engine, issues, loading, error, refresh } = useReview(host);
  const [section, setSection] = useState('spelling');
  // se vuelve a calcular al escribir (el panel no ve los cambios del documento por sí solo)
  useEffect(() => {
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, [refresh]);
  // al abrir, se muestra la primera categoría que tenga algo
  const chosen = useRef(false);
  useEffect(() => {
    if (chosen.current || !engine) return;
    chosen.current = true;
    const first = SECTIONS.find((s) => issues.some((i) => s.kinds.includes(i.kind)));
    if (first) setSection(first.id);
  }, [engine, issues]);
  const shown = issues.filter((i) => SECTIONS.find((s) => s.id === section)!.kinds.includes(i.kind));
  const off = host.lang === 'off';
  return (
    <aside className="nv-ed" aria-label={t('Editor')}>
      <header>
        <strong>{t('Editor')}</strong>
        <span style={{ flex: 1 }} />
        {onOptions && (
          <button type="button" className="nv-btn nv-btn--small" onClick={onOptions}>
            {t('Opciones…')}
          </button>
        )}
        <button type="button" className="nv-btn nv-btn--small" onClick={onClose} aria-label={t('Cerrar')} title={t('Cerrar')}>
          ✕
        </button>
      </header>
      <div className="nv-ed-tabs" role="tablist">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)}>
            {t(s.label)} ({issues.filter((i) => s.kinds.includes(i.kind)).length})
          </button>
        ))}
      </div>
      <div className="nv-ed-body">
        {off && <p role="alert">{t('La revisión ortográfica está desactivada. Elija un idioma en Revisar > Idioma.')}</p>}
        {error && <p role="alert">{error}</p>}
        {loading && <p>{t('Cargando el diccionario…')}</p>}
        {engine && shown.length === 0 && <p role="status">{t('No hay problemas de este tipo.')}</p>}
        <ul>
          {shown.map((i) => {
            const fx = fixesOf(i, engine).slice(0, i.kind === 'spelling' ? 3 : 2);
            return (
              <li key={`${i.viewId}:${i.from}:${i.rule}`} className={`nv-ed-item nv-ed-${i.kind}`}>
                <button type="button" className="nv-ed-go" onClick={() => goToIssue(host, i)}>
                  <strong>{i.text}</strong>
                  <span>{i.kind === 'spelling' ? t('No está en el diccionario') : t(i.message)}</span>
                </button>
                <div className="nv-ed-fixes">
                  {fx.map((f) => (
                    <Button
                      key={`${f.label}|${f.from}`}
                      size="small"
                      disabled={host.readOnly}
                      onClick={() => {
                        const view = viewOf(host, i.viewId);
                        if (view) applyFix(view, f);
                        refresh();
                      }}
                    >
                      {f.label || t('(quitar)')}
                    </Button>
                  ))}
                  <Button size="small" onClick={() => (i.kind === 'spelling' ? engine && ignoreWord(engine, i.text) : ignoreOnce(i.key), refresh())}>
                    {i.kind === 'spelling' ? t('Omitir todo') : t('Omitir una vez')}
                  </Button>
                  {i.kind === 'spelling' && (
                    <Button size="small" onClick={() => (engine && addToUserDictionary(engine, i.text), refresh())}>
                      {t('Agregar al diccionario')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------------------------------------ opciones

/** «Opciones de revisión»: qué se omite y qué reglas de gramática se aplican. Valen para todos los productos. */
export function ReviewOptionsDialog({ lang, onClose, onDictionary }: { lang: SpellLang | 'off'; onClose: () => void; onDictionary?: () => void }) {
  const [o, setO] = useState(getReviewOptions);
  useEffect(() => onReviewOptions(() => setO(getReviewOptions())), []);
  const eff: SpellLang = lang === 'off' ? 'es' : lang;
  const family = eff.startsWith('es') ? 'es' : 'en';
  const rules = GRAMMAR_RULES.filter((r) => r.family === 'all' || r.family === family);
  const flag = (key: 'ignoreUppercase' | 'ignoreNumbers' | 'ignoreInternet' | 'grammar', label: string) => (
    <Checkbox label={t(label)} checked={o[key]} onChange={(_e, d) => setReviewOptions({ [key]: !!d.checked })} />
  );
  return (
    <Modal title={t('Opciones de revisión')} onClose={onClose} actions={<Button appearance="primary" onClick={onClose}>{t('Cerrar')}</Button>} width={560}>
      <fieldset className="nv-sp-group">
        <legend>{t('Al corregir la ortografía')}</legend>
        {flag('ignoreUppercase', 'Omitir palabras en MAYÚSCULAS')}
        {flag('ignoreNumbers', 'Omitir palabras con números')}
        {flag('ignoreInternet', 'Omitir direcciones de Internet y rutas de archivo')}
        {onDictionary && (
          <div>
            <Button size="small" onClick={onDictionary}>
              {t('Diccionario personalizado…')}
            </Button>
          </div>
        )}
      </fieldset>
      <fieldset className="nv-sp-group">
        <legend>{t('Al corregir la gramática')}</legend>
        {flag('grammar', 'Revisar la gramática, la puntuación y el estilo')}
        <div className="nv-sp-rules" aria-disabled={!o.grammar}>
          {rules.map((r) => (
            <Checkbox key={r.id} disabled={!o.grammar} label={`${t(r.label)}${r.category === 'style' ? ` (${t('estilo')})` : ''}`} title={t(r.description)} checked={ruleOn(o, r.id, eff)} onChange={(_e, d) => setReviewOptions({ rules: { ...o.rules, [r.id]: !!d.checked } })} />
          ))}
        </div>
        <label className="nv-sp-limit">
          {t('Una frase es «muy larga» a partir de')}
          <Input
            type="number"
            size="small"
            value={String(o.longSentenceWords)}
            onChange={(_e, d) => {
              const n = Number(d.value);
              if (Number.isFinite(n) && n >= 10 && n <= 200) setReviewOptions({ longSentenceWords: Math.round(n) });
            }}
            style={{ width: 80 }}
            aria-label={t('Palabras por frase')}
          />
          {t('palabras')}
        </label>
      </fieldset>
      <div>
        <Button size="small" onClick={() => resetIgnored()}>
          {t('Volver a revisar')}
        </Button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ diccionario personal

/** El diccionario personal: se agregan y se quitan palabras. Es uno solo para todos los productos. */
export function DictionaryDialog({ onClose }: { onClose: () => void }) {
  const [words, setWords] = useState(userDictionaryWords);
  const [draft, setDraft] = useState('');
  const sorted = useMemo(() => [...words].sort((a, b) => a.localeCompare(b)), [words]);
  const valid = /^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*$/u.test(draft.trim()) && draft.trim().length > 1;
  const add = () => {
    if (!valid) return;
    const w = draft.trim();
    addToUserDictionary(null, w);
    setWords(userDictionaryWords());
    setDraft('');
  };
  return (
    <Modal title={t('Diccionario personalizado')} onClose={onClose} actions={<Button appearance="primary" onClick={onClose}>{t('Cerrar')}</Button>}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <Input value={draft} onChange={(_e, d) => setDraft(d.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={t('Palabra nueva')} aria-label={t('Palabra nueva')} style={{ flex: 1 }} />
        <Button disabled={!valid} onClick={() => add()}>
          {t('Agregar')}
        </Button>
      </div>
      {sorted.length === 0 && <p>{t('Todavía no ha agregado palabras. Use «Agregar al diccionario» en el menú de una palabra subrayada.')}</p>}
      <ul className="nv-sp-dict" aria-label={t('Palabras agregadas')}>
        {sorted.map((w) => (
          <li key={w}>
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
      <p style={{ opacity: 0.8 }}>{t('Las palabras valen para todos los productos y documentos.')}</p>
    </Modal>
  );
}
