import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { canHoldBody, newId, outlineOf, outlineTitle, outlineToDeck, type OutlineRow, type Slide } from '@suitenova/slides-core';
import { useLayoutEffect, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { SlidesUI } from './commands';
import { NotesPane } from './NotesPane';
import type { SlidesCtl } from './ctl';
import { Mini } from './Thumbs';

/*
 * The views that are not the editing stage: outline, slide sorter, reading and notes page. They all read the same deck through `ctl`
 * and write it back with the same undo steps as the normal view.
 */

// ------------------------------------------------------------------------------------------------ outline

export function OutlineView({ ui }: { ui: SlidesUI }) {
  const ctl = ui.ctl;
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const deck = ctl.deck;
  const [keep, setKeep] = useState<string | undefined>();
  const rows = useMemo(() => outlineOf(deck, keep), [deck, keep]);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const pending = useRef<{ i: number; caret?: number } | null>(null);
  const numberOf = useMemo(() => new Map(deck.slides.map((s, i) => [s.id, i + 1])), [deck.slides]);
  const slideOf = (sid: string): Slide | undefined => deck.slides.find((s) => s.id === sid);

  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const el = refs.current[p.i];
    el?.focus();
    if (el && p.caret !== undefined) el.setSelectionRange(p.caret, p.caret);
  });

  /** A structural edit (new slide, level change, merge): its own undo step. */
  const write = (next: OutlineRow[], label: string, focus?: { i: number; caret?: number }, keepSid?: string) => {
    pending.current = focus ?? null;
    setKeep(keepSid);
    ctl.endGesture();
    ctl.apply(label, (d) => outlineToDeck(d, next));
  };

  const type = (i: number, text: string) => {
    const next = rows.map((r, k) => (k === i ? { ...r, text } : r));
    ctl.beginGesture('Editar esquema');
    ctl.liveDeck((d) => outlineToDeck(d, next));
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, i: number) => {
    const r = rows[i]!;
    const el = e.currentTarget;
    const pos = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? pos;
    const next = rows.slice();
    const bodyAfter = (from: number, sid: string) => {
      let j = from;
      while (next[j + 1]?.sid === sid && next[j + 1]!.kind === 'body') j++;
      return j;
    };
    if (e.key === 'Enter') {
      e.preventDefault();
      const before = r.text.slice(0, pos);
      const after = r.text.slice(end);
      next[i] = { ...r, text: before };
      if (r.kind === 'title') {
        const j = bodyAfter(i, r.sid);
        next.splice(j + 1, 0, { sid: newId('s'), kind: 'title', lvl: 0, text: after });
        write(next, 'Nueva diapositiva', { i: j + 1, caret: 0 });
      } else {
        next.splice(i + 1, 0, { ...r, text: after });
        write(next, 'Nuevo párrafo', { i: i + 1, caret: 0 });
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (r.kind === 'body') {
        if (!e.shiftKey) {
          next[i] = { ...r, lvl: Math.min(8, r.lvl + 1) };
          write(next, 'Aumentar el nivel', { i, caret: pos });
        } else if (r.lvl > 0) {
          next[i] = { ...r, lvl: r.lvl - 1 };
          write(next, 'Disminuir el nivel', { i, caret: pos });
        } else {
          // a first-level paragraph becomes the title of a new slide that takes the paragraphs after it
          const sid = newId('s');
          const last = bodyAfter(i, r.sid);
          next[i] = { sid, kind: 'title', lvl: 0, text: r.text };
          for (let k = i + 1; k <= last; k++) next[k] = { ...next[k]!, sid };
          write(next, 'Nueva diapositiva', { i, caret: pos });
        }
      } else if (!e.shiftKey) {
        // a title becomes a paragraph of the previous slide
        const at = deck.slides.findIndex((s) => s.id === r.sid);
        const prev = deck.slides[at - 1];
        if (!prev) return;
        if (!canHoldBody(prev)) return ctl.say('La diapositiva anterior no tiene un marcador de posición de contenido.');
        const last = bodyAfter(i, r.sid);
        next[i] = { sid: prev.id, kind: 'body', lvl: 0, text: r.text };
        for (let k = i + 1; k <= last; k++) next[k] = { ...next[k]!, sid: prev.id, lvl: Math.min(8, next[k]!.lvl + 1) };
        write(next, 'Disminuir el nivel', { i, caret: pos }, prev.id);
      }
    } else if (e.key === 'Backspace' && pos === 0 && end === 0) {
      if (r.kind === 'body' && !r.text) {
        e.preventDefault();
        next.splice(i, 1);
        write(next, 'Eliminar párrafo', { i: i - 1, caret: next[i - 1]?.text.length });
      } else if (r.kind === 'body' && rows[i - 1]?.kind === 'body' && rows[i - 1]!.sid === r.sid) {
        e.preventDefault();
        const p = rows[i - 1]!;
        next[i - 1] = { ...p, text: p.text + r.text };
        next.splice(i, 1);
        write(next, 'Unir párrafos', { i: i - 1, caret: p.text.length });
      } else if (r.kind === 'title' && !r.text && i > 0) {
        const prev = deck.slides[(numberOf.get(r.sid) ?? 1) - 2];
        const hasBody = next[i + 1]?.sid === r.sid;
        if (!prev || (hasBody && !canHoldBody(prev))) return;
        e.preventDefault();
        const last = bodyAfter(i, r.sid);
        for (let k = i + 1; k <= last; k++) next[k] = { ...next[k]!, sid: prev.id };
        next.splice(i, 1);
        write(next, 'Eliminar diapositiva', { i: i - 1, caret: next[i - 1]?.text.length });
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      refs.current[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
    }
  };

  const cur = ctl.slide;
  return (
    <div className="sl-outline" data-testid="outline-view">
      <div className="sl-outline__text" role="group" aria-label={t('Esquema')}>
        {rows.map((r, i) => {
          const no = numberOf.get(r.sid) ?? 0;
          const s = slideOf(r.sid);
          const hasTitle = !!(s && outlineTitle(s));
          const seen = rows.slice(0, i).filter((x) => x.sid === r.sid && x.kind === 'body').length;
          return (
            <div key={`${r.sid}-${r.kind}-${seen}`} className={`sl-olrow sl-olrow--${r.kind}${r.sid === cur.id ? ' is-current' : ''}`} style={r.kind === 'body' ? { paddingLeft: 78 + r.lvl * 24 } : undefined}>
              {r.kind === 'title' && (
                <>
                  <span className="sl-olnum">{no}</span>
                  <span className="sl-olicon">{s && <Mini deck={deck} slide={s} index={no - 1} urls={ctl.urls} width={56} />}</span>
                </>
              )}
              {r.kind === 'body' && <span className="sl-olbullet" aria-hidden="true">{r.lvl % 2 ? '–' : '•'}</span>}
              <input
                ref={(el) => { refs.current[i] = el; }}
                aria-label={r.kind === 'title' ? t('Título de la diapositiva {n}', { n: no }) : t('Texto de nivel {n} de la diapositiva {m}', { n: r.lvl + 1, m: no })}
                data-testid={r.kind === 'title' ? 'ol-title' : 'ol-body'}
                value={r.text}
                readOnly={r.kind === 'title' && !hasTitle}
                placeholder={r.kind === 'title' ? (hasTitle ? t('Título') : t('(sin título)')) : ''}
                onFocus={() => {
                  ctl.goTo(no - 1);
                  if (keep && !(r.sid === keep && r.kind === 'body')) setKeep(undefined);
                  if (!(r.kind === 'title' && !hasTitle)) ctl.beginGesture('Editar esquema');
                }}
                onBlur={() => ctl.endGesture()}
                onChange={(e) => type(i, e.target.value)}
                onKeyDown={(e) => onKey(e, i)}
              />
            </div>
          );
        })}
      </div>
      <div className="sl-outline__side">
        <Mini deck={deck} slide={cur} index={ctl.index} urls={ctl.urls} width={360} />
        <NotesPane ctl={ctl} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ slide sorter

export function SorterView({ ui }: { ui: SlidesUI }) {
  const ctl = ui.ctl;
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const deck = ctl.deck;
  const width = Math.max(110, Math.min(460, Math.round((220 * (ctl.zoom || 100)) / 100)));
  const [drop, setDrop] = useState<number | null>(null);
  const drag = useRef<string[]>([]);
  const anchor = useRef(ctl.index);
  const box = useRef<HTMLDivElement>(null);
  const sectionOf = new Map<string, string>();
  for (const sec of deck.sections) for (const id of sec.slideIds) sectionOf.set(id, sec.id);

  const click = (e: React.MouseEvent, s: Slide, i: number) => {
    if (e.shiftKey) {
      const a = Math.min(anchor.current, i);
      const b = Math.max(anchor.current, i);
      ctl.goTo(i);
      ctl.selectSlides(deck.slides.slice(a, b + 1).map((x) => x.id));
    } else if (e.ctrlKey || e.metaKey) {
      const next = ctl.selSlides.includes(s.id) ? ctl.selSlides.filter((x) => x !== s.id) : [...ctl.selSlides, s.id];
      ctl.selectSlides(next.length ? next : [s.id]);
    } else {
      anchor.current = i;
      ctl.goTo(i);
    }
  };
  const columns = () => {
    const cells = [...(box.current?.querySelectorAll<HTMLElement>('[role=option]') ?? [])];
    const top = cells[0]?.offsetTop;
    return Math.max(1, cells.filter((c) => c.offsetTop === top).length);
  };
  const focusCell = (i: number) => {
    const n = Math.max(0, Math.min(deck.slides.length - 1, i));
    ctl.goTo(n);
    anchor.current = n;
    requestAnimationFrame(() => box.current?.querySelectorAll<HTMLElement>('[role=option]')[n]?.focus());
  };

  const cells: React.ReactNode[] = [];
  let lastSec: string | undefined | null = null;
  deck.slides.forEach((s, i) => {
    const sec = sectionOf.get(s.id);
    if (deck.sections.length && sec !== lastSec) {
      lastSec = sec;
      const section = deck.sections.find((x) => x.id === sec);
      if (section) cells.push(<div key={`sec-${section.id}`} className="sl-sortsec"><strong>{section.name}</strong> <span>({section.slideIds.length})</span></div>);
    }
    const selected = ctl.selSlides.includes(s.id);
    const badges = [s.transition ? t('Transición') : '', s.timing?.effects.length ? t('Animación') : '', s.hidden ? t('Oculta') : '', s.notes && docHasText(s) ? t('Notas') : ''].filter(Boolean);
    cells.push(
      <div
        key={s.id}
        className="sl-sortcell"
        onDragOver={(e) => {
          if (!drag.current.length) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setDrop(e.clientX < r.left + r.width / 2 ? i : i + 1);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (drop !== null && drag.current.length) ctl.moveSlidesTo(drag.current, deck.slides.slice(0, drop).filter((x) => !drag.current.includes(x.id)).length);
          drag.current = [];
          setDrop(null);
        }}
      >
        {drop === i && <div className="sl-dropbar sl-dropbar--before" />}
        <div
          role="option"
          aria-selected={selected}
          aria-label={`${t('Diapositiva')} ${i + 1}`}
          tabIndex={0}
          className={`sl-thumb${selected ? ' is-selected' : ''}${i === ctl.index ? ' is-current' : ''}${s.hidden ? ' is-hidden' : ''}`}
          draggable
          onDragStart={(e) => {
            drag.current = selected ? ctl.selSlides : [s.id];
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'slides');
          }}
          onDragEnd={() => {
            drag.current = [];
            setDrop(null);
          }}
          onClick={(e) => click(e, s, i)}
          onDoubleClick={() => {
            ctl.goTo(i);
            ctl.setView('normal');
          }}
          onKeyDown={(e) => {
            const k = e.key;
            if (k === 'ArrowRight') (e.preventDefault(), focusCell(i + 1));
            else if (k === 'ArrowLeft') (e.preventDefault(), focusCell(i - 1));
            else if (k === 'ArrowDown') (e.preventDefault(), focusCell(i + columns()));
            else if (k === 'ArrowUp') (e.preventDefault(), focusCell(i - columns()));
            else if (k === 'Delete') (e.preventDefault(), ctl.deleteSlides());
            else if (k === 'Enter') (e.preventDefault(), ctl.setView('normal'));
          }}
        >
          <Mini deck={deck} slide={s} index={i} urls={ctl.urls} width={width} />
        </div>
        <div className="sl-sortcap">
          <b>{i + 1}</b>
          {badges.map((b) => <span key={b}>{b}</span>)}
        </div>
        {drop === i + 1 && i === deck.slides.length - 1 && <div className="sl-dropbar sl-dropbar--after" />}
      </div>,
    );
  });
  return (
    <div className="sl-sorter" ref={box} role="listbox" aria-label={t('Diapositivas')} aria-multiselectable="true" data-testid="sorter-view">
      {cells}
    </div>
  );
}

const docHasText = (s: Slide): boolean => !!s.notes && JSON.stringify(s.notes.doc).includes('"text"');

// ------------------------------------------------------------------------------------------------ reading

/** The next visible slide from `i` in a direction (hidden slides are skipped, as in a show). */
function visible(ctl: SlidesCtl, i: number, dir: 1 | -1): number {
  let n = i + dir;
  while (ctl.deck.slides[n]?.hidden) n += dir;
  return n >= 0 && n < ctl.deck.slides.length ? n : i;
}

export function ReadingView({ ui }: { ui: SlidesUI }) {
  const ctl = ui.ctl;
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const deck = ctl.deck;
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 450 });
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const fit = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    el.focus();
    return () => ro.disconnect();
  }, []);
  const ratio = deck.size.w / deck.size.h;
  const width = Math.max(120, Math.floor(Math.min(size.w - 24, (size.h - 24) * ratio)));
  const go = (dir: 1 | -1) => ctl.goTo(visible(ctl, ctl.index, dir));
  return (
    <div className="sl-reading" data-testid="reading-view">
      <div
        className="sl-reading__area"
        ref={area}
        tabIndex={0}
        aria-label={t('Vista de lectura')}
        onKeyDown={(e) => {
          if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) (e.preventDefault(), go(1));
          else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) (e.preventDefault(), go(-1));
          else if (e.key === 'Home') (e.preventDefault(), ctl.goTo(0));
          else if (e.key === 'End') (e.preventDefault(), ctl.goTo(deck.slides.length - 1));
          else if (e.key === 'Escape') ctl.setView('normal');
        }}
        onClick={() => go(1)}
      >
        <Mini deck={deck} slide={ctl.slide} index={ctl.index} urls={ctl.urls} width={width} />
      </div>
      <div className="sl-reading__bar">
        <Button size="small" aria-label={t('Diapositiva anterior')} disabled={visible(ctl, ctl.index, -1) === ctl.index} onClick={() => go(-1)}>‹</Button>
        <span aria-live="polite">{t('Diapositiva {n} de {m}', { n: ctl.index + 1, m: deck.slides.length })}</span>
        <Button size="small" aria-label={t('Diapositiva siguiente')} disabled={visible(ctl, ctl.index, 1) === ctl.index} onClick={() => go(1)}>›</Button>
        <span className="sl-reading__sp" />
        <Button size="small" onClick={() => ui.present('current')}>{t('Presentar')}</Button>
        <Button size="small" onClick={() => ctl.setView('normal')}>{t('Salir de la vista de lectura')}</Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ notes page

export function NotesPageView({ ui }: { ui: SlidesUI }) {
  const ctl = ui.ctl;
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const deck = ctl.deck;
  return (
    <div className="sl-notespage" data-testid="notes-view">
      <div className="sl-notespage__bar">
        <Button size="small" aria-label={t('Diapositiva anterior')} disabled={ctl.index === 0} onClick={() => ctl.goTo(ctl.index - 1)}>‹</Button>
        <span aria-live="polite">{t('Diapositiva {n} de {m}', { n: ctl.index + 1, m: deck.slides.length })}</span>
        <Button size="small" aria-label={t('Diapositiva siguiente')} disabled={ctl.index >= deck.slides.length - 1} onClick={() => ctl.goTo(ctl.index + 1)}>›</Button>
      </div>
      <div className="sl-notespage__sheet">
        <Mini deck={deck} slide={ctl.slide} index={ctl.index} urls={ctl.urls} width={420} />
        <NotesPane ctl={ctl} page />
      </div>
    </div>
  );
}
