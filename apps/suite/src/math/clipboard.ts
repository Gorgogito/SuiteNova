import { mathClipHtml, mathClipText, mathSpanHtml, mathsFromHtml, replaceMathInHtml, type MathClip } from '@suitenova/math-core';
import type { Node as PMNode, Slice } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/*
 * Ecuaciones en el portapapeles del sistema (Writer, Notes, Slides y Calc): ver `math-core/src/clip.ts` para el formato. Lo que se copia es
 * el fragmento que Word entiende como ecuación (y Nova lee de vuelta con su código original), más el formato lineal como texto, que se
 * puede pegar donde solo cabe texto (el cuerpo de un correo, una celda).
 */

/** Pone la ecuación en el portapapeles de un evento de copiar o cortar. */
export function putMath(dt: DataTransfer, c: MathClip): void {
  dt.setData('text/html', mathClipHtml(c));
  dt.setData('text/plain', mathClipText(c));
}

/** La primera ecuación que lleva un evento de pegar, si lleva alguna. */
export const mathOfPaste = (dt: DataTransfer | null | undefined): MathClip | null => mathsFromHtml(dt?.getData('text/html'))[0] ?? null;

/** Copia la ecuación desde un botón (HTML y texto; si el navegador no deja escribir HTML, solo el texto). */
export async function writeMath(c: MathClip): Promise<void> {
  const text = mathClipText(c);
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([mathClipHtml(c)], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
  } catch {
    await navigator.clipboard?.writeText(text).catch(() => undefined);
  }
}

/** La ecuación que hay en el portapapeles del sistema (desde un botón), o null. */
export async function readMath(): Promise<MathClip | null> {
  try {
    for (const item of await navigator.clipboard.read()) {
      if (!item.types.includes('text/html')) continue;
      const c = mathsFromHtml(await (await item.getType('text/html')).text())[0];
      if (c) return c;
    }
  } catch {
    /* sin permiso para leer el portapapeles */
  }
  return null;
}

// ------------------------------------------------------------------------------------------------------ ProseMirror

const leafText = (n: PMNode): string => (n.type.name === 'math' ? mathClipText({ tex: String(n.attrs.tex ?? ''), display: !!n.attrs.display }) : (n.type.spec.leafText?.(n) ?? ''));

/**
 * Lo que hay que añadir a un editor de ProseMirror con ecuaciones (Writer, Notes): el texto copiado lleva la ecuación en formato lineal y el
 * HTML pegado (de Word, de otra página, de otro producto de Nova) se convierte en nodos de ecuación.
 */
export const mathClipboardProps = {
  clipboardTextSerializer: (slice: Slice): string => slice.content.textBetween(0, slice.content.size, '\n\n', leafText),
  transformPastedHTML: (html: string): string => replaceMathInHtml(html, (c) => mathSpanHtml(c)),
};

/**
 * Hace que el HTML que ProseMirror pone al copiar o cortar lleve cada ecuación como la entiende Word. Se engancha después de crear la vista,
 * para ejecutarse tras el manejador de ProseMirror, y reescribe lo que este acaba de poner en el portapapeles.
 */
export function hookMathCopy(view: EditorView): void {
  const fix = (e: Event) => {
    const dt = (e as ClipboardEvent).clipboardData;
    const html = dt?.getData('text/html');
    if (!dt || !html || !html.includes('nw-math')) return;
    dt.setData('text/html', replaceMathInHtml(html, (c) => mathClipHtml(c)));
  };
  view.dom.addEventListener('copy', fix);
  view.dom.addEventListener('cut', fix);
}
