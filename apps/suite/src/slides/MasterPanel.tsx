import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { layoutFooters, newPlaceholder, renameLayout, renameMaster, virtualMasterDeck, type PhType } from '@suitenova/slides-core';
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { SlidesCtl } from './ctl';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';
import { Gallery, useUi } from './ribbonParts';
import { Mini } from './Thumbs';

/** The left pane of master view: each master and its layouts, drawn small; click one to edit it. */
export function MasterPanel({ ctl }: { ctl: SlidesCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const real = ctl.realDeck;
  const items = useMemo(
    () =>
      real.masters.map((m) => ({
        master: m,
        mini: virtualMasterDeck(real, { kind: 'master', id: m.id }),
        layouts: m.layoutIds
          .map((id) => real.layouts.find((l) => l.id === id))
          .filter((l): l is NonNullable<typeof l> => !!l)
          .map((l) => ({ layout: l, mini: virtualMasterDeck(real, { kind: 'layout', id: l.id }) })),
      })),
    [real],
  );
  const cur = ctl.masterTarget;
  const used = (id: string) => real.slides.filter((s) => s.layoutId === id).length;
  return (
    <div className="sl-thumbs sl-masterpanel" role="listbox" aria-label={t('Patrones y diseños')}>
      {items.map(({ master, mini, layouts }) => (
        <div key={master.id}>
          <div
            role="option"
            aria-selected={cur?.kind === 'master' && cur.id === master.id}
            aria-label={`${t('Patrón')}: ${master.name}`}
            tabIndex={0}
            className={`sl-thumb sl-thumb--master${cur?.kind === 'master' && cur.id === master.id ? ' is-selected is-current' : ''}`}
            onClick={() => ctl.setMasterTarget({ kind: 'master', id: master.id })}
            onKeyDown={(e) => e.key === 'Enter' && ctl.setMasterTarget({ kind: 'master', id: master.id })}
          >
            <Mini deck={mini} slide={mini.slides[0]!} index={0} urls={ctl.urls} />
            <div className="sl-thumbcap"><b>{master.name}</b></div>
          </div>
          {layouts.map(({ layout, mini: lm }) => {
            const on = cur?.kind === 'layout' && cur.id === layout.id;
            return (
              <div
                key={layout.id}
                role="option"
                aria-selected={on}
                aria-label={`${t('Diseño')}: ${layout.name}`}
                tabIndex={0}
                className={`sl-thumb sl-thumb--layout${on ? ' is-selected is-current' : ''}`}
                onClick={() => ctl.setMasterTarget({ kind: 'layout', id: layout.id })}
                onKeyDown={(e) => e.key === 'Enter' && ctl.setMasterTarget({ kind: 'layout', id: layout.id })}
              >
                <Mini deck={lm} slide={lm.slides[0]!} index={0} urls={ctl.urls} />
                <div className="sl-thumbcap">{layout.name}{used(layout.id) ? ` · ${used(layout.id)}` : ''}</div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Gallery of the placeholders that can be added to a layout. */
export function PlaceholderGallery({ ui, items }: { ui: SlidesUI; items: [string, string][] }) {
  const c = useUi(ui);
  const on = c.inMaster && c.masterTarget?.kind === 'layout';
  return (
    <Gallery label={t('Insertar marcador de posición')} icon="textbox">
      {(close) => (
        <div role="menu" aria-label={t('Marcadores de posición')} className="sl-menulist">
          {items.map(([kind, label]) => (
            <button key={kind} type="button" role="menuitem" disabled={!on} onClick={() => (c.addElement(newPlaceholder(c.realDeck, c.masterIdOfTarget!, kind as PhType)), close())}>
              {t(label)}
            </button>
          ))}
          {!on && <small>{t('Elige un diseño para agregarle marcadores de posición.')}</small>}
        </div>
      )}
    </Gallery>
  );
}

/** Name and options of the master or layout being edited. */
export function MasterPropsDialog({ ui, onClose }: { ui: SlidesUI; onClose: () => void }) {
  const c = ui.ctl;
  const t0 = c.masterTarget!;
  const real = c.realDeck;
  const layout = t0.kind === 'layout' ? real.layouts.find((l) => l.id === t0.id) : undefined;
  const master = real.masters.find((m) => m.id === (t0.kind === 'master' ? t0.id : layout?.masterId));
  const [name, setName] = useState(layout?.name ?? master?.name ?? '');
  const foot = layout ? layoutFooters({ ...layout, shapes: c.slide.shapes }) : null;
  const [f, setF] = useState(foot ?? { dt: false, ftr: false, sldNum: false });
  const apply = () => {
    const n = name.trim();
    if (n) c.applyReal(t0.kind === 'layout' ? 'Cambiar nombre del diseño' : 'Cambiar nombre del patrón', (d) => (t0.kind === 'layout' ? renameLayout(d, t0.id, n) : renameMaster(d, t0.id, n)));
    if (layout && foot) {
      for (const k of ['dt', 'ftr', 'sldNum'] as const) {
        if (f[k] === foot[k]) continue;
        c.apply('Pies del diseño', (d) => {
          const s = d.slides[0]!;
          const shapes = f[k] ? [...s.shapes, newPlaceholder(real, master!.id, k)] : s.shapes.filter((e) => !(e.kind === 'shape' && e.ph?.type === k));
          return { ...d, slides: [{ ...s, shapes }] };
        });
      }
    }
    onClose();
  };
  return (
    <Modal
      title={layout ? t('Diseño') : t('Patrón')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!name.trim()} onClick={apply}>{t('Aceptar')}</Button>
        </>
      }
    >
      <div className="sl-form">
        <label className="sl-field">
          <span>{t('Nombre')}</span>
          <input aria-label={t('Nombre del diseño o patrón')} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {layout && (
          <fieldset className="sl-fieldset">
            <legend>{t('Marcadores de pie')}</legend>
            {([['dt', 'Fecha'], ['ftr', 'Pie de página'], ['sldNum', 'Número de diapositiva']] as const).map(([k, l]) => (
              <label key={k} className="sl-check">
                <input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {t(l)}
              </label>
            ))}
          </fieldset>
        )}
      </div>
    </Modal>
  );
}
