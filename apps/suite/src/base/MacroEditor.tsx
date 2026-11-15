import { basic } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useState, useSyncExternalStore } from 'react';
import type { BaseCtl, Tab } from './ctl';
import { MacroStepsEditor } from './MacroStepsEditor';

type MacroDef = basic.MacroDef;

/** The editor of a saved macro: a tree of steps (actions, If blocks, submacros…), with a way to run it. */
export function MacroEditor({ ctl, tab }: { ctl: BaseCtl; tab: Tab }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const def = ctl.macros.get(tab.id) ?? { steps: [] };
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async () => {
    const r = await ctl.runHandler({ kind: 'macro', name: tab.name });
    setResult(r.error ? { ok: false, text: r.error } : { ok: true, text: t('La macro terminó correctamente.') });
  };

  return (
    <div className="bs-macro">
      <div className="bs-toolbar" role="toolbar" aria-label={t('Macro')}>
        <button type="button" className="bs-btn bs-btn--primary" onClick={() => void run()}>
          {t('Ejecutar macro')}
        </button>
      </div>
      {!ctl.contentEnabled && <p className="bs-hint">{t('El contenido activo está deshabilitado en este archivo: habilítelo para ejecutar macros.')}</p>}
      {result && (
        <div className={result.ok ? 'bs-ok' : 'bs-error'} role={result.ok ? 'status' : 'alert'}>
          {result.text}
        </div>
      )}
      <MacroStepsEditor ctl={ctl} def={def} selfName={tab.name} onChange={(d) => ctl.saveMacro(tab.id, d satisfies MacroDef)} />
    </div>
  );
}
