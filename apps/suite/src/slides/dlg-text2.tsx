import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { replaceFont, usedFonts } from '@suitenova/slides-core';
import { useMemo, useState } from 'react';
import { SYMBOL_GROUPS } from '../writer/symbols';
import { FONT_NAMES, type SlidesUI } from './commands';
import { Modal } from './Dialogs';

type P = { ui: SlidesUI; onClose: () => void };

/** Symbol picker: inserts into the text being edited and stays open to insert more. */
export function SymbolDialog({ ui, onClose }: P) {
  const [group, setGroup] = useState(SYMBOL_GROUPS[0]!.id);
  const [picked, setPicked] = useState<{ ch: string; name: string } | null>(null);
  const g = SYMBOL_GROUPS.find((x) => x.id === group)!;
  const insert = (ch: string) => {
    const v = ui.ctl.editor;
    if (v) v.dispatch(v.state.tr.insertText(ch));
  };
  const close = () => {
    onClose();
    ui.ctl.editor?.focus();
  };
  return (
    <Modal
      title={t('Símbolo')}
      onClose={close}
      wide
      actions={
        <>
          <Button appearance="primary" disabled={!picked} onClick={() => picked && insert(picked.ch)}>
            {t('Insertar')}
          </Button>
          <Button onClick={close}>{t('Cerrar')}</Button>
        </>
      }
    >
      <div className="sl-form">
        <label className="sl-field">
          <span>{t('Grupo')}</span>
          <select aria-label={t('Grupo de símbolos')} value={group} onChange={(e) => setGroup(e.target.value)}>
            {SYMBOL_GROUPS.map((x) => (
              <option key={x.id} value={x.id}>
                {t(x.label)}
              </option>
            ))}
          </select>
        </label>
        <div role="grid" aria-label={t(g.label)} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 36px)', gap: 2, maxHeight: 260, overflow: 'auto' }}>
          {g.chars.map(([ch, name]) => (
            <button
              key={ch}
              type="button"
              title={t(name)}
              aria-label={t(name)}
              aria-pressed={picked?.ch === ch}
              onClick={() => setPicked({ ch, name })}
              onDoubleClick={() => insert(ch)}
              style={{ width: 36, height: 36, fontSize: 18, border: picked?.ch === ch ? '2px solid var(--colorBrandStroke1, #c55a11)' : '1px solid rgba(128,128,128,.35)', background: 'transparent', cursor: 'pointer', color: 'inherit' }}
            >
              {ch}
            </button>
          ))}
        </div>
        <p className="sl-note" aria-live="polite">
          {picked ? `${picked.ch}  ${t(picked.name)}  (U+${picked.ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})` : t('Elige un símbolo; doble clic lo inserta.')}
        </p>
      </div>
    </Modal>
  );
}

/** Replace one font of the whole presentation by another. */
export function ReplaceFontsDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const used = useMemo(() => [...usedFonts(c.realDeck)].sort((a, b) => b[1] - a[1]), [c]);
  const [from, setFrom] = useState(used[0]?.[0] ?? '');
  const [to, setTo] = useState('Calibri');
  const names = [...new Set([...FONT_NAMES, to])];
  const apply = () => {
    c.applyReal('Reemplazar fuentes', (d) => replaceFont(d, from, to));
    c.say(t('Se reemplazó «{from}» por «{to}».', { from, to }));
    onClose();
  };
  return (
    <Modal
      title={t('Reemplazar fuentes')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!from || from === to} onClick={apply}>
            {t('Reemplazar')}
          </Button>
        </>
      }
    >
      <div className="sl-form">
        {!used.length ? (
          <p className="sl-note">{t('La presentación no usa ninguna fuente concreta.')}</p>
        ) : (
          <>
            <label className="sl-field">
              <span>{t('Reemplazar')}</span>
              <select aria-label={t('Fuente que se reemplaza')} value={from} onChange={(e) => setFrom(e.target.value)}>
                {used.map(([f, n]) => (
                  <option key={f} value={f}>
                    {f} ({n})
                  </option>
                ))}
              </select>
            </label>
            <label className="sl-field">
              <span>{t('Por')}</span>
              <select aria-label={t('Fuente nueva')} value={to} onChange={(e) => setTo(e.target.value)}>
                {names.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <p className="sl-note">{t('Cambia el texto, los estilos de lista, el patrón, los diseños y las fuentes del tema. El número entre paréntesis es cuántas veces se usa.')}</p>
          </>
        )}
      </div>
    </Modal>
  );
}
