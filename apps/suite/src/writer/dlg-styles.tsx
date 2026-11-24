import { Button, Checkbox, Input, Select } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { PARAGRAPH_STYLES, styleClass, styleCss, type ParagraphStyleDef } from '@suitenova/writer-core';
import { useState } from 'react';
import type { WriterUI } from './commands';
import { FONT_NAMES } from './commands';
import { Modal, field, focusDocSoon } from './dialogs';
import { setStyle } from './editing';

const PT_PER_CM = 28.3465;
const num = (s: string, fallback: number): number => {
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : fallback;
};
const isBuiltin = (id: string) => PARAGRAPH_STYLES.some((s) => s.id === id);

/** Muestra de un estilo con su propio aspecto. */
function Preview({ def, ui, text }: { def: ParagraphStyleDef; ui: WriterUI; text?: string }) {
  return (
    <div className="nw-doc" style={{ pointerEvents: 'none' }}>
      <style>{styleCss([def], ui.ctl.defaults, ui.ctl.theme)}</style>
      <p className={`nw-p ${styleClass(def.id)}`} style={{ margin: 0 }}>
        {text ?? def.name}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ nuevo / modificar
export function StyleEditDialog({ ui, id, onClose }: { ui: WriterUI; id: string | null; onClose: () => void }) {
  const c = ui.ctl;
  const existing = id ? c.styles.find((s) => s.id === id) : undefined;
  const [def, setDef] = useState<ParagraphStyleDef>(() => (existing ? { ...existing } : c.styleFromSelection(t('Estilo nuevo'))));
  const [error, setError] = useState('');
  const [cm, setCm] = useState(String(Math.round(((def.indentLeft ?? 0) / PT_PER_CM) * 100) / 100));
  const set = (patch: Partial<ParagraphStyleDef>) => setDef((d) => ({ ...d, ...patch }));
  const clean = <K extends keyof ParagraphStyleDef>(k: K, v: ParagraphStyleDef[K] | undefined | false | '') => set({ [k]: v === false || v === '' || v === undefined ? undefined : v } as Partial<ParagraphStyleDef>);
  const save = () => {
    const name = def.name.trim();
    if (!name) return setError(t('El estilo necesita un nombre.'));
    if (!existing && c.styles.some((s) => s.name.toLowerCase() === name.toLowerCase())) return setError(t('Ya existe un estilo con ese nombre.'));
    const out = { ...def, name, indentLeft: Math.round(num(cm, 0) * PT_PER_CM * 10) / 10 || undefined };
    if (existing) c.upsertStyle({ ...out, id: existing.id });
    else {
      const created = c.addStyle(out);
      // un estilo nuevo se aplica al párrafo en el que está el cursor
      const v = c.view;
      if (v) setStyle(created.id)(v.state, v.dispatch);
    }
    onClose();
    focusDocSoon(ui);
  };
  const others = c.styles.filter((s) => !s.hidden && s.id !== def.id);
  return (
    <Modal
      title={existing ? t('Modificar estilo') : t('Crear un estilo')}
      onClose={onClose}
      width={560}
      actions={
        <>
          {existing && isBuiltin(existing.id) && (
            <Button
              onClick={() => {
                c.resetStyle(existing.id);
                onClose();
              }}
            >
              {t('Restablecer')}
            </Button>
          )}
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" onClick={save}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={field}>
          <label htmlFor="st-name">{t('Nombre')}</label>
          <Input id="st-name" value={def.name} disabled={!!existing && isBuiltin(existing.id)} onChange={(_e, v) => { set({ name: v.value }); setError(''); }} />
        </div>
        <div style={field}>
          <label htmlFor="st-next">{t('Estilo del párrafo siguiente')}</label>
          <Select id="st-next" value={def.next ?? ''} onChange={(_e, v) => clean('next', v.value)}>
            <option value="">{t('(el mismo estilo)')}</option>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {t(s.name)}
              </option>
            ))}
          </Select>
        </div>
        <div style={field}>
          <label htmlFor="st-font">{t('Fuente')}</label>
          <Select id="st-font" value={def.fontFamily ?? ''} onChange={(_e, v) => clean('fontFamily', v.value)}>
            <option value="">{t('(la del documento)')}</option>
            {[...new Set([def.fontFamily, ...FONT_NAMES].filter(Boolean) as string[])].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </div>
        <div style={field}>
          <label htmlFor="st-size">{t('Tamaño (pt)')}</label>
          <Input id="st-size" type="number" min={1} step={0.5} placeholder={String(c.defaults.fontSize)} value={def.fontSize === undefined ? '' : String(def.fontSize)} onChange={(_e, v) => clean('fontSize', v.value ? num(v.value, c.defaults.fontSize) : undefined)} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <Checkbox label={t('Negrita')} checked={!!def.bold} onChange={(_e, v) => clean('bold', !!v.checked || undefined)} />
        <Checkbox label={t('Cursiva')} checked={!!def.italic} onChange={(_e, v) => clean('italic', !!v.checked || undefined)} />
        <Checkbox label={t('Subrayado')} checked={!!def.underline} onChange={(_e, v) => clean('underline', !!v.checked || undefined)} />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {t('Color de fuente')} <input type="color" aria-label={t('Color de fuente')} value={def.color ?? '#000000'} onChange={(e) => set({ color: e.target.value })} />
          <Button size="small" onClick={() => set({ color: undefined })}>
            {t('Automático')}
          </Button>
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div style={field}>
          <label htmlFor="st-al">{t('Alineación')}</label>
          <Select id="st-al" value={def.align ?? ''} onChange={(_e, v) => clean('align', (v.value || undefined) as ParagraphStyleDef['align'])}>
            <option value="">{t('(izquierda)')}</option>
            <option value="center">{t('Centrada')}</option>
            <option value="right">{t('Derecha')}</option>
            <option value="justify">{t('Justificada')}</option>
          </Select>
        </div>
        <div style={field}>
          <label htmlFor="st-ind">{t('Sangría izquierda (cm)')}</label>
          <Input id="st-ind" type="number" step={0.25} min={0} value={cm} onChange={(_e, v) => setCm(v.value)} />
        </div>
        <div style={field}>
          <label htmlFor="st-lh">{t('Interlineado (líneas)')}</label>
          <Input id="st-lh" type="number" step={0.05} min={0.5} placeholder={String(c.defaults.lineHeight)} value={def.lineHeight === undefined ? '' : String(def.lineHeight)} onChange={(_e, v) => clean('lineHeight', v.value ? num(v.value, 1) : undefined)} />
        </div>
        <div style={field}>
          <label htmlFor="st-sb">{t('Espacio anterior (pt)')}</label>
          <Input id="st-sb" type="number" step={1} min={0} value={def.spaceBefore === undefined ? '' : String(def.spaceBefore)} onChange={(_e, v) => clean('spaceBefore', v.value ? num(v.value, 0) : undefined)} />
        </div>
        <div style={field}>
          <label htmlFor="st-sa">{t('Espacio posterior (pt)')}</label>
          <Input id="st-sa" type="number" step={1} min={0} value={def.spaceAfter === undefined ? '' : String(def.spaceAfter)} onChange={(_e, v) => clean('spaceAfter', v.value ? num(v.value, 0) : undefined)} />
        </div>
      </div>
      <div aria-label={t('Vista previa')} style={{ border: '1px solid var(--colorNeutralStroke2)', borderRadius: 6, padding: 12, marginTop: 6 }}>
        <Preview def={{ ...def, indentLeft: num(cm, 0) * PT_PER_CM }} ui={ui} text={t('Texto de ejemplo con este estilo')} />
      </div>
      {error && (
        <p role="alert" style={{ color: 'var(--colorPaletteRedForeground1)' }}>
          {error}
        </p>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ panel
export function StylesDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const c = ui.ctl;
  const current = (c.state && c.currentStyleId()) || 'Normal';
  const [picked, setPicked] = useState(current);
  const [, bump] = useState(0);
  const list = c.styles.filter((s) => !s.hidden);
  const sel = list.find((s) => s.id === picked) ?? list[0]!;
  const apply = (id: string) => {
    const v = c.view;
    if (v) setStyle(id)(v.state, v.dispatch);
    onClose();
    focusDocSoon(ui);
  };
  return (
    <Modal
      title={t('Estilos')}
      onClose={onClose}
      width={680}
      actions={
        <>
          <Button onClick={() => ui.openDialog('styleEdit', { id: null })}>{t('Nuevo estilo…')}</Button>
          <Button onClick={() => ui.openDialog('styleEdit', { id: sel.id })}>{t('Modificar…')}</Button>
          {isBuiltin(sel.id) ? (
            <Button
              onClick={() => {
                c.resetStyle(sel.id);
                bump((n) => n + 1);
              }}
            >
              {t('Restablecer')}
            </Button>
          ) : (
            <Button
              onClick={() => {
                c.deleteStyle(sel.id);
                setPicked('Normal');
              }}
            >
              {t('Eliminar')}
            </Button>
          )}
          <Button appearance="primary" onClick={() => apply(sel.id)}>
            {t('Aplicar')}
          </Button>
          <Button onClick={onClose}>{t('Cerrar')}</Button>
        </>
      }
    >
      <div role="listbox" aria-label={t('Estilos del documento')} style={{ maxHeight: 340, overflow: 'auto', border: '1px solid var(--colorNeutralStroke2)', borderRadius: 6 }}>
        {list.map((s) => (
          <div
            key={s.id}
            role="option"
            aria-selected={s.id === sel.id}
            tabIndex={0}
            onClick={() => setPicked(s.id)}
            onDoubleClick={() => apply(s.id)}
            onKeyDown={(e) => e.key === 'Enter' && apply(s.id)}
            style={{ padding: '4px 10px', cursor: 'pointer', background: s.id === sel.id ? 'var(--colorBrandBackground2)' : undefined, borderBottom: '1px solid var(--colorNeutralStroke3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
          >
            <Preview def={s} ui={ui} text={t(s.name)} />
            <small style={{ whiteSpace: 'nowrap', color: 'var(--colorNeutralForeground3)' }}>{s.id === current ? t('en uso') : isBuiltin(s.id) ? '' : t('propio')}</small>
          </div>
        ))}
      </div>
    </Modal>
  );
}
