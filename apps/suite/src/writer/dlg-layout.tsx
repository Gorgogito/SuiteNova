import { Button, Checkbox, Input, Select } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useState } from 'react';
import type { WriterUI } from './commands';
import { defaultWatermark } from './commands-layout';
import { Modal, field, focusDocSoon } from './dialogs';
import { setColumns } from './sections-edit';

const PT_PER_CM = 72 / 2.54;
const cm = (pt: number) => Math.round((pt / PT_PER_CM) * 100) / 100;

export function ColumnsDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const sec = ui.ctl.currentSection();
  const cur = sec.props.cols;
  const page = sec.props.page;
  const total = page.width - page.marginLeft - page.marginRight;
  const [count, setCount] = useState(cur.count);
  const [equal, setEqual] = useState(!cur.widths);
  const [space, setSpace] = useState(cm(cur.space));
  const [sep, setSep] = useState(cur.sep);
  const [widths, setWidths] = useState<number[]>(() => (cur.widths ?? Array.from({ length: Math.max(cur.count, 2) }, () => (total - cur.space * (Math.max(cur.count, 2) - 1)) / Math.max(cur.count, 2))).map(cm));
  const [scope, setScope] = useState<'section' | 'selection'>(ui.ctl.mainState && !ui.ctl.mainState.selection.empty ? 'selection' : 'section');
  const spaceOk = Number.isFinite(space) && space >= 0;
  const usable = total / PT_PER_CM - space * (count - 1);
  const widthsOk = equal || (widths.slice(0, count).every((w) => w > 0.5) && Math.abs(widths.slice(0, count).reduce((a, b) => a + b, 0) - usable) < 0.3);
  const ok = count >= 1 && count <= 12 && spaceOk && widthsOk;
  const preset = (n: number, w: number[] | null) => {
    setCount(n);
    setEqual(!w);
    if (w) setWidths(w.map((x) => Math.round(((x * usable) / PT_PER_CM / (usable / PT_PER_CM)) * 100) / 100));
  };
  void preset;
  return (
    <Modal
      title={t('Columnas')}
      width={520}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!ok}
            onClick={() => {
              const v = ui.ctl.mainView;
              if (!v) return;
              const w = equal ? null : widths.slice(0, count).map((x) => x * PT_PER_CM);
              setColumns({ count, space: space * PT_PER_CM, sep, widths: w }, scope === 'selection')(v.state, v.dispatch);
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {[1, 2, 3].map((n) => (
          <Button key={n} appearance={count === n && equal ? 'primary' : 'secondary'} onClick={() => { setCount(n); setEqual(true); }}>
            {n === 1 ? t('Una') : n === 2 ? t('Dos') : t('Tres')}
          </Button>
        ))}
        <Button appearance={count === 2 && !equal ? 'primary' : 'secondary'} onClick={() => { setCount(2); setEqual(false); setWidths([cm(usable * PT_PER_CM / 3), cm((usable * PT_PER_CM * 2) / 3)].map((x) => x)); }}>
          {t('Izquierda')}
        </Button>
        <Button appearance={count === 2 && !equal ? 'secondary' : 'secondary'} onClick={() => { setCount(2); setEqual(false); setWidths([cm((usable * PT_PER_CM * 2) / 3), cm(usable * PT_PER_CM / 3)]); }}>
          {t('Derecha')}
        </Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        <div style={field}>
          <label htmlFor="nw-cols-n">{t('Número de columnas')}</label>
          <Input id="nw-cols-n" type="number" min={1} max={12} value={String(count)} onChange={(_e, d) => setCount(Math.max(1, Math.min(12, Math.round(Number(d.value) || 1))))} />
        </div>
        <div style={field}>
          <label htmlFor="nw-cols-space">{t('Espaciado (cm)')}</label>
          <Input id="nw-cols-space" type="number" step={0.1} value={String(space)} onChange={(_e, d) => setSpace(Number(d.value.replace(',', '.')))} />
        </div>
      </div>
      <Checkbox checked={sep} onChange={(_e, d) => setSep(!!d.checked)} label={t('Línea entre columnas')} />
      <Checkbox checked={equal} onChange={(_e, d) => setEqual(!!d.checked)} label={t('Columnas del mismo ancho')} />
      {!equal && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0 12px', marginTop: 8 }}>
          {Array.from({ length: count }, (_, i) => (
            <div style={field} key={i}>
              <label htmlFor={`nw-cols-w${i}`}>{t('Ancho {n} (cm)', { n: i + 1 })}</label>
              <Input id={`nw-cols-w${i}`} type="number" step={0.1} value={String(widths[i] ?? 3)} onChange={(_e, d) => setWidths((o) => { const c = [...o]; c[i] = Number(d.value.replace(',', '.')); return c; })} />
            </div>
          ))}
          {!widthsOk && <span role="alert" style={{ gridColumn: '1 / -1' }}>{t('Los anchos más el espaciado deben sumar el ancho del texto ({w} cm).', { w: (usable + space * (count - 1)).toFixed(2) })}</span>}
        </div>
      )}
      <div style={{ ...field, marginTop: 10 }}>
        <label htmlFor="nw-cols-scope">{t('Aplicar a')}</label>
        <Select id="nw-cols-scope" value={scope} onChange={(_e, d) => setScope(d.value as 'section' | 'selection')}>
          <option value="section">{t('Esta sección')}</option>
          <option value="selection" disabled={!ui.ctl.mainState || ui.ctl.mainState.selection.empty}>
            {t('El texto seleccionado')}
          </option>
        </Select>
      </div>
      <p style={{ fontSize: 12, margin: 0 }}>{t('Las columnas de distinto ancho se dibujan con el mismo ancho en pantalla; el ancho se conserva en el archivo.')}</p>
    </Modal>
  );
}

export function WatermarkDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const cur = ui.ctl.watermark ?? defaultWatermark('');
  const [kind, setKind] = useState<'text' | 'image'>(cur.image ? 'image' : 'text');
  const [text, setText] = useState(cur.text ?? 'CONFIDENCIAL');
  const [font, setFont] = useState(cur.font);
  const [size, setSize] = useState(cur.size);
  const [color, setColor] = useState(cur.color);
  const [semi, setSemi] = useState(cur.semitransparent);
  const [layout, setLayout] = useState<'diagonal' | 'horizontal'>(cur.layout);
  const [image, setImage] = useState<string | null>(cur.image);
  const [scale, setScale] = useState(cur.scale);
  const ok = kind === 'text' ? text.trim().length > 0 : !!image;
  const pick = (file: File | undefined) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => setImage(String(r.result));
    r.readAsDataURL(file);
  };
  return (
    <Modal
      title={t('Marca de agua')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={() => { ui.ctl.setWatermark(null); onClose(); focusDocSoon(ui); }}>{t('Quitar marca de agua')}</Button>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!ok}
            onClick={() => {
              ui.ctl.setWatermark({ text: kind === 'text' ? text.trim() : null, image: kind === 'image' ? image : null, font, color, size, semitransparent: semi, layout, scale });
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nw-wm-kind">{t('Tipo')}</label>
        <Select id="nw-wm-kind" value={kind} onChange={(_e, d) => setKind(d.value as 'text' | 'image')}>
          <option value="text">{t('Marca de agua de texto')}</option>
          <option value="image">{t('Marca de agua de imagen')}</option>
        </Select>
      </div>
      {kind === 'text' ? (
        <>
          <div style={field}>
            <label htmlFor="nw-wm-text">{t('Texto')}</label>
            <Input id="nw-wm-text" value={text} onChange={(_e, d) => setText(d.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <div style={field}>
              <label htmlFor="nw-wm-font">{t('Fuente')}</label>
              <Select id="nw-wm-font" value={font} onChange={(_e, d) => setFont(d.value)}>
                {['Calibri', 'Arial', 'Times New Roman', 'Verdana', 'Georgia', 'Courier New'].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </Select>
            </div>
            <div style={field}>
              <label htmlFor="nw-wm-size">{t('Tamaño (pt, 0 = automático)')}</label>
              <Input id="nw-wm-size" type="number" min={0} value={String(size)} onChange={(_e, d) => setSize(Math.max(0, Number(d.value) || 0))} />
            </div>
            <div style={field}>
              <label htmlFor="nw-wm-color">{t('Color')}</label>
              <input id="nw-wm-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={field}>
            <label htmlFor="nw-wm-img">{t('Imagen')}</label>
            <input id="nw-wm-img" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" onChange={(e) => pick(e.target.files?.[0])} />
            {image && <img alt="" src={image} style={{ maxHeight: 80, maxWidth: 160 }} />}
          </div>
          <div style={field}>
            <label htmlFor="nw-wm-scale">{t('Escala (%)')}</label>
            <Input id="nw-wm-scale" type="number" min={5} max={500} value={String(scale)} onChange={(_e, d) => setScale(Math.max(5, Math.min(500, Number(d.value) || 100)))} />
          </div>
        </>
      )}
      <Checkbox checked={semi} onChange={(_e, d) => setSemi(!!d.checked)} label={t('Semitransparente')} />
      <div style={{ ...field, marginTop: 8 }}>
        <label htmlFor="nw-wm-layout">{t('Disposición')}</label>
        <Select id="nw-wm-layout" value={layout} onChange={(_e, d) => setLayout(d.value as 'diagonal' | 'horizontal')}>
          <option value="diagonal">{t('Diagonal')}</option>
          <option value="horizontal">{t('Horizontal')}</option>
        </Select>
      </div>
    </Modal>
  );
}
