import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { sendLaterPresets, type MailRecord } from '@suitenova/mail-core';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { DELAY_CHOICES, type WatchState } from './alerts';
import { dateStr, parseLocal, timeStr } from './dates';
import type { MailCtl } from './ctl';
import { systemNotices } from './notify';
import { protocolOf } from './remote';

/* Sending later, taking a message back before it leaves, and the options of notices and sending. */

const clock = (at: number) => new Date(at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const inBox = (at: number) => `${dateStr(at)}T${timeStr(at)}`;

/** Chooses when a message leaves. */
export function LaterDialog({ initial, onPick, onClose }: { initial?: number; onPick: (at: number) => void; onClose: () => void }) {
  const [presets] = useState(() => sendLaterPresets(Date.now()));
  const [when, setWhen] = useState(() => inBox(initial && initial > Date.now() ? initial : presets.at(-1)!.at));
  const [err, setErr] = useState('');
  const pick = () => {
    const [day, time] = when.split('T');
    const at = day ? parseLocal(day, time ?? '08:00') : NaN;
    if (!Number.isFinite(at) || at <= Date.now()) return setErr(t('Elige un momento que todavía no haya pasado.'));
    onPick(at);
  };
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 480, width: '92vw' }}>
        <DialogBody>
          <DialogTitle>{t('Enviar más tarde')}</DialogTitle>
          <DialogContent>
            <form
              className="ml-form"
              onSubmit={(e) => {
                e.preventDefault();
                pick();
              }}
            >
              <div className="ml-presets" role="group" aria-label={t('Momentos habituales')}>
                {presets.map((p) => (
                  <button key={p.label} type="button" className="ml-btn" onClick={() => onPick(p.at)}>
                    {t(p.label)} <em>{clock(p.at)}</em>
                  </button>
                ))}
              </div>
              <label>
                <span>{t('El día y la hora')}</span>
                <input
                  type="datetime-local"
                  aria-label={t('El día y la hora')}
                  value={when}
                  onChange={(e) => {
                    setWhen(e.target.value);
                    setErr('');
                  }}
                />
              </label>
              <p className="ml-hint">{t('El mensaje espera en la Bandeja de salida y solo sale si Nova Mail está abierto a esa hora (o poco después: si pasa más de un día, no se envía sin preguntar).')}</p>
              {err && (
                <div className="ml-error" role="alert">
                  {err}
                </div>
              )}
              <button type="submit" hidden />
            </form>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t('Cancelar')}</Button>
            <Button appearance="primary" onClick={pick}>
              {t('Programar')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** While a message can still be taken back: how long is left, and the way to stop it. */
export function UndoSend({ ctl }: { ctl: MailCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const m: MailRecord | null = ctl.outbox.undoable;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!m) return;
    const timer = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, [m?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return null;
  const left = Math.max(1, Math.ceil((m.outgoing!.at - Date.now()) / 1000));
  const subject = m.subject || t('(sin asunto)');
  return (
    <div className="ml-undo" role="region" aria-label={t('Envío en espera')}>
      {/* said once to screen readers; the count is only seen */}
      <span role="status" className="ml-sr">
        {t('«{subject}» se enviará en unos segundos.', { subject })}
      </span>
      <span aria-hidden="true">{t('Enviando «{subject}» en {n} s', { subject, n: left })}</span>
      <button type="button" className="ml-btn ml-btn--primary" onClick={() => ctl.outbox.takeBack(m.id)}>
        {t('Deshacer envío')}
      </button>
      <button type="button" className="ml-btn" onClick={() => void ctl.outbox.sendNow(m.id)}>
        {t('Enviar ya')}
      </button>
    </div>
  );
}

const WATCH: Record<WatchState, string> = { instant: 'al instante', polling: 'cada cierto tiempo (el servidor no avisa)', retrying: 'sin conexión: se reintenta' };

export function OptionsForm({ ctl, onClose }: { ctl: MailCtl; onClose: () => void }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const s = ctl.alerts.settings;
  const system = systemNotices();
  const box = (key: 'newMail' | 'system' | 'instant', label: string, disabled = false) => (
    <label className="ml-check">
      <input type="checkbox" checked={s[key] && !disabled} disabled={disabled} onChange={(e) => ctl.alerts.set({ [key]: e.target.checked })} /> {label}
    </label>
  );
  return (
    <>
      <DialogTitle>{t('Avisos y envío')}</DialogTitle>
      <DialogContent>
        <div className="ml-form">
          {box('newMail', t('Avisar cuando llegue correo nuevo'))}
          {box('system', t('Usar también los avisos de Windows (correo, recordatorios y envíos que fallan)'), !system)}
          {!system && <p className="ml-hint">{t('Los avisos de Windows solo están en la aplicación de escritorio en Windows.')}</p>}
          {box('instant', t('Recibir al instante de los servidores IMAP que pueden avisar (IDLE)'))}
          {s.instant && ctl.accounts.length > 0 && (
            <ul className="ml-watch" aria-label={t('Cómo se recibe cada cuenta')}>
              {ctl.accounts.map((a) => {
                const state = ctl.alerts.watching.get(a.id);
                return (
                  <li key={a.id}>
                    <strong>{a.name}</strong>: {protocolOf(a) !== 'imap' ? t('cada cierto tiempo') : state ? t(WATCH[state]) : t('conectando…')}
                  </li>
                );
              })}
            </ul>
          )}
          <label>
            <span>{t('Retrasar el envío para poder deshacerlo')}</span>
            <select aria-label={t('Retrasar el envío para poder deshacerlo')} value={s.delay} onChange={(e) => ctl.alerts.set({ delay: Number(e.target.value) })}>
              {DELAY_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n ? t('{n} segundos', { n }) : t('No retrasar')}
                </option>
              ))}
            </select>
          </label>
          <p className="ml-hint">{t('Todo esto funciona solo mientras Nova Mail está abierto.')}</p>
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
