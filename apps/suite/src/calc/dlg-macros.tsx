import { Button, Input, Select } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalcUI } from './commands';
import { CalcRuntime } from './macros';
import { Modal, field } from './modal';

const SAMPLE = `' Nova Basic: un subconjunto de VBA con los objetos de la hoja (Range, Cells, Worksheets…).
Sub Ejemplo()
    Dim i As Integer
    For i = 1 To 5
        Cells(i, 1).Value = i * i
    Next i
    Range("B1").Formula = "=SUM(A1:A5)"
    MsgBox "Hecho: " & Range("B1").Value
End Sub

' Una función que se puede usar en las celdas: =DOBLE(A1)
Function Doble(x)
    Doble = x * 2
End Function
`;

/** The list of macros (Subs without arguments) to run. */
export function MacroListDialog({ ui, onClose, onEdit }: { ui: CalcUI; onClose: () => void; onEdit: () => void }) {
  const d = ui.doc;
  const procs = useMemo(() => d.macros.procedures().filter((p) => p.kind === 'sub' && p.isPublic && p.params.every((x) => x.optional)), [d, d.getVersion()]);
  const [sel, setSel] = useState('');
  const [msg, setMsg] = useState('');
  const picked = procs.find((p) => p.name === sel) ?? procs[0];
  return (
    <Modal
      title={t('Macros')}
      onClose={onClose}
      width={520}
      actions={
        <>
          <Button onClick={onEdit}>{t('Editar código…')}</Button>
          <Button onClick={onClose}>{t('Cerrar')}</Button>
          <Button
            appearance="primary"
            disabled={!picked || !d.contentEnabled}
            onClick={() => {
              const r = d.macros.run(picked!.name);
              if (!r.ok) setMsg(r.error ?? '');
              else onClose();
            }}
          >
            {t('Ejecutar')}
          </Button>
        </>
      }
    >
      {!d.contentEnabled && <p role="alert">{t('El contenido activo está deshabilitado en este archivo: habilítelo para ejecutar macros.')}</p>}
      <ul role="listbox" aria-label={t('Macros')} style={{ margin: 0, padding: 0, listStyle: 'none', border: '1px solid var(--colorNeutralStroke2)', borderRadius: 4, minHeight: 140, maxHeight: 240, overflow: 'auto' }}>
        {procs.length === 0 && <li style={{ padding: 8, color: 'var(--colorNeutralForeground3)' }}>{t('No hay macros. Cree una en el editor de código.')}</li>}
        {procs.map((p) => (
          <li key={p.name} role="option" aria-selected={picked?.name === p.name} onClick={() => setSel(p.name)} style={{ padding: '4px 8px', cursor: 'pointer', background: picked?.name === p.name ? 'var(--colorBrandBackground2)' : undefined }}>
            {p.name} <small style={{ color: 'var(--colorNeutralForeground3)' }}>— {p.module}</small>
          </li>
        ))}
      </ul>
      {msg && <p role="alert" style={{ color: 'var(--colorPaletteRedForeground1)' }}>{msg}</p>}
    </Modal>
  );
}

/** The code editor: modules, a text area with line numbers, run, syntax check and the immediate window. */
export function MacroEditorDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const wb = d.wb;
  const [, bump] = useState(0);
  const rerender = () => bump((x) => x + 1);
  const [current, setCurrent] = useState(wb.macros[0]?.name ?? '');
  const mod = wb.macros.find((m) => m.name === current);
  const [code, setCode] = useState(mod?.code ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string; line?: number } | null>(null);
  const [cmd, setCmd] = useState('');
  const [proc, setProc] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const history = useRef<string[]>([]);
  const histIdx = useRef(0);
  const tabMoves = useRef(false);
  const problems = useMemo(() => (mod ? CalcRuntime.check(mod.name, code) : []), [mod, code]);
  const bad = new Set(problems.map((p) => p.line));
  const lines = code.split('\n').length;

  // keep the stored module in step with the text
  useEffect(() => {
    if (!mod || mod.code === code) return;
    mod.code = code;
    d.dirty = true;
    d.touch();
  }, [code, mod, d]);

  const select = (name: string) => {
    setCurrent(name);
    setCode(wb.macros.find((m) => m.name === name)?.code ?? '');
    setMsg(null);
  };
  const newModule = () => {
    let n = wb.macros.length + 1;
    while (wb.macros.some((m) => m.name === `Modulo${n}`)) n++;
    const name = `Modulo${n}`;
    wb.macros.push({ name, code: wb.macros.length === 0 ? SAMPLE : `Sub Macro1()\n    \nEnd Sub\n` });
    d.dirty = true;
    select(name);
    rerender();
  };
  const renameModule = () => {
    const to = window.prompt(t('Nombre del módulo:'), current);
    if (!to || !mod) return;
    if (!/^[A-Za-z_][\w]*$/.test(to) || wb.macros.some((m) => m !== mod && m.name.toLowerCase() === to.toLowerCase())) return window.alert(t('El nombre no es válido o ya existe.'));
    mod.name = to;
    setCurrent(to);
    d.dirty = true;
    rerender();
  };
  const removeModule = () => {
    if (!mod || !window.confirm(t('¿Eliminar el módulo "{name}"?', { name: mod.name }))) return;
    wb.macros.splice(wb.macros.indexOf(mod), 1);
    d.dirty = true;
    select(wb.macros[0]?.name ?? '');
    rerender();
  };

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

  const procs = d.macros.procedures().filter((p) => p.module === current);
  const run = () => {
    if (problems.length) {
      setMsg({ ok: false, text: `${t('Hay errores de sintaxis')}: ${t('línea')} ${problems[0]!.line}: ${problems[0]!.message}`, line: problems[0]!.line });
      goTo(problems[0]!.line);
      return;
    }
    const live = d.macros.procedures().filter((p) => p.module === current);
    const name = proc && live.some((p) => p.name === proc) ? proc : live.find((p) => p.kind === 'sub' && p.params.every((x) => x.optional))?.name;
    if (!name) return setMsg({ ok: false, text: t('No hay ningún procedimiento (Sub) que ejecutar en este módulo.') });
    const r = d.macros.run(name);
    setMsg(r.ok ? { ok: true, text: t('"{name}" terminó correctamente.', { name }) } : { ok: false, text: r.error ?? '', line: d.macros.lastAt?.module === current ? d.macros.lastAt.line : undefined });
    if (!r.ok && d.macros.lastAt?.module === current) goTo(d.macros.lastAt.line);
  };
  const immediate = () => {
    const src = cmd.trim();
    if (!src) return;
    history.current.push(src);
    histIdx.current = history.current.length;
    setCmd('');
    d.macros.print(`> ${src}`);
    const r = d.macros.immediate(src);
    if (!r.ok) d.macros.print(`⚠ ${r.error}`);
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      tabMoves.current = true;
      return;
    }
    if (e.key === 'Tab' && !tabMoves.current && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const s = el.selectionStart;
      setCode(code.slice(0, s) + '    ' + code.slice(el.selectionEnd));
      requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
      return;
    }
    tabMoves.current = false;
    if (e.key === 'Enter') {
      const el = e.currentTarget;
      const s = el.selectionStart;
      const lineStart = code.lastIndexOf('\n', s - 1) + 1;
      const indent = /^[ \t]*/.exec(code.slice(lineStart, s))![0];
      if (indent) {
        e.preventDefault();
        setCode(code.slice(0, s) + '\n' + indent + code.slice(el.selectionEnd));
        requestAnimationFrame(() => el.setSelectionRange(s + 1 + indent.length, s + 1 + indent.length));
      }
    }
  };

  return (
    <Modal title={t('Editor de código (Nova Basic)')} onClose={onClose} width={1040} actions={<Button appearance="primary" onClick={onClose}>{t('Cerrar')}</Button>}>
      {!d.contentEnabled && (
        <p role="alert">
          {t('El contenido activo está deshabilitado en este archivo: habilítelo para ejecutar código.')}{' '}
          <Button size="small" onClick={() => { d.enableContent(); rerender(); }}>{t('Habilitar contenido')}</Button>
        </p>
      )}
      <div className="calc-mac__bar">
        <label>
          {t('Módulo')}{' '}
          <Select aria-label={t('Módulo')} value={current} onChange={(_e, v) => select(v.value)} style={{ minWidth: 150 }}>
            {wb.macros.length === 0 && <option value="">{t('(sin módulos)')}</option>}
            {wb.macros.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </Select>
        </label>
        <Button size="small" onClick={newModule}>{t('Nuevo módulo')}</Button>
        <Button size="small" disabled={!mod} onClick={renameModule}>{t('Cambiar nombre')}</Button>
        <Button size="small" disabled={!mod} onClick={removeModule}>{t('Eliminar')}</Button>
        <span className="calc-mac__sep" />
        <label>
          {t('Procedimiento')}{' '}
          <Select aria-label={t('Procedimiento que se ejecuta')} value={proc} onChange={(_e, v) => setProc(v.value)} style={{ minWidth: 150 }}>
            <option value="">{t('(el primero)')}</option>
            {procs.map((p) => (
              <option key={p.name} value={p.name}>
                {p.kind === 'sub' ? 'Sub' : 'Function'} {p.name}
              </option>
            ))}
          </Select>
        </label>
        <Button appearance="primary" size="small" disabled={!mod || !d.contentEnabled} onClick={run}>{t('Ejecutar')}</Button>
        <Button
          size="small"
          disabled={!mod}
          onClick={() => {
            setMsg(problems.length ? { ok: false, text: `${t('Línea')} ${problems[0]!.line}: ${problems[0]!.message}`, line: problems[0]!.line } : { ok: true, text: t('No se encontraron errores de sintaxis.') });
            if (problems.length) goTo(problems[0]!.line);
          }}
        >
          {t('Comprobar sintaxis')}
        </Button>
        <small className="calc-mac__hint" aria-live="polite">{problems.length ? `⚠ ${t('Línea')} ${problems[0]!.line}: ${problems[0]!.message}` : mod ? t('Sin errores de sintaxis') : ''}</small>
      </div>
      {msg && (
        <div className={msg.ok ? 'calc-mac__ok' : 'calc-mac__error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}{' '}
          {msg.line ? <Button size="small" onClick={() => goTo(msg.line!)}>{t('Ir a la línea {n}', { n: msg.line })}</Button> : null}
        </div>
      )}
      <div className="calc-mac__editor">
        <div className="calc-mac__gutter" ref={gutter} aria-hidden="true">
          {Array.from({ length: lines }, (_x, i) => (
            <div key={i} className={bad.has(i + 1) ? 'is-bad' : ''}>
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={area}
          className="calc-mac__code"
          aria-label={t('Código del módulo {name}', { name: current })}
          spellCheck={false}
          wrap="off"
          disabled={!mod}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={onKey}
          onScroll={(e) => gutter.current && (gutter.current.scrollTop = e.currentTarget.scrollTop)}
        />
      </div>
      <div className="calc-mac__console" role="region" aria-label={t('Ventana inmediato')}>
        <div className="calc-mac__consolebar">
          <strong>{t('Ventana inmediato')}</strong>
          <small>{t('Escriba una instrucción, o ? expresión, y pulse Intro. Debug.Print escribe aquí.')}</small>
          <Button size="small" onClick={() => d.macros.clearConsole()}>{t('Limpiar')}</Button>
        </div>
        <pre className="calc-mac__out" aria-live="polite" aria-label={t('Salida')}>{d.macros.console.join('\n')}</pre>
        <Input
          aria-label={t('Instrucción inmediata')}
          value={cmd}
          placeholder="? 2 + 2"
          onChange={(_e, v) => setCmd(v.value)}
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
      <div style={field} />
    </Modal>
  );
}
