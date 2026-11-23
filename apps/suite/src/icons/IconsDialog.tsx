import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { getLocale, t } from '@suitenova/core-ui';
import { loadCatalog, loadPaths, searchIcons, type Catalog, type IconInfo, type IconStyle, type PathsFile } from '@suitenova/icon-core';
import { useEffect, useMemo, useState } from 'react';
import './messages';
import { makeIconPick, type IconPick } from './raster';

const PAGE = 240;

/** The name of an icon in the language of the interface. */
export function iconLabel(i: IconInfo): string {
  if (getLocale() === 'en') return i.en.charAt(0).toUpperCase() + i.en.slice(1);
  return i.name;
}

function Glyph({ info, paths, style, color, size = 28 }: { info: IconInfo; paths: PathsFile; style: IconStyle; color: string; size?: number }) {
  const e = paths[info.id];
  const d = (style === 'regular' ? e?.[0] : e?.[1]) || e?.[0] || e?.[1] || [];
  return (
    <svg viewBox={`0 0 ${info.size} ${info.size}`} width={size} height={size} fill={color} aria-hidden="true">
      {d.map((p, k) => (
        <path key={k} d={p} />
      ))}
    </svg>
  );
}

/**
 * The icon gallery shared by every product (Insert › Icons): categories, a search in Spanish or English, one or several icons at once, line or
 * filled, and a colour. It hands back each icon as SVG plus PNG; what to do with them is the product's.
 */
export function IconsDialog({ onPick, onClose }: { onPick: (picks: IconPick[]) => void | Promise<void>; onClose: () => void }) {
  const [data, setData] = useState<{ cat: Catalog; paths: PathsFile } | null>(null);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [style, setStyle] = useState<IconStyle>('regular');
  const [color, setColor] = useState('#1f4e79');
  const [chosen, setChosen] = useState<string[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void Promise.all([loadCatalog(), loadPaths()]).then(([cat, paths]) => live && setData({ cat, paths }));
    return () => {
      live = false;
    };
  }, []);
  const found = useMemo(() => (data ? searchIcons(data.cat, q, { category }) : []), [data, q, category]);
  useEffect(() => setShown(PAGE), [q, category]);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const insert = async (ids: string[] = chosen) => {
    if (!data || !ids.length || busy) return;
    setBusy(true);
    setError('');
    try {
      const picks: IconPick[] = [];
      for (const id of ids) {
        const info = data.cat.get(id)!;
        picks.push(await makeIconPick(data.paths, info, iconLabel(info), style, color));
      }
      await onPick(picks);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 900, width: '94vw' }}>
        <DialogBody>
          <DialogTitle>{t('Iconos')}</DialogTitle>
          <DialogContent>
            <div style={{ display: 'flex', gap: 12, alignItems: 'end', marginBottom: 8, flexWrap: 'wrap' }}>
              <label style={{ display: 'grid', gap: 2, flex: 1, minWidth: 200 }}>
                <span>{t('Buscar')}</span>
                <input aria-label={t('Buscar icono')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('casa, flecha, calendario…')} autoFocus />
              </label>
              <div role="radiogroup" aria-label={t('Estilo')} style={{ display: 'flex', gap: 4 }}>
                {(['regular', 'filled'] as const).map((s) => (
                  <Button key={s} size="small" role="radio" aria-checked={style === s} appearance={style === s ? 'primary' : 'secondary'} onClick={() => setStyle(s)}>
                    {s === 'regular' ? t('Línea') : t('Relleno')}
                  </Button>
                ))}
              </div>
              <label style={{ display: 'grid', gap: 2 }}>
                <span>{t('Color')}</span>
                <input type="color" aria-label={t('Color del icono')} value={color} onChange={(e) => setColor(e.target.value)} />
              </label>
            </div>
            {!data ? (
              <p>{t('Cargando…')}</p>
            ) : (
              <div style={{ display: 'flex', gap: 12 }}>
                <ul role="listbox" aria-label={t('Categorías')} style={{ listStyle: 'none', margin: 0, padding: 0, width: 200, maxHeight: 330, overflow: 'auto', flexShrink: 0 }}>
                  {[{ id: null as string | null, name: 'Todos', count: data.cat.icons.length }, ...data.cat.categories].map((c) => (
                    <li key={c.id ?? 'all'} role="option" aria-selected={category === c.id}>
                      <button type="button" onClick={() => setCategory(c.id)} style={{ width: '100%', textAlign: 'left', padding: '4px 8px', border: 0, borderRadius: 4, cursor: 'pointer', background: category === c.id ? 'rgba(37,99,235,.15)' : 'transparent', color: 'inherit', font: 'inherit' }}>
                        {t(c.name)} <span style={{ opacity: 0.6 }}>({c.count})</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div role="listbox" aria-multiselectable="true" aria-label={t('Iconos')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))', gap: 4, maxHeight: 330, overflow: 'auto', alignContent: 'start' }}>
                    {found.slice(0, shown).map((i) => {
                      const on = chosen.includes(i.id);
                      return (
                        <button key={i.id} type="button" role="option" aria-selected={on} aria-label={iconLabel(i)} title={iconLabel(i)} onClick={() => toggle(i.id)} onDoubleClick={() => void insert([i.id])} style={{ display: 'grid', placeItems: 'center', height: 56, border: on ? '2px solid #2563eb' : '1px solid #d0d0d0', borderRadius: 4, background: on ? 'rgba(37,99,235,.12)' : 'transparent', cursor: 'pointer' }}>
                          <Glyph info={i} paths={data.paths} style={style} color={color} />
                        </button>
                      );
                    })}
                    {found.length === 0 && <p>{t('Ningún icono coincide.')}</p>}
                    {found.length > shown && (
                      <Button style={{ gridColumn: '1 / -1' }} onClick={() => setShown((n) => n + PAGE)}>
                        {t('Mostrar más')} ({found.length - shown})
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
            {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
          </DialogContent>
          <DialogActions>
            <span aria-live="polite" style={{ marginRight: 'auto', opacity: 0.7 }}>
              {chosen.length ? t('{n} seleccionados', { n: chosen.length }) : data ? t('{n} iconos', { n: found.length }) : ''}
            </span>
            <Button onClick={onClose}>{t('Cancelar')}</Button>
            <Button appearance="primary" disabled={!chosen.length || busy} onClick={() => void insert()}>
              {chosen.length > 1 ? t('Insertar ({n})', { n: chosen.length }) : t('Insertar')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
