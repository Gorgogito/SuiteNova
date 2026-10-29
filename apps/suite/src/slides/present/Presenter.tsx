import { t } from '@suitenova/core-ui';
import { docText, type Deck } from '@suitenova/slides-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AssetUrls } from '../render/assets';
import { SlideCanvas } from '../render/SlideCanvas';
import { clickGroups, clickCount, initiallyHidden, Show, type ShowMessage, type ShowSettings, type ShowState } from './engine';
import { channelName } from './Present';

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The speaker's window: current slide, the next one, notes and a clock. It only mirrors the show that runs in the other window. */
export function PresenterWindow({ session }: { session: string }) {
  const [data, setData] = useState<{ deck: Deck; settings: ShowSettings } | null>(null);
  const [state, setState] = useState<ShowState | null>(null);
  const [gone, setGone] = useState(false);
  const [fontSize, setFontSize] = useState(20);
  const chan = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const ch = new BroadcastChannel(channelName(session));
    chan.current = ch;
    ch.onmessage = (ev: MessageEvent<ShowMessage>) => {
      const m = ev.data;
      if (m.type === 'deck') {
        setData({ deck: m.deck, settings: m.settings });
        setGone(false);
      } else if (m.type === 'state') setState(m.state);
      else if (m.type === 'bye') setGone(true);
    };
    ch.postMessage({ type: 'hello', from: 'presenter' } satisfies ShowMessage);
    return () => ch.close();
  }, [session]);

  const send = (cmd: Extract<ShowMessage, { type: 'cmd' }>['cmd'], arg?: number | string) => chan.current?.postMessage({ type: 'cmd', cmd, arg } satisfies ShowMessage);

  const urls = useMemo(() => (data ? new AssetUrls(() => data.deck) : null), [data]);
  const show = useMemo(() => (data ? new Show(data.deck, data.settings) : null), [data]);

  // local clock between messages
  const [now, setNow] = useState(Date.now());
  const stamp = useRef(0);
  useEffect(() => {
    stamp.current = Date.now();
  }, [state]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const keys = (e: React.KeyboardEvent) => {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) (e.preventDefault(), send('next'));
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) (e.preventDefault(), send('prev'));
    else if (e.key === 'Home') send('first');
    else if (e.key === 'End') send('last');
    else if (e.key === 'b' || e.key === 'B') send('blank', 'black');
    else if (e.key === 'w' || e.key === 'W') send('blank', 'white');
    else if (e.key === 'Escape') send('end');
  };

  if (!data || !state || !show || !urls) {
    return (
      <div className="sl-presenter sl-presenter--wait" role="status">
        {t('Esperando a la presentación… Inicie la vista de moderador desde la ventana de la presentación.')}
      </div>
    );
  }
  const { deck } = data;
  const order = show.order;
  const idx = order[state.pos]!;
  const slide = deck.slides[idx]!;
  const total = clickCount(slide);
  // what comes next: another build of this slide, or the next slide
  const nextSlideIdx = order[state.pos + 1] ?? (data.settings.loop ? order[0] : undefined);
  const nextIsBuild = state.build < total;
  const upcoming = nextIsBuild ? { index: idx, build: state.build + 1 } : nextSlideIdx !== undefined ? { index: nextSlideIdx, build: 0 } : null;
  const elapsed = state.elapsed + (now - stamp.current);
  const onSlide = state.slideElapsed + (now - stamp.current);
  const notes = slide.notes ? docText(slide.notes.doc) : '';
  const groups = clickGroups(slide);

  return (
    <div className="sl-presenter" tabIndex={0} onKeyDown={keys} ref={(el) => el?.focus()} aria-label={t('Vista de moderador')}>
      <div className="sl-presenter__main">
        <div className="sl-presenter__label">{t('Diapositiva actual')} · {state.pos + 1} / {order.length}{total ? ` · ${t('animación {a} de {b}', { a: state.build, b: total })}` : ''}</div>
        <Mini deck={deck} index={idx} build={state.build} urls={urls} width={640} testid="pv-current" />
      </div>
      <div className="sl-presenter__side">
        <div className="sl-presenter__clock" role="timer" aria-label={t('Tiempo transcurrido')}>
          <b data-testid="pv-elapsed">{fmt(elapsed)}</b>
          <span>{t('en esta diapositiva')}: {fmt(onSlide)}</span>
        </div>
        <div className="sl-presenter__label">{upcoming ? (nextIsBuild ? t('Siguiente animación') : t('Siguiente diapositiva')) : t('Fin de la presentación')}</div>
        {upcoming ? <Mini deck={deck} index={upcoming.index} build={upcoming.build} urls={urls} width={320} testid="pv-next" /> : <div className="sl-presenter__end">{t('No hay más diapositivas')}</div>}
        <div className="sl-presenter__buttons">
          <button type="button" onClick={() => send('prev')}>{t('Anterior')}</button>
          <button type="button" onClick={() => send('next')}>{t('Siguiente')}</button>
          <button type="button" onClick={() => send('blank', 'black')}>{t('Negro')}</button>
          <button type="button" onClick={() => send('blank', 'white')}>{t('Blanco')}</button>
          <button type="button" onClick={() => send('end')}>{t('Terminar')}</button>
        </div>
        <label className="sl-presenter__jump">
          {t('Ir a')}
          <select value={state.pos} onChange={(e) => send('goto', Number(e.target.value))} aria-label={t('Ir a la diapositiva')}>
            {order.map((di, p) => (
              <option key={p} value={p}>{p + 1}. {titleOf(deck, di)}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="sl-presenter__notes">
        <div className="sl-presenter__label">
          {t('Notas')}
          <span className="sl-presenter__zoom">
            <button type="button" aria-label={t('Reducir el texto')} onClick={() => setFontSize((s) => Math.max(12, s - 2))}>A−</button>
            <button type="button" aria-label={t('Aumentar el texto')} onClick={() => setFontSize((s) => Math.min(48, s + 2))}>A+</button>
          </span>
        </div>
        <div className="sl-presenter__text" style={{ fontSize }} data-testid="pv-notes">{notes || <i>{t('Esta diapositiva no tiene notas.')}</i>}</div>
      </div>
      {gone && <div className="sl-presenter__bye" role="alert">{t('La presentación ha terminado. Puede cerrar esta ventana.')}</div>}
      <span hidden>{groups.length}</span>
    </div>
  );
}

const titleOf = (deck: Deck, i: number): string => {
  const s = deck.slides[i]!;
  for (const e of s.shapes) if (e.kind === 'shape' && e.ph && (e.ph.type === 'title' || e.ph.type === 'ctrTitle') && e.text) return docText(e.text.doc).slice(0, 40);
  return t('(sin título)');
};

/** A slide drawn at a width, with the objects that have not appeared yet (at that build) left out. */
function Mini({ deck, index, build, urls, width, testid }: { deck: Deck; index: number; build: number; urls: AssetUrls; width: number; testid: string }) {
  const slide = deck.slides[index]!;
  const k = width / deck.size.w;
  const hidden = useMemo(() => initiallyHidden(slide, build), [slide, build]);
  return (
    <div className="sl-presenter__slide" data-testid={testid} style={{ width, height: deck.size.h * k }}>
      <div style={{ transform: `scale(${k})`, transformOrigin: '0 0', width: deck.size.w, height: deck.size.h, position: 'relative' }}>
        {hidden.size > 0 && <style>{[...hidden].map((id) => `[data-testid="${testid}"] [data-id="${CSS.escape(id)}"]{visibility:hidden}`).join('')}</style>}
        <SlideCanvas deck={deck} slide={slide} urls={urls} slideNumber={index + 1} mode="thumb" prompts={false} />
      </div>
    </div>
  );
}
