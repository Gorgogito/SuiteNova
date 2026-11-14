import { Button, Checkbox, Input, Select } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { defaultLineNumbers, defaultPageBorders, type LineNumbers, type PageBorders } from '@suitenova/writer-core';
import { useState } from 'react';
import type { WriterUI } from './commands';
import { Modal, field, focusDocSoon } from './dialogs';

const num = (s: string, fallback: number): number => {
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : fallback;
};

// ------------------------------------------------------------------------------------------------ bordes de página
export function PageBordersDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const c = ui.ctl;
  const cur = c.currentSection().props.borders;
  const [on, setOn] = useState(!!cur);
  const [b, setB] = useState<PageBorders>(cur ?? defaultPageBorders());
  const [scope, setScope] = useState<'document' | 'section'>('document');
  const set = (patch: Partial<PageBorders>) => setB((x) => ({ ...x, ...patch }));
  const accept = () => {
    c.setSectionsProps({ borders: on ? { ...b, width: Math.min(12, Math.max(0.25, b.width)), offset: Math.min(31, Math.max(0, b.offset)) } : null }, scope);
    onClose();
    focusDocSoon(ui);
  };
  return (
    <Modal
      title={t('Bordes de página')}
      onClose={onClose}
      width={460}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" onClick={accept}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <Checkbox label={t('Dibujar un borde alrededor de la página')} checked={on} onChange={(_e, v) => setOn(!!v.checked)} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
        <div style={field}>
          <label htmlFor="pb-style">{t('Estilo')}</label>
          <Select id="pb-style" disabled={!on} value={b.style} onChange={(_e, v) => set({ style: v.value as PageBorders['style'] })}>
            <option value="single">{t('Sencillo')}</option>
            <option value="double">{t('Doble')}</option>
            <option value="triple">{t('Triple')}</option>
            <option value="dotted">{t('Punteado')}</option>
            <option value="dashed">{t('Rayas')}</option>
            <option value="thick">{t('Grueso')}</option>
          </Select>
        </div>
        <div style={field}>
          <label htmlFor="pb-color">{t('Color')}</label>
          <input id="pb-color" type="color" disabled={!on} value={b.color} onChange={(e) => set({ color: e.target.value })} />
        </div>
        <div style={field}>
          <label htmlFor="pb-width">{t('Grosor (pt)')}</label>
          <Input id="pb-width" type="number" min={0.25} max={12} step={0.25} disabled={!on} value={String(b.width)} onChange={(_e, v) => set({ width: num(v.value, 1) })} />
        </div>
        <div style={field}>
          <label htmlFor="pb-off">{t('Distancia (pt)')}</label>
          <Input id="pb-off" type="number" min={0} max={31} step={1} disabled={!on} value={String(b.offset)} onChange={(_e, v) => set({ offset: num(v.value, 24) })} />
        </div>
        <div style={field}>
          <label htmlFor="pb-from">{t('Medir desde')}</label>
          <Select id="pb-from" disabled={!on} value={b.from} onChange={(_e, v) => set({ from: v.value as PageBorders['from'] })}>
            <option value="page">{t('El borde de la página')}</option>
            <option value="text">{t('El texto')}</option>
          </Select>
        </div>
        <div style={field}>
          <label htmlFor="pb-scope">{t('Aplicar a')}</label>
          <Select id="pb-scope" value={scope} onChange={(_e, v) => setScope(v.value as 'document' | 'section')}>
            <option value="document">{t('Todo el documento')}</option>
            <option value="section">{t('Esta sección')}</option>
          </Select>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ números de línea
export function LineNumbersDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const c = ui.ctl;
  const cur = c.currentSection().props.lineNumbers;
  const [on, setOn] = useState(!!cur);
  const [ln, setLn] = useState<LineNumbers>(cur ?? defaultLineNumbers());
  const [scope, setScope] = useState<'document' | 'section'>('section');
  const set = (patch: Partial<LineNumbers>) => setLn((x) => ({ ...x, ...patch }));
  const accept = () => {
    c.setSectionsProps({ lineNumbers: on ? { ...ln, countBy: Math.max(1, Math.round(ln.countBy)), start: Math.max(0, Math.round(ln.start)), distance: Math.max(0, ln.distance) } : null }, scope);
    onClose();
    focusDocSoon(ui);
  };
  return (
    <Modal
      title={t('Números de línea')}
      onClose={onClose}
      width={420}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" onClick={accept}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <Checkbox label={t('Agregar números de línea')} checked={on} onChange={(_e, v) => setOn(!!v.checked)} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
        <div style={field}>
          <label htmlFor="ln-start">{t('Empezar en')}</label>
          <Input id="ln-start" type="number" min={0} disabled={!on} value={String(ln.start)} onChange={(_e, v) => set({ start: num(v.value, 1) })} />
        </div>
        <div style={field}>
          <label htmlFor="ln-by">{t('Contar de')}</label>
          <Input id="ln-by" type="number" min={1} disabled={!on} value={String(ln.countBy)} onChange={(_e, v) => set({ countBy: num(v.value, 1) })} />
        </div>
        <div style={field}>
          <label htmlFor="ln-dist">{t('Desde el texto (pt)')}</label>
          <Input id="ln-dist" type="number" min={0} step={1} disabled={!on} value={String(ln.distance)} onChange={(_e, v) => set({ distance: num(v.value, 18) })} />
        </div>
        <div style={field}>
          <label htmlFor="ln-restart">{t('Numeración')}</label>
          <Select id="ln-restart" disabled={!on} value={ln.restart} onChange={(_e, v) => set({ restart: v.value as LineNumbers['restart'] })}>
            <option value="newPage">{t('Reiniciar en cada página')}</option>
            <option value="newSection">{t('Reiniciar en cada sección')}</option>
            <option value="continuous">{t('Continua')}</option>
          </Select>
        </div>
        <div style={field}>
          <label htmlFor="ln-scope">{t('Aplicar a')}</label>
          <Select id="ln-scope" value={scope} onChange={(_e, v) => setScope(v.value as 'document' | 'section')}>
            <option value="section">{t('Esta sección')}</option>
            <option value="document">{t('Todo el documento')}</option>
          </Select>
        </div>
      </div>
    </Modal>
  );
}
