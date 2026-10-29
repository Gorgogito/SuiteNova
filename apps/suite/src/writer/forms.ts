import { nodeTypes } from '@suitenova/writer-core';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, TextSelection, type EditorState } from 'prosemirror-state';

export type ControlType = 'text' | 'richText' | 'dropdown' | 'combo' | 'date' | 'checkbox';

export const PLACEHOLDERS: Record<ControlType, string> = {
  text: 'Haga clic o pulse aquí para escribir texto.',
  richText: 'Haga clic o pulse aquí para escribir texto.',
  dropdown: 'Elija un elemento.',
  combo: 'Elija un elemento o escriba.',
  date: 'Haga clic o pulse para seleccionar una fecha.',
  checkbox: '☐',
};

export const placeholderOf = (attrs: Record<string, any>): string => (attrs.placeholder as string) || PLACEHOLDERS[attrs.type as ControlType] || '';

/**
 * Keeps the placeholder of content controls honest: it shows (greyed) while the control is empty and goes away when
 * something is typed; an emptied control gets its placeholder back.
 */
export function formsPlugin(): Plugin {
  return new Plugin({
    appendTransaction(trs, _old, state: EditorState) {
      if (!trs.some((t) => t.docChanged)) return null;
      const fixes: { pos: number; node: PMNode; showing: boolean; reset: boolean }[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name !== 'content_control' || node.attrs.type === 'checkbox') return true;
        const text = node.textContent;
        const ph = placeholderOf(node.attrs);
        if (node.attrs.showing && text !== ph && text !== '') fixes.push({ pos, node, showing: false, reset: false });
        else if (!node.attrs.showing && text === '') fixes.push({ pos, node, showing: true, reset: true });
        else if (node.attrs.showing && text === '') fixes.push({ pos, node, showing: true, reset: true });
        return true;
      });
      if (!fixes.length) return null;
      const tr = state.tr;
      for (const f of fixes.sort((a, b) => b.pos - a.pos)) {
        if (f.reset) {
          const ph = placeholderOf(f.node.attrs);
          tr.replaceWith(f.pos + 1, f.pos + 1 + f.node.content.size, ph ? state.schema.text(ph) : []);
          tr.setNodeMarkup(f.pos, undefined, { ...f.node.attrs, showing: true });
          // keep the caret at the start of the placeholder
          if (state.selection.from > f.pos && state.selection.from <= f.pos + f.node.nodeSize) tr.setSelection(TextSelection.create(tr.doc, f.pos + 1));
        } else tr.setNodeMarkup(f.pos, undefined, { ...f.node.attrs, showing: false });
      }
      return tr.setMeta('addToHistory', false).setMeta('nw-allow', true).setMeta('nw-no-track', true);
    },
  });
}

/** A new inline content control showing its placeholder. */
export function newControl(type: ControlType, init: Partial<Record<string, unknown>> = {}): PMNode {
  const attrs = { type, id: '', tag: '', title: '', placeholder: '', showing: type !== 'checkbox', checked: false, items: type === 'dropdown' || type === 'combo' ? [{ label: 'Elemento 1', value: '1' }, { label: 'Elemento 2', value: '2' }] : null, dateFormat: 'dd/MM/yyyy', lock: null, ...init };
  const text = type === 'checkbox' ? (attrs.checked ? '☒' : '☐') : placeholderOf(attrs);
  return nodeTypes.content_control!.create(attrs, text ? nodeTypes.paragraph!.schema.text(text) : []);
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Format a date with a Word-style pattern (d, dd, ddd, dddd, M, MM, MMM, MMMM, yy, yyyy, H, HH, mm). */
export function formatDatePattern(d: Date, pattern: string): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return pattern.replace(/yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|mm/g, (t) => {
    switch (t) {
      case 'yyyy': return String(d.getFullYear());
      case 'yy': return p2(d.getFullYear() % 100);
      case 'MMMM': return MONTHS[d.getMonth()]!;
      case 'MMM': return MONTHS[d.getMonth()]!.slice(0, 3);
      case 'MM': return p2(d.getMonth() + 1);
      case 'M': return String(d.getMonth() + 1);
      case 'dddd': return DAYS[d.getDay()]!;
      case 'ddd': return DAYS[d.getDay()]!.slice(0, 3);
      case 'dd': return p2(d.getDate());
      case 'd': return String(d.getDate());
      case 'HH': return p2(d.getHours());
      case 'H': return String(d.getHours());
      default: return p2(d.getMinutes());
    }
  });
}
