import { t } from '@suitenova/core-ui';
import { noteDoc } from '@suitenova/writer-core';
import type { Node as PMNode } from 'prosemirror-model';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WriterCtl } from './doc';
import { MiniPM } from './PageOverlay';

/** A small window to write the text of a footnote or endnote, next to where it is referenced. */
export function NotePopup({ ctl }: { ctl: WriterCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const id = ctl.noteEdit;
  const note = id ? ctl.notes().find((n) => n.id === id) : undefined;
  const pending = useRef<{ id: string; doc: PMNode } | null>(null);
  const timer = useRef<number>(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const flush = () => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    if (p) ctl.setNoteBody(p.id, p.doc);
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!note || !ctl.mainView) {
      setPos(null);
      return;
    }
    try {
      const c = ctl.mainView.coordsAtPos(note.pos);
      const w = 340;
      const left = Math.max(8, Math.min(window.innerWidth - w - 12, c.left - 20));
      const top = Math.min(window.innerHeight - 180, c.bottom + 8);
      setPos({ left, top: Math.max(8, top) });
    } catch {
      setPos({ left: 100, top: 100 });
    }
  }, [note?.id, ctl.mainView]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!id || !note || !pos) return null;
  const doc = noteDoc(note.node.attrs.body);
  return (
    <div className="nw-notepop" role="dialog" aria-label={note.kind === 'footnote' ? t('Nota al pie') : t('Nota final')} style={{ left: pos.left, top: pos.top }}>
      <div className="nw-notepop-head">
        <strong>
          {note.kind === 'footnote' ? t('Nota al pie') : t('Nota final')} {note.label}
        </strong>
        <button
          type="button"
          className="nv-btn nv-btn--small"
          onClick={() => {
            flush();
            ctl.endNoteEdit();
          }}
        >
          {t('Listo')}
        </button>
      </div>
      <div className="nw-notepop-body">
        <MiniPM
          key={id}
          doc={doc}
          autoFocus
          label={t('Texto de la nota')}
          className="nw-notepop-editor"
          onView={(v) => {
            ctl.activeView = v;
          }}
          onChange={(d) => {
            pending.current = { id, doc: d };
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(flush, 250);
          }}
        />
      </div>
    </div>
  );
}
