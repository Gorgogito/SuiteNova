import { Button, DialogActions, DialogContent, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { parseMath, toMathML, toTex, type MNode } from '@suitenova/math-core';
import { useState } from 'react';
import { StickyDialog } from '../mail/StickyDialog';
import { EquationEditor } from '../math/EquationEditor';

/** The equation of a question, drawn from its source (the MathML is made here: nothing of the file is put in the page). */
export function Equation({ tex }: { tex: string | undefined }) {
  if (!tex?.trim()) return null;
  return <div className="fm-eq" role="math" aria-label={tex} dangerouslySetInnerHTML={{ __html: toMathML(parseMath(tex), true) }} />;
}

/** The shared equation editor of SuiteNova, with the code beside it. */
function EquationBody({ initial, onSave, onClose }: { initial: string; onSave: (tex: string) => void; onClose: () => void }) {
  const [tex, setTex] = useState(initial);
  const [tree, setTree] = useState<MNode>(() => parseMath(initial));
  const accept = () => {
    onSave(tex.trim());
    onClose();
  };
  return (
    <>
      <DialogTitle>{t('Ecuación')}</DialogTitle>
      <DialogContent>
        <div className="fm-editor">
          <EquationEditor
            value={tree}
            autoFocus
            onChange={(n) => {
              setTree(n);
              setTex(toTex(n).trim());
            }}
            onEnter={accept}
          />
          <label className="fm-field">
            <span>{t('Código LaTeX (se actualiza solo; también se puede escribir aquí)')}</span>
            <textarea
              className="fm-input"
              rows={2}
              value={tex}
              onChange={(e) => {
                setTex(e.target.value);
                setTree(parseMath(e.target.value));
              }}
            />
          </label>
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Cancelar')}</Button>
        <Button appearance="primary" disabled={!tex.trim()} onClick={accept}>
          {t('Aceptar')}
        </Button>
      </DialogActions>
    </>
  );
}

/** Adds, changes and takes away the equation of a question. */
export function EquationField({ tex, onChange }: { tex: string | undefined; onChange: (tex: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fm-field" role="group" aria-label={t('Ecuación de la pregunta')}>
      <span>{t('Ecuación (opcional)')}</span>
      <Equation tex={tex} />
      <div className="fm-row">
        <button type="button" className="fm-add" onClick={() => setOpen(true)}>
          {tex ? t('Editar la ecuación…') : t('Agregar una ecuación…')}
        </button>
        {tex && (
          <button type="button" className="fm-add" onClick={() => onChange(undefined)}>
            {t('Quitar la ecuación')}
          </button>
        )}
      </div>
      {/* it stays in place while closing, so that the rest of the page is shown again to screen readers */}
      <StickyDialog open={open} onClose={() => setOpen(false)} width={640}>
        {open && <EquationBody initial={tex ?? ''} onSave={(v) => onChange(v || undefined)} onClose={() => setOpen(false)} />}
      </StickyDialog>
    </div>
  );
}
