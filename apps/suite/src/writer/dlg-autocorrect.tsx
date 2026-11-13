import { Button, Checkbox, Input } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useState } from 'react';
import type { WriterUI } from './commands';
import { Modal, focusDocSoon } from './dialogs';
import { DEFAULT_AUTOCORRECT, saveAutoCorrect, type AutoCorrectOptions } from './autocorrect';

const FLAGS: [keyof Omit<AutoCorrectOptions, 'custom'>, string][] = [
  ['smartQuotes', 'Comillas rectas por comillas tipográficas'],
  ['symbols', 'Símbolos con teclas: (c) © (r) ® (tm) ™ ... … --> →'],
  ['fractions', 'Fracciones: 1/2 ½  1/4 ¼  3/4 ¾'],
  ['dashes', 'Guiones: -- por raya corta y --- por raya'],
  ['capitalizeSentences', 'Poner en mayúscula la primera letra de una oración'],
  ['fixTwoInitialCaps', 'Corregir DOs mayúsculas iniciales'],
  ['autoLinks', 'Convertir direcciones web y de correo en vínculos'],
  ['autoLists', 'Listas automáticas al escribir (1. a. i. y guion al empezar un párrafo)'],
];

/** Cuadro «Opciones de autocorrección»: lo que se corrige al escribir y los reemplazos propios. */
export function AutoCorrectDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const [o, setO] = useState<AutoCorrectOptions>(() => ({ ...ui.ctl.autoCorrect, custom: { ...ui.ctl.autoCorrect.custom } }));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const add = () => {
    const key = from.trim();
    if (!key || /\s/.test(key) || !to) return;
    setO({ ...o, custom: { ...o.custom, [key]: to } });
    setFrom('');
    setTo('');
  };
  const entries = Object.entries(o.custom);
  return (
    <Modal
      title={t('Opciones de autocorrección')}
      onClose={onClose}
      width={560}
      actions={
        <>
          <Button onClick={() => setO({ ...DEFAULT_AUTOCORRECT, custom: o.custom })}>{t('Restablecer')}</Button>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            onClick={() => {
              ui.ctl.autoCorrect = o;
              saveAutoCorrect(o);
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <p>{t('Lo que Nova Writer corrige mientras escribe. Ctrl+Z deshace la última corrección.')}</p>
      {FLAGS.map(([k, label]) => (
        <Checkbox key={k} label={t(label)} checked={!!o[k]} onChange={(_e, v) => setO({ ...o, [k]: !!v.checked })} />
      ))}
      <fieldset style={{ border: '1px solid var(--colorNeutralStroke2)', borderRadius: 6, marginTop: 12 }}>
        <legend>{t('Reemplazar texto mientras escribe')}</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end', marginBottom: 8 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            {t('Reemplazar')}
            <Input value={from} onChange={(_e, v) => setFrom(v.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            {t('Con')}
            <Input value={to} onChange={(_e, v) => setTo(v.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          </label>
          <Button onClick={add} disabled={!from.trim() || /\s/.test(from.trim()) || !to}>
            {t('Agregar')}
          </Button>
        </div>
        <div role="list" aria-label={t('Reemplazos propios')} style={{ maxHeight: 130, overflow: 'auto' }}>
          {entries.length === 0 && <small>{t('Todavía no hay reemplazos propios.')}</small>}
          {entries.map(([k, v]) => (
            <div key={k} role="listitem" style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <span>
                <b>{k}</b> → {v}
              </span>
              <Button
                size="small"
                appearance="subtle"
                aria-label={`${t('Quitar')} ${k}`}
                onClick={() => {
                  const { [k]: _gone, ...rest } = o.custom;
                  void _gone;
                  setO({ ...o, custom: rest });
                }}
              >
                {t('Quitar')}
              </Button>
            </div>
          ))}
        </div>
      </fieldset>
    </Modal>
  );
}
