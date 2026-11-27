import { t } from '@suitenova/core-ui';
import type { Attachment } from '@suitenova/mail-core';
import { useMemo, useState } from 'react';
import { MAX_INBOX_BYTES, inboxItem, putInbox, type InboxItem } from '../forms/inbox';
import { openModuleWindow } from '../platform';

/** The Nova Forms response files among the attachments of a message, ready to be left for Forms. */
export function formResponses(attachments: Attachment[], from: string): InboxItem[] {
  return attachments.flatMap((a) => {
    if (!/\.json$/i.test(a.filename) || a.data.length > MAX_INBOX_BYTES) return [];
    return inboxItem(new TextDecoder('utf-8').decode(a.data), from) ?? [];
  });
}

/** Passes the responses attached to a message to Nova Forms, where the person adds them to the form. */
export function FormResponses({ attachments, from }: { attachments: Attachment[]; from: string }) {
  const items = useMemo(() => formResponses(attachments, from), [attachments, from]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  if (!items.length) return null;
  return (
    <div className="ml-remote ml-forms" role="note">
      <span>{items.length === 1 ? t('Este mensaje trae 1 respuesta de un formulario.') : t('Este mensaje trae {n} respuestas de formularios.', { n: items.length })}</span>{' '}
      {done ? (
        <>
          <span role="status">{t('Lista para Nova Forms: abre allí el formulario y añádela.')}</span>{' '}
          <button type="button" onClick={() => void openModuleWindow('forms', 'Nova Forms')}>
            {t('Abrir Nova Forms')}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() =>
            void putInbox(items).then(
              () => (setError(''), setDone(true)),
              (e: unknown) => setError(String(e)),
            )
          }
        >
          {t('Pasar a Nova Forms')}
        </button>
      )}
      {error && <span role="alert"> {t('No se pudo pasar: {error}', { error })}</span>}
    </div>
  );
}
