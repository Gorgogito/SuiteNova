import { t } from '@suitenova/core-ui';
import type { UploadedFile } from '@suitenova/forms-core';
import { saveUpload, sizeText } from './uploads';

/** A file of a response, with the button that saves it. */
export function FileLine({ file, who }: { file: UploadedFile; who?: string }) {
  return (
    <li>
      <span className="fm-item">
        {who && <span className="fm-muted">{who} · </span>}
        {file.name} <span className="fm-muted">({sizeText(file.size)})</span>
      </span>
      <button type="button" aria-label={`${t('Guardar')} ${file.name}`} onClick={() => void saveUpload(file).catch((e) => window.alert((e as Error).message))}>
        {t('Guardar')}
      </button>
    </li>
  );
}
