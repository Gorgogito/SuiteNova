import { MacroEditorDialog as SharedEditor, MacroListDialog as SharedList, type MacroProject } from '../macros/MacroDialogs';
import { MacroSecurityDialog } from '../macros/SecurityDialog';
import type { CalcUI } from './commands';

const SAMPLE = `' Nova Basic: un subconjunto de VBA con los objetos de la hoja (Range, Cells, Worksheets…).
Sub Ejemplo()
    Dim i As Integer
    For i = 1 To 5
        Cells(i, 1).Value = i * i
    Next i
    Range("B1").Formula = "=SUM(A1:A5)"
    MsgBox "Hecho: " & Range("B1").Value
End Sub

' Una función que se puede usar en las celdas: =DOBLE(A1)
Function Doble(x)
    Doble = x * 2
End Function
`;

const projectOf = (ui: CalcUI): MacroProject => {
  const d = ui.doc;
  return {
    rt: d.macros,
    modules: d.wb.macros,
    enabled: d.contentEnabled,
    enable: () => d.enableContent(),
    changed: () => {
      d.dirty = true;
      d.touch();
    },
    version: d.getVersion(),
    sample: SAMPLE,
    libraryId: 'calc',
  };
};

/** The list of macros to run (the shared dialog with the workbook project). */
export function MacroListDialog({ ui, onClose, onEdit }: { ui: CalcUI; onClose: () => void; onEdit: () => void }) {
  return <SharedList project={projectOf(ui)} onClose={onClose} onEdit={onEdit} />;
}

/** The code editor (the shared dialog with the workbook project). */
export function MacroEditorDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  return <SharedEditor project={projectOf(ui)} onClose={onClose} />;
}

/** The trust centre of the macros (level, trusted folders, signature and library). */
export function MacroSecurity({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  return <MacroSecurityDialog project={projectOf(ui)} onClose={onClose} />;
}
