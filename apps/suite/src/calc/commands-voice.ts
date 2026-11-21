import type { CommandDef } from '@suitenova/core-ui';
import { speechAvailable } from '../voice/webSpeech';
import '../voice/messages';
import type { CalcUI } from './commands';

/** «Hablar celdas» (as in Excel): reads the selected cells by rows or by columns, and can say each cell as it is entered. */
export function voiceCommands(ui: CalcUI): CommandDef[] {
  const d = ui.doc;
  const r = d.reader;
  return [
    {
      id: 'calc.speak.cells',
      label: 'Hablar celdas',
      icon: 'volume',
      description: 'Lee en voz alta lo que muestran las celdas seleccionadas, una a una, por filas o por columnas.',
      enabled: () => speechAvailable() && !d.edit,
      run: () => (r.visible && r.voice.snapshot.state === 'playing' ? r.voice.reader.pause() : r.visible && r.voice.snapshot.state === 'paused' ? r.voice.reader.resume() : r.start()),
    },
    { id: 'calc.speak.stop', label: 'Detener hablar celdas', icon: 'close', description: 'Detiene la lectura de las celdas y cierra su barra.', enabled: () => r.visible, run: () => r.stop() },
    {
      id: 'calc.speak.byRows',
      label: 'Hablar celdas por filas',
      icon: 'volume',
      description: 'Lee las celdas de izquierda a derecha y luego hacia abajo.',
      checked: () => !r.byColumns,
      run: () => {
        r.byColumns = false;
      },
    },
    {
      id: 'calc.speak.byColumns',
      label: 'Hablar celdas por columnas',
      icon: 'volume',
      description: 'Lee las celdas de arriba abajo y luego hacia la derecha.',
      checked: () => r.byColumns,
      run: () => {
        r.byColumns = true;
      },
    },
    {
      id: 'calc.speak.enter',
      label: 'Hablar celdas al pulsar Intro',
      icon: 'volume',
      description: 'Dice en voz alta cada celda en cuanto se escribe y se pulsa Intro.',
      checked: () => r.speakOnEnter,
      run: () => {
        r.speakOnEnter = !r.speakOnEnter;
      },
    },
  ];
}
