import { t } from '@suitenova/core-ui';
import {
  asList,
  backspace,
  del,
  end,
  fromTree,
  home,
  insertNodes,
  insertStructure,
  mkRow,
  moveLeft,
  moveRight,
  moveVertical,
  nextSlot,
  parseMath,
  parsePathKey,
  parseUnicodeMath,
  placeCursor,
  renderEdit,
  selectAll,
  selectedNodes,
  STRUCTURES,
  STRUCTURE_GROUPS,
  SYMBOL_GROUPS,
  toTree,
  toUnicodeMath,
  typeChar,
  typeText,
  type EditState,
  type MNode,
} from '@suitenova/math-core';
import { useEffect, useMemo, useRef, useState } from 'react';
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

const FUNCTION_GROUPS = new Set<string>(STRUCTURE_GROUPS);

/** ¿Parece LaTeX lo que se pega? (barra invertida con letras, llaves o `^{`). */
const looksLikeTex = (s: string) => /\\[A-Za-z]+|[{}]/.test(s);

/**
 * Editor de ecuaciones de SuiteNova (compartido por Writer, Slides, Calc y Notes): el cursor recorre la ecuación por sus
 * casillas, `/` hace una fracción, `^` y `_` escrituras, `\alpha` + espacio una letra; la galería inserta estructuras y símbolos.
 */
export function EquationEditor({ value, onChange, autoFocus, label, onEnter }: Props) {
  const [st, setSt] = useState<EditState>(() => fromTree(value));
  const [focused, setFocused] = useState(false);
  const [group, setGroup] = useState<string>(STRUCTURE_GROUPS[0]);
  const surface = useRef<HTMLDivElement>(null);
  const last = useRef<MNode>(value);
  const past = useRef<EditState[]>([]);
  const future = useRef<EditState[]>([]);

  // el padre cambió la ecuación (p. ej. se escribió el código): se adopta
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      past.current = [];
      future.current = [];
      setSt(fromTree(value));
    }
  }, [value]);
  useEffect(() => {
    if (autoFocus) surface.current?.focus();
  }, [autoFocus]);

  /** Aplica un cambio: guarda el estado para deshacer y avisa al padre. */
  const apply = (next: EditState, record = true) => {
    if (next === st) return;
    if (record && next.root !== st.root) {
      past.current.push(st);
      if (past.current.length > 200) past.current.shift();
      future.current = [];
    }
    setSt(next);
    if (next.root !== st.root) {
      const tree = toTree(next);
      last.current = tree;
      onChange(tree);
    }
  };
  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(st);
    setSt(prev);
    const tree = toTree(prev);
    last.current = tree;
    onChange(tree);
  };
  const redo = () => {
    const nxt = future.current.pop();
    if (!nxt) return;
    past.current.push(st);
    setSt(nxt);
    const tree = toTree(nxt);
    last.current = tree;
    onChange(tree);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && !e.altKey) {
      if (k === 'z' || k === 'Z') return void (e.preventDefault(), e.shiftKey ? redo() : undo());
      if (k === 'y' || k === 'Y') return void (e.preventDefault(), redo());
      if (k === 'a' || k === 'A') return void (e.preventDefault(), apply(selectAll(st), false));
      return; // copiar, cortar y pegar los atienden sus eventos
    }
    const go = (n: EditState, record = true) => {
      e.preventDefault();
      apply(n, record);
    };
    switch (k) {
      case 'ArrowLeft': return go(moveLeft(st, e.shiftKey), false);
      case 'ArrowRight': return go(moveRight(st, e.shiftKey), false);
      case 'ArrowUp': return go(moveVertical(st, 'up'), false);
      case 'ArrowDown': return go(moveVertical(st, 'down'), false);
      case 'Home': return go(home(st, e.shiftKey), false);
      case 'End': return go(end(st, e.shiftKey), false);
      case 'Backspace': return go(backspace(st));
      case 'Delete': return go(del(st));
      case 'Tab':
        if (!e.shiftKey && st.path.length) return go(nextSlot(st), false);
        return; // fuera de las estructuras el tabulador sale del editor
      case 'Enter':
        if (st.esc !== undefined) return go(typeChar(st, ' '));
        if (onEnter) {
          e.preventDefault();
          onEnter();
        }
        return;
      case 'Escape':
        if (st.esc !== undefined) {
          e.stopPropagation();
          return go({ ...st, esc: undefined }, false);
        }
        if (st.anchor !== undefined) {
          e.stopPropagation();
          return go({ ...st, anchor: undefined }, false);
        }
        return;
      default:
    }
    if (k.length === 1 && !e.metaKey && (!e.ctrlKey || e.altKey)) go(typeChar(st, k));
  };

  const text = () => {
    const sel = selectedNodes(st);
    return toUnicodeMath(sel.length ? mkRow(sel) : toTree(st));
  };
  const onCopy = (e: React.ClipboardEvent) => {
    e.preventDefault();
    e.clipboardData.setData('text/plain', text());
  };
  const onCut = (e: React.ClipboardEvent) => {
    e.preventDefault();
    e.clipboardData.setData('text/plain', text());
    apply(backspace(st));
  };
  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const s = e.clipboardData.getData('text/plain').trim();
    if (!s) return;
    const tree = looksLikeTex(s) ? parseMath(s) : parseUnicodeMath(s);
    apply(insertNodes(st, asList(tree)));
  };

  /** Dónde cae un clic: la fila del nodo tocado y, según el lado, antes o después de él. */
  const locate = (e: React.MouseEvent): { path: ReturnType<typeof parsePathKey>; at: number } | null => {
    const el = (e.target as Element).closest('[data-r]') as HTMLElement | null;
    if (!el || !surface.current?.contains(el)) return null;
    const i = +(el.getAttribute('data-i') ?? 0);
    const r = el.getBoundingClientRect();
    const after = el.classList.contains('nm-ph') ? 0 : e.clientX > r.left + r.width / 2 ? 1 : 0;
    return { path: parsePathKey(el.getAttribute('data-r') ?? ''), at: i + after };
  };
  const onMouseDown = (e: React.MouseEvent) => {
    const hit = locate(e);
    if (hit) apply(placeCursor(st, hit.path, hit.at, e.shiftKey), false);
    else apply(end({ ...st, path: [] }), false);
    // el foco lo toma el cuadro (no el elemento MathML)
    requestAnimationFrame(() => surface.current?.focus());
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (e.buttons !== 1) return;
    const hit = locate(e);
    if (hit) apply(placeCursor({ ...st, anchor: st.anchor ?? st.at }, hit.path, hit.at, true), false);
  };

  const html = useMemo(() => renderEdit(st, focused), [st, focused]);
  const items = useMemo(() => {
    if (FUNCTION_GROUPS.has(group)) return STRUCTURES.filter((d) => d.group === group);
    return [];
  }, [group]);
  const symbols = SYMBOL_GROUPS.find((g) => g.name === group);
  const apply2 = (n: EditState) => {
    apply(n);
    surface.current?.focus();
  };
  const linear = useMemo(() => toUnicodeMath(toTree(st)), [st]);

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
            <button key={d.id} type="button" className="nm-btn" title={t(d.label)} aria-label={t(d.label)} data-structure={d.id} onMouseDown={(e) => e.preventDefault()} onClick={() => apply2(insertStructure(st, d.id))}>
              {d.glyph}
            </button>
          ))}
          {symbols?.items.map((s) => (
            <button key={s.ch} type="button" className="nm-btn" title={s.title ? `${s.title}` : s.ch} aria-label={s.ch} data-symbol={s.ch} onMouseDown={(e) => e.preventDefault()} onClick={() => apply2(typeText(st, s.ch))}>
              {s.ch}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={surface}
        className={`nm-surface${focused ? ' nm-focus' : ''}`}
        role="textbox"
        aria-label={`${label ?? t('Ecuación')}: ${linear}`}
        tabIndex={0}
        spellCheck={false}
        data-testid="equation-editor"
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="nm-hint">{t('Escriba con el teclado: «/» fracción, «^» y «_» índices, «\\alpha» y espacio una letra griega, «\\sqrt» y espacio una raíz. Tabulador pasa a la casilla siguiente.')}</div>
    </div>
  );
}
