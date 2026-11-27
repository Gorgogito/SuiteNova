import { Button, DialogActions, DialogContent, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { displayName, findDuplicates } from '@suitenova/mail-core';
import { useState, useSyncExternalStore } from 'react';
import { Avatar } from './ContactsView';
import type { MailCtl } from './ctl';

/** The people who seem to be there more than once, to join the ones the person says. */
export function DuplicatesDialog({ ctl, onClose }: { ctl: MailCtl; onClose: () => void }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const found = findDuplicates(ctl.data.contacts);
  /** What the person said, by group; a shared address is joined unless they say otherwise, a shared name is not. */
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState('');
  const keyOf = (ids: string[]) => ids.join('|');
  const groups = found.map((g) => {
    const ids = g.contacts.map((c) => c.id);
    return { ...g, ids, key: keyOf(ids), on: choices[keyOf(ids)] ?? g.reason === 'email' };
  });
  const chosen = groups.filter((g) => g.on);
  return (
    <>
      <DialogTitle>{t('Contactos duplicados')}</DialogTitle>
      <DialogContent>
        <div className="ml-form ml-dups">
          {groups.length === 0 ? (
            <p>{t('No hay contactos duplicados.')}</p>
          ) : (
            <p className="ml-hint">{t('Cada grupo marcado se junta en un solo contacto con todos sus correos y teléfonos; lo que no coincida se anota en sus notas. Se puede deshacer con Ctrl+Z.')}</p>
          )}
          {groups.map((g) => (
            <fieldset key={g.key}>
              <legend>{g.reason === 'email' ? t('Comparten una dirección de correo') : t('Se llaman igual (podrían ser personas distintas)')}</legend>
              <label className="ml-check">
                <input type="checkbox" checked={g.on} onChange={(e) => setChoices({ ...choices, [g.key]: e.target.checked })} /> {t('Combinar estos {n}', { n: g.contacts.length })}
              </label>
              <ul>
                {g.contacts.map((c) => (
                  <li key={c.id}>
                    <Avatar c={c} />
                    <span>
                      <strong>{displayName(c)}</strong>
                      <em>{[...c.emails.map((e) => e.value), ...c.phones.map((p) => p.value), c.org].filter(Boolean).join(' · ')}</em>
                    </span>
                  </li>
                ))}
              </ul>
            </fieldset>
          ))}
          {done && <p role="status">{done}</p>}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Cerrar')}</Button>
        {groups.length > 0 && (
          <Button
            appearance="primary"
            disabled={!chosen.length}
            onClick={() => {
              const n = ctl.people.merge(chosen.map((g) => g.ids));
              setDone(t('Se combinaron {n} contactos.', { n }));
            }}
          >
            {t('Combinar los marcados')}
          </Button>
        )}
      </DialogActions>
    </>
  );
}
