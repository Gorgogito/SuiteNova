import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { isSafeHref, markTypes, ptToPx, type PageSetup } from '@suitenova/writer-core';
import { useEffect, useState, type ReactNode } from 'react';
import type { WriterDialog, WriterUI } from './commands';
import { ColumnsDialog, WatermarkDialog } from './dlg-layout';
import { ProtectDialog, UnprotectDialog, UserDialog } from './dlg-review';
import { BookmarkDialog, CaptionDialog, CiteDialog, IndexMarkDialog, NoteOptionsDialog, SourcesDialog, TocDialog, XRefDialog } from './dlg-refs';
import { ControlDialog, EquationDialog, ShapeDialog } from './dlg-objects';
import { TemplatesDialog } from './dlg-templates';
import { MacroEditorDialog, MacroListDialog } from './dlg-macros';
import { EncryptDialog, SignDialog, SignatureInfoDialog } from './dlg-security';
import { SpellDialog, UserDictionaryDialog } from './SpellUI';
import { EnvelopeDialog, FinishMergeDialog, LabelsDialog, MergeBlockDialog, MergeFieldDialog, MergeRuleDialog, RecipientsDialog } from './dlg-mail';
import { createTable, insertBlockAfterCursor, markAttr, setLink } from './editing';

export function Modal({ title, onClose, children, actions, width = 480 }: { title: string; onClose: () => void; children: ReactNode; actions: ReactNode; width?: number }) {
  // The dialog is unmounted by its parent while open, and then the page behind it keeps the aria-hidden the dialog put on it
  // (invisible to screen readers and to automation). Give the page back once no dialog is left.
  useEffect(
    () => () => {
      setTimeout(() => {
        if (document.querySelector('[role=dialog]')) return;
        for (const el of document.querySelectorAll('body > [aria-hidden=true], #root[aria-hidden=true]')) el.removeAttribute('aria-hidden');
        document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
      }, 0);
    },
    [],
  );
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: width, width: '92vw' }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>{children}</DialogContent>
          <DialogActions>{actions}</DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
export const field: React.CSSProperties = { display: 'grid', gap: 4, marginBottom: 10 };

export function focusDocSoon(ui: WriterUI) {
  setTimeout(() => ui.ctl.focus(), 80);
}

// ------------------------------------------------------------------------------------------------ link
function LinkDialog({ ui, remove, onClose }: { ui: WriterUI; remove: boolean; onClose: () => void }) {
  const st = ui.ctl.state!;
  const existing = (markAttr(st, markTypes.link!, 'href') as string | undefined) ?? '';
  const [href, setHref] = useState(existing || 'https://');
  const [text, setText] = useState('');
  const empty = st.selection.empty;
  const bad = !!href && !isSafeHref(href);
  const apply = () => {
    const v = ui.ctl.view!;
    setLink(href.trim() === 'https://' ? null : href.trim(), text)(v.state, v.dispatch);
    onClose();
    focusDocSoon(ui);
  };
  if (remove) {
    const v = ui.ctl.view!;
    setLink(null)(v.state, v.dispatch);
    onClose();
    focusDocSoon(ui);
    return null;
  }
  return (
    <Modal
      title={t('Hipervínculo')}
      onClose={() => {
        onClose();
        focusDocSoon(ui);
      }}
      actions={
        <>
          {existing && (
            <Button
              onClick={() => {
                const v = ui.ctl.view!;
                setLink(null)(v.state, v.dispatch);
                onClose();
                focusDocSoon(ui);
              }}
            >
              {t('Quitar vínculo')}
            </Button>
          )}
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!href.trim() || bad} onClick={apply}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nw-link-href">{t('Dirección')}</label>
        <Input id="nw-link-href" value={href} onChange={(_e, d) => setHref(d.value)} autoFocus />
        {bad && <span role="alert">{t('Solo se admiten direcciones http, https, mailto, tel o anclas (#).')}</span>}
      </div>
      {empty && (
        <div style={field}>
          <label htmlFor="nw-link-text">{t('Texto que mostrar')}</label>
          <Input id="nw-link-text" value={text} onChange={(_e, d) => setText(d.value)} />
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ table size
function TableDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const ok = rows >= 1 && rows <= 100 && cols >= 1 && cols <= 20;
  return (
    <Modal
      title={t('Insertar tabla')}
      onClose={() => {
        onClose();
        focusDocSoon(ui);
      }}
      width={360}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!ok}
            onClick={() => {
              const v = ui.ctl.view!;
              const width = ptToPx(ui.ctl.page.width - ui.ctl.page.marginLeft - ui.ctl.page.marginRight);
              insertBlockAfterCursor(createTable(rows, cols, width))(v.state, v.dispatch);
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nw-tbl-cols">{t('Número de columnas')}</label>
        <Input id="nw-tbl-cols" type="number" value={String(cols)} onChange={(_e, d) => setCols(Number(d.value))} autoFocus />
      </div>
      <div style={field}>
        <label htmlFor="nw-tbl-rows">{t('Número de filas')}</label>
        <Input id="nw-tbl-rows" type="number" value={String(rows)} onChange={(_e, d) => setRows(Number(d.value))} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ page setup
const PT_PER_CM = 72 / 2.54;
const cm = (pt: number) => Math.round((pt / PT_PER_CM) * 100) / 100;

function PageSetupDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const p = ui.ctl.page;
  const [v, setV] = useState<Record<keyof PageSetup, number>>({ ...p, width: cm(p.width), height: cm(p.height), marginTop: cm(p.marginTop), marginRight: cm(p.marginRight), marginBottom: cm(p.marginBottom), marginLeft: cm(p.marginLeft), headerDistance: cm(p.headerDistance), footerDistance: cm(p.footerDistance) });
  const [scope, setScope] = useState<'document' | 'section'>(ui.ctl.sections().length > 1 ? 'section' : 'document');
  const set = (k: keyof PageSetup) => (_e: unknown, d: { value: string }) => setV((o) => ({ ...o, [k]: Number(d.value.replace(',', '.')) }));
  const valid = v.width >= 5 && v.height >= 5 && v.marginLeft + v.marginRight < v.width - 2 && v.marginTop + v.marginBottom < v.height - 2 && Object.values(v).every((n) => Number.isFinite(n) && n >= 0);
  const f = (k: keyof PageSetup, label: string) => (
    <div style={field} key={k}>
      <label htmlFor={`nw-ps-${k}`}>{label}</label>
      <Input id={`nw-ps-${k}`} type="number" step={0.1} value={String(v[k])} onChange={set(k)} />
    </div>
  );
  return (
    <Modal
      title={t('Configurar página')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!valid}
            onClick={() => {
              const n = (k: keyof PageSetup) => v[k] * PT_PER_CM;
              ui.ctl.setPage({ width: n('width'), height: n('height'), marginTop: n('marginTop'), marginRight: n('marginRight'), marginBottom: n('marginBottom'), marginLeft: n('marginLeft'), headerDistance: n('headerDistance'), footerDistance: n('footerDistance') }, scope);
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <p style={{ margin: '0 0 8px' }}>{t('Todas las medidas en centímetros.')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        {f('width', t('Ancho de página'))}
        {f('height', t('Alto de página'))}
        {f('marginTop', t('Margen superior'))}
        {f('marginBottom', t('Margen inferior'))}
        {f('marginLeft', t('Margen izquierdo'))}
        {f('marginRight', t('Margen derecho'))}
        {f('headerDistance', t('Encabezado desde el borde'))}
        {f('footerDistance', t('Pie desde el borde'))}
      </div>
      {ui.ctl.sections().length > 1 && (
        <div style={{ ...field, marginTop: 8 }}>
          <label htmlFor="nw-ps-scope">{t('Aplicar a')}</label>
          <select id="nw-ps-scope" className="nv-select" value={scope} onChange={(e) => setScope(e.target.value as 'document' | 'section')}>
            <option value="section">{t('Esta sección')}</option>
            <option value="document">{t('Todo el documento')}</option>
          </select>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ about / shortcuts
const SHORTCUTS: [string, string][] = [
  ['Ctrl+N / O / S', 'Nuevo / Abrir / Guardar'],
  ['Ctrl+Z / Y', 'Deshacer / Rehacer'],
  ['Ctrl+B / I / U', 'Negrita / Cursiva / Subrayado'],
  ['Ctrl+L / E / R / J', 'Izquierda / Centrar / Derecha / Justificar'],
  ['Ctrl+Shift+L', 'Viñetas'],
  ['Tab / Mayús+Tab', 'Sangría de lista o siguiente celda'],
  ['Ctrl+Enter', 'Salto de página'],
  ['Ctrl+K', 'Hipervínculo'],
  ['Ctrl+F / H', 'Buscar / Reemplazar'],
  ['Ctrl+P', 'Imprimir o guardar como PDF'],
  ['Ctrl+Espacio', 'Borrar formato'],
  ['Alt', 'Atajos de la cinta (KeyTips)'],
  ['Alt+Q', 'Decirme qué quiero hacer'],
];

export function DialogHost({ ui, kind, arg, onClose }: { ui: WriterUI; kind: WriterDialog | null; arg: unknown; onClose: () => void }) {
  if (!kind) return null;
  switch (kind) {
    case 'link':
      return <LinkDialog ui={ui} remove={!!(arg as { remove?: boolean } | undefined)?.remove} onClose={onClose} />;
    case 'tableSize':
      return <TableDialog ui={ui} onClose={onClose} />;
    case 'toc':
      return <TocDialog ui={ui} kind="toc" onClose={onClose} />;
    case 'tof':
      return <TocDialog ui={ui} kind="tof" onClose={onClose} />;
    case 'caption':
      return <CaptionDialog ui={ui} onClose={onClose} />;
    case 'xref':
      return <XRefDialog ui={ui} onClose={onClose} />;
    case 'bookmark':
      return <BookmarkDialog ui={ui} onClose={onClose} />;
    case 'indexMark':
      return <IndexMarkDialog ui={ui} onClose={onClose} />;
    case 'cite':
      return <CiteDialog ui={ui} onClose={onClose} />;
    case 'sources':
      return <SourcesDialog ui={ui} onClose={onClose} />;
    case 'noteOptions':
      return <NoteOptionsDialog ui={ui} onClose={onClose} />;
    case 'protect':
      return <ProtectDialog ui={ui} onClose={onClose} />;
    case 'unprotect':
      return <UnprotectDialog ui={ui} onClose={onClose} />;
    case 'user':
      return <UserDialog ui={ui} onClose={onClose} />;
    case 'equation':
      return <EquationDialog ui={ui} pos={(arg as { pos?: number } | undefined)?.pos} onClose={onClose} />;
    case 'shape':
      return <ShapeDialog ui={ui} pos={(arg as { pos: number }).pos} onClose={onClose} />;
    case 'control':
      return <ControlDialog ui={ui} pos={(arg as { pos: number }).pos} onClose={onClose} />;
    case 'macros':
      return <MacroListDialog ui={ui} onClose={onClose} onEdit={() => (ui.openDialog('macroEditor'))} />;
    case 'macroEditor':
      return <MacroEditorDialog ui={ui} onClose={onClose} />;
    case 'encrypt':
      return <EncryptDialog ui={ui} onClose={onClose} />;
    case 'sign':
      return <SignDialog ui={ui} onClose={onClose} />;
    case 'signInfo':
      return <SignatureInfoDialog ui={ui} onClose={onClose} />;
    case 'spell':
      return <SpellDialog ui={ui} onClose={onClose} />;
    case 'userDict':
      return <UserDictionaryDialog ui={ui} onClose={onClose} />;
    case 'templates':
      return <TemplatesDialog ui={ui} onClose={onClose} />;
    case 'envelope':
      return <EnvelopeDialog ui={ui} onClose={onClose} />;
    case 'labels':
      return <LabelsDialog ui={ui} onClose={onClose} />;
    case 'recipients':
      return ui.ctl.mailMerge ? <RecipientsDialog ui={ui} onClose={onClose} /> : null;
    case 'mergeField':
      return ui.ctl.mailMerge ? <MergeFieldDialog ui={ui} onClose={onClose} /> : null;
    case 'mergeBlock':
      return ui.ctl.mailMerge ? <MergeBlockDialog ui={ui} kind={(arg as { kind: 'address' | 'greeting' }).kind} onClose={onClose} /> : null;
    case 'mergeRule':
      return ui.ctl.mailMerge ? <MergeRuleDialog ui={ui} rule={(arg as { rule: 'IF' | 'SKIPIF' | 'NEXTIF' }).rule} onClose={onClose} /> : null;
    case 'finishMerge':
      return ui.ctl.mailMerge ? <FinishMergeDialog ui={ui} onClose={onClose} /> : null;
    case 'columns':
      return <ColumnsDialog ui={ui} onClose={onClose} />;
    case 'watermark':
      return <WatermarkDialog ui={ui} onClose={onClose} />;
    case 'pageSetup':
      return <PageSetupDialog ui={ui} onClose={onClose} />;
    case 'about':
      return (
        <Modal title={t('Acerca de Nova Writer')} onClose={onClose} actions={<Button appearance="primary" onClick={onClose}>{t('Cerrar')}</Button>}>
          <p>Nova Writer 0.0.4</p>
          <p>{t('Procesador de textos libre (MPL-2.0) de SuiteNova. Abre documentos .docx, .doc, .rtf y .odt y guarda .docx, .rtf y .odt; consulta docs/LIMITACIONES.md para saber qué se conserva.')}</p>
        </Modal>
      );
    case 'shortcuts':
      return (
        <Modal title={t('Atajos de teclado')} onClose={onClose} actions={<Button appearance="primary" onClick={onClose}>{t('Cerrar')}</Button>}>
          <table className="nw-shortcuts">
            <tbody>
              {SHORTCUTS.map(([k, d]) => (
                <tr key={k}>
                  <th scope="row">
                    <kbd>{k}</kbd>
                  </th>
                  <td>{t(d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      );
  }
}
