import { t } from '@suitenova/core-ui';
import { isGlued, updateConnectors, type Connector } from '@suitenova/diagram-core';
import { useState, useSyncExternalStore } from 'react';
import type { Box, DiagramCtl } from './ctl';

const round = (v: number) => Math.round(v * 100) / 100;

/** A number that is applied when Enter is pressed or the field is left; what is not a number goes back. */
function NumberField({ id, label, value, disabled, onSet }: { id: string; label: string; value: number | null; disabled?: boolean; onSet: (v: number) => void }) {
  const shown = value === null ? '' : String(round(value));
  const [draft, setDraft] = useState<string | null>(null);
  const apply = () => {
    if (draft === null) return;
    const v = Number(draft.trim().replace(',', '.'));
    setDraft(null);
    if (draft.trim() !== '' && Number.isFinite(v) && draft !== shown) onSet(v);
  };
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        inputMode="decimal"
        value={draft ?? shown}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply();
          else if (e.key === 'Escape') setDraft(null);
        }}
      />
    </>
  );
}

/** Size and position of what is selected, in the units of the rulers. */
export function SizePane({ ctl }: { ctl: DiagramCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const shapes = ctl.selectedShapes();
  const conns = ctl.selectedConnectors();
  const line = !shapes.length && conns.length === 1 ? conns[0]! : null;
  const ids = shapes.map((s) => s.id);
  const frozen = shapes.length > 0 && shapes.every((s) => ctl.isFrozen(s));
  const common = (f: (s: (typeof shapes)[number]) => number) => (shapes.every((s) => round(f(s)) === round(f(shapes[0]!))) ? f(shapes[0]!) : null);
  const set = (patch: Partial<Box>) => ctl.setBox(ids, patch);
  const end = (c: Connector, which: 'from' | 'to', axis: 'x' | 'y', v: number) => {
    const e = c[which];
    if (!isGlued(e)) ctl.edit((p) => updateConnectors(p, [c.id], { [which]: { ...e, [axis]: v } }));
  };
  return (
    <aside className="dg-side nv-panel" aria-label={t('Tamaño y posición')} data-testid="size-pane">
      <div className="dg-side__head">
        <strong>{t('Tamaño y posición')}</strong>
        <button type="button" className="dg-x" aria-label={t('Cerrar el panel')} onClick={() => ctl.togglePane('size')}>×</button>
      </div>
      {!shapes.length && !line && <p className="dg-side__hint">{t('Selecciona formas o un conector.')}</p>}
      {shapes.length > 0 && (
        <div className="dg-numbers" key={ids.join()}>
          {shapes.length === 1 && (
            <>
              <NumberField id="dg-cx" label={t('X (centro)')} value={shapes[0]!.x + shapes[0]!.w / 2} disabled={frozen} onSet={(cx) => set({ cx })} />
              <NumberField id="dg-cy" label={t('Y (centro)')} value={shapes[0]!.y + shapes[0]!.h / 2} disabled={frozen} onSet={(cy) => set({ cy })} />
            </>
          )}
          <NumberField id="dg-w" label={t('Ancho')} value={common((s) => s.w)} disabled={frozen} onSet={(w) => set({ w })} />
          <NumberField id="dg-h" label={t('Alto')} value={common((s) => s.h)} disabled={frozen} onSet={(h) => set({ h })} />
          <NumberField id="dg-rot" label={t('Ángulo (grados)')} value={common((s) => s.rot)} disabled={frozen} onSet={(rot) => set({ rot })} />
        </div>
      )}
      {line && (
        <div className="dg-numbers" key={line.id}>
          {(['from', 'to'] as const).map((which) => {
            const e = line[which];
            const name = which === 'from' ? t('Inicio del conector') : t('Fin del conector');
            if (isGlued(e)) {
              const s = ctl.basePage.shapes.find((x) => x.id === e.shape);
              return (
                <p key={which} className="dg-side__hint" style={{ gridColumn: '1 / -1' }}>
                  {t('{end}: pegado a «{shape}»', { end: name, shape: s?.text.split('\n')[0] || t('una forma') })}
                </p>
              );
            }
            return (
              <div key={which} style={{ display: 'contents' }}>
                <NumberField id={`dg-${which}-x`} label={`${name} X`} value={e.x} onSet={(v) => end(line, which, 'x', v)} />
                <NumberField id={`dg-${which}-y`} label={`${name} Y`} value={e.y} onSet={(v) => end(line, which, 'y', v)} />
              </div>
            );
          })}
        </div>
      )}
      <p className="dg-side__note">{t('Medidas en píxeles (96 por pulgada), desde la esquina superior izquierda de la página.')}</p>
    </aside>
  );
}
