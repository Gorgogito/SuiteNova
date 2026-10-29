import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useEffect, useState, type ReactNode } from 'react';
import type { SlidesDialog, SlidesUI } from './commands';
import { BackgroundDialog, ColumnsDialog, FontDialog, ParagraphDialog, TabsDialog } from './FormDialogs3';
import { ActionDialog, AltTextDialog, PositionDialog, ThemesDialog } from './FormDialogs4';
import { MasterPropsDialog } from './MasterPanel';
import { NovaArtDialog, SmartArtDialog } from './FormDialogs5';
import { ExportMediaDialog } from './FormDialogs8';
import { EquationDialog, PictureCorrectionsDialog } from './FormDialogs7';
import { TableCellDialog, TableSizeDialog, TableSplitDialog } from './FormDialogs6';
import { CommentDialog, CustomShowsDialog, FindReplaceDialog, SectionsDialog, SetupShowDialog, SlideSizeDialog, SpellingDialog } from './FormDialogs2';
import { ChartDialog, HeaderFooterDialog, HyperlinkDialog, TableDialog } from './FormDialogs';

export function Modal({ title, onClose, children, actions, wide }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  // Fluent leaves aria-hidden on the page when the parent unmounts an open dialog: give it back once no dialog is left
  useEffect(
    () => () => {
      // Fluent restores the page after its own cleanup, so look again a little later
      for (const ms of [0, 120, 500]) {
        setTimeout(() => {
          if (document.querySelector('[role=dialog]')) return;
          for (const el of document.querySelectorAll('body > [aria-hidden=true], #root[aria-hidden=true]')) el.removeAttribute('aria-hidden');
          document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
        }, ms);
      }
    },
    [],
  );
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: wide ? 820 : 520, width: '92vw' }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>{children}</DialogContent>
          <DialogActions>
            {actions ?? (
              <Button appearance="primary" onClick={onClose}>
                {t('Cerrar')}
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl+N / O / S', 'Nuevo / Abrir / Guardar'],
  ['Ctrl+Z / Y', 'Deshacer / Rehacer'],
  ['Ctrl+M', 'Nueva diapositiva'],
  ['Ctrl+D', 'Duplicar objeto'],
  ['Ctrl+C / X / V', 'Copiar / Cortar / Pegar'],
  ['Ctrl+G / Ctrl+Mayús+G', 'Agrupar / Desagrupar'],
  ['Flechas / Mayús+flechas', 'Mover el objeto 6 pt / 1 pt'],
  ['Intro / F2 / doble clic', 'Escribir en la forma'],
  ['Esc', 'Salir del texto / quitar la selección'],
  ['Tab / Mayús+Tab (en una lista)', 'Bajar / subir de nivel'],
  ['F5 / Mayús+F5', 'Presentar desde el principio / desde la actual'],
  ['Alt', 'Atajos de la cinta (KeyTips)'],
];

export function Dialogs({ ui, dialog, onClose }: { ui: SlidesUI; dialog: { kind: SlidesDialog; arg?: unknown } | null; onClose: () => void }) {
  if (!dialog) return null;
  const { kind, arg } = dialog;
  void ui;
  if (kind === 'about') {
    const warnings = (arg as { warnings?: string[]; name?: string } | undefined)?.warnings;
    return (
      <Modal title={warnings ? t('Se abrió «{name}», pero:', { name: (arg as { name: string }).name }) : t('Acerca de Nova Slides')} onClose={onClose}>
        {warnings ? (
          <ul>{warnings.slice(0, 30).map((w) => <li key={w}>{w}</li>)}</ul>
        ) : (
          <>
            <p>Nova Slides 0.0.9</p>
            <p>{t('Presentaciones libres (MPL-2.0) de SuiteNova. Abre y guarda .pptx; consulta docs/LIMITACIONES.md para saber qué se conserva.')}</p>
          </>
        )}
      </Modal>
    );
  }
  if (kind === 'shortcuts')
    return (
      <Modal title={t('Atajos de teclado')} onClose={onClose}>
        <table className="nw-shortcuts">
          <tbody>
            {SHORTCUTS.map(([k, d]) => (
              <tr key={k}>
                <th scope="row"><kbd>{k}</kbd></th>
                <td>{t(d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    );
  if (kind === 'hyperlink') return <HyperlinkDialog ui={ui} onClose={onClose} />;
  if (kind === 'table') return <TableDialog ui={ui} onClose={onClose} />;
  if (kind === 'chart') return <ChartDialog ui={ui} onClose={onClose} arg={arg} />;
  if (kind === 'headerFooter') return <HeaderFooterDialog ui={ui} onClose={onClose} />;
  if (kind === 'slideSize') return <SlideSizeDialog ui={ui} onClose={onClose} />;
  if (kind === 'setupShow') return <SetupShowDialog ui={ui} onClose={onClose} />;
  if (kind === 'customShows') return <CustomShowsDialog ui={ui} onClose={onClose} />;
  if (kind === 'findReplace') return <FindReplaceDialog ui={ui} onClose={onClose} />;
  if (kind === 'comment') return <CommentDialog ui={ui} onClose={onClose} />;
  if (kind === 'sections') return <SectionsDialog ui={ui} onClose={onClose} />;
  if (kind === 'spelling') return <SpellingDialog ui={ui} onClose={onClose} />;
  if (kind === 'themes') return <ThemesDialog ui={ui} onClose={onClose} />;
  if (kind === 'position') return <PositionDialog ui={ui} onClose={onClose} />;
  if (kind === 'altText') return <AltTextDialog ui={ui} onClose={onClose} />;
  if (kind === 'actionSettings') return <ActionDialog ui={ui} onClose={onClose} />;
  if (kind === 'smartArt') return <SmartArtDialog ui={ui} onClose={onClose} />;
  if (kind === 'wordArt') return <NovaArtDialog ui={ui} onClose={onClose} />;
  if (kind === 'masterLayout') return <MasterPropsDialog ui={ui} onClose={onClose} />;
  if (kind === 'background') return <BackgroundDialog ui={ui} onClose={onClose} />;
  if (kind === 'fontDialog') return <FontDialog ui={ui} onClose={onClose} />;
  if (kind === 'paragraphDialog') return <ParagraphDialog ui={ui} onClose={onClose} />;
  if (kind === 'tabsDialog') return <TabsDialog ui={ui} onClose={onClose} />;
  if (kind === 'exportMedia') return <ExportMediaDialog ui={ui} onClose={onClose} arg={arg} />;
  if (kind === 'equation') return <EquationDialog ui={ui} onClose={onClose} />;
  if (kind === 'pictureCorrections') return <PictureCorrectionsDialog ui={ui} onClose={onClose} />;
  if (kind === 'tableSplit') return <TableSplitDialog ui={ui} onClose={onClose} />;
  if (kind === 'tableCell') return <TableCellDialog ui={ui} onClose={onClose} />;
  if (kind === 'tableSize') return <TableSizeDialog ui={ui} onClose={onClose} />;
  if (kind === 'columnsDialog') return <ColumnsDialog ui={ui} onClose={onClose} />;
  return <PendingDialog kind={kind} onClose={onClose} />;
}

function PendingDialog({ kind, onClose }: { kind: string; onClose: () => void }) {
  const [n] = useState(kind);
  return (
    <Modal title={t('Todavía no disponible')} onClose={onClose}>
      <p>{n}</p>
    </Modal>
  );
}
