import { MacroEditorDialog as SharedEditor, MacroListDialog as SharedList, type MacroProject } from '../macros/MacroDialogs';
import { MacroSecurityDialog } from '../macros/SecurityDialog';
import type { WriterUI } from './commands';

const SAMPLE = `' Nova Basic: un subconjunto de VBA con los objetos de Word (ActiveDocument, Selection, Range…).
Sub Ejemplo()
    ' Pone en negrita y rojo la primera palabra del documento
    With ActiveDocument.Paragraphs(1).Range
        .InsertBefore "Hola "
    End With
    With ActiveDocument.Range(0, 4)
        .Font.Bold = True
        .Font.Color = RGB(200, 0, 0)
    End With
    MsgBox "El documento tiene " & ActiveDocument.Paragraphs.Count & " párrafos"
End Sub

Sub BuscarYReemplazar()
    With ActiveDocument.Content.Find
        .Text = "mal"
        .Replacement.Text = "bien"
        .Execute Replace:=wdReplaceAll
    End With
End Sub
`;

const projectOf = (ui: WriterUI): MacroProject => {
  const d = ui.ctl;
  return {
    rt: d.macroRt,
    modules: d.macros,
    enabled: d.contentEnabled,
    enable: () => d.enableContent(),
    changed: () => {
      d.dirty = true;
      d.touch();
    },
    version: d.getVersion(),
    sample: SAMPLE,
    libraryId: 'writer',
  };
};

/** The list of macros to run (the shared dialog with the Word project). */
export function MacroListDialog({ ui, onClose, onEdit }: { ui: WriterUI; onClose: () => void; onEdit: () => void }) {
  return <SharedList project={projectOf(ui)} onClose={onClose} onEdit={onEdit} />;
}

/** The code editor (the shared dialog with the Word project). */
export function MacroEditorDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  return <SharedEditor project={projectOf(ui)} onClose={onClose} />;
}

/** The trust centre of the macros (level, trusted folders, signature and library). */
export function MacroSecurity({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  return <MacroSecurityDialog project={projectOf(ui)} onClose={onClose} />;
}
