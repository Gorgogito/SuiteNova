import { Button, Checkbox, Input, Select } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import {
  ENVELOPE_SIZES,
  LABEL_SHEETS,
  envelopeSection,
  guessAddressTemplate,
  labelSections,
  mergeDocument,
  mergeLabels,
  nodeTypes,
  previewText,
  ruleLabel,
  templateInline,
  templateParagraphs,
  writeDocx,
  type MailMergeData,
} from '@suitenova/writer-core';
import { useState } from 'react';
import { saveBytes } from '../fileio';
import type { WriterUI } from './commands';
import { Modal, field, focusDocSoon } from './dialogs';

const cellStyle: React.CSSProperties = { border: '1px solid var(--colorNeutralStroke2, #ccc)', padding: 0 };
const inputStyle: React.CSSProperties = { width: '100%', border: 0, padding: '3px 5px', background: 'transparent', color: 'inherit', font: 'inherit', boxSizing: 'border-box' };
const MAX_ROWS_SHOWN = 200;

// ------------------------------------------------------------------------------------------------ recipients

export function RecipientsDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const src = ui.ctl.mailMerge!;
  const [fields, setFields] = useState<string[]>([...src.fields]);
  const [records, setRecords] = useState<string[][]>(src.records.map((r) => [...r]));
  const setCell = (r: number, c: number, v: string) => setRecords((rs) => rs.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  const duplicated = fields.some((f, i) => !f.trim() || fields.findIndex((g) => g.trim().toLowerCase() === f.trim().toLowerCase()) !== i);
  return (
    <Modal
      title={t('Destinatarios de la combinación')}
      width={820}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={duplicated || !fields.length}
            onClick={() => {
              const clean = records.filter((r) => r.some((c) => c.trim() !== ''));
              ui.ctl.setMergeData({ ...src, fields: fields.map((f) => f.trim()), records: clean });
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <p style={{ margin: '0 0 6px' }}>
        {t('Origen: {s}', { s: src.source })} — {t('{n} destinatarios', { n: records.length })}
      </p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <Button size="small" onClick={() => setRecords((rs) => [...rs, fields.map(() => '')])}>
          {t('Agregar destinatario')}
        </Button>
        <Button
          size="small"
          onClick={() => {
            setFields((f) => [...f, `Campo${f.length + 1}`]);
            setRecords((rs) => rs.map((r) => [...r, '']));
          }}
        >
          {t('Agregar campo')}
        </Button>
      </div>
      {duplicated && <p role="alert" style={{ color: '#b00020', margin: '0 0 6px' }}>{t('Los nombres de campo no pueden estar vacíos ni repetirse.')}</p>}
      <div style={{ maxHeight: 340, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }} aria-label={t('Destinatarios')}>
          <thead>
            <tr>
              <th style={cellStyle} />
              {fields.map((f, c) => (
                <th key={c} style={cellStyle} scope="col">
                  <input style={{ ...inputStyle, fontWeight: 600 }} aria-label={t('Nombre del campo {n}', { n: c + 1 })} value={f} onChange={(e) => setFields((fs) => fs.map((x, i) => (i === c ? e.target.value : x)))} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.slice(0, MAX_ROWS_SHOWN).map((row, r) => (
              <tr key={r}>
                <td style={{ ...cellStyle, width: 28, textAlign: 'center' }}>
                  <button className="nw-x" aria-label={t('Quitar el destinatario {n}', { n: r + 1 })} title={t('Quitar')} onClick={() => setRecords((rs) => rs.filter((_x, i) => i !== r))} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }}>
                    ×
                  </button>
                </td>
                {fields.map((_f, c) => (
                  <td key={c} style={cellStyle}>
                    <input style={inputStyle} aria-label={`${fields[c]} ${r + 1}`} value={row[c] ?? ''} onChange={(e) => setCell(r, c, e.target.value)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {records.length > MAX_ROWS_SHOWN && <p style={{ margin: '6px 0 0', opacity: 0.8 }}>{t('Se muestran los primeros {n}; el resto se conserva.', { n: MAX_ROWS_SHOWN })}</p>}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ merge field, address block, rules

function useData(ui: WriterUI): MailMergeData {
  return ui.ctl.mailMerge!;
}

export function MergeFieldDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const data = useData(ui);
  const [name, setName] = useState(data.fields[0] ?? '');
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');
  return (
    <Modal
      title={t('Insertar campo combinado')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!name}
            onClick={() => {
              const sw = [before && `\\b "${before.replace(/"/g, "'")}"`, after && `\\f "${after.replace(/"/g, "'")}"`].filter(Boolean).join(' ');
              const v = ui.ctl.mainView;
              if (v) v.dispatch(v.state.tr.replaceSelectionWith(nodeTypes.field!.create({ kind: 'mergefield', arg: name, switches: sw || null }), true).scrollIntoView());
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Insertar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nw-mf-name">{t('Campo')}</label>
        <Select id="nw-mf-name" value={name} onChange={(_e, d) => setName(d.value)}>
          {data.fields.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
      </div>
      <div style={field}>
        <label htmlFor="nw-mf-before">{t('Texto antes (solo si el campo tiene valor)')}</label>
        <Input id="nw-mf-before" value={before} onChange={(_e, d) => setBefore(d.value)} />
      </div>
      <div style={field}>
        <label htmlFor="nw-mf-after">{t('Texto después (solo si el campo tiene valor)')}</label>
        <Input id="nw-mf-after" value={after} onChange={(_e, d) => setAfter(d.value)} />
      </div>
    </Modal>
  );
}

export function MergeBlockDialog({ ui, kind, onClose }: { ui: WriterUI; kind: 'address' | 'greeting'; onClose: () => void }) {
  const data = useData(ui);
  const nameField = data.fields.find((f) => /nombre|name/i.test(f)) ?? data.fields[0] ?? 'Nombre';
  const [text, setText] = useState(kind === 'address' ? guessAddressTemplate(data.fields) : `${t('Estimado/a')} {${nameField}}:`);
  const sample = data.records.length ? text.replace(/\{([^{}]+)\}/g, (_m, f: string) => previewText(nodeTypes.field!.create({ kind: 'mergefield', arg: f.trim(), switches: null }), data, 0)) : text;
  return (
    <Modal
      title={kind === 'address' ? t('Bloque de direcciones') : t('Línea de saludo')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!text.trim()}
            onClick={() => {
              const v = ctl_view(ui);
              if (v) v.dispatch(v.state.tr.replaceSelectionWith(nodeTypes.paragraph!.create(null, templateInline(text)), false).scrollIntoView());
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Insertar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nw-mb-text">{t('Escriba el texto y ponga los campos entre llaves, por ejemplo {Nombre}')}</label>
        <textarea id="nw-mb-text" className="nw-card-edit" style={{ minHeight: 90 }} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </div>
      <p style={{ margin: 0 }}>{t('Campos disponibles: {f}', { f: data.fields.map((f) => `{${f}}`).join(' ') })}</p>
      <div className="nw-eq-preview" style={{ justifyContent: 'flex-start', fontSize: '1em', whiteSpace: 'pre-line' }} aria-label={t('Vista previa')}>
        {sample}
      </div>
    </Modal>
  );
}

const ctl_view = (ui: WriterUI) => ui.ctl.mainView;

export function MergeRuleDialog({ ui, rule, onClose }: { ui: WriterUI; rule: 'IF' | 'SKIPIF' | 'NEXTIF'; onClose: () => void }) {
  const data = useData(ui);
  const [f, setF] = useState(data.fields[0] ?? '');
  const [op, setOp] = useState('=');
  const [value, setValue] = useState('');
  const [yes, setYes] = useState('');
  const [no, setNo] = useState('');
  const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
  return (
    <Modal
      title={rule === 'IF' ? t('Si… entonces… si no…') : rule === 'SKIPIF' ? t('Saltar registro si…') : t('Siguiente registro si…')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!f}
            onClick={() => {
              const cond = `${/\s/.test(f) ? q(f) : f} ${op} ${q(value)}`;
              const switches = rule === 'IF' ? `${cond} ${q(yes)} ${q(no)}` : cond;
              const v = ui.ctl.mainView;
              if (v) v.dispatch(v.state.tr.replaceSelectionWith(nodeTypes.field!.create({ kind: 'merge-rule', arg: rule, switches, result: ruleLabel(rule, switches) }), true).scrollIntoView());
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Insertar')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 1fr', gap: 8 }}>
        <div style={field}>
          <label htmlFor="nw-mr-f">{t('Campo')}</label>
          <Select id="nw-mr-f" value={f} onChange={(_e, d) => setF(d.value)}>
            {data.fields.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
        </div>
        <div style={field}>
          <label htmlFor="nw-mr-op">{t('Comparación')}</label>
          <Select id="nw-mr-op" value={op} onChange={(_e, d) => setOp(d.value)}>
            <option value="=">{t('es igual a')}</option>
            <option value="<>">{t('no es igual a')}</option>
            <option value="<">{t('es menor que')}</option>
            <option value=">">{t('es mayor que')}</option>
            <option value="<=">{t('es menor o igual que')}</option>
            <option value=">=">{t('es mayor o igual que')}</option>
          </Select>
        </div>
        <div style={field}>
          <label htmlFor="nw-mr-v">{t('Valor')}</label>
          <Input id="nw-mr-v" value={value} onChange={(_e, d) => setValue(d.value)} />
        </div>
      </div>
      {rule === 'IF' && (
        <>
          <div style={field}>
            <label htmlFor="nw-mr-yes">{t('Insertar este texto si se cumple')}</label>
            <Input id="nw-mr-yes" value={yes} onChange={(_e, d) => setYes(d.value)} />
          </div>
          <div style={field}>
            <label htmlFor="nw-mr-no">{t('Insertar este otro texto si no se cumple')}</label>
            <Input id="nw-mr-no" value={no} onChange={(_e, d) => setNo(d.value)} />
          </div>
        </>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ finish

export function FinishMergeDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const ctl = ui.ctl;
  const data = useData(ui);
  const n = data.records.length;
  const [range, setRange] = useState<'all' | 'current' | 'some'>('all');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(n);
  const [kind, setKind] = useState<MailMergeData['kind']>(data.kind === 'directory' ? 'directory' : 'letters');
  const [out, setOut] = useState<'here' | 'file'>('here');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const a = range === 'all' ? 0 : range === 'current' ? ctl.mergePreview.index : Math.max(0, from - 1);
  const b = range === 'all' ? n - 1 : range === 'current' ? ctl.mergePreview.index : Math.min(n - 1, to - 1);
  const run = async () => {
    setBusy(true);
    try {
      const r = mergeDocument(ctl.body, data, a, b, kind);
      if (!r.count) {
        setMsg(t('Ningún registro cumple las condiciones del documento.'));
        setBusy(false);
        return;
      }
      if (out === 'here') {
        ctl.replaceBody(r.body);
        onClose();
        focusDocSoon(ui);
      } else {
        const wd = { ...ctl.toWriterDoc(), body: r.body, mailMerge: null };
        const { data: bytes } = await writeDocx(wd);
        const base = (ctl.fileName ?? 'Documento1').replace(/\.[^.]+$/, '');
        const saved = await saveBytes(`${base} (combinado).docx`, bytes, [{ name: 'Documento de Word', extensions: ['docx'] }]);
        if (saved) onClose();
        else setBusy(false);
      }
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Finalizar y combinar')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={busy || a > b} onClick={() => void run()}>
            {t('Combinar')}
          </Button>
        </>
      }
    >
      <fieldset style={{ border: 0, padding: 0, margin: '0 0 10px' }}>
        <legend style={{ fontWeight: 600 }}>{t('Registros')}</legend>
        {(['all', 'current', 'some'] as const).map((r) => (
          <label key={r} style={{ display: 'block' }}>
            <input type="radio" name="nw-fm-range" checked={range === r} onChange={() => setRange(r)} />{' '}
            {r === 'all' ? t('Todos ({n})', { n }) : r === 'current' ? t('El de la vista previa (registro {i})', { i: ctl.mergePreview.index + 1 }) : t('Desde')}
            {r === 'some' && (
              <>
                {' '}
                <input aria-label={t('Desde')} type="number" min={1} max={n} value={from} style={{ width: 70 }} onChange={(e) => { setRange('some'); setFrom(Number(e.target.value) || 1); }} /> {t('hasta')}{' '}
                <input aria-label={t('hasta')} type="number" min={1} max={n} value={to} style={{ width: 70 }} onChange={(e) => { setRange('some'); setTo(Number(e.target.value) || n); }} />
              </>
            )}
          </label>
        ))}
      </fieldset>
      <div style={field}>
        <label htmlFor="nw-fm-kind">{t('Tipo de documento')}</label>
        <Select id="nw-fm-kind" value={kind} onChange={(_e, d) => setKind(d.value as MailMergeData['kind'])}>
          <option value="letters">{t('Cartas: cada registro empieza en una página nueva')}</option>
          <option value="directory">{t('Directorio: los registros van uno a continuación del otro')}</option>
        </Select>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600 }}>{t('Resultado')}</legend>
        <label style={{ display: 'block' }}>
          <input type="radio" name="nw-fm-out" checked={out === 'here'} onChange={() => setOut('here')} /> {t('Abrirlo aquí, en lugar de este documento (se puede deshacer con Ctrl+Z)')}
        </label>
        <label style={{ display: 'block' }}>
          <input type="radio" name="nw-fm-out" checked={out === 'file'} onChange={() => setOut('file')} /> {t('Guardarlo como un archivo .docx nuevo')}
        </label>
      </fieldset>
      {msg && <p role="alert" style={{ color: '#b00020' }}>{msg}</p>}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ envelopes and labels

export function EnvelopeDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const ctl = ui.ctl;
  const data = ctl.mailMerge;
  const st = ctl.mainState;
  const selected = st && !st.selection.empty ? st.doc.textBetween(st.selection.from, st.selection.to, '\n', '\n') : '';
  const [size, setSize] = useState(ENVELOPE_SIZES[0]!.id);
  const [sender, setSender] = useState(ctl.author ?? '');
  const [recipient, setRecipient] = useState(selected || (data ? guessAddressTemplate(data.fields) : ''));
  return (
    <Modal
      title={t('Sobres')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            onClick={() => {
              const sz = ENVELOPE_SIZES.find((s) => s.id === size)!;
              ctl.insertSectionFirst(envelopeSection(sz, templateParagraphs(sender), templateParagraphs(recipient)));
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Agregar al documento')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nw-env-size">{t('Tamaño del sobre')}</label>
        <Select id="nw-env-size" value={size} onChange={(_e, d) => setSize(d.value)}>
          {ENVELOPE_SIZES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      <div style={field}>
        <label htmlFor="nw-env-to">{t('Destinatario')}{data ? ` — ${t('puede usar campos como {0}', { 0: `{${data.fields[0]}}` })}` : ''}</label>
        <textarea id="nw-env-to" className="nw-card-edit" style={{ minHeight: 80 }} value={recipient} onChange={(e) => setRecipient(e.target.value)} />
      </div>
      <div style={field}>
        <label htmlFor="nw-env-from">{t('Remitente')}</label>
        <textarea id="nw-env-from" className="nw-card-edit" style={{ minHeight: 64 }} value={sender} onChange={(e) => setSender(e.target.value)} />
      </div>
      <p style={{ margin: 0, opacity: 0.85 }}>{t('El sobre se agrega como primera página, con su propio tamaño de papel.')}</p>
    </Modal>
  );
}

export function LabelsDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const ctl = ui.ctl;
  const data = ctl.mailMerge;
  const [sheetId, setSheetId] = useState(LABEL_SHEETS[0]!.id);
  const [text, setText] = useState(data ? guessAddressTemplate(data.fields) : '');
  const [repeat, setRepeat] = useState(!data || !data.records.length);
  return (
    <Modal
      title={t('Etiquetas')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!text.trim()}
            onClick={() => {
              const sheet = LABEL_SHEETS.find((s) => s.id === sheetId)!;
              const body = repeat || !data ? labelSections(sheet, sheet.cols * sheet.rows, () => templateParagraphs(text)) : mergeLabels(templateParagraphs(text), data, sheet);
              ctl.replaceBody(body);
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Crear etiquetas')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nw-lb-sheet">{t('Tipo de hoja')}</label>
        <Select id="nw-lb-sheet" value={sheetId} onChange={(_e, d) => setSheetId(d.value)}>
          {LABEL_SHEETS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      <div style={field}>
        <label htmlFor="nw-lb-text">{t('Texto de la etiqueta')}{data ? ` — ${t('campos como {0}', { 0: `{${data.fields[0]}}` })}` : ''}</label>
        <textarea id="nw-lb-text" className="nw-card-edit" style={{ minHeight: 90 }} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {data && data.records.length > 0 && <Checkbox checked={repeat} onChange={(_e, d) => setRepeat(!!d.checked)} label={t('La misma etiqueta en toda la hoja (sin usar la lista de destinatarios)')} />}
      <p style={{ margin: '8px 0 0', opacity: 0.85 }}>{t('Reemplaza el contenido del documento; se puede deshacer con Ctrl+Z.')}</p>
    </Modal>
  );
}
