import { t } from '@suitenova/core-ui';
import { Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CalcDoc } from './doc';
import { ENTRY_PENDING } from './doc-objects';

export function FormulaBar({ doc }: { doc: CalcDoc }) {
  useSyncExternalStore(doc.subscribe, doc.getVersion);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editing = !!doc.edit;
  const shownName = nameDraft ?? doc.nameBoxText();
  const text = doc.edit ? doc.edit.text : doc.editText(doc.activeSheetId, doc.sel.active.row, doc.sel.active.col);

  // keep the bar's caret in step with the editor when typing happens in the cell
  useEffect(() => {
    const el = inputRef.current;
    if (el && doc.edit && !doc.edit.fromBar && document.activeElement === el) el.focus();
  });

  const goTo = (value: string) => {
    if (doc.goTo(value)) {
      setNameDraft(null);
      window.dispatchEvent(new Event('nova:focus-grid'));
      return;
    }
    const err = doc.defineNameForSelection(value.trim());
    if (err) window.alert(err);
    setNameDraft(null);
    window.dispatchEvent(new Event('nova:focus-grid'));
  };

  const commit = () => {
    const err = doc.commitEdit('down');
    if (err === ENTRY_PENDING) return;
    if (err) window.alert(err);
    else window.dispatchEvent(new Event('nova:focus-grid'));
  };

  return (
    <div className="calc-fbar" role="group" aria-label={t('Barra de fórmulas')}>
      <input
        className="calc-fbar__name"
        value={shownName}
        aria-label={t('Cuadro de nombres')}
        onChange={(e) => setNameDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => setNameDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') goTo(e.currentTarget.value);
          else if (e.key === 'Escape') {
            setNameDraft(null);
            window.dispatchEvent(new Event('nova:focus-grid'));
          }
        }}
      />
      <div className="calc-fbar__btns">
        <button type="button" title={t('Cancelar (Esc)')} aria-label={t('Cancelar')} disabled={!editing} onClick={() => doc.cancelEdit()}>
          <X size={14} />
        </button>
        <button type="button" title={t('Introducir (Enter)')} aria-label={t('Introducir')} disabled={!editing} onClick={commit}>
          <Check size={14} />
        </button>
        <button type="button" className="calc-fbar__fx" title={t('Insertar función')} aria-label={t('Insertar función')} onClick={() => window.dispatchEvent(new Event('nova:insert-function'))}>
          ƒx
        </button>
      </div>
      <textarea
        ref={inputRef}
        className={`calc-fbar__input ${expanded ? 'is-expanded' : ''}`}
        rows={1}
        spellCheck={false}
        aria-label={t('Contenido de la celda')}
        value={text}
        onFocus={() => {
          if (!doc.edit) doc.beginEdit({ mode: 'edit', fromBar: true });
        }}
        onChange={(e) => {
          if (!doc.edit) doc.beginEdit({ text: e.target.value, mode: 'edit', fromBar: true });
          doc.setEditText(e.target.value, e.target.selectionStart);
        }}
        onSelect={(e) => {
          if (doc.edit) doc.edit = { ...doc.edit, caret: e.currentTarget.selectionStart };
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            commit();
          } else if (e.key === 'Enter' && e.altKey) {
            e.preventDefault();
            const el = e.currentTarget;
            doc.setEditText(text.slice(0, el.selectionStart) + '\n' + text.slice(el.selectionEnd), el.selectionStart + 1);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            doc.cancelEdit();
            window.dispatchEvent(new Event('nova:focus-grid'));
          }
        }}
      />
      <button type="button" className="calc-fbar__expand" title={expanded ? t('Contraer barra de fórmulas') : t('Expandir barra de fórmulas')} aria-label={expanded ? t('Contraer barra de fórmulas') : t('Expandir barra de fórmulas')} onClick={() => setExpanded((v) => !v)}>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
    </div>
  );
}
