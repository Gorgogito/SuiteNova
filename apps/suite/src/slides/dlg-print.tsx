import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useState } from 'react';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';
import { DEFAULT_PRINT, parseRange, printWith, type PrintOpts, type PrintWhat } from './export/printing';

const WHAT: [PrintWhat, string][] = [
  ['slides', 'Diapositivas (una por página)'],
  ['notes', 'Páginas de notas'],
  ['handout', 'Documentos para distribuir (varias por página)'],
  ['outline', 'Esquema (solo el texto)'],
];

/** Print: what to print, which slides and how. Also the way to save a PDF (choose "Save as PDF" in the system dialog). */
export function PrintDialog({ ui, onClose }: { ui: SlidesUI; onClose: () => void }) {
  const c = ui.ctl;
  const [o, setO] = useState<PrintOpts>(DEFAULT_PRINT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (p: Partial<PrintOpts>) => setO((x) => ({ ...x, ...p }));
  const valid = !!parseRange(o.range, c.realDeck.slides.length, c.index);
  const go = async () => {
    setBusy(true);
    setError('');
    const r = await printWith(c, o);
    setBusy(false);
    if (r.error) setError(t(r.error));
    else onClose();
  };
  return (
    <Modal
      title={t('Imprimir')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={busy || !valid} onClick={() => void go()}>
            {busy ? t('Preparando…') : t('Imprimir')}
          </Button>
        </>
      }
    >
      <div className="sl-form">
        <div role="radiogroup" aria-label={t('Qué imprimir')}>
          {WHAT.map(([k, label]) => (
            <label key={k} className="sl-check" style={{ display: 'block' }}>
              <input type="radio" name="pr-what" checked={o.what === k} onChange={() => set({ what: k })} /> {t(label)}
            </label>
          ))}
        </div>
        {o.what === 'handout' && (
          <label className="sl-field">
            <span>{t('Diapositivas por página')}</span>
            <select aria-label={t('Diapositivas por página')} value={o.per} onChange={(e) => set({ per: Number(e.target.value) })}>
              {[1, 2, 3, 4, 6, 9].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="sl-field">
          <span>{t('Diapositivas (todas, actual o un intervalo como 1-3, 5)')}</span>
          <input aria-label={t('Intervalo de diapositivas')} value={o.range} aria-invalid={!valid} onChange={(e) => set({ range: e.target.value })} />
        </label>
        <label className="sl-check">
          <input type="checkbox" checked={o.hidden} onChange={(e) => set({ hidden: e.target.checked })} /> {t('Imprimir las diapositivas ocultas')}
        </label>
        <label className="sl-check">
          <input type="checkbox" checked={o.frame} disabled={o.what === 'slides' || o.what === 'outline'} onChange={(e) => set({ frame: e.target.checked })} /> {t('Poner un marco a las diapositivas')}
        </label>
        <label className="sl-check">
          <input type="checkbox" checked={o.gray} disabled={o.what === 'outline'} onChange={(e) => set({ gray: e.target.checked })} /> {t('Escala de grises')}
        </label>
        <p className="sl-note">{t('Se abre el cuadro de impresión del sistema; elige allí la impresora o «Guardar como PDF». No se imprimen animaciones, y el encabezado y pie de página de las notas y los folletos no están disponibles.')}</p>
        <p className="sl-note" role="alert">{error}</p>
      </div>
    </Modal>
  );
}
