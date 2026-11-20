import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { hasPositions, packResult, tableFromWords, unpackResult, type Box, type OcrResult } from '@suitenova/ocr-core';
import { useEffect, useRef, useState } from 'react';
import { clipboardImage, screenshot, SourceError } from '../images/sources';
import { ImageTextBody } from '../ocr/ImageTextBody';
import { OcrPreview } from '../ocr/OcrPreview';
import { readImage } from '../ocr/read';
import type { CalcUI } from './commands';
import { Modal, field, focusGridSoon } from './modal';
import { mediaDataUri } from './ocr-images';

/** The text read from the selected picture of the sheet: where it is, read it again (language, turn, zone) and copy it. */
export function ImageTextDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const [, setRev] = useState(0);
  const img = d.x.selectedImage ? d.sheet.images.find((i) => i.id === d.x.selectedImage) : undefined;
  const media = img ? d.wb.media.get(img.media) : undefined;
  if (!img || !media) return null;
  return (
    <Modal
      title={t('Texto de la imagen')}
      onClose={onClose}
      width={640}
      actions={
        <Button appearance="primary" onClick={onClose}>
          {t('Cerrar')}
        </Button>
      }
    >
      <ImageTextBody
        src={mediaDataUri(media)}
        result={media.ocr ? unpackResult(media.ocr) : null}
        lang={d.imageOcr.lang}
        onLang={(l) => (d.imageOcr.lang = l)}
        onReading={(r) => {
          d.setImageOcr(img.media, packResult({ ...r, text: r.text.trim() }));
          setRev((n) => n + 1);
        }}
      />
    </Modal>
  );
}

/**
 * «Datos desde imagen» (as in Excel): a picture of a table (the selected picture of the sheet, a file, the clipboard or a screenshot) is read, the
 * table is rebuilt from where the words are, the person corrects it, and it is put in the sheet at the active cell with numbers as numbers.
 */
export function DataFromPictureDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const [src, setSrc] = useState('');
  const [result, setResult] = useState<OcrResult | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [zone, setZone] = useState<Box | null>(null);
  const [lang, setLang] = useState(d.imageOcr.lang);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = d.x.selectedImage ? d.sheet.images.find((i) => i.id === d.x.selectedImage) : undefined;
  const selMedia = selected ? d.wb.media.get(selected.media) : undefined;

  const read = async (uri: string, z: Box | null = null) => {
    setBusy(true);
    setMsg('');
    try {
      const r = await readImage(uri, lang, { zone: z ?? undefined, turns: 'auto' });
      setResult(r);
      const table = tableFromWords(r);
      setRows(table.rows);
      if (!table.rows.length) setMsg(t('No se encontró ninguna tabla en la imagen.'));
      d.imageOcr.lang = lang;
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const use = (uri: string) => {
    setSrc(uri);
    setZone(null);
    void read(uri);
  };
  const fromFile = (f: File) => {
    const fr = new FileReader();
    fr.onload = () => use(String(fr.result));
    fr.readAsDataURL(f);
  };
  const fromFileObject = async (get: () => Promise<File | null>) => {
    try {
      const f = await get();
      if (f) fromFile(f);
    } catch (e) {
      setMsg(e instanceof SourceError ? e.message : t('No se pudo obtener la imagen.'));
    }
  };
  useEffect(() => {
    if (selMedia && /^image\/(png|jpe?g|gif|webp|bmp)$/.test(selMedia.mime)) use(mediaDataUri(selMedia));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cols = Math.max(0, ...rows.map((r) => r.length));
  const set = (i: number, j: number, v: string) => setRows((rs) => rs.map((r, k) => (k === i ? Object.assign([...r], { [j]: v }) : r)));
  const close = () => {
    onClose();
    focusGridSoon();
  };
  const cell = d.sel.active;
  return (
    <Modal
      title={t('Datos desde imagen')}
      onClose={close}
      width={760}
      actions={
        <>
          <Button
            appearance="primary"
            disabled={!rows.length || busy}
            onClick={() => {
              const n = d.insertTable(rows.map((r) => r.map((c) => c.trim())));
              if (n) close();
              else setMsg(t('No se pudieron poner los datos aquí (celdas protegidas o de una tabla dinámica).'));
            }}
          >
            {t('Insertar en la hoja')}
          </Button>
          <Button onClick={close}>{t('Cancelar')}</Button>
        </>
      }
    >
      <p>{t('Elige una imagen de una tabla; se leerá y podrás corregir las celdas antes de ponerlas en la hoja, desde la celda activa.')}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {selMedia && (
          <Button disabled={busy} onClick={() => use(mediaDataUri(selMedia))}>
            {t('Usar la imagen seleccionada')}
          </Button>
        )}
        <Button disabled={busy} onClick={() => fileRef.current?.click()}>
          {t('Imagen de un archivo…')}
        </Button>
        <Button disabled={busy} onClick={() => void fromFileObject(clipboardImage)}>
          {t('Del portapapeles')}
        </Button>
        <Button disabled={busy} onClick={() => void fromFileObject(screenshot)}>
          {t('Captura de pantalla…')}
        </Button>
        <label>
          {t('Idioma')}{' '}
          <select aria-label={t('Idioma de la lectura')} value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="spa+eng">{t('Español e inglés')}</option>
            <option value="spa">{t('Español')}</option>
            <option value="eng">{t('Inglés')}</option>
          </select>
        </label>
        <input ref={fileRef} type="file" accept="image/*" hidden aria-label={t('Elegir una imagen')} onChange={(e) => e.target.files?.[0] && fromFile(e.target.files[0])} />
      </div>
      {src && (
        <div style={field}>
          <OcrPreview src={src} result={result && hasPositions(result) ? result : null} zone={zone} onZone={setZone} maxHeight={200} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button disabled={busy || !zone} onClick={() => void read(src, zone)}>
              {t('Leer solo la zona')}
            </Button>
            <Button disabled={busy || !zone} onClick={() => (setZone(null), void read(src))}>
              {t('Quitar la zona')}
            </Button>
            {busy && <span aria-live="polite">{t('Leyendo…')}</span>}
          </div>
        </div>
      )}
      {msg && <p role="alert">{msg}</p>}
      {rows.length > 0 && (
        <div style={{ overflow: 'auto', maxHeight: 260 }}>
          <table aria-label={t('Datos reconocidos')} style={{ borderCollapse: 'collapse' }}>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {Array.from({ length: cols }, (_x, j) => (
                    <td key={j} style={{ border: '1px solid var(--nv-border, #ccc)', padding: 0 }}>
                      <input aria-label={t('Fila {r}, columna {c}', { r: i + 1, c: j + 1 })} value={r[j] ?? ''} onChange={(e) => set(i, j, e.target.value)} style={{ width: 110, border: 0, padding: '2px 4px' }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p>{t('{r} filas y {c} columnas; se pondrán desde la celda {a}.', { r: rows.length, c: cols, a: ui.doc.wb ? `${colName(cell.col)}${cell.row + 1}` : '' })}</p>
        </div>
      )}
    </Modal>
  );
}

const colName = (c: number): string => {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
