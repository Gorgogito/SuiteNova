import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useRef, useState } from 'react';
import type { BaseCtl } from './ctl';
import { Dlg } from './dlg-sheet';

const MAX = 5_000_000;

/** The text files of the code (Open, Print #, Input #…): they live inside the database. View, import, save a copy, delete. */
export function FilesDialog({ ctl }: { ctl: BaseCtl }) {
  const db = ctl.db!;
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const names = db.objects('file');
  const text = sel ? (db.getObject<{ text: string }>('file', sel)?.text ?? '') : '';
  const close = () => {
    ctl.xDialog = null;
    ctl.touch();
  };
  const refresh = () => ctl.touch();
  const importFile = async (f: File) => {
    if (f.size > MAX) return setMsg(t('El archivo pesa más de 5 MB.'));
    const body = await f.text();
    const exists = names.find((n) => n.toLowerCase() === f.name.toLowerCase());
    db.saveObject('file', exists ?? f.name, { text: body });
    setSel(exists ?? f.name);
    setMsg('');
    refresh();
  };
  const save = () => {
    if (!sel) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = sel;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const remove = () => {
    if (!sel || !window.confirm(t('¿Eliminar el archivo "{n}"?', { n: sel }))) return;
    db.deleteObject('file', sel);
    setSel(null);
    refresh();
  };
  return (
    <Dlg
      title={t('Archivos del código')}
      onClose={close}
      actions={
        <>
          <Button onClick={() => input.current?.click()}>{t('Importar un archivo…')}</Button>
          <Button disabled={!sel} onClick={save}>
            {t('Guardar una copia…')}
          </Button>
          <Button disabled={!sel} onClick={remove}>
            {t('Eliminar')}
          </Button>
          <Button appearance="primary" onClick={close}>
            {t('Cerrar')}
          </Button>
        </>
      }
    >
      <input ref={input} type="file" hidden aria-label={t('Archivo a importar')} accept=".txt,.csv,.tsv,.json,.xml,.log,.md,.html,.sql,text/*" onChange={(e) => (e.target.files?.[0] ? void importFile(e.target.files[0]) : undefined, (e.target.value = ''))} />
      <p className="bs-hint">{t('El código no toca el disco: lee y escribe aquí. Cada archivo se guarda dentro de la base de datos.')}</p>
      {msg && (
        <p role="alert" className="bs-error">
          {msg}
        </p>
      )}
      {names.length === 0 ? (
        <p>{t('No hay archivos. Se crean con Open … For Output desde un módulo, o importando uno.')}</p>
      ) : (
        <div className="bs-dlgform" style={{ gridTemplateColumns: '220px 1fr' }}>
          <ul className="bs-filelist" aria-label={t('Archivos')}>
            {names.map((n) => (
              <li key={n}>
                <button type="button" className={n === sel ? 'is-on' : ''} aria-pressed={n === sel} onClick={() => setSel(n)}>
                  {n}
                </button>
              </li>
            ))}
          </ul>
          <textarea readOnly aria-label={t('Contenido del archivo')} value={sel ? text.slice(0, 20000) : ''} placeholder={t('Elija un archivo para ver su contenido.')} style={{ minHeight: 200, fontFamily: 'Consolas, monospace' }} />
        </div>
      )}
    </Dlg>
  );
}
