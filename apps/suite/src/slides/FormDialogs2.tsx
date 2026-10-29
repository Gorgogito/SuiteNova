import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { addSection, docNode, eachText, findAll, moveSection, removeSection, renameSection, replaceAll, resizeSlide, type Deck, type FindOptions, type ShowProps } from '@suitenova/slides-core';
import { useEffect, useMemo, useState } from 'react';
import { loadSpeller, addToUserDictionary, SPELL_LANGS, type SpellLang } from '../writer/spell';
import { findWords, skipWord, type SpellEngine } from '../writer/spell-core';
import { addComment, rememberAuthor, savedAuthor } from './comments';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';

type P = { ui: SlidesUI; onClose: () => void; arg?: unknown };
const PT_PER_CM = 72 / 2.54;
const cm = (pt: number) => Math.round((pt / PT_PER_CM) * 100) / 100;

// ------------------------------------------------------------------------------------------------ slide size

const SIZES: { id: string; label: string; w: number; h: number; type?: string }[] = [
  { id: 'wide', label: 'Pantalla ancha (16:9)', w: 960, h: 540 },
  { id: '4x3', label: 'Estándar (4:3)', w: 720, h: 540, type: 'screen4x3' },
  { id: '16x10', label: 'Pantalla (16:10)', w: 864, h: 540, type: 'screen16x10' },
  { id: 'a4', label: 'Papel A4 (210 × 297 mm)', w: 793.7, h: 561.1, type: 'A4' },
  { id: 'letter', label: 'Carta (8,5 × 11 pulgadas)', w: 792, h: 612, type: 'letter' },
  { id: 'banner', label: 'Banner', w: 576, h: 72, type: 'banner' },
  { id: 'custom', label: 'Personalizado' , w: 0, h: 0 },
];

export function SlideSizeDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const cur = c.deck.size;
  const match = SIZES.find((s) => s.id !== 'custom' && Math.abs(s.w - cur.w) < 1 && Math.abs(s.h - cur.h) < 1);
  const [preset, setPreset] = useState(match?.id ?? 'custom');
  const [w, setW] = useState(cm(cur.w));
  const [h, setH] = useState(cm(cur.h));
  const [mode, setMode] = useState<'fit' | 'max' | 'stretch'>('fit');
  const [first, setFirst] = useState(c.deck.firstSlideNum ?? 1);
  const pick = (id: string) => {
    setPreset(id);
    const p = SIZES.find((s) => s.id === id)!;
    if (p.w) (setW(cm(p.w)), setH(cm(p.h)));
  };
  const ok = w >= 2 && w <= 142 && h >= 2 && h <= 142;
  const apply = () => {
    const p = SIZES.find((s) => s.id === preset);
    const nw = p && p.w ? p.w : Math.round(w * PT_PER_CM * 10) / 10;
    const nh = p && p.w ? p.h : Math.round(h * PT_PER_CM * 10) / 10;
    c.apply('Tamaño de la diapositiva', (d) => ({ ...resizeSlide(d, nw, nh, mode, p?.type ?? 'custom'), firstSlideNum: first === 1 ? undefined : first }));
    onClose();
  };
  return (
    <Modal
      title={t('Tamaño de la diapositiva')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!ok} onClick={apply}>{t('Aceptar')}</Button>
        </>
      }
    >
      <div className="sl-form">
        <label className="sl-field">
          <span>{t('Tamaño de las diapositivas')}</span>
          <select value={preset} onChange={(e) => pick(e.target.value)} aria-label={t('Tamaño de las diapositivas')}>
            {SIZES.map((s) => (
              <option key={s.id} value={s.id}>{t(s.label)}</option>
            ))}
          </select>
        </label>
        <div className="sl-form__row">
          <label className="sl-field">
            <span>{t('Ancho (cm)')}</span>
            <input type="number" step="0.01" value={w} onChange={(e) => (setW(Number(e.target.value)), setPreset('custom'))} />
          </label>
          <label className="sl-field">
            <span>{t('Alto (cm)')}</span>
            <input type="number" step="0.01" value={h} onChange={(e) => (setH(Number(e.target.value)), setPreset('custom'))} />
          </label>
          <label className="sl-field">
            <span>{t('Numerar desde')}</span>
            <input type="number" min={0} value={first} onChange={(e) => setFirst(Math.max(0, Math.round(Number(e.target.value))))} />
          </label>
        </div>
        <fieldset className="sl-fieldset">
          <legend>{t('Al cambiar el tamaño, el contenido (y el tamaño del texto) se…')}</legend>
          {([['fit', 'Ajusta para que quepa todo'], ['max', 'Amplía al máximo'], ['stretch', 'Estira a la nueva forma']] as const).map(([k, l]) => (
            <label key={k} className="sl-check">
              <input type="radio" name="sz-mode" checked={mode === k} onChange={() => setMode(k)} />
              {t(l)}
            </label>
          ))}
        </fieldset>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ show setup

export function SetupShowDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const s0 = c.deck.show;
  const [mode, setMode] = useState<NonNullable<ShowProps['mode']>>(s0.mode ?? 'presenter');
  const [loop, setLoop] = useState(!!s0.loop);
  const [anim, setAnim] = useState(s0.showAnimation !== false);
  const [timings, setTimings] = useState(s0.useTimings !== false);
  const initRange = s0.range && 'show' in s0.range ? 'custom' : s0.range ? 'range' : 'all';
  const [range, setRange] = useState<'all' | 'range' | 'custom'>(initRange);
  const [from, setFrom] = useState(s0.range && 'from' in s0.range ? s0.range.from : 1);
  const [to, setTo] = useState(s0.range && 'from' in s0.range ? s0.range.to : c.deck.slides.length);
  const shows = s0.customShows ?? [];
  const [custom, setCustom] = useState(s0.range && 'show' in s0.range ? s0.range.show : (shows[0]?.name ?? ''));
  const n = c.deck.slides.length;
  const ok = range !== 'range' || (from >= 1 && to >= from && to <= n);
  const apply = () => {
    c.apply('Configurar la presentación', (d) => ({
      ...d,
      show: { ...d.show, mode, loop: mode === 'kiosk' ? true : loop, showAnimation: anim ? undefined : false, useTimings: timings ? undefined : false, range: range === 'range' ? { from, to } : range === 'custom' && custom ? { show: custom } : undefined },
    }));
    onClose();
  };
  return (
    <Modal
      title={t('Configurar la presentación')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!ok} onClick={apply}>{t('Aceptar')}</Button>
        </>
      }
    >
      <div className="sl-form">
        <fieldset className="sl-fieldset">
          <legend>{t('Tipo de presentación')}</legend>
          {([['presenter', 'Presentada por un orador (pantalla completa)'], ['browsed', 'Examinada por una persona (ventana)'], ['kiosk', 'Examinada en pantalla completa (quiosco)']] as const).map(([k, l]) => (
            <label key={k} className="sl-check">
              <input type="radio" name="su-mode" checked={mode === k} onChange={() => setMode(k)} />
              {t(l)}
            </label>
          ))}
        </fieldset>
        <fieldset className="sl-fieldset">
          <legend>{t('Opciones')}</legend>
          <label className="sl-check">
            <input type="checkbox" checked={loop || mode === 'kiosk'} disabled={mode === 'kiosk'} onChange={(e) => setLoop(e.target.checked)} />
            {t('Repetir hasta presionar Esc')}
          </label>
          <label className="sl-check">
            <input type="checkbox" checked={anim} onChange={(e) => setAnim(e.target.checked)} />
            {t('Mostrar con animación')}
          </label>
          <label className="sl-check">
            <input type="checkbox" checked={timings} onChange={(e) => setTimings(e.target.checked)} />
            {t('Usar los intervalos guardados')}
          </label>
        </fieldset>
        <fieldset className="sl-fieldset">
          <legend>{t('Diapositivas')}</legend>
          <label className="sl-check">
            <input type="radio" name="su-range" checked={range === 'all'} onChange={() => setRange('all')} />
            {t('Todas')}
          </label>
          <label className="sl-check">
            <input type="radio" name="su-range" checked={range === 'range'} onChange={() => setRange('range')} />
            {t('Desde')}
            <input type="number" min={1} max={n} value={from} disabled={range !== 'range'} aria-label={t('Desde la diapositiva')} onChange={(e) => setFrom(Number(e.target.value))} style={{ width: 60 }} />
            {t('hasta')}
            <input type="number" min={1} max={n} value={to} disabled={range !== 'range'} aria-label={t('Hasta la diapositiva')} onChange={(e) => setTo(Number(e.target.value))} style={{ width: 60 }} />
          </label>
          <label className="sl-check">
            <input type="radio" name="su-range" checked={range === 'custom'} disabled={!shows.length} onChange={() => setRange('custom')} />
            {t('Presentación personalizada')}
            <select value={custom} disabled={range !== 'custom'} onChange={(e) => setCustom(e.target.value)} aria-label={t('Presentación personalizada')}>
              {shows.map((x) => (
                <option key={x.name}>{x.name}</option>
              ))}
            </select>
          </label>
        </fieldset>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ custom shows

const titleOf = (deck: Deck, i: number) => {
  const s = deck.slides[i]!;
  for (const e of s.shapes) if (e.kind === 'shape' && e.ph && (e.ph.type === 'title' || e.ph.type === 'ctrTitle') && e.text) return docNode(e.text.doc).textContent.slice(0, 40);
  return t('(sin título)');
};

export function CustomShowsDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const [shows, setShows] = useState(() => (c.deck.show.customShows ?? []).map((x) => ({ ...x, slideIds: [...x.slideIds] })));
  const [sel, setSel] = useState(0);
  const cur = shows[sel];
  const patch = (fn: (s: NonNullable<typeof cur>) => NonNullable<typeof cur>) => setShows((l) => l.map((x, i) => (i === sel ? fn(x) : x)));
  const dup = !!cur && shows.some((x, i) => i !== sel && x.name === cur.name);
  const ok = shows.every((x) => x.name.trim()) && !shows.some((x, i) => shows.findIndex((y) => y.name === x.name) !== i);
  const save = (then?: () => void) => {
    c.apply('Presentaciones personalizadas', (d) => {
      const names = new Set(shows.map((x) => x.name));
      const range = d.show.range && 'show' in d.show.range && !names.has(d.show.range.show) ? undefined : d.show.range;
      return { ...d, show: { ...d.show, customShows: shows.length ? shows : undefined, range } };
    });
    onClose();
    then?.();
  };
  const inShow = new Set(cur?.slideIds);
  return (
    <Modal
      wide
      title={t('Presentaciones personalizadas')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button disabled={!ok || !cur?.slideIds.length} onClick={() => save(() => ui.present('start', { show: cur!.name }))}>{t('Guardar y presentar')}</Button>
          <Button appearance="primary" disabled={!ok} onClick={() => save()}>{t('Aceptar')}</Button>
        </>
      }
    >
      <div className="sl-form">
        <div className="sl-form__row">
          <label className="sl-field">
            <span>{t('Presentación')}</span>
            <select value={cur ? sel : ''} size={4} onChange={(e) => setSel(Number(e.target.value))} aria-label={t('Presentaciones personalizadas')}>
              {shows.map((x, i) => (
                <option key={i} value={i}>{x.name}</option>
              ))}
            </select>
          </label>
          <div className="sl-form__col">
            <Button size="small" onClick={() => (setShows((l) => [...l, { name: t('Presentación {n}', { n: l.length + 1 }), slideIds: [] }]), setSel(shows.length))}>{t('Nueva')}</Button>
            <Button size="small" disabled={!cur} onClick={() => (setShows((l) => l.filter((_, i) => i !== sel)), setSel(0))}>{t('Quitar')}</Button>
          </div>
        </div>
        {cur && (
          <>
            <label className="sl-field">
              <span>{t('Nombre')}</span>
              <input value={cur.name} aria-invalid={dup} onChange={(e) => patch((s) => ({ ...s, name: e.target.value }))} />
            </label>
            {dup && <p role="alert" className="sl-pane__empty">{t('Ya hay una presentación con ese nombre.')}</p>}
            <div className="sl-form__row">
              <div className="sl-field">
                <span>{t('Diapositivas de la presentación')}</span>
                <div className="sl-pick" role="listbox" aria-label={t('Diapositivas')}>
                  {c.deck.slides.map((s, i) => (
                    <label key={s.id} className="sl-check">
                      <input type="checkbox" checked={inShow.has(s.id)} onChange={(e) => patch((x) => ({ ...x, slideIds: e.target.checked ? [...x.slideIds, s.id] : x.slideIds.filter((id) => id !== s.id) }))} />
                      {i + 1}. {titleOf(c.deck, i)}
                    </label>
                  ))}
                </div>
              </div>
              <div className="sl-field">
                <span>{t('Orden')}</span>
                <ol className="sl-pick sl-pick--order" aria-label={t('Orden de las diapositivas')}>
                  {cur.slideIds.map((id, k) => {
                    const i = c.deck.slides.findIndex((s) => s.id === id);
                    if (i < 0) return null;
                    const move = (d: -1 | 1) =>
                      patch((x) => {
                        const ids = [...x.slideIds];
                        const j = k + d;
                        if (j < 0 || j >= ids.length) return x;
                        [ids[k], ids[j]] = [ids[j]!, ids[k]!];
                        return { ...x, slideIds: ids };
                      });
                    return (
                      <li key={id}>
                        <span>{i + 1}. {titleOf(c.deck, i)}</span>
                        <button type="button" aria-label={t('Subir')} disabled={k === 0} onClick={() => move(-1)}>↑</button>
                        <button type="button" aria-label={t('Bajar')} disabled={k === cur.slideIds.length - 1} onClick={() => move(1)}>↓</button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ find and replace

export function FindReplaceDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const [q, setQ] = useState('');
  const [r, setR] = useState('');
  const [o, setO] = useState<FindOptions>({});
  const [i, setI] = useState(-1);
  const [msg, setMsg] = useState('');
  const hits = useMemo(() => findAll(c.deck, q, o), [c.deck, q, o]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (k: number) => {
    const h = hits[k];
    if (!h) return;
    setI(k);
    c.goTo(h.slideIndex);
    c.select(h.elementId ? [h.elementId] : []);
    if (!h.elementId && !c.showNotes) ((c.showNotes = true), c.touch());
  };
  useEffect(() => setI(-1), [q, o]);
  const next = () => {
    if (!hits.length) return setMsg(q ? t('No se encontró «{q}».', { q }) : '');
    setMsg('');
    go((i + 1) % hits.length);
  };
  const replaceOne = () => {
    const h = hits[i < 0 ? 0 : i];
    if (!h) return setMsg(t('No se encontró «{q}».', { q }));
    const res = replaceAll(c.deck, q, r, o, { slideId: h.slideId, elementId: h.elementId });
    if (res.count) c.apply('Reemplazar', () => res.deck);
    setMsg(t('Reemplazadas: {n}', { n: res.count }));
    setI((k) => Math.max(-1, k - 1));
  };
  const replaceEvery = () => {
    const res = replaceAll(c.deck, q, r, o);
    if (res.count) c.apply('Reemplazar todo', () => res.deck);
    setMsg(res.count ? t('Reemplazadas: {n}', { n: res.count }) : t('No se encontró «{q}».', { q }));
    setI(-1);
  };
  const h = hits[i];
  return (
    <Modal title={t('Buscar y reemplazar')} onClose={onClose}>
      <form className="sl-form" onSubmit={(e) => (e.preventDefault(), next())}>
        <label className="sl-field">
          <span>{t('Buscar')}</span>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Buscar')} />
        </label>
        <label className="sl-field">
          <span>{t('Reemplazar con')}</span>
          <input value={r} onChange={(e) => setR(e.target.value)} aria-label={t('Reemplazar con')} />
        </label>
        <div className="sl-form__row">
          <label className="sl-check">
            <input type="checkbox" checked={!!o.matchCase} onChange={(e) => setO({ ...o, matchCase: e.target.checked })} />
            {t('Coincidir mayúsculas y minúsculas')}
          </label>
          <label className="sl-check">
            <input type="checkbox" checked={!!o.wholeWord} onChange={(e) => setO({ ...o, wholeWord: e.target.checked })} />
            {t('Solo palabras completas')}
          </label>
          <label className="sl-check">
            <input type="checkbox" checked={!!o.notes} onChange={(e) => setO({ ...o, notes: e.target.checked })} />
            {t('Incluir las notas')}
          </label>
        </div>
        <div className="sl-form__row">
          <Button appearance="primary" type="submit" disabled={!q}>{t('Buscar siguiente')}</Button>
          <Button disabled={!q} onClick={replaceOne}>{t('Reemplazar')}</Button>
          <Button disabled={!q} onClick={replaceEvery}>{t('Reemplazar todas')}</Button>
        </div>
        <p role="status" aria-live="polite" className="sl-pane__empty">
          {msg || (q ? (h ? t('Coincidencia {i} de {n} · diapositiva {s}: {ctx}', { i: i + 1, n: hits.length, s: h.slideIndex + 1, ctx: h.context.slice(0, 80) }) : t('{n} coincidencias', { n: hits.length })) : '')}
        </p>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ new comment

export function CommentDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const [author, setAuthor] = useState(savedAuthor(c));
  const [text, setText] = useState('');
  const ok = !!text.trim() && !!author.trim();
  const save = () => {
    rememberAuthor(author.trim());
    addComment(c, text.trim(), author.trim());
    c.pane = 'comments';
    c.touch();
    onClose();
  };
  return (
    <Modal
      title={t('Comentario nuevo')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!ok} onClick={save}>{t('Publicar')}</Button>
        </>
      }
    >
      <div className="sl-form">
        <label className="sl-field">
          <span>{t('Su nombre')}</span>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} aria-label={t('Su nombre')} />
        </label>
        <label className="sl-field">
          <span>{t('Comentario')}</span>
          <textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} aria-label={t('Comentario')} />
        </label>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ sections

export function SectionsDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const [name, setName] = useState(t('Sección sin título'));
  const startsHere = c.deck.sections.some((s) => s.slideIds[0] === c.slide.id) || (c.index === 0 && c.deck.sections.length === 0 && false);
  const cantAdd = c.deck.sections.length > 0 && startsHere;
  const secs = c.deck.sections;
  return (
    <Modal title={t('Secciones')} onClose={onClose}>
      <div className="sl-form">
        <div className="sl-form__row">
          <label className="sl-field">
            <span>{t('Nombre de la sección nueva')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label={t('Nombre de la sección nueva')} />
          </label>
          <Button disabled={!name.trim() || cantAdd} onClick={() => c.apply('Agregar sección', (d) => addSection(d, c.slide.id, name.trim()))}>{t('Agregar antes de la diapositiva {n}', { n: c.index + 1 })}</Button>
        </div>
        {cantAdd && <p className="sl-pane__empty">{t('La diapositiva actual ya empieza una sección.')}</p>}
        {!secs.length && <p className="sl-pane__empty">{t('La presentación no tiene secciones.')}</p>}
        <ol className="sl-pick sl-pick--order" aria-label={t('Secciones')}>
          {secs.map((s, i) => (
            <li key={s.id}>
              <input aria-label={t('Nombre de la sección {n}', { n: i + 1 })} defaultValue={s.name} onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && c.apply('Cambiar nombre de la sección', (d) => renameSection(d, s.id, e.target.value.trim()))} />
              <small>({s.slideIds.length})</small>
              <button type="button" aria-label={t('Subir la sección')} disabled={i === 0} onClick={() => c.apply('Mover la sección', (d) => moveSection(d, s.id, -1))}>↑</button>
              <button type="button" aria-label={t('Bajar la sección')} disabled={i === secs.length - 1} onClick={() => c.apply('Mover la sección', (d) => moveSection(d, s.id, 1))}>↓</button>
              <button type="button" onClick={() => c.apply('Quitar la sección', (d) => removeSection(d, s.id, false))}>{t('Quitar')}</button>
              <button type="button" disabled={s.slideIds.length >= c.deck.slides.length} onClick={() => window.confirm(t('¿Eliminar la sección y sus {n} diapositivas?', { n: s.slideIds.length })) && c.apply('Quitar la sección y sus diapositivas', (d) => removeSection(d, s.id, true))}>{t('Quitar con diapositivas')}</button>
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ spelling

interface Err {
  slideId: string;
  slideIndex: number;
  elementId: string | null;
  word: string;
  context: string;
}

function collect(deck: Deck, engine: SpellEngine, skipped: Set<string>): Err[] {
  const out: Err[] = [];
  for (const t of eachText(deck, true)) {
    docNode(t.body.doc).forEach((para) => {
      let text = '';
      para.forEach((n) => (text += n.type.name === 'text' ? n.text! : ' '));
      for (const w of findWords(text)) {
        if (skipWord(text, w) || engine.isCorrect(w.word)) continue;
        if (skipped.has(`${t.elementId}|${w.word}`)) continue;
        out.push({ slideId: t.slideId, slideIndex: t.slideIndex, elementId: t.elementId, word: w.word, context: text.trim() });
      }
    });
  }
  return out;
}

export function SpellingDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const [lang, setLang] = useState<SpellLang>(() => {
    try {
      return (localStorage.getItem('nova.writer.spellLangLast') as SpellLang | null) ?? 'es';
    } catch {
      return 'es';
    }
  });
  const [engine, setEngine] = useState<SpellEngine | null>(null);
  const [failed, setFailed] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [sug, setSug] = useState('');
  useEffect(() => {
    setEngine(null);
    setFailed(false);
    loadSpeller(lang).then(setEngine, () => setFailed(true));
  }, [lang]);
  const errors = useMemo(() => (engine ? collect(c.deck, engine, skipped) : []), [engine, c.deck, skipped]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = errors[0];
  const suggestions = useMemo(() => (engine && e ? engine.suggest(e.word) : []), [engine, e?.word]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSug(suggestions[0] ?? '');
    if (e) {
      c.goTo(e.slideIndex);
      c.select(e.elementId ? [e.elementId] : []);
    }
  }, [e?.slideId, e?.elementId, e?.word]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (every: boolean) => {
    if (!e || !sug) return;
    const res = replaceAll(c.deck, e.word, sug, { matchCase: true, wholeWord: true, notes: true }, every ? undefined : { slideId: e.slideId, elementId: e.elementId });
    if (res.count) c.apply('Corregir ortografía', () => res.deck);
    else setSkipped((s) => new Set(s).add(`${e.elementId}|${e.word}`));
  };
  const key = (x: Err) => `${x.elementId}|${x.word}`;
  const ignoreAll = () => {
    if (!e || !engine) return;
    engine.ignore(e.word);
    setSkipped((s) => new Set(s));
  };
  return (
    <Modal
      title={t('Ortografía')}
      onClose={onClose}
      actions={<Button appearance="primary" onClick={onClose}>{t('Cerrar')}</Button>}
    >
      <div className="sl-form">
        <label className="sl-field">
          <span>{t('Idioma del diccionario')}</span>
          <select value={lang} onChange={(ev) => setLang(ev.target.value as SpellLang)} aria-label={t('Idioma del diccionario')}>
            {SPELL_LANGS.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>
        {failed && <p role="alert">{t('No se pudo cargar el diccionario.')}</p>}
        {!engine && !failed && <p role="status">{t('Cargando el diccionario…')}</p>}
        {engine && !e && <p role="status" data-testid="spell-done">{t('La revisión ortográfica ha terminado.')}</p>}
        {engine && e && (
          <>
            <p className="sl-spell__ctx">
              {t('Diapositiva {n}:', { n: e.slideIndex + 1 })} <mark data-testid="spell-word">{e.word}</mark>
              <br />
              <small>{e.context.slice(0, 140)}</small>
            </p>
            <label className="sl-field">
              <span>{t('Cambiar por')}</span>
              <input value={sug} onChange={(ev) => setSug(ev.target.value)} aria-label={t('Cambiar por')} />
            </label>
            <div className="sl-pick" role="listbox" aria-label={t('Sugerencias')}>
              {suggestions.length ? (
                suggestions.map((s) => (
                  <button key={s} type="button" role="option" aria-selected={sug === s} className={sug === s ? 'is-sel' : ''} onClick={() => setSug(s)}>{s}</button>
                ))
              ) : (
                <i>{t('(sin sugerencias)')}</i>
              )}
            </div>
            <div className="sl-form__row">
              <Button onClick={() => setSkipped((s) => new Set(s).add(key(e)))}>{t('Omitir')}</Button>
              <Button onClick={ignoreAll}>{t('Omitir todas')}</Button>
              <Button disabled={!sug} onClick={() => change(false)}>{t('Cambiar')}</Button>
              <Button disabled={!sug} onClick={() => change(true)}>{t('Cambiar todas')}</Button>
              <Button onClick={() => (addToUserDictionary(engine, e.word), setSkipped((s) => new Set(s)))}>{t('Agregar al diccionario')}</Button>
            </div>
            <small>{t('Faltan {n} palabras por revisar.', { n: errors.length })}</small>
          </>
        )}
      </div>
    </Modal>
  );
}
