import { t } from '@suitenova/core-ui';
import { useEffect, useState } from 'react';
import type { FormsCtl } from './ctl';
import { removeInbox, watchInbox, type InboxItem } from './inbox';

/** Offers the responses that Nova Mail left for the form on screen. */
export function InboxBanner({ ctl }: { ctl: FormsCtl }) {
  const [items, setItems] = useState<InboxItem[]>([]);
  /** The ones for other forms that were told to hide. */
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => watchInbox(setItems), []);
  const here = items.filter((i) => i.formId === ctl.form.id);
  const elsewhere = items.filter((i) => i.formId !== ctl.form.id && !hidden.includes(i.key));
  const remove = (list: InboxItem[]) => {
    const keys = list.map((i) => i.key);
    setItems((now) => now.filter((i) => !keys.includes(i.key)));
    void removeInbox(keys);
  };
  const discard = (list: InboxItem[]) => {
    if (window.confirm(t('¿Descartar las respuestas que dejó Nova Mail? Seguirán en el correo.'))) remove(list);
  };
  const add = () => {
    const r = ctl.importMany(here.map((i) => i.text));
    remove(here);
    const added = r.added === 1 ? t('1 respuesta añadida') : t('{n} respuestas añadidas', { n: r.added });
    ctl.setMode('results');
    ctl.say(r.added ? added : '');
    if (r.warnings.length || !r.added) window.alert((r.added ? added : t('No se añadió ninguna respuesta.')) + (r.warnings.length ? '\n\n' + r.warnings.join('\n') : ''));
  };
  if (!here.length && !elsewhere.length) return null;
  const from = [...new Set(here.map((i) => i.from).filter(Boolean))];
  return (
    <div className="fm-card fm-notice fm-inbox nv-work" role="region" aria-label={t('Respuestas del correo')}>
      {here.length > 0 ? (
        <>
          <p>
            {here.length === 1 ? t('Nova Mail dejó 1 respuesta para este formulario.') : t('Nova Mail dejó {n} respuestas para este formulario.', { n: here.length })}
            {from.length > 0 && <span className="fm-muted"> {t('De: {list}', { list: from.slice(0, 5).join(', ') + (from.length > 5 ? '…' : '') })}</span>}
          </p>
          <button type="button" className="fm-btn" onClick={add}>
            {t('Añadirlas')}
          </button>
          <button type="button" className="fm-btn fm-btn--sec" onClick={() => discard(here)}>
            {t('Descartarlas')}
          </button>
        </>
      ) : (
        <>
          <p>{elsewhere.length === 1 ? t('Hay 1 respuesta del correo para otro formulario. Ábrelo y aparecerá aquí.') : t('Hay {n} respuestas del correo para otro formulario. Ábrelo y aparecerán aquí.', { n: elsewhere.length })}</p>
          <button type="button" className="fm-btn fm-btn--sec" onClick={() => setHidden([...hidden, ...elsewhere.map((i) => i.key)])}>
            {t('Ocultar')}
          </button>
          <button type="button" className="fm-btn fm-btn--sec" onClick={() => discard(elsewhere)}>
            {t('Descartarlas')}
          </button>
        </>
      )}
    </div>
  );
}
