import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Select } from '@fluentui/react-components';
import type { basic } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';
import { DebugPanel } from './DebugPanel';
import { ImmediateWindow } from './Immediate';
import { checkModule, type DebugRun, type MacroModule, type MacroRuntime } from './runtime';
import './macros.css';
import './messages';

/** What the shared macro dialogs need from a product: its modules, its runtime and how to tell the product something changed. */
export interface MacroProject {
  rt: MacroRuntime;
  /** The live list of modules (the dialogs change it in place). */
  modules: MacroModule[];
  /** Active content is enabled. */
  enabled: boolean;
  enable(): void;
  /** The modules changed: mark the file as modified and redraw. */
  changed(): void;
  /** Changes whenever the product redraws (so the list of macros is read again). */
  version: number;
  /** The code of the first module of a file that has none. */
  sample: string;
}

/** The dialog frame (with the page given back when it closes, as the other dialogs do). */
export function MacroModal({ title, onClose, children, actions, width = 520 }: { title: string; onClose: () => void; children: ReactNode; actions: ReactNode; width?: number }) {
  useEffect(
    () => () => {
      setTimeout(() => {
        if (document.querySelector('[role=dialog]')) return;
        for (const el of document.querySelectorAll('body > [aria-hidden=true], #root[aria-hidden=true]')) el.removeAttribute('aria-hidden');
        document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
      }, 0);
    },
    [],
  );
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: width, width: '92vw' }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>{children}</DialogContent>
          <DialogActions>{actions}</DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** «Paso a paso» in the list of macros opens the editor already stopped at the first line of the macro. */
let pendingDebug: string | null = null;

const runnable = (p: basic.ProcInfo) => p.kind === 'sub' && p.isPublic && p.params.every((x) => x.optional);

/** The list of macros (Subs without arguments): run one, step through it, or open the editor. */
export function MacroListDialog({ project, onClose, onEdit }: { project: MacroProject; onClose: () => void; onEdit: () => void }) {
  const { rt } = project;
  const procs = useMemo(() => rt.procedures().filter(runnable), [rt, project.version]);
  const [sel, setSel] = useState('');
  const [msg, setMsg] = useState('');
  const picked = procs.find((p) => p.name === sel) ?? procs[0];
  return (
    <MacroModal
      title={t('Macros')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onEdit}>{t('Editar código…')}</Button>
          <Button
            disabled={!picked || !project.enabled}
            onClick={() => {
              pendingDebug = picked!.name;
              onEdit();
            }}
          >
            {t('Paso a paso')}
          </Button>
          <Button onClick={onClose}>{t('Cerrar')}</Button>
          <Button
            appearance="primary"
            disabled={!picked || !project.enabled}
            onClick={() => {
              const r = rt.run(picked!.name);
              if (!r.ok) setMsg(r.error ?? '');
              else onClose();
            }}
          >
            {t('Ejecutar')}
          </Button>
        </>
      }
    >
      {!project.enabled && <p role="alert">{t('El contenido activo está deshabilitado en este archivo: habilítelo para ejecutar macros.')}</p>}
      <ul role="listbox" aria-label={t('Macros')} className="nv-mac__list">
        {procs.length === 0 && <li style={{ color: 'var(--colorNeutralForeground3)' }}>{t('No hay macros. Cree una en el editor de código.')}</li>}
        {procs.map((p) => (
          <li key={p.name} role="option" aria-selected={picked?.name === p.name} onClick={() => setSel(p.name)}>
            {p.name} <small style={{ color: 'var(--colorNeutralForeground3)' }}>— {p.module}</small>
          </li>
        ))}
      </ul>
      {msg && <p role="alert" style={{ color: 'var(--colorPaletteRedForeground1)' }}>{msg}</p>}
    </MacroModal>
  );
}

type Msg = { ok: boolean; text: string; line?: number };

/** The code editor: modules, code with line numbers and breakpoints, run and step through, syntax check and the immediate window. */
export function MacroEditorDialog({ project, onClose }: { project: MacroProject; onClose: () => void }) {
  const { rt, modules } = project;
  const [, bump] = useState(0);
  const rerender = () => bump((x) => x + 1);
  const [current, setCurrent] = useState(modules[0]?.name ?? '');
  const mod = modules.find((m) => m.name === current);
  const [code, setCode] = useState(mod?.code ?? '');
  const [msg, setMsg] = useState<Msg | null>(null);
  const [proc, setProc] = useState('');
  const [frame, setFrame] = useState(0);
  const breaks = useRef(new Map<string, Set<number>>());
  const runRef = useRef<DebugRun | null>(null);
  const editor = useRef<CodeEditorHandle>(null);
  const problems = useMemo(() => (mod ? checkModule(mod.name, code) : []), [mod, code]);
  const bad = new Set(problems.map((p) => p.line));
  const debugging = runRef.current?.state === 'paused';
  const pause = debugging ? runRef.current!.pause : null;
  const bps = breaks.current.get(current) ?? new Set<number>();

  // the stored module follows the text
  useEffect(() => {
    if (!mod || mod.code === code) return;
    mod.code = code;
    project.changed();
  }, [code, mod, project]);

  // leaving the dialog ends a run that is stopped
  useEffect(
    () => () => {
      if (runRef.current?.state === 'paused') runRef.current.stop();
      runRef.current = null;
    },
    [],
  );

  const select = (name: string) => {
    setCurrent(name);
    setCode(modules.find((m) => m.name === name)?.code ?? '');
    setMsg(null);
  };
  const keys = () => [...breaks.current].flatMap(([m, set]) => [...set].map((l) => `${m}:${l}`));
  const toggleBreakpoint = (line: number) => {
    const set = new Set(breaks.current.get(current) ?? []);
    if (!set.delete(line)) set.add(line);
    breaks.current.set(current, set);
    runRef.current?.setBreakpoints(keys());
    rerender();
  };

  const newModule = () => {
    let n = modules.length + 1;
    while (modules.some((m) => m.name === `Modulo${n}`)) n++;
    const name = `Modulo${n}`;
    modules.push({ name, code: modules.length === 0 ? project.sample : `Sub Macro1()\n    \nEnd Sub\n` });
    project.changed();
    select(name);
    rerender();
  };
  const renameModule = () => {
    const to = window.prompt(t('Nombre del módulo:'), current);
    if (!to || !mod) return;
    if (!/^[A-Za-z_][\w]*$/.test(to) || modules.some((m) => m !== mod && m.name.toLowerCase() === to.toLowerCase())) return window.alert(t('El nombre no es válido o ya existe.'));
    const set = breaks.current.get(current);
    if (set) {
      breaks.current.delete(current);
      breaks.current.set(to, set);
    }
    mod.name = to;
    setCurrent(to);
    project.changed();
    rerender();
  };
  const removeModule = () => {
    if (!mod || !window.confirm(t('¿Eliminar el módulo "{name}"?', { name: mod.name }))) return;
    breaks.current.delete(mod.name);
    modules.splice(modules.indexOf(mod), 1);
    project.changed();
    select(modules[0]?.name ?? '');
    rerender();
  };

  const procs = rt.procedures().filter((p) => p.module === current);
  const pickProc = (): string | undefined => {
    const live = rt.procedures().filter((p) => p.module === current);
    return proc && live.some((p) => p.name === proc) ? proc : live.find(runnable)?.name;
  };
  const refuseIfBroken = (): boolean => {
    if (!problems.length) return false;
    setMsg({ ok: false, text: `${t('Hay errores de sintaxis')}: ${t('línea')} ${problems[0]!.line}: ${problems[0]!.message}`, line: problems[0]!.line });
    editor.current?.goTo(problems[0]!.line);
    return true;
  };

  /** What to show after the run advanced: where it stopped, or how it ended. */
  const settle = (run: DebugRun, name: string) => {
    if (run.state === 'paused') {
      const p = run.pause!;
      if (p.module !== current) select(p.module);
      setFrame(0);
      setMsg(null);
    } else {
      const res = run.result;
      runRef.current = null;
      if (res.ok) setMsg({ ok: true, text: t('"{name}" terminó correctamente.', { name }) });
      else {
        const at = rt.lastAt;
        setMsg({ ok: false, text: res.error ?? '', line: at?.module === current ? at.line : undefined });
        if (at?.module === current) editor.current?.goTo(at.line);
      }
    }
    rerender();
  };
  const runName = useRef('');

  const run = () => {
    if (refuseIfBroken()) return;
    const name = pickProc();
    if (!name) return setMsg({ ok: false, text: t('No hay ningún procedimiento (Sub) que ejecutar en este módulo.') });
    if (breaks.current.size && keys().length) return startDebug(name, false); // with breakpoints, running stops at them
    const r = rt.run(name);
    const at = rt.lastAt;
    setMsg(r.ok ? { ok: true, text: t('"{name}" terminó correctamente.', { name }) } : { ok: false, text: r.error ?? '', line: at?.module === current ? at.line : undefined });
    if (!r.ok && at?.module === current) editor.current?.goTo(at.line);
  };
  function startDebug(name: string | undefined, stopAtStart: boolean) {
    if (refuseIfBroken()) return;
    const n = name ?? pickProc();
    if (!n) return setMsg({ ok: false, text: t('No hay ningún procedimiento (Sub) que ejecutar en este módulo.') });
    const started = rt.debug(n, { breakpoints: keys(), stopAtStart });
    if ('error' in started) return setMsg({ ok: false, text: started.error.error ?? '', line: started.error.at?.line });
    runRef.current = started.run;
    runName.current = n;
    settle(started.run, n);
  }
  const step = (mode: basic.DebugStep) => {
    const r = runRef.current;
    if (!r) return;
    r.step(mode);
    settle(r, runName.current);
  };
  const stop = () => {
    const r = runRef.current;
    if (!r) return;
    r.stop();
    runRef.current = null;
    setMsg({ ok: true, text: t('Se detuvo la ejecución.') });
    rerender();
  };
  // the debugger's own keys; F5 would reload the page, so it is always taken
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'F5' && !e.shiftKey) {
      e.preventDefault();
      if (runRef.current) step('continue');
      else run();
    } else if (e.key === 'F8') {
      e.preventDefault();
      if (!runRef.current) startDebug(undefined, true);
      else step(e.ctrlKey && e.shiftKey ? 'out' : e.shiftKey ? 'over' : 'into');
    }
  };

  // «Paso a paso» of the list of macros
  useEffect(() => {
    const name = pendingDebug;
    pendingDebug = null;
    if (!name) return;
    const owner = rt.procedures().find((p) => p.name === name)?.module;
    if (owner && owner !== current) select(owner);
    setTimeout(() => startDebug(name, true), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const immediate = (src: string) => {
    rt.print(`> ${src}`);
    const r = runRef.current;
    if (r?.state === 'paused') {
      const out = r.evaluate(src, frame);
      rt.print(out.ok ? out.text : `⚠ ${out.text}`);
      rerender();
      return;
    }
    const res = rt.immediate(src);
    if (!res.ok) rt.print(`⚠ ${res.error}`);
  };

  return (
    <MacroModal title={t('Editor de código (Nova Basic)')} onClose={onClose} width={1040} actions={<Button appearance="primary" onClick={onClose}>{t('Cerrar')}</Button>}>
      <div onKeyDown={onKeyDown}>
        {!project.enabled && (
          <p role="alert">
            {t('El contenido activo está deshabilitado en este archivo: habilítelo para ejecutar código.')}{' '}
            <Button size="small" onClick={() => { project.enable(); rerender(); }}>{t('Habilitar contenido')}</Button>
          </p>
        )}
        <div className="nv-mac__bar">
          <label>
            {t('Módulo')}{' '}
            <Select aria-label={t('Módulo')} value={current} disabled={debugging} onChange={(_e, v) => select(v.value)} style={{ minWidth: 150 }}>
              {modules.length === 0 && <option value="">{t('(sin módulos)')}</option>}
              {modules.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </Select>
          </label>
          <Button size="small" disabled={debugging} onClick={newModule}>{t('Nuevo módulo')}</Button>
          <Button size="small" disabled={!mod || debugging} onClick={renameModule}>{t('Cambiar nombre')}</Button>
          <Button size="small" disabled={!mod || debugging} onClick={removeModule}>{t('Eliminar')}</Button>
          <span className="nv-mac__sep" />
          <label>
            {t('Procedimiento')}{' '}
            <Select aria-label={t('Procedimiento que se ejecuta')} value={proc} disabled={debugging} onChange={(_e, v) => setProc(v.value)} style={{ minWidth: 150 }}>
              <option value="">{t('(el primero)')}</option>
              {procs.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.kind === 'sub' ? 'Sub' : 'Function'} {p.name}
                </option>
              ))}
            </Select>
          </label>
          <Button appearance="primary" size="small" disabled={!mod || !project.enabled || debugging} onClick={run} title="F5">{t('Ejecutar')}</Button>
          <Button size="small" disabled={!mod || !project.enabled || debugging} onClick={() => startDebug(undefined, true)} title="F8">{t('Depurar')}</Button>
          <Button
            size="small"
            disabled={!mod}
            onClick={() => {
              setMsg(problems.length ? { ok: false, text: `${t('Línea')} ${problems[0]!.line}: ${problems[0]!.message}`, line: problems[0]!.line } : { ok: true, text: t('No se encontraron errores de sintaxis.') });
              if (problems.length) editor.current?.goTo(problems[0]!.line);
            }}
          >
            {t('Comprobar sintaxis')}
          </Button>
          <small className="nv-mac__hint" aria-live="polite">{problems.length ? `⚠ ${t('Línea')} ${problems[0]!.line}: ${problems[0]!.message}` : mod ? t('Sin errores de sintaxis') : ''}</small>
        </div>
        {msg && (
          <div className={msg.ok ? 'nv-mac__ok' : 'nv-mac__error'} role={msg.ok ? 'status' : 'alert'}>
            {msg.text}{' '}
            {msg.line ? <Button size="small" onClick={() => editor.current?.goTo(msg.line!)}>{t('Ir a la línea {n}', { n: msg.line })}</Button> : null}
          </div>
        )}
        <CodeEditor
          handle={editor}
          code={code}
          onChange={setCode}
          label={t('Código del módulo {name}', { name: current })}
          disabled={!mod}
          readOnly={debugging}
          bad={bad}
          breakpoints={bps}
          onToggleBreakpoint={toggleBreakpoint}
          current={pause && pause.module === current ? pause.line : null}
        />
        <small className="nv-mac__help">{t('F9 o un clic en el número de línea pone o quita un punto de interrupción. F5 ejecuta o continúa, F8 avanza paso a paso.')}</small>
        {debugging && pause && (
          <DebugPanel
            where={pause}
            stack={runRef.current!.stack()}
            frame={frame}
            onFrame={(i) => {
              setFrame(i);
              const f = runRef.current!.stack()[i];
              if (f && f.module !== current) select(f.module);
            }}
            locals={runRef.current!.locals(frame)}
            onStep={step}
            onStop={stop}
          />
        )}
        <ImmediateWindow lines={rt.console} onRun={immediate} onClear={() => rt.clearConsole()} />
      </div>
    </MacroModal>
  );
}
