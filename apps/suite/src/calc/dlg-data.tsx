import { Button, Checkbox, Input, Select, Tab, TabList, Textarea } from '@fluentui/react-components';
import { canonicalFormula, localizeFormula, newValidation, normRect, parseFormula, safeUrl, type DataValidation, type ValidationOp, type ValidationType } from '@suitenova/calc-engine';
import { t } from '@suitenova/core-ui';
import { useState, useSyncExternalStore } from 'react';
import type { CalcUI } from './commands';
import { ENTRY_PENDING } from './doc-objects';
import { Modal, field, row2 } from './modal';

// -------------------------------------------------------------------------------------------- data validation
const TYPES: [ValidationType, string][] = [
  ['any', 'Cualquier valor'],
  ['whole', 'Número entero'],
  ['decimal', 'Decimal'],
  ['list', 'Lista'],
  ['date', 'Fecha'],
  ['time', 'Hora'],
  ['textLength', 'Longitud del texto'],
  ['custom', 'Personalizada'],
];
const OPS: [ValidationOp, string][] = [
  ['between', 'entre'],
  ['notBetween', 'no está entre'],
  ['equal', 'igual a'],
  ['notEqual', 'no igual a'],
  ['greaterThan', 'mayor que'],
  ['lessThan', 'menor que'],
  ['greaterThanOrEqual', 'mayor o igual que'],
  ['lessThanOrEqual', 'menor o igual que'],
];

/** The text of a rule's formula as the user types it in the interface language. */
function shown(canon: string | undefined, locale: 'es' | 'en', list: boolean): string {
  if (!canon) return '';
  if (list) {
    try {
      const n = parseFormula(canon);
      if (n.t === 'str') return n.v.split(',').join(locale === 'es' ? ';' : ',');
    } catch {
      // a formula: shown below
    }
    return `=${localizeFormula(canon, locale)}`;
  }
  return localizeFormula(canon, locale);
}

/** What the user typed -> the canonical formula text stored in the rule. */
function stored(text: string, locale: 'es' | 'en', list: boolean): string {
  const raw = text.trim();
  if (!list) return canonicalFormula(raw.replace(/^=/, ''), locale);
  if (raw.startsWith('=')) return canonicalFormula(raw.slice(1), locale);
  // a plain reference, name or table column is a formula; anything else is a typed list
  try {
    const n = parseFormula(canonicalFormula(raw, locale));
    if (n.t === 'ref' || n.t === 'range' || n.t === 'tref' || n.t === 'call') return canonicalFormula(raw, locale);
    if (n.t === 'name' && /^[A-Za-z_À-￿][\w.À-￿]*$/.test(raw)) return canonicalFormula(raw, locale);
  } catch {
    // not a formula: a list of words
  }
  const items = raw.split(/[;\n]|,(?!\d)/).map((x) => x.trim()).filter((x) => x !== '');
  return `"${items.join(',').replace(/"/g, '""')}"`;
}

const valid = (canon: string): boolean => {
  try {
    parseFormula(canon);
    return true;
  } catch {
    return false;
  }
};

export function ValidationDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const loc = d.locale;
  const cur = d.x.validationAtActive();
  const base: DataValidation = cur ?? { ...newValidation('new', []), type: 'any', formula1: '', formula2: '', showInput: true, showError: true };
  const [tab, setTab] = useState('config');
  const [type, setType] = useState<ValidationType>(base.type);
  const [op, setOp] = useState<ValidationOp>(base.op);
  const isList = type === 'list';
  const [f1, setF1] = useState(shown(base.formula1, loc, isList));
  const [f2, setF2] = useState(shown(base.formula2, loc, false));
  const [blank, setBlank] = useState(base.allowBlank);
  const [dropdown, setDropdown] = useState(base.showDropdown);
  const [showInput, setShowInput] = useState(base.showInput);
  const [inTitle, setInTitle] = useState(base.inputTitle ?? '');
  const [inMsg, setInMsg] = useState(base.inputMessage ?? '');
  const [showErr, setShowErr] = useState(base.showError);
  const [style, setStyle] = useState(base.errorStyle);
  const [errTitle, setErrTitle] = useState(base.errorTitle ?? '');
  const [errMsg, setErrMsg] = useState(base.errorMessage ?? '');
  const two = type !== 'list' && type !== 'custom' && type !== 'any' && (op === 'between' || op === 'notBetween');
  const needs = type !== 'any';
  const c1 = needs ? stored(f1, loc, isList) : '';
  const c2 = two ? stored(f2, loc, false) : '';
  const ok = !needs || (f1.trim() !== '' && valid(c1) && (!two || (f2.trim() !== '' && valid(c2))));
  const label1 = type === 'list' ? t('Origen') : type === 'custom' ? t('Fórmula') : two ? t('Mínimo') : t('Valor');
  const apply = () => {
    d.x.setValidation({
      type,
      op,
      formula1: c1,
      formula2: two ? c2 : undefined,
      allowBlank: blank,
      showDropdown: dropdown,
      showInput,
      inputTitle: inTitle || undefined,
      inputMessage: inMsg || undefined,
      showError: showErr,
      errorStyle: style,
      errorTitle: errTitle || undefined,
      errorMessage: errMsg || undefined,
    });
    onClose();
  };
  return (
    <Modal
      title={t('Validación de datos')}
      onClose={onClose}
      width={540}
      actions={
        <>
          <Button
            onClick={() => {
              d.x.clearValidation();
              onClose();
            }}
          >
            {t('Borrar todos')}
          </Button>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!ok} onClick={apply}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <TabList selectedValue={tab} onTabSelect={(_e, v) => setTab(String(v.value))} style={{ marginBottom: 12 }}>
        <Tab value="config">{t('Configuración')}</Tab>
        <Tab value="input">{t('Mensaje de entrada')}</Tab>
        <Tab value="error">{t('Mensaje de error')}</Tab>
      </TabList>
      {tab === 'config' && (
        <>
          <div style={field}>
            <label htmlFor="dv-type">{t('Permitir')}</label>
            <Select
              id="dv-type"
              value={type}
              onChange={(_e, v) => {
                const next = v.value as ValidationType;
                if ((next === 'list') !== (type === 'list')) setF1('');
                setType(next);
              }}
            >
              {TYPES.map(([k, label]) => (
                <option key={k} value={k}>
                  {t(label)}
                </option>
              ))}
            </Select>
          </div>
          {needs && type !== 'list' && type !== 'custom' && (
            <div style={field}>
              <label htmlFor="dv-op">{t('Datos')}</label>
              <Select id="dv-op" value={op} onChange={(_e, v) => setOp(v.value as ValidationOp)}>
                {OPS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {t(label)}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {needs && (
            <div style={two ? row2 : undefined}>
              <div style={field}>
                <label htmlFor="dv-f1">{label1}</label>
                <Input id="dv-f1" value={f1} onChange={(_e, v) => setF1(v.value)} placeholder={isList ? (loc === 'es' ? 'Sí;No;Tal vez  ·  =$A$1:$A$5' : 'Yes,No,Maybe  ·  =$A$1:$A$5') : ''} aria-invalid={f1.trim() !== '' && !valid(c1)} />
              </div>
              {two && (
                <div style={field}>
                  <label htmlFor="dv-f2">{t('Máximo')}</label>
                  <Input id="dv-f2" value={f2} onChange={(_e, v) => setF2(v.value)} aria-invalid={f2.trim() !== '' && !valid(c2)} />
                </div>
              )}
            </div>
          )}
          {isList && <Checkbox label={t('Lista desplegable en la celda')} checked={dropdown} onChange={(_e, v) => setDropdown(!!v.checked)} />}
          {needs && <Checkbox label={t('Omitir blancos')} checked={blank} onChange={(_e, v) => setBlank(!!v.checked)} />}
          {!ok && f1.trim() !== '' && <p role="alert" style={{ color: 'var(--colorPaletteRedForeground1)' }}>{t('La fórmula o el valor no es válido.')}</p>}
        </>
      )}
      {tab === 'input' && (
        <>
          <Checkbox label={t('Mostrar mensaje de entrada al seleccionar la celda')} checked={showInput} onChange={(_e, v) => setShowInput(!!v.checked)} />
          <div style={{ ...field, marginTop: 10 }}>
            <label htmlFor="dv-it">{t('Título')}</label>
            <Input id="dv-it" maxLength={32} value={inTitle} onChange={(_e, v) => setInTitle(v.value)} />
          </div>
          <div style={field}>
            <label htmlFor="dv-im">{t('Mensaje de entrada')}</label>
            <Textarea id="dv-im" rows={4} maxLength={255} value={inMsg} onChange={(_e, v) => setInMsg(v.value)} />
          </div>
        </>
      )}
      {tab === 'error' && (
        <>
          <Checkbox label={t('Mostrar mensaje de error si se escriben datos no válidos')} checked={showErr} onChange={(_e, v) => setShowErr(!!v.checked)} />
          <div style={{ ...field, marginTop: 10 }}>
            <label htmlFor="dv-style">{t('Estilo')}</label>
            <Select id="dv-style" value={style} onChange={(_e, v) => setStyle(v.value as DataValidation['errorStyle'])}>
              <option value="stop">{t('Detener')}</option>
              <option value="warning">{t('Advertencia')}</option>
              <option value="information">{t('Información')}</option>
            </Select>
          </div>
          <div style={field}>
            <label htmlFor="dv-et">{t('Título')}</label>
            <Input id="dv-et" maxLength={32} value={errTitle} onChange={(_e, v) => setErrTitle(v.value)} />
          </div>
          <div style={field}>
            <label htmlFor="dv-em">{t('Mensaje de error')}</label>
            <Textarea id="dv-em" rows={4} maxLength={255} value={errMsg} onChange={(_e, v) => setErrMsg(v.value)} />
          </div>
        </>
      )}
    </Modal>
  );
}

/** The alert Excel shows when a typed value breaks a rule: stop, warning or information. */
export function EntryAlertDialog({ ui }: { ui: CalcUI }) {
  const d = ui.doc;
  useSyncExternalStore(d.subscribe, d.getVersion);
  const a = d.x.alert;
  if (!a) return null;
  const done = (action: 'retry' | 'accept' | 'cancel') => {
    const err = d.x.resolveAlert(action);
    if (err && err !== ENTRY_PENDING) window.alert(err);
    window.dispatchEvent(new Event('nova:focus-grid'));
  };
  return (
    <Modal
      title={a.title}
      onClose={() => done('retry')}
      actions={
        a.style === 'stop' ? (
          <>
            <Button appearance="primary" onClick={() => done('retry')}>
              {t('Reintentar')}
            </Button>
            <Button onClick={() => done('cancel')}>{t('Cancelar')}</Button>
          </>
        ) : a.style === 'warning' ? (
          <>
            <Button appearance="primary" onClick={() => done('accept')}>
              {t('Sí')}
            </Button>
            <Button onClick={() => done('retry')}>{t('No')}</Button>
            <Button onClick={() => done('cancel')}>{t('Cancelar')}</Button>
          </>
        ) : (
          <>
            <Button appearance="primary" onClick={() => done('accept')}>
              {t('Aceptar')}
            </Button>
            <Button onClick={() => done('cancel')}>{t('Cancelar')}</Button>
          </>
        )
      }
    >
      <p role="alert">{a.message}</p>
      {a.style === 'warning' && <p>{t('¿Desea continuar?')}</p>}
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- hyperlink
type LinkKind = 'web' | 'here' | 'mail';

export function HyperlinkDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const cur = d.x.hyperlinkAtActive();
  const { row, col } = d.sel.active;
  const cell = d.wb.getValue(d.activeSheetId, row, col);
  const [kind, setKind] = useState<LinkKind>(cur?.location ? 'here' : cur?.url?.startsWith('mailto:') ? 'mail' : 'web');
  const [url, setUrl] = useState(cur?.url && !cur.url.startsWith('mailto:') ? cur.url : '');
  const [place, setPlace] = useState(cur?.location ?? '');
  const mailParts = cur?.url?.startsWith('mailto:') ? /^mailto:([^?]*)(?:\?subject=(.*))?$/.exec(cur.url) : null;
  const [mail, setMail] = useState(mailParts?.[1] ?? '');
  const [subject, setSubject] = useState(mailParts?.[2] ? decodeURIComponent(mailParts[2]) : '');
  const [text, setText] = useState(typeof cell === 'string' ? cell : cell === null ? '' : String(cell));
  const [tip, setTip] = useState(cur?.tooltip ?? '');
  const names = d.wb.namesFor(d.activeSheetId);
  const target = (): { url?: string; location?: string } | null => {
    if (kind === 'web') {
      const u = url.trim();
      if (!u) return null;
      return { url: /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : /^[\w.-]+@[\w.-]+\.\w+$/.test(u) ? `mailto:${u}` : `https://${u}` };
    }
    if (kind === 'mail') return mail.trim() ? { url: `mailto:${mail.trim()}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}` } : null;
    return place.trim() ? { location: place.trim() } : null;
  };
  const tg = target();
  const unsafe = tg?.url ? safeUrl(tg.url) === null : false;
  const placeOk = kind !== 'here' || !place.trim() || d.wb.definedName(place.trim(), d.activeSheetId) !== undefined || /^(?:'[^']+'|[^!']+)!\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?$/.test(place.trim()) || /^\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?$/.test(place.trim());
  return (
    <Modal
      title={t('Insertar hipervínculo')}
      onClose={onClose}
      width={560}
      actions={
        <>
          {cur && (
            <Button
              onClick={() => {
                d.x.removeHyperlink();
                onClose();
              }}
            >
              {t('Quitar vínculo')}
            </Button>
          )}
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!tg || unsafe || !placeOk}
            onClick={() => {
              d.x.setHyperlink({ ...tg!, tooltip: tip.trim() || undefined, text: text.trim() || undefined });
              onClose();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="hl-kind">{t('Vincular a')}</label>
        <Select id="hl-kind" value={kind} onChange={(_e, v) => setKind(v.value as LinkKind)}>
          <option value="web">{t('Página web o archivo')}</option>
          <option value="here">{t('Lugar de este documento')}</option>
          <option value="mail">{t('Dirección de correo electrónico')}</option>
        </Select>
      </div>
      <div style={field}>
        <label htmlFor="hl-text">{t('Texto que mostrar')}</label>
        <Input id="hl-text" value={text} onChange={(_e, v) => setText(v.value)} />
      </div>
      {kind === 'web' && (
        <div style={field}>
          <label htmlFor="hl-url">{t('Dirección')}</label>
          <Input id="hl-url" autoFocus value={url} placeholder="https://" onChange={(_e, v) => setUrl(v.value)} aria-invalid={unsafe} />
          {unsafe && <small style={{ color: 'var(--colorPaletteRedForeground1)' }}>{t('Solo se admiten direcciones web (http, https), de correo (mailto) y de teléfono (tel).')}</small>}
        </div>
      )}
      {kind === 'here' && (
        <div style={field}>
          <label htmlFor="hl-place">{t('Referencia de celda o nombre definido')}</label>
          <Input id="hl-place" autoFocus value={place} placeholder="Hoja2!A1" onChange={(_e, v) => setPlace(v.value)} aria-invalid={!placeOk} />
          <Select aria-label={t('Hojas y nombres')} value="" onChange={(_e, v) => v.value && setPlace(v.value)}>
            <option value="">{t('Elegir una hoja o un nombre…')}</option>
            {d.wb.sheets.map((s) => (
              <option key={s.id} value={`${/^[A-Za-z_][\w.]*$/.test(s.name) ? s.name : `'${s.name}'`}!A1`}>
                {s.name}
              </option>
            ))}
            {names.map((n) => (
              <option key={`${n.scope}:${n.name}`} value={n.name}>
                {n.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      {kind === 'mail' && (
        <>
          <div style={field}>
            <label htmlFor="hl-mail">{t('Dirección de correo')}</label>
            <Input id="hl-mail" autoFocus value={mail} onChange={(_e, v) => setMail(v.value)} />
          </div>
          <div style={field}>
            <label htmlFor="hl-subj">{t('Asunto')}</label>
            <Input id="hl-subj" value={subject} onChange={(_e, v) => setSubject(v.value)} />
          </div>
        </>
      )}
      <div style={field}>
        <label htmlFor="hl-tip">{t('Información en pantalla')}</label>
        <Input id="hl-tip" value={tip} onChange={(_e, v) => setTip(v.value)} />
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- notes
export function NoteDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const { row, col } = d.sel.active;
  const cur = d.x.commentAtActive();
  const [text, setText] = useState(cur?.text ?? '');
  const author = typeof localStorage !== 'undefined' ? (safeGet('nova.author') ?? '') : '';
  const [who, setWho] = useState(cur?.author ?? author ?? '');
  return (
    <Modal
      title={cur ? t('Editar nota') : t('Nueva nota')}
      onClose={onClose}
      actions={
        <>
          {cur && (
            <Button
              onClick={() => {
                d.x.deleteComments({ r1: row, c1: col, r2: row, c2: col });
                onClose();
              }}
            >
              {t('Eliminar nota')}
            </Button>
          )}
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            onClick={() => {
              if (who.trim()) safeSet('nova.author', who.trim());
              d.x.saveComment(row, col, text, who.trim() || t('Autor'));
              onClose();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="note-author">{t('Autor')}</label>
        <Input id="note-author" value={who} onChange={(_e, v) => setWho(v.value)} />
      </div>
      <div style={field}>
        <label htmlFor="note-text">{t('Nota')}</label>
        <Textarea id="note-text" autoFocus rows={6} value={text} onChange={(_e, v) => setText(v.value)} />
      </div>
    </Modal>
  );
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    // no storage: the author is asked again
  }
}

void normRect;
