import { registerMessages, t } from '@suitenova/core-ui';
import { parseGoToNumber } from '@suitenova/find-core';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import type { FindFeatures, FindHost, FindStatus } from '../find';
import { findKey, type WriterCtl } from './doc';
import { goToBookmark, listBookmarks } from './refs-actions';

registerMessages('en', {
  'Página': 'Page',
  'Marcador': 'Bookmark',
  'Comentario': 'Comment',
  'Nota al pie': 'Footnote',
  'Título': 'Heading',
  'Negrita': 'Bold',
  'Cursiva': 'Italic',
  'Subrayado': 'Underline',
  'Estilo de párrafo': 'Paragraph style',
  'número, +3 o -2': 'number, +3 or -2',
  'No hay una página {n}.': 'There is no page {n}.',
  'Escribe un número de página.': 'Type a page number.',
  'Ese marcador ya no existe.': 'That bookmark no longer exists.',
  'Elige un elemento de la lista.': 'Choose an item from the list.',
});

const status = (f: { matches: unknown[]; current: number } | null): FindStatus => ({ count: f?.matches.length ?? 0, current: f?.current ?? -1 });

/** Writer's side of the shared search panel: the paragraphs of the document, its formatting and its places. */
export function writerFindHost(ctl: WriterCtl): FindHost {
  const view = () => ctl.mainView;
  return {
    get features(): FindFeatures {
      return {
        modes: ['normal', 'wildcards', 'regex'],
        replace: !ctl.readOnly,
        special: true,
        filters: [
          { id: 'bold', label: 'Negrita', kind: 'bool' },
          { id: 'italic', label: 'Cursiva', kind: 'bool' },
          { id: 'underline', label: 'Subrayado', kind: 'bool' },
          { id: 'style', label: 'Estilo de párrafo', kind: 'select', options: ctl.styles.filter((s) => !s.hidden).map((s) => ({ value: s.id, label: s.name })) },
        ],
        goTo: [
          { id: 'page', label: 'Página', hint: t('número, +3 o -2') },
          {
            id: 'heading',
            label: 'Título',
            options: () => headings(ctl).map((h) => ({ value: String(h.pos), label: h.text })),
          },
          { id: 'bookmark', label: 'Marcador', options: () => listBookmarks(ctl).map((b) => ({ value: b.name, label: b.name })) },
          { id: 'comment', label: 'Comentario', options: () => ctl.threadList().map((th, i) => ({ value: th.id, label: `${i + 1}. ${ctl.commentQuote(th.id).slice(0, 40)}` })) },
          { id: 'footnote', label: 'Nota al pie', options: () => ctl.notes().filter((n) => n.kind === 'footnote').map((n) => ({ value: String(n.pos), label: n.label })) },
        ],
      };
    },
    selectionText() {
      const s = ctl.state;
      return s && !s.selection.empty ? s.doc.textBetween(s.selection.from, s.selection.to, '\n') : '';
    },
    find: (req) => status(ctl.find(req)),
    step: (dir) => status(ctl.findStep(dir)),
    replaceCurrent: (req, template) => status(ctl.replaceCurrent(req, template)),
    replaceAll: (req, template) => ctl.replaceAll(req, template),
    clear: () => ctl.clearFind(),
    goTo(kind, value) {
      const v = view();
      if (!v) return null;
      if (kind === 'page') {
        const n = parseGoToNumber(value);
        if (!n) return t('Escribe un número de página.');
        const target = n.relative ? ctl.currentPage() + n.n : n.n;
        return target >= 1 && target <= ctl.pages && ctl.goToPage(target) ? null : t('No hay una página {n}.', { n: target });
      }
      if (!value) return t('Elige un elemento de la lista.');
      if (kind === 'bookmark') {
        if (!listBookmarks(ctl).some((b) => b.name === value)) return t('Ese marcador ya no existe.');
        goToBookmark(ctl, value);
      } else if (kind === 'comment') ctl.goToComment(value);
      else if (kind === 'heading') {
        v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(Number(value) + 1))).scrollIntoView());
        v.focus();
      } else if (kind === 'footnote') {
        v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, Number(value))).scrollIntoView());
        v.focus();
      }
      return null;
    },
  };
}

/** The paragraphs whose style is a heading (position of the paragraph and its text). */
function headings(ctl: WriterCtl): { pos: number; text: string }[] {
  const level = new Map(ctl.styles.filter((s) => s.heading).map((s) => [s.id, s.heading!]));
  const out: { pos: number; text: string }[] = [];
  ctl.body.descendants((n, pos) => {
    if (!n.isTextblock) return true;
    const l = level.get(n.attrs.style as string);
    if (l && n.textContent.trim()) out.push({ pos, text: `${'  '.repeat(l - 1)}${n.textContent.trim().slice(0, 60)}` });
    return false;
  });
  return out;
}

export { findKey };
