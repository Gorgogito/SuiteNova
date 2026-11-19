import { Button } from '@fluentui/react-components';
import type { basic } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import './macros.css';
import './messages';

/**
 * The controls and the windows of a paused run: Continue (F5), Step Into (F8), Step Over (Shift+F8), Step Out (Ctrl+Shift+F8) and Stop, the
 * variables of the selected procedure and the stack of calls.
 */
export function DebugPanel({
  where,
  stack,
  frame,
  onFrame,
  locals,
  onStep,
  onStop,
}: {
  where: { proc: string; module: string; line: number };
  stack: { proc: string; module: string; line: number }[];
  frame: number;
  onFrame: (i: number) => void;
  locals: basic.DebugVar[];
  onStep: (mode: basic.DebugStep) => void;
  onStop: () => void;
}) {
  return (
    <div className="nv-mac__debug" role="region" aria-label={t('Depuración')}>
      <div className="nv-mac__debugbar" role="toolbar" aria-label={t('Controles de depuración')}>
        <Button appearance="primary" size="small" onClick={() => onStep('continue')} title="F5">{t('Continuar')}</Button>
        <Button size="small" onClick={() => onStep('into')} title="F8">{t('Paso a paso por instrucciones')}</Button>
        <Button size="small" onClick={() => onStep('over')} title="Mayús+F8">{t('Paso a paso por procedimientos')}</Button>
        <Button size="small" onClick={() => onStep('out')} title="Ctrl+Mayús+F8">{t('Paso a paso para salir')}</Button>
        <Button size="small" onClick={onStop}>{t('Detener')}</Button>
        <small aria-live="polite">{t('Detenido en {p}, línea {n}', { p: where.proc || where.module, n: where.line })}</small>
      </div>
      <div className="nv-mac__panes">
        <div className="nv-mac__vars" role="region" aria-label={t('Variables')}>
          <table>
            <thead>
              <tr>
                <th>{t('Nombre')}</th>
                <th>{t('Valor')}</th>
                <th>{t('Tipo')}</th>
              </tr>
            </thead>
            <tbody>
              {locals.length === 0 && (
                <tr>
                  <td colSpan={3}>{t('(sin variables)')}</td>
                </tr>
              )}
              {locals.map((v, i) => (
                <tr key={`${v.name}-${i}`}>
                  <td>{v.name}</td>
                  <td title={v.value}>{v.value}</td>
                  <td>{v.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="nv-mac__stack" role="listbox" aria-label={t('Pila de llamadas')}>
          {stack.map((f, i) => (
            <li key={i} role="option" aria-selected={i === frame} onClick={() => onFrame(i)}>
              {f.proc || f.module}:{f.line}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
