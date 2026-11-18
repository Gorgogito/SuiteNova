/*
 * Ecuaciones en el portapapeles (HTML), para copiar y pegar entre los productos de Nova y desde y hacia Office.
 *
 * El fragmento que se escribe es el que usa Word: un comentario condicional con el OMML (`<!--[if gte msEquation 12]>…<![endif]-->`) y,
 * para quien no lo entiende, el respaldo entre `<![if !msEquation]>` y `<![endif]>`. Nova pone ahí un `<span class="nw-math">` con el
 * código LaTeX en `data-tex` (y el OMML original en `data-omml`, que solo viaja entre productos de Nova) y la ecuación como MathML. Se
 * comprobó con Word real que solo esta forma (y con el espacio de nombres `…/2004/12/omml`) se pega como ecuación; MathML a secas se pega
 * como texto. Al leer se aceptan los tres: el fragmento de Nova, el de Word y un `<math>` suelto (páginas web).
 */
import { fromMathML, texOfMathML } from './mathml';
import { parseMath, toMathML, toTex } from './math';
import { ommlXml, parseOmmlXml } from './omml';
import { toUnicodeMath } from './umath';

export interface MathClip {
  tex: string;
  display: boolean;
  /** El OMML original (solo si viene de otro producto de Nova), con el código con el que se leyó. */
  omml?: string | null;
  ommlTex?: string | null;
}

/** El espacio de nombres de `m:` que Word entiende dentro de su HTML. */
export const WORD_OMML_NS = 'http://schemas.microsoft.com/office/2004/12/omml';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(+d))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/** El texto que acompaña a la ecuación en el portapapeles: el formato lineal de Word. */
export function mathClipText(c: MathClip): string {
  return toUnicodeMath(parseMath(c.tex));
}

/** El `<span class="nw-math">` de Nova con todo lo que hace falta para recuperar la ecuación. */
export function mathSpanHtml(c: MathClip): string {
  const attrs = [`class="nw-math"`, `data-tex="${esc(c.tex)}"`, `data-display="${c.display ? '1' : '0'}"`];
  if (c.omml) attrs.push(`data-omml="${esc(encodeURIComponent(c.omml))}"`, `data-omml-tex="${esc(c.ommlTex ?? '')}"`);
  return `<span ${attrs.join(' ')}>${toMathML(parseMath(c.tex), c.display)}</span>`;
}

/** El fragmento HTML de una ecuación para el portapapeles (ver arriba). */
export function mathClipHtml(c: MathClip): string {
  const omml = ommlXml(parseMath(c.tex), c.display, { rPr: '' }).replace(/xmlns:m="[^"]*"/, `xmlns:m="${WORD_OMML_NS}"`);
  return `<!--[if gte msEquation 12]>${omml}<![endif]--><![if !msEquation]>${mathSpanHtml(c)}<![endif]>`;
}

// ------------------------------------------------------------------------------------------------------------- lectura

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\sdata-${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? unesc(m[1] ?? m[2] ?? '') : null;
};

/** Lee el `<span class="nw-math">` de Nova (su etiqueta de apertura). */
function clipOfSpan(tag: string, inner: string): MathClip | null {
  let tex = attr(tag, 'tex');
  if (tex === null) tex = texOfMathML(inner) ?? mathmlTex(inner);
  if (tex === null) return null;
  const omml = attr(tag, 'omml');
  return { tex, display: attr(tag, 'display') === '1', ...(omml ? { omml: decodeURIComponent(omml), ommlTex: attr(tag, 'omml-tex') ?? '' } : {}) };
}

const mathmlTex = (xml: string): string | null => {
  const n = /<math[\s>][\s\S]*<\/math>/i.exec(xml);
  if (!n) return null;
  try {
    const node = fromMathML(n[0]);
    return node ? toTex(node).trim() : null;
  } catch {
    return null;
  }
};

/** Word escribe el OMML dentro del HTML con envolturas de estilo (`<span>`, `<i>`) y texto sin `m:t`: se deja como OMML corriente. */
function cleanWordOmml(s: string): string {
  return s
    .replace(/<\/?(?:i|b|u|span|font)\b[^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/<m:r>((?:<m:rPr>[\s\S]*?<\/m:rPr>)?)([^<]+)<\/m:r>/g, (_m, pr: string, t: string) => `<m:r>${pr}<m:t xml:space="preserve">${t}</m:t></m:r>`);
}

function clipOfWordOmml(omml: string): MathClip | null {
  try {
    const r = parseOmmlXml(cleanWordOmml(omml));
    return r ? { tex: toTex(r.node).trim(), display: r.display } : null;
  } catch {
    return null;
  }
}

/** Dónde termina el respaldo de Word que empieza en `from` (`<![if !msEquation]>`…`<![endif]>`, con anidados), o -1. */
function endOfFallback(html: string, from: number): number {
  const re = /<!\[if\b[^\]]*\]>|<!\[endif\]>/g;
  re.lastIndex = from;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[0].startsWith('<![if')) depth++;
    else if (--depth === 0) return m.index + m[0].length;
  }
  return -1;
}

const WORD_OPEN = /<!--\[if gte msEquation 12\]>/g;
const WORD_CLOSE = '<![endif]-->';
const SPAN_OPEN = /<span\b[^>]*\bclass\s*=\s*["'][^"']*\bnw-math\b[^"']*["'][^>]*>/gi;
const MATH_OPEN = /<math\b[^>]*>/gi;

interface Found {
  start: number;
  end: number;
  clip: MathClip | null;
}

/** La primera ecuación que empieza en `from` o después. */
function findNext(html: string, from: number): Found | null {
  const cand: Found[] = [];
  WORD_OPEN.lastIndex = from;
  const w = WORD_OPEN.exec(html);
  if (w) {
    const close = html.indexOf(WORD_CLOSE, w.index);
    if (close > 0) {
      const omml = html.slice(w.index + w[0].length, close);
      let end = close + WORD_CLOSE.length;
      let clip = clipOfWordOmml(omml);
      // la lectura asíncrona del portapapeles (Chromium) cambia `<![if !msEquation]>` por un comentario: se acepta también el respaldo de Nova así
      const san = /^\s*<!--\[if !msEquation\]-->(<span\b[\s\S]*?<\/span>)<!--\[endif\]-->/.exec(html.slice(end));
      const fb = /^\s*<!\[if !msEquation\]>/.exec(html.slice(end));
      if (san) {
        SPAN_OPEN.lastIndex = 0;
        const s = SPAN_OPEN.exec(san[1]!);
        const own = s ? clipOfSpan(s[0], '') : null;
        if (own) clip = own;
        end += san[0].length;
      } else if (fb) {
        const fEnd = endOfFallback(html, end + fb[0].indexOf('<!['));
        if (fEnd > 0) {
          // el respaldo de Nova lleva el código original: es más fiel que el OMML
          const inner = html.slice(end, fEnd);
          SPAN_OPEN.lastIndex = 0;
          const s = SPAN_OPEN.exec(inner);
          const own = s ? clipOfSpan(s[0], '') : null;
          if (own) clip = own;
          end = fEnd;
        }
      }
      cand.push({ start: w.index, end, clip });
    }
  }
  SPAN_OPEN.lastIndex = from;
  const s = SPAN_OPEN.exec(html);
  if (s) {
    const close = html.indexOf('</span>', s.index + s[0].length);
    if (close > 0) cand.push({ start: s.index, end: close + 7, clip: clipOfSpan(s[0], html.slice(s.index + s[0].length, close)) });
  }
  MATH_OPEN.lastIndex = from;
  const m = MATH_OPEN.exec(html);
  if (m) {
    const close = html.toLowerCase().indexOf('</math>', m.index);
    if (close > 0) {
      const tex = mathmlTex(html.slice(m.index, close + 7));
      cand.push({ start: m.index, end: close + 7, clip: tex === null ? null : { tex, display: /display\s*=\s*["']block["']/i.test(m[0]) } });
    }
  }
  cand.sort((a, b) => a.start - b.start);
  return cand[0] ?? null;
}

/**
 * Sustituye cada ecuación del HTML por lo que devuelva `fn` (`null` la deja como estaba). Un `<math>` dentro de un `<span class="nw-math">` o de
 * un fragmento de Word cuenta como una sola ecuación.
 */
export function replaceMathInHtml(html: string, fn: (c: MathClip) => string | null): string {
  let out = '';
  let i = 0;
  for (let f = findNext(html, i); f; f = findNext(html, i)) {
    const r = f.clip ? fn(f.clip) : null;
    out += html.slice(i, f.start) + (r ?? html.slice(f.start, f.end));
    i = f.end;
  }
  return out + html.slice(i);
}

/** Las ecuaciones que lleva un fragmento HTML del portapapeles, en orden. */
export function mathsFromHtml(html: string | null | undefined): MathClip[] {
  const out: MathClip[] = [];
  if (html) replaceMathInHtml(html, (c) => (out.push(c), null));
  return out;
}
