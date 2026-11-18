import { getLocale } from '@suitenova/core-ui';
import { isSpellLang, type SpellLang } from '@suitenova/spell-core';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type TextareaHTMLAttributes } from 'react';
import { autoCorrectField } from './autocorrect';
import { loadedEngine, loadSpeller } from './load';
import { getReviewOptions, onReviewOptions } from './options';
import { applyFixToText, reviewPlainText } from './plain';
import { type Issue } from './review';
import { ReviewMenu, type ReviewHost } from './ui';

/** El idioma de revisión de los campos de texto sin documento (Mail, Plan, Forms, Base…): `nova.spell.lang`, o el de la interfaz. */
export function defaultFieldLang(): SpellLang {
  try {
    const v = localStorage.getItem('nova.spell.lang');
    if (isSpellLang(v)) return v;
  } catch {
    /* sin almacenamiento */
  }
  return getLocale() === 'en' ? 'en' : 'es';
}

const MAX_CHARS = 30000;
const COPIED = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textAlign', 'textIndent', 'textTransform', 'wordSpacing', 'tabSize', 'whiteSpace', 'overflowWrap', 'wordBreak', 'paddingTop', 'paddingLeft', 'paddingBottom', 'borderTopWidth', 'borderLeftWidth', 'borderBottomWidth', 'borderRightWidth', 'direction'] as const;

/** Cambia el valor de un campo como si se hubiera escrito: así el `onChange` de quien lo usa se entera, sin tocar su código. */
function setNativeValue(ta: HTMLTextAreaElement, value: string, caret: number): void {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  set.call(ta, value);
  ta.setSelectionRange(caret, caret);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> & {
  value: string;
  /** Idioma de revisión (por omisión, el de las preferencias o de la interfaz). */
  lang?: SpellLang;
  /** Subraya los errores (por omisión, sí). */
  proof?: boolean;
  /** Corrige al escribir con la autocorrección compartida (por omisión, sí). */
  autoFix?: boolean;
};

/**
 * Un `<textarea>` con el corrector de Nova: subraya la ortografía (rojo) y la gramática y el estilo (azul y verde) mientras se escribe, ofrece
 * las correcciones con el botón derecho y aplica la autocorrección. Sirve donde había un `<textarea>`: acepta las mismas propiedades.
 */
export function ProofTextarea({ value, lang, proof = true, autoFix = true, onChange, onKeyDown, onContextMenu, onScroll, style, className, ...rest }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const prev = useRef(value);
  const busy = useRef(false);
  const [tick, setTick] = useState(0);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState<{ issue: Issue; x: number; y: number } | null>(null);
  const useLang = lang ?? defaultFieldLang();

  useEffect(() => {
    if (!proof) return;
    let alive = true;
    void loadSpeller(useLang).then(
      () => alive && (setReady(true), setTick((n) => n + 1)),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [proof, useLang]);
  useEffect(() => onReviewOptions(() => setTick((n) => n + 1)), []);

  const issues = useMemo(() => {
    if (!proof || !ready || value.length > MAX_CHARS) return [];
    return reviewPlainText(value, { lang: useLang, options: getReviewOptions(), engineFor: loadedEngine, onMissing: (l) => void loadSpeller(l).then(() => setTick((n) => n + 1), () => {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, proof, ready, useLang, tick]);

  // el espejo copia la tipografía y las medidas del campo, para que cada palabra caiga justo debajo de la suya
  const sync = useCallback(() => {
    const t = ta.current;
    const m = mirror.current;
    if (!t || !m) return;
    const cs = getComputedStyle(t);
    for (const k of COPIED) (m.style as unknown as Record<string, string>)[k] = cs[k];
    m.style.width = `${t.offsetWidth}px`;
    m.style.height = `${t.offsetHeight}px`;
    m.style.boxSizing = 'border-box';
    const bar = t.offsetWidth - t.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    m.style.paddingRight = `${parseFloat(cs.paddingRight) + Math.max(0, bar)}px`;
    m.scrollTop = t.scrollTop;
  }, []);
  useLayoutEffect(sync);
  useEffect(() => {
    const t = ta.current;
    if (!t || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(sync);
    ro.observe(t);
    return () => ro.disconnect();
  }, [sync]);

  const segments = useMemo(() => {
    const out: { text: string; issue?: Issue }[] = [];
    let at = 0;
    for (const i of issues) {
      if (i.from < at) continue; // si dos se pisan, vale el primero
      if (i.from > at) out.push({ text: value.slice(at, i.from) });
      out.push({ text: value.slice(i.from, i.to), issue: i });
      at = i.to;
    }
    if (at < value.length) out.push({ text: value.slice(at) });
    return out;
  }, [issues, value]);

  const host: ReviewHost = useMemo(() => ({ lang: useLang, views: () => [], focus: () => ta.current?.focus() }), [useLang]);
  const fix = (f: { from: number; to: number; text: string }) => {
    const t = ta.current;
    if (!t) return;
    setNativeValue(t, applyFixToText(t.value, f), f.from + f.text.length);
  };

  return (
    <div className="nv-pt" style={{ position: 'relative', display: 'block' }}>
      <div ref={mirror} className="nv-pt__mirror" aria-hidden="true">
        {segments.map((s, n) =>
          s.issue ? (
            <span key={n} data-issue={n} className={s.issue.kind === 'spelling' ? 'nw-misspelled' : s.issue.kind === 'style' ? 'nw-style' : 'nw-grammar'}>
              {s.text}
            </span>
          ) : (
            <span key={n}>{s.text}</span>
          ),
        )}
        {value.endsWith('\n') ? '​' : ''}
      </div>
      <textarea
        {...rest}
        ref={ta}
        value={value}
        spellCheck={false}
        className={className}
        style={{ ...style, position: 'relative', background: 'transparent', display: 'block' }}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
          const t = e.target;
          const before = prev.current;
          prev.current = t.value;
          if (autoFix && !busy.current && !(e.nativeEvent as InputEvent).isComposing) {
            const r = autoCorrectField(before, t.value, t.selectionStart);
            if (r) {
              busy.current = true;
              prev.current = r.text;
              setNativeValue(t, r.text, r.caret);
              busy.current = false;
              return;
            }
          }
          onChange?.(e);
        }}
        onScroll={(e) => {
          if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
          onScroll?.(e);
        }}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          onContextMenu?.(e);
          if (e.defaultPrevented || !mirror.current) return;
          // qué palabra subrayada hay bajo el puntero: se compara con los rectángulos de las palabras del espejo
          for (const el of mirror.current.querySelectorAll<HTMLElement>('[data-issue]')) {
            for (const r of el.getClientRects()) {
              if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
                const issue = segments[Number(el.dataset.issue)]?.issue;
                if (issue) {
                  e.preventDefault();
                  setMenu({ issue, x: e.clientX, y: e.clientY });
                  return;
                }
              }
            }
          }
        }}
      />
      {menu && <ReviewMenu host={host} viewId="field" issue={menu.issue} x={menu.x} y={menu.y} onFix={fix} onClose={() => setMenu(null)} />}
    </div>
  );
}
