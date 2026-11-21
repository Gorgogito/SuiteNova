import type { CommandDef } from '@suitenova/core-ui';
import { speechAvailable } from '../voice/webSpeech';
import '../voice/messages';
import type { SlidesUI } from './commands';

/** Read Aloud: reads the slides from the open one on (with or without the notes), or only the notes, with the shared bar. */
export function voiceCommands(ui: SlidesUI): CommandDef[] {
  const c = ui.ctl;
  const r = c.readAloud;
  const toggle = () => (r.voice.snapshot.state === 'playing' ? r.voice.reader.pause() : r.voice.snapshot.state === 'paused' ? r.voice.reader.resume() : r.start());
  return [
    {
      id: 'slides.read.start',
      label: 'Leer en voz alta',
      icon: 'volume',
      shortcut: 'Ctrl+Alt+Space',
      description: 'Lee en voz alta desde la diapositiva abierta hasta la última: el título y el texto de cada una. Muestra la diapositiva que lee y marca el objeto.',
      enabled: () => speechAvailable() && !c.inMaster,
      run: () => (r.visible ? toggle() : r.start()),
    },
    {
      id: 'slides.read.notes',
      label: 'Leer las notas en voz alta',
      icon: 'volume',
      description: 'Lee en voz alta solo las notas del orador, desde la diapositiva abierta.',
      enabled: () => speechAvailable() && !c.inMaster,
      run: () => r.start(true),
    },
    {
      id: 'slides.read.withNotes',
      label: 'Incluir las notas al leer',
      icon: 'check',
      description: 'Al leer en voz alta, lee también las notas del orador después del texto de cada diapositiva.',
      checked: () => r.withNotes,
      run: () => {
        r.withNotes = !r.withNotes;
      },
    },
    { id: 'slides.read.stop', label: 'Detener la lectura', icon: 'close', description: 'Detiene la lectura en voz alta y cierra su barra.', enabled: () => r.visible, run: () => r.stop() },
  ];
}
