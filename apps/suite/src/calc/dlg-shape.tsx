import { Button, Checkbox, Input, Select, Textarea } from '@fluentui/react-components';
import { SHAPE_FILL, SHAPE_LINE, shapeLook, type SheetShape } from '@suitenova/calc-engine';
import { t } from '@suitenova/core-ui';
import { isLineKind } from '@suitenova/shapes-core';
import { useState } from 'react';
import type { CalcUI } from './commands';
import { Modal, field, row2 } from './modal';

/** Cuadro «Formato de forma»: relleno, contorno, texto y nombre. */
export function ShapeFormatDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const shape = d.sheet.shapes.find((s) => s.id === d.x.selectedShape);
  const [s, setS] = useState<SheetShape | null>(() => (shape ? structuredClone(shape) : null));
  if (!shape || !s) return null;
  const look = shapeLook(s);
  const set = (patch: Partial<SheetShape>) => setS((x) => (x ? { ...x, ...patch } : x));
  const isLine = isLineKind(s.kind);
  return (
    <Modal
      title={t('Formato de forma')}
      onClose={onClose}
      width={560}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            onClick={() => {
              const { id, ...rest } = s;
              void id;
              d.x.updateShape(shape.id, rest, 'Formato de forma');
              onClose();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={row2}>
        {!isLine && (
          <div style={field}>
            <label>{t('Relleno')}</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Checkbox label={t('Sin relleno')} checked={look.fill === null} onChange={(_e, v) => set({ fill: v.checked ? null : (shape.fill ?? SHAPE_FILL) })} />
              <input type="color" aria-label={t('Color de relleno')} disabled={look.fill === null} value={look.fill ?? SHAPE_FILL} onChange={(e) => set({ fill: e.target.value })} />
            </div>
          </div>
        )}
        <div style={field}>
          <label>{t('Contorno')}</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Checkbox label={t('Sin contorno')} checked={look.line === null} onChange={(_e, v) => set({ line: v.checked ? null : { color: SHAPE_LINE, width: 1 } })} />
            <input type="color" aria-label={t('Color del contorno')} disabled={look.line === null} value={look.line?.color ?? SHAPE_LINE} onChange={(e) => set({ line: { ...(s.line ?? {}), color: e.target.value } })} />
            <Input
              type="number"
              aria-label={t('Grosor del contorno')}
              style={{ width: 80 }}
              min={0.25}
              step={0.25}
              disabled={look.line === null}
              value={String(look.line?.width ?? 1)}
              onChange={(_e, v) => set({ line: { ...(s.line ?? {}), width: Math.max(0.25, Number(v.value) || 1) } })}
            />
          </div>
        </div>
      </div>
      {!isLine && (
        <>
          <div style={field}>
            <label htmlFor="sh-text">{t('Texto')}</label>
            <Textarea id="sh-text" rows={3} value={s.text ?? ''} onChange={(_e, v) => set({ text: v.value || undefined })} />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <label>
              {t('Tamaño')} <Input type="number" style={{ width: 70 }} aria-label={t('Tamaño de la fuente')} value={String(s.fontSize ?? 11)} onChange={(_e, v) => set({ fontSize: Math.min(96, Math.max(6, Number(v.value) || 11)) })} />
            </label>
            <label>
              {t('Color del texto')} <input type="color" aria-label={t('Color del texto')} value={s.textColor ?? '#000000'} onChange={(e) => set({ textColor: e.target.value })} />
            </label>
            <Checkbox label={t('Negrita')} checked={!!s.bold} onChange={(_e, v) => set({ bold: v.checked ? true : undefined })} />
            <Checkbox label={t('Cursiva')} checked={!!s.italic} onChange={(_e, v) => set({ italic: v.checked ? true : undefined })} />
          </div>
          <div style={row2}>
            <div style={field}>
              <label htmlFor="sh-h">{t('Alineación horizontal')}</label>
              <Select id="sh-h" value={s.hAlign ?? (s.kind === 'textBox' ? 'left' : 'center')} onChange={(_e, v) => set({ hAlign: v.value as 'left' | 'center' | 'right' })}>
                <option value="left">{t('Izquierda')}</option>
                <option value="center">{t('Centrada')}</option>
                <option value="right">{t('Derecha')}</option>
              </Select>
            </div>
            <div style={field}>
              <label htmlFor="sh-v">{t('Alineación vertical')}</label>
              <Select id="sh-v" value={s.vAlign ?? (s.kind === 'textBox' ? 'top' : 'middle')} onChange={(_e, v) => set({ vAlign: v.value as 'top' | 'middle' | 'bottom' })}>
                <option value="top">{t('Arriba')}</option>
                <option value="middle">{t('Centro')}</option>
                <option value="bottom">{t('Abajo')}</option>
              </Select>
            </div>
          </div>
        </>
      )}
      <div style={field}>
        <label htmlFor="sh-rot">{t('Rotación (grados)')}</label>
        <Input id="sh-rot" type="number" style={{ width: 90 }} min={0} max={359} value={String(s.rotation ?? 0)} onChange={(_e, v) => set({ rotation: ((((Number(v.value) || 0) % 360) + 360) % 360) || undefined })} />
      </div>
      <div style={field}>
        <label htmlFor="sh-name">{t('Nombre')}</label>
        <Input id="sh-name" value={s.name ?? ''} onChange={(_e, v) => set({ name: v.value || undefined })} />
      </div>
      <div style={field}>
        <label htmlFor="sh-alt">{t('Texto alternativo (lo leen los lectores de pantalla)')}</label>
        <Input id="sh-alt" value={s.alt ?? ''} onChange={(_e, v) => set({ alt: v.value || undefined })} />
      </div>
    </Modal>
  );
}
