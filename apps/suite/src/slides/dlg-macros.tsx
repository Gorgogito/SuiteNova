import { MacroEditorDialog as SharedEditor, MacroListDialog as SharedList, type MacroProject } from '../macros/MacroDialogs';
import { MacroSecurityDialog } from '../macros/SecurityDialog';
import type { SlidesUI } from './commands';

const SAMPLE = `' Nova Basic: un subconjunto de VBA con los objetos de PowerPoint (ActivePresentation, Slides, Shapes, TextRange…).
Sub Ejemplo()
    Dim s, t
    Set s = ActivePresentation.Slides.Add(ActivePresentation.Slides.Count + 1, ppLayoutBlank)
    Set t = s.Shapes.AddTextbox(msoTextOrientationHorizontal, 60, 60, 400, 60)
    t.TextFrame.TextRange.Text = "Hola desde una macro"
    t.TextFrame.TextRange.Font.Size = 32
    t.TextFrame.TextRange.Font.Bold = True
    t.TextFrame.TextRange.Font.Color.RGB = RGB(192, 0, 0)
    MsgBox "La presentación tiene " & ActivePresentation.Slides.Count & " diapositivas"
End Sub
`;

const projectOf = (ui: SlidesUI): MacroProject => {
  const c = ui.ctl;
  return {
    rt: c.macroRt,
    modules: c.macros,
    enabled: c.contentEnabled,
    enable: () => c.enableContent(),
    changed: () => {
      c.dirty = true;
      c.touch();
    },
    version: c.getVersion(),
    sample: SAMPLE,
    libraryId: 'slides',
  };
};

/** The list of macros to run (the shared dialog with the presentation project). */
export function MacroListDialog({ ui, onClose, onEdit }: { ui: SlidesUI; onClose: () => void; onEdit: () => void }) {
  return <SharedList project={projectOf(ui)} onClose={onClose} onEdit={onEdit} />;
}

/** The code editor (the shared dialog with the presentation project). */
export function MacroEditorDialog({ ui, onClose }: { ui: SlidesUI; onClose: () => void }) {
  return <SharedEditor project={projectOf(ui)} onClose={onClose} />;
}

/** The trust centre of the macros (level, trusted folders, signature and library). */
export function MacroSecurity({ ui, onClose }: { ui: SlidesUI; onClose: () => void }) {
  return <MacroSecurityDialog project={projectOf(ui)} onClose={onClose} />;
}
