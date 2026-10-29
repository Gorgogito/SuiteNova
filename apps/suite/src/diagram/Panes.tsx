import { Button, DialogActions, DialogContent, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useState, useSyncExternalStore } from 'react';
import type { DataField } from '@suitenova/diagram-core';
import type { DiagramCtl } from './ctl';

const TYPES: [NonNullable<DataField['type']>, string][] = [['text', 'Texto'], ['number', 'Número'], ['date', 'Fecha'], ['bool', 'Sí/No']];

/** The data of the selected shape: name, type and value of each field. */
export function DataPane({ ctl }: { ctl: DiagramCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const sel = ctl.selectedShapes();
  const [name, setName] = useState('');
  const one = sel.length === 1 ? sel[0]! : null;
  const set = (data: DataField[]) => one && ctl.setData(one.id, data);
  const add = () => {
    const n = name.trim();
    if (!n || !sel.length) return;
    ctl.addField({ name: n, value: '', type: 'text' });
    setName('');
  };
  return (
    <aside className="dg-side" aria-label={t('Datos de forma')} data-testid="data-pane">
      <div className="dg-side__head">
        <strong>{t('Datos de forma')}</strong>
        <button type="button" className="dg-x" aria-label={t('Cerrar el panel')} onClick={() => ctl.togglePane('data')}>×</button>
      </div>
      {!sel.length && <p className="dg-side__hint">{t('Selecciona una forma para ver y editar sus datos.')}</p>}
      {sel.length > 1 && <p className="dg-side__hint">{t('Con varias formas seleccionadas solo se puede agregar un campo a todas.')}</p>}
      {one && (one.data ?? []).length === 0 && <p className="dg-side__hint">{t('Esta forma no tiene datos.')}</p>}
      {one &&
        (one.data ?? []).map((d, i) => (
          <div key={i} className="dg-field">
            <input aria-label={t('Nombre del dato {n}', { n: i + 1 })} value={d.name} onChange={(e) => set((one.data ?? []).map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
            <select aria-label={t('Tipo del dato {n}', { n: i + 1 })} value={d.type ?? 'text'} onChange={(e) => set((one.data ?? []).map((x, k) => (k === i ? { ...x, type: e.target.value as DataField['type'] } : x)))}>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
            </select>
            {d.type === 'bool' ? (
              <select aria-label={t('Valor del dato {n}', { n: i + 1 })} value={d.value} onChange={(e) => set((one.data ?? []).map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))}>
                <option value="">—</option>
                <option value="Sí">{t('Sí')}</option>
                <option value="No">{t('No')}</option>
              </select>
            ) : (
              <input
                aria-label={t('Valor del dato {n}', { n: i + 1 })}
                type={d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : 'text'}
                value={d.value}
                onChange={(e) => set((one.data ?? []).map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))}
              />
            )}
            <button type="button" className="dg-x" aria-label={t('Quitar el dato {n}', { n: i + 1 })} onClick={() => set((one.data ?? []).filter((_, k) => k !== i))}>×</button>
          </div>
        ))}
      {sel.length > 0 && (
        <div className="dg-field dg-field--new">
          <input aria-label={t('Nombre del dato nuevo')} placeholder={t('Nombre del dato nuevo')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <Button size="small" disabled={!name.trim()} onClick={add}>{t('Agregar dato')}</Button>
        </div>
      )}
      <p className="dg-side__note">{t('En el texto de una forma, {{nombre}} se sustituye por el dato de ese nombre.')}</p>
    </aside>
  );
}

/** Link of the selected shapes: a web address or another page of the diagram. */
export function LinkForm({ ctl, onClose }: { ctl: DiagramCtl; onClose: () => void }) {
  const first = ctl.selectedShapes().find((s) => s.link)?.link;
  const [kind, setKind] = useState<'url' | 'page'>(first?.page ? 'page' : 'url');
  const [url, setUrl] = useState(first?.url ?? 'https://');
  const [page, setPage] = useState(first?.page ?? ctl.diagram.pages.find((p) => p.id !== ctl.pageId)?.id ?? ctl.pageId);
  const [tip, setTip] = useState(first?.tip ?? '');
  const bad = kind === 'url' && !/^(https?:\/\/|mailto:|file:\/\/)\S+$/i.test(url.trim());
  const ok = () => {
    ctl.setLink(kind === 'url' ? { url: url.trim(), ...(tip.trim() ? { tip: tip.trim() } : {}) } : { page, ...(tip.trim() ? { tip: tip.trim() } : {}) });
    onClose();
  };
  return (
    <>
      <DialogTitle>{t('Vínculo')}</DialogTitle>
      <DialogContent>
        <div className="dg-form">
          <label htmlFor="dg-link-kind">{t('Vincular a')}</label>
          <select id="dg-link-kind" className="nv-select" value={kind} onChange={(e) => setKind(e.target.value as 'url' | 'page')}>
            <option value="url">{t('Dirección web, correo o archivo')}</option>
            <option value="page">{t('Otra página de este diagrama')}</option>
          </select>
          {kind === 'url' ? (
            <>
              <label htmlFor="dg-link-url">{t('Dirección')}</label>
              <input id="dg-link-url" className="nv-input" value={url} onChange={(e) => setUrl(e.target.value)} />
            </>
          ) : (
            <>
              <label htmlFor="dg-link-page">{t('Página')}</label>
              <select id="dg-link-page" className="nv-select" value={page} onChange={(e) => setPage(e.target.value)}>
                {ctl.diagram.pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </>
          )}
          <label htmlFor="dg-link-tip">{t('Texto de la sugerencia')}</label>
          <input id="dg-link-tip" className="nv-input" value={tip} onChange={(e) => setTip(e.target.value)} />
        </div>
        {bad && <p role="alert" className="dg-error">{t('La dirección debe empezar por http://, https://, mailto: o file://.')}</p>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Cancelar')}</Button>
        <Button appearance="primary" disabled={bad} onClick={ok}>{t('Aceptar')}</Button>
      </DialogActions>
    </>
  );
}

/** The layers of the page: visible, locked and printable, the active layer, order, and sending the selection to a layer. */
export function LayersPane({ ctl }: { ctl: DiagramCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const page = ctl.basePage;
  const layers = ctl.layers;
  const active = page.activeLayer && layers.some((l) => l.id === page.activeLayer) ? page.activeLayer : layers[0]!.id;
  const [renaming, setRenaming] = useState<string | null>(null);
  const count = (id: string) => page.shapes.filter((s) => (s.layer && layers.some((l) => l.id === s.layer) ? s.layer : layers[0]!.id) === id).length + page.connectors.filter((c) => (c.layer && layers.some((l) => l.id === c.layer) ? c.layer : layers[0]!.id) === id).length;
  return (
    <aside className="dg-side" aria-label={t('Capas')} data-testid="layers-pane">
      <div className="dg-side__head">
        <strong>{t('Capas')}</strong>
        <button type="button" className="dg-x" aria-label={t('Cerrar el panel')} onClick={() => ctl.togglePane('layers')}>×</button>
      </div>
      <div className="dg-layerhead" aria-hidden="true">
        <span />
        <span title={t('Visible')}>👁</span>
        <span title={t('Bloqueada')}>🔒</span>
        <span title={t('Se imprime')}>🖨</span>
      </div>
      <ul className="dg-layers" role="listbox" aria-label={t('Capas de la página')}>
        {layers.map((l, i) => (
          <li key={l.id} role="option" aria-selected={l.id === active} className={l.id === active ? 'is-active' : ''} data-layer={l.id}>
            <button type="button" className="dg-layername" onClick={() => ctl.setActive(l.id)} onDoubleClick={() => setRenaming(l.id)} title={t('Capa activa: las formas nuevas van a ella')}>
              {renaming === l.id ? (
                <input
                  autoFocus
                  aria-label={t('Nombre de la capa')}
                  defaultValue={l.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    ctl.setLayerProps(l.id, { name: e.target.value });
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <>
                  {l.name} <small>({count(l.id)})</small>
                </>
              )}
            </button>
            <input type="checkbox" aria-label={t('{name}: visible', { name: l.name })} checked={l.visible} onChange={(e) => ctl.setLayerProps(l.id, { visible: e.target.checked })} />
            <input type="checkbox" aria-label={t('{name}: bloqueada', { name: l.name })} checked={l.locked} onChange={(e) => ctl.setLayerProps(l.id, { locked: e.target.checked })} />
            <input type="checkbox" aria-label={t('{name}: se imprime', { name: l.name })} checked={l.printable} onChange={(e) => ctl.setLayerProps(l.id, { printable: e.target.checked })} />
            <span className="dg-layerbtns">
              <button type="button" aria-label={t('Subir la capa {name}', { name: l.name })} disabled={i === 0} onClick={() => ctl.moveLayerBy(l.id, -1)}>↑</button>
              <button type="button" aria-label={t('Bajar la capa {name}', { name: l.name })} disabled={i === layers.length - 1} onClick={() => ctl.moveLayerBy(l.id, 1)}>↓</button>
              <button type="button" aria-label={t('Quitar la capa {name}', { name: l.name })} disabled={layers.length <= 1} onClick={() => ctl.removeLayerById(l.id)}>×</button>
            </span>
          </li>
        ))}
      </ul>
      <div className="dg-layeractions">
        <Button size="small" onClick={() => ctl.addLayerNamed()}>{t('Capa nueva')}</Button>
        <Button size="small" disabled={!ctl.hasSelection} onClick={() => ctl.assignSelectionToLayer(active)}>{t('Pasar la selección a la capa activa')}</Button>
      </div>
      <p className="dg-side__note">{t('Una capa oculta no se dibuja ni se exporta; una bloqueada no se puede seleccionar; una que no se imprime queda fuera de las exportaciones.')}</p>
    </aside>
  );
}

/** Spacing and connection points for automatic layout. */
export function LayoutForm({ ctl, onClose }: { ctl: DiagramCtl; onClose: () => void }) {
  const o = ctl.layoutOptions;
  const [gx, setGx] = useState(String(o.gapX));
  const [gy, setGy] = useState(String(o.gapY));
  const [rel, setRel] = useState(o.releasePorts);
  const bad = !(Number(gx) >= 0 && Number(gx) <= 400 && Number(gy) >= 0 && Number(gy) <= 400);
  return (
    <>
      <DialogTitle>{t('Opciones del diseño automático')}</DialogTitle>
      <DialogContent>
        <div className="dg-form">
          <label htmlFor="dg-lay-gx">{t('Separación entre formas vecinas (px)')}</label>
          <input id="dg-lay-gx" className="nv-input" value={gx} onChange={(e) => setGx(e.target.value)} />
          <label htmlFor="dg-lay-gy">{t('Separación entre niveles (px)')}</label>
          <input id="dg-lay-gy" className="nv-input" value={gy} onChange={(e) => setGy(e.target.value)} />
          <span />
          <label>
            <input type="checkbox" checked={rel} onChange={(e) => setRel(e.target.checked)} /> {t('Dejar que los conectores elijan el lado más cercano')}
          </label>
        </div>
        {bad && <p role="alert" className="dg-error">{t('Las separaciones deben estar entre 0 y 400 px.')}</p>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Cancelar')}</Button>
        <Button
          appearance="primary"
          disabled={bad}
          onClick={() => {
            ctl.layoutOptions = { ...ctl.layoutOptions, gapX: Number(gx), gapY: Number(gy), releasePorts: rel };
            ctl.touch();
            onClose();
          }}
        >
          {t('Aceptar')}
        </Button>
      </DialogActions>
    </>
  );
}
