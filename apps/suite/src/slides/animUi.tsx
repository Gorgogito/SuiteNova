import { Icon, t } from '@suitenova/core-ui';
import { PRESETS, docText, presetInfo, type AnimEffect, type PresetInfo } from '@suitenova/slides-core';
import { useEffect, useState } from 'react';
import { addEffect, applyEffect, effectsOf, moveEffect, patchEffect, removeEffect, selectedEffect, setTransition, TRANSITIONS } from './animctl';
import type { SlidesUI } from './commands';
import { Gallery, useUi } from './ribbonParts';

/** A number box that commits on Enter or when it loses focus (so that typing is one undo step, not one per digit). */
export function NumField({ label, value, onCommit, min = 0, max = 3600, step = 0.1, unit = 's', disabled }: { label: string; value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; disabled?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text.replace(',', '.'));
    if (!Number.isFinite(n)) return setText(String(value));
    const v = Math.min(max, Math.max(min, n));
    setText(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <label className="sl-numfield">
      <span>{label}</span>
      <input type="number" inputMode="decimal" min={min} max={max} step={step} value={text} disabled={disabled} aria-label={label} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      <span aria-hidden="true">{unit}</span>
    </label>
  );
}

const SECOND = 1000;

// ------------------------------------------------------------------------------------------ transitions

export function TransitionGallery({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  const cur = c.slide.transition;
  return (
    <Gallery label={t('Transición')} icon="slideshow" wide>
      {(close) => (
        <div className="sl-effects" role="menu" aria-label={t('Transiciones')}>
          {TRANSITIONS.map((tr) => (
            <button
              key={tr.type}
              type="button"
              role="menuitemradio"
              aria-checked={(cur?.type ?? 'none') === tr.type}
              onClick={() => {
                setTransition(c, (old) => (tr.type === 'none' ? undefined : { ...(old ?? { type: tr.type }), type: tr.type, dir: tr.dirs && tr.type !== 'fade' ? tr.dirs[0]!.id : tr.type === 'split' ? 'in' : undefined, orient: tr.orient ? 'horz' : undefined, thruBlk: undefined, rawXml: undefined }));
                close();
                c.containerFocus?.();
              }}
            >
              <span className="sl-effects__name">{t(tr.label)}</span>
            </button>
          ))}
        </div>
      )}
    </Gallery>
  );
}

export function TransitionOptions({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  const cur = c.slide.transition;
  const def = TRANSITIONS.find((x) => x.type === cur?.type);
  const has = !!def && (def.dirs || def.orient);
  return (
    <Gallery label={t('Opciones de efectos')} icon="settings" size="large">
      {(close) => (
        <div className="sl-effects" role="menu" aria-label={t('Opciones de efectos')}>
          {!has && <div className="sl-swatchtitle">{t('Esta transición no tiene opciones.')}</div>}
          {def?.dirs?.map((d) => {
            const on = def.type === 'fade' ? (d.id === 'thruBlk') === !!cur?.thruBlk : cur?.dir === d.id;
            return (
              <button
                key={d.id}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => {
                  setTransition(c, (old) => (old ? { ...old, dir: def.type === 'fade' ? undefined : d.id, thruBlk: def.type === 'fade' ? d.id === 'thruBlk' : old.thruBlk, rawXml: undefined } : old));
                  close();
                }}
              >
                <span className="sl-effects__name">{t(d.label)}</span>
              </button>
            );
          })}
          {def?.orient &&
            (['horz', 'vert'] as const).map((o) => (
              <button
                key={o}
                type="button"
                role="menuitemradio"
                aria-checked={(cur?.orient ?? 'horz') === o}
                onClick={() => {
                  setTransition(c, (old) => (old ? { ...old, orient: o, rawXml: undefined } : old));
                  close();
                }}
              >
                <span className="sl-effects__name">{o === 'horz' ? t('Horizontal') : t('Vertical')}</span>
              </button>
            ))}
        </div>
      )}
    </Gallery>
  );
}

export function TransitionTiming({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  const cur = c.slide.transition;
  const dur = cur?.dur ?? ({ slow: 1000, med: 700, fast: 500 }[cur?.spd ?? 'med'] ?? 700);
  const timed = cur?.advTm !== undefined;
  const set = (patch: Partial<NonNullable<typeof cur>>) => setTransition(c, (old) => ({ ...(old ?? { type: 'fade' }), ...patch, rawXml: undefined }));
  return (
    <div className="sl-timing">
      <NumField label={t('Duración')} value={dur / SECOND} disabled={!cur} onCommit={(v) => set({ dur: Math.round(v * SECOND), spd: undefined })} min={0.1} max={60} step={0.25} />
      <label className="sl-check">
        <input type="checkbox" checked={cur?.advClick !== false} disabled={!cur && false} onChange={(e) => set({ advClick: e.target.checked })} />
        {t('Al hacer clic con el mouse')}
      </label>
      <label className="sl-check">
        <input type="checkbox" checked={timed} onChange={(e) => set({ advTm: e.target.checked ? 5000 : undefined })} />
        {t('Después de')}
      </label>
      <NumField label={t('Tiempo')} value={(cur?.advTm ?? 0) / SECOND} disabled={!timed} onCommit={(v) => set({ advTm: Math.round(v * SECOND) })} max={86400} step={1} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------ animations

const CLASSES: { cls: PresetInfo['cls']; label: string }[] = [
  { cls: 'entr', label: 'Entrada' },
  { cls: 'emph', label: 'Énfasis' },
  { cls: 'exit', label: 'Salida' },
];

export function AnimGallery({ ui, mode }: { ui: SlidesUI; mode: 'apply' | 'add' }) {
  const c = useUi(ui);
  const sel = selectedEffect(c);
  return (
    <Gallery label={mode === 'apply' ? t('Animación') : t('Agregar animación')} icon="sparkles" wide>
      {(close) => (
        <div className="sl-effects" role="menu" aria-label={t('Animaciones')}>
          {CLASSES.map((k) => (
            <div key={k.cls}>
              <div className="sl-swatchtitle">{t(k.label)}</div>
              {PRESETS.filter((p) => p.cls === k.cls).map((p) => (
                <button
                  key={`${p.cls}${p.id}`}
                  type="button"
                  role="menuitem"
                  aria-checked={mode === 'apply' && sel?.cls === p.cls && sel.preset === p.id}
                  onClick={() => {
                    (mode === 'apply' ? applyEffect : addEffect)(c, p);
                    close();
                    c.containerFocus?.();
                  }}
                >
                  <span className="sl-effects__name">{t(p.label)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </Gallery>
  );
}

export function AnimOptions({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  const sel = selectedEffect(c);
  const info = sel && presetInfo(sel.cls, sel.preset);
  return (
    <Gallery label={t('Opciones de efectos')} icon="settings">
      {(close) => (
        <div className="sl-effects" role="menu" aria-label={t('Opciones de efectos')}>
          {!info?.subtypes && <div className="sl-swatchtitle">{sel ? t('Esta animación no tiene opciones.') : t('Seleccione una animación en el panel.')}</div>}
          {info?.subtypes?.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitemradio"
              aria-checked={sel!.subtype === s.id}
              onClick={() => {
                patchEffect(c, sel!.id, { subtype: s.id });
                close();
              }}
            >
              <span className="sl-effects__name">{t(s.label)}</span>
            </button>
          ))}
        </div>
      )}
    </Gallery>
  );
}

const TRIGGERS: { id: AnimEffect['trigger']; label: string }[] = [
  { id: 'onClick', label: 'Al hacer clic' },
  { id: 'withPrev', label: 'Con la anterior' },
  { id: 'afterPrev', label: 'Después de la anterior' },
];

export function AnimTiming({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  const sel = selectedEffect(c);
  return (
    <div className="sl-timing">
      <label className="sl-numfield">
        <span>{t('Inicio')}</span>
        <select value={sel?.trigger ?? 'onClick'} disabled={!sel} aria-label={t('Inicio')} onChange={(e) => sel && patchEffect(c, sel.id, { trigger: e.target.value as AnimEffect['trigger'] }, 'Cambiar el inicio')}>
          {TRIGGERS.map((x) => (
            <option key={x.id} value={x.id}>{t(x.label)}</option>
          ))}
        </select>
      </label>
      <NumField label={t('Duración')} value={(sel?.dur ?? 500) / SECOND} disabled={!sel} onCommit={(v) => sel && patchEffect(c, sel.id, { dur: Math.round(v * SECOND) })} min={0.05} max={60} step={0.25} />
      <NumField label={t('Retraso')} value={(sel?.delay ?? 0) / SECOND} disabled={!sel} onCommit={(v) => sel && patchEffect(c, sel.id, { delay: Math.round(v * SECOND) })} max={60} step={0.25} />
    </div>
  );
}

/** The list of animations of the slide, in play order. */
export function AnimPane({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  const list = effectsOf(c.slide);
  // number of the click each effect belongs to
  let clicks = 0;
  const nameOf = (e: AnimEffect) => {
    const el = c.element(e.target);
    if (!el) return t('(objeto eliminado)');
    const txt = el.kind === 'shape' && el.text ? docText(el.text.doc).trim().slice(0, 28) : '';
    return txt || (el as { name?: string }).name || el.kind;
  };
  return (
    <aside className="sl-pane sl-animpane" aria-label={t('Panel de animación')}>
      <header>
        <b>{t('Panel de animación')}</b>
        <button type="button" aria-label={t('Cerrar el panel')} onClick={() => ((c.pane = 'none'), c.touch())}>×</button>
      </header>
      {!list.length && <p className="sl-pane__empty">{t('Esta diapositiva no tiene animaciones. Seleccione un objeto y elija un efecto en la pestaña Animaciones.')}</p>}
      <ol className="sl-animlist" role="listbox" aria-label={t('Animaciones de la diapositiva')}>
        {list.map((e, i) => {
          if (e.trigger === 'onClick' || i === 0) clicks++;
          const info = presetInfo(e.cls, e.preset);
          return (
            <li key={e.id} role="option" aria-selected={c.selEffect === e.id} className={c.selEffect === e.id ? 'is-sel' : ''} onClick={() => ((c.selEffect = e.id), c.select([e.target]))}>
              <span className="sl-animlist__n" title={t(TRIGGERS.find((x) => x.id === e.trigger)!.label)}>{e.trigger === 'onClick' || i === 0 ? clicks : e.trigger === 'withPrev' ? '＋' : '▸'}</span>
              <span className={`sl-animlist__cls sl-animlist__cls--${e.cls}`} aria-hidden="true">{e.cls === 'entr' ? '★' : e.cls === 'exit' ? '✕' : '◆'}</span>
              <span className="sl-animlist__name">{nameOf(e)} <small>{info ? t(info.label) : t('Efecto')}</small></span>
              <button type="button" aria-label={t('Quitar animación')} onClick={(ev) => (ev.stopPropagation(), removeEffect(c, e.id))}>×</button>
            </li>
          );
        })}
      </ol>
      <footer>
        <button type="button" disabled={!c.selEffect} onClick={() => c.selEffect && moveEffect(c, c.selEffect, -1)}>
          <Icon name="chevronUp" /> {t('Subir')}
        </button>
        <button type="button" disabled={!c.selEffect} onClick={() => c.selEffect && moveEffect(c, c.selEffect, 1)}>
          <Icon name="chevronDown" /> {t('Bajar')}
        </button>
      </footer>
    </aside>
  );
}
