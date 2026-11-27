import { Button, DialogActions, DialogContent, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { availability, isInput } from '@suitenova/forms-core';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { collectBridge, type Address, type Collector } from './collect';
import type { FormsCtl } from './ctl';
import { Qr } from './Qr';

/** Turning the collecting on the local network on and off, with the address to share and what has arrived. */
export function CollectBody({ ctl, collector, needsFile, onSave, onClose }: { ctl: FormsCtl; collector: Collector; /** In the desktop application responses are written as they arrive: there has to be a file. */ needsFile: boolean; onSave: () => void; onClose: () => void }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  useSyncExternalStore(collector.subscribe, collector.getVersion);
  const bridge = collectBridge();
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [large, setLarge] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let gone = false;
    void bridge?.addresses().then(
      (list) => {
        if (gone) return;
        setAddresses(list);
        setChosen((now) => now || (list.find((a) => a.main) ?? list[0])?.ip || '');
      },
      () => !gone && setAddresses([]),
    );
    return () => {
      gone = true;
    };
  }, [bridge]);

  const noQuestions = !ctl.form.questions.some(isInput);
  const noFile = needsFile && !ctl.filePath?.toLowerCase().endsWith('.novaforms');
  const open = availability(ctl.form, Date.now()) === 'open';
  const local = chosen === '127.0.0.1';
  return (
    <>
      <DialogTitle>{t('Recoger por la red local')}</DialogTitle>
      <DialogContent>
        <div className="fm-editor fm-collect">
          {!bridge ? (
            <p>{t('Recoger por la red local solo funciona en la aplicación de escritorio. Aquí puedes exportar la página web e importar las respuestas que te devuelvan.')}</p>
          ) : !collector.running ? (
            <>
              <p>{t('Quienes estén en tu misma red (Wi-Fi o cable) abren una dirección, responden desde su navegador y las respuestas llegan solas a este formulario.')}</p>
              <ul>
                <li>{t('Solo mientras esta ventana siga abierta y el equipo encendido.')}</li>
                <li>
                  <strong>{t('No hay cifrado:')}</strong> {t('en esa red, otras personas podrían ver lo que se envía. No lo uses en redes públicas ni para datos delicados.')}
                </li>
                <li>{t('La primera vez, Windows puede preguntar por el cortafuegos: permite solo las redes privadas.')}</li>
              </ul>
              <label className="fm-field fm-inline">
                <span>{t('Dirección de este equipo')}</span>
                <select className="fm-input" aria-label={t('Dirección de este equipo')} value={chosen} onChange={(e) => setChosen(e.target.value)}>
                  {(addresses ?? []).map((a) => (
                    <option key={a.ip} value={a.ip}>
                      {a.ip === '127.0.0.1' ? `${a.ip} — ${t('solo este equipo (para probar)')}` : `${a.ip} — ${a.name}${a.main ? ` (${t('recomendada')})` : ''}`}
                    </option>
                  ))}
                </select>
              </label>
              {addresses && !addresses.some((a) => a.ip !== '127.0.0.1') && (
                <p className="fm-muted" role="note">
                  {t('No se encontró ninguna red local: conecta el equipo a una Wi-Fi o a un cable.')}
                </p>
              )}
              {noQuestions && (
                <p className="fm-err" role="alert">
                  {t('Añade al menos una pregunta antes de recoger respuestas.')}
                </p>
              )}
              {noFile && (
                <p className="fm-err" role="alert">
                  {t('Guarda primero el formulario: cada respuesta se escribe en su archivo al llegar.')}{' '}
                  <button type="button" className="fm-add" onClick={onSave}>
                    {t('Guardar…')}
                  </button>
                </p>
              )}
              {!open && (
                <p className="fm-muted" role="note">
                  {t('El formulario no admite respuestas ahora: quien abra la dirección verá el aviso de cerrado.')}
                </p>
              )}
              {collector.stopped && (
                <p className="fm-muted" role="status">
                  {collector.stopped}
                </p>
              )}
              {collector.error && (
                <p className="fm-err" role="alert">
                  {t(collector.error)}
                </p>
              )}
            </>
          ) : (
            <>
              <p role="status">{local || collector.url.startsWith('http://127.') ? t('Recogiendo respuestas solo en este equipo.') : t('Recogiendo respuestas. Comparte esta dirección o el código con quienes estén en tu red.')}</p>
              <div className="fm-row">
                <input className="fm-input fm-url" readOnly aria-label={t('Dirección para responder')} value={collector.url} onFocus={(e) => e.target.select()} />
                <button
                  type="button"
                  className="fm-add"
                  onClick={() =>
                    void navigator.clipboard?.writeText(collector.url).then(
                      () => setCopied(true),
                      () => undefined,
                    )
                  }
                >
                  {copied ? t('Copiada') : t('Copiar dirección')}
                </button>
              </div>
              <div className="fm-qrbox">
                <Qr text={collector.url} label={t('Código QR de la dirección')} size={large ? 420 : 200} />
                <button type="button" className="fm-add" aria-pressed={large} onClick={() => setLarge(!large)}>
                  {large ? t('Código más pequeño') : t('Código más grande')}
                </button>
              </div>
              <p className="fm-count" role="status" aria-label={t('Respuestas recibidas')}>
                <strong>{collector.received}</strong> {collector.received === 1 ? t('respuesta recibida') : t('respuestas recibidas')}
                {collector.lastAt !== null && <span className="fm-muted"> · {t('la última a las {time}', { time: new Date(collector.lastAt).toLocaleTimeString() })}</span>}
              </p>
              {collector.refused > 0 && (
                <p className="fm-muted">
                  {t('Rechazadas: {n}. La última: {why}', { n: collector.refused, why: collector.lastRefusal })}
                </p>
              )}
              {collector.error && (
                <p className="fm-err" role="alert">
                  {t(collector.error)}
                </p>
              )}
              <p className="fm-muted">{t('Puedes cerrar este cuadro: se sigue recogiendo hasta que pulses «Dejar de recoger» o cierres la ventana. Los cambios del formulario se aplican a quien abra la dirección después.')}</p>
            </>
          )}
        </div>
      </DialogContent>
      <DialogActions>
        {bridge && !collector.running && (
          <Button appearance="primary" disabled={noQuestions || noFile || !chosen || collector.starting} onClick={() => void collector.start(chosen)}>
            {t('Empezar a recoger')}
          </Button>
        )}
        {collector.running && <Button onClick={() => void collector.stop()}>{t('Dejar de recoger')}</Button>}
        {collector.running && (
          <Button
            onClick={() => {
              ctl.setMode('results');
              onClose();
            }}
          >
            {t('Ver las respuestas')}
          </Button>
        )}
        <Button appearance={collector.running ? 'primary' : 'secondary'} onClick={onClose}>
          {t('Cerrar')}
        </Button>
      </DialogActions>
    </>
  );
}
