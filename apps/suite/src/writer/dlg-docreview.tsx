import { Button, Input, Textarea } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { checkAccessibility, compareDocs, docStats, readDocx, type A11yIssue, type DocStats, type WriterDoc } from '@suitenova/writer-core';
import { TextSelection } from 'prosemirror-state';
import { useMemo, useState } from 'react';
import { pickAndRead, type OpenedFile } from '../fileio';
import type { WriterUI } from './commands';
import { Modal, field, focusDocSoon } from './dialogs';
import { getUser, newId } from './review';

const nf = (n: number) => n.toLocaleString();

// ------------------------------------------------------------------------------------------------ recuento
export function WordCountDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const c = ui.ctl;
  const { whole, sel, pages } = useMemo(() => {
    const st = c.state;
    const whole = st ? docStats(st.doc) : { words: 0, charsWithSpaces: 0, charsNoSpaces: 0, paragraphs: 0 };
    const sel = st && !st.selection.empty ? docStats(st.doc.textBetween(st.selection.from, st.selection.to, '\n', ' ')) : null;
    return { whole, sel, pages: c.pageSpecs.length };
  }, [c]);
  const rows: [string, (s: DocStats) => number][] = [
    ['Palabras', (s) => s.words],
    ['Caracteres (sin espacios)', (s) => s.charsNoSpaces],
    ['Caracteres (con espacios)', (s) => s.charsWithSpaces],
    ['Párrafos con texto', (s) => s.paragraphs],
  ];
  return (
    <Modal
      title={t('Contar palabras')}
      onClose={onClose}
      width={420}
      actions={
        <Button appearance="primary" onClick={() => { onClose(); focusDocSoon(ui); }}>
          {t('Cerrar')}
        </Button>
      }
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }} />
            <th style={{ textAlign: 'right' }}>{t('Documento')}</th>
            {sel && <th style={{ textAlign: 'right' }}>{t('Selección')}</th>}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('Páginas')}</td>
            <td style={{ textAlign: 'right' }} data-testid="wc-pages">{nf(pages)}</td>
            {sel && <td />}
          </tr>
          {rows.map(([label, f]) => (
            <tr key={label}>
              <td>{t(label)}</td>
              <td style={{ textAlign: 'right' }} data-testid={`wc-${label}`}>{nf(f(whole))}</td>
              {sel && <td style={{ textAlign: 'right' }}>{nf(f(sel))}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ opacity: 0.75, fontSize: 12 }}>{t('No cuenta el texto borrado con control de cambios que aún no se aceptó, ni encabezados, pies ni notas.')}</p>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ propiedades
export function DocPropsDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const c = ui.ctl;
  const [v, setV] = useState({ title: c.title ?? '', author: c.author ?? '', subject: c.subject ?? '', keywords: c.keywords ?? '', category: c.category ?? '', description: c.description ?? '' });
  const stats = useMemo(() => (c.state ? docStats(c.state.doc) : null), [c]);
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const accept = () => {
    const keep = (s: string) => s.trim() || undefined;
    c.title = keep(v.title);
    c.author = keep(v.author);
    c.subject = keep(v.subject);
    c.keywords = keep(v.keywords);
    c.category = keep(v.category);
    c.description = keep(v.description);
    c.dirty = true;
    c.touch();
    onClose();
    focusDocSoon(ui);
  };
  const text = (id: string, label: string, key: keyof typeof v) => (
    <div style={field}>
      <label htmlFor={id}>{t(label)}</label>
      <Input id={id} value={v[key]} onChange={(_e, d) => set({ [key]: d.value })} />
    </div>
  );
  return (
    <Modal
      title={t('Propiedades del documento')}
      onClose={onClose}
      width={500}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" onClick={accept}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      {text('dp-title', 'Título', 'title')}
      {text('dp-author', 'Autor', 'author')}
      {text('dp-subject', 'Asunto', 'subject')}
      {text('dp-keywords', 'Palabras clave', 'keywords')}
      {text('dp-category', 'Categoría', 'category')}
      <div style={field}>
        <label htmlFor="dp-desc">{t('Descripción')}</label>
        <Textarea id="dp-desc" rows={3} value={v.description} onChange={(_e, d) => set({ description: d.value })} />
      </div>
      <p style={{ opacity: 0.75, fontSize: 12, margin: 0 }}>
        {t('Archivo')}: {c.fileName ?? t('(sin guardar)')}
        {stats ? ` · ${t('{n} palabras', { n: nf(stats.words) })} · ${`${t('Páginas')}: ${nf(c.pageSpecs.length)}`}` : ''}
      </p>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ accesibilidad
const A11Y_TEXT: Record<A11yIssue['kind'], string> = {
  imageAlt: 'Imagen sin texto alternativo: un lector de pantalla no puede describirla.',
  tableHeader: 'La tabla no tiene fila de encabezado.',
  mergedCells: 'La tabla tiene celdas combinadas; los lectores de pantalla las recorren con dificultad.',
  headingSkip: 'El título salta de nivel.',
  headingEmpty: 'Título vacío.',
  emptyParas: 'Párrafos vacíos para separar: mejor usar el espaciado del párrafo.',
  linkText: 'Texto de vínculo poco descriptivo.',
  noTitle: 'Falta el título en las propiedades del documento.',
  smallText: 'Texto demasiado pequeño (menos de 8 pt).',
  contrast: 'Poco contraste entre el texto y el fondo.',
  noHeadings: 'Documento largo sin títulos: no se puede navegar por secciones.',
};
const SEVERITY: Record<A11yIssue['severity'], string> = { error: 'Error', warning: 'Advertencia', tip: 'Sugerencia' };

export function AccessibilityDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const c = ui.ctl;
  const run = () => (c.state ? checkAccessibility(c.state.doc, { title: c.title, pageColor: c.pageColor }) : []);
  const [issues, setIssues] = useState<A11yIssue[]>(run);
  const goTo = (i: A11yIssue) => {
    const v = c.mainView;
    if (!v || i.pos === null) return;
    const pos = Math.min(i.pos, v.state.doc.content.size);
    v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(pos))).scrollIntoView());
    onClose();
    focusDocSoon(ui);
  };
  return (
    <Modal
      title={t('Comprobar accesibilidad')}
      onClose={onClose}
      width={620}
      actions={
        <>
          <Button onClick={() => setIssues(run())}>{t('Volver a comprobar')}</Button>
          <Button appearance="primary" onClick={() => { onClose(); focusDocSoon(ui); }}>
            {t('Cerrar')}
          </Button>
        </>
      }
    >
      {issues.length === 0 ? (
        <p role="status" data-testid="a11y-ok">{t('No se encontraron problemas de accesibilidad.')}</p>
      ) : (
        <>
          <p role="status" data-testid="a11y-summary">
            {t('{n} problemas encontrados.', { n: issues.length })}
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '50vh', overflow: 'auto' }}>
            {issues.map((i, k) => (
              <li key={k} data-kind={i.kind} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid rgba(128,128,128,.25)' }}>
                <strong style={{ minWidth: 92, color: i.severity === 'error' ? '#b00020' : i.severity === 'warning' ? '#8a5a00' : 'inherit' }}>{t(SEVERITY[i.severity])}</strong>
                <span style={{ flex: 1 }}>
                  {t(A11Y_TEXT[i.kind])}
                  <br />
                  <span style={{ opacity: 0.75, fontSize: 12 }}>{i.excerpt}</span>
                </span>
                {i.pos !== null && (
                  <Button size="small" onClick={() => goTo(i)}>
                    {t('Ir')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ comparar
const DOCX_FILTERS = [{ name: 'Documento de Word', extensions: ['docx', 'dotx'] }];

export function CompareDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const c = ui.ctl;
  const [original, setOriginal] = useState<OpenedFile | null>(null);
  const [revised, setRevised] = useState<OpenedFile | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = async (set: (f: OpenedFile) => void) => {
    try {
      const f = await pickAndRead(DOCX_FILTERS);
      if (f) {
        set(f);
        setErr('');
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const go = async () => {
    if (!original) return;
    setBusy(true);
    try {
      const orig = (await readDocx(original.data)).doc;
      const rev: WriterDoc = revised ? (await readDocx(revised.data)).doc : c.toWriterDoc();
      const r = compareDocs(orig.body, rev.body, { author: getUser().name, date: new Date().toISOString(), makeId: () => newId('cmp') });
      onClose();
      if (r.changes === 0) {
        window.alert(t('Los dos documentos tienen el mismo texto: no hay diferencias que marcar.'));
        return;
      }
      ui.applyTemplate({ ...rev, body: r.doc, isTemplate: false, signature: null, protection: null });
      window.alert(t('Se marcaron {n} cambios: {ins} párrafos nuevos y {del} borrados, además de los cambios dentro de párrafos. Es un documento nuevo sin guardar; solo se compara el texto, no el formato.', { n: r.changes, ins: r.insertedParagraphs, del: r.deletedParagraphs }));
    } catch (e) {
      setErr(t('No se pudo comparar: {error}', { error: (e as Error).message }));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Comparar documentos')}
      onClose={onClose}
      width={520}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!original || busy} onClick={go}>
            {t('Comparar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <span>{t('Documento original')}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button onClick={() => pick(setOriginal)}>{t('Elegir archivo…')}</Button>
          <span data-testid="cmp-original">{original?.name ?? t('(ninguno)')}</span>
        </div>
      </div>
      <div style={field}>
        <span>{t('Documento revisado')}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button onClick={() => pick(setRevised)}>{t('Elegir archivo…')}</Button>
          {revised && (
            <Button size="small" onClick={() => setRevised(null)}>
              {t('Usar el documento actual')}
            </Button>
          )}
          <span data-testid="cmp-revised">{revised?.name ?? t('El documento actual')}</span>
        </div>
      </div>
      <p style={{ opacity: 0.75, fontSize: 12 }}>{t('El resultado es el documento revisado con lo borrado y lo añadido marcados como cambios de {name}. Reemplaza el contenido de esta ventana (se pregunta antes si hay cambios sin guardar); los archivos no se tocan.', { name: getUser().name })}</p>
      {err && <p role="alert" style={{ color: '#b00020' }}>{err}</p>}
    </Modal>
  );
}
