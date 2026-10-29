import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import type { WriterUI } from './commands';
import { Modal } from './dialogs';
import { TEMPLATES } from './templates';

export function TemplatesDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  return (
    <Modal
      title={t('Nuevo desde plantilla')}
      width={720}
      onClose={onClose}
      actions={
        <>
          <Button
            onClick={() => {
              onClose();
              void ui.openTemplateFile();
            }}
          >
            {t('Usar un archivo de plantilla (.dotx)…')}
          </Button>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
        </>
      }
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }} aria-label={t('Plantillas')}>
        {TEMPLATES.map((tpl) => (
          <li key={tpl.id}>
            <button
              className="nw-tpl"
              data-template={tpl.id}
              onClick={() => {
                onClose();
                ui.applyTemplate(tpl.build());
              }}
            >
              <strong>{t(tpl.name)}</strong>
              <span>{t(tpl.description)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
