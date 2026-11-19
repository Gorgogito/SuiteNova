import { getLocale } from '@suitenova/core-ui';
import { isSpellLang, type SpellLang } from '@suitenova/spell-core';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type TextareaHTMLAttributes } from 'react';
import { autoCorrectField } from './autocorrect';
import { loadedEngine, loadSpeller } from './load';
import { getReviewOptions, onReviewOptions } from './options';
import { applyFixToText, reviewPlainText } from './plain';
import { type Issue } from './review';
import { matchCase } from '@suitenova/thesaurus-core';
import { ThesaurusDialog, type ThesaurusHost } from './ThesaurusPane';
import { wordInText } from './thesaurus';
import { ReviewMenu, type ReviewHost } from './ui';
import { WordMenuView, type WordMenuActions } from './WordMenu';

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

/** La palabra del texto cuyo rectángulo (en el espejo) contiene el punto, con su tramo; el espejo repite el texto del campo tal cual. */
function wordAtPoint(mirror: HTMLElement, value: string, x: number, y: number): { word: string; from: number; to: number } | null {
  const nodes: { node: Text; start: number }[] = [];
  let len = 0;
  const w = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    nodes.push({ node: n as Text, start: len });
    len += (n.textContent ?? '').length;
  }
  const at = (off: number): { node: Text; offset: number } | null => {
    for (const n of nodes) if (off >= n.start && off <= n.start + (n.node.textContent ?? '').length) return { node: n.node, offset: off - n.start };
    return null;
  };
  for (const m of value.matchAll(/[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu)) {
    const a = at(m.index!);
    const b = at(m.index! + m[0].length);
    if (!a || !b) continue;
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    for (const q of r.getClientRects()) if (x >= q.left && x <= q.right && y >= q.top && y <= q.bottom) return wordInText(value, m.index! + 1);
  }
  return null;
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
  const [wordMenu, setWordMenu] = useState<{ w: { word: string; from: number; to: number }; x: number; y: number } | null>(null);
  const [thesaurus, setThesaurus] = useState(false);
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
  /** El campo visto por el panel «Sinónimos»: la palabra del cursor (o de la selección) y cómo se reemplaza. */
  const thHost: ThesaurusHost = useMemo(() => {
    const cur = () => {
      const t = ta.current;
      if (!t) return null;
      const { selectionStart: a, selectionEnd: b, value: v } = t;
      if (a !== b) {
        const raw = v.slice(a, b);
        const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        if (!word || word.length > 60) return null;
        const from = a + raw.indexOf(word);
        return { word, from, to: from + word.length };
      }
      return wordInText(v, a);
    };
    return {
      lang: useLang,
      readOnly: !!rest.readOnly || !!rest.disabled,
      current: () => {
        const c = cur();
        return c ? { word: c.word } : null;
      },
      insert: (text) => {
        const t = ta.current;
        const c = cur();
        if (!t || !c) return;
        const next = matchCase(c.word, text);
        setNativeValue(t, t.value.slice(0, c.from) + next + t.value.slice(c.to), c.from + next.length);
        t.setSelectionRange(c.from, c.from + next.length);
      },
      focus: () => ta.current?.focus(),
    };
  }, [useLang, rest.readOnly, rest.disabled]);
  const selectRange = (from: number, to: number) => {
    ta.current?.focus();
    ta.current?.setSelectionRange(from, to);
  };
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
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (!e.defaultPrevented && e.key === 'F7' && e.shiftKey && proof) {
            e.preventDefault();
            setThesaurus(true);
          }
        }}
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
          // una palabra cualquiera: Cortar, Copiar, Pegar y sinónimos
          if (proof) {
            const w = wordAtPoint(mirror.current, value, e.clientX, e.clientY);
            if (w) {
              e.preventDefault();
              setWordMenu({ w, x: e.clientX, y: e.clientY });
            }
          }
        }}
      />
      {menu && <ReviewMenu host={host} viewId="field" issue={menu.issue} x={menu.x} y={menu.y} onFix={fix} onClose={() => setMenu(null)} onThesaurus={() => { selectRange(menu.issue.from, menu.issue.to); setThesaurus(true); }} />}
      {wordMenu && (
        <WordMenuView
          x={wordMenu.x}
          y={wordMenu.y}
          onClose={() => setWordMenu(null)}
          a={{
            word: wordMenu.w.word,
            lang: useLang,
            readOnly: thHost.readOnly,
            hasSelection: (ta.current?.selectionStart ?? 0) !== (ta.current?.selectionEnd ?? 0),
            cut: () => void document.execCommand('cut'),
            copy: () => void document.execCommand('copy'),
            paste: () => {
              const t = ta.current;
              void navigator.clipboard.readText().then((text) => {
                if (!t || !text) return;
                const a = t.selectionStart;
                setNativeValue(t, t.value.slice(0, a) + text + t.value.slice(t.selectionEnd), a + text.length);
              }, () => {});
            },
            replace: (next) => setNativeValue(ta.current!, value.slice(0, wordMenu.w.from) + next + value.slice(wordMenu.w.to), wordMenu.w.from + next.length),
            openThesaurus: () => {
              selectRange(wordMenu.w.from, wordMenu.w.to);
              setThesaurus(true);
            },
            focus: () => ta.current?.focus(),
          } satisfies WordMenuActions}
        />
      )}
      {thesaurus && <ThesaurusDialog host={thHost} onClose={() => { setThesaurus(false); ta.current?.focus(); }} />}
    </div>
  );
}
