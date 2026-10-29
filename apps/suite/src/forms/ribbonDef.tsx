import { Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components';
import { Icon, t, type RibbonTab } from '@suitenova/core-ui';
import { QTYPES } from '@suitenova/forms-core';
import { ChevronDown } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { helpTab, viewTab } from '../common';
import { MODES, type FormsUI } from './commands';

const COLORS = ['#0f6cbd', '#0b7a75', '#107c10', '#8a8a00', '#c19c00', '#ca5010', '#c50f1f', '#b4009e', '#5c2d91', '#4f6bed', '#2f4f6f', '#605e5c'];

function ThemeColor({ ui }: { ui: FormsUI }) {
  const c = ui.ctl;
  useSyncExternalStore(c.subscribe, c.getVersion);
  const [open, setOpen] = useState(false);
  const label = t('Color del tema');
  const pick = (col: string) => {
    c.setForm({ color: col });
    setOpen(false);
  };
  return (
    <div className="nv-split">
      <button type="button" className="nv-btn nv-btn--large" aria-label={label} title={label} onClick={() => setOpen(true)}>
        <Icon name="settings" />
        <span className="nv-colorbar" style={{ background: c.form.color }} />
        <span>{label}</span>
      </button>
      <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} positioning="below-start">
        <PopoverTrigger disableButtonEnhancement>
          <button type="button" className="nv-btn nv-btn--small nv-btn--menu" aria-label={`${label} (${t('más')})`} aria-haspopup="dialog">
            <ChevronDown size={12} />
          </button>
        </PopoverTrigger>
        <PopoverSurface>
          <div className="nv-swatches" role="group" aria-label={label}>
            {COLORS.map((col) => (
              <button key={col} type="button" style={{ background: col }} aria-label={col} title={col} onClick={() => pick(col)} />
            ))}
          </div>
        </PopoverSurface>
      </Popover>
    </div>
  );
}

/** The ribbon of Nova Forms. Every item is bound to a registered command. */
export function formsTabs(ui: FormsUI): RibbonTab[] {
  const home: RibbonTab = {
    id: 'home',
    label: 'tab.home',
    keytip: 'I',
    groups: [
      {
        id: 'add',
        label: 'Preguntas',
        icon: 'plus',
        items: [
          { kind: 'dropdown', id: 'addMenu', label: 'Añadir pregunta', icon: 'plus', size: 'large', keytip: 'AP', entries: QTYPES.map((q) => ({ kind: 'command' as const, command: `forms.q.add.${q.id}` })) },
          { kind: 'button', command: 'forms.q.add.choice', size: 'small', keytip: 'OP' },
          { kind: 'button', command: 'forms.q.add.text', size: 'small', keytip: 'TX' },
          { kind: 'button', command: 'forms.q.add.rating', size: 'small', keytip: 'CA' },
        ],
      },
      {
        id: 'edit',
        label: 'Pregunta seleccionada',
        icon: 'edit',
        items: [
          { kind: 'button', command: 'forms.q.required', size: 'large', keytip: 'OB' },
          { kind: 'button', command: 'forms.q.duplicate', size: 'small', keytip: 'DU' },
          { kind: 'button', command: 'forms.q.up', size: 'small', keytip: 'SU' },
          { kind: 'button', command: 'forms.q.down', size: 'small', keytip: 'BA' },
          { kind: 'button', command: 'forms.q.delete', size: 'small', keytip: 'EL' },
        ],
      },
      { id: 'head', label: 'Formulario', icon: 'file', items: [{ kind: 'button', command: 'forms.q.top', size: 'large', keytip: 'TF' }] },
      { id: 'import', label: 'Importar', icon: 'open', items: [{ kind: 'button', command: 'forms.import', size: 'large', keytip: 'IF' }] },
    ],
  };
  const design: RibbonTab = {
    id: 'design',
    label: 'Diseño',
    keytip: 'D',
    groups: [
      { id: 'theme', label: 'Tema', icon: 'settings', items: [{ kind: 'custom', id: 'themeColor', label: 'Color del tema', keytip: 'CT', render: () => <ThemeColor ui={ui} /> }] },
      {
        id: 'quiz',
        label: 'Cuestionario',
        icon: 'checkSquare',
        items: [
          { kind: 'button', command: 'forms.quiz', size: 'large', keytip: 'MC' },
          { kind: 'button', command: 'forms.showScore', size: 'large', keytip: 'MP' },
        ],
      },
    ],
  };
  const responses: RibbonTab = {
    id: 'responses',
    label: 'Respuestas',
    keytip: 'R',
    groups: [
      {
        id: 'collect',
        label: 'Recoger',
        icon: 'forms',
        items: [
          { kind: 'button', command: 'forms.export.html', size: 'large', keytip: 'WH' },
          { kind: 'button', command: 'forms.responses.import', size: 'large', keytip: 'IM' },
          { kind: 'button', command: 'forms.mode.fill', size: 'large', keytip: 'RL' },
        ],
      },
      {
        id: 'data',
        label: 'Datos',
        icon: 'exportFile',
        items: [
          { kind: 'button', command: 'forms.export.csv', size: 'large', keytip: 'CS' },
          { kind: 'button', command: 'forms.responses.clear', size: 'large', keytip: 'EA' },
        ],
      },
    ],
  };
  const view = viewTab({ zoom: false });
  view.groups.unshift({ id: 'modes', label: 'Modo', icon: 'eye', items: MODES.map(([m], i) => ({ kind: 'button' as const, command: `forms.mode.${m}`, size: 'large' as const, keytip: ['MD', 'MV', 'MR', 'ME'][i]! })) });
  return [home, design, responses, view, helpTab()];
}
