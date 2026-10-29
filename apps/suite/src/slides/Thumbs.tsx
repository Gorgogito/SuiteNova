import { t } from '@suitenova/core-ui';
import { slideIndex, type Deck, type Slide } from '@suitenova/slides-core';
import { memo, useRef, useState, useSyncExternalStore } from 'react';
import type { SlidesCtl } from './ctl';
import { SlideCanvas } from './render/SlideCanvas';

const THUMB_W = 176;

interface ThumbProps {
  deck: Deck;
  slide: Slide;
  index: number;
  urls: SlidesCtl['urls'];
  /** drawn width in px (176 by default) */
  width?: number;
}

/** One miniature: the slide drawn small, with prompts of empty placeholders (as PowerPoint does). */
export const Mini = memo(
  function Mini({ deck, slide, index, urls, width = THUMB_W }: ThumbProps) {
    const k = width / deck.size.w;
    return (
      <div className="sl-mini" style={{ width, height: deck.size.h * k }} aria-hidden="true">
        <div style={{ transform: `scale(${k})`, transformOrigin: '0 0', width: deck.size.w, height: deck.size.h, pointerEvents: 'none' }}>
          <SlideCanvas deck={deck} slide={slide} urls={urls} slideNumber={index + 1} mode="thumb" prompts />
        </div>
      </div>
    );
  },
  (a, b) => a.slide === b.slide && a.deck.masters === b.deck.masters && a.deck.layouts === b.deck.layouts && a.deck.themes === b.deck.themes && a.deck.size === b.deck.size && a.deck.assets === b.deck.assets && a.index === b.index && a.width === b.width,
);

export function Thumbs({ ctl, onContext }: { ctl: SlidesCtl; onContext?: (e: React.MouseEvent, id: string) => void }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const { deck } = ctl;
  const [drop, setDrop] = useState<number | null>(null);
  const dragIds = useRef<string[]>([]);
  const anchor = useRef(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);

  const click = (e: React.MouseEvent, s: Slide, i: number) => {
    if (e.shiftKey) {
      const a = Math.min(anchor.current, i);
      const b = Math.max(anchor.current, i);
      ctl.goTo(i);
      ctl.selectSlides(deck.slides.slice(a, b + 1).map((x) => x.id));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const has = ctl.selSlides.includes(s.id);
      const next = has ? ctl.selSlides.filter((x) => x !== s.id) : [...ctl.selSlides, s.id];
      ctl.selectSlides(next.length ? next : [s.id]);
      return;
    }
    anchor.current = i;
    ctl.goTo(i);
  };

  const rows: React.ReactNode[] = [];
  const sectionOf = new Map<string, string>();
  for (const sec of deck.sections) for (const id of sec.slideIds) sectionOf.set(id, sec.id);
  let lastSec: string | undefined | null = null;
  deck.slides.forEach((s, i) => {
    const sec = sectionOf.get(s.id);
    if (deck.sections.length && sec !== lastSec) {
      const section = deck.sections.find((x) => x.id === sec);
      lastSec = sec;
      if (section)
        rows.push(
          <div
            key={`sec-${section.id}`}
            className="sl-secheader"
            role="button"
            tabIndex={0}
            aria-expanded={!collapsed.has(section.id)}
            onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(section.id)) n.delete(section.id); else n.add(section.id); return n; })}
            onContextMenu={(e) => {
              e.preventDefault();
              onContext?.(e, `section:${section.id}`);
            }}
            onDoubleClick={() => setRenaming(section.id)}
          >
            <span aria-hidden="true">{collapsed.has(section.id) ? '▸' : '▾'}</span>{' '}
            {renaming === section.id ? (
              <input
                autoFocus
                aria-label={t('Nombre de la sección')}
                defaultValue={section.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  ctl.apply('Cambiar nombre de la sección', (d) => ({ ...d, sections: d.sections.map((x) => (x.id === section.id ? { ...x, name: e.target.value || x.name } : x)) }));
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
            ) : (
              <strong>{section.name}</strong>
            )}{' '}
            <span className="sl-secheader__n">({section.slideIds.length})</span>
          </div>,
        );
    }
    if (sec && collapsed.has(sec)) return;
    const selected = ctl.selSlides.includes(s.id);
    rows.push(
      <div
        key={s.id}
        className="sl-thumbrow"
        onDragOver={(e) => {
          if (!dragIds.current.length) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setDrop(e.clientY < r.top + r.height / 2 ? i : i + 1);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (drop !== null && dragIds.current.length) {
            const before = deck.slides.slice(0, drop).filter((x) => !dragIds.current.includes(x.id)).length;
            ctl.moveSlidesTo(dragIds.current, before);
          }
          dragIds.current = [];
          setDrop(null);
        }}
      >
        {drop === i && <div className="sl-dropline" />}
        <div className="sl-thumbnum">{i + 1}</div>
        <div
          role="option"
          aria-selected={selected}
          aria-label={`${t('Diapositiva')} ${i + 1}`}
          tabIndex={0}
          className={`sl-thumb${selected ? ' is-selected' : ''}${i === ctl.index ? ' is-current' : ''}${s.hidden ? ' is-hidden' : ''}`}
          draggable
          onDragStart={(e) => {
            dragIds.current = selected ? ctl.selSlides : [s.id];
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'slides');
          }}
          onDragEnd={() => {
            dragIds.current = [];
            setDrop(null);
          }}
          onClick={(e) => click(e, s, i)}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!selected) ctl.goTo(i);
            onContext?.(e, s.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), ctl.goTo(slideIndex(deck, s.id) + 1));
            else if (e.key === 'ArrowUp') (e.preventDefault(), ctl.goTo(slideIndex(deck, s.id) - 1));
            else if (e.key === 'Delete') (e.preventDefault(), ctl.deleteSlides());
            else if (e.key === 'Enter') (e.preventDefault(), ctl.newSlide());
          }}
        >
          <Mini deck={deck} slide={s} index={i} urls={ctl.urls} />
        </div>
        {drop === i + 1 && i === deck.slides.length - 1 && <div className="sl-dropline sl-dropline--end" />}
      </div>,
    );
  });
  return (
    <div className="sl-thumbs" role="listbox" aria-label={t('Diapositivas')} aria-multiselectable="true">
      {rows}
    </div>
  );
}
