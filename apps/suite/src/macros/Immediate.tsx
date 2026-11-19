import { Button, Input } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useRef, useState } from 'react';
import './macros.css';
import './messages';

/** The immediate window: what `Debug.Print` writes, and a line to type an instruction (or `? expression`) with a history on the arrows. */
export function ImmediateWindow({ lines, onRun, onClear }: { lines: string[]; onRun: (src: string) => void; onClear: () => void }) {
  const [cmd, setCmd] = useState('');
  const history = useRef<string[]>([]);
  const idx = useRef(0);
  return (
    <div className="nv-mac__console" role="region" aria-label={t('Ventana inmediato')}>
      <div className="nv-mac__consolebar">
        <strong>{t('Ventana inmediato')}</strong>
        <small>{t('Escriba una instrucción, o ? expresión, y pulse Intro. Debug.Print escribe aquí.')}</small>
        <Button size="small" onClick={onClear}>{t('Limpiar')}</Button>
      </div>
      <pre className="nv-mac__out" aria-live="polite" aria-label={t('Salida')}>{lines.join('\n')}</pre>
      <Input
        aria-label={t('Instrucción inmediata')}
        value={cmd}
        placeholder="? 2 + 2"
        onChange={(_e, v) => setCmd(v.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const src = cmd.trim();
            if (!src) return;
            history.current.push(src);
            idx.current = history.current.length;
            setCmd('');
            onRun(src);
          } else if (e.key === 'ArrowUp' && history.current.length) {
            idx.current = Math.max(0, idx.current - 1);
            setCmd(history.current[idx.current] ?? '');
          } else if (e.key === 'ArrowDown') {
            idx.current = Math.min(history.current.length, idx.current + 1);
            setCmd(history.current[idx.current] ?? '');
          }
        }}
      />
    </div>
  );
}
