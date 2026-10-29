import { t } from '@suitenova/core-ui';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { BaseCtl, Tab } from './ctl';
import { BaseRuntime, type ModuleDef } from './runtime';

const SAVE_DELAY = 400;

/** The editor of a module of Nova Basic code, with a way to run procedures and an immediate window. */
export function ModuleEditor({ ctl, tab }: { ctl: BaseCtl; tab: Tab }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const db = ctl.db!;
  const [code, setCode] = useState(() => db.getObject<ModuleDef>('module', tab.name)?.code ?? '');
  const [proc, setProc] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string; line?: number } | null>(null);
  const [cmd, setCmd] = useState('');
  const history = useRef<string[]>([]);
  const histIdx = useRef(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const tabMoves = useRef(false);

  // saved a moment after typing stops, and always when leaving
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current !== null) {
      ctl.saveModule(tab.name, pending.current);
      pending.current = null;
    }
  };
  useEffect(() => flush, []); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (v: string) => {
    setCode(v);
    pending.current = v;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY);
  };

  const problems = useMemo(() => BaseRuntime.check(tab.name, code), [code, tab.name]);
  const procs = useMemo(() => {
    try {
      return ctl.runtime.procedures().filter((p) => p.module === tab.name);
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl.getVersion(), code]);
  const lines = code.split('\n').length;

  const goTo = (line: number) => {
    const el = area.current;
    if (!el) return;
    const text = code.split('\n');
    let pos = 0;
    for (let i = 0; i < Math.min(line - 1, text.length); i++) pos += text[i]!.length + 1;
    el.focus();
    el.setSelectionRange(pos, pos + (text[line - 1]?.length ?? 0));
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 18;
    el.scrollTop = Math.max(0, (line - 4) * lh);
  };

  const run = async () => {
    flush();
    if (problems.length) {
      const p = problems[0]!;
      setMsg({ ok: false, text: `${t('Hay errores de sintaxis')}: ${t('línea')} ${p.line}: ${p.message}`, line: p.line });
      goTo(p.line);
      return;
    }
    // the list on screen may be a moment behind what was just typed
    const live = ctl.runtime.procedures().filter((p) => p.module === tab.name);
    const name = proc && live.some((p) => p.name === proc) ? proc : live.find((p) => p.kind === 'sub' && p.params.every((x) => x.optional))?.name;
    if (!name) return setMsg({ ok: false, text: t('No hay ningún procedimiento (Sub) que ejecutar en este módulo.') });
    const r = await ctl.runHandler({ kind: 'proc', name });
    const at = ctl.runtime.lastAt;
    setMsg(r.error ? { ok: false, text: r.error, line: at?.module === tab.name ? at.line : undefined } : { ok: true, text: t('"{name}" terminó correctamente.', { name }) });
    if (r.error && at?.module === tab.name) goTo(at.line);
  };

  const immediate = () => {
    const src = cmd.trim();
    if (!src) return;
    history.current.push(src);
    histIdx.current = history.current.length;
    setCmd('');
    ctl.runtime.print(`> ${src}`);
    if (!ctl.contentEnabled) return void ctl.runtime.print(t('El contenido activo está deshabilitado en este archivo.'));
    flush();
    const r = ctl.runtime.immediate(src);
    if (!r.ok) ctl.runtime.print(`⚠ ${r.error}`);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab writes spaces, as in a code editor; Esc followed by Tab leaves the box (so the keyboard is never trapped)
    if (e.key === 'Escape') {
      tabMoves.current = true;
      return;
    }
    if (e.key === 'Tab' && !tabMoves.current && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const s = el.selectionStart;
      const en = el.selectionEnd;
      const next = code.slice(0, s) + '    ' + code.slice(en);
      change(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
      return;
    }
    tabMoves.current = false;
    if (e.key === 'Enter') {
      // keep the indentation of the current line
      const el = e.currentTarget;
      const s = el.selectionStart;
      const lineStart = code.lastIndexOf('\n', s - 1) + 1;
      const indent = /^[ \t]*/.exec(code.slice(lineStart, s))![0];
      if (indent) {
        e.preventDefault();
        const next = code.slice(0, s) + '\n' + indent + code.slice(el.selectionEnd);
        change(next);
        requestAnimationFrame(() => el.setSelectionRange(s + 1 + indent.length, s + 1 + indent.length));
      }
    }
  };

  const bad = new Set(problems.map((p) => p.line));
  return (
    <div className="bs-module">
      <div className="bs-toolbar" role="toolbar" aria-label={t('Módulo')}>
        <label>
          {t('Procedimiento')}
          <select aria-label={t('Procedimiento que se ejecuta')} value={proc} onChange={(e) => setProc(e.target.value)}>
            <option value="">{t('(el primero)')}</option>
            {procs.map((p) => (
              <option key={p.name} value={p.name}>
                {p.kind === 'sub' ? 'Sub' : 'Function'} {p.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="bs-btn bs-btn--primary" onClick={() => void run()}>
          {t('Ejecutar')}
        </button>
        <button
          type="button"
          className="bs-btn"
          onClick={() => {
            flush();
            setMsg(problems.length ? { ok: false, text: `${t('Línea')} ${problems[0]!.line}: ${problems[0]!.message}`, line: problems[0]!.line } : { ok: true, text: t('No se encontraron errores de sintaxis.') });
            if (problems.length) goTo(problems[0]!.line);
          }}
        >
          {t('Comprobar sintaxis')}
        </button>
        <span className="bs-hint" aria-live="polite">
          {problems.length ? `⚠ ${t('Línea')} ${problems[0]!.line}: ${problems[0]!.message}` : t('Sin errores de sintaxis')}
        </span>
      </div>
      {!ctl.contentEnabled && <p className="bs-hint">{t('El contenido activo está deshabilitado en este archivo: habilítelo para ejecutar código.')}</p>}
      {msg && (
        <div className={msg.ok ? 'bs-ok' : 'bs-error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
          {msg.line ? (
            <>
              {' '}
              <button type="button" className="bs-btn" onClick={() => goTo(msg.line!)}>
                {t('Ir a la línea {n}', { n: msg.line })}
              </button>
            </>
          ) : null}
        </div>
      )}
      <div className="bs-editor">
        <div className="bs-gutter" ref={gutter} aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className={bad.has(i + 1) ? 'is-bad' : ''}>
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={area}
          className="bs-code"
          aria-label={t('Código del módulo {name}', { name: tab.name })}
          spellCheck={false}
          wrap="off"
          value={code}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKey}
          onScroll={(e) => gutter.current && (gutter.current.scrollTop = e.currentTarget.scrollTop)}
        />
      </div>
      <div className="bs-console" role="region" aria-label={t('Ventana inmediato')}>
        <div className="bs-consolebar">
          <strong>{t('Ventana inmediato')}</strong>
          <span className="bs-hint">{t('Escriba una instrucción, o ? expresión, y pulse Intro. Debug.Print escribe aquí.')}</span>
          <button type="button" className="bs-btn" onClick={() => ctl.runtime.clearConsole()}>
            {t('Limpiar')}
          </button>
        </div>
        <pre className="bs-consoleout" aria-live="polite" aria-label={t('Salida')}>
          {ctl.runtime.console.join('\n')}
        </pre>
        <input
          aria-label={t('Instrucción inmediata')}
          className="bs-consolein"
          value={cmd}
          placeholder="? 2 + 2"
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') immediate();
            else if (e.key === 'ArrowUp' && history.current.length) {
              histIdx.current = Math.max(0, histIdx.current - 1);
              setCmd(history.current[histIdx.current] ?? '');
            } else if (e.key === 'ArrowDown') {
              histIdx.current = Math.min(history.current.length, histIdx.current + 1);
              setCmd(history.current[histIdx.current] ?? '');
            }
          }}
        />
      </div>
    </div>
  );
}
