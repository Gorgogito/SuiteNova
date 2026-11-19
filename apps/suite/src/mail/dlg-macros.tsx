import { MacroEditorDialog as SharedEditor, MacroListDialog as SharedList, type MacroProject } from '../macros/MacroDialogs';
import { MacroSecurityDialog } from '../macros/SecurityDialog';
import type { MailCtl } from './ctl';

const SAMPLE = `' Nova Basic: un subconjunto de VBA con los objetos de Outlook (Application, NameSpace, Folder, MailItem…).
' Las macros de Nova Mail pertenecen al programa, no a un archivo de correo.
Sub ContarNoLeidos()
    Dim carpeta, msg, n
    Set carpeta = Application.GetNamespace("MAPI").GetDefaultFolder(olFolderInbox)
    For Each msg In carpeta.Items
        If msg.UnRead Then n = n + 1
    Next
    MsgBox "Tienes " & n & " mensajes sin leer en " & carpeta.Name
End Sub

Sub RedactarSaludo()
    Dim m
    Set m = Application.CreateItem(olMailItem)
    m.To = "amigo@example.com"
    m.Subject = "Hola"
    m.Body = "Un saludo desde una macro."
    m.Display
End Sub
`;

const projectOf = (ctl: MailCtl): MacroProject => ({
  rt: ctl.macroRt,
  modules: ctl.macros,
  enabled: ctl.macrosEnabled,
  enable: () => ctl.setMacrosEnabled(true),
  changed: () => {
    ctl.saveMacros();
    ctl.touch();
  },
  version: ctl.getVersion(),
  sample: SAMPLE,
  libraryId: 'mail',
});

/** The list of macros to run (the shared dialog with the mail project). */
export function MacroListDialog({ ctl, onClose, onEdit }: { ctl: MailCtl; onClose: () => void; onEdit: () => void }) {
  return <SharedList project={projectOf(ctl)} onClose={onClose} onEdit={onEdit} />;
}

/** The code editor (the shared dialog with the mail project). */
export function MacroEditorDialog({ ctl, onClose }: { ctl: MailCtl; onClose: () => void }) {
  return <SharedEditor project={projectOf(ctl)} onClose={onClose} />;
}

/** The trust centre of the macros (level, trusted folders, signature and library). */
export function MacroSecurity({ ctl, onClose }: { ctl: MailCtl; onClose: () => void }) {
  return <MacroSecurityDialog project={projectOf(ctl)} onClose={onClose} />;
}
