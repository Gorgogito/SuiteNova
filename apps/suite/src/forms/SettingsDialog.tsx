import { Button, DialogActions, DialogContent, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { BACKGROUNDS, LANGUAGES, MAX_TIME_LIMIT, availability, type Background, type Form, type Lang } from '@suitenova/forms-core';
import { useState, useSyncExternalStore } from 'react';
import { backgroundFrom } from './background';
import type { FormsCtl } from './ctl';

/** A moment as a box of date and time writes it (local time). */
const toBox = (iso: string | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
};
const fromBox = (value: string): string | undefined => (value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined);

/** How the form takes answers and how it looks. Every change can be undone. */
export function SettingsBody({ ctl, onClose }: { ctl: FormsCtl; onClose: () => void }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const f = ctl.form;
  const [err, setErr] = useState('');
  const set = (patch: Partial<Form>, typing = false) => ctl.setForm(patch, typing);
  const check = (label: string, checked: boolean, change: (on: boolean) => void) => (
    <label className="fm-check">
      <input type="checkbox" checked={checked} onChange={(e) => change(e.target.checked)} /> {label}
    </label>
  );
  const moment = (key: 'start' | 'end', label: string) => (
    <label className="fm-field">
      <span>{label}</span>
      <input className="fm-input" type="datetime-local" aria-label={label} value={toBox(f[key])} onChange={(e) => set({ [key]: fromBox(e.target.value) }, true)} />
    </label>
  );
  const wrongDates = !!f.start && !!f.end && Date.parse(f.end) <= Date.parse(f.start);
  const now = availability(f, Date.now());
  return (
    <>
      <DialogTitle>{t('Ajustes del formulario')}</DialogTitle>
      <DialogContent>
        <div className="fm-editor fm-settings">
          <fieldset className="fm-fieldset">
            <legend>{t('Respuestas')}</legend>
            <p className="fm-muted" role="status">
              {now === 'open' ? t('Ahora mismo admite respuestas.') : now === 'notYet' ? t('Ahora mismo todavía no admite respuestas.') : t('Ahora mismo no admite respuestas.')}
            </p>
            {check(t('Admitir respuestas'), !f.closed, (on) => set({ closed: !on || undefined }))}
            <label className="fm-field">
              <span>{t('Mensaje cuando no se admiten')}</span>
              <input className="fm-input" aria-label={t('Mensaje cuando no se admiten')} maxLength={1000} value={f.closedMessage ?? ''} placeholder={t('Este formulario ya no admite respuestas.')} onChange={(e) => set({ closedMessage: e.target.value || undefined }, true)} />
            </label>
            <div className="fm-row">
              {moment('start', t('Empieza a admitir respuestas'))}
              {moment('end', t('Deja de admitirlas'))}
            </div>
            {wrongDates && (
              <p className="fm-err" role="alert">
                {t('El final es anterior al principio: nunca admitiría respuestas.')}
              </p>
            )}
            <label className="fm-field fm-inline">
              <span>{t('Tiempo límite en minutos')}</span>
              <input
                className="fm-input fm-narrow"
                type="number"
                min={1}
                max={MAX_TIME_LIMIT}
                aria-label={t('Tiempo límite en minutos')}
                value={f.timeLimit ?? ''}
                placeholder={t('Sin límite')}
                onChange={(e) => {
                  const n = Math.floor(Number(e.target.value));
                  set({ timeLimit: n >= 1 ? Math.min(MAX_TIME_LIMIT, n) : undefined }, true);
                }}
              />
            </label>
            {check(t('Pedir el nombre de quien responde'), !!f.askName, (on) => set({ askName: on || undefined }))}
            {check(t('Permitir enviar otra respuesta'), !f.noAgain, (on) => set({ noAgain: !on || undefined }))}
            {check(t('Ofrecer imprimir o guardar las respuestas al terminar'), !!f.receipt, (on) => set({ receipt: on || undefined }))}
            <p className="fm-muted">{t('En una página guardada, las fechas, el tiempo límite y la única respuesta se pueden saltar (cambiando la hora del equipo o recargando): orientan, no impiden.')}</p>
          </fieldset>
          <fieldset className="fm-fieldset">
            <legend>{t('Aspecto')}</legend>
            <label className="fm-field fm-inline">
              <span>{t('Fondo')}</span>
              <select className="fm-input" aria-label={t('Fondo')} value={f.background ?? ''} onChange={(e) => (setErr(''), set({ background: (e.target.value || undefined) as Background | undefined }))}>
                <option value="">{t('Liso')}</option>
                {BACKGROUNDS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {t(b.name)}
                  </option>
                ))}
              </select>
            </label>
            {f.background === 'image' && (
              <div className="fm-row">
                <input
                  type="file"
                  className="fm-file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  aria-label={t('Elegir imagen de fondo')}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file)
                      backgroundFrom(file).then(
                        (backgroundImage) => (setErr(''), set({ backgroundImage })),
                        (x: Error) => setErr(t(x.message)),
                      );
                  }}
                />
                {f.backgroundImage ? (
                  <>
                    <img className="fm-bgthumb" src={f.backgroundImage} alt={t('Imagen de fondo actual')} />
                    <button type="button" className="fm-add" onClick={() => set({ backgroundImage: undefined })}>
                      {t('Quitar la imagen')}
                    </button>
                  </>
                ) : (
                  <span className="fm-muted">{t('Elige una imagen: hasta que la haya, el fondo es liso.')}</span>
                )}
              </div>
            )}
            {err && (
              <p className="fm-err" role="alert">
                {err}
              </p>
            )}
            <label className="fm-field fm-inline">
              <span>{t('Idioma para quien responde')}</span>
              <select className="fm-input" aria-label={t('Idioma para quien responde')} value={f.language ?? 'es'} onChange={(e) => set({ language: e.target.value as Lang })}>
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        </div>
      </DialogContent>
      <DialogActions>
        <Button appearance="primary" onClick={onClose}>
          {t('Cerrar')}
        </Button>
      </DialogActions>
    </>
  );
}
