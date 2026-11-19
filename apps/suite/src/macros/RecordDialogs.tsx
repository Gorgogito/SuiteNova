import { Button, Field, Input, Textarea } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useState } from 'react';
import { MacroModal } from './MacroDialogs';
import { macroNameProblem, suggestMacroName } from './recorder';
import './macros.css';
import './messages';

/** «Grabar macro»: the name and a description; the macro is written when the recording stops. */
export function RecordMacroDialog({ taken, onStart, onClose }: { taken: string[]; onStart: (name: string, description: string) => void; onClose: () => void }) {
  const [name, setName] = useState(() => suggestMacroName(taken));
  const [description, setDescription] = useState('');
  const problem = macroNameProblem(name, taken);
  const start = () => {
    if (problem) return;
    onStart(name, description);
    onClose();
  };
  return (
    <MacroModal
      title={t('Grabar macro')}
      onClose={onClose}
      width={460}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!!problem} onClick={start}>
            {t('Grabar')}
          </Button>
        </>
      }
    >
      <Field label={t('Nombre de la macro')} validationState={problem ? 'error' : 'none'} validationMessage={problem ? t(problem) : undefined}>
        <Input
          value={name}
          onChange={(_e, v) => setName(v.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') start();
          }}
          autoFocus
        />
      </Field>
      <Field label={t('Descripción')} style={{ marginTop: 8 }}>
        <Textarea value={description} onChange={(_e, v) => setDescription(v.value)} rows={3} resize="vertical" />
      </Field>
      <p className="nv-mac__help">{t('La macro se guarda en el módulo «Grabadas» de este archivo. Mientras se graba, lo que hace es lo que queda escrito; lo que Nova no puede escribir como código queda como un comentario.')}</p>
    </MacroModal>
  );
}

/** What the status bar shows while a macro is being recorded: its name, Pause and Stop. */
export function RecordingStatus({ name, paused, onPause, onStop }: { name: string; paused: boolean; onPause: () => void; onStop: () => void }) {
  return (
    <span role="status" className="nv-mac__rec">
      <span aria-hidden="true" className="nv-mac__recdot">●</span>
      {t('Grabando macro «{n}»', { n: name })}
      {paused ? ` ${t('(en pausa)')}` : ''}
      <button type="button" onClick={onPause}>{paused ? t('Reanudar grabación') : t('Pausar grabación')}</button>
      <button type="button" onClick={onStop}>{t('Detener grabación')}</button>
    </span>
  );
}
