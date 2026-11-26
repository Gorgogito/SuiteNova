import { Button } from '@fluentui/react-components';
import { Icon, t } from '@suitenova/core-ui';
import { reorderElements, type SlideElement } from '@suitenova/slides-core';
import { useState, useSyncExternalStore } from 'react';
import type { SlidesUI } from './commands';

const KINDS: Record<string, string> = { shape: 'Forma', pic: 'Imagen', group: 'Grupo', cxn: 'Conector', table: 'Tabla', chart: 'Gráfico', media: 'Multimedia', ole: 'Objeto' };

/** Selection pane: the objects of the slide from front to back, with eye, rename and order. */
export function SelectionPane({ ui }: { ui: SlidesUI }) {
  const c = ui.ctl;
  useSyncExternalStore(c.subscribe, c.getVersion);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const shapes = c.slide.shapes;
  const list = [...shapes].reverse();
  const hiddenCount = shapes.filter((e) => e.hidden).length;
  const commit = () => {
    if (editing) c.renameElement(editing, draft);
    setEditing(null);
  };
  const rename = (el: SlideElement) => {
    setEditing(el.id);
    setDraft(el.name ?? '');
  };
  const move = (id: string, how: 'forward' | 'backward') => c.apply(how === 'forward' ? 'Traer adelante' : 'Enviar atrás', (d) => reorderElements(d, c.slide.id, [id], how));
  return (
    <aside className="sl-pane nv-panel" aria-label={t('Panel de selección')}>
      <h2>{t('Panel de selección')}</h2>
      <div className="sl-selbar">
        <Button size="small" disabled={!shapes.length || hiddenCount === shapes.length} onClick={() => c.patch(shapes.map((e) => e.id), 'Ocultar objeto', (e) => ({ ...e, hidden: true }) as SlideElement)}>
          {t('Ocultar todo')}
        </Button>
        <Button size="small" disabled={!hiddenCount} onClick={() => c.patch(shapes.map((e) => e.id), 'Mostrar objeto', (e) => ({ ...e, hidden: undefined }) as SlideElement)}>
          {t('Mostrar todo')}
        </Button>
      </div>
      {!list.length ? (
        <p className="sl-note">{t('Esta diapositiva no tiene objetos.')}</p>
      ) : (
        <ul className="sl-sellist" aria-label={t('Objetos de la diapositiva')}>
          {list.map((el) => {
            const name = el.name || t(KINDS[el.kind] ?? 'Objeto');
            const on = c.selection.includes(el.id);
            return (
              <li key={el.id} className={(on ? 'is-on ' : '') + (el.hidden ? 'is-hidden' : '')}>
                {editing === el.id ? (
                  <input
                    className="sl-selname"
                    aria-label={t('Nombre del objeto')}
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commit();
                      else if (e.key === 'Escape') setEditing(null);
                      e.stopPropagation();
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="sl-selitem"
                    aria-pressed={on}
                    title={t('Renombrar') + ': F2'}
                    onClick={(e) => (el.hidden ? c.say('El objeto está oculto: muéstralo para seleccionarlo.') : c.select([el.id], e.ctrlKey || e.shiftKey))}
                    onDoubleClick={() => rename(el)}
                    onKeyDown={(e) => {
                      if (e.key === 'F2') rename(el);
                    }}
                  >
                    {name}
                  </button>
                )}
                <button type="button" className="sl-selbtn" aria-label={t('Traer adelante') + ': ' + name} title={t('Traer adelante')} onClick={() => move(el.id, 'forward')}>
                  <Icon name="chevronUp" />
                </button>
                <button type="button" className="sl-selbtn" aria-label={t('Enviar atrás') + ': ' + name} title={t('Enviar atrás')} onClick={() => move(el.id, 'backward')}>
                  <Icon name="chevronDown" />
                </button>
                <button type="button" className="sl-selbtn" aria-pressed={!!el.hidden} aria-label={t('Mostrar u ocultar') + ': ' + name} title={t('Mostrar u ocultar')} onClick={() => c.setHidden(el.id, !el.hidden)}>
                  <Icon name={el.hidden ? 'eyeOff' : 'eye'} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
