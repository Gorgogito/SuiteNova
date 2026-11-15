import { Button } from '@fluentui/react-components';
import { MAX_ATTACHMENTS_PER_FIELD, MAX_ATTACHMENT_BYTES, addAttachment, attachmentBytes, parseAttachments, serializeAttachments, type Attachment } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useRef, useState } from 'react';
import type { BaseCtl } from './ctl';
import { Dlg } from './dlg-sheet';

const sizeText = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** The files kept in an attachment field of one record (as the Attachments window of Access): add, save a copy, remove. */
export function AttachmentsDialog({ ctl, table, rid, column, onClose, onChanged }: { ctl: BaseCtl; table: string; rid: number; column: string; onClose: () => void; onChanged?: () => void }) {
  const db = ctl.db!;
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [, bump] = useState(0);
  const stored = (): string | null => {
    const r = db.execute(`SELECT "${column.replace(/"/g, '""')}" FROM "${table.replace(/"/g, '""')}" WHERE rowid = ${Math.trunc(rid)}`);
    const v = r.rows[0]?.[0];
    return typeof v === 'string' ? v : null;
  };
  const list = parseAttachments(stored());
  const write = (next: string | null) => {
    db.updateCell(table, rid, column, next);
    bump((n) => n + 1);
    ctl.touch();
    onChanged?.();
  };
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    let value = stored();
    const problems: string[] = [];
    for (const f of Array.from(files)) {
      try {
        value = addAttachment(value, { name: f.name, mime: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
      } catch (e) {
        problems.push((e as Error).message);
      }
    }
    try {
      write(value);
    } catch (e) {
      problems.push((e as Error).message);
    }
    setMsg(problems.join(' '));
  };
  const save = (a: Attachment) => {
    const url = URL.createObjectURL(new Blob([attachmentBytes(a) as BlobPart], { type: a.mime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = a.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const remove = (i: number) => write(serializeAttachments(list.filter((_, j) => j !== i)));
  return (
    <Dlg
      title={`${t('Datos adjuntos')}: ${column}`}
      onClose={onClose}
      actions={
        <>
          <Button disabled={list.length >= MAX_ATTACHMENTS_PER_FIELD} onClick={() => input.current?.click()}>
            {t('Agregar archivos…')}
          </Button>
          <Button appearance="primary" onClick={onClose}>
            {t('Cerrar')}
          </Button>
        </>
      }
    >
      <input ref={input} type="file" multiple hidden aria-label={t('Archivos a adjuntar')} onChange={(e) => (void add(e.target.files), (e.target.value = ''))} />
      <p className="bs-hint">{t('Hasta {n} archivos de {mb} MB cada uno; se guardan dentro de la base de datos.', { n: MAX_ATTACHMENTS_PER_FIELD, mb: MAX_ATTACHMENT_BYTES / 1024 / 1024 })}</p>
      {msg && (
        <p role="alert" className="bs-error">
          {msg}
        </p>
      )}
      {list.length === 0 ? (
        <p>{t('Este registro no tiene archivos adjuntos.')}</p>
      ) : (
        <table className="bs-attlist" aria-label={t('Archivos adjuntos')}>
          <thead>
            <tr>
              <th scope="col">{t('Nombre')}</th>
              <th scope="col">{t('Tamaño')}</th>
              <th scope="col">
                <span className="bs-sr">{t('Acciones')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((a, i) => (
              <tr key={a.name}>
                <td>{a.name}</td>
                <td>{sizeText(a.size)}</td>
                <td>
                  <Button size="small" aria-label={t('Guardar una copia de {n}', { n: a.name })} onClick={() => save(a)}>
                    {t('Guardar copia…')}
                  </Button>
                  <Button size="small" aria-label={t('Quitar {n}', { n: a.name })} onClick={() => remove(i)}>
                    {t('Quitar')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dlg>
  );
}
