import { t } from '@suitenova/core-ui';
import type { Deck, Hyperlink, Slide } from '@suitenova/slides-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SlidesCtl } from '../ctl';
import { SlideCanvas } from '../render/SlideCanvas';
import { clickGroups, initiallyHidden, Show, timeline, type ShowMessage, type ShowSettings } from './engine';
import { playEffect, playTransition, setVisible, targetsOf, transitionMs } from './fx';

export interface PresentRequest {
  from: 'start' | 'current';
  presenter?: boolean;
  rehearse?: boolean;
  /** run on a window that is not the editor (the audience side of a two-window show) */
  session?: string;
  /** play only the transition into the current slide, or only its animations, and close */
  preview?: 'transition' | 'animation';
  /** name of the custom show to present */
  show?: string;
}

export const channelName = (id: string) => `nova-slides-${id}`;

export function settingsOf(deck: Deck, rehearse?: boolean, showName?: string): ShowSettings {
  const s = deck.show;
  const name = showName ?? (s.range && 'show' in s.range ? s.range.show : undefined);
  const custom = name ? s.customShows?.find((c) => c.name === name) : undefined;
  return { loop: s.loop || s.mode === 'kiosk', mode: s.mode, useTimings: rehearse ? false : s.useTimings !== false, range: s.range && 'from' in s.range ? s.range : undefined, customShow: custom?.slideIds };
}

type Tool = 'arrow' | 'pen' | 'highlighter' | 'laser';
interface Stroke {
  pts: number[];
  color: string;
  w: number;
  hl?: boolean;
}

function useShow(show: Show): number {
  const [, set] = useState(0);
  useEffect(() => show.subscribe(() => set((n) => n + 1)), [show]);
  return 0;
}

const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Full-screen presentation (the audience side). */
export function Present({ ctl, request, onClose }: { ctl: SlidesCtl; request: PresentRequest; onClose: () => void }) {
  // the show works on a copy: without animation the objects are simply there
  const deck = useMemo(() => (ctl.realDeck.show.showAnimation === false && !request.preview ? { ...ctl.realDeck, slides: ctl.realDeck.slides.map((s) => (s.timing ? { ...s, timing: undefined } : s)) } : ctl.realDeck), []); // eslint-disable-line react-hooks/exhaustive-deps
  const settings = useMemo(() => settingsOf(deck, request.rehearse, request.show), [deck, request.rehearse, request.show]);
  const kiosk = settings.mode === 'kiosk' && !request.preview;
  const show = useMemo(() => new Show(deck, settings, request.preview === 'transition' ? Math.max(0, ctl.index - 1) : request.from === 'current' ? ctl.index : 0), []); // eslint-disable-line react-hooks/exhaustive-deps
  useShow(show);
  const root = useRef<HTMLDivElement>(null);
  const layerA = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [tool, setTool] = useState<Tool>('arrow');
  const [ink, setInk] = useState<Map<number, Stroke[]>>(new Map());
  const [live, setLive] = useState<Stroke | null>(null);
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null);
  const [bar, setBar] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [jump, setJump] = useState('');
  const [rehearsal, setRehearsal] = useState<{ done: boolean } | null>(request.rehearse ? { done: false } : null);
  const barTimer = useRef<number | null>(null);
  const busy = useRef(false);
  const chan = useRef<BroadcastChannel | null>(null);

  // ---- state of the slide on screen: a layer per slide so that a transition can show both
  const [layers, setLayers] = useState<{ pos: number; key: number }[]>([{ pos: show.state.pos, key: 0 }]);
  const keyRef = useRef(0);
  const shownPos = useRef(show.state.pos);
  const shownBuild = useRef(0);

  const slideAt = (pos: number): Slide => deck.slides[show.order[pos]!]!;

  // ---- fit to the screen, fullscreen
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.focus();
    const measure = () => setScale(Math.min(window.innerWidth / deck.size.w, window.innerHeight / deck.size.h));
    measure();
    window.addEventListener('resize', measure);
    if (!request.preview && settings.mode !== 'browsed') void el.requestFullscreen?.().catch(() => undefined);
    const onFs = () => {
      if (!document.fullscreenElement) onCloseRef.current();
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('resize', measure);
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [deck.size.w, deck.size.h, request.session]);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // ---- preview from the ribbon: runs by itself and closes
  useEffect(() => {
    if (!request.preview) return;
    let stop = false;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      await wait(700);
      if (request.preview === 'transition') {
        if (show.slideIndex !== ctl.index) show.advanceSlide();
        await wait(transitionMs(slideAt(show.state.pos).transition ?? { type: 'none' }) + 1200);
      } else {
        let guard = 0;
        while (!stop && show.state.build < show.clicks && guard++ < 200) {
          show.next();
          await wait(1100);
        }
        await wait(900);
      }
      if (!stop) onCloseRef.current();
    })();
    return () => {
      stop = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- links
  const follow = useCallback(
    (h: Hyperlink) => {
      if (h.url) window.open(h.url, '_blank', 'noopener');
      else if (h.slide === 'next') show.next();
      else if (h.slide === 'prev') show.prev();
      else if (h.slide === 'first') show.goPos(0);
      else if (h.slide === 'last') show.goPos(show.order.length - 1);
      else if (h.slide === 'end') end();
      else if (h.slide) {
        const i = deck.slides.findIndex((s) => s.id === h.slide);
        if (i >= 0) show.goToSlide(i);
      }
    },
    [deck, show], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const end = useCallback(() => {
    show.recordTime();
    chan.current?.postMessage({ type: 'bye' } satisfies ShowMessage);
    if (rehearsal && !rehearsal.done && show.times.size) {
      setRehearsal({ done: true });
      return;
    }
    onCloseRef.current();
  }, [show, rehearsal]);

  // ---- react to the show state: slide changes (transition), builds (animations)
  const state = show.state;
  useEffect(() => {
    const cur = show.state;
    const slide = slideAt(cur.pos);
    const groups = clickGroups(slide);
    const rootEl = layerA.current;
    const run = async () => {
      if (cur.pos !== shownPos.current) {
        // a new slide: mount it over the old one and play the transition
        const key = ++keyRef.current;
        const oldPos = shownPos.current;
        shownPos.current = cur.pos;
        shownBuild.current = 0;
        busy.current = true;
        setLayers([{ pos: oldPos, key: keyRef.current - 1 }, { pos: cur.pos, key }]);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const holder = root.current;
        const nodes = holder?.querySelectorAll<HTMLElement>('.sl-layer');
        if (nodes && nodes.length >= 2) {
          const [o, n] = [nodes[0]!, nodes[nodes.length - 1]!];
          const tr = slide.transition;
          await playTransition(o, n, tr);
        }
        setLayers([{ pos: cur.pos, key }]);
        await new Promise((r) => requestAnimationFrame(r));
        busy.current = false;
        // the automatic effects at the start of the slide
        await playGroup(layerRoot(), groups[0] ?? []);
        if (cur.build > 0) for (let b = 1; b <= cur.build; b++) await playGroup(layerRoot(), groups[b] ?? []);
        shownBuild.current = cur.build;
        scheduleAdvance(slide);
      } else if (cur.build > shownBuild.current) {
        for (let b = shownBuild.current + 1; b <= cur.build; b++) await playGroup(layerRoot(), groups[b] ?? []);
        shownBuild.current = cur.build;
        scheduleAdvance(slide);
      } else if (cur.build < shownBuild.current) {
        // going back: draw the slide again at that step
        const key = ++keyRef.current;
        shownBuild.current = cur.build;
        setLayers([{ pos: cur.pos, key }]);
      }
    };
    void run();
    void rootEl;
  }, [state.pos, state.build]); // eslint-disable-line react-hooks/exhaustive-deps

  const layerRoot = (): HTMLElement => {
    const nodes = root.current?.querySelectorAll<HTMLElement>('.sl-layer');
    return nodes ? nodes[nodes.length - 1]! : (root.current as HTMLElement);
  };

  const playGroup = async (rootEl: HTMLElement, group: ReturnType<typeof clickGroups>[number]) => {
    if (!group.length) return;
    const tl = timeline(group);
    await Promise.all(tl.map(({ e, start, dur }) => playEffect(rootEl, e, start, dur)));
  };

  // ---- automatic advance (rehearsed or set timings)
  const advTimer = useRef<number | null>(null);
  const scheduleAdvance = (slide: Slide) => {
    if (advTimer.current) clearTimeout(advTimer.current);
    advTimer.current = null;
    const tr = slide.transition;
    if (!settings.useTimings || tr?.advTm === undefined) return;
    const gate = () => {
      if (busy.current) advTimer.current = window.setTimeout(gate, 200);
      else if (!show.next()) end();
    };
    advTimer.current = window.setTimeout(gate, tr.advTm);
  };
  useEffect(
    () => () => {
      if (advTimer.current) clearTimeout(advTimer.current);
    },
    [],
  );

  // ---- two-window shows
  useEffect(() => {
    if (!request.session) return;
    const ch = new BroadcastChannel(channelName(request.session));
    chan.current = ch;
    ch.onmessage = (ev: MessageEvent<ShowMessage>) => {
      const m = ev.data;
      if (m.type === 'hello' && m.from === 'presenter') ch.postMessage({ type: 'deck', deck, settings, startPos: show.state.pos } satisfies ShowMessage);
      else if (m.type === 'cmd') {
        if (m.cmd === 'next') next();
        else if (m.cmd === 'prev') show.prev();
        else if (m.cmd === 'first') show.goPos(0);
        else if (m.cmd === 'last') show.goPos(show.order.length - 1);
        else if (m.cmd === 'goto') show.goPos(Number(m.arg));
        else if (m.cmd === 'blank') show.blank((m.arg as 'black' | 'white') ?? 'black');
        else if (m.cmd === 'end') end();
      }
    };
    ch.postMessage({ type: 'deck', deck, settings, startPos: show.state.pos } satisfies ShowMessage);
    return () => {
      ch.close();
      chan.current = null;
    };
  }, [request.session]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    show.tick();
    chan.current?.postMessage({ type: 'state', state: show.state } satisfies ShowMessage);
  }, [state.pos, state.build, state.blank]);
  useEffect(() => {
    const id = window.setInterval(() => {
      show.tick();
      chan.current?.postMessage({ type: 'state', state: show.state } satisfies ShowMessage);
      setClock((c) => c + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [show]);
  const [, setClock] = useState(0);

  const next = useCallback(() => {
    if (busy.current) return;
    if (!show.next()) end();
  }, [show, end]);

  // ---- keyboard, mouse, pen
  const goNumber = () => {
    const n = Number(jump);
    setJump('');
    if (n >= 1 && n <= deck.slides.length) show.goToSlide(n - 1);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (rehearsal?.done) return;
    if (kiosk) return void (e.key === 'Escape' && end());
    if (/^\d$/.test(e.key)) return void setJump(jump + e.key);
    if (e.key === 'Enter' && jump) return void (e.preventDefault(), goNumber());
    const k = e.key;
    if (k === 'Escape') {
      if (menu) setMenu(null);
      else if (tool !== 'arrow') setTool('arrow');
      else end();
    } else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(k)) (e.preventDefault(), next());
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k) && !(e.ctrlKey && (k === 'p' || k === 'P'))) (e.preventDefault(), show.prev());
    else if (k === 'Home') show.goPos(0);
    else if (k === 'End') show.goPos(show.order.length - 1);
    else if (k === 'b' || k === 'B' || k === '.') show.blank('black');
    else if (k === 'w' || k === 'W' || k === ',') show.blank('white');
    else if (e.ctrlKey && (k === 'p' || k === 'P')) (e.preventDefault(), setTool('pen'));
    else if (e.ctrlKey && (k === 'i' || k === 'I')) (e.preventDefault(), setTool('highlighter'));
    else if (e.ctrlKey && (k === 'l' || k === 'L')) (e.preventDefault(), setTool('laser'));
    else if (e.ctrlKey && (k === 'a' || k === 'A')) (e.preventDefault(), setTool('arrow'));
    else if (k === 'e' || k === 'E') setInk((m) => new Map(m).set(show.slideIndex, []));
  };
  const toSlide = (e: { clientX: number; clientY: number }) => {
    const r = layerRoot().getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || rehearsal?.done) return;
    if ((e.target as HTMLElement).closest('.sl-showbar, .sl-showmenu, a, video, audio, .sl-rehearse')) return;
    if (tool === 'pen' || tool === 'highlighter') {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const p = toSlide(e);
      setLive({ pts: [p.x, p.y], color: tool === 'pen' ? '#e81123' : '#ffe34d', w: tool === 'pen' ? 3 : 18, hl: tool === 'highlighter' });
      return;
    }
    const link = (e.target as HTMLElement).closest<HTMLElement>('[data-link]');
    if (link) {
      follow(JSON.parse(link.dataset.link!) as Hyperlink);
      return;
    }
    if (tool === 'laser' || kiosk) return;
    // the slide may not accept clicks to advance when it is timed (browsed mode shows a bar instead)
    if (settings.useTimings && slideAt(show.state.pos).transition?.advClick === false) return;
    next();
  };
  const onMove = (e: React.PointerEvent) => {
    setBar(true);
    if (barTimer.current) clearTimeout(barTimer.current);
    barTimer.current = window.setTimeout(() => setBar(false), 2500);
    if (tool === 'laser') setLaser(toSlide(e));
    if (live) {
      const p = toSlide(e);
      setLive({ ...live, pts: [...live.pts, p.x, p.y] });
    }
  };
  const onUp = () => {
    if (live) {
      setInk((m) => new Map(m).set(show.slideIndex, [...(m.get(show.slideIndex) ?? []), live]));
      setLive(null);
    }
  };

  // ---- rehearsal result
  const keepTimings = () => {
    show.recordTime();
    const rec = show.recorded;
    ctl.apply('Guardar los tiempos del ensayo', (d) => ({
      ...d,
      show: { ...d.show, useTimings: true },
      slides: d.slides.map((s, i) => {
        const r = rec.find((x) => x.index === i);
        return r ? { ...s, rehearsed: r.ms, transition: { ...(s.transition ?? { type: 'none' }), advTm: Math.round(r.ms / 100) * 100 } } : s;
      }),
    }));
    onCloseRef.current();
  };

  const cur = layers[layers.length - 1]!;
  const blank = state.blank;
  const strokes = [...(ink.get(show.slideIndex) ?? []), ...(live ? [live] : [])];
  const slidesAhead = show.order.length;

  return (
    <div
      ref={root}
      className="sl-present"
      tabIndex={0}
      role="dialog"
      aria-label={t('Presentación en pantalla completa')}
      onKeyDown={onKey}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{ cursor: tool === 'arrow' && !bar ? 'none' : tool === 'laser' ? 'none' : 'default' }}
    >
      <div style={{ width: deck.size.w * scale, height: deck.size.h * scale, position: 'relative', overflow: 'hidden' }} data-testid="show-stage">
        {layers.map((l) => (
          <div key={l.key} className="sl-layer" data-pos={l.pos} style={{ position: 'absolute', inset: 0 }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0', width: deck.size.w, height: deck.size.h }}>
              <LayerSlide deck={deck} slide={slideAt(l.pos)} index={show.order[l.pos]!} urls={ctl.urls} build={l.key === cur.key ? shownBuildFor(state.build, l.pos, shownPos.current) : 0} prompts={ctl.showPromptsInShow} onLink={follow} />
              <svg className="sl-ink" width={deck.size.w} height={deck.size.h} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
                {l.key === cur.key &&
                  strokes.map((s, i) => (
                    <polyline key={i} points={s.pts.reduce<string[]>((a, v, k) => (k % 2 ? ((a[a.length - 1] += `,${v}`), a) : (a.push(String(v)), a)), []).join(' ')} fill="none" stroke={s.color} strokeWidth={s.w} strokeLinecap="round" strokeLinejoin="round" opacity={s.hl ? 0.45 : 1} />
                  ))}
                {tool === 'laser' && laser && <circle cx={laser.x} cy={laser.y} r={10} fill="rgba(255,0,0,.55)" stroke="#f00" />}
              </svg>
            </div>
          </div>
        ))}
        {blank && <div style={{ position: 'absolute', inset: 0, background: blank === 'black' ? '#000' : '#fff' }} data-testid="show-blank" />}
      </div>
      {jump && <div className="sl-jump">{jump}</div>}
      {rehearsal && !rehearsal.done && <div className="sl-rehearse" role="status">{t('Ensayo: {a} en esta diapositiva · {b} en total', { a: fmtTime(state.slideElapsed), b: fmtTime(state.elapsed) })}</div>}
      {rehearsal?.done && (
        <div className="sl-rehearse sl-rehearse--end" role="alertdialog" aria-label={t('Fin del ensayo')}>
          <p>{t('El ensayo duró {a}. ¿Guardar los tiempos de cada diapositiva?', { a: fmtTime(state.elapsed) })}</p>
          <button type="button" onClick={keepTimings}>{t('Guardar los tiempos')}</button>
          <button type="button" onClick={() => onCloseRef.current()}>{t('No guardar')}</button>
        </div>
      )}
      <div className={`sl-showbar${bar ? ' is-on' : ''}`} role="toolbar" aria-label={t('Controles de la presentación')}>
        <button type="button" aria-label={t('Anterior')} onClick={() => show.prev()}>◀</button>
        <span>{state.pos + 1} / {slidesAhead}</span>
        <button type="button" aria-label={t('Siguiente')} onClick={next}>▶</button>
        <button type="button" aria-pressed={tool === 'pen'} aria-label={t('Lápiz')} onClick={() => setTool(tool === 'pen' ? 'arrow' : 'pen')}>✎</button>
        <button type="button" aria-pressed={tool === 'highlighter'} aria-label={t('Resaltador')} onClick={() => setTool(tool === 'highlighter' ? 'arrow' : 'highlighter')}>▬</button>
        <button type="button" aria-pressed={tool === 'laser'} aria-label={t('Puntero láser')} onClick={() => setTool(tool === 'laser' ? 'arrow' : 'laser')}>●</button>
        <button type="button" aria-label={t('Pantalla en negro')} onClick={() => show.blank('black')}>■</button>
        <button type="button" aria-label={t('Terminar la presentación')} onClick={end}>✕</button>
      </div>
      {menu && (
        <div className="sl-showmenu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => (setMenu(null), next())}>{t('Siguiente')}</button>
          <button type="button" role="menuitem" onClick={() => (setMenu(null), show.prev())}>{t('Anterior')}</button>
          <div className="sl-menutitle">{t('Ir a la diapositiva')}</div>
          <div className="sl-menulist">
            {deck.slides.map((s, i) => (
              <button key={s.id} type="button" role="menuitem" onClick={() => (setMenu(null), show.goToSlide(i))}>{i + 1}. {firstText(s) || t('(sin título)')}</button>
            ))}
          </div>
          <button type="button" role="menuitem" onClick={() => (setMenu(null), show.blank('black'))}>{t('Pantalla en negro')}</button>
          <button type="button" role="menuitem" onClick={() => (setMenu(null), show.blank('white'))}>{t('Pantalla en blanco')}</button>
          <button type="button" role="menuitem" onClick={() => (setMenu(null), end())}>{t('Terminar la presentación')}</button>
        </div>
      )}
    </div>
  );
}

function shownBuildFor(build: number, pos: number, shownPos: number): number {
  return pos === shownPos ? build : 0;
}

export const firstText = (s: Slide): string => {
  for (const e of s.shapes) if (e.kind === 'shape' && e.ph && (e.ph.type === 'title' || e.ph.type === 'ctrTitle')) return JSON.stringify(e.text?.doc ?? '').match(/"text":"([^"]*)"/)?.[1] ?? '';
  return '';
};

/**
 * One slide in the show. Its animated objects start hidden (entrances) and are shown by the player; when it is drawn at a given
 * build (after going back) they are in the state of that step.
 */
function LayerSlide({ deck, slide, index, urls, build, prompts, onLink }: { deck: Deck; slide: Slide; index: number; urls: SlidesCtl['urls']; build: number; prompts: boolean; onLink: (h: Hyperlink) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const hidden = useMemo(() => initiallyHidden(slide, build), [slide, build]);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // paragraph-level effects: hide the paragraphs that have not appeared yet
    const groups = clickGroups(slide);
    groups.forEach((g, gi) => {
      for (const e of g) {
        if (!e.para) continue;
        const nodes = targetsOf(root, e);
        if (e.cls === 'entr') setVisible(nodes, gi <= build);
        else if (e.cls === 'exit') setVisible(nodes, gi > build);
      }
    });
    // media that starts by itself
    root.querySelectorAll<HTMLMediaElement>('video[data-autoplay], audio[data-autoplay]').forEach((m) => void m.play().catch(() => undefined));
  }, [slide, build]);
  return (
    <div ref={ref} style={{ position: 'absolute', left: 0, top: 0 }}>
      {hidden.size > 0 && <style>{[...hidden].map((id) => `[data-id="${CSS.escape(id)}"]{visibility:hidden}`).join('')}</style>}
      <SlideCanvas deck={deck} slide={slide} urls={urls} slideNumber={index + 1} mode="show" prompts={prompts} onLink={onLink} />
    </div>
  );
}

export { transitionMs };
