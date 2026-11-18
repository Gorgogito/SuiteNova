import type { WriterUI } from './commands';
import { focusDocSoon } from './dialogs';
import { AutoCorrectDialog as Shared } from '../spell';
import { saveAutoCorrect } from './autocorrect';

/** «Opciones de autocorrección» de Writer: el cuadro compartido, guardando también en el documento abierto. */
export function AutoCorrectDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  return (
    <Shared
      product="Nova Writer"
      initial={ui.ctl.autoCorrect}
      onSave={(o) => {
        ui.ctl.autoCorrect = o;
        saveAutoCorrect(o);
        focusDocSoon(ui);
      }}
      onClose={onClose}
    />
  );
}
