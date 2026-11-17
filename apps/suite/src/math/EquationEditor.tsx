import { t } from '@suitenova/core-ui';
import { insertStructure, STRUCTURES, STRUCTURE_GROUPS, SYMBOL_GROUPS, typeText, type MNode } from '@suitenova/math-core';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { MathEditing } from './core';
import './messages';
import './math.css';

interface Props {
  /** La ecuación. Si el padre entrega otra distinta de la última que salió de aquí, el editor la adopta. */
  value: MNode;
  onChange: (tree: MNode) => void;
  autoFocus?: boolean;
  /** Nombre accesible del cuadro de edición. */
  label?: string;
  /** Intro (para aceptar). */
  onEnter?: () => void;
}

const STRUCTURE_SET = new Set<string>(STRUCTURE_GROUPS);

/**
 * Editor de ecuaciones de SuiteNova en un cuadro (compartido por Writer, Slides, Calc y Notes): el cursor recorre la ecuación por
 * sus casillas, `/` hace una fracción, `^` y `_` escrituras, `\alpha` + espacio una letra; la galería inserta estructuras y símbolos.
 * El comportamiento es el de `MathEditing`, el mismo que usa la edición dentro del documento.
 */
export function EquationEditor({ value, onChange, autoFocus, label, onEnter }: Props) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [focused, setFocused] = useState(false);
  const [group, setGroup] = useState<string>(STRUCTURE_GROUPS[0]);
  const surface = useRef<HTMLDivElement>(null);
  const cb = useRef({ onChange, onEnter });
  cb.current = { onChange, onEnter };
  const core = useMemo(() => new MathEditing(value, (n) => cb.current.onChange(n), redraw, () => cb.current.onEnter?.()), []); // eslint-disable-line react-hooks/exhaustive-deps

  // el padre cambió la ecuación (p. ej. se escribió el código): se adopta
  useEffect(() => core.adopt(value), [value, core]);
  useEffect(() => {
    if (autoFocus) surface.current?.focus();
  }, [autoFocus]);

  const html = core.html(focused);
  const items = STRUCTURE_SET.has(group) ? STRUCTURES.filter((d) => d.group === group) : [];
  const symbols = SYMBOL_GROUPS.find((g) => g.name === group);
  const run = (fn: Parameters<MathEditing['run']>[0]) => {
    core.run(fn);
    surface.current?.focus();
  };

  return (
    <div className="nm-editor">
      <div className="nm-gallery">
        <select className="nm-group" aria-label={t('Galería de ecuaciones')} value={group} onChange={(e) => setGroup(e.target.value)}>
          <optgroup label={t('Estructuras')}>
            {STRUCTURE_GROUPS.map((g) => (
              <option key={g} value={g}>{t(g)}</option>
            ))}
          </optgroup>
          <optgroup label={t('Símbolos')}>
            {SYMBOL_GROUPS.map((g) => (
              <option key={g.name} value={g.name}>{t(g.name)}</option>
            ))}
          </optgroup>
        </select>
        <div className="nm-items" role="group" aria-label={t(group)}>
          {items.map((d) => (
            <button key={d.id} type="button" className="nm-btn" title={t(d.label)} aria-label={t(d.label)} data-structure={d.id} onMouseDown={(e) => e.preventDefault()} onClick={() => run((st) => insertStructure(st, d.id))}>
              {d.glyph}
            </button>
          ))}
          {symbols?.items.map((s) => (
            <button key={s.ch} type="button" className="nm-btn" title={s.title ? `${s.title}` : s.ch} aria-label={s.ch} data-symbol={s.ch} onMouseDown={(e) => e.preventDefault()} onClick={() => run((st) => typeText(st, s.ch))}>
              {s.ch}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={surface}
        className={`nm-surface${focused ? ' nm-focus' : ''}`}
        role="textbox"
        aria-label={`${label ?? t('Ecuación')}: ${core.linear}`}
        tabIndex={0}
        spellCheck={false}
        data-testid="equation-editor"
        onKeyDown={(e) => {
          if (core.key(e)) e.preventDefault();
        }}
        onCopy={(e) => {
          e.preventDefault();
          e.clipboardData.setData('text/plain', core.copyText());
        }}
        onCut={(e) => {
          e.preventDefault();
          e.clipboardData.setData('text/plain', core.cut());
        }}
        onPaste={(e) => {
          e.preventDefault();
          core.paste(e.clipboardData.getData('text/plain'));
        }}
        onMouseDown={(e) => {
          if (surface.current) core.mouseDown(e, surface.current);
          // el foco lo toma el cuadro (no el elemento MathML)
          requestAnimationFrame(() => surface.current?.focus());
        }}
        onMouseMove={(e) => {
          if (surface.current) core.mouseMove(e, surface.current);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="nm-hint">{t('Escriba con el teclado: «/» fracción, «^» y «_» índices, «\\alpha» y espacio una letra griega, «\\sqrt» y espacio una raíz. Tabulador pasa a la casilla siguiente.')}</div>
    </div>
  );
}
