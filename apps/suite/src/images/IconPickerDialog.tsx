import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useEffect, useState } from 'react';
import { findIcons, iconFile, iconSet, type IconComponent } from './sources';

/** The icon picker shared by every product: search the set, choose a colour and hand back a PNG file. */
export function IconPickerDialog({ onPick, onClose }: { onPick: (file: File) => void; onClose: () => void }) {
  const [all, setAll] = useState<Record<string, IconComponent> | null>(null);
  const [q, setQ] = useState('');
  const [color, setColor] = useState('#1f4e79');
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void iconSet().then(setAll);
  }, []);
  const names = all ? findIcons(all, q) : [];
  const insert = async () => {
    if (!all || !picked || busy) return;
    setBusy(true);
    try {
      onPick(await iconFile(all, picked, color));
      onClose();
    } catch (e) {
      window.alert((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 820, width: '92vw' }}>
        <DialogBody>
          <DialogTitle>{t('Iconos')}</DialogTitle>
          <DialogContent>
            <div style={{ display: 'flex', gap: 12, alignItems: 'end', marginBottom: 8 }}>
              <label style={{ display: 'grid', gap: 2, flex: 1 }}>
                <span>{t('Buscar (en inglés)')}</span>
                <input aria-label={t('Buscar icono')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="arrow, user, chart…" />
              </label>
              <label style={{ display: 'grid', gap: 2 }}>
                <span>{t('Color')}</span>
                <input type="color" aria-label={t('Color del icono')} value={color} onChange={(e) => setColor(e.target.value)} />
              </label>
            </div>
            {!all ? (
              <p>{t('Cargando…')}</p>
            ) : (
              <div role="listbox" aria-label={t('Iconos')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))', gap: 4, maxHeight: 300, overflow: 'auto' }}>
                {names.map((n) => {
                  const I = all[n]!;
                  return (
                    <button key={n} type="button" role="option" aria-selected={picked === n} aria-label={n} title={n} onClick={() => setPicked(n)} onDoubleClick={() => void insert()} style={{ display: 'grid', placeItems: 'center', height: 52, border: picked === n ? '2px solid #2563eb' : '1px solid #d0d0d0', borderRadius: 4, background: 'transparent', cursor: 'pointer' }}>
                      <I size={26} color={color} />
                    </button>
                  );
                })}
                {names.length === 0 && <p>{t('Ningún icono coincide.')}</p>}
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t('Cancelar')}</Button>
            <Button appearance="primary" disabled={!picked || busy} onClick={() => void insert()}>
              {t('Insertar')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
