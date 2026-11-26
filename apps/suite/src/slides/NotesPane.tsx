import { t } from '@suitenova/core-ui';
import { docNode, docText, makeDoc, updateSlide, type TextBody } from '@suitenova/slides-core';
import { useSyncExternalStore } from 'react';
import type { SlidesCtl } from './ctl';

/** The notes of the current slide, as plain paragraphs. */
export function NotesPane({ ctl, page }: { ctl: SlidesCtl; page?: boolean }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const slide = ctl.slide;
  const text = slide.notes ? docText(slide.notes.doc) : '';
  return (
    <div className={page ? 'sl-notes sl-notes--page' : 'sl-notes'}>
      <textarea
        aria-label={t('Notas del orador')}
        placeholder={t('Haga clic para agregar notas')}
        value={text}
        onFocus={() => ctl.beginGesture('Editar notas')}
        onBlur={() => ctl.endGesture()}
        onChange={(e) => {
          const lines = e.target.value.split('\n');
          // keep the formatting of notes that were not changed paragraph by paragraph
          const old = slide.notes ? docNode(slide.notes.doc) : null;
          const body: TextBody = { body: slide.notes?.body ?? {}, lst: slide.notes?.lst, doc: makeDoc(lines.map((l, i) => ({ text: l, p: old && i < old.childCount ? (old.child(i).attrs.p as object) : undefined }))).toJSON() };
          ctl.liveDeck((d) => updateSlide(d, slide.id, (s) => ({ ...s, notes: body })));
        }}
      />
    </div>
  );
}
