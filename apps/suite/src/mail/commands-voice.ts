import type { CommandDef } from '@suitenova/core-ui';
import { speechAvailable } from '../voice/webSpeech';
import '../voice/messages';
import type { MailUI } from './commands';

/** Read Aloud: reads the open message (who sent it, the subject and the body) with the shared bar. */
export function voiceCommands(ui: MailUI): CommandDef[] {
  const c = ui.ctl;
  const r = c.readAloud;
  return [
    {
      id: 'mail.read.start',
      label: 'Leer en voz alta',
      icon: 'volume',
      shortcut: 'Ctrl+Alt+Space',
      description: 'Lee en voz alta el mensaje abierto: quién lo envía, el asunto y el texto, marcando la frase y la palabra que suena.',
      enabled: () => c.section === 'mail' && !!c.selected && speechAvailable(),
      run: () => (r.visible && r.voice.snapshot.state === 'playing' ? r.voice.reader.pause() : r.visible && r.voice.snapshot.state === 'paused' ? r.voice.reader.resume() : r.start()),
    },
    {
      id: 'mail.read.stop',
      label: 'Detener la lectura',
      icon: 'close',
      description: 'Detiene la lectura en voz alta y cierra su barra.',
      enabled: () => r.visible,
      run: () => r.stop(),
    },
  ];
}
