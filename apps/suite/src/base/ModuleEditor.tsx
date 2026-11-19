import type { basic } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CodeEditor, type CodeEditorHandle } from '../macros/CodeEditor';
import { DebugPanel } from '../macros/DebugPanel';
import { checkModule } from '../macros/runtime';
import { ImmediateWindow } from '../macros/Immediate';
import type { BaseCtl, Tab } from './ctl';
import type { ModuleDef } from './runtime';

const SAVE_DELAY = 400;

/** The editor of a module of Nova Basic code, with a way to run procedures, step through them and an immediate window. */
export function ModuleEditor({ ctl, tab }: { ctl: BaseCtl; tab: Tab }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const db = ctl.db!;
  const rt = ctl.runtime;
  const [code, setCode] = useState(() => db.getObject<ModuleDef>('module', tab.name)?.code ?? '');
  const [proc, setProc] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string; line?: number } | null>(null);
  const [frame, setFrame] = useState(0);
  const editor = useRef<CodeEditorHandle>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);

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

  const problems = useMemo(() => checkModule(tab.name, code), [code, tab.name]);
  const procs = useMemo(() => {
    try {
      return rt.procedures().filter((p) => p.module === tab.name);
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl.getVersion(), code]);
  const bad = new Set(problems.map((p) => p.line));
  const run = rt.session?.state === 'paused' ? rt.session : null;
  const pause = run?.pause ?? null;
  const bps = rt.breakpoints.get(tab.name) ?? new Set<number>();

  const goTo = (line: number) => editor.current?.goTo(line);
  const toggleBreakpoint = (line: number) => {
    const set = new Set(rt.breakpoints.get(tab.name) ?? []);
    if (!set.delete(line)) set.add(line);
    rt.breakpoints.set(tab.name, set);
    rt.session?.setBreakpoints(rt.breakpointKeys());
    ctl.touch();
  };

  const pickProc = (): string | undefined => {
    // the list on screen may be a moment behind what was just typed
    const live = rt.procedures().filter((p) => p.module === tab.name);
    return proc && live.some((p) => p.name === proc) ? proc : live.find((p) => p.kind === 'sub' && p.params.every((x) => x.optional))?.name;
  };
  const refuseIfBroken = (): boolean => {
    if (!problems.length) return false;
    const p = problems[0]!;
    setMsg({ ok: false, text: `${t('Hay errores de sintaxis')}: ${t('línea')} ${p.line}: ${p.message}`, line: p.line });
    goTo(p.line);
    return true;
  };

  /** What to show after the run advanced: where it stopped (opening that module), or how it ended. */
  const settle = () => {
    const r = rt.session;
    if (!r) return;
    if (r.state === 'paused') {
      const p = r.pause!;
      setFrame(0);
      setMsg(null);
      if (p.module !== tab.name) ctl.openModule(p.module);
    } else {
      rt.session = null;
      const res = r.result;
      const at = rt.lastAt;
      setMsg(res.ok ? { ok: true, text: t('"{name}" terminó correctamente.', { name: rt.sessionName }) } : { ok: false, text: res.error ?? '', line: at?.module === tab.name ? at.line : undefined });
      if (!res.ok && at?.module === tab.name) goTo(at.line);
    }
    ctl.touch();
  };

  const startDebug = (stopAtStart: boolean) => {
    flush();
    if (refuseIfBroken()) return;
    const name = pickProc();
    if (!name) return setMsg({ ok: false, text: t('No hay ningún procedimiento (Sub) que ejecutar en este módulo.') });
    const started = rt.debug(name, stopAtStart);
    if ('error' in started) return setMsg({ ok: false, text: started.error.error ?? '', line: started.error.at?.line });
    settle();
  };

  const runIt = async () => {
    flush();
    if (refuseIfBroken()) return;
    const name = pickProc();
    if (!name) return setMsg({ ok: false, text: t('No hay ningún procedimiento (Sub) que ejecutar en este módulo.') });
    if (rt.breakpointKeys().length && ctl.contentEnabled) return startDebug(false); // with breakpoints, running stops at them
    const r = await ctl.runHandler({ kind: 'proc', name });
    const at = rt.lastAt;
    setMsg(r.error ? { ok: false, text: r.error, line: at?.module === tab.name ? at.line : undefined } : { ok: true, text: t('"{name}" terminó correctamente.', { name }) });
    if (r.error && at?.module === tab.name) goTo(at.line);
  };

  const step = (mode: basic.DebugStep) => {
    rt.session?.step(mode);
    settle();
  };
  const stop = () => {
    rt.stopDebug();
    setMsg({ ok: true, text: t('Se detuvo la ejecución.') });
  };
  // the debugger's own keys; F5 would reload the page, so it is always taken
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'F5' && !e.shiftKey) {
      e.preventDefault();
      if (run) step('continue');
      else void runIt();
    } else if (e.key === 'F8') {
      e.preventDefault();
      if (!run) startDebug(true);
      else step(e.ctrlKey && e.shiftKey ? 'out' : e.shiftKey ? 'over' : 'into');
    }
  };

  const immediate = (src: string) => {
    rt.print(`> ${src}`);
    if (run) {
      const out = run.evaluate(src, frame);
      rt.print(out.ok ? out.text : `⚠ ${out.text}`);
      ctl.touch();
      return;
    }
    if (!ctl.contentEnabled) return void rt.print(t('El contenido activo está deshabilitado en este archivo.'));
    flush();
    const r = rt.immediate(src);
    if (!r.ok) rt.print(`⚠ ${r.error}`);
  };

  return (
    <div className="bs-module" onKeyDown={onKeyDown}>
      <div className="bs-toolbar" role="toolbar" aria-label={t('Módulo')}>
        <label>
          {t('Procedimiento')}
          <select aria-label={t('Procedimiento que se ejecuta')} value={proc} disabled={!!run} onChange={(e) => setProc(e.target.value)}>
            <option value="">{t('(el primero)')}</option>
            {procs.map((p) => (
              <option key={p.name} value={p.name}>
                {p.kind === 'sub' ? 'Sub' : 'Function'} {p.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="bs-btn bs-btn--primary" disabled={!!run} onClick={() => void runIt()} title="F5">
          {t('Ejecutar')}
        </button>
        <button type="button" className="bs-btn" disabled={!!run || !ctl.contentEnabled} onClick={() => startDebug(true)} title="F8">
          {t('Depurar')}
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
      <CodeEditor
        handle={editor}
        fill
        code={code}
        onChange={change}
        label={t('Código del módulo {name}', { name: tab.name })}
        readOnly={!!run}
        bad={bad}
        breakpoints={bps}
        onToggleBreakpoint={toggleBreakpoint}
        current={pause && pause.module === tab.name ? pause.line : null}
      />
      <small className="nv-mac__help">{t('F9 o un clic en el número de línea pone o quita un punto de interrupción. F5 ejecuta o continúa, F8 avanza paso a paso.')}</small>
      {run && pause && (
        <DebugPanel
          where={pause}
          stack={run.stack()}
          frame={frame}
          onFrame={(i) => {
            setFrame(i);
            const f = run.stack()[i];
            if (f && f.module !== tab.name) ctl.openModule(f.module);
          }}
          locals={run.locals(frame)}
          onStep={step}
          onStop={stop}
        />
      )}
      <ImmediateWindow lines={rt.console} onRun={immediate} onClear={() => rt.clearConsole()} />
    </div>
  );
}
