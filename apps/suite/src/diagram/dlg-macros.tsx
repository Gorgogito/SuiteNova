import { MacroEditorDialog as SharedEditor, MacroListDialog as SharedList, type MacroProject } from '../macros/MacroDialogs';
import { MacroSecurityDialog } from '../macros/SecurityDialog';
import type { DiagramCtl } from './ctl';

const SAMPLE = `' Nova Basic: un subconjunto de VBA con los objetos de Visio (ActiveDocument, ActivePage, Shapes, Shape.Cells…).
Sub Ejemplo()
    Dim a, b
    Set a = ActivePage.Drop(ActiveDocument.Masters.ItemU("Proceso"), 200, 150)
    Set b = ActivePage.Drop(ActiveDocument.Masters.ItemU("Decisión"), 450, 150)
    a.Text = "Inicio"
    b.Text = "¿Seguir?"
    a.Cells("FillForegnd").FormulaU = "RGB(255, 235, 156)"
    a.AutoConnect b
    MsgBox "La página tiene " & ActivePage.Shapes.Count & " formas"
End Sub
`;

const projectOf = (ctl: DiagramCtl): MacroProject => ({
  rt: ctl.macroRt,
  modules: ctl.macros,
  enabled: ctl.contentEnabled,
  enable: () => ctl.enableContent(),
  changed: () => {
    ctl.dirty = true;
    ctl.touch();
  },
  version: ctl.getVersion(),
  sample: SAMPLE,
  libraryId: 'diagram',
});

/** The list of macros to run (the shared dialog with the diagram). */
export function MacroListDialog({ ctl, onClose, onEdit }: { ctl: DiagramCtl; onClose: () => void; onEdit: () => void }) {
  return <SharedList project={projectOf(ctl)} onClose={onClose} onEdit={onEdit} />;
}

/** The code editor (the shared dialog with the diagram). */
export function MacroEditorDialog({ ctl, onClose }: { ctl: DiagramCtl; onClose: () => void }) {
  return <SharedEditor project={projectOf(ctl)} onClose={onClose} />;
}

/** The trust centre of the macros (level, trusted folders, signature and library). */
export function MacroSecurity({ ctl, onClose }: { ctl: DiagramCtl; onClose: () => void }) {
  return <MacroSecurityDialog project={projectOf(ctl)} onClose={onClose} />;
}
