import { Button, DialogActions, DialogContent, DialogTitle } from '@fluentui/react-components';
import { t, useLocale } from '@suitenova/core-ui';
import { isInput, templates, type Form } from '@suitenova/forms-core';
import { useMemo } from 'react';

/** Ready-made forms, in the language of the program. */
export function TemplatesBody({ onChoose, onClose }: { onChoose: (form: Form) => void; onClose: () => void }) {
  const locale = useLocale();
  const list = useMemo(() => templates(locale === 'en' ? 'en' : 'es').map((x) => ({ ...x, questions: x.make().questions.filter(isInput).length })), [locale]);
  return (
    <>
      <DialogTitle>{t('Nuevo desde plantilla')}</DialogTitle>
      <DialogContent>
        <ul className="fm-editor fm-templates" aria-label={t('Plantillas')}>
          {list.map((x) => (
            <li key={x.id}>
              <div>
                <strong>{x.name}</strong>
                <p className="fm-muted">
                  {x.description} {t('{n} preguntas', { n: x.questions })}.
                </p>
              </div>
              <button type="button" className="fm-add" aria-label={t('Usar la plantilla «{name}»', { name: x.name })} onClick={() => onChoose(x.make())}>
                {t('Usar')}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
      <DialogActions>
        <Button appearance="primary" onClick={onClose}>
          {t('Cerrar')}
        </Button>
      </DialogActions>
    </>
  );
}
