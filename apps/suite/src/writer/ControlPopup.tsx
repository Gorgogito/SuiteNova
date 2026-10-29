import { t } from '@suitenova/core-ui';
import { useEffect, useRef, useState } from 'react';
import type { WriterCtl } from './doc';
import { formatDatePattern, placeholderOf } from './forms';

/** The list or calendar that opens under a drop-down, combo box or date content control. */
export function ControlPopup({ ctl, pos, onClose }: { ctl: WriterCtl; pos: number; onClose: () => void }) {
  const v = ctl.mainView;
  const node = v?.state.doc.nodeAt(pos);
  const ref = useRef<HTMLDivElement>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [onClose]);
  if (!v || !node || node.type.name !== 'content_control') return null;
  const a = node.attrs;
  let left = 20;
  let top = 20;
  try {
    const c = v.coordsAtPos(pos + 1);
    left = c.left;
    top = c.bottom + 2;
  } catch {
    /* off screen */
  }
  const set = (text: string, showing = false) => {
    const tr = v.state.tr;
    const txt = text || placeholderOf(a);
    tr.replaceWith(pos + 1, pos + 1 + node.content.size, txt ? v.state.schema.text(txt) : []);
    tr.setNodeMarkup(pos, undefined, { ...a, showing: showing || !text });
    v.dispatch(tr.setMeta('nw-form', true).setMeta('nw-no-track', true).setMeta('nw-allow', true));
    onClose();
    v.focus();
  };
  const items = (a.items as { label: string; value: string }[] | null) ?? [];
  return (
    <div ref={ref} className="nw-ctl-popup" style={{ left, top }} role="listbox" aria-label={a.title || t('Control de contenido')}>
      {a.type === 'date' ? (
        <div style={{ padding: 8, display: 'grid', gap: 6 }}>
          <input type="date" aria-label={t('Fecha')} value={date} onChange={(e) => setDate(e.target.value)} autoFocus />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="nw-btn" onClick={() => set(formatDatePattern(new Date(), a.dateFormat))}>
              {t('Hoy')}
            </button>
            <button className="nw-btn" disabled={!date} onClick={() => set(formatDatePattern(new Date(date + 'T12:00:00'), a.dateFormat))}>
              {t('Aceptar')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {items.map((it) => (
            <div key={it.value + it.label} role="option" aria-selected={node.textContent === it.label} className="nw-ctl-item" tabIndex={0} onClick={() => set(it.label)} onKeyDown={(e) => e.key === 'Enter' && set(it.label)}>
              {it.label}
            </div>
          ))}
          {!items.length && <div className="nw-ctl-item" style={{ color: '#888' }}>{t('(lista vacía)')}</div>}
        </>
      )}
    </div>
  );
}
