import { MacroEditorDialog as SharedEditor, MacroListDialog as SharedList, type MacroProject } from '../macros/MacroDialogs';
import { MacroSecurityDialog } from '../macros/SecurityDialog';
import type { PlanCtl } from './ctl';

const SAMPLE = `' Nova Basic: un subconjunto de VBA con los objetos de Project (ActiveProject, Tasks, Resources…).
Sub Ejemplo()
    Dim a, b
    Set a = ActiveProject.Tasks.Add("Diseño")
    Set b = ActiveProject.Tasks.Add("Construcción")
    a.Duration = 3 * 480
    b.Duration = 5 * 480
    b.Predecessors = "1"
    MsgBox "El proyecto termina el " & ActiveProject.ProjectFinish
End Sub
`;

const projectOf = (ctl: PlanCtl): MacroProject => ({
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
  libraryId: 'plan',
});

/** The list of macros to run (the shared dialog with the project). */
export function MacroListDialog({ ctl, onClose, onEdit }: { ctl: PlanCtl; onClose: () => void; onEdit: () => void }) {
  return <SharedList project={projectOf(ctl)} onClose={onClose} onEdit={onEdit} />;
}

/** The code editor (the shared dialog with the project). */
export function MacroEditorDialog({ ctl, onClose }: { ctl: PlanCtl; onClose: () => void }) {
  return <SharedEditor project={projectOf(ctl)} onClose={onClose} />;
}

/** The trust centre of the macros (level, trusted folders, signature and library). */
export function MacroSecurity({ ctl, onClose }: { ctl: PlanCtl; onClose: () => void }) {
  return <MacroSecurityDialog project={projectOf(ctl)} onClose={onClose} />;
}
