import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Select } from '@fluentui/react-components';
import type { basic } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';
import { DebugPanel } from './DebugPanel';
import { ImmediateWindow } from './Immediate';
import { saveBytes, pickAndRead } from '../fileio';
import { checkModule, type DebugRun, type MacroModule, type MacroRuntime } from './runtime';
import { LIBRARY_PREFIX, codeModules, libraryOf, saveLibrary, type LibraryId } from './security';
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
  /** The product keeps a global library (its modules are available in every file). */
  libraryId?: LibraryId;
}

/** A module the editor shows: one of the file or one of the global library. */
interface Entry {
  key: string;
  mod: MacroModule;
  lib: boolean;
  /** The name the interpreter knows it by (the library ones carry a prefix). */
  interp: string;
}
const entriesOf = (project: MacroProject): Entry[] => [
  ...codeModules(project.modules).map((mod): Entry => ({ key: `f:${mod.name}`, mod, lib: false, interp: mod.name })),
  ...(project.libraryId ? libraryOf(project.libraryId).map((mod): Entry => ({ key: `l:${mod.name}`, mod, lib: true, interp: LIBRARY_PREFIX + mod.name })) : []),
];
/** How a procedure's module is shown to the user. */
export const moduleLabel = (interp: string): string => (interp.startsWith(LIBRARY_PREFIX) ? `${interp.slice(LIBRARY_PREFIX.length)} (${t('global')})` : interp);

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
            {p.name} <small style={{ color: 'var(--colorNeutralForeground3)' }}>— {moduleLabel(p.module)}</small>
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
  const { rt } = project;
  const [, bump] = useState(0);
  const rerender = () => bump((x) => x + 1);
  const entries = entriesOf(project);
  const [currentKey, setCurrentKey] = useState(entries[0]?.key ?? '');
  const entry = entries.find((e) => e.key === currentKey);
  const mod = entry?.mod;
  /** The name of the current module for the interpreter, the breakpoints and the procedures. */
  const current = entry?.interp ?? '';
  const [code, setCode] = useState(mod?.code ?? '');
  /** Tells the product (or the library) that a module changed. */
  const changed = (e: Entry | undefined = entry) => {
    if (e?.lib && project.libraryId) saveLibrary(project.libraryId);
    project.changed();
  };
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
    changed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, mod, project]);

  // leaving the dialog ends a run that is stopped
  useEffect(
    () => () => {
      if (runRef.current?.state === 'paused') runRef.current.stop();
      runRef.current = null;
    },
    [],
  );

  const select = (key: string) => {
    setCurrentKey(key);
    setCode(entriesOf(project).find((e) => e.key === key)?.mod.code ?? '');
    setMsg(null);
  };
  /** The editor goes to the module the interpreter calls this (a pause or an error in it). */
  const selectInterp = (interp: string) => {
    const e = entriesOf(project).find((x) => x.interp === interp);
    if (e) select(e.key);
  };
  const keys = () => [...breaks.current].flatMap(([m, set]) => [...set].map((l) => `${m}:${l}`));
  const toggleBreakpoint = (line: number) => {
    const set = new Set(breaks.current.get(current) ?? []);
    if (!set.delete(line)) set.add(line);
    breaks.current.set(current, set);
    runRef.current?.setBreakpoints(keys());
    rerender();
  };

  const taken = (name: string, except?: MacroModule) => entriesOf(project).some((e) => e.mod !== except && e.mod.name.toLowerCase() === name.toLowerCase());
  const newModule = () => {
    const files = codeModules(project.modules);
    let n = entriesOf(project).length + 1;
    while (taken(`Modulo${n}`)) n++;
    const name = `Modulo${n}`;
    project.modules.push({ name, code: files.length === 0 ? project.sample : `Sub Macro1()\n    \nEnd Sub\n` });
    project.changed();
    select(`f:${name}`);
    rerender();
  };
  const renameModule = () => {
    const to = window.prompt(t('Nombre del módulo:'), current);
    if (!to || !mod) return;
    if (!/^[A-Za-z_][\w]*$/.test(to) || taken(to, mod)) return window.alert(t('El nombre no es válido o ya existe.'));
    const set = breaks.current.get(current);
    if (set) {
      breaks.current.delete(current);
      breaks.current.set(entry!.lib ? LIBRARY_PREFIX + to : to, set);
    }
    mod.name = to;
    setCurrentKey(`${entry!.lib ? 'l' : 'f'}:${to}`);
    changed();
    rerender();
  };
  const removeModule = () => {
    if (!mod || !window.confirm(t('¿Eliminar el módulo "{name}"?', { name: mod.name }))) return;
    breaks.current.delete(current);
    const list = entry!.lib ? libraryOf(project.libraryId!) : project.modules;
    list.splice(list.indexOf(mod), 1);
    changed();
    select(entriesOf(project)[0]?.key ?? '');
    rerender();
  };
  /** Between the file and the global library (as dragging a module between projects in the editor of Office). */
  const moveModule = () => {
    if (!mod || !entry || !project.libraryId) return;
    const from = entry.lib ? libraryOf(project.libraryId) : project.modules;
    const to = entry.lib ? project.modules : libraryOf(project.libraryId);
    if (to.some((m) => m.name.toLowerCase() === mod.name.toLowerCase())) return window.alert(t('Ya hay un módulo con ese nombre en el destino.'));
    breaks.current.delete(current);
    from.splice(from.indexOf(mod), 1);
    to.push(mod);
    saveLibrary(project.libraryId);
    project.changed();
    select(`${entry.lib ? 'f' : 'l'}:${mod.name}`);
    rerender();
  };
  const exportModule = async () => {
    if (!mod) return;
    await saveBytes(`${mod.name}.bas`, new TextEncoder().encode(mod.code.replace(/\r?\n/g, '\r\n')), [{ name: 'Módulo de Nova Basic', extensions: ['bas'] }]);
  };
  const importModule = async () => {
    const f = await pickAndRead([{ name: 'Módulo de Nova Basic', extensions: ['bas', 'txt'] }]);
    if (!f) return;
    let name = f.name.replace(/\.[^.]+$/, '').replace(/[^\w]/g, '_');
    if (!/^[A-Za-z_]/.test(name)) name = `M_${name}`;
    const base = name;
    for (let n = 2; taken(name); n++) name = `${base}${n}`;
    project.modules.push({ name, code: new TextDecoder('utf-8').decode(f.data).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n') });
    project.changed();
    select(`f:${name}`);
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
      if (p.module !== current) selectInterp(p.module);
      setFrame(0);
      setMsg(null);
    } else {
      const res = run.result;
      runRef.current = null;
      if (res.ok) setMsg({ ok: true, text: t('"{name}" terminó correctamente.', { name }) });
      else {
        const at = rt.lastAt;
        setMsg({ ok: false, text: res.error ?? '', line: at?.module === current ? at.line : undefined });
        if (at && at.module !== current && entriesOf(project).some((e) => e.interp === at.module)) selectInterp(at.module);
        if (at) editor.current?.goTo(at.line);
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
    if (owner && owner !== current) selectInterp(owner);
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
            <Select aria-label={t('Módulo')} value={currentKey} disabled={debugging} onChange={(_e, v) => select(v.value)} style={{ minWidth: 150 }}>
              {entries.length === 0 && <option value="">{t('(sin módulos)')}</option>}
              {entries.map((e) => (
                <option key={e.key} value={e.key}>
                  {e.lib ? `${e.mod.name} (${t('global')})` : e.mod.name}
                </option>
              ))}
            </Select>
          </label>
          <Button size="small" disabled={debugging} onClick={newModule}>{t('Nuevo módulo')}</Button>
          <Button size="small" disabled={!mod || debugging} onClick={renameModule}>{t('Cambiar nombre')}</Button>
          <Button size="small" disabled={!mod || debugging} onClick={removeModule}>{t('Eliminar')}</Button>
          {project.libraryId && (
            <Button size="small" disabled={!mod || debugging} onClick={moveModule} title={t('La biblioteca global está disponible en todos los archivos de este producto.')}>
              {entry?.lib ? t('Mover al archivo') : t('Mover a la biblioteca global')}
            </Button>
          )}
          <Button size="small" disabled={!mod} onClick={() => void exportModule()}>{t('Exportar módulo…')}</Button>
          <Button size="small" disabled={debugging} onClick={() => void importModule()}>{t('Importar módulo…')}</Button>
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
              if (f && f.module !== current) selectInterp(f.module);
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
