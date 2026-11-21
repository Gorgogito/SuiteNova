import type { CommandDef } from '@suitenova/core-ui';
import { speechAvailable } from '../voice/webSpeech';
import '../voice/messages';
import type { WriterUI } from './commands';

/** Read Aloud: reads the document from the cursor (or what is selected) with the shared bar. */
export function voiceCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const r = c.readAloud;
  return [
    {
      id: 'writer.read.start',
      label: 'Leer en voz alta',
      icon: 'volume',
      shortcut: 'Ctrl+Alt+Space',
      description: 'Lee el documento en voz alta desde el cursor, o lo que está seleccionado, y va marcando la frase y la palabra que suena.',
      enabled: () => !!c.mainView && speechAvailable(),
      run: () => (r.visible && r.voice.snapshot.state === 'playing' ? r.voice.reader.pause() : r.visible && r.voice.snapshot.state === 'paused' ? r.voice.reader.resume() : r.start()),
    },
    {
      id: 'writer.read.stop',
      label: 'Detener la lectura',
      icon: 'close',
      description: 'Detiene la lectura en voz alta y cierra su barra.',
      enabled: () => r.visible,
      run: () => r.stop(),
    },
  ];
}
