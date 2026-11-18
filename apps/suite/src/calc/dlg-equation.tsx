import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { parseMath, toTex, type MNode } from '@suitenova/math-core';
import { useEffect, useState } from 'react';
import { EquationEditor } from '../math/EquationEditor';
import { EQUATION_EXAMPLES, mathml, renderEquation } from '../slides/equation';
import type { CalcUI } from './commands';
import { Modal } from './modal';

const DEFAULT_TEX = String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`;
const DEFAULT_SIZE = 14;

/**
 * Cuadro «Ecuación»: el editor estructurado compartido y el código LaTeX. La ecuación es un cuadro sobre la hoja cuyo contenido es la
 * fórmula (en el `.xlsx`, texto de ecuación de Excel); la imagen que se genera aquí solo es su respaldo y le da su tamaño natural.
 */
export function EquationDialog({ ui, create, onClose }: { ui: CalcUI; create: boolean; onClose: () => void }) {
  const d = ui.doc;
  const box = create ? undefined : d.sheet.shapes.find((s) => s.id === d.x.selectedShape && s.math);
  const start = box?.math?.tex ?? DEFAULT_TEX;
  const [latex, setLatex] = useState(start);
  const [tree, setTree] = useState<MNode>(() => parseMath(start));
  const [size, setSize] = useState(box?.math?.size ?? DEFAULT_SIZE);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      if (latex.trim()) mathml(latex);
      setError('');
    } catch (e) {
      setError((e as Error).message.replace(/^KaTeX parse error: /, ''));
    }
  }, [latex]);

  const apply = async () => {
    setBusy(true);
    try {
      const pt = Math.min(200, Math.max(6, size || DEFAULT_SIZE));
      // un píxel de la hoja es 3/4 de punto: la fórmula se mide a ese tamaño
      const img = await renderEquation(latex, '#000000', (pt * 4) / 3);
      if (box) d.x.setEquation(box.id, latex, pt, img);
      else d.x.insertEquation(latex, pt, img);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('Ecuación')}
      onClose={onClose}
      width={640}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!latex.trim() || !!error || busy} onClick={() => void apply()}>
            {box ? t('Aplicar') : t('Insertar')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <div role="group" aria-label={t('Ejemplos')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {EQUATION_EXAMPLES.map((e) => (
            <Button
              key={e.name}
              size="small"
              onClick={() => {
                setLatex(e.latex);
                setTree(parseMath(e.latex));
              }}
            >
              {t(e.name)}
            </Button>
          ))}
        </div>
        <EquationEditor value={tree} autoFocus onChange={(n) => setLatex(toTex(n).trim())} />
        <label style={{ display: 'grid', gap: 4 }}>
          <span>{t('Código LaTeX (se actualiza solo; también se puede escribir aquí)')}</span>
          <textarea
            rows={2}
            aria-label={t('Fórmula en LaTeX')}
            value={latex}
            spellCheck={false}
            onChange={(e) => {
              setLatex(e.target.value);
              setTree(parseMath(e.target.value));
            }}
          />
        </label>
        {error && (
          <span role="alert" style={{ color: '#b00020', fontSize: 13 }}>
            {error}
          </span>
        )}
        <label style={{ display: 'grid', gap: 4, maxWidth: 220 }}>
          <span>{t('Tamaño de la ecuación (pt)')}</span>
          <input type="number" min={6} max={200} step={1} aria-label={t('Tamaño de la ecuación (pt)')} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        </label>
        <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>{t('La ecuación se guarda como texto de ecuación de Excel con una imagen de respaldo para los programas que no la entienden.')}</p>
      </div>
    </Modal>
  );
}
